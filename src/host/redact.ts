/** Deterministic secret redaction for diagnostic reports and snapshots. */
import { parseProxyUrl } from './proxy/proxy-url.ts'

const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|authorization|proxy[_-]?authorization|cookie|credential)/i

export const REDACTED = '***'

/** Strip `user:pass@` from any http(s)/socks URL text while preserving shape. */
export function redactUrlCredentials(text: string): string {
  const trimmed = text.trim()
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) return trimmed
  const scheme = trimmed.slice(0, trimmed.indexOf('://'))
  const rest = trimmed.slice(trimmed.indexOf('://') + 3)
  const slash = rest.indexOf('/')
  const authority = slash < 0 ? rest : rest.slice(0, slash)
  const tail = slash < 0 ? '' : rest.slice(slash)
  const at = authority.lastIndexOf('@')
  if (at < 0) return trimmed
  return `${scheme}://${authority.slice(at + 1)}${tail}`
}

/** Strip credentials from a proxy URL. */
export function redactProxyUrl(text: string): string {
  try {
    return parseProxyUrl(text).url
  } catch {
    return redactUrlCredentials(text)
  }
}

/**
 * Recursively redact JSON-shaped report data:
 * - keys matching secret vocabulary become `***`;
 * - string values matching URL/proxy shapes have credentials stripped;
 * - arrays and plain objects are traversed.
 */
export function redact(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((entry, index) => redact(entry, [...path, String(index)]))
  if (value === null || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value.trim()) ? redactUrlCredentials(value) : value
  }
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      output[key] = REDACTED
      continue
    }
    output[key] = redact(entry, [...path, key])
  }
  return output
}
