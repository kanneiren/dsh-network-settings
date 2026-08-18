/** Scoped Windows configuration operations. Every function mutates exactly one
 * documented scope and returns JSON-shaped after-state when possible. */
import { inspectWindowsFacts } from '../windows/inspect.ts'
import { runPowerShell } from '../runtime/powershell.ts'
import { runCommand } from '../runtime/command.ts'
import type {
  EnvironmentScopeSnapshot, WinHttpProxyInspection, WinInetProxyInspection,
} from '../model.ts'

export type EnvScopeName = 'user' | 'machine'

export interface WinInetProxyPatch {
  enabled: boolean
  proxyServer?: string
  proxyOverride?: string
  autoConfigUrl?: string
  autoDetect: boolean
}

export interface WinHttpProxyPatch {
  proxyEnabled: boolean
  proxy?: string
  proxyBypass?: string
  autoConfigEnabled: boolean
  autoConfigUrl?: string
  autoDetect: boolean
}

const INTERNET_SETTINGS = String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings`

async function readCurrent() {
  return (await inspectWindowsFacts({ timeoutMs: 20_000 }))
}

export async function readWinInetProxy(): Promise<WinInetProxyInspection> {
  return (await readCurrent()).proxy.wininet
}

export async function setWinInetUserProxy(patch: WinInetProxyPatch, signal?: AbortSignal): Promise<WinInetProxyInspection> {
  const script = String.raw`
Set-ItemProperty -Path '${INTERNET_SETTINGS}' -Name ProxyEnable -Value ${patch.enabled ? 1 : 0}
${patch.proxyServer === undefined ? '' : `Set-ItemProperty -Path '${INTERNET_SETTINGS}' -Name ProxyServer -Value '${escapePs(patch.proxyServer)}'`}
${patch.proxyOverride === undefined ? '' : `Set-ItemProperty -Path '${INTERNET_SETTINGS}' -Name ProxyOverride -Value '${escapePs(patch.proxyOverride)}'`}
${patch.autoConfigUrl === undefined ? '' : `Set-ItemProperty -Path '${INTERNET_SETTINGS}' -Name AutoConfigURL -Value '${escapePs(patch.autoConfigUrl)}'`}
Set-ItemProperty -Path '${INTERNET_SETTINGS}' -Name AutoDetect -Value $${patch.autoDetect ? 'true' : 'false'}
$notify = @'
[DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
Add-Type -MemberDefinition $notify -Name Wininet -Namespace DshNetworkSettings 2>$null
[DshNetworkSettings.Wininet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[DshNetworkSettings.Wininet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`
  const result = await runPowerShell(script, { signal, timeoutMs: 15_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `WinINet update failed: ${String(result.code)}`)
  return readWinInetProxy()
}

export async function clearWinInetUserProxy(signal?: AbortSignal): Promise<WinInetProxyInspection> {
  return setWinInetUserProxy({
    enabled: false,
    proxyServer: '',
    proxyOverride: '',
    autoConfigUrl: '',
    autoDetect: false,
  }, signal)
}

export async function readWinHttpUserProxy(): Promise<WinHttpProxyInspection | undefined> {
  return (await readCurrent()).proxy.winhttp.find(entry => entry.scope === 'user')
}

export async function readWinHttpMachineProxy(): Promise<WinHttpProxyInspection | undefined> {
  return (await readCurrent()).proxy.winhttp.find(entry => entry.scope === 'machine')
}

export async function setWinHttpUserProxy(patch: WinHttpProxyPatch, signal?: AbortSignal): Promise<WinHttpProxyInspection | undefined> {
  const settings = {
    ...patch.proxyEnabled ? { Proxy: patch.proxy ?? '' } : { Proxy: '' },
    ProxyBypass: patch.proxyBypass ?? '',
    ...patch.autoConfigUrl === undefined ? {} : { AutoconfigUrl: patch.autoConfigUrl },
    AutoDetect: patch.autoDetect,
  }
  const json = JSON.stringify(settings)
  const script = String.raw`& netsh winhttp set advproxy setting-scope=user settings='${json.replaceAll("'", "''")}'`
  const result = await runPowerShell(script, { signal, timeoutMs: 20_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `WinHTTP update failed: ${String(result.code)}`)
  return readWinHttpUserProxy()
}

export async function clearWinHttpUserProxy(signal?: AbortSignal): Promise<WinHttpProxyInspection | undefined> {
  return setWinHttpUserProxy({ proxyEnabled: false, proxy: '', proxyBypass: '', autoConfigEnabled: false, autoConfigUrl: '', autoDetect: false }, signal)
}

export async function setWinHttpMachineProxy(patch: WinHttpProxyPatch, signal?: AbortSignal): Promise<WinHttpProxyInspection | undefined> {
  const settings = {
    ...patch.proxyEnabled ? { Proxy: patch.proxy ?? '' } : { Proxy: '' },
    ProxyBypass: patch.proxyBypass ?? '',
    ...patch.autoConfigUrl === undefined ? {} : { AutoconfigUrl: patch.autoConfigUrl },
    AutoDetect: patch.autoDetect,
  }
  const json = JSON.stringify(settings)
  const script = String.raw`& netsh winhttp set advproxy setting-scope=machine settings='${json.replaceAll("'", "''")}'`
  await runElevatedPowerShell(script)
  return readWinHttpMachineProxy()
}

export async function readEnvironmentScope(scope: EnvScopeName): Promise<EnvironmentScopeSnapshot> {
  const current = await readCurrent()
  return current.environment.scopes[scope]
}

export async function setEnvironmentVariable(
  scope: EnvScopeName,
  name: string,
  value: string,
  signal?: AbortSignal,
): Promise<EnvironmentScopeSnapshot> {
  if (scope === 'user') {
    const script = String.raw`[Environment]::SetEnvironmentVariable('${escapePs(name)}', '${escapePs(value)}', 'User')`
    const result = await runPowerShell(script, { signal, timeoutMs: 15_000 })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `set User env failed: ${String(result.code)}`)
  } else {
    const script = String.raw`[Environment]::SetEnvironmentVariable('${escapePs(name)}', '${escapePs(value)}', 'Machine')`
    await runElevatedPowerShell(script)
  }
  return readEnvironmentScope(scope)
}

const PROXY_ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'] as const

/** Replace the plugin-managed proxy variables for one environment scope. */
export async function replaceEnvironmentScope(
  scope: EnvScopeName,
  values: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<EnvironmentScopeSnapshot> {
  const entries = PROXY_ENV_NAMES.map(name => [name, values[name] ?? ''] as const)
  if (scope === 'user') {
    const lines = entries.map(([name, value]) => `[Environment]::SetEnvironmentVariable('${escapePs(name)}', '${escapePs(value)}', 'User')`)
    const result = await runPowerShell(lines.join('\n'), { signal, timeoutMs: 20_000 })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `replace User env failed: ${String(result.code)}`)
  } else {
    const lines = entries.map(([name, value]) => `[Environment]::SetEnvironmentVariable('${escapePs(name)}', '${escapePs(value)}', 'Machine')`)
    await runElevatedPowerShell(lines.join('; '))
  }
  return readEnvironmentScope(scope)
}

export async function clearEnvironmentProxy(scope: EnvScopeName, signal?: AbortSignal): Promise<EnvironmentScopeSnapshot> {
  return replaceEnvironmentScope(scope, {}, signal)
}

export async function unsetEnvironmentVariable(
  scope: EnvScopeName,
  name: string,
  signal?: AbortSignal,
): Promise<EnvironmentScopeSnapshot> {
  return setEnvironmentVariable(scope, name, '', signal)
}

/**
 * Machine-scope writes require elevation. The elevated process is started only
 * here, only for a concrete write, and blocks until it exits (UAC prompt).
 */
export async function runElevatedPowerShell(script: string): Promise<void> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const launch = String.raw`$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $p.ExitCode`
  const result = await runPowerShell(launch, { timeoutMs: 120_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `elevated PowerShell failed: ${String(result.code)}`)
}

function escapePs(value: string): string {
  return value.replaceAll("'", "''")
}
