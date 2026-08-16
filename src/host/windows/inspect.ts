/**
 * Windows read-only inspection. One PowerShell process gathers JSON-shaped
 * facts; WinHTTP uses the current `netsh winhttp show advproxy` JSON output.
 * No command in this file mutates system state.
 */
import type {
  EnvironmentScopeSnapshot, HostsInspection, HostsOverride, ListenerInspection, ModelServiceTarget,
  ProbeCheck, ProxyInspection, WindowsInspection, WindowsInterface, WindowsNetworkInspection,
  WinHttpProxyInspection, WinInetProxyInspection,
} from '../model.ts'
import { extractJson, runCommand } from '../runtime/command.ts'
import { runPowerShell } from '../runtime/powershell.ts'

interface RawAdapter {
  Name?: string
  InterfaceDescription?: string
  Status?: unknown
  MacAddress?: unknown
  Virtual?: boolean
  InterfaceIndex?: number
  IPv4?: string[]
  IPv6?: string[]
  Gateways?: string[]
  Dns?: string[]
  Dhcp?: boolean
}

interface RawWindowsFacts {
  os?: { caption?: string; version?: string; build?: string; architecture?: string }
  adapters?: RawAdapter[]
  defaultRoutes?: { Family?: number; DestinationPrefix?: string; NextHop?: string; InterfaceIndex?: number; RouteMetric?: number }[]
  wininet?: Record<string, unknown>
  winhttpAdvProxyMachine?: string
  winhttpAdvProxyUser?: string
  winhttpShowProxy?: string
  envProcess?: Record<string, unknown>
  envUser?: Record<string, unknown>
  envMachine?: Record<string, unknown>
  hosts?: string[]
  listeners?: { LocalAddress?: string; LocalPort?: number; OwningProcess?: number; ProcessName?: string }[]
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture | Select-Object -First 1
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
  $adapter = $_
  $ip = Get-NetIPConfiguration -InterfaceIndex $adapter.InterfaceIndex -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Name = $adapter.Name
    InterfaceDescription = $adapter.InterfaceDescription
    Status = $adapter.Status
    MacAddress = $adapter.MacAddress
    Virtual = $adapter.Virtual
    InterfaceIndex = $adapter.InterfaceIndex
    IPv4 = @($ip.IPv4Address | ForEach-Object { $_.IPAddress })
    IPv6 = @($ip.IPv6Address | ForEach-Object { $_.IPAddress })
    Gateways = @($ip.IPv4DefaultGateway | ForEach-Object { $_.NextHop })
    Dns = @($ip.DNSServer | Where-Object { $_.ServerAddresses } | ForEach-Object { $_.ServerAddresses })
    Dhcp = $ip.Interface.Dhcp
  }
}
$routes = @()
$routes += Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' } | ForEach-Object {
  [pscustomobject]@{ Family = 4; DestinationPrefix = $_.DestinationPrefix; NextHop = $_.NextHop; InterfaceIndex = $_.ifIndex; RouteMetric = $_.RouteMetric }
}
$routes += Get-NetRoute -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -eq '::/0' } | ForEach-Object {
  [pscustomobject]@{ Family = 6; DestinationPrefix = $_.DestinationPrefix; NextHop = $_.NextHop; InterfaceIndex = $_.ifIndex; RouteMetric = $_.RouteMetric }
}
$inet = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$wininet = @{}
if ($inet) {
  $wininet.ProxyEnable = [int]$inet.ProxyEnable
  $wininet.ProxyServer = [string]$inet.ProxyServer
  $wininet.ProxyOverride = [string]$inet.ProxyOverride
  $wininet.AutoConfigURL = [string]$inet.AutoConfigURL
  $wininet.AutoDetect = [bool]$inet.AutoDetect
}
$advMachine = (netsh winhttp show advproxy setting-scope=machine 2>$null | Out-String)
$advUser = (netsh winhttp show advproxy setting-scope=user 2>$null | Out-String)
$showProxy = (netsh winhttp show proxy 2>$null | Out-String)
$envNames = @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy')
$envProcess = @{}
$envUser = @{}
$envMachine = @{}
foreach ($name in $envNames) {
  $envProcess[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  $envUser[$name] = [Environment]::GetEnvironmentVariable($name, 'User')
  $envMachine[$name] = [Environment]::GetEnvironmentVariable($name, 'Machine')
}
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -First 200 | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue | Select-Object -First 1
  [pscustomobject]@{
    LocalAddress = $_.LocalAddress
    LocalPort = $_.LocalPort
    OwningProcess = $_.OwningProcess
    ProcessName = [string]$proc.ProcessName
  }
})
$hosts = @()
if (Test-Path "$env:SystemRoot\System32\drivers\etc\hosts") {
  $hosts = @(Select-String -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Pattern '^\s*[^#]' -ErrorAction SilentlyContinue | ForEach-Object { $_.Line.Trim() })
}
[pscustomobject]@{
  os = [pscustomobject]@{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; architecture = [string]$os.OSArchitecture }
  adapters = @($adapters)
  defaultRoutes = @($routes)
  wininet = $wininet
  winhttpAdvProxyMachine = $advMachine
  winhttpAdvProxyUser = $advUser
  winhttpShowProxy = $showProxy
  envProcess = $envProcess
  envUser = $envUser
  envMachine = $envMachine
  hosts = @($hosts)
  listeners = @($listeners)
} | ConvertTo-Json -Depth 8 -Compress
`

export interface InspectWindowsOptions {
  signal?: AbortSignal
  timeoutMs?: number
  pwsh?: boolean
}

export async function inspectWindowsFacts(options: InspectWindowsOptions = {}): Promise<WindowsInspection> {
  const rawErrors: ProbeCheck[] = []
  let facts: RawWindowsFacts
  try {
    const result = await runPowerShell(PS_SCRIPT, {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 20_000,
      pwsh: options.pwsh,
      maxStdoutBytes: 4 * 1024 * 1024,
    })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `PowerShell exited with code ${String(result.code)}`)
    facts = extractJson<RawWindowsFacts>(result.stdout)
  } catch (error) {
    return {
      network: { interfaces: [], defaultRoutes: [] },
      proxy: { wininet: { enabled: false, autoDetect: false }, winhttp: [], endpoints: [] },
      environment: { scopes: { process: {}, user: {}, machine: {}, dsh: {} } },
      hosts: { overrides: [] },
      listeners: [],
      dshProcessEnvironment: proxyEnvironmentOf(process.env),
      modelServices: [],
      rawErrors: [probeError('windows.inspect', error)],
    }
  }

  const interfaces = parseAdapters(facts.adapters ?? [])
  const network: WindowsNetworkInspection = {
    interfaces,
    defaultRoutes: (facts.defaultRoutes ?? []).flatMap(route =>
      route.Family === undefined || route.DestinationPrefix === undefined || route.NextHop === undefined
        ? []
        : [{
            family: route.Family === 6 ? 6 as const : 4 as const,
            destination: route.DestinationPrefix,
            nextHop: route.NextHop,
            interfaceIndex: route.InterfaceIndex ?? 0,
            ...route.RouteMetric === undefined ? {} : { metric: route.RouteMetric },
          }],
    ),
  }

  const wininet: WinInetProxyInspection = {
    enabled: facts.wininet?.['ProxyEnable'] === 1,
    ...typeof facts.wininet?.['ProxyServer'] === 'string' ? { proxyServer: facts.wininet['ProxyServer'] } : {},
    ...typeof facts.wininet?.['ProxyOverride'] === 'string' ? { proxyOverride: facts.wininet['ProxyOverride'] } : {},
    ...typeof facts.wininet?.['AutoConfigURL'] === 'string' && facts.wininet['AutoConfigURL'] !== '' ? { autoConfigUrl: facts.wininet['AutoConfigURL'] } : {},
    autoDetect: facts.wininet?.['AutoDetect'] === true,
  }

  const winhttp: WinHttpProxyInspection[] = []
  if (facts.winhttpAdvProxyMachine !== undefined) {
    const parsed = parseWinHttpAdvProxy(facts.winhttpAdvProxyMachine, 'machine')
    if (parsed !== undefined) winhttp.push(parsed)
  }
  if (facts.winhttpAdvProxyUser !== undefined) {
    const parsed = parseWinHttpAdvProxy(facts.winhttpAdvProxyUser, 'user')
    if (parsed !== undefined) winhttp.push(parsed)
  }

  const environment = {
    scopes: {
      process: proxyEnvironmentOf(facts.envProcess ?? {}),
      user: proxyEnvironmentOf(facts.envUser ?? {}),
      machine: proxyEnvironmentOf(facts.envMachine ?? {}),
      dsh: proxyEnvironmentOf(process.env),
    },
  }

  const proxy: ProxyInspection = { wininet, winhttp, endpoints: [] }

  const hosts = parseHosts(facts.hosts ?? [])

  return {
    ...facts.os === undefined ? {} : { os: { caption: facts.os.caption ?? '', version: facts.os.version ?? '', build: facts.os.build ?? '', architecture: facts.os.architecture ?? '' } },
    network,
    proxy,
    environment,
    hosts,
    listeners: parseListeners(facts.listeners ?? []),
    dshProcessEnvironment: environment.scopes.dsh,
    modelServices: await readModelServiceTargets(),
    rawErrors,
  }
}

function parseAdapters(raw: RawAdapter[]): WindowsInterface[] {
  return raw.flatMap(adapter => {
    if (adapter.Name === undefined && adapter.InterfaceDescription === undefined) return []
    const status = normalizeInterfaceStatus(adapter.Status)
    return [{
      name: adapter.Name ?? adapter.InterfaceDescription ?? '',
      description: adapter.InterfaceDescription ?? '',
      status,
      virtual: adapter.Virtual === true,
      ...adapter.MacAddress === undefined || adapter.MacAddress === null ? {} : { mac: String(adapter.MacAddress) },
      kind: classifyInterface(adapter.InterfaceDescription ?? adapter.Name ?? ''),
      ipv4: (adapter.IPv4 ?? []).filter((entry): entry is string => typeof entry === 'string'),
      ipv6: (adapter.IPv6 ?? []).filter((entry): entry is string => typeof entry === 'string'),
      gateways: (adapter.Gateways ?? []).filter((entry): entry is string => typeof entry === 'string'),
      dns: (adapter.Dns ?? []).filter((entry): entry is string => typeof entry === 'string'),
      ...adapter.Dhcp === undefined ? {} : { dhcp: adapter.Dhcp },
    }]
  })
}

function normalizeInterfaceStatus(value: unknown): WindowsInterface['status'] {
  const text = String(value ?? '').toLowerCase()
  if (text === 'up' || text.includes('up')) return 'up'
  if (text === 'down' || text.includes('down') || text.includes('disconnected') || text.includes('disabled') || text.includes('not present')) return 'down'
  return 'unknown'
}

const INTERFACE_KINDS: ReadonlyArray<[WindowsInterface['kind'], RegExp]> = [
  ['wi-fi', /wi-?fi|wireless|802\.11|wlan/i],
  ['tailscale', /tailscale/i],
  ['vmware', /vmware/i],
  ['virtualbox', /virtualbox/i],
  ['hyper-v', /hyper-v|vEthernet|virtual ethernet/i],
  ['docker', /docker/i],
  ['wsl', /wsl/i],
  ['vpn', /vpn|radmin|openvpn|wireguard|boostnet/i],
  ['bluetooth', /bluetooth/i],
  ['ethernet', /ethernet|gbe|realtek|pcie|intel.*network/i],
]

export function classifyInterface(description: string): WindowsInterface['kind'] {
  for (const [kind, pattern] of INTERFACE_KINDS) {
    if (pattern.test(description)) return kind
  }
  return 'other'
}

function parseWinHttpAdvProxy(raw: string, scope: 'machine' | 'user'): WinHttpProxyInspection | undefined {
  try {
    const json = extractJson<Record<string, unknown>>(raw)
    const boolean = (value: unknown): boolean => value === true || value === 'true'
    return {
      scope,
      proxyEnabled: boolean(json['ProxyIsEnabled']),
      ...typeof json['Proxy'] === 'string' && json['Proxy'].trim() !== '' ? { proxy: json['Proxy'].trim() } : {},
      ...typeof json['ProxyBypass'] === 'string' && json['ProxyBypass'].trim() !== '' ? { proxyBypass: json['ProxyBypass'].trim() } : {},
      autoConfigEnabled: boolean(json['AutoConfigIsEnabled']),
      ...typeof json['AutoconfigUrl'] === 'string' && json['AutoconfigUrl'].trim() !== '' ? { autoConfigUrl: json['AutoconfigUrl'].trim() } : {},
      autoDetect: boolean(json['AutoDetect']),
      ...json['PerUserProxySettings'] === undefined ? {} : { perUserProxySettings: boolean(json['PerUserProxySettings']) },
      raw,
    }
  } catch {
    return undefined
  }
}

function parseHosts(lines: string[]): HostsInspection {
  const overrides: HostsOverride[] = []
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 2 || tokens[0] === undefined) continue
    const hostnames = tokens.slice(1)
    if (hostnames.length === 0) continue
    overrides.push({ ip: tokens[0], hostnames, raw: line.trim() })
  }
  return { overrides }
}

export function proxyEnvironmentOf(source: Record<string, unknown>): EnvironmentScopeSnapshot {
  const pick = (upper: string, lower: string): string | undefined => {
    const value = source[upper] ?? source[lower]
    return typeof value === 'string' ? value : undefined
  }
  return {
    ...pick('HTTP_PROXY', 'http_proxy') === undefined ? {} : { HTTP_PROXY: pick('HTTP_PROXY', 'http_proxy') },
    ...pick('HTTPS_PROXY', 'https_proxy') === undefined ? {} : { HTTPS_PROXY: pick('HTTPS_PROXY', 'https_proxy') },
    ...pick('ALL_PROXY', 'all_proxy') === undefined ? {} : { ALL_PROXY: pick('ALL_PROXY', 'all_proxy') },
    ...pick('NO_PROXY', 'no_proxy') === undefined ? {} : { NO_PROXY: pick('NO_PROXY', 'no_proxy') },
    ...pick('http_proxy', 'HTTP_PROXY') === undefined ? {} : { http_proxy: pick('http_proxy', 'HTTP_PROXY') },
    ...pick('https_proxy', 'HTTPS_PROXY') === undefined ? {} : { https_proxy: pick('https_proxy', 'HTTPS_PROXY') },
    ...pick('all_proxy', 'ALL_PROXY') === undefined ? {} : { all_proxy: pick('all_proxy', 'ALL_PROXY') },
    ...pick('no_proxy', 'NO_PROXY') === undefined ? {} : { no_proxy: pick('no_proxy', 'NO_PROXY') },
  }
}

/** Phase 1 stub: model-service facts are added by the DSH host integration layer. */
async function readModelServiceTargets(): Promise<ModelServiceTarget[]> {
  return []
}

function parseListeners(raw: NonNullable<RawWindowsFacts['listeners']>): ListenerInspection[] {
  return raw.flatMap(entry => {
    if (entry.LocalPort === undefined || entry.OwningProcess === undefined) return []
    return [{
      address: entry.LocalAddress ?? '',
      port: entry.LocalPort,
      pid: entry.OwningProcess,
      ...entry.ProcessName === undefined || entry.ProcessName === '' ? {} : { processName: entry.ProcessName },
    }]
  })
}

function probeError(id: string, error: unknown): ProbeCheck {
  const message = error instanceof Error ? error.message : String(error)
  return {
    status: 'error',
    errorCode: 'WINDOWS_INSPECT_FAILED',
    humanMessage: '无法读取 Windows 网络信息',
    technicalMessage: `${id}: ${message}`,
    source: 'powershell',
    timestamp: new Date().toISOString(),
  }
}
