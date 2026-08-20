/** Network Core orchestration: runtime → survey → DSH graph → drift → summary. * Module facade: Public surface: buildNetworkReport(), buildTargets(), defaultTarget(). Orchestration: runtime -> survey -> graph -> drift -> summary.
 */
import type { ModelServiceTarget, NetworkInspection } from '../model.ts'
import { buildWindowsNativeDshPath } from './build-windows.ts'
import { buildWslDshPath } from './build-wsl.ts'
import { buildMacDshPath } from './build-mac.ts'
import { detectDrift, withDriftRecommendation } from './drift.ts'
import { collectRuntimeSignals, detectRuntime, finalizeRuntime } from './runtime.ts'
import type { GraphSurvey } from './survey.ts'
import type {
  DetectedRuntime, NetworkDiagnostic, NetworkPathGraph, NetworkPathSummary,
  NetworkTarget, SupportedRuntimeModel,
} from './types.ts'

export * from './types.ts'

export interface BuildGraphOptions {
  inspection: NetworkInspection
  modelServices?: ModelServiceTarget[]
  targetId?: string
}

export interface BuiltNetworkReport {
  graph?: NetworkPathGraph
  summary: NetworkPathSummary
  targets: NetworkTarget[]
  runtime: DetectedRuntime
}

export function collectRuntime(): DetectedRuntime {
  return detectRuntime(collectRuntimeSignals())
}

/** Public reference targets. Users can customize this list, see docs/targets.md. */
export const PUBLIC_TARGETS: readonly NetworkTarget[] = [
  { id: 'deepseek', label: 'DeepSeek', host: 'api.deepseek.com', port: 443, url: 'https://api.deepseek.com', kind: 'deepseek', display: 'api.deepseek.com:443' },
  { id: 'openai', label: 'OpenAI', host: 'api.openai.com', port: 443, url: 'https://api.openai.com', kind: 'openai', display: 'api.openai.com:443' },
  { id: 'github', label: 'GitHub', host: 'github.com', port: 443, url: 'https://github.com', kind: 'github', display: 'github.com:443' },
  { id: 'npm-registry', label: 'npm Registry', host: 'registry.npmjs.org', port: 443, url: 'https://registry.npmjs.org', kind: 'npm-registry', display: 'registry.npmjs.org:443' },
]

export function buildTargets(modelServices: ModelServiceTarget[] | undefined, requestedId?: string): { targets: NetworkTarget[]; selected: NetworkTarget } {
  const targets: NetworkTarget[] = [
    ...modelTargets(modelServices ?? []),
    ...PUBLIC_TARGETS,
  ]
  const selected = targets.find(target => target.id === requestedId) ?? defaultTarget(targets)
  return { targets, selected }
}

export function defaultTarget(targets: readonly NetworkTarget[]): NetworkTarget {
  // DeepSeek is the primary service for DSH users, so it is the default check
  // target; the active model service is a close second when present.
  return targets.find(target => target.kind === 'deepseek')
    ?? targets.find(target => target.kind === 'model-service')
    ?? targets[0]!
}

function modelTargets(models: ModelServiceTarget[]): NetworkTarget[] {
  return models.flatMap(model => {
    if (model.baseURL === undefined) return []
    try {
      const url = new URL(model.baseURL)
      const host = url.hostname
      const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
      return [{
        id: `model:${model.provider}`,
        label: `${model.displayName}（当前模型服务）`,
        host,
        port,
        url: model.baseURL,
        kind: 'model-service' as const,
        display: `${host}:${port}`,
      }]
    } catch {
      return []
    }
  })
}

export function buildNetworkReport(options: BuildGraphOptions): BuiltNetworkReport {
  const detected = finalizeRuntime(detectRuntime(collectRuntimeSignals()), options.inspection.wsl)
  const windows = options.inspection.windows
  const runtime = detected.type === 'WINDOWS_NATIVE' && windows?.os !== undefined
    ? { ...detected, os: windows.os }
    : detected.type === 'MACOS_NATIVE' && options.inspection.macos?.os !== undefined
      ? { ...detected, os: options.inspection.macos.os }
      : detected
  const { targets, selected } = buildTargets(options.inspection.modelServices, options.targetId)
  const summaryBase: NetworkPathSummary = {
    model: runtime.type,
    target: selected,
    dsh: { status: 'unknown', label: 'DSH' },
    problemCount: 0,
  }
  if (runtime.type === 'UNSUPPORTED_RUNTIME') {
    return { runtime, summary: summaryBase, targets }
  }

  const survey: GraphSurvey = { runtime, inspection: options.inspection, target: selected }
  const built = runtime.type === 'WINDOWS_NATIVE' ? buildWindowsNativeDshPath(survey) : runtime.type === 'MACOS_NATIVE' ? buildMacDshPath(survey) : buildWslDshPath(survey)
  const graphBase: NetworkPathGraph = {
    model: runtime.type as SupportedRuntimeModel,
    runtime,
    target: selected,
    dshPath: built.path,
    diagnostics: [],
    generatedAt: new Date().toISOString(),
  }
  const diagnostics = [...detectDrift(graphBase, survey), ...pathFailureDiagnostics(graphBase)]
  const graph = withDriftRecommendation({ ...graphBase, diagnostics }, diagnostics)
  const summary = summarizeGraph(graph, diagnostics)
  return { graph, summary, targets, runtime }
}

export function pathFailureDiagnostics(graph: NetworkPathGraph): NetworkDiagnostic[] {
  const failing = graph.dshPath.edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  if (failing === undefined) return []
  const from = graph.dshPath.nodes.find(node => node.id === failing.from)
  const to = graph.dshPath.nodes.find(node => node.id === failing.to)
  return [{
    code: 'DSH_PATH_FAILED',
    severity: failing.status === 'error' ? 'error' : 'warning',
    confidence: 0.95,
    pathIds: ['dsh'],
    humanMessage: `DSH 链路在 ${from?.label ?? failing.from} → ${to?.label ?? failing.to} 失败。`,
    technicalMessage: failing.label ?? `${failing.from} → ${failing.to}`,
    evidence: failing.evidence ?? [],
    actions: [],
    firstFailingEdge: { edgeId: `${failing.from}->${failing.to}`, from: from?.label ?? failing.from, to: to?.label ?? failing.to },
  }]
}

export function summarizeGraph(graph: NetworkPathGraph, diagnostics: NetworkDiagnostic[] = graph.diagnostics): NetworkPathSummary {
  return {
    model: graph.model,
    target: graph.target,
    dsh: { status: graph.dshPath.status, label: graph.dshPath.label },
    problemCount: diagnostics.filter(item => item.severity === 'error').length,
  }
}
