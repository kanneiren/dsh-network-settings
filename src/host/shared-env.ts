/** Platform-neutral environment and hosts parsing, shared by all runtime
 *  model collectors. Module facade — public surface: proxyEnvironmentOf(),
 *  parseHostsEntries(). */
import type { EnvironmentScopeSnapshot, HostsInspection } from './model.ts'

/** Pick the 8 proxy variables (both letter cases) from a raw env record. */
export function proxyEnvironmentOf(source: Record<string, unknown>): EnvironmentScopeSnapshot {
  const pick = (upper: string, lower: string): string | undefined => {
    const value = source[upper] ?? source[lower]
    return typeof value === 'string' ? value : undefined
  }
  return {
    ...pick('HTTP_PROXY', 'http_proxy') === undefined ? {} : { HTTP_PROXY: pick('HTTP_PROXY', 'http_proxy') },
    ...pick('HTTPS_PROXY', 'https_proxy') === undefined ? {} : { HTTPS_PROXY: pick('HTTPS_PROXY', 'https_proxy') },
    ...pick('ALL_PROXY', 'all_proxy') === undefined ? {} : { ALL_PROXY: pick('ALL_PROXY', 'all_proxy') },
    ...pick('NO_PROXY', 'no_proxy') === undefined ? {} : { NO_PROXY: pick('NO_PROXY', 'no_proxy') },
    ...pick('http_proxy', 'HTTP_PROXY') === undefined ? {} : { http_proxy: pick('http_proxy', 'HTTP_PROXY') },
    ...pick('https_proxy', 'HTTPS_PROXY') === undefined ? {} : { https_proxy: pick('https_proxy', 'HTTPS_PROXY') },
    ...pick('all_proxy', 'ALL_PROXY') === undefined ? {} : { all_proxy: pick('all_proxy', 'ALL_PROXY') },
    ...pick('no_proxy', 'NO_PROXY') === undefined ? {} : { no_proxy: pick('no_proxy', 'NO_PROXY') },
  }
}

export interface HostsEntry {
  id: string
  ip: string
  hostnames: string[]
  line: number
  raw: string
}

/** Parse non-comment hosts file entries with line numbers. */
export function parseHostsEntries(text: string): HostsEntry[] {
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .flatMap((raw, index) => {
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed.startsWith('#')) return []
      const tokens = trimmed.split(/\s+/)
      if (tokens.length < 2 || tokens[0] === undefined) return []
      const hostnames = tokens.slice(1)
      if (hostnames.length === 0) return []
      return [{
        id: `hosts:${index + 1}`,
        ip: tokens[0],
        hostnames,
        line: index + 1,
        raw,
      }]
    })
}
