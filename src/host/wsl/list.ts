/**
 * WSL distribution-list parsers. They never execute wsl.exe; callers pass the
 * decoded outputs. Parser tests cover UTF-16LE/CRLF, localized headers,
 * distribution names containing spaces, default markers, and missing WSL.
 */
import type { WslDistribution, WslDistributionState } from '../model.ts'

export interface WslListOutputs {
  quiet?: string
  running?: string
  verbose?: string
}

export interface LxssRegistryRecord {
  DistributionName?: unknown
  Version?: unknown
  DefaultUid?: unknown
  Flags?: unknown
}

/** Strip a possible `*` default-distribution marker. */
export function stripDefaultMarker(line: string): string {
  const trimmed = line.trim()
  if (trimmed.startsWith('*')) return trimmed.slice(1).trimStart()
  return trimmed
}

/** One non-empty line from a WSL text output, normalized to LF and stripped of NUL. */
export function wslLines(text: string): string[] {
  return text
    .replaceAll('\0', '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
}

/** Parse `wsl.exe --list --quiet` output: one registered name per line. */
export function parseQuietList(text: string): string[] {
  return wslLines(text).map(stripDefaultMarker).filter(name => name !== '')
}

/** Names from `wsl.exe --list --running`. Header/prelude lines are ignored by name matching. */
export function parseRunningList(text: string): string[] {
  return wslLines(text).map(stripDefaultMarker).filter(name => name !== '')
}

function parseVersionToken(token: string): 1 | 2 | undefined {
  const match = /^([12])$/.exec(token)
  return match === null ? undefined : Number(match[1]) as 1 | 2
}

/**
 * Parse the verbose table. The name column may contain spaces, so parsing goes
 * right-to-left: optional version first, optional localized state second, the
 * rest is the registered name (after the default marker).
 */
export function parseVerboseRow(line: string): { name: string; state?: string; version?: 1 | 2; default: boolean } {
  const isDefault = line.trimStart().startsWith('*')
  const stripped = stripDefaultMarker(line)
  const tokens = stripped.trim().split(/\s+/)
  let cursor = tokens.length
  let version: 1 | 2 | undefined
  let state: string | undefined
  if (cursor > 0) {
    const parsed = parseVersionToken(tokens[cursor - 1] ?? '')
    if (parsed !== undefined) {
      version = parsed
      cursor -= 1
      if (cursor > 0) {
        state = tokens[cursor - 1]
        cursor -= 1
      }
    }
  }
  return { name: tokens.slice(0, cursor).join(' '), default: isDefault, ...version === undefined ? {} : { version }, ...state === undefined ? {} : { state } }
}

function isHeader(line: string): boolean {
  // The verbose table header is localized ("NAME STATE VERSION",
  // "名称 状态 版本", …). Match the first token of the canonical/known
  // localized forms; a distribution name colliding with the literal first
  // token is accepted as a negligible edge case (quiet output is preferred).
  const trimmed = line.trim()
  return /^(name|名称|名前)(\s|$)/i.test(trimmed)
}

/** Derive state from the `--list --running` name set plus verbose state token. */
function stateOf(name: string, runningNames: ReadonlySet<string>, verboseState?: string): WslDistributionState {
  if (runningNames.has(name)) return 'running'
  if (verboseState === undefined) return 'unknown'
  return 'stopped'
}

/**
 * Combine `--list --quiet`, `--list --running` and `--list --verbose` into
 * WslDistribution records. Quiet names are authoritative (verbatim registered
 * names, including spaces). When quiet is unavailable, verbose rows are used.
 */
export function parseWslList(outputs: WslListOutputs): WslDistribution[] {
  const quietNames = outputs.quiet === undefined ? [] : parseQuietList(outputs.quiet)
  const runningNames = new Set(outputs.running === undefined ? [] : parseRunningList(outputs.running))
  const verboseRows = outputs.verbose === undefined
    ? []
    : wslLines(outputs.verbose)
      .filter(line => !isHeader(line))
      .map(parseVerboseRow)
      .filter(row => row.name !== '' && !isHeader(row.name))

  const verboseByName = new Map(verboseRows.map(row => [row.name, row]))

  if (quietNames.length > 0) {
    return quietNames.map((name, index) => {
      const row = verboseByName.get(name)
      const version = row?.version
      return {
        name,
        state: stateOf(name, runningNames, row?.state),
        ...version === undefined ? {} : { wslVersion: version },
        default: row?.default ?? false,
      }
    })
  }

  return verboseRows.map(row => ({
    name: row.name,
    state: stateOf(row.name, runningNames, row.state),
    ...row.version === undefined ? {} : { wslVersion: row.version },
    default: row.default,
  }))
}

/** Lxss registry fallback (names/versions/default user; running state unknown). */
export function distributionsFromRegistry(records: LxssRegistryRecord[]): WslDistribution[] {
  const result: WslDistribution[] = []
  for (const record of records) {
    const name = typeof record.DistributionName === 'string' ? record.DistributionName : undefined
    if (name === undefined || name === '') continue
    const version = record.Version === 1 || record.Version === 2 ? record.Version : undefined
    result.push({
      name,
      state: 'unknown',
      ...version === undefined ? {} : { wslVersion: version },
      default: false,
    })
  }
  return result
}
