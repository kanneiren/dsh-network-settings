/** Read-only Network Core entry point (Phase 1). * Module facade: Public surface: inspectNetwork(). One hard deadline wraps every collector and probe.
 */
import type { EnvironmentScopeSnapshot, LayeredProbe, ListenerInspection, ModelServiceTarget, NetworkInspection, ProbeTarget, ProxyEndpoint, WslDistribution } from './model.ts'
import { inspectWindowsFacts } from './windows/inspect.ts'
import { inspectWsl } from './wsl/inspect.ts'
import { endpointsFromInspection } from './proxy/inspect.ts'
import { proxyEnvironmentOf } from './shared-env.ts'
import { probeTarget } from './probe/probe.ts'
import { probeWslDirectInternet, probeWslDns, probeWslProxyInternet, probeWslTcp } from './probe/wsl.ts'
import { inspectMacFacts } from './mac/inspect.ts'
import { parseProxyUrl } from './proxy/proxy-url.ts'

export interface InspectNetworkOptions {
  signal?: AbortSignal
  timeoutMs?: number
  includeWsl?: boolean
  includeProbes?: boolean
  targets?: readonly ProbeTarget[]
  modelServices?: ModelServiceTarget[]
  /** Reuse previously collected static Windows/WSL facts; only probes re-run. */
  reuse?: NetworkInspection
  /** single = one attempt per layer; multi = repeated TCP/HTTP sampling. */
  probePlan?: 'single' | 'multi'
}

export const DEFAULT_TARGETS: readonly ProbeTarget[] = [
  { id: 'deepseek', label: 'DeepSeek', host: 'api.deepseek.com', port: 443, url: 'https://api.deepseek.com', kind: 'deepseek' },
  { id: 'openai', label: 'OpenAI', host: 'api.openai.com', port: 443, url: 'https://api.openai.com', kind: 'openai' },
  { id: 'github', label: 'GitHub', host: 'github.com', port: 443, url: 'https://github.com', kind: 'github' },
  { id: 'npm-registry', label: 'npm Registry', host: 'registry.npmjs.org', port: 443, url: 'https://registry.npmjs.org', kind: 'npm' },
  { id: 'pypi', label: 'PyPI', host: 'pypi.org', port: 443, url: 'https://pypi.org', kind: 'pypi' },
  { id: 'huggingface', label: 'Hugging Face', host: 'huggingface.co', port: 443, url: 'https://huggingface.co', kind: 'huggingface' },
]

/** Read-only full inspection: static facts plus on-demand layered probes. */
export async function inspectNetwork(options: InspectNetworkOptions = {}): Promise<NetworkInspection> {
  // One deadline for the whole inspection. Individual probes carry layer
  // timeouts, but network breakage multiplies them (DNS retries, dropped SYNs,
  // stalled bodies); without a hard cap a single 'run' could hang for minutes.
  const deadlineMs = options.timeoutMs ?? 45_000
  const deadline = new AbortController()
  const forwardAbort = (): void => { deadline.abort() }
  if (options.signal?.aborted === true) deadline.abort()
  else options.signal?.addEventListener('abort', forwardAbort, { once: true })
  const deadlineTimer = setTimeout(forwardAbort, deadlineMs)
  deadlineTimer.unref?.()
  try {
    return await inspectNetworkWithDeadline(options, deadline.signal, deadlineMs)
  } finally {
    clearTimeout(deadlineTimer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}

async function inspectNetworkWithDeadline(
  options: InspectNetworkOptions,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<NetworkInspection> {
  const timestamp = new Date().toISOString()
  const runtime = { platform: process.platform, version: process.version, ...process.env['DSH_HOME'] === undefined ? {} : { dshHome: process.env['DSH_HOME'] } }
  // Static phases keep their own tight caps: a hung PowerShell or wsl.exe must
  // not consume the whole budget. The previous behavior passed the full
  // timeoutMs (60s from the RPC entry) into every subcommand.
  const staticTimeoutMs = Math.min(deadlineMs, 20_000)

  const isMac = process.platform === 'darwin'
  const macos = isMac ? await inspectMacFacts({ signal, timeoutMs: staticTimeoutMs }) : undefined
  const windows = isMac ? undefined : options.reuse?.windows ?? await inspectWindowsFacts({ signal, timeoutMs: staticTimeoutMs })
  const dshFacts = {
    dsh: windows?.environment.scopes.dsh ?? proxyEnvironmentOf(process.env),
    modelServices: options.modelServices ?? [],
  }
  const wsl = isMac || options.reuse !== undefined
    ? options.reuse?.wsl
    : options.includeWsl === false ? undefined : await inspectWsl({ signal, timeoutMs: Math.min(deadlineMs, 15_000) })

  const endpoints = endpointsFromInspection(
    windows?.proxy ?? { wininet: { enabled: false, autoDetect: false }, winhttp: [], endpoints: [] },
    windows?.environment.scopes ?? { process: {}, user: {}, machine: {}, dsh: {} },
    wsl?.distributions ?? [],
  )
  const annotated = annotateListeners(
    macos === undefined ? endpoints : macEndpoints(macos, dshFacts.dsh),
    macos?.listeners ?? windows?.listeners ?? [],
  )
  if (windows !== undefined) windows.proxy.endpoints = annotated
  if (macos !== undefined) macos.proxy.endpoints = annotated

  const probes: LayeredProbe[] = []
  if (options.includeProbes !== false) {
    const targets = [...(options.targets ?? DEFAULT_TARGETS), ...(options.modelServices ?? dshFacts.modelServices).flatMap(modelTargets)]
    const plan = options.probePlan ?? 'single'
    const directResults = await Promise.all(targets.map(async target => probeTarget(target, 'direct', { signal, plan })))
    probes.push(...directResults)

    // Probe the proxy the DSH process is actually configured to use, then the
    // system primary proxy when it differs. Configuration drift depends on
    // seeing the DSH endpoint fail/succeed independently of the system proxy.
    const dshProxy = proxyFromEnvironmentSnapshot(dshFacts.dsh)
    const primary = primaryProxy(annotated)
    for (const proxy of distinctProxies([dshProxy, primary])) {
      if (signal.aborted) break
      probes.push(...await Promise.all(targets.map(async target => probeTarget(target, 'proxy', { proxy, signal, plan }))))
    }

    if (wsl?.available === true) {
      for (const distribution of wsl.distributions) {
        if (distribution.state !== 'running') continue
        if (signal.aborted) break
        const distroEnv = distribution.network?.environment
        // Each wsl.exe launch costs ~0.5-2s, so batch the distro probes in
        // parallel instead of one sequential chain; a broken network would
        // otherwise serialize every 6s script timeout.
        const targetPairs = await Promise.all(targets.slice(0, 2).map(async target => [
          {
            target: { ...target, id: `wsl:${distribution.name}:dns:${target.id}`, label: `${distribution.name} → DNS ${target.label}`, kind: target.kind },
            path: 'direct' as const,
            layers: { dns: await probeWslDns(distribution.name, target.host, { signal }) },
          },
          {
            target: { ...target, id: `wsl:${distribution.name}:direct:${target.id}`, label: `${distribution.name} → ${target.label}`, kind: target.kind },
            path: 'direct' as const,
            layers: { http: await probeWslDirectInternet(distribution.name, target.url ?? `https://${target.host}`, { signal }) },
          },
        ]))
        probes.push(...targetPairs.flat())
        const hostProbes = await Promise.all(windowsHostsFor(distribution).slice(0, 3).map(async host => ({
          target: { id: `wsl:${distribution.name}:host:${host.source}`, label: `${distribution.name} → Windows Host (${host.source})`, host: host.address, port: 443, kind: 'windows-host' as const },
          path: 'direct' as const,
          layers: { tcp: await probeWslTcp(distribution.name, host.address, 443, { signal }) },
        })))
        probes.push(...hostProbes)
        // In WSL the DSH process env is the authoritative current-DSH config;
        // the distro-wide env is only a fallback for comparison.
        const distroProxy = distroEnv === undefined ? undefined : firstWslProxy(distroEnv)
        const effectiveProxy = dshProxy ?? distroProxy
        if (effectiveProxy !== undefined) {
          // The proxy endpoint TCP state is a property of the endpoint, not of
          // the target; probe it once and share the check across targets.
          const proxyTcp = await probeWslTcp(distribution.name, effectiveProxy.host, effectiveProxy.port, { signal })
          const proxyInternets = await Promise.all(targets.slice(0, 2).map(target =>
            probeWslProxyInternet(distribution.name, effectiveProxy.url, target.url ?? `https://${target.host}`, { signal })))
          probes.push(...proxyInternets.map(http => ({
            target: { id: `wsl:${distribution.name}:proxy-endpoint`, label: `${distribution.name} → Windows Proxy`, host: effectiveProxy.host, port: effectiveProxy.port, kind: 'wsl-proxy' as const },
            path: 'proxy' as const,
            layers: { tcp: proxyTcp, http },
          })))
        }
      }
    }
  }

  return {
    runtime,
    ...macos === undefined ? {} : { macos },
    ...windows === undefined ? {} : { windows },
    ...wsl === undefined ? {} : { wsl },
    dsh: dshFacts.dsh,
    modelServices: dshFacts.modelServices,
    probes,
    timestamp,
  }
}

/** Mac endpoints: scutil system proxy + DSH process env, env first. */
function macEndpoints(macos: NonNullable<NetworkInspection['macos']>, dshEnv: EnvironmentScopeSnapshot): import('./model.ts').ProxyEndpoint[] {
  const endpoints: import('./model.ts').ProxyEndpoint[] = []
  const envRaw = dshEnv['HTTPS_PROXY'] ?? dshEnv['https_proxy'] ?? dshEnv['HTTP_PROXY'] ?? dshEnv['http_proxy']
  if (typeof envRaw === 'string' && envRaw !== '') {
    try {
      const parsed = parseProxyUrl(envRaw)
      endpoints.push({ source: 'env.process', url: envRaw, host: parsed.host, port: parsed.port, protocol: parsed.protocol, configured: true })
    } catch { /* invalid proxy URL is surfaced by diagnosis, not here */ }
  }
  const scutil = macos.proxy.scutil
  const host = scutil.httpsHost ?? scutil.httpHost
  const port = scutil.httpsPort ?? scutil.httpPort
  if (host !== undefined && port !== undefined && (scutil.httpsEnabled || scutil.httpEnabled)) {
    endpoints.push({ source: 'macos.scutil', url: `http://${host}:${port}`, host, port, protocol: 'http', configured: true })
  }
  return endpoints
}

function annotateListeners(endpoints: ProxyEndpoint[], listeners: ListenerInspection[]): ProxyEndpoint[] {
  const normalize = (host: string): string => host.toLowerCase() === 'localhost' ? '127.0.0.1' : host
  return endpoints.map(endpoint => {
    const listener = listeners.find(entry =>
      entry.port === endpoint.port
      && (entry.address === normalize(endpoint.host) || entry.address === '0.0.0.0' || entry.address === '::'))
    return listener === undefined ? endpoint : { ...endpoint, listener: { pid: listener.pid, processName: listener.processName ?? '' } }
  })
}

function primaryProxy(endpoints: ProxyEndpoint[]): ProxyEndpoint | undefined {
  return endpoints.find(item => item.source === 'wininet.user')
    ?? endpoints.find(item => item.source === 'winhttp.user')
    ?? endpoints.find(item => item.source === 'env.process')
    ?? endpoints[0]
}

function proxyFromEnvironmentSnapshot(env: EnvironmentScopeSnapshot | Record<string, unknown> | undefined): ProxyEndpoint | undefined {
  if (env === undefined) return undefined
  return firstWslProxy(env as EnvironmentScopeSnapshot)
}

function distinctProxies(proxies: Array<ProxyEndpoint | undefined>): ProxyEndpoint[] {
  const seen = new Set<string>()
  const result: ProxyEndpoint[] = []
  for (const proxy of proxies) {
    if (proxy === undefined || proxy.host === '' || proxy.port === 0) continue
    const key = `${proxy.host}:${proxy.port}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(proxy)
  }
  return result
}

function firstWslProxy(env: NonNullable<NonNullable<WslDistribution['network']>['environment']>): ProxyEndpoint | undefined {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = parseProxyUrl(value)
      return { source: 'wsl', url: parsed.url, host: parsed.host, port: parsed.port, protocol: parsed.protocol, configured: true }
    }
  }
  return undefined
}

function modelTargets(model: ModelServiceTarget): ProbeTarget[] {
  if (model.baseURL === undefined) return []
  try {
    const url = new URL(model.baseURL)
    return [{
      id: `model:${model.provider}`,
      label: `${model.displayName} (${model.provider})`,
      host: url.hostname,
      port: url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port),
      url: model.baseURL,
      kind: 'model-service',
    }]
  } catch {
    return []
  }
}

function windowsHostsFor(distribution: NonNullable<NetworkInspection['wsl']>['distributions'][number]): { address: string; source: string }[] {
  return (distribution.network?.hostCandidates ?? []).map(candidate => ({ address: candidate.address, source: candidate.source }))
}
