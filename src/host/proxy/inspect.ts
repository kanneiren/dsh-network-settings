/** Build credential-free ProxyEndpoint rows from every proxy source. */
import type {
  EnvironmentScopeSnapshot, ProxyEndpoint, ProxyInspection, WslDistribution, WinHttpProxyInspection,
} from '../model.ts'
import { proxyEndpointsFromValue } from './proxy-url.ts'

export function endpointsFromInspection(
  proxy: ProxyInspection,
  environment: Record<'process' | 'user' | 'machine' | 'dsh', EnvironmentScopeSnapshot>,
  wsl: readonly WslDistribution[],
): ProxyEndpoint[] {
  const endpoints: ProxyEndpoint[] = []
  if (proxy.wininet.enabled && proxy.wininet.proxyServer !== undefined) {
    endpoints.push(...proxyEndpointsFromValue(proxy.wininet.proxyServer, 'wininet.user'))
  }
  for (const winhttp of proxy.winhttp) {
    if (winhttp.proxyEnabled && winhttp.proxy !== undefined) {
      endpoints.push(...proxyEndpointsFromValue(winhttp.proxy, winhttp.scope === 'machine' ? 'winhttp.machine' : 'winhttp.user'))
    }
  }
  for (const [scope, snapshot] of Object.entries(environment) as [keyof typeof environment, EnvironmentScopeSnapshot][]) {
    const source = scope === 'dsh' ? 'env.process' : `env.${scope}` as ProxyEndpoint['source']
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const) {
      const value = snapshot[key]
      if (typeof value === 'string' && value.trim() !== '') {
        endpoints.push(...proxyEndpointsFromValue(value, source))
      }
    }
  }
  for (const distribution of wsl) {
    const env = distribution.network?.environment
    if (env === undefined) continue
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const) {
      const value = env[key]
      if (typeof value === 'string' && value.trim() !== '') {
        endpoints.push(...proxyEndpointsFromValue(value, 'wsl'))
      }
    }
  }
  return dedupe(endpoints)
}

function endpointKey(endpoint: ProxyEndpoint): string {
  return `${endpoint.source}|${endpoint.host}|${endpoint.port}|${endpoint.protocol}`
}

function dedupe(endpoints: ProxyEndpoint[]): ProxyEndpoint[] {
  const seen = new Set<string>()
  const result: ProxyEndpoint[] = []
  for (const endpoint of endpoints) {
    const key = endpointKey(endpoint)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(endpoint)
  }
  return result
}

