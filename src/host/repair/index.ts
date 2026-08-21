/** Repair: rollback-first restoration plus action-to-config mapping. */
import { latestSnapshot, listSnapshots, type SnapshotRecord, type SnapshotScope } from '../snapshot/store.ts'
import { findRepairOperation, platformMatches, type RepairOperation } from './catalog.ts'
import { advancedCatalog, runAdvancedAction, type AdvancedAction, type AdvancedRunResult } from './advanced.ts'
import { rollbackWslSnapshot } from './wsl-proxy.ts'
import { rollbackHostsSnapshot } from './hosts.ts'
import { diffJson, summarizeDiff } from '../snapshot/diff.ts'
import { applyConfigure, previewConfigure, type ConfigureRequest } from '../configure/index.ts'
import type { DiagnosisAction } from '../diagnose/model.ts'
import type { EnvironmentScopeSnapshot, WinHttpProxyInspection, WinInetProxyInspection } from '../model.ts'

export interface RepairPreview {
  operation: RepairOperation
  preview?: Awaited<ReturnType<typeof import('../configure/index.ts')['previewConfigure']>>
  advanced?: AdvancedAction
}

export interface RepairApplyResult {
  operation: RepairOperation
  result?: Awaited<ReturnType<typeof import('../configure/index.ts')['applyConfigure']>>
  advanced?: AdvancedRunResult
}

export interface RollbackResult {
  snapshot: SnapshotRecord
  diff: ReturnType<typeof diffJson>
  diffText: string[]
}

export async function rollbackScope(scope: SnapshotScope): Promise<RollbackResult> {
  const snapshot = await latestSnapshot(scope)
  if (snapshot === undefined) throw new Error(`没有可撤销的修改：${scope}`)
  if (!snapshot.reversible) throw new Error('该快照包含无法安全恢复的敏感字段，请手动恢复')

  if (scope.startsWith('wsl.')) {
    const restored = await rollbackWslSnapshot(scope, snapshot)
    return { snapshot, diff: [], diffText: restored.diffText }
  }

  if (scope === 'windows.hosts') {
    const restored = await rollbackHostsSnapshot(snapshot)
    return { snapshot, diff: [], diffText: restored.diffText }
  }

  const request = rollbackRequest(snapshot)
  if (request === undefined) throw new Error(`暂不支持自动回滚作用域：${scope}`)
  const applied = await applyConfigure(request)
  const diff = diffJson(snapshot.before, applied.after)
  return { snapshot, diff, diffText: summarizeDiff(diff) }
}

function rollbackRequest(snapshot: SnapshotRecord): ConfigureRequest | undefined {
  switch (snapshot.scope) {
    case 'windows.wininet': {
      const before = snapshot.before as WinInetProxyInspection
      return {
        scope: 'windows.wininet',
        action: 'set',
        patch: {
          enabled: before.enabled,
          ...before.proxyServer === undefined ? { proxyServer: '' } : { proxyServer: before.proxyServer },
          ...before.proxyOverride === undefined ? { proxyOverride: '' } : { proxyOverride: before.proxyOverride },
          ...before.autoConfigUrl === undefined ? { autoConfigUrl: '' } : { autoConfigUrl: before.autoConfigUrl },
          autoDetect: before.autoDetect,
        },
      }
    }
    case 'windows.winhttp.user':
    case 'windows.winhttp.machine': {
      const before = snapshot.before as WinHttpProxyInspection | undefined
      if (before === undefined) return { scope: 'windows.winhttp.user', action: 'clear' }
      return {
        scope: snapshot.scope,
        action: 'set',
        patch: {
          proxyEnabled: before.proxyEnabled,
          ...before.proxy === undefined ? { proxy: '' } : { proxy: before.proxy },
          ...before.proxyBypass === undefined ? { proxyBypass: '' } : { proxyBypass: before.proxyBypass },
          autoConfigEnabled: before.autoConfigEnabled,
          ...before.autoConfigUrl === undefined ? { autoConfigUrl: '' } : { autoConfigUrl: before.autoConfigUrl },
          autoDetect: before.autoDetect,
        },
      }
    }
    case 'windows.env.user':
    case 'windows.env.machine': {
      const before = snapshot.before as EnvironmentScopeSnapshot
      const values: Record<string, string | undefined> = {}
      for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
        values[name] = before[name as keyof EnvironmentScopeSnapshot]
      }
      return { scope: snapshot.scope, action: 'set', values }
    }
    case 'windows.wslconfig': {
      const before = snapshot.before as { autoProxy?: boolean }
      return { scope: 'windows.wslconfig', action: 'set', patch: { autoProxy: before.autoProxy === true } }
    }
    case 'dsh.process': {
      const before = snapshot.before as EnvironmentScopeSnapshot
      const proxy: Record<string, string> = {}
      for (const [name, value] of Object.entries(before)) {
        if (value !== undefined && value !== '') proxy[name] = value
      }
      return { scope: 'dsh.process', action: 'set', patch: proxy }
    }
    default:
      return undefined
  }
}

/** Actions from Phase 2 that Phase 4 can apply safely. */
const ACTION_MAP: Record<string, ConfigureRequest> = {
  'clear-dsh-process-proxy': { scope: 'dsh.process', action: 'clear' },
  'repair-env-scope-conflict': { scope: 'windows.env.user', action: 'unset', name: 'HTTPS_PROXY', value: '' },
}

export function actionToConfigureRequest(action: DiagnosisAction): ConfigureRequest | undefined {
  return ACTION_MAP[action.code]
}

export async function previewRepairOperation(id: string): Promise<RepairPreview> {
  const operation = findRepairOperation(id)
  if (operation === undefined) throw new Error(`unknown repair operation: ${id}`)
  if (!platformMatches(operation.platform, process.platform)) throw new Error(`此修复操作不适用于当前系统: ${id}`)
  if (operation.kind === 'configure' && operation.request !== undefined) {
    return { operation, preview: await previewConfigure(operation.request) }
  }
  if (operation.kind === 'advanced' && operation.advancedId !== undefined) {
    const advanced = advancedCatalog().find(action => action.id === operation.advancedId)
    if (advanced === undefined) throw new Error(`unknown advanced action: ${operation.advancedId}`)
    return { operation, advanced }
  }
  throw new Error(`repair operation has no executable target: ${id}`)
}

export async function applyRepairOperation(id: string): Promise<RepairApplyResult> {
  const operation = findRepairOperation(id)
  if (operation === undefined) throw new Error(`unknown repair operation: ${id}`)
  if (!platformMatches(operation.platform, process.platform)) throw new Error(`此修复操作不适用于当前系统: ${id}`)
  if (operation.kind === 'configure' && operation.request !== undefined) {
    return { operation, result: await applyConfigure(operation.request) }
  }
  if (operation.kind === 'advanced' && operation.advancedId !== undefined) {
    return { operation, advanced: await runAdvancedAction(operation.advancedId) }
  }
  throw new Error(`repair operation has no executable target: ${id}`)
}

export async function rollbackLatest(): Promise<RollbackResult> {
  const snapshots = await listSnapshots()
  const latest = snapshots[0]
  if (latest === undefined) throw new Error('没有可撤销的修改')
  return rollbackScope(latest.scope)
}
