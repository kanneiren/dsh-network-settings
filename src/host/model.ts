/**
 * Network Core shared data model (Phase 1: read-only surface).
 * Kept dependency-free so parsers, probes and diagnostics all consume the same
 * JSON-safe shapes. UI never imports these types as runtime values.
 */

export type NetworkStatus =
  | 'healthy'
  | 'warning'
  | 'error'
  | 'unknown'
  | 'not-tested'
  | 'not-applicable'
  | 'permission-required'

export type ProbePath = 'direct' | 'proxy' | 'system'

export type ProbeLayer = 'dns' | 'tcp' | 'tls' | 'http'

export interface ProbeCheck {
  status: NetworkStatus
  latencyMs?: number
  errorCode?: string
  humanMessage: string
  technicalMessage?: string
  source?: string
  timestamp: string
  details?: Record<string, unknown>
}

export interface LayeredProbe {
  target: ProbeTarget
  path: ProbePath
  layers: Partial<Record<ProbeLayer, ProbeCheck>>
}

export interface ProbeTarget {
  id: string
  label: string
  host: string
  port?: number
  /** Optional absolute URL for HTTP probes. */
  url?: string
  kind: 'internet' | 'deepseek' | 'openai' | 'github' | 'npm' | 'model-service' | 'windows-host' | 'wsl-proxy' | 'gateway'
}

export type ProxySource =
  | 'wininet.user'
  | 'winhttp.machine'
  | 'winhttp.user'
  | 'env.process'
  | 'env.user'
  | 'env.machine'
  | 'wsl'

export interface ProxyEndpoint {
  source: ProxySource
  /** Credential-free endpoint, e.g. http://127.0.0.1:7890 */
  url: string
  host: string
  port: number
  protocol: 'http' | 'socks' | 'socks5' | 'unknown'
  configured: boolean
  reachable?: boolean
  usable?: boolean
  listener?: {
    pid: number
    processName: string
  }
}

export interface EnvironmentScopeSnapshot {
  HTTP_PROXY?: string
  HTTPS_PROXY?: string
  ALL_PROXY?: string
  NO_PROXY?: string
  http_proxy?: string
  https_proxy?: string
  all_proxy?: string
  no_proxy?: string
}

export type EnvironmentScopeName = 'process' | 'user' | 'machine' | 'dsh'

export interface EnvironmentInspection {
  scopes: Record<EnvironmentScopeName, EnvironmentScopeSnapshot>
}

export type WslDistributionState = 'running' | 'stopped' | 'unknown'

export interface WslCapabilities {
  proc: boolean
  osRelease: boolean
  resolvConf: boolean
  wslConf: boolean
  commands: {
    sh: boolean
    cat: boolean
    ip: boolean
    getent: boolean
    curl: boolean
    wget: boolean
    python3: boolean
    python: boolean
  }
}

export interface WslOsMetadata {
  prettyName?: string
  id?: string
  versionId?: string
  versionCodename?: string
}

export interface WslNetworkConfig {
  mode: string
  modeConfigured: boolean
  modeSupported: boolean
  dnsTunneling?: boolean
  autoProxy?: boolean
  dnsProxy?: boolean
  localhostForwarding?: boolean
  firewall?: boolean
  ignoredPorts?: string[]
  hostAddressLoopback?: boolean
  initialAutoProxyTimeoutMs?: number
}

export interface WslDistribution {
  name: string
  state: WslDistributionState
  wslVersion?: 1 | 2
  default: boolean
  osMetadata?: WslOsMetadata
  capabilities?: WslCapabilities
  network?: WslNetworkInspection
}

export interface WslLinuxInterface {
  name: string
  ipv4: string[]
  ipv6: string[]
}

export interface WslNetworkInspection {
  hostCandidates: HostCandidate[]
  resolvConf?: string[]
  defaultRoute?: string
  interfaces?: WslLinuxInterface[]
  environment?: EnvironmentScopeSnapshot
  wslConf?: {
    network?: { generateResolvConf?: boolean; generateHosts?: boolean; hostname?: string }
    boot?: { systemd?: boolean }
    interop?: { enabled?: boolean; appendWindowsPath?: boolean }
  }
  generatedBy?: 'quiet-running' | 'verbose' | 'registry' | 'local-facts' | 'unknown'
}

export interface HostCandidate {
  address: string
  source: 'wsl-config-mirrored' | 'wsl1' | 'default-route' | 'resolv-conf' | 'fallback'
  confidence: number
}

export interface WindowsInterface {
  name: string
  description: string
  status: 'up' | 'down' | 'unknown'
  virtual: boolean
  interfaceIndex?: number
  mac?: string
  kind: 'wi-fi' | 'ethernet' | 'wsl' | 'hyper-v' | 'docker' | 'vpn' | 'tailscale' | 'vmware' | 'virtualbox' | 'bluetooth' | 'other'
  ipv4: string[]
  ipv6: string[]
  gateways: string[]
  dns: string[]
  dhcp?: boolean
}

export interface WindowsNetworkInspection {
  interfaces: WindowsInterface[]
  defaultRoutes: { family: 4 | 6; destination: string; nextHop: string; interfaceIndex: number; metric?: number }[]
  /** True when Windows answered an ICMP echo from the active default gateway. */
  gatewayPing?: boolean
  /** Get-NetNeighbor State for the active default gateway, e.g. Reachable. */
  gatewayNeighborState?: string
}

export interface WinInetProxyInspection {
  enabled: boolean
  proxyServer?: string
  proxyOverride?: string
  autoDetect: boolean
  autoConfigUrl?: string
}

export interface WinHttpProxyInspection {
  scope: 'machine' | 'user'
  proxyEnabled: boolean
  proxy?: string
  proxyBypass?: string
  autoConfigEnabled: boolean
  autoConfigUrl?: string
  autoDetect: boolean
  perUserProxySettings?: boolean
  raw?: string
}

export interface ProxyInspection {
  wininet: WinInetProxyInspection
  winhttp: WinHttpProxyInspection[]
  endpoints: ProxyEndpoint[]
}

export interface HostsOverride {
  ip: string
  hostnames: string[]
  raw: string
}

export interface HostsInspection {
  overrides: HostsOverride[]
}

export interface ModelServiceTarget {
  provider: string
  displayName: string
  active: boolean
  settingsNs?: string
  baseURL?: string
  baseURLSource?: 'settings' | 'environment' | 'unknown'
}

export interface ListenerInspection {
  address: string
  port: number
  pid: number
  processName?: string
}

export interface WindowsInspection {
  os?: { caption: string; version: string; build: string; architecture: string }
  network: WindowsNetworkInspection
  proxy: ProxyInspection
  environment: EnvironmentInspection
  hosts: HostsInspection
  listeners: ListenerInspection[]
  dshProcessEnvironment: EnvironmentScopeSnapshot
  modelServices: ModelServiceTarget[]
  rawErrors: ProbeCheck[]
}

export interface WslInspection {
  available: boolean
  version?: string
  kernelVersion?: string
  windowsVersion?: string
  defaultDistribution?: string
  defaultVersion?: 1 | 2
  globalConfig?: WslNetworkConfig
  distributions: WslDistribution[]
  rawErrors: ProbeCheck[]
}

export interface NetworkInspection {
  runtime: { platform: NodeJS.Platform; version: string; dshHome?: string }
  windows: WindowsInspection
  wsl?: WslInspection
  probes: LayeredProbe[]
  timestamp: string
}

export function statusOf(latencyMs?: number, error?: string): NetworkStatus {
  if (error !== undefined && error !== '') return 'error'
  if (latencyMs !== undefined) return 'healthy'
  return 'not-tested'
}
