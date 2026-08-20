/**
 * dsh-network-settings host half.
 *
 * Registers the `/dsh-network-settings` Connection RPC channel with loopback
 * authority. All command execution stays behind this boundary; the client half
 * never executes platform commands.
 */
import type { ModelServiceTarget, NetworkInspection, ProbeTarget } from './model.ts'
import type { DiagnosisReport } from './diagnose/rules.ts'
import { readJson, writeJson } from './runtime/store.ts'
import { applyConfigure, previewConfigure, type ConfigureRequest } from './configure/index.ts'
import { listSnapshots } from './snapshot/store.ts'
import { actionToConfigureRequest, applyRepairOperation, previewRepairOperation, rollbackLatest, rollbackScope } from './repair/index.ts'
import { diagnosisActionOperations, isRecommendableOperation, RECOMMEND_CONFIDENCE_THRESHOLD, repairCatalog } from './repair/catalog.ts'
import { advancedCatalog, recentAdvancedActionIds, runAdvancedAction } from './repair/advanced.ts'
import { applyWslProxySource, previewWslProxySource } from './repair/wsl-proxy.ts'
import { inspectWslProxySources, type WslProxySource } from './wsl/sources.ts'
import { deleteHostsEntry, previewHostsDelete, readHostsEntries, type HostsEntry } from './repair/hosts.ts'
import type { Diagnosis, DiagnosisAction } from './diagnose/model.ts'
import type { SnapshotScope } from './snapshot/store.ts'
import { applyDshProxyConfig, readDshConfig } from './configure/dsh.ts'
import { openConfigLocation, openWindowsProxySettings } from './configure/open.ts'
import { redact } from './redact.ts'
import { collectModelServiceTargets } from './dsh/model-services.ts'
import { buildNetworkReport, buildTargets, type NetworkPathSummary } from './network/index.ts'
import { windowsOf } from './model.ts'
import type { NetworkTarget, NetworkPathGraph } from './network/types.ts'

export const name = 'dsh-network-settings'
export const inject = ['connection', 'settings', 'llm'] as const

const CHANNEL = '/dsh-network-settings'
const LAST_REPORT_FILE = 'last-report.json'

interface CachedReport {
  inspection: NetworkInspection
  diagnosis: DiagnosisReport
  graph?: NetworkPathGraph
  summary?: NetworkPathSummary
  targets?: NetworkTarget[]
  timestamp: string
}

let lastInspection: NetworkInspection | undefined
let lastModelServices: ModelServiceTarget[] | undefined

interface HostContext {
  connection: {
    rpc: {
      handle(
        channel: string,
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string; details: object } }>,
        options: { authority: 'loopback' | 'trusted-host' },
      ): () => Promise<void>
    }
  }
  settings: Parameters<typeof collectModelServiceTargets>[0]
  llm: Parameters<typeof collectModelServiceTargets>[1]
  effect(thunk: () => unknown, label?: string): void
}

function ok(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

function fail(error: unknown): { ok: false; error: { code: string; message: string; details: object } } {
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

function asObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

export function apply(ctx: HostContext): void {
  void readDshConfig().then(config => {
    applyDshProxyConfig(config.proxy)
  })
  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    try {
      switch (endpoint) {
        case 'status': {
          const cached = await readJson<CachedReport>(LAST_REPORT_FILE)
          // Targets are always returned so the target switcher is usable
          // before the first check runs.
          const fallbackTargets = buildTargets(collectModelServiceTargets(ctx.settings, ctx.llm)).targets
          return ok(cached === undefined
            ? { status: 'not-tested', cached: false, timestamp: new Date().toISOString(), targets: fallbackTargets }
            : { status: 'ready', cached: true, timestamp: cached.timestamp, diagnosis: cached.diagnosis, summary: cached.summary, targets: cached.targets ?? fallbackTargets })
        }
        case 'run': {
          const options = asObject(payload)
          const requestSignal = signal
          const modelServices = collectModelServiceTargets(ctx.settings, ctx.llm)
          const { selected } = buildTargets(modelServices, typeof options['targetId'] === 'string' ? options['targetId'] : undefined)
          const selectedProbe: ProbeTarget = {
            id: selected.id,
            label: selected.label,
            host: selected.host,
            ...selected.port === undefined ? {} : { port: selected.port },
            ...selected.url === undefined ? {} : { url: selected.url },
            kind: selected.kind === 'npm-registry' ? 'npm' : selected.kind === 'custom' ? 'internet' : selected.kind,
          }
          const reuse = lastInspection !== undefined && lastModelServices !== undefined && lastInspection.windows !== undefined && lastInspection.windows.rawErrors.length === 0
            ? lastInspection
            : undefined
          const inspection = await inspectNetworkSafe(ctx, {
            signal: requestSignal,
            ...options['includeWsl'] === false ? { includeWsl: false } : {},
            targets: [selectedProbe],
            modelServices,
            probePlan: options['probeMode'] === 'multi' ? 'multi' : 'single',
            ...reuse === undefined ? {} : { reuse },
          })
          lastInspection = inspection
          lastModelServices = modelServices
          const networkReport = await buildNetworkReport({
            inspection,
            modelServices,
            targetId: selected.id,
          })
          const diagnosis = await diagnoseFrom(inspection, networkReport.graph)
          const cached: CachedReport = {
            inspection,
            diagnosis,
            ...networkReport.graph === undefined ? {} : { graph: networkReport.graph },
            summary: networkReport.summary,
            targets: networkReport.targets,
            timestamp: new Date().toISOString(),
          }
          await writeJson(LAST_REPORT_FILE, redact(cached))
          const response = redact({
            inspection,
            diagnosis,
            timestamp: cached.timestamp,
            summary: networkReport.summary,
            targets: networkReport.targets,
            ...networkReport.graph === undefined ? {} : { graph: networkReport.graph },
          })
          return ok(response)
        }
        case 'configure/preview':
          return ok(await previewConfigure(payload as ConfigureRequest))
        case 'configure/apply':
          return ok(await applyConfigure(payload as ConfigureRequest))
        case 'snapshot/list':
          return ok({ snapshots: await listSnapshots() })
        case 'repair/catalog':
          return ok({ operations: repairCatalog() })
        case 'repair/recommended': {
          const body = asObject(payload)
          // Full diagnoses carry the confidence needed for the recommendation
          // gate; the bare `actions` form is kept for older callers.
          const diagnoses = Array.isArray(body['diagnoses']) ? body['diagnoses'] as Diagnosis[] : []
          const actions = Array.isArray(body['actions']) ? body['actions'] as DiagnosisAction[] : []
          const sources: Array<{ confidence: number; actions: DiagnosisAction[] }> = diagnoses.length > 0
            ? diagnoses.map(item => ({ confidence: item.confidence, actions: item.actions }))
            : actions.map(action => ({ confidence: 1, actions: [action] }))
          const seenOperations = new Set<string>()
          const recentlyApplied = await recentAdvancedActionIds()
          const recommendations = []
          for (const source of sources) {
            if (source.confidence < RECOMMEND_CONFIDENCE_THRESHOLD) continue
            const operations = source.actions
              .flatMap(action => diagnosisActionOperations(action))
              .filter(operation => isRecommendableOperation(operation.id))
              .filter(operation => {
                if (seenOperations.has(operation.id)) return false
                seenOperations.add(operation.id)
                return true
              })
            if (operations.length === 0 || source.actions.length === 0) continue
            recommendations.push({ action: source.actions[0]!, operations })
          }
          return ok({
            recentlyAppliedIds: [...recentlyApplied],
            recommendations,
          })
        }
        case 'repair/preview': {
          const body = asObject(payload)
          const operationId = body['operationId']
          if (typeof operationId === 'string') return ok(await previewRepairOperation(operationId))
          const action = body['action'] as DiagnosisAction
          const request = actionToConfigureRequest(action)
          if (request === undefined) return ok({ supported: false })
          return ok({ supported: true, preview: await previewConfigure(request) })
        }
        case 'repair/apply': {
          const body = asObject(payload)
          const operationId = body['operationId']
          if (typeof operationId === 'string') return ok(await applyRepairOperation(operationId))
          const action = body['action'] as DiagnosisAction
          const request = actionToConfigureRequest(action)
          if (request === undefined) throw new Error(`暂不支持自动修复：${action?.code ?? 'unknown'}`)
          return ok({ supported: true, result: await applyConfigure(request) })
        }
        case 'repair/rollback': {
          const body = asObject(payload)
          if (body['scope'] === undefined) return ok(await rollbackLatest())
          return ok(await rollbackScope(body['scope'] as SnapshotScope))
        }
        case 'wsl/proxy-sources': {
          const body = asObject(payload)
          const distribution = body['distribution']
          if (typeof distribution !== 'string') throw new Error('wsl/proxy-sources requires distribution')
          return ok({ sources: await inspectWslProxySources(distribution, { signal }) })
        }
        case 'wsl/proxy-preview':
          return ok(previewWslProxySource(asObject(payload)['source'] as WslProxySource))
        case 'wsl/proxy-apply':
          return ok(await applyWslProxySource(asObject(payload)['source'] as WslProxySource))
        case 'hosts/entries':
          return ok({ entries: await readHostsEntries() })
        case 'hosts/delete-preview':
          return ok(previewHostsDelete(asObject(payload)['entry'] as HostsEntry))
        case 'hosts/delete':
          return ok(await deleteHostsEntry(asObject(payload)['entry'] as HostsEntry))
        case 'config/open-windows-proxy':
          return ok(await openWindowsProxySettings())
        case 'config/open-location': {
          const body = asObject(payload)
          const kind = body['kind']
          if (kind !== 'wslconfig' && kind !== 'wsl-conf' && kind !== 'hosts') throw new Error('unknown config location')
          return ok(await openConfigLocation(kind, typeof body['distribution'] === 'string' ? body['distribution'] : undefined))
        }
        case 'advanced/list':
          return ok({ actions: advancedCatalog() })
        case 'advanced/run': {
          const body = asObject(payload)
          const id = body['id']
          if (typeof id !== 'string') throw new Error('advanced/run requires id')
          return ok(await runAdvancedAction(id, signal))
        }
        default:
          return fail(new Error(`unknown endpoint: ${endpoint}`))
      }
    } catch (error) {
      return fail(error)
    }
  }, { authority: 'loopback' }), `dsh-network-settings: ${CHANNEL} rpc channel`)
}

async function inspectNetworkSafe(
  ctx: HostContext,
  options: { signal?: AbortSignal; includeWsl?: boolean; targets?: readonly ProbeTarget[]; modelServices?: ModelServiceTarget[]; probePlan?: 'single' | 'multi' },
): Promise<NetworkInspection> {
  const { inspectNetwork } = await import('./inspect.ts')
  return inspectNetwork({
    ...options,
    timeoutMs: 60_000,
    modelServices: options.modelServices ?? collectModelServiceTargets(ctx.settings, ctx.llm),
  })
}

async function diagnoseFrom(inspection: NetworkInspection, graph?: NetworkPathGraph): Promise<DiagnosisReport> {
  const { runDiagnosis } = await import('./diagnose/rules.ts')
  const report = await runDiagnosis({
    dsh: inspection.dsh,
    ...inspection.windows === undefined ? {} : { windows: inspection.windows },
    ...inspection.macos === undefined ? {} : { macos: inspection.macos },
    ...inspection.wsl === undefined ? {} : { wsl: inspection.wsl },
    probes: inspection.probes,
    endpoints: windowsOf(inspection).proxy.endpoints,
    ...dshEgressOf(graph) === undefined ? {} : { dshEgress: dshEgressOf(graph) },
  })
  if (graph === undefined) return report
  return mergeGraphDiagnostics(report, graph)
}

/** The proxy endpoint the DSH path actually egresses through, or null when
 *  the graph shows a direct path. undefined when no graph is available. */
function dshEgressOf(graph: NetworkPathGraph | undefined): { host: string; port: number } | null | undefined {
  if (graph === undefined) return undefined
  const egress = graph.dshPath.egress
  if (egress.mode !== 'PROXY') return null
  const host = egress.proxyEndpoint?.host ?? egress.proxyConfiguration?.host
  const port = egress.proxyEndpoint?.port ?? egress.proxyConfiguration?.port
  return host === undefined || port === undefined ? null : { host, port }
}

/** Graph/Drift diagnostics are merged into the legacy report so the existing
 * RepairSection snapshot→diff→confirm→apply→re-run→rollback flow keeps working. */
function mergeGraphDiagnostics(report: DiagnosisReport, graph: NetworkPathGraph): DiagnosisReport {
  const driftCodes = new Set(graph.diagnostics.map(item => item.code))
  const base = report.diagnoses.filter(item =>
    !(driftCodes.has('DRIFT_DSH_PROXY_STALE') && item.code === 'STALE_DSH_PROXY_ENV')
    && !(driftCodes.has('DRIFT_WSL_PROXY_STALE')
      && (item.code === 'WSL_PROXY_UNREACHABLE' || item.code === 'WSL_PROXY_LOOPBACK_UNREACHABLE' || item.code === 'WSL_AUTOPROXY_STALE')))
  const merged = [...base]
  for (const item of graph.diagnostics) {
    const scope = item.pathIds[0] === 'dsh' && graph.model === 'WSL_DISTRIBUTION' ? 'wsl' : item.pathIds[0] === 'dsh' ? 'dsh' : 'proxy'
    merged.push({
      code: item.code,
      severity: item.severity,
      confidence: item.confidence,
      scope,
      humanMessage: item.humanMessage,
      technicalMessage: item.technicalMessage,
      evidence: item.evidence.map(entry => ({
        ref: `${entry.source}${entry.ref === undefined ? '' : `:${entry.ref}`}`,
        message: entry.value ?? entry.source,
        status: item.severity === 'error' ? 'error' as const : item.severity === 'warning' ? 'warning' as const : 'unknown' as const,
      })),
      actions: item.actions.map(action => ({ ...action })),
    })
  }
  const worst = merged.some(item => item.severity === 'error') ? 'error' as const
    : merged.some(item => item.severity === 'warning') ? 'warning' as const
    : merged.some(item => item.severity === 'info') ? 'info' as const
    : report.worst
  return { diagnoses: merged, worst, problemCount: merged.filter(item => item.severity === 'error').length }
}
