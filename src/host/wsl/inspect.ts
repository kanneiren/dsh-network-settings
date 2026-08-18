/**
 * WSL read-only discovery and per-distribution inspection.
 * Stopped distributions are NEVER started by this module.
 */
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EnvironmentScopeSnapshot, HostCandidate, ProbeCheck, WslCapabilities, WslDistribution,
  WslInspection, WslLinuxInterface, WslNetworkConfig, WslNetworkInspection, WslOsMetadata,
} from '../model.ts'
import { runCommand } from '../runtime/command.ts'
import { decodeWslCommand, decodeWslUtf16 } from './encoding.ts'
import { parseWslList } from './list.ts'
import { parseWslConf, parseWslGlobalConfig } from './wslconfig.ts'
import { wslVersionFromKernel } from '../network/runtime.ts'
import { proxyEnvironmentOf } from '../windows/inspect.ts'

export interface InspectWslOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Test seam: inject pre-captured outputs. */
  fixtures?: Partial<{
    version: string
    status: string
    quiet: string
    running: string
    verbose: string
    wslconfig: string
    /** Simulate `wsl.exe --list --running` exiting non-zero (no running distros). */
    runningFailed?: boolean
  }>
}

const WSL_DISTRO_TIMEOUT_MS = 12_000

/**
 * Launch wsl.exe from the Windows side. From WSL development shells, direct
 * `wsl.exe` interop can hang re-entering the same distro; `cmd.exe /c` is the
 * reliable Windows-side launcher there. The production host is win32 Node.
 */
function wslLaunch(args: readonly string[]): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'wsl.exe', args: [...args] }
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', 'wsl.exe', ...args] }
}

async function wslUtf16(args: readonly string[], options: InspectWslOptions, allowNonZero = false): Promise<string> {
  if (options.fixtures !== undefined) {
    if (args.includes('--version')) return options.fixtures.version ?? ''
    if (args.includes('--status')) return options.fixtures.status ?? ''
    if (args.includes('--quiet')) return options.fixtures.quiet ?? ''
    if (args.includes('--running')) return options.fixtures.runningFailed === true ? '' : options.fixtures.running ?? ''
    if (args.includes('--verbose')) return options.fixtures.verbose ?? ''
  }
  const launch = wslLaunch(args)
  const result = await runCommand(launch.file, launch.args, {
    timeoutMs: options.timeoutMs ?? 15_000,
    signal: options.signal,
    maxStdoutBytes: 2 * 1024 * 1024,
    encoding: 'utf16le',
  })
  if (result.code !== 0) {
    // `--list --running` exits non-zero when no distribution is running; that
    // is a valid "no running distros" result, not a discovery failure.
    if (allowNonZero) return ''
    throw new Error(`wsl.exe ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return decodeWslUtf16(result.stdout).text
}

export async function inspectWsl(options: InspectWslOptions = {}): Promise<WslInspection> {
  const rawErrors: ProbeCheck[] = []
  // Fixtures simulate a machine where WSL exists; the availability probe
  // would otherwise spawn a real wsl.exe and fail on systems without it
  // (e.g. the Linux CI runner).
  let available = options.fixtures !== undefined
  if (!available) {
    try {
      const probe = await runCommand('wsl.exe', ['--version'], {
        timeoutMs: options.timeoutMs ?? 10_000,
        signal: options.signal,
      })
      available = probe.code === 0
    } catch {
      available = false
    }
  }
  if (!available) {
    // Inside a distribution, WSL facts are still obtainable locally even with
    // interop disabled or wsl.exe hanging; the graph must not degrade to
    // "unknown" just because the Windows-side enumerator is unreachable.
    const local = await synthesizeCurrentDistribution(options)
    if (local !== undefined) {
      return {
        available: true,
        distributions: [local],
        rawErrors: [wslError('wsl.discover', new Error('wsl.exe interop unavailable; current distribution inspected locally'))],
      }
    }
    return { available: false, distributions: [], rawErrors: [wslError('wsl.discover', new Error('wsl.exe unavailable or failed'))] }
  }

  try {
    const [versionText, statusText, quietText, runningText, verboseText] = await Promise.all([
      wslUtf16(['--version'], options),
      wslUtf16(['--status'], options),
      wslUtf16(['--list', '--quiet'], options),
      wslUtf16(['--list', '--running'], options, true),
      wslUtf16(['--list', '--verbose'], options),
    ])

    const distributions = parseWslList({ quiet: quietText, running: runningText, verbose: verboseText })
    const version = parseWslVersion(versionText)
    const status = parseWslStatus(statusText, distributions)

    const globalConfig = await readGlobalWslConfig(options, versionText)

    const inspected: WslDistribution[] = []
    for (const distribution of distributions) {
      if (distribution.state !== 'running') {
        inspected.push(distribution)
        continue
      }
      try {
        const facts = await inspectRunningDistribution(distribution.name, options)
        inspected.push({
          ...distribution,
          osMetadata: facts.osMetadata,
          capabilities: facts.capabilities,
          network: {
            hostCandidates: hostCandidates(globalConfig, distribution.wslVersion, facts.defaultRoute, facts.resolvNameservers),
            resolvConf: facts.resolvNameservers,
            ...facts.defaultRoute === undefined ? {} : { defaultRoute: facts.defaultRoute },
            interfaces: facts.interfaces,
            environment: facts.environment,
            ...facts.wslConf === undefined ? {} : { wslConf: facts.wslConf },
            generatedBy: 'quiet-running',
          },
        })
      } catch (error) {
        inspected.push({ ...distribution, network: undefined })
        rawErrors.push(wslError(`wsl.inspect:${distribution.name}`, error))
      }
    }

    return {
      available,
      ...version === undefined ? {} : {
        version: version.wslVersion,
        kernelVersion: version.kernelVersion,
        windowsVersion: version.windowsVersion,
      },
      ...status.defaultDistribution === undefined ? {} : { defaultDistribution: status.defaultDistribution },
      ...status.defaultVersion === undefined ? {} : { defaultVersion: status.defaultVersion },
      ...globalConfig === undefined ? {} : { globalConfig },
      distributions: inspected,
      rawErrors,
    }
  } catch (error) {
    const local = await synthesizeCurrentDistribution(options)
    if (local !== undefined) {
      return {
        available: true,
        distributions: [local],
        rawErrors: [wslError('wsl.discover', error)],
      }
    }
    return { available: true, distributions: [], rawErrors: [wslError('wsl.discover', error)] }
  }
}

export function parseWslVersion(text: string): { wslVersion: string; kernelVersion: string; windowsVersion?: string } | undefined {
  const lines = text.replaceAll('\0', '').replaceAll('\r\n', '\n').split('\n').map(line => line.trim()).filter(line => line !== '')
  const wslVersion = lines.find(line => /wsl\s*(版本|version)/i.test(line))?.split(':').pop()?.trim()
  const kernelVersion = lines.find(line => /kernel|内核/i.test(line))?.split(':').pop()?.trim()
  const windowsVersion = lines.find(line => /^windows:/i.test(line))?.split(':').slice(1).join(':').trim()
  if (wslVersion === undefined && kernelVersion === undefined) return undefined
  return { wslVersion: wslVersion ?? '', kernelVersion: kernelVersion ?? '', ...windowsVersion === undefined ? {} : { windowsVersion } }
}

export function parseWslStatus(text: string, distributions: readonly WslDistribution[]): { defaultDistribution?: string; defaultVersion?: 1 | 2 } {
  const lines = text.replaceAll('\0', '').replaceAll('\r\n', '\n').split('\n').map(line => line.trim()).filter(line => line !== '')
  const versionLine = lines.find(line => /版本|version/i.test(line))
  const match = versionLine === undefined ? undefined : /:\s*([12])$/.exec(versionLine)
  const defaultDistribution = distributions.find(distribution => lines.some(line => line.includes(distribution.name)))?.name
  return {
    ...defaultDistribution === undefined ? {} : { defaultDistribution },
    ...match === null || match === undefined ? {} : { defaultVersion: Number(match[1]) as 1 | 2 },
  }
}

async function readGlobalWslConfig(options: InspectWslOptions, versionText: string): Promise<WslNetworkConfig | undefined> {
  const paths = wslconfigPaths()
  for (const path of paths) {
    try {
      const text = options.fixtures?.wslconfig ?? await readFile(path, 'utf8')
      const windowsBuild = windowsBuildOf(versionText)
      return parseWslGlobalConfig(text, windowsBuild)
    } catch {
      // Try the next candidate path.
    }
  }
  return undefined
}

export function windowsBuildOf(versionText: string): number | undefined {
  const match = /Windows:\s*([\d.]+)/.exec(versionText)
  const build = Number(match?.[1]?.split('.')[2] ?? '')
  return Number.isFinite(build) && build > 0 ? build : undefined
}

export function wslconfigPaths(): string[] {
  const home = homedir()
  if (process.platform === 'win32') return [join(home, '.wslconfig')]
  const user = home.split('/').pop() ?? ''
  return [join(home, '.wslconfig'), `/mnt/c/Users/${user}/.wslconfig`]
}

const DISTRO_SCRIPT = String.raw`
echo '---CAPS---'
[ -e /proc ] && echo PROC=1 || echo PROC=0
[ -e /etc/os-release ] && echo OSRELEASE=1 || echo OSRELEASE=0
[ -e /etc/resolv.conf ] && echo RESOLVCONF=1 || echo RESOLVCONF=0
[ -e /etc/wsl.conf ] && echo WSLCONF=1 || echo WSLCONF=0
if command -v sh >/dev/null 2>&1; then echo CMD_sh=1; else echo CMD_sh=0; fi
if command -v cat >/dev/null 2>&1; then echo CMD_cat=1; else echo CMD_cat=0; fi
if command -v ip >/dev/null 2>&1; then echo CMD_ip=1; else echo CMD_ip=0; fi
if command -v getent >/dev/null 2>&1; then echo CMD_getent=1; else echo CMD_getent=0; fi
if command -v curl >/dev/null 2>&1; then echo CMD_curl=1; else echo CMD_curl=0; fi
if command -v wget >/dev/null 2>&1; then echo CMD_wget=1; else echo CMD_wget=0; fi
if command -v python3 >/dev/null 2>&1; then echo CMD_python3=1; else echo CMD_python3=0; fi
if command -v python >/dev/null 2>&1; then echo CMD_python=1; else echo CMD_python=0; fi
echo '---OSRELEASE---'
cat /etc/os-release 2>/dev/null || true
echo '---RESOLVCONF---'
cat /etc/resolv.conf 2>/dev/null || true
echo '---ROUTE---'
ip route show default 2>/dev/null || true
echo '---IFACES---'
ip -o addr show 2>/dev/null || hostname -I 2>/dev/null || true
echo '---WSLCONF---'
cat /etc/wsl.conf 2>/dev/null || true
echo '---ENV---'
env | grep -E '^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)=' || true
echo '---DONE---'
`

interface DistroFacts {
  osMetadata: WslOsMetadata
  capabilities: WslCapabilities
  resolvNameservers: string[]
  defaultRoute?: string
  interfaces: WslLinuxInterface[]
  environment: EnvironmentScopeSnapshot
  wslConf?: NonNullable<WslNetworkInspection['wslConf']>
}

async function inspectRunningDistribution(name: string, options: InspectWslOptions): Promise<DistroFacts> {
  const text = await runDistroScript(name, options)
  return parseDistroFacts(text)
}

/** Run DISTRO_SCRIPT in the named distribution. The distribution this process
 *  runs in is inspected via local /bin/sh; others go through wsl.exe interop. */
async function runDistroScript(name: string, options: InspectWslOptions): Promise<string> {
  const launch = name === currentDistributionName()
    ? { file: '/bin/sh', args: [] as string[] }
    : wslLaunch(['-d', name, '--', '/bin/sh'])
  const result = await runCommand(launch.file, launch.args, {
    timeoutMs: WSL_DISTRO_TIMEOUT_MS,
    signal: options.signal,
    maxStdoutBytes: 512 * 1024,
    input: DISTRO_SCRIPT,
  })
  if (result.code !== 0) throw new Error(`${launch.file} for ${name} exited ${String(result.code)}: ${result.stderr.trim()}`)
  return decodeWslCommand(result.stdout)
}

/** Build the current distribution's entry from local files only (no interop). */
async function synthesizeCurrentDistribution(options: InspectWslOptions): Promise<WslDistribution | undefined> {
  const name = currentDistributionName()
  if (name === undefined) return undefined
  try {
    const facts = parseDistroFacts(await runDistroScript(name, options))
    const kernelText = await readFile('/proc/version', 'utf8').catch(() => '')
    const wslVersion = wslVersionFromKernel(kernelText)
    const globalConfig = await readGlobalWslConfig(options, '')
    return {
      name,
      state: 'running',
      ...wslVersion === undefined ? {} : { wslVersion },
      default: true,
      osMetadata: facts.osMetadata,
      capabilities: facts.capabilities,
      network: {
        hostCandidates: hostCandidates(globalConfig, wslVersion, facts.defaultRoute, facts.resolvNameservers),
        resolvConf: facts.resolvNameservers,
        ...facts.defaultRoute === undefined ? {} : { defaultRoute: facts.defaultRoute },
        interfaces: facts.interfaces,
        environment: facts.environment,
        ...facts.wslConf === undefined ? {} : { wslConf: facts.wslConf },
        generatedBy: 'local-facts',
      },
    }
  } catch {
    return undefined
  }
}

function currentDistributionName(): string | undefined {
  return process.platform === 'linux' ? process.env['WSL_DISTRO_NAME'] : undefined
}

export function parseDistroFacts(text: string): DistroFacts {
  const sections = new Map<string, string[]>()
  let current = ''
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const marker = /^---([A-Z]+)---$/.exec(line)
    if (marker !== null) {
      current = marker[1] ?? ''
      sections.set(current, [])
      continue
    }
    if (current !== '') sections.get(current)?.push(line)
  }

  const caps = new Set((sections.get('CAPS') ?? []).filter(line => line.endsWith('=1')).map(line => line.slice(0, -2)))
  const command = (name: string): boolean => caps.has(`CMD_${name}`)
  const osMetadata = parseOsRelease((sections.get('OSRELEASE') ?? []).join('\n'))
  const resolvNameservers = (sections.get('RESOLVCONF') ?? [])
    .filter(line => /^\s*nameserver\s+/i.test(line))
    .map(line => line.replace(/^\s*nameserver\s+/i, '').trim())
  const routeLine = (sections.get('ROUTE') ?? []).find(line => /^default\s+/i.test(line))
  const defaultRoute = routeLine === undefined ? undefined : routeLine.trim().split(/\s+/)[2]
  const interfaces = parseWslLinuxInterfaces((sections.get('IFACES') ?? []).join('\n'))
  const envLines = sections.get('ENV') ?? []
  const environment: Record<string, unknown> = {}
  for (const line of envLines) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    environment[line.slice(0, index)] = line.slice(index + 1)
  }
  const wslConf = parseWslConf((sections.get('WSLCONF') ?? []).join('\n'))
  const hasWslConf = Object.keys(wslConf).length > 0

  return {
    osMetadata,
    capabilities: {
      proc: caps.has('PROC'),
      osRelease: caps.has('OSRELEASE'),
      resolvConf: caps.has('RESOLVCONF'),
      wslConf: caps.has('WSLCONF'),
      commands: {
        sh: command('sh'),
        cat: command('cat'),
        ip: command('ip'),
        getent: command('getent'),
        curl: command('curl'),
        wget: command('wget'),
        python3: command('python3'),
        python: command('python'),
      },
    },
    resolvNameservers,
    ...defaultRoute === undefined ? {} : { defaultRoute },
    interfaces,
    environment: proxyEnvironmentOf(environment),
    ...hasWslConf ? { wslConf: wslConf as NonNullable<WslNetworkInspection['wslConf']> } : {},
  }
}

export function parseWslLinuxInterfaces(text: string): WslLinuxInterface[] {
  const interfaces = new Map<string, WslLinuxInterface>()
  const add = (name: string, address: string): void => {
    if (name === '' || address === '') return
    const entry = interfaces.get(name) ?? { name, ipv4: [], ipv6: [] }
    if (address.includes(':')) entry.ipv6.push(address)
    else entry.ipv4.push(address)
    interfaces.set(name, entry)
  }
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const ipMatch = /^\d+:\s+([^\s@]+).*?\s+inet6?\s+([0-9a-fA-F:.]+)/.exec(trimmed)
    if (ipMatch !== null) add(ipMatch[1] ?? '', ipMatch[2] ?? '')
    for (const part of trimmed.split(/\s+/)) {
      const candidate = part.trim()
      if (candidate === '') continue
      if (candidate.includes(':') && candidate.includes('.')) continue
      if (/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(candidate)) add(guessInterfaceName(text, candidate), candidate)
    }
  }
  const output = [...interfaces.values()]
  if (output.length > 0) return output
  // hostname -I fallback outputs only addresses; put them on a pseudo-interface.
  const addresses = text.trim().split(/\s+/).filter(entry => /^[0-9a-fA-F:.]+$/.test(entry))
  if (addresses.length > 0) return [{ name: 'linux', ipv4: addresses.filter(entry => !entry.includes(':')), ipv6: addresses.filter(entry => entry.includes(':')) }]
  return []
}

function guessInterfaceName(text: string, address: string): string {
  const match = /^\d+:\s+([^\s@]+).*?\s+inet\s+[0-9a-fA-F:.]+/.exec(text)
  return match?.[1] ?? 'linux'
}

function parseOsRelease(text: string): WslOsMetadata {
  const result: WslOsMetadata = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (match === null) continue
    const key = match[1]
    const value = (match[2] ?? '').replace(/^['"]|['"]$/g, '')
    if (key === 'PRETTY_NAME') result.prettyName = value
    if (key === 'ID') result.id = value
    if (key === 'VERSION_ID') result.versionId = value
    if (key === 'VERSION_CODENAME') result.versionCodename = value
  }
  return result
}

export function hostCandidates(
  config: WslNetworkConfig | undefined,
  wslVersion: 1 | 2 | undefined,
  defaultRoute: string | undefined,
  resolvNameservers: readonly string[],
): HostCandidate[] {
  const candidates: HostCandidate[] = []
  if (wslVersion === 1) {
    candidates.push({ address: '127.0.0.1', source: 'wsl1', confidence: 0.9 })
  } else if (config?.mode === 'mirrored') {
    candidates.push({ address: '127.0.0.1', source: 'wsl-config-mirrored', confidence: 0.9 })
  } else {
    if (defaultRoute !== undefined && defaultRoute !== '') {
      candidates.push({ address: defaultRoute, source: 'default-route', confidence: 0.8 })
    }
    for (const nameserver of resolvNameservers) {
      if (nameserver !== defaultRoute) candidates.push({ address: nameserver, source: 'resolv-conf', confidence: 0.4 })
    }
  }
  candidates.push({ address: '127.0.0.1', source: 'fallback', confidence: 0.2 })
  return candidates
}

function wslError(id: string, error: unknown): ProbeCheck {
  const message = error instanceof Error ? error.message : String(error)
  return {
    status: 'error',
    errorCode: 'WSL_INSPECT_FAILED',
    humanMessage: '无法读取 WSL 信息',
    technicalMessage: `${id}: ${message}`,
    source: 'wsl.exe',
    timestamp: new Date().toISOString(),
  }
}
