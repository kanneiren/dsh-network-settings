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
  kind: string
  ipv4: string[]
  ipv6: string[]
  gateways: string[]
  dns: string[]
}

export interface WindowsNetworkInspection {
  interfaces: WindowsInterface[]
  defaultRoutes: { family: 4 | 6; destination: string; nextHop: string; interfaceIndex: number; metric?: number }[]
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
  listener?: { pid: number; processName: string }
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
  dshProcessEnvironment: EnvironmentScopeSnapshot
  modelServices: { provider: string; displayName: string; active: boolean; baseURL?: string }[]
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
  windows: WindowsInspection
  wsl?: WslInspection
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
  timestamp: string
}

export interface StatusResult {
  status: 'not-tested' | 'ready'
  cached: boolean
  timestamp: string
  diagnosis?: DiagnosisReport
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
