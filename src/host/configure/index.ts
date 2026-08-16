/** Scoped configuration coordinator: snapshot before every persistent change. */
import { saveSnapshot, updateSnapshotAfter, type SnapshotScope } from '../snapshot/store.ts'
import { diffJson, summarizeDiff, type DiffEntry } from '../snapshot/diff.ts'
import type { EnvironmentScopeSnapshot, WinHttpProxyInspection, WinInetProxyInspection } from '../model.ts'
import {
  clearEnvironmentProxy, clearWinHttpUserProxy, clearWinInetUserProxy, readEnvironmentScope, readWinHttpMachineProxy, readWinHttpUserProxy, readWinInetProxy,
  replaceEnvironmentScope, setEnvironmentVariable, setWinHttpMachineProxy, setWinHttpUserProxy, setWinInetUserProxy,
  type EnvScopeName, type WinHttpProxyPatch, type WinInetProxyPatch,
} from './windows.ts'
import { clearDshProcessProxy, setDshProcessProxy, snapshotDshProcessEnvironment, type DshProxyConfig } from './dsh.ts'
import { readWslAutoProxyConfig, setWslAutoProxy } from './wslconfig.ts'
import type { WslNetworkConfig } from '../model.ts'

export type ConfigureScope =
  | 'windows.wininet'
  | 'windows.winhttp.user'
  | 'windows.winhttp.machine'
  | 'windows.env.user'
  | 'windows.env.machine'
  | 'windows.wslconfig'
  | 'dsh.process'

export interface WslConfigPatch {
  autoProxy: boolean
}

export interface ConfigureRequest {
  scope: ConfigureScope
  action: 'set' | 'clear' | 'unset'
  patch?: WinInetProxyPatch | WinHttpProxyPatch | DshProxyConfig | WslConfigPatch
  name?: string
  value?: string
  values?: Record<string, string | undefined>
}

export interface ConfigurePreview {
  scope: ConfigureScope
  scopeDescription: string
  before: unknown
  after: unknown
  diff: DiffEntry[]
  diffText: string[]
  requiresElevation: boolean
}

export interface ConfigureResult extends ConfigurePreview {
  snapshotId: string
  applied: true
}

const SCOPE_DESCRIPTIONS: Record<ConfigureScope, string> = {
  'windows.wininet': '只会修改 Windows 当前用户的代理设置（WinINet）。不会修改 WinHTTP、WSL、环境变量或 DSH。',
  'windows.winhttp.user': '只会修改当前用户的 WinHTTP 高级代理设置。不会修改 Windows 用户代理（WinINet）、WSL、环境变量或 DSH。',
  'windows.winhttp.machine': '只会修改 Windows WinHTTP 机器级高级代理设置，执行时可能弹出 UAC。不会修改用户级 WinHTTP、Windows 用户代理（WinINet）、WSL、环境变量或 DSH。',
  'windows.env.user': '只会修改当前 Windows 用户的环境变量。不会修改 Machine 环境变量、Windows 代理、WSL 或 DSH。',
  'windows.env.machine': '只会修改 Windows Machine 环境变量，执行时可能弹出 UAC。不会修改 User 环境变量、Windows 代理、WSL 或 DSH。',
  'windows.wslconfig': '只会修改 Windows 侧 .wslconfig 的 autoProxy。修改后需要重启 WSL 才能对运行中的发行版生效。',
  'dsh.process': '只会修改当前 DSH 进程的代理环境变量，并写入 DSH 网络插件配置。不会修改 Windows 网络、WSL 或代理软件。',
}

function normalizeRequest(request: ConfigureRequest): ConfigureRequest {
  if (!Object.hasOwn(SCOPE_DESCRIPTIONS, request.scope)) throw new Error(`unknown configure scope: ${request.scope}`)
  return request
}

async function readBefore(scope: ConfigureScope): Promise<unknown> {
  switch (scope) {
    case 'windows.wininet': return readWinInetProxy()
    case 'windows.winhttp.user': return await readWinHttpUserProxy()
    case 'windows.winhttp.machine': return await readWinHttpMachineProxy()
    case 'windows.env.user': return readEnvironmentScope('user')
    case 'windows.env.machine': return readEnvironmentScope('machine')
    case 'windows.wslconfig': return readWslAutoProxyConfig()
    case 'dsh.process': return snapshotDshProcessEnvironment()
  }
}

async function applyScoped(request: ConfigureRequest): Promise<unknown> {
  switch (request.scope) {
    case 'windows.wininet': {
      if (request.action === 'clear') return clearWinInetUserProxy()
      const patch = request.patch as WinInetProxyPatch | undefined
      if (patch === undefined) throw new Error('windows.wininet set requires patch')
      return setWinInetUserProxy(patch)
    }
    case 'windows.winhttp.user': {
      if (request.action === 'clear') return await clearWinHttpUserProxy()
      const patch = request.patch as WinHttpProxyPatch | undefined
      if (patch === undefined) throw new Error('windows.winhttp.user set requires patch')
      return await setWinHttpUserProxy(patch)
    }
    case 'windows.winhttp.machine': {
      if (request.action === 'clear') return await setWinHttpMachineProxy({ proxyEnabled: false, proxy: '', proxyBypass: '', autoConfigEnabled: false, autoConfigUrl: '', autoDetect: false })
      const patch = request.patch as WinHttpProxyPatch | undefined
      if (patch === undefined) throw new Error('windows.winhttp.machine set requires patch')
      return await setWinHttpMachineProxy(patch)
    }
    case 'windows.env.user':
    case 'windows.env.machine': {
      const scope: EnvScopeName = request.scope === 'windows.env.machine' ? 'machine' : 'user'
      if (request.action === 'clear') return clearEnvironmentProxy(scope)
      if (request.values !== undefined) return replaceEnvironmentScope(scope, request.values)
      if (request.name === undefined) throw new Error(`${request.scope} requires name`)
      const value = request.action === 'unset' ? '' : request.value ?? ''
      return setEnvironmentVariable(scope, request.name, value)
    }
    case 'dsh.process': {
      if (request.action === 'clear') return clearDshProcessProxy()
      const proxy = request.patch as DshProxyConfig | undefined
      return setDshProcessProxy(proxy ?? {})
    }
    case 'windows.wslconfig': {
      const patch = request.patch as WslConfigPatch | undefined
      if (patch === undefined) throw new Error('windows.wslconfig set requires patch.autoProxy')
      return setWslAutoProxy(patch.autoProxy)
    }
  }
}

function plannedAfter(before: unknown, request: ConfigureRequest): unknown {
  if (request.scope === 'dsh.process') {
    const snapshot = before as EnvironmentScopeSnapshot
    const proxy = request.action === 'clear' ? {} : (request.patch ?? {}) as DshProxyConfig
    const next: Record<string, string | undefined> = { ...snapshot }
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
      const value = proxy[key as keyof DshProxyConfig]
      if (value === undefined || value === '') delete next[key]
      else next[key] = value
    }
    return next
  }
  if (request.scope === 'windows.wininet') {
    const current = before as WinInetProxyInspection
    const patch = request.action === 'clear'
      ? { enabled: false, proxyServer: '', proxyOverride: '', autoConfigUrl: '', autoDetect: false }
      : (request.patch ?? {}) as WinInetProxyPatch
    return { ...current, ...patch }
  }
  if (request.scope === 'windows.winhttp.user' || request.scope === 'windows.winhttp.machine') {
    const current = before as WinHttpProxyInspection | undefined
    const patch = request.action === 'clear'
      ? { proxyEnabled: false, proxy: '', proxyBypass: '', autoConfigEnabled: false, autoConfigUrl: '', autoDetect: false }
      : (request.patch ?? {}) as WinHttpProxyPatch
    return { ...(current ?? { scope: request.scope === 'windows.winhttp.machine' ? 'machine' : 'user' }), ...patch }
  }
  if (request.scope === 'windows.wslconfig') {
    const current = before as WslNetworkConfig
    const patch = request.patch as WslConfigPatch | undefined
    return { ...current, ...patch }
  }
  if (request.scope === 'windows.env.user' || request.scope === 'windows.env.machine') {
    const current = before as EnvironmentScopeSnapshot
    if (request.action === 'clear') {
      const next: Record<string, string | undefined> = { ...current }
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) delete next[key]
      return next
    }
    if (request.values !== undefined) return { ...current, ...request.values }
    const name = request.name
    if (name === undefined) return current
    const value = request.action === 'unset' ? '' : request.value ?? ''
    return { ...current, [name]: value === '' ? undefined : value }
  }
  return before
}

export async function previewConfigure(request: ConfigureRequest): Promise<ConfigurePreview> {
  const normalized = normalizeRequest(request)
  const before = await readBefore(normalized.scope)
  const after = plannedAfter(before, normalized)
  const diff = diffJson(before, after)
  return {
    scope: normalized.scope,
    scopeDescription: SCOPE_DESCRIPTIONS[normalized.scope],
    before,
    after,
    diff,
    diffText: summarizeDiff(diff),
    requiresElevation: normalized.scope === 'windows.env.machine',
  }
}

export async function applyConfigure(request: ConfigureRequest): Promise<ConfigureResult> {
  const preview = await previewConfigure(request)
  const snapshot = await saveSnapshot({
    reason: `配置修改: ${preview.scope} ${request.action}`,
    scope: preview.scope as SnapshotScope,
    before: preview.before,
    reversible: true,
  })
  const after = await applyScoped(normalizeRequest(request))
  await updateSnapshotAfter(snapshot.id, after)
  const diff = diffJson(preview.before, after)
  return {
    ...preview,
    before: preview.before,
    after,
    diff,
    diffText: summarizeDiff(diff),
    snapshotId: snapshot.id,
    applied: true,
  }
}
