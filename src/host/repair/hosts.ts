/** Hosts single-entry inspection and deletion with whole-file backup. */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runElevatedPowerShell } from '../configure/windows.ts'
import { parseHostsEntries, type HostsEntry } from '../shared-env.ts'
import { saveSnapshot, updateSnapshotAfter, type SnapshotScope } from '../snapshot/store.ts'

export { parseHostsEntries }


export function hostsPath(): string {
  if (process.platform === 'darwin') return '/etc/hosts'
  if (process.platform === 'linux') return '/mnt/c/Windows/System32/drivers/etc/hosts'
  const root = process.env['SystemRoot'] ?? 'C:\\Windows'
  return join(root, 'System32', 'drivers', 'etc', 'hosts')
}

/**
 * Windows-side form of a hosts path. Reading works from WSL via /mnt/c, but
 * elevated PowerShell fallback scripts run on the Windows side and need the
 * native drive-letter form.
 */
export function windowsHostsPath(path = hostsPath()): string {
  const mount = /^\/mnt\/([a-z])\/(.*)$/i.exec(path)
  if (mount === null) return path
  return `${(mount[1] ?? 'c').toUpperCase()}:\\${(mount[2] ?? '').replaceAll('/', '\\')}`
}


export async function readHostsEntries(path = hostsPath()): Promise<HostsEntry[]> {
  try {
    return parseHostsEntries(await readFile(path, 'utf8'))
  } catch {
    return []
  }
}

async function readText(path: string): Promise<string> {
  return (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
}

async function writeTextNormal(path: string, text: string): Promise<void> {
  await writeFile(path, text, 'utf8')
}

async function backupAndWrite(path: string, text: string): Promise<string> {
  const backup = `${path}.dsh-network-settings.bak`
  try {
    await copyFile(path, backup)
    await writeTextNormal(path, text)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EACCES' && code !== 'EPERM') throw error
    // Elevated fallback: backup first, then copy a temp file over hosts.
    const temp = `${path}.dsh-network-settings.tmp`
    await writeFile(temp, text, 'utf8')
    const winPath = windowsHostsPath(path)
    const winBackup = windowsHostsPath(backup)
    const winTemp = windowsHostsPath(temp)
    const script = String.raw`
      Copy-Item -LiteralPath '${winPath.replaceAll("'", "''")}' -Destination '${winBackup.replaceAll("'", "''")}' -Force
      Copy-Item -LiteralPath '${winTemp.replaceAll("'", "''")}' -Destination '${winPath.replaceAll("'", "''")}' -Force
      Remove-Item -LiteralPath '${winTemp.replaceAll("'", "''")}' -Force
    `
    try {
      await runElevatedPowerShell(script)
    } catch (elevatedError) {
      throw new Error(`修改 Hosts 需要管理员权限：${elevatedError instanceof Error ? elevatedError.message : String(elevatedError)}`)
    }
  }
  return backup
}

export interface HostsDeletePreview {
  entry: HostsEntry
  scopeDescription: string
  diffText: string[]
}

export function previewHostsDelete(entry: HostsEntry): HostsDeletePreview {
  return {
    entry,
    scopeDescription: `只会删除 Hosts 文件第 ${entry.line} 行（${entry.raw.trim()}）。不会修改其他 Hosts 条目或任何网络配置。`,
    diffText: [`hosts:${entry.line}: ${entry.raw.trim()} → (删除)`],
  }
}

export async function deleteHostsEntry(entry: HostsEntry, path = hostsPath()): Promise<HostsDeletePreview & { snapshotId: string }> {
  const text = await readText(path)
  const lines = text.split('\n')
  const current = lines[entry.line - 1]
  if (current === undefined || current !== entry.raw) {
    throw new Error(`Hosts 第 ${entry.line} 行已变化，请重新检测`)
  }

  const snapshot = await saveSnapshot({
    reason: `删除 Hosts 条目: ${entry.raw.trim()}`,
    scope: 'windows.hosts' as SnapshotScope,
    before: { file: path, line: entry.line, raw: entry.raw, backup: `${path}.dsh-network-settings.bak` },
    reversible: true,
  })

  lines.splice(entry.line - 1, 1)
  await backupAndWrite(path, lines.join('\n'))
  await updateSnapshotAfter(snapshot.id, { file: path, line: null })

  return { ...previewHostsDelete(entry), snapshotId: snapshot.id }
}

export async function rollbackHostsSnapshot(snapshot: {
  before: unknown
}): Promise<{ diffText: string[] }> {
  const before = snapshot.before as { file?: string; line?: number; backup?: string }
  if (before.file === undefined || before.backup === undefined) throw new Error('Hosts 快照缺少恢复信息')
  const backup = before.backup
  let restored = false
  try {
    await writeTextNormal(before.file, await readText(backup))
    restored = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'ENOENT') throw error
    const script = String.raw`Copy-Item -LiteralPath '${windowsHostsPath(backup).replaceAll("'", "''")}' -Destination '${windowsHostsPath(before.file).replaceAll("'", "''")}' -Force`
    await runElevatedPowerShell(script)
    restored = true
  }
  if (!restored) throw new Error('恢复 Hosts 失败')
  return { diffText: [`Hosts 第 ${before.line ?? '?'} 行已从备份恢复`] }
}

