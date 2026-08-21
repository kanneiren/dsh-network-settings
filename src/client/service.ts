/** Typed API service over DSH Connection's generic RPC channel. */
import type { AdvancedAction, AdvancedRunResult, ConfigurePreview, ConfigureRequest, ConfigureResult, Diagnosis, DiagnosisAction, DiagnosisReport, HostsDeletePreview, HostsDeleteResult, HostsEntry, NetworkInspection, NetworkPathGraph, NetworkPathSummary, NetworkTarget, RepairOperation, RepairOperationApply, RepairOperationPreview, RepairRecommendationsResult, RpcResult, RunResult, SnapshotRecord, StatusResult, WslProxyApplyResult, WslProxyPreview, WslProxySource } from './contract.ts'

const CHANNEL = '/dsh-network-settings'

export interface NetworkServiceSnapshot {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  /** Latest cached report from the host (page-open fast path). */
  cached?: { timestamp: string; diagnosis: DiagnosisReport; summary?: NetworkPathSummary }
  inspection?: NetworkInspection
  diagnosis?: DiagnosisReport
  graph?: NetworkPathGraph
  summary?: NetworkPathSummary
  targets?: NetworkTarget[]
  error?: string
  cancelled?: boolean
}

export interface NetworkService {
  getSnapshot(): NetworkServiceSnapshot
  subscribe(listener: () => void): () => void
  refreshStatus(): Promise<void>
  run(targetId?: string): Promise<void>
  runTarget(targetId: string): Promise<void>
  runStability(targetId?: string): Promise<void>
  runWithPlan(plan: 'single' | 'multi', targetId?: string): Promise<void>
  cancel(): void
  previewConfigure(request: ConfigureRequest): Promise<ConfigurePreview | undefined>
  applyConfigure(request: ConfigureRequest): Promise<ConfigureResult | undefined>
  listSnapshots(): Promise<SnapshotRecord[]>
  repairPreview(action: DiagnosisAction): Promise<RepairPreview | undefined>
  repairApply(action: DiagnosisAction): Promise<RepairApply | undefined>
  rollbackLatest(): Promise<RollbackResult | undefined>
  advancedList(): Promise<AdvancedAction[]>
  advancedRun(id: string): Promise<AdvancedRunResult | undefined>
    repairCatalog(): Promise<RepairOperation[]>
    recommendedRepairs(diagnoses: Diagnosis[]): Promise<RepairRecommendationsResult>
  previewRepairOperation(operationId: string): Promise<RepairOperationPreview | undefined>
  applyRepairOperation(operationId: string): Promise<RepairOperationApply | undefined>
  wslProxySources(distribution: string): Promise<WslProxySource[]>
  previewWslProxySource(source: WslProxySource): Promise<WslProxyPreview | undefined>
  applyWslProxySource(source: WslProxySource): Promise<WslProxyApplyResult | undefined>
  hostsEntries(): Promise<HostsEntry[]>
  openConfigLocation(kind: OpenLocationKind, target?: string): Promise<OpenLocationResult | undefined>
  previewHostsDelete(entry: HostsEntry): Promise<HostsDeletePreview | undefined>
  applyHostsDelete(entry: HostsEntry): Promise<HostsDeleteResult | undefined>
}

export interface RepairPreview {
  supported: boolean
  preview?: ConfigurePreview
}

export interface RepairApply {
  supported: boolean
  result?: ConfigureResult
}

export interface OpenLocationResult {
  opened: boolean
  path: string
}

export type OpenLocationKind = 'hosts' | 'wslconfig' | 'wsl-conf' | 'system-proxy-settings' | 'shell-profile'

export interface RollbackResult {
  snapshot: SnapshotRecord
  diff: { path: string; before: unknown; after: unknown }[]
  diffText: string[]
}

interface ConnectionFace {
  rpc: {
    call<T>(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<T>>
  }
}

export function createNetworkService(connection: ConnectionFace): NetworkService {
  let snapshot: NetworkServiceSnapshot = { phase: 'idle' }
  const listeners = new Set<() => void>()
  let controller: AbortController | undefined

  const publish = (next: Partial<NetworkServiceSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async refreshStatus() {
      const result = await connection.rpc.call<StatusResult>(CHANNEL, 'status', {})
      if (!result.ok) return
      if (result.value.status === 'ready' && result.value.diagnosis !== undefined) {
        publish({
          phase: snapshot.phase === 'loading' ? snapshot.phase : 'ready',
          cached: { timestamp: result.value.timestamp, diagnosis: result.value.diagnosis, summary: result.value.summary },
          targets: result.value.targets,
        })
        return
      }
      // Standby: still publish targets so the switcher works before a run.
      if (result.value.targets !== undefined && snapshot.targets === undefined) {
        publish({ targets: result.value.targets })
      }
    },
    async run(targetId?: string) {
      return this.runWithPlan('single', targetId)
    },
    async runStability(targetId?: string) {
      return this.runWithPlan('multi', targetId)
    },
    async runWithPlan(plan: 'single' | 'multi', targetId?: string) {
      controller?.abort()
      controller = new AbortController()
      publish({ phase: 'loading', error: undefined, cancelled: false })
      const result = await connection.rpc.call<RunResult>(CHANNEL, 'run', { includeWsl: true, probeMode: plan, ...targetId === undefined ? {} : { targetId } }, controller.signal)
      if (controller.signal.aborted) {
        publish({ phase: 'idle', cancelled: true })
        return
      }
      if (!result.ok) {
        publish({ phase: 'error', error: result.error.message })
        return
      }
      publish({
        phase: 'ready',
        inspection: result.value.inspection,
        diagnosis: result.value.diagnosis,
        graph: result.value.graph,
        summary: result.value.summary,
        targets: result.value.targets,
        cached: { timestamp: result.value.timestamp, diagnosis: result.value.diagnosis, summary: result.value.summary },
      })
    },
    async runTarget(targetId: string) {
      return this.run(targetId)
    },
    cancel() {
      controller?.abort()
      publish({ phase: 'idle', cancelled: true })
    },
    async previewConfigure(request) {
      const result = await connection.rpc.call<ConfigurePreview>(CHANNEL, 'configure/preview', request)
      return result.ok ? result.value : undefined
    },
    async applyConfigure(request) {
      const result = await connection.rpc.call<ConfigureResult>(CHANNEL, 'configure/apply', request)
      return result.ok ? result.value : undefined
    },
    async listSnapshots() {
      const result = await connection.rpc.call<{ snapshots: SnapshotRecord[] }>(CHANNEL, 'snapshot/list', {})
      return result.ok ? result.value.snapshots : []
    },
    async repairPreview(action) {
      const result = await connection.rpc.call<RepairPreview>(CHANNEL, 'repair/preview', { action })
      return result.ok ? result.value : undefined
    },
    async repairApply(action) {
      const result = await connection.rpc.call<RepairApply>(CHANNEL, 'repair/apply', { action })
      return result.ok ? result.value : undefined
    },
    async rollbackLatest() {
      const result = await connection.rpc.call<RollbackResult>(CHANNEL, 'repair/rollback', {})
      return result.ok ? result.value : undefined
    },
    async advancedList() {
      const result = await connection.rpc.call<{ actions: AdvancedAction[] }>(CHANNEL, 'advanced/list', {})
      return result.ok ? result.value.actions : []
    },
    async advancedRun(id) {
      const result = await connection.rpc.call<AdvancedRunResult>(CHANNEL, 'advanced/run', { id })
      return result.ok ? result.value : undefined
    },
    async repairCatalog() {
      const result = await connection.rpc.call<{ operations: RepairOperation[] }>(CHANNEL, 'repair/catalog', {})
      return result.ok ? result.value.operations : []
    },
    async recommendedRepairs(diagnoses) {
      const result = await connection.rpc.call<RepairRecommendationsResult>(CHANNEL, 'repair/recommended', { diagnoses })
      return result.ok ? result.value : { recentlyAppliedIds: [], recommendations: [] }
    },
    async previewRepairOperation(operationId) {
      const result = await connection.rpc.call<RepairOperationPreview>(CHANNEL, 'repair/preview', { operationId })
      return result.ok ? result.value : undefined
    },
    async applyRepairOperation(operationId) {
      const result = await connection.rpc.call<RepairOperationApply>(CHANNEL, 'repair/apply', { operationId })
      return result.ok ? result.value : undefined
    },
    async wslProxySources(distribution) {
      const result = await connection.rpc.call<{ sources: WslProxySource[] }>(CHANNEL, 'wsl/proxy-sources', { distribution })
      return result.ok ? result.value.sources : []
    },
    async previewWslProxySource(source) {
      const result = await connection.rpc.call<WslProxyPreview>(CHANNEL, 'wsl/proxy-preview', { source })
      return result.ok ? result.value : undefined
    },
    async applyWslProxySource(source) {
      const result = await connection.rpc.call<WslProxyApplyResult>(CHANNEL, 'wsl/proxy-apply', { source })
      return result.ok ? result.value : undefined
    },
    async hostsEntries() {
      const result = await connection.rpc.call<{ entries: HostsEntry[] }>(CHANNEL, 'hosts/entries', {})
      return result.ok ? result.value.entries : []
    },
    async openConfigLocation(kind: OpenLocationKind, target?: string) {
      const result = await connection.rpc.call<OpenLocationResult>(CHANNEL, 'config/open-location', { kind, ...target === undefined ? {} : { target } })
      return result.ok ? result.value : undefined
    },
    async previewHostsDelete(entry) {
      const result = await connection.rpc.call<HostsDeletePreview>(CHANNEL, 'hosts/delete-preview', { entry })
      return result.ok ? result.value : undefined
    },
    async applyHostsDelete(entry) {
      const result = await connection.rpc.call<HostsDeleteResult>(CHANNEL, 'hosts/delete', { entry })
      return result.ok ? result.value : undefined
    },
  }
}
