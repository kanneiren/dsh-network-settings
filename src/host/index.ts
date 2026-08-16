/**
 * dsh-network-settings host half.
 *
 * Registers the `/dsh-network-settings` Connection RPC channel with loopback
 * authority. All command execution stays behind this boundary; the client half
 * never executes platform commands.
 */
import { diagnoseNetwork } from './diagnose/index.ts'
import type { NetworkInspection } from './model.ts'
import type { DiagnosisReport } from './diagnose/rules.ts'
import { readJson, writeJson } from './runtime/store.ts'
import { applyConfigure, previewConfigure, type ConfigureRequest } from './configure/index.ts'
import { listSnapshots } from './snapshot/store.ts'
import { actionToConfigureRequest, applyRepairOperation, previewRepairOperation, rollbackLatest, rollbackScope } from './repair/index.ts'
import { diagnosisActionOperations, repairCatalog } from './repair/catalog.ts'
import { advancedCatalog, recentAdvancedActionIds, runAdvancedAction } from './repair/advanced.ts'
import { applyWslProxySource, previewWslProxySource } from './repair/wsl-proxy.ts'
import { inspectWslProxySources, type WslProxySource } from './wsl/sources.ts'
import { deleteHostsEntry, previewHostsDelete, readHostsEntries, type HostsEntry } from './repair/hosts.ts'
import type { DiagnosisAction } from './diagnose/model.ts'
import type { SnapshotScope } from './snapshot/store.ts'
import { applyDshProxyConfig, readDshConfig } from './configure/dsh.ts'
import { collectModelServiceTargets } from './dsh/model-services.ts'

export const name = 'dsh-network-settings'
export const inject = ['connection', 'settings', 'llm'] as const

const CHANNEL = '/dsh-network-settings'
const LAST_REPORT_FILE = 'last-report.json'

interface CachedReport {
  inspection: NetworkInspection
  diagnosis: DiagnosisReport
  timestamp: string
}

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
          return ok(cached === undefined
            ? { status: 'not-tested', cached: false, timestamp: new Date().toISOString() }
            : { status: 'ready', cached: true, timestamp: cached.timestamp, diagnosis: cached.diagnosis })
        }
        case 'run': {
          const options = asObject(payload)
          const inspection = await inspectNetworkSafe(ctx, { ...options, signal })
          const diagnosis = await diagnoseFrom(inspection)
          const cached: CachedReport = { inspection, diagnosis, timestamp: new Date().toISOString() }
          await writeJson(LAST_REPORT_FILE, cached)
          return ok({ inspection, diagnosis, timestamp: cached.timestamp })
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
          const actions = Array.isArray(body['actions']) ? body['actions'] as DiagnosisAction[] : []
          const recentlyApplied = await recentAdvancedActionIds()
          return ok({
            recentlyAppliedIds: [...recentlyApplied],
            recommendations: actions.map(action => ({
              action,
              operations: diagnosisActionOperations(action),
            })),
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

async function inspectNetworkSafe(ctx: HostContext, options: { signal?: AbortSignal; includeWsl?: boolean }): Promise<NetworkInspection> {
  const { inspectNetwork } = await import('./inspect.ts')
  return inspectNetwork({ ...options, timeoutMs: 60_000, modelServices: collectModelServiceTargets(ctx.settings, ctx.llm) })
}

async function diagnoseFrom(inspection: NetworkInspection): Promise<DiagnosisReport> {
  const { runDiagnosis } = await import('./diagnose/rules.ts')
  return runDiagnosis({
    windows: inspection.windows,
    ...inspection.wsl === undefined ? {} : { wsl: inspection.wsl },
    probes: inspection.probes,
    endpoints: inspection.windows.proxy.endpoints,
  })
}
