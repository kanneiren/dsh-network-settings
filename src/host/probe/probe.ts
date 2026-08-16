/** Layered probe orchestration (DIRECT / PROXY / SYSTEM). */
import type { LayeredProbe, ProbeCheck, ProbeLayer, ProbePath, ProbeTarget, ProxyEndpoint } from '../model.ts'
import {
  openHttpTunnel, probeDns, probeHttp, probeHttpThroughProxy, probeHttpsThroughSocket,
  probeTcp, probeTls,
} from './net.ts'

export interface ProbeRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  proxy?: ProxyEndpoint
}

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

  const tcp = await probeTcp(target.host, port, { signal: options.signal, timeoutMs: 4_000 })
  layers.tcp = withStatus(tcp, target, path, 'tcp')
  if (tcp.status !== 'healthy') {
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

  const http = await probeHttp(url, { signal: options.signal, timeoutMs: 8_000 })
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

  const proxyTcp = await probeTcp(proxy.host, proxy.port, { signal: options.signal, timeoutMs: 4_000 })
  layers.tcp = withStatus(proxyTcp, target, 'proxy', 'tcp')
  if (proxyTcp.status !== 'healthy') {
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

  try {
    if (url.startsWith('https://')) {
      const tunnel = await openHttpTunnel(proxy.host, proxy.port, target.host, port, { signal: options.signal, timeoutMs: 5_000 })
      try {
        const https = await probeHttpsThroughSocket(tunnel, target.host, new URL(url), { signal: options.signal, timeoutMs: 8_000 })
        layers.tls = {
          status: 'healthy',
          humanMessage: '经代理 TLS 握手成功',
          source: 'node:tls+CONNECT',
          timestamp: new Date().toISOString(),
          details: { target: target.id, path: 'proxy', layer: 'tls', proxy: `${proxy.host}:${proxy.port}` },
        }
        layers.http = {
          status: https.statusCode >= 200 && https.statusCode < 500 ? 'healthy' : 'warning',
          humanMessage: `经代理访问返回 ${https.statusCode}`,
          source: 'node:https+CONNECT',
          timestamp: new Date().toISOString(),
          details: { target: target.id, path: 'proxy', layer: 'http', statusCode: https.statusCode, proxy: `${proxy.host}:${proxy.port}` },
        }
      } finally {
        tunnel.destroy()
      }
    } else {
      const http = await probeHttpThroughProxy(new URL(url), proxy.host, proxy.port, { signal: options.signal, timeoutMs: 8_000 })
      layers.tls = {
        status: 'not-applicable',
        humanMessage: 'HTTP 目标无 TLS 层',
        source: 'probe-engine',
        timestamp: new Date().toISOString(),
      }
      layers.http = {
        status: http.statusCode >= 200 && http.statusCode < 500 ? 'healthy' : 'warning',
        humanMessage: `经代理访问返回 ${http.statusCode}`,
        source: 'node:http',
        timestamp: new Date().toISOString(),
        details: { target: target.id, path: 'proxy', layer: 'http', statusCode: http.statusCode, proxy: `${proxy.host}:${proxy.port}` },
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    layers.tls = {
      status: 'error',
      errorCode: 'PROXY_TLS_FAILED',
      humanMessage: '经代理 TLS 握手失败',
      technicalMessage: message,
      source: 'node:tls+CONNECT',
      timestamp: new Date().toISOString(),
    }
    layers.http = notTested(target, 'proxy', 'http', '代理 TLS 失败，跳过 HTTP')
  }
  return { target, path: 'proxy', layers }
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
