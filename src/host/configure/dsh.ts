/** DSH-scoped configuration: current-process proxy env + durable local file. */
import type { EnvironmentScopeSnapshot } from '../model.ts'
import { readJson, writeJson } from '../runtime/store.ts'
import { proxyEnvironmentOf } from '../shared-env.ts'

const DSH_CONFIG_FILE = 'dsh-config.json'

export interface DshProxyConfig {
  HTTP_PROXY?: string
  HTTPS_PROXY?: string
  NO_PROXY?: string
  http_proxy?: string
  https_proxy?: string
  no_proxy?: string
}

export interface DshConfig {
  proxy?: DshProxyConfig
  updatedAt?: string
}

export function snapshotDshProcessEnvironment(): EnvironmentScopeSnapshot {
  return proxyEnvironmentOf(process.env)
}

export async function readDshConfig(): Promise<DshConfig> {
  return await readJson<DshConfig>(DSH_CONFIG_FILE) ?? {}
}

export async function writeDshConfig(config: DshConfig): Promise<void> {
  await writeJson(DSH_CONFIG_FILE, { ...config, updatedAt: new Date().toISOString() })
}

function applyEntry(name: string, value: string | undefined): void {
  if (value === undefined || value === '') {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

/** Apply a durable proxy section to the current DSH process. */
export function applyDshProxyConfig(proxy: DshProxyConfig | undefined): void {
  for (const [name, value] of Object.entries(proxy ?? {}) as [string, string | undefined][]) {
    if (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' || name === 'NO_PROXY'
      || name === 'http_proxy' || name === 'https_proxy' || name === 'no_proxy') {
      applyEntry(name, value)
    }
  }
}

/** Set (or clear, with `value === ''`) the DSH process proxy and persist it. */
export async function setDshProcessProxy(proxy: DshProxyConfig): Promise<EnvironmentScopeSnapshot> {
  const before = snapshotDshProcessEnvironment()
  const previous = await readDshConfig()
  const next: DshConfig = { ...previous, proxy: proxy }
  await writeDshConfig(next)
  applyDshProxyConfig(proxy)
  return before
}

export async function clearDshProcessProxy(): Promise<EnvironmentScopeSnapshot> {
  return setDshProcessProxy({})
}
