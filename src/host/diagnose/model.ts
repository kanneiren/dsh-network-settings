/** Deterministic diagnosis model (Phase 2). No LLM, no network calls. */
import type {
  LayeredProbe, NetworkStatus, ProbeCheck, ProxyEndpoint, WindowsInspection, WslInspection,
} from '../model.ts'

export type DiagnosisSeverity = 'error' | 'warning' | 'info'

export type DiagnosisScope =
  | 'windows'
  | 'wsl'
  | 'proxy'
  | 'dns'
  | 'tls'
  | 'model-service'
  | 'dsh'

export interface DiagnosisEvidence {
  /** Stable machine-readable reference into the inspection/report. */
  ref: string
  message: string
  status: NetworkStatus
}

export interface DiagnosisAction {
  /** Stable action code, e.g. `clear-dsh-process-proxy`. */
  code: string
  /** Which scope a future repair would touch. */
  scope: string
  /** Natural-language label for the Settings UI. */
  label: string
  /** Safe by construction: only suggested here, never executed by diagnose. */
  safe: boolean
}

export interface Diagnosis {
  code: string
  severity: DiagnosisSeverity
  confidence: number
  scope: DiagnosisScope
  humanMessage: string
  technicalMessage: string
  evidence: DiagnosisEvidence[]
  actions: DiagnosisAction[]
}

export interface DiagnosisInput {
  windows: WindowsInspection
  wsl?: WslInspection
  probes: LayeredProbe[]
  endpoints: ProxyEndpoint[]
  /**
   * The proxy endpoint the DSH process actually uses for its egress, when the
   * graph is available. `null` means DSH egresses directly without a proxy;
   * `undefined` means unknown (graphless callers keep legacy behavior).
   * Proxy-endpoint rules only fire for the endpoint DSH really uses: a proxy
   * configured in some Windows scope but unused by DSH is not a DSH problem.
   */
  dshEgress?: { host: string; port: number } | null
}

export interface RuleResult {
  code: string
  severity: DiagnosisSeverity
  confidence: number
  scope: DiagnosisScope
  humanMessage: string
  technicalMessage: string
  evidence: DiagnosisEvidence[]
  actions: DiagnosisAction[]
}

export function severityRank(severity: DiagnosisSeverity): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2
}

export function layerCheck(probe: LayeredProbe, layer: 'dns' | 'tcp' | 'tls' | 'http'): ProbeCheck | undefined {
  return probe.layers[layer]
}

export function healthy(check: ProbeCheck | undefined): check is ProbeCheck {
  return check?.status === 'healthy'
}

export function failed(check: ProbeCheck | undefined): check is ProbeCheck {
  return check?.status === 'error'
}

export function proxyForTarget(endpoints: readonly ProxyEndpoint[], targetHost: string): ProxyEndpoint | undefined {
  return endpoints.find(endpoint => endpoint.configured && endpoint.host === targetHost)
}
