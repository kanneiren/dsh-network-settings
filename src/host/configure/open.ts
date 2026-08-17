/** Open well-known configuration locations in their native editor. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../runtime/command.ts'
import { wslconfigPaths } from '../wsl/inspect.ts'

export interface OpenLocationResult {
  opened: boolean
  path: string
}

function windowsPath(path: string): string {
  return path.replaceAll('/', '\\\\')
}

async function startCommand(target: string): Promise<boolean> {
  if (process.platform === 'win32') {
    const result = await runCommand('cmd.exe', ['/d', '/s', '/c', 'start', '', target], { timeoutMs: 8_000 })
    return result.code === 0
  }
  const result = await runCommand('cmd.exe', ['/d', '/s', '/c', 'start', '', windowsPath(target)], { timeoutMs: 8_000 })
  return result.code === 0
}

export async function openWindowsProxySettings(): Promise<OpenLocationResult> {
  const opened = await startCommand('ms-settings:network-proxy')
  return { opened, path: 'ms-settings:network-proxy' }
}

export async function openConfigLocation(kind: 'wslconfig' | 'wsl-conf' | 'hosts', distribution?: string): Promise<OpenLocationResult> {
  if (kind === 'wslconfig') {
    const path = wslconfigPaths()[0]
    if (path === undefined) return { opened: false, path: '%UserProfile%\\.wslconfig' }
    return { opened: await startCommand(path), path }
  }
  if (kind === 'hosts') {
    const path = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/mnt/c/Windows/System32/drivers/etc/hosts'
    return { opened: await startCommand(path), path }
  }
  if (distribution === undefined || distribution.trim() === '') return { opened: false, path: '/etc/wsl.conf' }
  const path = `\\\\wsl.localhost\\${distribution}\\etc\\wsl.conf`
  return { opened: await startCommand(path), path }
}
