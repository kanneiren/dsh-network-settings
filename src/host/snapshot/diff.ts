/** JSON-shaped before/after diff used in preview and history. */

export interface DiffEntry {
  path: string
  before: unknown
  after: unknown
}

export function diffJson(before: unknown, after: unknown, path = '$'): DiffEntry[] {
  if (Object.is(before, after)) return []
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null || Array.isArray(before) || Array.isArray(after)) {
    return [{ path, before, after }]
  }
  const entries: DiffEntry[] = []
  const keys = new Set([...Object.keys(before as Record<string, unknown>), ...Object.keys(after as Record<string, unknown>)])
  for (const key of keys) {
    const beforeValue = (before as Record<string, unknown>)[key]
    const afterValue = (after as Record<string, unknown>)[key]
    entries.push(...diffJson(beforeValue, afterValue, `${path}.${key}`))
  }
  return entries
}

export function summarizeDiff(entries: DiffEntry[]): string[] {
  return entries.map(entry => `${entry.path}: ${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`)
}
