/** Snapshot persistence for network configuration changes. */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { networkDataDir } from '../runtime/store.ts'
import { redact } from '../redact.ts'

export type SnapshotScope =
  | 'windows.wininet'
  | 'windows.winhttp.user'
  | 'windows.winhttp.machine'
  | 'windows.env.user'
  | 'windows.env.machine'
  | 'windows.wslconfig'
  | 'windows.hosts'
  | 'dsh.process'
  | `wsl.${string}`

export interface SnapshotRecord {
  id: string
  timestamp: string
  reason: string
  scope: SnapshotScope
  before: unknown
  after?: unknown
  reversible: boolean
}

function snapshotsDir(): string {
  return join(networkDataDir(), 'snapshots')
}

export async function saveSnapshot(record: Omit<SnapshotRecord, 'id' | 'timestamp'> & { id?: string }): Promise<SnapshotRecord> {
  const id = record.id ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const redactedBefore = redact(record.before)
  const reversible = record.reversible && JSON.stringify(record.before) === JSON.stringify(redactedBefore)
  const full: SnapshotRecord = {
    ...record,
    id,
    timestamp: new Date().toISOString(),
    before: redactedBefore,
    reversible,
    ...record.after === undefined ? {} : { after: redact(record.after) },
  }
  const dir = snapshotsDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  const temp = `${path}.tmp`
  await writeFile(temp, JSON.stringify(full, null, 2), 'utf8')
  await rename(temp, path)
  return full
}

export async function listSnapshots(): Promise<SnapshotRecord[]> {
  const dir = snapshotsDir()
  try {
    const files = await readdir(dir)
    const records: SnapshotRecord[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        records.push(JSON.parse(await readFile(join(dir, file), 'utf8')) as SnapshotRecord)
      } catch {
        // Corrupt snapshot files are ignored; they never block configuration.
      }
    }
    return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  } catch {
    return []
  }
}

export async function latestSnapshot(scope: SnapshotScope): Promise<SnapshotRecord | undefined> {
  return (await listSnapshots()).find(record => record.scope === scope)
}

export async function updateSnapshotAfter(id: string, after: unknown): Promise<void> {
  const dir = snapshotsDir()
  const path = join(dir, `${id}.json`)
  const current = JSON.parse(await readFile(path, 'utf8')) as SnapshotRecord
  const next: SnapshotRecord = { ...current, after: redact(after) }
  const temp = `${path}.tmp`
  await writeFile(temp, JSON.stringify(next, null, 2), 'utf8')
  await rename(temp, path)
}
