/** MACOS_NATIVE graph builder: DSH-only path.
 *  Module facade — public surface: buildMacDshPath(). */
import type { LayeredProbe, MacInspection } from '../model.ts'
import {
  dnsBranchFromProbe, endpointFromConfig, endpointStatusFromProbe, evidence,
  failureLayerLabel, pathStatusOfProbe, probeEvidence, resolveEnvProxy,
  statusOfCheck,
} from './shared.ts'
import type { GraphSurvey } from './survey.ts'
import type { MacNativeRuntime, NetworkPath, PathNode, PathStatus, ProxyConfiguration } from './types.ts'

export interface BuiltDshPath {
  path: NetworkPath
  proxyNodeId?: string
}

export function buildMacDshPath(survey: GraphSurvey): BuiltDshPath {
  const config = resolveEnvProxy(survey.inspection.dsh, survey.target, 'DSH_PROCESS_ENV', 'DSH Process / 代理环境变量')
  return config === undefined
    ? buildDirectPath(survey)
    : buildProxyPath(survey, config)
}

function osLabel(macos: MacInspection | undefined): string {
  const os = macos?.os
  return os === undefined || os.version === '' ? 'macOS' : `${os.caption} ${os.version}`
}

function primaryInterface(macos: MacInspection | undefined): MacInspection['network']['interfaces'][number] | undefined {
  const network = macos?.network
  if (network === undefined) return undefined
  const byDevice = network.gatewayInterface === undefined ? undefined : network.interfaces.find(item => item.device === network.gatewayInterface)
  return byDevice ?? network.interfaces.find(item => item.kind === 'wi-fi') ?? network.interfaces[0]
}

function buildDirectPath(survey: GraphSurvey): BuiltDshPath {
  const { inspection, target } = survey
  const probe = directProbeFor(target, inspection.probes)
  const http = statusOfCheck(probe?.layers.http)
  const tls = statusOfCheck(probe?.layers.tls)
  const tcp = statusOfCheck(probe?.layers.tcp)
  const targetReached = http === 'healthy' || tls === 'healthy'
  const targetFailed = http === 'error' || tls === 'error' || tcp === 'error'
  const gatewayReachable = targetReached || tcp === 'healthy'
  const adapter = primaryInterface(inspection.macos)
  const interfaceStatus: PathStatus = targetReached || tcp === 'healthy' ? 'healthy' : 'unknown'

  const nodes: PathNode[] = [
    { id: 'dsh:process', type: 'PROCESS', role: 'main', label: 'DSH', subtitle: 'DeepSeek Harness', status: 'healthy' },
    { id: 'dsh:host', type: 'HOST', role: 'main', label: 'macOS', subtitle: osLabel(inspection.macos), status: 'healthy' },
    {
      id: 'dsh:adapter', type: 'INTERFACE', role: 'main',
      label: adapter?.name ?? '网络接口',
      subtitle: adapter === undefined ? '未识别活动接口' : `${adapter.device} · ${adapter.kind}`,
      status: interfaceStatus,
    },
    {
      id: 'dsh:gateway', type: 'GATEWAY', role: 'main', label: 'Gateway',
      ...inspection.macos?.network.gateway === undefined ? {} : { address: inspection.macos?.network.gateway },
      status: gatewayReachable ? 'healthy' : 'unknown',
      subtitle: gatewayReachable ? '端到端探测通过默认网关' : '网关未知 · 以端到端探测为准',
    },
    { id: 'dsh:internet', type: 'INTERNET', role: 'main', label: 'Internet', status: targetReached ? 'healthy' : 'unknown' },
    {
      id: 'dsh:target', type: 'TARGET', role: 'main', label: target.display, subtitle: target.label,
      ...target.port === undefined ? {} : { port: target.port },
      status: targetFailed ? 'error' : targetReached ? 'healthy' : 'unknown',
      details: [
        { label: 'TCP status', value: statusTextOf(tcp) },
        { label: 'TLS status', value: statusTextOf(statusOfCheck(probe?.layers.tls)) },
        { label: 'HTTP status', value: statusTextOf(http) },
      ],
    },
  ]

  return {
    path: {
      id: 'dsh',
      label: '链路',
      status: pathStatusOfProbe(probe),
      egress: { mode: 'DIRECT' },
      nodes,
      edges: [
        { from: 'dsh:process', to: 'dsh:host', relation: 'DIRECT', status: 'healthy', label: '本机网络栈' },
        { from: 'dsh:host', to: 'dsh:adapter', relation: 'ROUTE', status: interfaceStatus, label: adapter === undefined ? '默认路由未识别' : `出口 ${adapter.device}` },
        { from: 'dsh:adapter', to: 'dsh:gateway', relation: 'ROUTE', status: gatewayReachable ? 'healthy' : 'unknown', label: inspection.macos?.network.gateway === undefined ? '下一跳' : `→ ${inspection.macos?.network.gateway}` },
        { from: 'dsh:gateway', to: 'dsh:internet', relation: 'ROUTE', status: targetReached || gatewayReachable ? 'healthy' : 'unknown', label: '默认路由' },
        {
          from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION',
          status: targetFailed ? 'error' : targetReached ? 'healthy' : 'unknown',
          label: targetFailed ? failureLayerLabel(probe) : targetReached ? 'TLS/HTTP 实测' : '未探测',
          evidence: [probeEvidence(probe, 'http')],
        },
      ],
      dns: [dnsBranchFromProbe(probe, target, 'dsh:dns', false)],
      ...probe === undefined ? {} : { probe },
    },
  }
}

function buildProxyPath(survey: GraphSurvey, config: ProxyConfiguration): BuiltDshPath {
  const { inspection, target } = survey
  const endpoint = endpointFromConfig(config, inspection.windows?.listeners ?? inspection.macos?.listeners ?? [])
  const probe = endpoint === undefined ? undefined : proxyProbeFor(endpoint, inspection.probes)
  const endpointState = endpointStatusFromProbe(probe)
  const effectiveEndpoint = endpoint === undefined ? undefined : { ...endpoint, state: endpointState }
  const http = statusOfCheck(probe?.layers.http)
  const tls = statusOfCheck(probe?.layers.tls)
  const endpointFailed = endpointState === 'UNREACHABLE' || endpointState === 'UNUSABLE'
  const endpointHealthy = endpointState === 'USABLE' || endpointState === 'REACHABLE'
  const adapter = primaryInterface(inspection.macos)
  const targetStatus: PathStatus = endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : http === 'error' || tls === 'error' ? 'error' : 'unknown'

  const nodes: PathNode[] = [
    { id: 'dsh:process', type: 'PROCESS', role: 'main', label: 'DSH', subtitle: 'DeepSeek Harness', status: 'healthy' },
    { id: 'dsh:host', type: 'HOST', role: 'main', label: 'macOS', subtitle: osLabel(inspection.macos), status: 'healthy' },
    {
      id: 'dsh:proxy', type: 'PROXY', role: 'main', label: `Proxy :${config.port ?? '?'}`,
      subtitle: effectiveEndpoint?.listener?.state === 'LISTENING'
        ? `${effectiveEndpoint.listener.processName ?? '监听进程'}${effectiveEndpoint.listener.pid === undefined ? '' : ` · PID ${effectiveEndpoint.listener.pid}`}`
        : effectiveEndpoint?.listener?.state === 'NOT_FOUND' ? '未找到监听进程' : '监听状态未知',
      ...config.host === undefined ? {} : { address: config.host },
      ...config.port === undefined ? {} : { port: config.port },
      status: endpointFailed ? 'error' : endpointHealthy ? 'healthy' : 'unknown',
      evidence: [...config.evidence, ...(effectiveEndpoint?.evidence ?? [])],
    },
    {
      id: 'dsh:adapter', type: 'INTERFACE', role: 'main', label: adapter?.name ?? '网络接口',
      subtitle: adapter === undefined ? '未识别活动接口' : `${adapter.device} · ${adapter.kind}`,
      status: endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown',
    },
    { id: 'dsh:internet', type: 'INTERNET', role: 'main', label: 'Internet', status: endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown' },
    {
      id: 'dsh:target', type: 'TARGET', role: 'main', label: target.display, subtitle: target.label,
      ...target.port === undefined ? {} : { port: target.port },
      status: targetStatus,
    },
  ]

  return {
    path: {
      id: 'dsh',
      label: '链路',
      status: endpointFailed ? 'error' : pathStatusOfProbe(probe),
      egress: { mode: 'PROXY', proxyConfiguration: config, ...effectiveEndpoint === undefined ? {} : { proxyEndpoint: effectiveEndpoint } },
      nodes,
      edges: [
        { from: 'dsh:process', to: 'dsh:host', relation: 'DIRECT', status: 'healthy', label: '本机网络栈' },
        { from: 'dsh:host', to: 'dsh:proxy', relation: 'PROXY', status: endpointFailed ? 'error' : endpointHealthy ? 'healthy' : 'unknown', label: config.source, evidence: [...config.evidence] },
        { from: 'dsh:proxy', to: 'dsh:adapter', relation: 'ROUTE', status: endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown', label: '代理进程出站（推断）' },
        { from: 'dsh:adapter', to: 'dsh:internet', relation: 'ROUTE', status: endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown', label: '默认路由' },
        {
          from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION', status: targetStatus,
          label: targetStatus === 'healthy' ? '经代理 TLS/HTTP 实测' : targetStatus === 'error' ? failureLayerLabel(probe) : '未探测',
          evidence: [probeEvidence(probe, 'http')],
        },
      ],
      dns: [dnsBranchFromProbe(probe, target, 'dsh:dns', true)],
      ...probe === undefined ? {} : { probe },
    },
    proxyNodeId: 'dsh:proxy',
  }
}

function directProbeFor(target: GraphSurvey['target'], probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  return probes.find(probe => probe.path === 'direct' && probe.target.id === target.id)
    ?? probes.find(probe => probe.path === 'direct' && probe.target.host === target.host)
}

function proxyProbeFor(endpoint: { host: string; port: number }, probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  return probes.find(probe => {
    const details = probe.layers.tcp?.details as { host?: unknown; port?: unknown } | undefined
    return details?.host === endpoint.host && details?.port === endpoint.port
  })
}

function statusTextOf(status: PathStatus): string {
  return status === 'healthy' ? '正常' : status === 'error' ? '失败' : status === 'warning' ? '警告' : status === 'not-applicable' ? '不适用' : '未知'
}

export type { MacNativeRuntime }
