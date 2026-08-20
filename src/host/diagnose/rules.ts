/** Deterministic diagnosis rules over Phase 1 read-only inspection results. * Module facade: Public surface: runDiagnosis(). Deterministic rules; individual rule* functions are internal test seams.
 */
import type {
  EnvironmentScopeSnapshot, LayeredProbe, NetworkStatus, ProbeCheck, ProxyEndpoint, WindowsInspection, WslInspection,
} from '../model.ts'
import type { Diagnosis, DiagnosisInput, DiagnosisSeverity, RuleResult } from './model.ts'
import { failed, healthy, layerCheck, severityRank } from './model.ts'

export interface DiagnosisReport {
  diagnoses: Diagnosis[]
  worst: DiagnosisSeverity | 'healthy'
  problemCount: number
}

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const

function evidence(ref: string, message: string, status: NetworkStatus): RuleResult['evidence'][number] {
  return { ref, message, status }
}

function endpointMatches(check: ProbeCheck | undefined, endpoint: ProxyEndpoint): boolean {
  const details = check?.details as { host?: unknown; port?: unknown; proxy?: unknown } | undefined
  return details?.host === endpoint.host && details?.port === endpoint.port
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function distributionNameFromTargetId(targetId: string): string | undefined {
  const match = /^wsl:(.*?):/.exec(targetId)
  return match?.[1]
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

// ── Proxy endpoint rules ────────────────────────────────────────────────────

function normalizeProxyHost(host: string): string {
  const lower = host.toLowerCase()
  return lower === 'localhost' ? '127.0.0.1' : lower
}

function sameProxyEndpoint(left: { host: string; port: number }, right: { host: string; port: number }): boolean {
  return normalizeProxyHost(left.host) === normalizeProxyHost(right.host) && left.port === right.port
}

/**
 * Only the proxy endpoint DSH actually egresses through can break the DSH
 * link. A proxy configured in some Windows scope but unused by DSH (e.g. the
 * VPN's system proxy while DSH egresses directly) is not a DSH problem, so
 * those endpoints never produce error diagnoses or repair suggestions.
 */
function endpointUsedByDsh(endpoint: ProxyEndpoint, input: DiagnosisInput): boolean {
  if (input.dshEgress === undefined) return true // graph unavailable: legacy standalone behavior
  if (input.dshEgress === null) return false // DSH egresses directly
  return sameProxyEndpoint(endpoint, input.dshEgress)
}

export function ruleProxyEndpointUnreachable(input: DiagnosisInput): RuleResult[] {
  const results: RuleResult[] = []
  for (const endpoint of input.endpoints) {
    if (!endpoint.configured) continue
    if (!endpointUsedByDsh(endpoint, input)) continue
    const tcp = input.probes
      .filter(probe => probe.path === 'proxy')
      .map(probe => layerCheck(probe, 'tcp'))
      .find(check => endpointMatches(check, endpoint))
    if (tcp === undefined || tcp.status !== 'error') continue
    results.push({
      code: 'PROXY_ENDPOINT_UNREACHABLE',
      severity: 'error',
      confidence: 0.95,
      scope: 'proxy',
      humanMessage: `代理地址无法连接（${endpoint.host}:${endpoint.port}）`,
      technicalMessage: `${endpoint.source} ${endpoint.url} TCP probe failed: ${tcp.technicalMessage ?? tcp.humanMessage}`,
      evidence: [evidence(`endpoint:${endpoint.source}:${endpoint.host}:${endpoint.port}`, tcp.humanMessage, 'error')],
      actions: [{ code: 'repair-proxy-endpoint', scope: endpoint.source, label: '检查或移除该代理配置', safe: true }],
    })
  }
  return results
}

export function ruleProxyConfiguredButUnusable(input: DiagnosisInput): RuleResult[] {
  const results: RuleResult[] = []
  for (const endpoint of input.endpoints) {
    if (!endpoint.configured) continue
    if (!endpointUsedByDsh(endpoint, input)) continue
    const proxyProbes = input.probes.filter(probe => probe.path === 'proxy' && endpointMatches(layerCheck(probe, 'tcp'), endpoint))
    if (proxyProbes.length === 0) continue
    const tcp = layerCheck(proxyProbes[0]!, 'tcp')
    if (tcp === undefined || tcp.status !== 'healthy') continue
    const failedHttp = proxyProbes.map(probe => layerCheck(probe, 'http')).filter(failed)
    if (failedHttp.length === 0) continue
    results.push({
      code: 'PROXY_CONFIGURED_BUT_UNUSABLE',
      severity: 'warning',
      confidence: 0.85,
      scope: 'proxy',
      humanMessage: `代理地址可以连接，但无法通过它访问互联网（${endpoint.host}:${endpoint.port}）`,
      technicalMessage: failedHttp.map(check => `${check.source}: ${check.technicalMessage ?? check.humanMessage}`).join(' | '),
      evidence: [evidence(`endpoint:${endpoint.source}:${endpoint.host}:${endpoint.port}`, '代理 TCP 正常，经代理访问失败', 'warning')],
      actions: [{ code: 'repair-proxy-usability', scope: endpoint.source, label: '检查代理软件是否允许访问目标站点', safe: true }],
    })
  }
  return results
}

// ── Layered network rules ───────────────────────────────────────────────────

export function ruleDnsFailure(input: DiagnosisInput): RuleResult[] {
  const failedDns = input.probes.flatMap(probe => {
    const dns = layerCheck(probe, 'dns')
    return dns?.status === 'error' ? [{ probe, dns }] : []
  })
  if (failedDns.length === 0) return []
  const tcpHealthy = input.probes.some(probe => healthy(layerCheck(probe, 'tcp')))
  if (!tcpHealthy) return []
  return [{
    code: 'DNS_FAILURE',
    severity: 'error',
    confidence: 0.9,
    scope: 'dns',
    humanMessage: '部分域名无法解析，但网络连接本身可用',
    technicalMessage: failedDns.map(({ probe, dns }) => `${probe.target.host}: ${dns.technicalMessage ?? dns.humanMessage}`).join(' | '),
    evidence: [
      ...failedDns.map(({ probe, dns }) => evidence(`probe:${probe.target.id}:dns`, dns.humanMessage, 'error')),
      evidence('probe:tcp', '至少一个目标的 TCP 连接正常', 'healthy'),
    ],
    actions: [{ code: 'repair-dns', scope: 'dns', label: '检查 DNS 服务器或刷新 DNS 缓存', safe: true }],
  }]
}

export function ruleTlsFailure(input: DiagnosisInput): RuleResult[] {
  const failures = input.probes.flatMap(probe => {
    const tcp = layerCheck(probe, 'tcp')
    const tls = layerCheck(probe, 'tls')
    if (!healthy(tcp) || !failed(tls)) return []
    return [{ probe, tcp, tls }]
  })
  if (failures.length === 0) return []
  return [{
    code: 'TLS_FAILURE',
    severity: 'error',
    confidence: 0.95,
    scope: 'tls',
    humanMessage: `有 ${failures.length} 个目标的 TCP 连接正常，但 TLS 握手失败`,
    technicalMessage: failures.map(({ probe, tls }) => `${probe.target.host}: ${tls.technicalMessage ?? tls.humanMessage}`).join(' | '),
    evidence: failures.flatMap(({ probe, tcp, tls }) => [
      evidence(`probe:${probe.target.id}:tcp`, tcp.humanMessage, 'healthy'),
      evidence(`probe:${probe.target.id}:tls`, tls.humanMessage, 'error'),
    ]),
    actions: [{ code: 'repair-tls', scope: 'tls', label: '检查系统时间、证书或中间设备是否拦截 TLS', safe: true }],
  }]
}

// ── Environment rules ───────────────────────────────────────────────────────

function snapshotValue(snapshot: EnvironmentScopeSnapshot | undefined, name: string): string | undefined {
  if (snapshot === undefined) return undefined
  return snapshot[name as keyof EnvironmentScopeSnapshot]
}

export function ruleStaleDshProxyEnv(input: DiagnosisInput): RuleResult[] {
  const dsh = input.dsh
  const user = input.windows?.environment.scopes.user
  if (user === undefined) return []
  const stale = PROXY_VARS.flatMap(name => {
    const processValue = snapshotValue(dsh, name)
    if (processValue === undefined || processValue === '') return []
    const userValue = snapshotValue(user, name)
    if (userValue === processValue) return []
    return [{ name, processValue, userValue }]
  })
  if (stale.length === 0) return []
  return [{
    code: 'STALE_DSH_PROXY_ENV',
    severity: 'warning',
    confidence: 0.8,
    scope: 'dsh',
    humanMessage: 'DSH 当前继承了旧的代理环境变量，而 Windows 用户环境已不再设置（或值已不同）',
    technicalMessage: stale.map(entry => `${entry.name}: DSH=${JSON.stringify(entry.processValue)} User=${entry.userValue === undefined ? '未设置' : JSON.stringify(entry.userValue)}`).join(' | '),
    evidence: stale.map(entry => evidence(`env:dsh:${entry.name}`, `${entry.name}=${entry.processValue}`, 'warning')),
    actions: [{ code: 'clear-dsh-process-proxy', scope: 'dsh.process', label: '清除当前 DSH 进程的旧代理变量', safe: true }],
  }]
}

export function ruleEnvScopeConflict(input: DiagnosisInput): RuleResult[] {
  const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']
  const scopes = input.windows?.environment.scopes
  if (scopes === undefined) return []
  const conflicts: { name: string; values: { scope: string; value: string }[] }[] = []
  for (const name of names) {
    const values = (['process', 'user', 'machine'] as const).flatMap(scope => {
      const value = snapshotValue(scopes[scope], name)
      return value === undefined || value === '' ? [] : [{ scope, value }]
    })
    const unique = distinct(values.map(entry => entry.value))
    if (unique.length > 1) conflicts.push({ name, values })
  }
  if (conflicts.length === 0) return []
  return [{
    code: 'ENV_SCOPE_CONFLICT',
    severity: 'warning',
    confidence: 0.85,
    scope: 'windows',
    humanMessage: 'Process / User / Machine 三个作用域的代理环境变量存在冲突',
    technicalMessage: conflicts.map(conflict => `${conflict.name}: ${conflict.values.map(entry => `${entry.scope}=${JSON.stringify(entry.value)}`).join(', ')}`).join(' | '),
    evidence: conflicts.flatMap(conflict => conflict.values.map(entry => evidence(`env:${entry.scope}:${conflict.name}`, `${conflict.name}=${entry.value}`, 'warning'))),
    actions: [{ code: 'repair-env-scope-conflict', scope: 'windows.env', label: '统一或清除冲突的代理环境变量', safe: true }],
  }]
}

// ── WSL rules ───────────────────────────────────────────────────────────────

function wslProbesFor(input: DiagnosisInput, kind: 'windows-host' | 'wsl-proxy', distribution: string): LayeredProbe[] {
  return input.probes.filter(probe => probe.target.kind === kind && distributionNameFromTargetId(probe.target.id) === distribution)
}

export function ruleWslProxyUnreachable(input: DiagnosisInput): RuleResult[] {
  const windowsProxyUsable = input.probes.some(probe => probe.path === 'proxy' && healthy(layerCheck(probe, 'http')))
  if (!windowsProxyUsable) return []
  const results: RuleResult[] = []
  for (const distribution of input.wsl?.distributions ?? []) {
    const hostProbes = wslProbesFor(input, 'windows-host', distribution.name)
    const proxyProbes = wslProbesFor(input, 'wsl-proxy', distribution.name)
    if (!hostProbes.some(probe => healthy(layerCheck(probe, 'tcp')))) continue
    const failedTcp = proxyProbes.map(probe => layerCheck(probe, 'tcp')).filter(failed)
    if (failedTcp.length === 0) continue
    const proxy = distribution.network?.environment?.['HTTPS_PROXY'] ?? distribution.network?.environment?.['https_proxy']
    const loopback = proxy !== undefined && isLoopback(proxyHostOf(proxy).host)
    const nat = (distribution.network?.hostCandidates ?? []).some(candidate => candidate.source === 'default-route')
    const code = loopback && nat ? 'WSL_PROXY_LOOPBACK_UNREACHABLE' : 'WSL_PROXY_UNREACHABLE'
    results.push({
      code,
      severity: 'error',
      confidence: loopback && nat ? 0.9 : 0.8,
      scope: 'wsl',
      humanMessage: `${distribution.name} 无法使用 Windows 代理`,
      technicalMessage: `${distribution.name}: ${failedTcp.map(check => check.technicalMessage ?? check.humanMessage).join(' | ')}`,
      evidence: [
        evidence(`wsl:${distribution.name}:host`, 'WSL → Windows Host 可达', 'healthy'),
        evidence(`wsl:${distribution.name}:proxy`, 'WSL → Windows Proxy 失败', 'error'),
      ],
      actions: [{ code: 'repair-wsl-proxy', scope: `wsl.${distribution.name}`, label: `重新配置 ${distribution.name} 的代理路径`, safe: true }],
    })
  }
  return results
}

export function ruleWslAutoProxyStale(input: DiagnosisInput): RuleResult[] {
  const results: RuleResult[] = []
  for (const distribution of input.wsl?.distributions ?? []) {
    const env = distribution.network?.environment
    if (env === undefined) continue
    const value = env['HTTPS_PROXY'] ?? env['https_proxy'] ?? env['HTTP_PROXY'] ?? env['http_proxy']
    if (value === undefined || value === '') continue
    const proxy = proxyHostOf(value)
    const endpoint = input.endpoints.find(candidate => candidate.configured && candidate.host === proxy.host && candidate.port === proxy.port)
    if (endpoint !== undefined) {
      const reachable = input.probes.some(probe => probe.path === 'proxy' && healthy(layerCheck(probe, 'tcp')) && endpointMatches(layerCheck(probe, 'tcp'), endpoint))
      if (reachable) continue
    }
    results.push({
      code: 'WSL_AUTOPROXY_STALE',
      severity: 'warning',
      confidence: endpoint === undefined ? 0.75 : 0.85,
      scope: 'wsl',
      humanMessage: `${distribution.name} 继承了 Windows 代理设置，但该代理当前不可用`,
      technicalMessage: `${distribution.name} ${value}`,
      evidence: [evidence(`wsl:${distribution.name}:env`, `${value}`, 'warning')],
      actions: [{ code: 'repair-wsl-autoproxy', scope: `wsl.${distribution.name}`, label: '在 WSL 中清除或修正代理环境变量', safe: true }],
    })
  }
  return results
}

function proxyHostOf(value: string): { host: string; port: number } {
  try {
    const url = new URL(value)
    return { host: url.hostname, port: url.port === '' ? 80 : Number(url.port) }
  } catch {
    return { host: value, port: 0 }
  }
}

// ── Hosts rule ──────────────────────────────────────────────────────────────

export function ruleHostsOverride(input: DiagnosisInput): RuleResult[] {
  const matching: RuleResult['evidence'] = []
  const overrides = input.windows?.hosts.overrides ?? []
  for (const override of overrides) {
    for (const hostname of override.hostnames) {
      const probes = input.probes.filter(probe => probe.target.host === hostname)
      if (probes.length === 0) continue
      const broken = probes.some(probe => Object.values(probe.layers).some(check => check !== undefined && check.status !== 'healthy' && check.status !== 'not-tested'))
      if (broken) matching.push(evidence(`hosts:${hostname}`, `${hostname} → ${override.ip}`, 'warning'))
    }
  }
  if (matching.length === 0) return []
  return [{
    code: 'HOSTS_OVERRIDE',
    severity: 'warning',
    confidence: 0.7,
    scope: 'windows',
    humanMessage: 'Hosts 文件中存在与诊断目标相关的覆盖，且对应目标访问异常',
    technicalMessage: matching.map(entry => entry.message).join(' | '),
    evidence: matching,
    actions: [{ code: 'inspect-hosts', scope: 'windows', label: '查看相关 Hosts 条目', safe: true }],
  }]
}

// ── Runner ──────────────────────────────────────────────────────────────────

export function runDiagnosis(input: DiagnosisInput): DiagnosisReport {
  const rules = [
    ruleProxyEndpointUnreachable,
    ruleProxyConfiguredButUnusable,
    ruleDnsFailure,
    ruleTlsFailure,
    ruleStaleDshProxyEnv,
    ruleEnvScopeConflict,
    ruleWslProxyUnreachable,
    ruleWslAutoProxyStale,
    ruleHostsOverride,
  ]
  const diagnoses = rules
    .flatMap(rule => rule(input))
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || right.confidence - left.confidence)
  const worst = diagnoses[0]?.severity ?? 'healthy'
  return {
    diagnoses,
    worst,
    problemCount: diagnoses.filter(diagnosis => diagnosis.severity !== 'info').length,
  }
}
