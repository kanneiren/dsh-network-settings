/** Shared graph-building helpers. Pure functions over the read-only survey. */
import type {
  EnvironmentScopeSnapshot, LayeredProbe, ListenerInspection, NetworkInspection,
  ProbeCheck, WindowsInterface, WindowsNetworkInspection,
} from '../model.ts'
import { parseNoProxy, matchesNoProxy } from '../proxy/no-proxy.ts'
import { parseProxyUrl } from '../proxy/proxy-url.ts'
import { redactProxyUrl } from '../redact.ts'
import type {
  DnsBranch, Evidence, NetworkTarget, PathNode, PathStatus, ProxyConfiguration,
  ProxyEndpoint, ProxyListener, ProxyScheme,
} from './types.ts'

export const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const
export const NO_PROXY_KEYS = ['NO_PROXY', 'no_proxy'] as const

export function evidence(
  source: Evidence['source'],
  confidence: Evidence['confidence'],
  value: string,
  ref?: string,
): Evidence {
  return { source, confidence, value, ...ref === undefined ? {} : { ref } }
}

export function envValue(snapshot: EnvironmentScopeSnapshot | undefined, name: string): string | undefined {
  if (snapshot === undefined) return undefined
  const value = snapshot[name as keyof EnvironmentScopeSnapshot]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function noProxyRules(snapshot: EnvironmentScopeSnapshot | undefined): string {
  for (const name of NO_PROXY_KEYS) {
    const value = envValue(snapshot, name)
    if (value !== undefined) return value
  }
  return ''
}

/** Resolve the effective proxy from one environment snapshot for a target. */
export function resolveEnvProxy(
  snapshot: EnvironmentScopeSnapshot | undefined,
  target: NetworkTarget,
  sourceKey: ProxyConfiguration['sourceKey'],
  sourceLabel: string,
): ProxyConfiguration | undefined {
  for (const name of PROXY_ENV_KEYS) {
    const value = envValue(snapshot, name)
    if (value === undefined) continue
    const bypass = parseNoProxy(noProxyRules(snapshot))
    if (matchesNoProxy(bypass, target.host, target.port)) return undefined
    try {
      const parsed = parseProxyUrl(value)
      return {
        id: `${sourceKey}:${name}:${parsed.host}:${parsed.port}`,
        source: sourceLabel,
        sourceKey,
        mode: 'FIXED_SERVERS',
        displayValue: redactProxyUrl(value),
        host: parsed.host,
        port: parsed.port,
        scheme: toProxyScheme(parsed.protocol),
        ...bypass.length === 0 ? {} : { bypass: bypass.map(rule => rule.raw) },
        evidence: [evidence('PROCESS_ENV', 'verified', `${name}=${redactProxyUrl(value)}`)],
      }
    } catch {
      return {
        id: `${sourceKey}:${name}:invalid`,
        source: sourceLabel,
        sourceKey,
        mode: 'FIXED_SERVERS',
        displayValue: redactProxyUrl(value),
        evidence: [evidence('PROCESS_ENV', 'verified', `${name}=${redactProxyUrl(value)}`)],
      }
    }
  }
  return undefined
}

export function toProxyScheme(protocol: 'http' | 'socks' | 'socks5' | 'unknown'): ProxyScheme {
  return protocol === 'socks' ? 'socks' : protocol
}

export function canonicalProxyHost(host: string): string {
  return host.toLowerCase() === 'localhost' ? '127.0.0.1' : host
}

export function canonicalProxyId(host: string | undefined, port: number | undefined): string | undefined {
  if (host === undefined || port === undefined || host === '') return undefined
  return `proxy:${canonicalProxyHost(host)}:${port}`
}

export function findListener(listeners: readonly ListenerInspection[], host: string, port: number): ProxyListener | undefined {
  const normalized = canonicalProxyHost(host)
  const listener = listeners.find(entry =>
    entry.port === port
    && (canonicalProxyHost(entry.address) === normalized || entry.address === '0.0.0.0' || entry.address === '::'))
  return listener === undefined
    ? { address: host, port, state: 'NOT_FOUND', evidence: [evidence('PROCESS_TABLE', 'verified', `no listener for ${host}:${port}`)] }
    : {
        address: listener.address,
        port: listener.port,
        ...listener.pid === undefined ? {} : { pid: listener.pid },
        ...listener.processName === undefined || listener.processName === '' ? {} : { processName: listener.processName },
        state: 'LISTENING',
        evidence: [evidence('PROCESS_TABLE', 'verified', `${listener.processName ?? 'pid ' + String(listener.pid)} listening ${listener.address}:${listener.port}`)],
      }
}

export function endpointFromConfig(config: ProxyConfiguration, listeners: readonly ListenerInspection[]): ProxyEndpoint | undefined {
  if (config.host === undefined || config.port === undefined) return undefined
  const listener = findListener(listeners, config.host, config.port)
  // Canonicalize to the Windows-side listener address when one exists so the
  // same proxy service shared by DSH (172.28.96.1:7890) and the browser
  // (127.0.0.1:7890) compares as one endpoint.
  const canonicalHost = listener?.state === 'LISTENING' && listener.address !== '0.0.0.0' && listener.address !== '::'
    ? canonicalProxyHost(listener.address)
    : canonicalProxyHost(config.host)
  return {
    id: `proxy:${canonicalHost}:${config.port}`,
    host: canonicalHost,
    port: config.port,
    scheme: config.scheme ?? 'unknown',
    state: 'CONFIGURED',
    configurationIds: [config.id],
    ...listener === undefined ? {} : { listener },
    reachableFrom: [],
    evidence: [evidence('PROCESS_ENV', 'verified', `configured ${config.displayValue}`)],
  }
}

export function proxyProbeFor(endpoint: ProxyEndpoint, probes: readonly LayeredProbe[], scope: 'dsh' | 'windows-reference' | 'wsl' = 'dsh'): LayeredProbe | undefined {
  return probes.find(probe => {
    const tcp = probe.layers.tcp
    if (tcp === undefined) return false
    const details = tcp.details as { host?: unknown; port?: unknown; proxy?: unknown } | undefined
    if (details?.host === endpoint.host && details?.port === endpoint.port) return true
    if (details?.proxy !== undefined && String(details.proxy).includes(`${endpoint.host}:${endpoint.port}`)) return true
    return false
  })
}

export function directProbeFor(target: NetworkTarget, probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  return probes.find(probe => probe.path === 'direct' && probe.target.id === target.id)
    ?? probes.find(probe => probe.path === 'direct' && probe.target.host === target.host)
}

export function statusOfCheck(check: ProbeCheck | undefined): PathStatus {
  if (check === undefined) return 'unknown'
  if (check.status === 'healthy') return 'healthy'
  if (check.status === 'warning') return 'warning'
  if (check.status === 'error') return 'error'
  if (check.status === 'unknown') return 'unknown'
  if (check.status === 'not-applicable') return 'not-applicable'
  return 'unknown'
}

/** Path status from endpoint probe chain. */
export function endpointStatusFromProbe(probe: LayeredProbe | undefined): ProxyEndpoint['state'] {
  if (probe === undefined) return 'UNKNOWN'
  const tcp = statusOfCheck(probe.layers.tcp)
  const http = statusOfCheck(probe.layers.http)
  if (tcp === 'error') return 'UNREACHABLE'
  if (tcp !== 'healthy') return 'UNKNOWN'
  if (http === 'error' || http === 'warning') return 'UNUSABLE'
  if (http === 'healthy') return 'USABLE'
  return 'REACHABLE'
}

export function pathStatusOfProbe(probe: LayeredProbe | undefined): PathStatus {
  if (probe === undefined) return 'unknown'
  const layers = ['dns', 'tcp', 'tls', 'http'] as const
  const statuses = layers.map(layer => statusOfCheck(probe.layers[layer])).filter(status => status !== 'not-applicable')
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('warning')) return 'warning'
  if (statuses.includes('healthy')) return 'healthy'
  return 'unknown'
}

/** DNS side-branch from a probe. DNS never becomes a main-lane node. */
export function dnsBranchFromProbe(probe: LayeredProbe | undefined, target: NetworkTarget, id: string, delegated: boolean): DnsBranch {
  const check = probe?.layers.dns
  const addresses = Array.isArray(check?.details?.['addresses']) ? check.details['addresses'] as string[] : []
  return {
    id,
    host: target.host,
    resolvedAddresses: addresses,
    status: delegated ? 'not-applicable' : statusOfCheck(check),
    resolution: delegated ? 'DELEGATED_TO_PROXY' : 'LOCAL',
    evidence: [
      delegated
        ? evidence('PROCESS_ENV', 'verified', 'HTTP 代理路径由代理侧解析 DNS')
        : evidence('DNS_PROBE', check?.status === 'healthy' ? 'verified' : 'inferred', check?.humanMessage ?? 'DNS probe', check?.details?.target === undefined ? undefined : String(check.details.target)),
    ],
  }
}

export function selectActiveAdapter(network: WindowsNetworkInspection): WindowsInterface | undefined {
  const routes = [...network.defaultRoutes].sort((left, right) => (left.metric ?? 9999) - (right.metric ?? 9999))
  for (const route of routes) {
    const adapter = network.interfaces.find(item => item.status === 'up' && matchesInterfaceIndex(item, route.interfaceIndex))
    if (adapter !== undefined) return adapter
  }
  return network.interfaces.find(item => item.status === 'up' && !item.virtual && item.gateways.length > 0)
    ?? network.interfaces.find(item => item.status === 'up' && item.ipv4.length > 0)
}

const NON_PHYSICAL_KINDS: ReadonlySet<string> = new Set([
  'vpn', 'tailscale', 'vmware', 'virtualbox', 'hyper-v', 'docker', 'wsl', 'bluetooth',
])

/**
 * Physical uplink NIC behind the egress adapter. A TUN/VPN adapter owning the
 * default route (e.g. BoostNet TUN 198.18.0.1) shadows the machine's real NIC
 * (Wi-Fi/Ethernet); the graph shows both hops instead of presenting the TUN's
 * virtual addresses as the whole story.
 */
export function selectUplinkAdapter(network: WindowsNetworkInspection): WindowsInterface | undefined {
  const physical = network.interfaces.filter(item =>
    item.status === 'up' && !item.virtual && !NON_PHYSICAL_KINDS.has(item.kind) && item.ipv4.length > 0)
  const routes = [...network.defaultRoutes].sort((left, right) => (left.metric ?? 9999) - (right.metric ?? 9999))
  for (const route of routes) {
    const adapter = physical.find(item => matchesInterfaceIndex(item, route.interfaceIndex))
    if (adapter !== undefined) return adapter
  }
  return physical.find(item => item.gateways.length > 0) ?? physical[0]
}

/** True when both entries describe the same adapter (index preferred). */
export function sameAdapter(left: WindowsInterface | undefined, right: WindowsInterface | undefined): boolean {
  if (left === undefined || right === undefined) return false
  if (left.interfaceIndex !== undefined && right.interfaceIndex !== undefined) return left.interfaceIndex === right.interfaceIndex
  return left.name === right.name
}

function matchesInterfaceIndex(adapter: WindowsInterface, interfaceIndex: number): boolean {
  if (adapter.interfaceIndex !== undefined) return adapter.interfaceIndex === interfaceIndex
  return interfaceIndex === 0 || adapter.ipv4.length > 0
}

export function gatewayOf(adapter: WindowsInterface | undefined): string | undefined {
  return adapter?.gateways[0]
}

export function interfaceLabel(adapter: WindowsInterface | undefined): string {
  if (adapter === undefined) return 'Windows 网络接口'
  if (adapter.kind === 'wi-fi') return 'Wi-Fi'
  if (adapter.kind === 'ethernet') return '以太网'
  return adapter.name || adapter.description
}

export function interfaceIpv4(adapter: WindowsInterface | undefined): string | undefined {
  return adapter?.ipv4[0]
}
