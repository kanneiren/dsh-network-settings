/** Layered probe orchestration (DIRECT / PROXY / SYSTEM). */
import type { LayeredProbe, ProbeCheck, ProbeLayer, ProbePath, ProbeTarget, ProxyEndpoint } from '../model.ts'
import {
  openHttpTunnel, probeDns, probeHttp, probeHttpRepeated, probeHttpThroughProxy,
  probeHttpsThroughSocket, probeTcp, probeTcpRepeated, probeTls,
} from './net.ts'

export interface ProbeRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  proxy?: ProxyEndpoint
  /** single = one attempt per layer; multi = repeated TCP/HTTP sampling. */
  plan?: 'single' | 'multi'
}

const MULTI_TCP_ATTEMPTS = 3
const MULTI_TCP_INTERVAL_MS = 300
const MULTI_HTTP_ATTEMPTS = 2

const LAYERS: readonly ProbeLayer[] = ['dns', 'tcp', 'tls', 'http']

function notTested(target: ProbeTarget, path: ProbePath, layer: ProbeLayer, reason: string): ProbeCheck {
  return {
    status: 'not-tested',
    humanMessage: reason,
    source: 'probe-engine',
    timestamp: new Date().toISOString(),
    details: { target: target.id, path, layer },
  }
}

function withStatus(check: ProbeCheck, target: ProbeTarget, path: ProbePath, layer: ProbeLayer): ProbeCheck {
  return { ...check, details: { ...(check.details ?? {}), target: target.id, path, layer } }
}

export async function probeTarget(
  target: ProbeTarget,
  path: ProbePath,
  options: ProbeRunOptions = {},
): Promise<LayeredProbe> {
  const layers: Partial<Record<ProbeLayer, ProbeCheck>> = {}
  const port = target.port ?? 443
  const url = target.url ?? `https://${target.host}${port === 443 ? '' : `:${port}`}`

  const systemProxy = path === 'system' ? (options.proxy ?? systemProxyFromEnvironment(process.env)) : undefined
  const effectiveProxy = path === 'proxy' ? options.proxy : systemProxy
  const proxyDelegatesDns = path === 'proxy' || (path === 'system' && systemProxy !== undefined)

  if (proxyDelegatesDns) {
    // A proxy receives the target hostname and resolves it itself; local DNS
    // failure must not prevent the proxy path from being tested.
    layers.dns = {
      status: 'not-applicable',
      humanMessage: '代理路径由代理解析 DNS',
      technicalMessage: 'DNS is delegated to the proxy for this path',
      source: 'probe-engine',
      timestamp: new Date().toISOString(),
      details: { target: target.id, path, layer: 'dns' },
    }
  } else {
    const dns = await probeDns(target.host, { signal: options.signal, timeoutMs: 4_000 })
    layers.dns = withStatus(dns, target, path, 'dns')
    if (dns.status !== 'healthy') {
      for (const layer of LAYERS.slice(1)) layers[layer] = notTested(target, path, layer, `DNS 失败，跳过 ${layer.toUpperCase()}`)
      return { target, path, layers }
    }
  }

  if (effectiveProxy !== undefined) {
    return probeProxyPath(target, url, effectiveProxy, options, layers)
  }

  const tcp = options.plan === 'multi'
    ? await probeTcpRepeated(target.host, port, { signal: options.signal, timeoutMs: 4_000, attempts: MULTI_TCP_ATTEMPTS, intervalMs: MULTI_TCP_INTERVAL_MS })
    : await probeTcp(target.host, port, { signal: options.signal, timeoutMs: 4_000 })
  layers.tcp = withStatus(tcp, target, path, 'tcp')
  if (tcp.status !== 'healthy' && tcp.status !== 'warning') {
    layers.tls = notTested(target, path, 'tls', 'TCP 失败，跳过 TLS')
    layers.http = notTested(target, path, 'http', 'TCP 失败，跳过 HTTP')
    return { target, path, layers }
  }

  const tls = await probeTls(target.host, port, { signal: options.signal, timeoutMs: 6_000 })
  layers.tls = withStatus(tls, target, path, 'tls')
  if (tls.status !== 'healthy') {
    layers.http = notTested(target, path, 'http', 'TLS 失败，跳过 HTTP')
    return { target, path, layers }
  }

  const http = options.plan === 'multi'
    ? await probeHttpRepeated(url, { signal: options.signal, timeoutMs: 8_000, attempts: MULTI_HTTP_ATTEMPTS })
    : await probeHttp(url, { signal: options.signal, timeoutMs: 8_000 })
  layers.http = withStatus(http, target, path, 'http')
  return { target, path, layers }
}

async function probeProxyPath(
  target: ProbeTarget,
  url: string,
  proxy: ProxyEndpoint,
  options: ProbeRunOptions,
  layers: Partial<Record<ProbeLayer, ProbeCheck>>,
): Promise<LayeredProbe> {
  const port = target.port ?? 443

  const proxyTcp = options.plan === 'multi'
    ? await probeTcpRepeated(proxy.host, proxy.port, { signal: options.signal, timeoutMs: 4_000, attempts: MULTI_TCP_ATTEMPTS, intervalMs: MULTI_TCP_INTERVAL_MS })
    : await probeTcp(proxy.host, proxy.port, { signal: options.signal, timeoutMs: 4_000 })
  layers.tcp = withStatus(proxyTcp, target, 'proxy', 'tcp')
  if (proxyTcp.status !== 'healthy' && proxyTcp.status !== 'warning') {
    layers.tls = notTested(target, 'proxy', 'tls', '代理 TCP 失败，跳过 TLS')
    layers.http = notTested(target, 'proxy', 'http', '代理 TCP 失败，跳过 HTTP')
    return { target, path: 'proxy', layers }
  }

  if (proxy.protocol !== 'http') {
    layers.tls = {
      status: 'not-applicable',
      humanMessage: '当前仅支持 HTTP 代理的 CONNECT 探测',
      technicalMessage: `proxy protocol ${proxy.protocol} is not supported for layered HTTP probes yet`,
      source: 'probe-engine',
      timestamp: new Date().toISOString(),
    }
    layers.http = notTested(target, 'proxy', 'http', '代理协议不支持')
    return { target, path: 'proxy', layers }
  }

  const httpAttempts = options.plan === 'multi' ? MULTI_HTTP_ATTEMPTS : 1
  const attempts: Array<{ tls: ProbeCheck; http: ProbeCheck }> = []
  for (let index = 0; index < httpAttempts; index += 1) {
    try {
      if (url.startsWith('https://')) {
        const tunnel = await openHttpTunnel(proxy.host, proxy.port, target.host, port, { signal: options.signal, timeoutMs: 5_000 })
        try {
          const https = await probeHttpsThroughSocket(tunnel, target.host, new URL(url), { signal: options.signal, timeoutMs: 8_000 })
          attempts.push({
            tls: { status: 'healthy', humanMessage: '经代理 TLS 握手成功', source: 'node:tls+CONNECT', timestamp: new Date().toISOString(), details: { target: target.id, path: 'proxy', layer: 'tls', proxy: `${proxy.host}:${proxy.port}` } },
            http: { status: https.statusCode >= 200 && https.statusCode < 500 ? 'healthy' : 'warning', humanMessage: `经代理访问返回 ${https.statusCode}`, source: 'node:https+CONNECT', timestamp: new Date().toISOString(), details: { target: target.id, path: 'proxy', layer: 'http', statusCode: https.statusCode, proxy: `${proxy.host}:${proxy.port}` } },
          })
        } finally {
          tunnel.destroy()
        }
      } else {
        const http = await probeHttpThroughProxy(new URL(url), proxy.host, proxy.port, { signal: options.signal, timeoutMs: 8_000 })
        attempts.push({
          tls: { status: 'not-applicable', humanMessage: 'HTTP 目标无 TLS 层', source: 'probe-engine', timestamp: new Date().toISOString() },
          http: { status: http.statusCode >= 200 && http.statusCode < 500 ? 'healthy' : 'warning', humanMessage: `经代理访问返回 ${http.statusCode}`, source: 'node:http', timestamp: new Date().toISOString(), details: { target: target.id, path: 'proxy', layer: 'http', statusCode: http.statusCode, proxy: `${proxy.host}:${proxy.port}` } },
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attempts.push({
        tls: { status: 'error', errorCode: 'PROXY_TLS_FAILED', humanMessage: '经代理 TLS 握手失败', technicalMessage: message, source: 'node:tls+CONNECT', timestamp: new Date().toISOString() },
        http: notTested(target, 'proxy', 'http', '代理 TLS 失败，跳过 HTTP'),
      })
    }
    if (index < httpAttempts - 1) await new Promise(resolve => setTimeout(resolve, 300))
  }
  const tlsStatus = aggregateAttemptStatus(attempts.map(item => item.tls.status))
  const httpStatus = aggregateAttemptStatus(attempts.map(item => item.http.status))
  const tlsSource = attempts[0]?.tls ?? { status: 'not-tested' as const, humanMessage: '未探测', source: 'probe-engine', timestamp: new Date().toISOString() }
  const httpSource = attempts[0]?.http ?? { status: 'not-tested' as const, humanMessage: '未探测', source: 'probe-engine', timestamp: new Date().toISOString() }
  layers.tls = {
    ...tlsSource,
    status: tlsStatus,
    humanMessage: tlsStatus === 'warning' ? `经代理 TLS 部分成功（${attempts.filter(item => item.tls.status === 'healthy').length}/${attempts.length}）` : tlsSource.humanMessage,
    details: { target: target.id, path: 'proxy', layer: 'tls', proxy: `${proxy.host}:${proxy.port}`, attempts: attempts.map(item => item.tls.status) },
  }
  layers.http = {
    ...httpSource,
    status: httpStatus,
    humanMessage: httpStatus === 'warning' ? `经代理访问部分成功（${attempts.filter(item => item.http.status === 'healthy').length}/${attempts.length}）` : httpSource.humanMessage,
    details: { ...(httpSource.details ?? {}), target: target.id, path: 'proxy', layer: 'http', attempts: attempts.map(item => item.http.status) },
  }
  return { target, path: 'proxy', layers }
}

function aggregateAttemptStatus(statuses: Array<'healthy' | 'warning' | 'error' | 'unknown' | 'not-tested' | 'not-applicable' | 'permission-required'>): ProbeCheck['status'] {
  const healthy = statuses.filter(status => status === 'healthy').length
  if (healthy === 0) return statuses.find(status => status === 'error') ?? 'error'
  if (healthy === statuses.length) return 'healthy'
  return 'warning'
}

/** First usable proxy endpoint from an environment snapshot. */
export function systemProxyFromEnvironment(env: Record<string, unknown>): ProxyEndpoint | undefined {
  const raw = env['HTTPS_PROXY'] ?? env['https_proxy'] ?? env['HTTP_PROXY'] ?? env['http_proxy']
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    const url = new URL(raw)
    return {
      source: 'env.process',
      url: url.toString().replace(/\/\/[^@/]*@/, '//'),
      host: url.hostname,
      port: url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port),
      protocol: url.protocol === 'https:' || url.protocol === 'http:' ? 'http' : 'unknown',
      configured: true,
    }
  } catch {
    return undefined
  }
}
