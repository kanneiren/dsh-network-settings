/**
 * INI parsers for `%UserProfile%\.wslconfig` (WSL global, Windows side) and
 * `/etc/wsl.conf` (per-distribution, Linux side). Parsing is locale-independent
 * and capability-based; distribution identity is never used for decisions.
 */
import type { WslNetworkConfig } from '../model.ts'

export interface IniDocument {
  [section: string]: Record<string, string>
}

const SECTION = /^\s*\[([^\]]+)\]\s*$/
const KEY_VALUE = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/

/** Parse a minimal INI file. Comments (`#`/`;`), inline comments and repeated keys (last wins). */
export function parseIni(text: string): IniDocument {
  const document: IniDocument = {}
  let section = ''
  for (const raw of text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
    const line = stripInlineComment(raw).trim()
    if (line === '') continue
    const sectionMatch = SECTION.exec(line)
    if (sectionMatch !== null) {
      section = sectionMatch[1] ?? ''
      document[section] ??= {}
      continue
    }
    const pair = KEY_VALUE.exec(line)
    if (pair === null || section === '') continue
    const key = (pair[1] ?? '').trim()
    const value = (pair[2] ?? '').trim()
    if (key === '' || value === '') continue
    document[section] ??= {}
    document[section]![key] = value
  }
  return document
}

function stripInlineComment(line: string): string {
  let quote: "'" | '"' | undefined
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === "'" || char === '"') {
      if (quote === char) quote = undefined
      else if (quote === undefined) quote = char
    } else if ((char === '#' || char === ';') && quote === undefined) {
      return line.slice(0, index)
    }
  }
  return line
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1') return true
  if (normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0') return false
  return undefined
}

function parseIntValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Windows 11 22H2 build threshold used by the WSL networking docs. */
export const WSL_NETWORK_FEATURE_MIN_BUILD = 22621

export function supportsWslNetworkFeatures(windowsBuild: number | undefined): boolean {
  return windowsBuild !== undefined && windowsBuild >= WSL_NETWORK_FEATURE_MIN_BUILD
}

export const WSL_NETWORK_MODES = ['none', 'nat', 'bridged', 'mirrored', 'virtioproxy'] as const

export function normalizeNetworkMode(value: string | undefined): { mode: string; known: boolean } {
  if (value === undefined || value === '') return { mode: 'nat', known: true }
  const normalized = value.toLowerCase()
  if ((WSL_NETWORK_MODES as readonly string[]).includes(normalized)) return { mode: normalized, known: true }
  // WSL docs: an unknown value is treated as NAT (starting with WSL 2.3.25).
  return { mode: 'nat', known: false }
}

export function defaultWslNetworkConfig(windowsBuild?: number): WslNetworkConfig {
  return {
    mode: 'nat',
    modeConfigured: false,
    modeSupported: supportsWslNetworkFeatures(windowsBuild),
    dnsTunneling: true,
    autoProxy: true,
    dnsProxy: true,
    localhostForwarding: true,
    firewall: true,
  }
}

/**
 * Parse `.wslconfig`. Keys may live in `[wsl2]` or `[experimental]`; explicit
 * values win over defaults, and `[wsl2]` wins over `[experimental]`.
 */
export function parseWslGlobalConfig(text: string, windowsBuild?: number): WslNetworkConfig {
  const document = parseIni(text)
  const wsl2 = document['wsl2'] ?? {}
  const experimental = document['experimental'] ?? {}
  const value = (key: string): string | undefined => wsl2[key] ?? experimental[key]
  const normalized = normalizeNetworkMode(value('networkingMode'))
  const base = defaultWslNetworkConfig(windowsBuild)

  const ignoredPortsRaw = value('ignoredPorts')
  return {
    mode: normalized.mode,
    modeConfigured: value('networkingMode') !== undefined,
    modeSupported: base.modeSupported && normalized.known,
    ...parseBoolean(value('dnsTunneling')) === undefined ? { dnsTunneling: base.dnsTunneling } : { dnsTunneling: parseBoolean(value('dnsTunneling')) },
    ...parseBoolean(value('autoProxy')) === undefined ? { autoProxy: base.autoProxy } : { autoProxy: parseBoolean(value('autoProxy')) },
    ...parseBoolean(value('dnsProxy')) === undefined ? { dnsProxy: base.dnsProxy } : { dnsProxy: parseBoolean(value('dnsProxy')) },
    ...parseBoolean(value('localhostForwarding')) === undefined ? { localhostForwarding: base.localhostForwarding } : { localhostForwarding: parseBoolean(value('localhostForwarding')) },
    ...parseBoolean(value('firewall')) === undefined ? { firewall: base.firewall } : { firewall: parseBoolean(value('firewall')) },
    ...ignoredPortsRaw === undefined ? {} : { ignoredPorts: ignoredPortsRaw.split(',').map(part => part.trim()).filter(part => part !== '') },
    ...parseBoolean(value('hostAddressLoopback')) === undefined ? {} : { hostAddressLoopback: parseBoolean(value('hostAddressLoopback')) },
    ...parseIntValue(value('initialAutoProxyTimeout')) === undefined ? {} : { initialAutoProxyTimeoutMs: parseIntValue(value('initialAutoProxyTimeout')) },
  }
}

export interface WslConfNetwork {
  generateResolvConf?: boolean
  generateHosts?: boolean
  hostname?: string
}

export interface WslConfBoot {
  systemd?: boolean
}

export interface WslConfInterop {
  enabled?: boolean
  appendWindowsPath?: boolean
}

export interface WslConfDocument {
  network?: WslConfNetwork
  boot?: WslConfBoot
  interop?: WslConfInterop
}

/** Parse per-distribution `/etc/wsl.conf`. */
export function parseWslConf(text: string): WslConfDocument {
  const document = parseIni(text)
  const network = document['network']
  const boot = document['boot']
  const interop = document['interop']
  return {
    ...network === undefined ? {} : {
      network: {
        ...parseBoolean(network['generateResolvConf']) === undefined ? {} : { generateResolvConf: parseBoolean(network['generateResolvConf']) },
        ...parseBoolean(network['generateHosts']) === undefined ? {} : { generateHosts: parseBoolean(network['generateHosts']) },
        ...network['hostname'] === undefined ? {} : { hostname: network['hostname'] },
      },
    },
    ...boot === undefined ? {} : { boot: { ...parseBoolean(boot['systemd']) === undefined ? {} : { systemd: parseBoolean(boot['systemd']) } } },
    ...interop === undefined ? {} : {
      interop: {
        ...parseBoolean(interop['enabled']) === undefined ? {} : { enabled: parseBoolean(interop['enabled']) },
        ...parseBoolean(interop['appendWindowsPath']) === undefined ? {} : { appendWindowsPath: parseBoolean(interop['appendWindowsPath']) },
      },
    },
  }
}
