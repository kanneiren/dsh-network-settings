/**
 * Configuration Drift detection for the current DSH path.
 *
 * A difference between two proxy configurations is not an error by itself.
 * Drift becomes a diagnostic when the DSH-configured endpoint is demonstrably
 * gone/unreachable, or when a stale proxy scope remains while the DSH path is
 * healthy. Repair follows the minimal-impact order:
 *   DSH current runtime → DSH scoped config → current WSL distribution →
 *   Windows User → WinHTTP → Machine/System.
 */
import type { EnvironmentScopeSnapshot, NetworkInspection } from '../model.ts'
import { RECOMMEND_CONFIDENCE_THRESHOLD, diagnosisActionOperations, isRecommendableOperation } from '../repair/catalog.ts'
import type { GraphSurvey } from './survey.ts'
import type { Evidence, NetworkDiagnostic, NetworkPathGraph, ProxyEndpoint } from './types.ts'

interface DriftContext {
  graph: NetworkPathGraph
  survey: GraphSurvey
}

export function detectDrift(graph: NetworkPathGraph, survey: GraphSurvey): NetworkDiagnostic[] {
  const ctx: DriftContext = { graph, survey }
  const diagnostics: NetworkDiagnostic[] = []
  pushDiagnostic(diagnostics, dshProxyStale(ctx))
  pushDiagnostic(diagnostics, wslProxyStale(ctx))
  pushDiagnostic(diagnostics, envScopeDrift(ctx))
  pushDiagnostic(diagnostics, winhttpStale(ctx))
  pushDiagnostic(diagnostics, wslEnvDivergence(ctx))
  return sortDiagnostics(diagnostics)
}

function pushDiagnostic(list: NetworkDiagnostic[], diagnostic: NetworkDiagnostic | undefined): void {
  if (diagnostic !== undefined) list.push(diagnostic)
}

function dshProxyStale(ctx: DriftContext): NetworkDiagnostic | undefined {
  if (ctx.graph.model === 'WSL_DISTRIBUTION') return undefined // dedicated WSL rule
  const dsh = ctx.graph.dshPath
  if (dsh.egress.mode !== 'PROXY') return undefined
  const endpoint = dsh.egress.proxyEndpoint
  const failed = endpoint !== undefined
    && (endpoint.state === 'UNREACHABLE' || endpoint.state === 'UNUSABLE'
      || (endpoint.state === 'CONFIGURED' && endpoint.listener?.state === 'NOT_FOUND'))
  if (!failed) return undefined

  const listenerGone = endpoint.listener?.state === 'NOT_FOUND'
  return {
    code: 'DRIFT_DSH_PROXY_STALE',
    severity: 'error',
    confidence: listenerGone ? 0.95 : 0.85,
    pathIds: ['dsh'],
    humanMessage: listenerGone
      ? '发现配置漂移：DSH 仍在使用已经失效的代理配置，且该端口当前没有监听进程。'
      : '发现配置漂移：DSH 使用的代理端点无法连接。',
    technicalMessage: `DSH proxy ${endpoint.host}:${endpoint.port} ${endpoint.state}${listenerGone ? '; no listener' : ''}`,
    evidence: endpointEvidence(endpoint),
    actions: [{ code: 'clear-dsh-process-proxy', scope: 'dsh.process', label: '清除当前 DSH 进程的失效代理配置', safe: true }],
    firstFailingEdge: { edgeId: dsh.firstFailingEdgeId ?? 'dsh-proxy', from: 'Windows', to: `Proxy :${endpoint.port}` },
  }
}

function wslProxyStale(ctx: DriftContext): NetworkDiagnostic | undefined {
  if (ctx.graph.model !== 'WSL_DISTRIBUTION') return undefined
  const dsh = ctx.graph.dshPath
  if (dsh.egress.mode !== 'PROXY') return undefined
  const endpoint = dsh.egress.proxyEndpoint
  if (endpoint === undefined || (endpoint.state !== 'UNREACHABLE' && endpoint.state !== 'UNUSABLE')) return undefined
  const hostEdge = dsh.edges.find(edge => edge.from === 'dsh:layer' && edge.to === 'dsh:host')
  if (hostEdge !== undefined && hostEdge.status !== 'healthy') return undefined

  return {
    code: 'DRIFT_WSL_PROXY_STALE',
    severity: 'error',
    confidence: 0.9,
    pathIds: ['dsh'],
    humanMessage: `${ctx.survey.runtime.type === 'WSL_DISTRIBUTION' ? ctx.survey.runtime.registeredName ?? ctx.survey.runtime.displayName : 'WSL Distribution'} 中的 DSH 可以到达 Windows Host，但无法连接其代理端点。`,
    technicalMessage: `WSL DSH proxy ${endpoint.host}:${endpoint.port} ${endpoint.state}; host edge healthy`,
    evidence: endpointEvidence(endpoint),
    actions: [
      { code: 'clear-dsh-process-proxy', scope: 'dsh.process', label: '先清除当前 DSH 进程的失效代理', safe: true },
      { code: 'wsl-autoproxy-enable', scope: 'windows.wslconfig', label: '或启用 WSL autoProxy（需重启 WSL）', safe: true },
    ],
    firstFailingEdge: { edgeId: dsh.firstFailingEdgeId ?? 'wsl-proxy', from: 'WSL Distribution → Windows Host', to: `Proxy :${endpoint.port}` },
  }
}

function envScopeDrift(ctx: DriftContext): NetworkDiagnostic | undefined {
  const { graph, survey } = ctx
  const windows = survey.inspection.windows
  if (windows === undefined) return undefined
  const dshEnv = survey.inspection.dsh
  const userEnv = windows.environment.scopes.user
  const machineEnv = windows.environment.scopes.machine
  const dshProxy = firstProxyValue(dshEnv)
  if (dshProxy === undefined) return undefined
  if (firstProxyValue(userEnv) === dshProxy || firstProxyValue(machineEnv) === dshProxy) return undefined
  if (graph.dshPath.status !== 'healthy') return undefined

  return {
    code: 'DRIFT_DSH_ENV_SCOPE_DIFFERENT',
    severity: 'info',
    confidence: 0.9,
    pathIds: ['dsh'],
    humanMessage: 'DSH 进程的代理环境变量与 Windows User/Machine 作用域不同，但 DSH 链路当前可用；无需修改。',
    technicalMessage: `dsh=${dshProxy}; user=${firstProxyValue(userEnv) ?? 'unset'}; machine=${firstProxyValue(machineEnv) ?? 'unset'}`,
    evidence: [{ source: 'PROCESS_ENV', confidence: 'verified', value: dshProxy }],
    actions: [],
  }
}

function winhttpStale(ctx: DriftContext): NetworkDiagnostic | undefined {
  const { survey, graph } = ctx
  if (graph.dshPath.status !== 'healthy') return undefined
  const windows = survey.inspection.windows
  if (windows === undefined) return undefined
  for (const item of windows.proxy.winhttp) {
    if (!item.proxyEnabled || item.proxy === undefined || item.proxy === '') continue
    const endpoint = endpointForValue(item.proxy)
    const listener = endpoint === undefined ? undefined : windows.listeners.find(entry =>
      entry.port === endpoint.port
      && (entry.address === endpoint.host || entry.address === '0.0.0.0' || entry.address === '::'))
    if (listener !== undefined) continue
    const action = item.scope === 'user'
      ? [{ code: 'clear-winhttp-user-proxy', scope: 'windows.winhttp.user', label: '清除 WinHTTP 用户高级代理', safe: true }]
      : [{ code: 'reset-winhttp-machine-proxy', scope: 'windows.winhttp.machine', label: '重置 WinHTTP 机器代理为直连', safe: true }]
    return {
      code: 'DRIFT_WINHTTP_STALE',
      severity: 'warning',
      confidence: 0.8,
      pathIds: [],
      humanMessage: `WinHTTP ${item.scope} 作用域仍配置了代理 ${item.proxy}，但该端口没有监听进程。`,
      technicalMessage: `winhttp.${item.scope}=${item.proxy}; no listener`,
      evidence: [{ source: 'WINHTTP', confidence: 'verified', value: item.proxy }],
      actions: action,
    }
  }
  return undefined
}

function wslEnvDivergence(ctx: DriftContext): NetworkDiagnostic | undefined {
  const runtime = ctx.survey.runtime
  if (ctx.graph.model !== 'WSL_DISTRIBUTION' || runtime.type !== 'WSL_DISTRIBUTION') return undefined
  const registeredName = runtime.registeredName
  const distro = ctx.survey.inspection.wsl?.distributions.find(item =>
    item.state === 'running' && item.name === registeredName)
    ?? ctx.survey.inspection.wsl?.distributions.find(item => item.state === 'running')
  const distroEnv = distro?.network?.environment
  if (distroEnv === undefined) return undefined
  const distroProxy = firstProxyValue(distroEnv)
  const dshProxy = firstProxyValue(ctx.survey.inspection.dsh)
  if (distroProxy === undefined || dshProxy === undefined || distroProxy === dshProxy) return undefined
  if (ctx.graph.dshPath.status !== 'healthy') return undefined

  return {
    code: 'DRIFT_WSL_ENV_DIVERGENT',
    severity: 'info',
    confidence: 0.85,
    pathIds: ['dsh'],
    humanMessage: '当前 WSL Distribution 环境与 DSH 进程环境的代理变量不同，但 DSH 链路可用；配置不同不等于配置错误。',
    technicalMessage: `distro=${distroProxy}; dsh=${dshProxy}`,
    evidence: [{ source: 'PROCESS_ENV', confidence: 'verified', value: dshProxy }],
    actions: [],
  }
}

function firstProxyValue(env: EnvironmentScopeSnapshot | Record<string, unknown> | undefined): string | undefined {
  if (env === undefined) return undefined
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function endpointForValue(value: string): { host: string; port: number } | undefined {
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`)
    return { host: url.hostname, port: url.port === '' ? 80 : Number(url.port) }
  } catch {
    const match = /^([^:]+):(\d+)$/.exec(value.trim())
    return match === null ? undefined : { host: match[1] ?? '', port: Number(match[2]) }
  }
}

function endpointEvidence(endpoint: ProxyEndpoint): Evidence[] {
  return [
    ...endpoint.evidence,
    { source: 'DRIFT_RULE' as const, confidence: 'verified' as const, value: `endpoint ${endpoint.host}:${endpoint.port} state=${endpoint.state}` },
  ]
}

function sortDiagnostics(diagnostics: NetworkDiagnostic[]): NetworkDiagnostic[] {
  const rank = (severity: NetworkDiagnostic['severity']): number => severity === 'error' ? 0 : severity === 'warning' ? 1 : 2
  return diagnostics.sort((left, right) => rank(left.severity) - rank(right.severity) || right.confidence - left.confidence)
}

/** Attach the best recommendable drift diagnostic as the graph's repair hint.
 *  Only diagnostics that clear the shared confidence threshold and map to a
 *  whitelisted common operation become the highlighted recommendation. */
export function withDriftRecommendation(graph: NetworkPathGraph, diagnostics: NetworkDiagnostic[]): NetworkPathGraph {
  const eligible = diagnostics
    .filter(item => item.confidence >= RECOMMEND_CONFIDENCE_THRESHOLD)
    .filter(item => item.actions.some(action => diagnosisActionOperations(action).some(operation => isRecommendableOperation(operation.id))))
  const recommended = eligible.reduce<NetworkDiagnostic | undefined>(
    (best, item) => best === undefined || item.confidence > best.confidence ? item : best,
    undefined,
  )
  if (recommended === undefined) return graph
  return {
    ...graph,
    recommendedRepair: {
      diagnosisCode: recommended.code,
      actionCodes: recommended.actions.map(action => action.code),
      label: recommended.actions[0]?.label ?? recommended.humanMessage,
    },
  }
}
