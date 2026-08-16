/**
 * Proxy URL/endpoint parsing. Credentials are stripped immediately — they must
 * never enter snapshots, reports or UI state.
 */
import type { ProxyEndpoint, ProxySource } from '../model.ts'

export interface ParsedProxyUrl {
  url: string
  host: string
  port: number
  protocol: 'http' | 'socks' | 'socks5' | 'unknown'
  hasCredentials: boolean
  schemeExplicit: boolean
}

const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  socks: 1080,
  socks5: 1080,
}

/**
 * Parse one proxy endpoint. Accepted shapes:
 *   http://127.0.0.1:7890, 127.0.0.1:7890, http://user:pass@host:8080,
 *   socks5://[::1]:1080, proxy.example.com (default http/80).
 */
export function parseProxyUrl(raw: string): ParsedProxyUrl {
  const input = raw.trim()
  if (input === '') throw new Error('empty proxy endpoint')

  let scheme: string | undefined
  let rest = input
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input)) {
    const index = input.indexOf('://')
    scheme = input.slice(0, index).toLowerCase()
    rest = input.slice(index + 3)
  }

  const authority = rest.split('/')[0] ?? ''
  if (authority === '') throw new Error(`invalid proxy endpoint: ${input}`)

  let host = authority
  let explicitPort: string | undefined
  const at = authority.lastIndexOf('@')
  if (at >= 0) host = authority.slice(at + 1)
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close < 0) throw new Error(`invalid IPv6 proxy endpoint: ${input}`)
    const address = host.slice(1, close)
    const tail = host.slice(close + 1)
    if (tail.startsWith(':')) explicitPort = tail.slice(1)
    host = address
  } else {
    const firstColon = host.indexOf(':')
    const lastColon = host.lastIndexOf(':')
    if (firstColon >= 0 && firstColon === lastColon) {
      explicitPort = host.slice(firstColon + 1)
      host = host.slice(0, firstColon)
    }
  }

  if (host === '') throw new Error(`invalid proxy endpoint: ${input}`)
  const port = explicitPort === undefined || explicitPort === ''
    ? DEFAULT_PORTS[scheme ?? 'http'] ?? 80
    : Number(explicitPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid proxy port: ${input}`)

  const protocol = normalizeProtocol(scheme)
  const schemeExplicit = scheme !== undefined
  const normalizedScheme = protocol === 'unknown' ? 'http' : protocol
  const hostPart = host.includes(':') ? `[${host}]` : host
  return {
    url: `${normalizedScheme}://${hostPart}:${port}`,
    host,
    port,
    protocol,
    hasCredentials: at >= 0,
    schemeExplicit,
  }
}

function normalizeProtocol(scheme: string | undefined): ParsedProxyUrl['protocol'] {
  const normalized = scheme?.toLowerCase()
  if (normalized === 'http' || normalized === undefined || normalized === '') return 'http'
  if (normalized === 'socks' || normalized === 'socks5' || normalized === 'socks5h') return normalized === 'socks5h' ? 'socks5' : normalized as 'socks' | 'socks5'
  return 'unknown'
}

/** Parse one source value into ProxyEndpoint rows (credentials already dropped). */
export function proxyEndpointsFromValue(value: string, source: ProxySource): ProxyEndpoint[] {
  if (value.trim() === '') return []
  const entries = value.split(/[;,]/).map(entry => entry.trim()).filter(entry => entry !== '')
  return entries.map((entry, index) => {
    let parsed: ParsedProxyUrl
    try {
      parsed = parseProxyUrl(entry)
    } catch {
      return {
        source,
        url: entry,
        host: '',
        port: 0,
        protocol: 'unknown' as const,
        configured: true,
      }
    }
    return {
      source,
      url: parsed.url,
      host: parsed.host,
      port: parsed.port,
      protocol: parsed.protocol,
      configured: true,
    }
  })
}
