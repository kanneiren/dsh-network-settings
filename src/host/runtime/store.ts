/** Small local JSON persistence for the plugin (last report cache). */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function networkDataDir(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'dsh-network-settings')
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(join(networkDataDir(), file), 'utf8')) as T
  } catch {
    return undefined
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  const path = join(networkDataDir(), file)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value), 'utf8')
  await rename(temp, path)
}
