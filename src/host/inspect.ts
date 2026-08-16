/** Read-only Network Core entry point (Phase 1). */
import type { LayeredProbe, ListenerInspection, ModelServiceTarget, NetworkInspection, ProbeTarget, ProxyEndpoint, WslDistribution } from './model.ts'
import { inspectWindowsFacts } from './windows/inspect.ts'
import { inspectWsl } from './wsl/inspect.ts'
import { endpointsFromInspection } from './proxy/inspect.ts'
import { probeTarget } from './probe/probe.ts'
import { probeWslDirectInternet, probeWslDns, probeWslProxyInternet, probeWslTcp } from './probe/wsl.ts'
import { parseProxyUrl } from './proxy/proxy-url.ts'

export interface InspectNetworkOptions {
  signal?: AbortSignal
  timeoutMs?: number
  includeWsl?: boolean
  includeProbes?: boolean
  targets?: ProbeTarget[]
  modelServices?: ModelServiceTarget[]
}

export const DEFAULT_TARGETS: readonly ProbeTarget[] = [
  { id: 'github', label: 'GitHub', host: 'github.com', port: 443, url: 'https://github.com', kind: 'github' },
  { id: 'npm-registry', label: 'npm Registry', host: 'registry.npmjs.org', port: 443, url: 'https://registry.npmjs.org', kind: 'npm' },
]

/** Read-only full inspection: static facts plus on-demand layered probes. */
export async function inspectNetwork(options: InspectNetworkOptions = {}): Promise<NetworkInspection> {
  const timestamp = new Date().toISOString()
  const runtime = { platform: process.platform, version: process.version, ...process.env['DSH_HOME'] === undefined ? {} : { dshHome: process.env['DSH_HOME'] } }

  const windows = await inspectWindowsFacts({ signal: options.signal, timeoutMs: options.timeoutMs ?? 20_000 })
  windows.modelServices = options.modelServices ?? windows.modelServices
  const wsl = options.includeWsl === false ? undefined : await inspectWsl({ signal: options.signal, timeoutMs: options.timeoutMs ?? 20_000 })

  const endpoints = endpointsFromInspection(
    windows.proxy,
    windows.environment.scopes,
    wsl?.distributions ?? [],
  )

  windows.proxy.endpoints = annotateListeners(endpoints, windows.listeners)

  const probes: LayeredProbe[] = []
  if (options.includeProbes !== false) {
    const targets = [...(options.targets ?? DEFAULT_TARGETS), ...(options.modelServices ?? windows.modelServices).flatMap(modelTargets)]
    const primary = primaryProxy(endpoints)
    const directResults = await Promise.all(targets.map(async target => probeTarget(target, 'direct', { signal: options.signal })))
    probes.push(...directResults)
    if (primary !== undefined) {
      probes.push(...await Promise.all(targets.map(async target => probeTarget(target, 'proxy', { proxy: primary, signal: options.signal }))))
    }

    if (wsl?.available === true) {
      for (const distribution of wsl.distributions) {
        if (distribution.state !== 'running') continue
        const distroEnv = distribution.network?.environment
        for (const target of targets.slice(0, 2)) {
          const dns = await probeWslDns(distribution.name, target.host, { signal: options.signal })
          probes.push({
            target: { ...target, id: `wsl:${distribution.name}:dns:${target.id}`, label: `${distribution.name} → DNS ${target.label}`, kind: target.kind },
            path: 'direct',
            layers: { dns },
          })
          const direct = await probeWslDirectInternet(distribution.name, target.url ?? `https://${target.host}`, { signal: options.signal })
          probes.push({
            target: { ...target, id: `wsl:${distribution.name}:direct:${target.id}`, label: `${distribution.name} → ${target.label}`, kind: target.kind },
            path: 'direct',
            layers: { http: direct },
          })
        }
        for (const host of windowsHostsFor(distribution)) {
          const tcp = await probeWslTcp(distribution.name, host.address, 443, { signal: options.signal })
          probes.push({
            target: { id: `wsl:${distribution.name}:host:${host.source}`, label: `${distribution.name} → Windows Host (${host.source})`, host: host.address, port: 443, kind: 'windows-host' },
            path: 'direct',
            layers: { tcp },
          })
        }
        if (primary !== undefined && distroEnv !== undefined) {
          const distroProxy = firstWslProxy(distroEnv)
          if (distroProxy !== undefined) {
            const proxyTcp = await probeWslTcp(distribution.name, distroProxy.host, distroProxy.port, { signal: options.signal })
            const proxyInternet = await probeWslProxyInternet(distribution.name, distroProxy.url, 'https://github.com', { signal: options.signal })
            probes.push({
              target: { id: `wsl:${distribution.name}:proxy-endpoint`, label: `${distribution.name} → Windows Proxy`, host: distroProxy.host, port: distroProxy.port, kind: 'wsl-proxy' },
              path: 'proxy',
              layers: { tcp: proxyTcp, http: proxyInternet },
            })
          }
        }
      }
    }
  }

  return { runtime, windows, ...wsl === undefined ? {} : { wsl }, probes, timestamp }
}

function annotateListeners(endpoints: ProxyEndpoint[], listeners: ListenerInspection[]): ProxyEndpoint[] {
  return endpoints.map(endpoint => {
    const listener = listeners.find(entry =>
      entry.port === endpoint.port
      && (entry.address === endpoint.host || entry.address === '0.0.0.0' || entry.address === '::'))
    return listener === undefined ? endpoint : { ...endpoint, listener: { pid: listener.pid, processName: listener.processName ?? '' } }
  })
}

function primaryProxy(endpoints: ProxyEndpoint[]): ProxyEndpoint | undefined {
  return endpoints.find(item => item.source === 'wininet.user')
    ?? endpoints.find(item => item.source === 'winhttp.user')
    ?? endpoints.find(item => item.source === 'env.process')
    ?? endpoints[0]
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
