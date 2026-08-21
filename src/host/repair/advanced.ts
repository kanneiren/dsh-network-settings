/** Advanced network first aid. Each operation is listed and executed alone. */
import { readJson, writeJson } from '../runtime/store.ts'
import { runPowerShell, type PowerShellResult } from '../runtime/powershell.ts'
import { runElevatedPowerShell } from '../configure/windows.ts'
import { readWinHttpMachineProxy } from '../configure/windows.ts'
import { saveSnapshot, updateSnapshotAfter } from '../snapshot/store.ts'

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

export interface AdvancedActionRecord {
  id: string
  executedAt: string
}

const ACTION_HISTORY_FILE = 'action-history.json'

async function recordAdvancedAction(id: string): Promise<void> {
  const history = await readJson<AdvancedActionRecord[]>(ACTION_HISTORY_FILE) ?? []
  history.push({ id, executedAt: new Date().toISOString() })
  // Keep the last 50 records.
  await writeJson(ACTION_HISTORY_FILE, history.slice(-50))
}

export async function recentAdvancedActionIds(withinMs = 24 * 60 * 60 * 1000): Promise<Set<string>> {
  const history = await readJson<AdvancedActionRecord[]>(ACTION_HISTORY_FILE) ?? []
  const cutoff = Date.now() - withinMs
  return new Set(history.filter(record => Date.parse(record.executedAt) >= cutoff).map(record => record.id))
}

export interface AdvancedRunResult {
  action: AdvancedAction
  executedAt: string
  code: number | null
  stdout: string
  stderr: string
  snapshotId?: string
}

const CATALOG: readonly AdvancedAction[] = [
  {
    id: 'flush-dns',
    label: '刷新 DNS 解析缓存',
    purpose: '清除 Windows DNS 客户端缓存（ipconfig /flushdns）。适合 Hosts/解析变更后仍解析到旧地址的情况。',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    command: 'ipconfig /flushdns',
  },
  {
    id: 'reset-winhttp-proxy',
    label: '重置 WinHTTP 代理为直连',
    purpose: '执行 netsh winhttp reset proxy，把 WinHTTP 机器级代理重置为 DIRECT。',
    risk: 'medium',
    requiresAdmin: true,
    requiresReboot: false,
    recoverable: true,
    command: 'netsh winhttp reset proxy',
  },
  {
    id: 'mac-flush-dns',
    label: '刷新 macOS DNS 缓存',
    purpose: '清除 macOS DNS 解析缓存（dscacheutil + mDNSResponder）。',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    command: 'dscacheutil -flushcache; killall -HUP mDNSResponder',
  },
  {
    id: 'mac-clear-shell-proxy',
    label: '清除 Shell 配置文件中的代理环境变量',
    purpose: '从 ~/.zshenv、~/.zprofile 等启动文件中移除代理 export 行，带备份。',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    command: 'sed -i.bak /_PROXY=/d ~/.zshenv ~/.zprofile ~/.zshrc ~/.bash_profile ~/.profile 2>/dev/null || true',
  },
  {
    id: 'reset-winsock',
    label: '重置 Winsock 目录',
    purpose: '执行 netsh winsock reset。修复 LSP/Winsock 损坏导致的连接问题；影响所有使用 Winsock 的程序。',
    risk: 'high',
    requiresAdmin: true,
    requiresReboot: true,
    recoverable: false,
    command: 'netsh winsock reset',
  },
  {
    id: 'reset-ip',
    label: '重置 TCP/IP 协议栈',
    purpose: '执行 netsh int ip reset。重置 IPv4/IPv6 协议栈配置，可能清除部分网络配置。',
    risk: 'high',
    requiresAdmin: true,
    requiresReboot: true,
    recoverable: false,
    command: 'netsh int ip reset',
  },
]

export function advancedCatalog(): AdvancedAction[] {
  return CATALOG.map(action => ({ ...action }))
}

export async function runAdvancedAction(
  id: string,
  signal?: AbortSignal,
): Promise<AdvancedRunResult> {
  const action = CATALOG.find(candidate => candidate.id === id)
  if (action === undefined) throw new Error(`unknown advanced action: ${id}`)

  let snapshotId: string | undefined
  if (action.id === 'reset-winhttp-proxy') {
    const before = await readWinHttpMachineProxy()
    if (before !== undefined) {
      const snapshot = await saveSnapshot({
        reason: `高级网络急救: ${action.label}`,
        scope: 'windows.winhttp.machine',
        before,
        reversible: true,
      })
      snapshotId = snapshot.id
    }
  }

  let result: PowerShellResult
  if (action.requiresAdmin) {
    await runElevatedPowerShell(`& ${action.command}`)
    result = { stdout: '', stderr: '', code: 0, timedOut: false, aborted: false, durationMs: 0 }
  } else if (process.platform === 'darwin') {
    // macOS actions run as plain shell commands, not PowerShell
    const shell = await import('../runtime/command.ts')
    const r = await shell.runCommand('/bin/sh', ['-c', action.command], { signal, timeoutMs: 60_000 })
    result = { stdout: r.stdout, stderr: r.stderr, code: r.code, timedOut: r.timedOut, aborted: r.aborted, durationMs: r.durationMs }
  } else {
    result = await runPowerShell(`& ${action.command}`, { signal, timeoutMs: 60_000 })
  }
  if (result.code !== 0) throw new Error(result.stderr.trim() || `${action.command} failed: ${String(result.code)}`)

  if (snapshotId !== undefined) {
    const after = await readWinHttpMachineProxy()
    if (after !== undefined) await updateSnapshotAfter(snapshotId, after)
  }

  await recordAdvancedAction(action.id)
  return {
    action: { ...action },
    executedAt: new Date().toISOString(),
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    ...snapshotId === undefined ? {} : { snapshotId },
  }
}
