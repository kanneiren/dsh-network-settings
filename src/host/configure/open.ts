/**
 * Open well-known configuration locations with their native viewer/editor.
 * One facade hides all platform differences: opener selection (cmd.exe start
 * vs macOS `open`), path resolution per runtime model, and target validation.
 * Module facade: openConfigLocation(). openTargetFor() is a pure test seam.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { runCommand } from '../runtime/command.ts'

export type OpenLocationKind = 'hosts' | 'wslconfig' | 'wsl-conf' | 'system-proxy-settings' | 'shell-profile'

export interface OpenLocationResult {
  opened: boolean
  path: string
}

export interface OpenTarget {
  /** Display path returned to the client. */
  path: string
  /** Opener command; undefined when the location does not exist on this platform. */
  opener: string[] | undefined
}

const SHELL_PROFILE_NAMES = ['.zshenv', '.zprofile', '.zshrc', '.bash_profile', '.profile'] as const

function windowsStart(target: string): string[] {
  return ['cmd.exe', '/d', '/s', '/c', 'start', '', target.replaceAll('/', '\\\\')]
}

/** Accept only well-known shell profile file names; the file is always
 * resolved inside the home directory, so traversal is impossible. */
function shellProfilePath(target: string | undefined, home: string): string | undefined {
  if (target === undefined || target.trim() === '') return undefined
  const name = basename(target)
  return (SHELL_PROFILE_NAMES as readonly string[]).includes(name) ? join(home, name) : undefined
}

/** Pure resolution of kind → (path, opener) for a runtime platform. */
export function openTargetFor(kind: OpenLocationKind, platform: NodeJS.Platform, target: string | undefined, home: string): OpenTarget {
  const darwin = platform === 'darwin'
  switch (kind) {
    case 'hosts':
      if (darwin) return { path: '/etc/hosts', opener: ['open', '-t', '/etc/hosts'] }
      if (platform === 'linux') return { path: '/mnt/c/Windows/System32/drivers/etc/hosts', opener: windowsStart('/mnt/c/Windows/System32/drivers/etc/hosts') }
      return { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', opener: windowsStart('C:\\Windows\\System32\\drivers\\etc\\hosts') }
    case 'system-proxy-settings':
      if (darwin) return { path: 'x-apple.systempreferences:com.apple.Network-Settings', opener: ['open', 'x-apple.systempreferences:com.apple.Network-Settings'] }
      return { path: 'ms-settings:network-proxy', opener: windowsStart('ms-settings:network-proxy') }
    case 'shell-profile': {
      if (!darwin) return { path: '', opener: undefined }
      const path = shellProfilePath(target, home)
      if (path === undefined) return { path: join(home, '.zshrc'), opener: undefined }
      return { path, opener: ['open', '-t', path] }
    }
    case 'wslconfig': {
      if (darwin) return { path: '', opener: undefined }
      const path = home === '' ? '%UserProfile%\\.wslconfig' : join(home, '.wslconfig')
      return { path, opener: home === '' ? undefined : windowsStart(path) }
    }
    case 'wsl-conf': {
      if (darwin) return { path: '', opener: undefined }
      if (target === undefined || target.trim() === '') return { path: '/etc/wsl.conf', opener: undefined }
      const path = `\\\\wsl.localhost\\${target}\\etc\\wsl.conf`
      return { path, opener: windowsStart(path) }
    }
  }
}

export async function openConfigLocation(kind: OpenLocationKind, target?: string): Promise<OpenLocationResult> {
  const home = homedir()
  let requested = target
  if (kind === 'shell-profile' && process.platform === 'darwin' && (requested === undefined || requested.trim() === '')) {
    // Default to the first shell profile that actually exists.
    requested = SHELL_PROFILE_NAMES.find(name => existsSync(join(home, name)))
    if (requested === undefined) return { opened: false, path: join(home, '.zshrc') }
  }
  const { path, opener } = openTargetFor(kind, process.platform, requested, home)
  if (opener === undefined) return { opened: false, path }
  const [command, ...args] = opener
  const result = await runCommand(command, args, { timeoutMs: 8_000 })
  return { opened: result.code === 0, path }
}
