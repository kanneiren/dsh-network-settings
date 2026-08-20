/** Client-side wire contract for the /dsh-network-settings RPC channel. */

export type NetworkStatus =
  | 'healthy'
  | 'warning'
  | 'error'
  | 'unknown'
  | 'not-tested'
  | 'not-applicable'
  | 'permission-required'

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

export interface ProbeTarget {
  id: string
  label: string
  host: string
  port?: number
  kind: string
}

export interface LayeredProbe {
  target: ProbeTarget
  path: 'direct' | 'proxy' | 'system'
  layers: Partial<Record<'dns' | 'tcp' | 'tls' | 'http', ProbeCheck>>
}

export interface WindowsInterface {
  name: string
  description: string
  status: 'up' | 'down' | 'unknown'
  virtual: boolean
  interfaceIndex?: number
  kind: string
  ipv4: string[]
  ipv6: string[]
  gateways: string[]
  dns: string[]
}

export interface WindowsNetworkInspection {
  interfaces: WindowsInterface[]
  defaultRoutes: { family: 4 | 6; destination: string; nextHop: string; interfaceIndex: number; metric?: number }[]
  gatewayPing?: boolean
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
}

export interface ProxyEndpoint {
  source: string
  url: string
  host: string
  port: number
  protocol: string
  configured: boolean
  /** Endpoint state as probed by the graph builder (USABLE/UNREACHABLE/…). */
  state?: string
  listener?: { pid: number; processName: string; state?: string }
}

export interface ModelServiceTarget {
  provider: string
  displayName: string
  active?: boolean
  settingsNs?: string
  baseURL?: string
  baseURLSource?: string
}

export interface EnvironmentScopeSnapshot {
  [name: string]: string | undefined
}

export interface WindowsInspection {
  os?: { caption: string; version: string; build: string; architecture: string }
  network: WindowsNetworkInspection
  proxy: { wininet: WinInetProxyInspection; winhttp: WinHttpProxyInspection[]; endpoints: ProxyEndpoint[] }
  environment: { scopes: Record<'process' | 'user' | 'machine' | 'dsh', EnvironmentScopeSnapshot> }
  hosts: { overrides: { ip: string; hostnames: string[]; raw: string }[] }
  listeners: { address: string; port: number; pid: number; processName?: string }[]
}

export interface WslDistribution {
  name: string
  state: 'running' | 'stopped' | 'unknown'
  wslVersion?: 1 | 2
  default: boolean
  osMetadata?: { prettyName?: string; id?: string; versionId?: string }
  capabilities?: { commands: Record<string, boolean> }
  network?: {
    hostCandidates: { address: string; source: string; confidence: number }[]
    environment?: EnvironmentScopeSnapshot
    defaultRoute?: string
    resolvConf?: string[]
    interfaces?: { name: string; ipv4: string[]; ipv6: string[] }[]
    wslConf?: {
      network?: { generateResolvConf?: boolean; generateHosts?: boolean; hostname?: string }
      boot?: { systemd?: boolean }
      interop?: { enabled?: boolean; appendWindowsPath?: boolean }
    }
  }
}

export interface WslInspection {
  available: boolean
  version?: string
  kernelVersion?: string
  defaultDistribution?: string
  globalConfig?: {
    mode: string
    modeConfigured: boolean
    modeSupported: boolean
    dnsTunneling?: boolean
    autoProxy?: boolean
    localhostForwarding?: boolean
  }
  distributions: WslDistribution[]
}

export interface NetworkInspection {
  runtime: { platform: string; version: string; dshHome?: string }
  windows?: WindowsInspection
  wsl?: WslInspection
  dsh: EnvironmentScopeSnapshot
  modelServices: ModelServiceTarget[]
  probes: LayeredProbe[]
  timestamp: string
}

export interface DiagnosisAction {
  code: string
  scope: string
  label: string
  safe: boolean
}

export interface Diagnosis {
  code: string
  severity: 'error' | 'warning' | 'info'
  confidence: number
  scope: string
  humanMessage: string
  technicalMessage: string
  evidence: { ref: string; message: string; status: NetworkStatus }[]
  actions: DiagnosisAction[]
}

export interface DiagnosisReport {
  diagnoses: Diagnosis[]
  worst: 'error' | 'warning' | 'info' | 'healthy'
  problemCount: number
}

export interface RunResult {
  inspection: NetworkInspection
  diagnosis: DiagnosisReport
  graph?: NetworkPathGraph
  summary?: NetworkPathSummary
  targets?: NetworkTarget[]
  timestamp: string
}

export interface StatusResult {
  status: 'not-tested' | 'ready'
  cached: boolean
  timestamp: string
  diagnosis?: DiagnosisReport
  summary?: NetworkPathSummary
  targets?: NetworkTarget[]
}

// ── Structured Network Path Graph (mirrors src/host/network/types.ts) ──

export type PathConfidence = 'verified' | 'inferred' | 'unknown'
export type PathStatus = 'healthy' | 'warning' | 'error' | 'unknown' | 'not-applicable'
export type RuntimeModel = 'WINDOWS_NATIVE' | 'WSL_DISTRIBUTION' | 'UNSUPPORTED_RUNTIME'
export type SupportedRuntimeModel = 'WINDOWS_NATIVE' | 'WSL_DISTRIBUTION'

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
  value?: string
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
  role: 'main' | 'auxiliary'
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
  | 'HOST_BRIDGE' | 'TARGET_CONNECTION' | 'WSL1' | 'VIRTIOPROXY'

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

export interface WslDistributionRuntime {
  type: 'WSL_DISTRIBUTION'
  confidence: PathConfidence
  registeredName?: string
  displayName: string
  linux: { id?: string; prettyName?: string; versionId?: string; versionCodename?: string; kernelRelease: string }
  wslVersion?: 1 | 2
  networkLayer: {
    mode: 'WSL1' | 'NAT' | 'MIRRORED' | 'BRIDGED' | 'NONE' | 'VIRTIOPROXY' | 'UNKNOWN'
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

export type DetectedRuntime = WindowsNativeRuntime | WslDistributionRuntime | UnsupportedRuntime

export interface ProxyConfiguration {
  id: string
  source: string
  sourceKey: string
  mode: 'DIRECT' | 'SYSTEM' | 'AUTO_DETECT' | 'FIXED_SERVERS' | 'PAC_SCRIPT' | 'UNKNOWN'
  displayValue: string
  scheme?: 'http' | 'https' | 'socks' | 'socks4' | 'socks5' | 'unknown'
  host?: string
  port?: number
  bypass?: string[]
  pacUrl?: string
  pacMandatory?: boolean
  evidence: Evidence[]
}

export interface GraphProxyListener {
  address: string
  port: number
  pid?: number
  processName?: string
  state: 'LISTENING' | 'NOT_FOUND' | 'UNKNOWN'
  evidence: Evidence[]
}

export interface GraphProxyEndpoint {
  id: string
  host: string
  port: number
  scheme: 'http' | 'https' | 'socks' | 'socks4' | 'socks5' | 'unknown'
  state: 'CONFIGURED' | 'REACHABLE' | 'USABLE' | 'UNREACHABLE' | 'UNUSABLE' | 'UNKNOWN'
  configurationIds: string[]
  listener?: GraphProxyListener
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
    proxyEndpoint?: GraphProxyEndpoint
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
  runtime: WindowsNativeRuntime | WslDistributionRuntime
  target: NetworkTarget
  dshPath: NetworkPath
  diagnostics: NetworkDiagnostic[]
  recommendedRepair?: { diagnosisCode: string; actionCodes: string[]; label: string }
  generatedAt: string
}

export interface NetworkPathSummary {
  model: RuntimeModel
  target: NetworkTarget
  dsh: { status: PathStatus; label: string }
  problemCount: number
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

export type ConfigureScope =
  | 'windows.wininet'
  | 'windows.winhttp.user'
  | 'windows.env.user'
  | 'windows.env.machine'
  | 'dsh.process'

export interface ConfigureRequest {
  scope: ConfigureScope
  action: 'set' | 'clear' | 'unset'
  patch?: unknown
  name?: string
  value?: string
}

export interface ConfigurePreview {
  scope: ConfigureScope
  scopeDescription: string
  before: unknown
  after: unknown
  diff: { path: string; before: unknown; after: unknown }[]
  diffText: string[]
  requiresElevation: boolean
}

export interface ConfigureResult extends ConfigurePreview {
  snapshotId: string
  applied: true
}

export interface AdvancedAction {
  id: string
  label: string
  purpose: string
  risk: 'low' | 'medium' | 'high'
  requiresAdmin: boolean
  requiresReboot: boolean
  recoverable: boolean
  command: string
}

export interface RepairOperation {
  id: string
  label: string
  description: string
  scope: string
  risk: 'low' | 'medium' | 'high'
  requiresAdmin: boolean
  requiresReboot: boolean
  recoverable: boolean
  kind: 'configure' | 'advanced'
  request?: ConfigureRequest
  advancedId?: string
}

export interface RepairOperationPreview {
  operation: RepairOperation
  preview?: ConfigurePreview
  advanced?: AdvancedAction
}

export interface RepairRecommendation {
  action: DiagnosisAction
  operations: RepairOperation[]
}

export interface RepairRecommendationsResult {
  recentlyAppliedIds: string[]
  recommendations: RepairRecommendation[]
}

export interface RepairOperationApply {
  operation: RepairOperation
  result?: ConfigureResult
  advanced?: AdvancedRunResult
}

export interface AdvancedRunResult {
  action: AdvancedAction
  executedAt: string
  code: number | null
  stdout: string
  stderr: string
  snapshotId?: string
}

export interface WslProxySource {
  id: string
  distribution: string
  file: string
  line: number
  raw: string
  value: string
  scope: string
}

export interface WslProxyPreview {
  distribution: string
  file: string
  line: number
  raw: string
  scopeDescription: string
  diffText: string[]
}

export interface HostsEntry {
  id: string
  ip: string
  hostnames: string[]
  line: number
  raw: string
}

export interface HostsDeletePreview {
  entry: HostsEntry
  scopeDescription: string
  diffText: string[]
}

export interface HostsDeleteResult extends HostsDeletePreview {
  snapshotId: string
}

export interface WslProxyApplyResult extends WslProxyPreview {
  snapshotId: string
}

export interface SnapshotRecord {
  id: string
  timestamp: string
  reason: string
  scope: string
  before: unknown
  after?: unknown
  reversible: boolean
}
