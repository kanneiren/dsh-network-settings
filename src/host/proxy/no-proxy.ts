/** NO_PROXY matching for Windows and WSL environment surfaces. */

export interface NoProxyRule {
  raw: string
  /** Host only, before an optional `:port` suffix. */
  host: string
  port?: string
}

export function parseNoProxy(value: string): NoProxyRule[] {
  if (value.trim() === '') return []
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .map(entry => {
      let host = entry
      let port: string | undefined
      if (entry.startsWith('[')) {
        const close = entry.indexOf(']')
        if (close >= 0) {
          host = entry.slice(0, close + 1)
          const tail = entry.slice(close + 1)
          if (tail.startsWith(':')) port = tail.slice(1)
        }
      } else {
        const colon = entry.lastIndexOf(':')
        if (colon > 0 && entry.indexOf(':') === colon) {
          host = entry.slice(0, colon)
          port = entry.slice(colon + 1)
        }
      }
      return { raw: entry, host, ...port === undefined ? {} : { port } }
    })
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * Whether `hostname` bypasses the proxy. Matches NO_PROXY conventions:
 * exact host, `.domain` suffix, `*` wildcard, IPv4/IPv6 literal. An entry
 * with a port only matches when the caller supplies that port.
 */
export function matchesNoProxy(rules: readonly NoProxyRule[], hostname: string, port?: number): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  for (const rule of rules) {
    if (rule.port !== undefined && port !== undefined && rule.port !== String(port)) continue
    const candidate = rule.host.toLowerCase().replace(/^\./, '')
    if (candidate === '' || candidate === '*') return true
    if (rule.host.startsWith('.')) {
      if (host === candidate || host.endsWith(`.${candidate}`)) return true
      continue
    }
    if (rule.host.includes('*')) {
      if (globToRegExp(rule.host).test(host)) return true
      continue
    }
    if (host === candidate) return true
  }
  return false
}
