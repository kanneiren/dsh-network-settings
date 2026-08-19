/**
 * Network Core structured graph model.
 *
 * This is a JSON-safe, dependency-free contract shared by the host graph
 * builder, diagnostics and the client renderer. The graph describes two
 * first-class network models (WINDOWS_NATIVE / WSL_DISTRIBUTION) and two
 * comparable paths (DSH / Windows browser). Proxy configuration, endpoint and
 * listener are intentionally separate concepts.
 */
import type { LayeredProbe } from '../model.ts'

export type RuntimeModel = 'WINDOWS_NATIVE' | 'WSL_DISTRIBUTION' | 'UNSUPPORTED_RUNTIME'
export type SupportedRuntimeModel = 'WINDOWS_NATIVE' | 'WSL_DISTRIBUTION'
export type PathConfidence = 'verified' | 'inferred' | 'unknown'
export type PathStatus = 'healthy' | 'warning' | 'error' | 'unknown' | 'not-applicable'
export type PathNodeRole = 'main' | 'auxiliary'

export type PathNodeType =
  | 'PROCESS' | 'DISTRIBUTION' | 'NETWORK_LAYER' | 'HOST' | 'PROXY'
  | 'INTERFACE' | 'GATEWAY' | 'INTERNET' | 'TARGET'
  | 'DNS' | 'NAT' | 'ENVIRONMENT' | 'ROUTE'

export type EvidenceSource =
  | 'PROCESS_ENV' | 'WINDOWS_API' | 'WINDOWS_PROXY' | 'WINHTTP'
  | 'WSL_ROUTE' | 'WSL_CONFIG' | 'DNS_PROBE' | 'TCP_PROBE'
  | 'TLS_PROBE' | 'HTTP_PROBE' | 'PROCESS_TABLE'
  | 'BROWSER_POLICY' | 'BROWSER_COMMAND_LINE' | 'BROWSER_SETTINGS'
  | 'OS_RELEASE' | 'PROC_VERSION' | 'WSL_LIST' | 'WINDOWS_ROUTE'
  | 'DSH_SETTINGS' | 'DRIFT_RULE'

export interface Evidence {
  source: EvidenceSource
  confidence: 'verified' | 'inferred'
  /** Already redacted. Never contains credentials. */
  value?: string
  /** Machine-readable reference, e.g. probe:github:tcp. */
  ref?: string
}

export interface DetailField {
  label: string
  value: string
  evidence?: Evidence[]
}

export interface PathNode {
  id: string
  type: PathNodeType
  role: PathNodeRole
  label: string
  subtitle?: string
  status: PathStatus
  address?: string
  port?: number
  details?: DetailField[]
  evidence?: Evidence[]
}

export type PathEdgeRelation =
  | 'DIRECT' | 'PROXY' | 'ROUTE' | 'NAT' | 'MIRRORED'
  | 'HOST_BRIDGE' | 'TARGET_CONNECTION'
  | 'WSL1' | 'VIRTIOPROXY'

export interface PathEdge {
  from: string
  to: string
  relation: PathEdgeRelation
  status: PathStatus
  label?: string
  evidence?: Evidence[]
}

export interface NetworkTarget {
  id: string
  label: string
  host: string
  port?: number
  url?: string
  kind: 'model-service' | 'deepseek' | 'openai' | 'github' | 'npm-registry' | 'custom'
  display: string
}

export interface WindowsNativeRuntime {
  type: 'WINDOWS_NATIVE'
  platform: 'win32'
  nodeVersion: string
  os?: { caption: string; version: string; build: string; architecture: string }
  confidence: PathConfidence
}

export type WslNetworkLayerMode =
  | 'WSL1' | 'NAT' | 'MIRRORED' | 'BRIDGED' | 'NONE' | 'VIRTIOPROXY' | 'UNKNOWN'

export interface WslLinuxMetadata {
  id?: string
  prettyName?: string
  versionId?: string
  versionCodename?: string
  kernelRelease: string
}

export interface WslDistributionRuntime {
  type: 'WSL_DISTRIBUTION'
  confidence: PathConfidence
  /** WSL_DISTRO_NAME, never derived from /etc/os-release ID. */
  registeredName?: string
  /** PRETTY_NAME, fallback ID, fallback registered name. */
  displayName: string
  linux: WslLinuxMetadata
  wslVersion?: 1 | 2
  networkLayer: {
    mode: WslNetworkLayerMode
    modeConfigured: boolean
    dnsTunneling?: boolean
    autoProxy?: boolean
  }
  interopAvailable: boolean
}

export interface UnsupportedRuntime {
  type: 'UNSUPPORTED_RUNTIME'
  platform: string
  reason: 'LINUX_NOT_WSL' | 'LINUX_CONTAINER_ON_WSL' | 'UNKNOWN_PLATFORM'
  humanMessage: string
}

export type DetectedRuntime =
  | WindowsNativeRuntime
  | WslDistributionRuntime
  | UnsupportedRuntime

export type ProxyConfigMode =
  | 'DIRECT' | 'SYSTEM' | 'AUTO_DETECT' | 'FIXED_SERVERS' | 'PAC_SCRIPT' | 'UNKNOWN'

export type ProxyConfigSourceKey =
  | 'DSH_PROCESS_ENV' | 'WINDOWS_USER_ENV' | 'WINDOWS_MACHINE_ENV'
  | 'WININET_USER' | 'WINHTTP_USER' | 'WINHTTP_MACHINE'
  | 'WSL_ENV' | 'WSL_AUTOPROXY'
  | 'BROWSER_POLICY' | 'BROWSER_COMMAND_LINE' | 'BROWSER_SETTINGS'

export type ProxyScheme = 'http' | 'https' | 'socks' | 'socks4' | 'socks5' | 'unknown'

export interface ProxyConfiguration {
  id: string
  source: string
  sourceKey: ProxyConfigSourceKey
  mode: ProxyConfigMode
  displayValue: string
  scheme?: ProxyScheme
  host?: string
  port?: number
  bypass?: string[]
  pacUrl?: string
  pacMandatory?: boolean
  evidence: Evidence[]
}

export type ProxyEndpointState =
  | 'CONFIGURED' | 'REACHABLE' | 'USABLE' | 'UNREACHABLE' | 'UNUSABLE' | 'UNKNOWN'

export interface ProxyListener {
  address: string
  port: number
  pid?: number
  processName?: string
  state: 'LISTENING' | 'NOT_FOUND' | 'UNKNOWN'
  evidence: Evidence[]
}

export interface ProxyEndpoint {
  /** Canonical Windows-side key: proxy:127.0.0.1:7890 */
  id: string
  host: string
  port: number
  scheme: ProxyScheme
  state: ProxyEndpointState
  configurationIds: string[]
  listener?: ProxyListener
  reachableFrom: Array<{
    from: 'dsh' | 'wsl' | 'windows-reference'
    viaAddress?: string
    state: 'REACHABLE' | 'UNREACHABLE' | 'UNKNOWN'
    evidence: Evidence[]
  }>
  evidence: Evidence[]
}

export interface DnsBranch {
  id: string
  host: string
  resolvedAddresses: string[]
  status: PathStatus
  resolution: 'LOCAL' | 'DELEGATED_TO_PROXY' | 'UNKNOWN'
  evidence: Evidence[]
}

export interface NetworkPath {
  id: 'dsh'
  label: string
  status: PathStatus
  egress: {
    mode: 'DIRECT' | 'PROXY' | 'PAC' | 'UNKNOWN'
    proxyConfiguration?: ProxyConfiguration
    proxyEndpoint?: ProxyEndpoint
  }
  nodes: PathNode[]
  edges: PathEdge[]
  dns: DnsBranch[]
  firstFailingEdgeId?: string
  probe?: LayeredProbe
}

export interface NetworkDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  confidence: number
  pathIds: Array<'dsh'>
  humanMessage: string
  technicalMessage: string
  evidence: Evidence[]
  actions: Array<{ code: string; scope: string; label: string; safe: boolean }>
  firstFailingEdge?: { edgeId: string; from: string; to: string }
}

export interface NetworkPathGraph {
  model: SupportedRuntimeModel
  runtime: Exclude<DetectedRuntime, UnsupportedRuntime>
  target: NetworkTarget
  dshPath: NetworkPath
  diagnostics: NetworkDiagnostic[]
  recommendedRepair?: {
    diagnosisCode: string
    actionCodes: string[]
    label: string
  }
  generatedAt: string
}

export interface NetworkPathSummary {
  model: RuntimeModel
  target: NetworkTarget
  dsh: { status: PathStatus; label: string }
  problemCount: number
}

/** Status precedence used by builders and diagnostics. */


