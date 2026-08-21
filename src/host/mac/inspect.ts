/**
 * macOS facts collector (MACOS_NATIVE). Mirrors the wsl/ module pattern:
 * command templates below, exported parsers above — parsers are pure and
 * unit-tested against the recorded outputs in tests/fixtures/mac/.
 *
 * Module facade — public surface: inspectMacFacts(). Everything else
 * exported is an internal test seam.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostsInspection, ListenerInspection, MacInspection, MacScutilProxy, ProbeCheck } from '../model.ts'
import { runCommand } from '../runtime/command.ts'
import { parseHostsEntries } from '../shared-env.ts'
import { proxyEnvironmentOf } from '../shared-env.ts'

export interface InspectMacOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Test seam: inject pre-captured outputs (file names as in tests/fixtures/mac). */
  fixtures?: Partial<{
    'scutil-proxy': string
    'networksetup-ports': string
    'route-default': string
    'scutil-dns': string
    'lsof-listeners': string
    'hosts': string
    'sw-vers': string
  }>
}

const CMD_TIMEOUT_MS = 8_000

/** Parse `scutil --proxy` dictionary output. Absent keys mean disabled. */
export function parseMacSystemProxy(text: string): MacScutilProxy {
  const value = (key: string): string | undefined => {
    const m = new RegExp('^\\s*' + key + '\\s*:\\s*(.+)$', 'm').exec(text)
    return m === null ? undefined : m[1]?.trim()
  }
  const enabled = (key: string): boolean => value(key) === '1'
  const port = (key: string): number | undefined => {
    const raw = value(key)
    const n = raw === undefined ? Number.NaN : Number(raw)
    return Number.isInteger(n) && n > 0 ? n : undefined
  }
  const exceptions: string[] = []
  const arrayMatch = /ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/.exec(text)
  if (arrayMatch !== null) {
    for (const item of arrayMatch[1]?.matchAll(/\d+\s*:\s*(.+)/g) ?? []) {
      const entry = item[1]?.trim()
      if (entry !== undefined && entry !== '') exceptions.push(entry)
    }
  }
  return {
    httpEnabled: enabled('HTTPEnable'),
    httpsEnabled: enabled('HTTPSEnable'),
    socksEnabled: enabled('SOCKSEnable'),
    pacEnabled: enabled('ProxyAutoConfigEnable'),
    ...value('HTTPProxy') === undefined ? {} : { httpHost: value('HTTPProxy') },
    ...port('HTTPPort') === undefined ? {} : { httpPort: port('HTTPPort') },
    ...value('HTTPSProxy') === undefined ? {} : { httpsHost: value('HTTPSProxy') },
    ...port('HTTPSPort') === undefined ? {} : { httpsPort: port('HTTPSPort') },
    ...value('SOCKSProxy') === undefined ? {} : { socksHost: value('SOCKSProxy') },
    ...port('SOCKSPort') === undefined ? {} : { socksPort: port('SOCKSPort') },
    ...value('ProxyAutoConfigURLString') === undefined ? {} : { pacUrl: value('ProxyAutoConfigURLString') },
    ...exceptions.length === 0 ? {} : { exceptions },
  }
}

export interface MacInterface {
  name: string
  device: string
  kind: 'ethernet' | 'wi-fi' | 'vpn' | 'other'
}

/** Parse `networksetup -listallhardwareports` blocks into interfaces. */
export function parseMacHardwarePorts(text: string): MacInterface[] {
  const interfaces: MacInterface[] = []
  for (const block of text.split(/(?=Hardware Port:)/)) {
    const name = /Hardware Port:\s*(.+)/.exec(block)?.[1]?.trim()
    const device = /Device:\s*(.+)/.exec(block)?.[1]?.trim()
    if (name === undefined || device === undefined) continue
    if (/vlan configurations/i.test(name)) continue
    const kind: MacInterface['kind'] = /^utun/.test(device) ? 'vpn'
      : /wi-?fi/i.test(name) ? 'wi-fi'
      : /^en\d+$/.test(device) ? 'ethernet'
      : 'other'
    interfaces.push({ name, device, kind })
  }
  return interfaces
}

export interface MacRoute {
  gateway?: string
  interface?: string
}

/** Parse `route -n get default`. */
export function parseMacRoute(text: string): MacRoute {
  const gateway = /gateway:\s*(\S+)/.exec(text)?.[1]
  const face = /interface:\s*(\S+)/.exec(text)?.[1]
  return {
    ...gateway === undefined ? {} : { gateway },
    ...face === undefined ? {} : { interface: face },
  }
}

/** Parse `scutil --dns`: nameservers of the first resolver. */
export function parseMacDns(text: string): string[] {
  const first = /resolver #1[\s\S]*?(?=resolver #|$)/.exec(text)?.[0] ?? ''
  return [...first.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map(m => m[1] ?? '').filter(n => n !== '')
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN` rows into the shared listener shape. */
export function parseMacListeners(text: string): ListenerInspection[] {
  const listeners: ListenerInspection[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '' || /^COMMAND\s+PID/.test(line)) continue
    const cols = line.trim().split(/\s+/)
    const command = cols[0]
    const pid = Number(cols[1])
    const name = cols.slice(8).join(' ')
    const bind = /\s(TCP\s+)?(\S+:\d+)\s/.exec(line)?.[2] ?? name.split(/\s+/).pop()
    if (command === undefined || !Number.isInteger(pid) || bind === undefined) continue
    const cleaned = bind.replaceAll('(', '').replaceAll(')', '')
    const idx = cleaned.lastIndexOf(':')
    const address = idx > 0 ? cleaned.slice(0, idx) : ''
    const port = idx > 0 ? cleaned.slice(idx + 1) : cleaned
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber <= 0) continue
    listeners.push({
      address: address === '*' ? '0.0.0.0' : address ?? '',
      port: portNumber,
      pid,
      ...command === '' ? {} : { processName: command },
    })
  }
  return listeners
}

/** Parse `sw_vers` into os metadata. */
export function parseSwVers(text: string): { caption: string; version: string; build: string } {
  const value = (key: string): string => new RegExp(key + ':\\s*(.+)').exec(text)?.[1]?.trim() ?? ''
  return { caption: value('ProductName') || 'macOS', version: value('ProductVersion'), build: value('BuildVersion') }
}

/** Shell profiles where proxy software commonly leaves exports behind. */
export const MAC_SHELL_PROFILES = ['.zshenv', '.zprofile', '.zshrc', '.bash_profile', '.profile'] as const

/**
 * Parse proxy exports from shell profile contents. Mirrors the WSL source
 * scan: macOS has no registry env scopes, so post-install residue lives in
 * `export HTTPS_PROXY=...` lines of startup files.
 */
export function parseMacShellProxyExports(contents: Array<{ file: string; text: string }>): EnvironmentScopeSnapshotLike {
  const snapshot: Record<string, string> = {}
  for (const { text } of contents) {
    for (const line of text.split('\n')) {
      const m = /^\s*(?:export\s+)?((?:HTTP|HTTPS|ALL|NO)_PROXY|[a-z_]+_proxy)=(["']?)([^"'\n#]+)\2\s*$/.exec(line)
      const name = m?.[1]
      const value = m?.[3]?.trim()
      if (name !== undefined && value !== undefined && value !== '' && snapshot[name] === undefined) snapshot[name] = value
    }
  }
  return proxyEnvironmentOf(snapshot)
}

type EnvironmentScopeSnapshotLike = ReturnType<typeof proxyEnvironmentOf>

export async function inspectMacFacts(options: InspectMacOptions = {}): Promise<MacInspection> {
  const rawErrors: ProbeCheck[] = []
  const fix = options.fixtures
  const run = async (file: string, args: readonly string[], fixtureKey: keyof NonNullable<InspectMacOptions['fixtures']>): Promise<string> => {
    if (fix?.[fixtureKey] !== undefined) return fix[fixtureKey]
    const result = await runCommand(file, [...args], { timeoutMs: options.timeoutMs ?? CMD_TIMEOUT_MS, signal: options.signal, maxStdoutBytes: 512 * 1024 })
    // Read-only discovery commands exiting non-zero on minimal systems are
    // tolerated as empty output, not fatal.
    return result.stdout
  }

  const [proxyText, portsText, routeText, dnsText, listenersText, versText, hostsText] = await Promise.all([
    run('scutil', ['--proxy'], 'scutil-proxy'),
    run('networksetup', ['-listallhardwareports'], 'networksetup-ports'),
    run('route', ['-n', 'get', 'default'], 'route-default'),
    run('scutil', ['--dns'], 'scutil-dns'),
    run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], 'lsof-listeners'),
    run('sw_vers', [], 'sw-vers'),
    fix?.['hosts'] !== undefined ? Promise.resolve(fix['hosts']) : readFile('/etc/hosts', 'utf8').catch(() => ''),
  ])

  const route = parseMacRoute(routeText)
  const hosts: HostsInspection = { overrides: parseHostsEntries(hostsText) }
  const shellFiles = await Promise.all(
    MAC_SHELL_PROFILES.map(async (name): Promise<{ file: string; text: string }> =>
      ({ file: name, text: await readFile(join(homedir(), name), 'utf8').catch(() => '') })),
  )
  const environment = parseMacShellProxyExports(shellFiles.filter(item => item.text !== ''))
  return {
    ...(Object.keys(environment).length === 0 ? {} : { environment }),
    os: parseSwVers(versText),
    network: {
      interfaces: parseMacHardwarePorts(portsText),
      ...route.gateway === undefined ? {} : { gateway: route.gateway },
      ...route.interface === undefined ? {} : { gatewayInterface: route.interface },
    },
    proxy: {
      scutil: parseMacSystemProxy(proxyText),
      endpoints: [],
    },
    dns: { nameservers: parseMacDns(dnsText) },
    hosts,
    listeners: parseMacListeners(listenersText),
    rawErrors,
  }
}
