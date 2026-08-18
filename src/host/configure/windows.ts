/** Scoped Windows configuration operations. Every function mutates exactly one
 * documented scope and returns JSON-shaped after-state when possible. */
import { extractJson } from '../runtime/command.ts'
import { parseWinHttpAdvProxy, parseWinInet, proxyEnvironmentOf } from '../windows/inspect.ts'
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

/**
 * Lightweight proxy/env read for the configure layer. Preview/apply only need
 * WinINet, WinHTTP and env-var state; reusing the full inspection (adapters,
 * routes, gateway ICMP, listeners, Hosts) made every repair dialog pay for
 * 2+ full PowerShell sweeps.
 */
const LIGHT_READ_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$inet = Get-ItemProperty '${INTERNET_SETTINGS}' -ErrorAction SilentlyContinue
$wininet = @{}
if ($inet) {
  $wininet.ProxyEnable = [int]$inet.ProxyEnable
  $wininet.ProxyServer = [string]$inet.ProxyServer
  $wininet.ProxyOverride = [string]$inet.ProxyOverride
  $wininet.AutoConfigURL = [string]$inet.AutoConfigURL
  $wininet.AutoDetect = [bool]$inet.AutoDetect
}
$envNames = @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy')
$envUser = @{}
$envMachine = @{}
foreach ($name in $envNames) {
  $envUser[$name] = [Environment]::GetEnvironmentVariable($name, 'User')
  $envMachine[$name] = [Environment]::GetEnvironmentVariable($name, 'Machine')
}
[pscustomobject]@{
  wininet = $wininet
  advMachine = (netsh winhttp show advproxy setting-scope=machine 2>$null | Out-String)
  advUser = (netsh winhttp show advproxy setting-scope=user 2>$null | Out-String)
  envUser = $envUser
  envMachine = $envMachine
} | ConvertTo-Json -Depth 5 -Compress
`

interface LightState {
  wininet?: Record<string, unknown>
  advMachine?: string
  advUser?: string
  envUser?: Record<string, unknown>
  envMachine?: Record<string, unknown>
}

async function readLightState(signal?: AbortSignal): Promise<LightState> {
  const result = await runPowerShell(LIGHT_READ_SCRIPT, { signal, timeoutMs: 15_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `light proxy read failed: ${String(result.code)}`)
  return extractJson<LightState>(result.stdout)
}

export async function readWinInetProxy(): Promise<WinInetProxyInspection> {
  return parseWinInet((await readLightState()).wininet)
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
  const state = await readLightState()
  return parseWinHttpAdvProxy(state.advUser ?? '', 'user')
}

export async function readWinHttpMachineProxy(): Promise<WinHttpProxyInspection | undefined> {
  const state = await readLightState()
  return parseWinHttpAdvProxy(state.advMachine ?? '', 'machine')
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
  const state = await readLightState()
  return proxyEnvironmentOf(scope === 'user' ? state.envUser ?? {} : state.envMachine ?? {})
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
