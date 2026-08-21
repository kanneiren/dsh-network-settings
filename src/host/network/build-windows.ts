/** WINDOWS_NATIVE graph builder: DSH-only path. */
import type { LayeredProbe, WindowsInterface } from '../model.ts'
import {
  directProbeFor, dnsBranchFromProbe, egressFactsOf, endpointFromConfig, endpointStatusFromProbe,
  evidence, failureLayerLabel, gatewayNode, internetNode, processNode, targetEdge, targetNode,
  gatewayEvidenceOf, gatewayEvidenceLabel,
  interfaceLabel, pathStatusOfProbe, probeEvidence, probeEvidenceList,
  proxyProbeFor, resolveEnvProxy, statusOfCheck, statusText, uplinkEdges, uplinkNodes,
  type EgressFacts,
} from './shared.ts'
import type { GraphSurvey } from './survey.ts'
import { windowsOf } from '../model.ts'
import type { NetworkPath, PathEdge, PathNode, PathStatus, ProxyConfiguration, ProxyEndpoint } from './types.ts'

export interface BuiltDshPath {
  path: NetworkPath
  proxyNodeId?: string
}

export function buildWindowsNativeDshPath(survey: GraphSurvey): BuiltDshPath {
  const { inspection, target } = survey
  const windows = windowsOf(inspection)
  const egress = egressFactsOf(windows.network)
  const config = resolveEnvProxy(inspection.dsh, target, 'DSH_PROCESS_ENV', 'DSH Process / 代理环境变量')
  return config === undefined
    ? buildDirectPath(survey, egress)
    : buildProxyPath(survey, config, egress)
}

function buildDirectPath(survey: GraphSurvey, egress: EgressFacts): BuiltDshPath {
  const { inspection, target } = survey
  const windows = windowsOf(inspection)
  const { adapter, adapterIp, gateway, gatewayMeasured } = egress
  const probe = directProbeFor(target, inspection.probes)
  const tcp: PathStatus = statusOfCheck(probe?.layers.tcp)
  const tls: PathStatus = statusOfCheck(probe?.layers.tls)
  const http: PathStatus = statusOfCheck(probe?.layers.http)
  const targetReached = http === 'healthy' || tls === 'healthy'
  const gatewayReachable = gatewayEvidenceOf(windowsOf(inspection).network, targetReached, gatewayMeasured)
  const adapterStatus: PathStatus = targetReached || tcp === 'healthy' || gatewayReachable ? 'healthy' : 'unknown'
  const targetFailed = http === 'error' || tls === 'error' || tcp === 'error'
  const hostAddress = egress.uplinkIp ?? adapterIp

  const nodes: PathNode[] = [
    processNode('DeepSeek Harness'),
    {
      id: 'dsh:host', type: 'HOST', role: 'main', label: 'Windows',
      subtitle: windowsOsLabel(inspection),
      ...hostAddress === undefined ? {} : { address: hostAddress },
      status: 'healthy',
      evidence: [evidence('WINDOWS_API', 'verified', 'DSH 进程运行于 Windows')],
    },
    {
      id: 'dsh:adapter', type: 'INTERFACE', role: 'main', label: interfaceLabel(adapter),
      subtitle: adapter === undefined ? '未识别活动接口' : `${adapter.name} · ${adapter.kind}`,
      ...adapterIp === undefined ? {} : { address: adapterIp },
      status: adapterStatus,
      details: adapter === undefined ? [] : adapterDetails(adapter),
      evidence: [evidence('WINDOWS_ROUTE', 'verified', routeEvidence(inspection))],
    },
    ...uplinkNodes(egress, adapterStatus),
    gatewayNode(gateway, gatewayReachable ? 'healthy' : 'unknown',
      gateway === undefined ? '未识别默认网关' : gatewayReachable ? gatewayEvidenceLabel(windowsOf(inspection).network, gatewayMeasured, 'subtitle') : '网关未响应探测 · 可能禁 ping'),
    {
      id: 'dsh:internet', type: 'INTERNET', role: 'main', label: 'Internet',
      status: targetReached ? 'healthy' : tcp === 'healthy' ? 'healthy' : 'unknown',
      evidence: [evidence('HTTP_PROBE', targetReached ? 'verified' : 'inferred', probe?.layers.http?.humanMessage ?? 'no http probe')],
    },
targetNode(target, targetFailed ? 'error' : targetReached ? 'healthy' : 'unknown'),
  ]

  const edges: PathEdge[] = [
    { from: 'dsh:process', to: 'dsh:host', relation: 'DIRECT', status: 'healthy', label: '本机网络栈', evidence: [evidence('WINDOWS_API', 'verified', 'process runs on Windows')] },
    { from: 'dsh:host', to: 'dsh:adapter', relation: 'ROUTE', status: adapterStatus, label: routeLabel(inspection), evidence: [evidence('WINDOWS_ROUTE', 'verified', routeEvidence(inspection))] },
    ...uplinkEdges(egress, adapterStatus),
    { from: egress.uplink === undefined ? 'dsh:adapter' : 'dsh:uplink', to: 'dsh:gateway', relation: 'ROUTE', status: gatewayReachable ? 'healthy' : 'unknown', label: gateway === undefined ? '无默认网关' : gatewayReachable ? gatewayEvidenceLabel(windowsOf(inspection).network, gatewayMeasured, 'edge') : '下一跳' },
    { from: 'dsh:gateway', to: 'dsh:internet', relation: 'ROUTE', status: targetReached || gatewayReachable ? 'healthy' : 'unknown', label: '默认路由' },
    {
      from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION',
      status: targetFailed ? 'error' : targetReached ? 'healthy' : 'unknown',
      label: targetFailed ? failureLayerLabel(probe) : targetReached ? 'TLS/HTTP 实测' : '未探测',
      evidence: [probeEvidence(probe, 'http')],
    },
  ]

  const firstFailure = edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  return {
    path: {
      id: 'dsh',
      label: '链路',
      status: pathStatusOfProbe(probe),
      egress: { mode: 'DIRECT' },
      nodes,
      edges,
      dns: [dnsBranchFromProbe(probe, target, 'dsh:dns', false)],
      ...firstFailure === undefined ? {} : { firstFailingEdgeId: `${firstFailure.from}->${firstFailure.to}` },
      ...probe === undefined ? {} : { probe },
    },
  }
}

function buildProxyPath(survey: GraphSurvey, config: ProxyConfiguration, egress: EgressFacts): BuiltDshPath {
  const { inspection, target } = survey
  const windows = windowsOf(inspection)
  const { adapter, adapterIp, gateway, gatewayMeasured } = egress
  const endpoint = endpointFromConfig(config, windows.listeners)
  const probe = endpoint === undefined ? undefined : proxyProbeFor(endpoint, inspection.probes, 'dsh')
  const endpointState = endpointStatusFromProbe(probe)
  const effectiveEndpoint: ProxyEndpoint | undefined = endpoint === undefined ? undefined : { ...endpoint, state: endpointState }
  const tcp: PathStatus = statusOfCheck(probe?.layers.tcp)
  const http: PathStatus = statusOfCheck(probe?.layers.http)
  const tls: PathStatus = statusOfCheck(probe?.layers.tls)
  const gatewayReachable = gatewayEvidenceOf(windowsOf(inspection).network, http === 'healthy', gatewayMeasured)
  const endpointHealthy = endpointState === 'USABLE' || endpointState === 'REACHABLE'
  const endpointFailed = endpointState === 'UNREACHABLE' || endpointState === 'UNUSABLE'
  const hostAddress = egress.uplinkIp ?? adapterIp

  const proxyNode: PathNode = {
    id: 'dsh:proxy', type: 'PROXY', role: 'main', label: `Proxy :${config.port ?? '?'}`,
    subtitle: effectiveEndpoint?.listener?.state === 'LISTENING'
      ? `${effectiveEndpoint.listener.processName ?? '监听进程'}${effectiveEndpoint.listener.pid === undefined ? '' : ` · PID ${effectiveEndpoint.listener.pid}`}`
      : effectiveEndpoint?.listener?.state === 'NOT_FOUND' ? '未找到监听进程' : '监听状态未知',
    ...config.host === undefined ? {} : { address: config.host },
    ...config.port === undefined ? {} : { port: config.port },
    status: endpointFailed ? 'error' : endpointHealthy ? 'healthy' : 'unknown',
    details: proxyDetails(config, effectiveEndpoint, endpointState, probe),
    evidence: [...config.evidence, ...effectiveEndpoint?.evidence ?? [], ...probeEvidenceList(probe)],
  }

  const downstream: PathStatus = endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown'
  const targetStatus: PathStatus = endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : http === 'error' || tls === 'error' ? 'error' : 'unknown'
  const adapterStatus: PathStatus = downstream === 'healthy' || gatewayReachable ? 'healthy' : downstream

  const nodes: PathNode[] = [
    processNode('DeepSeek Harness'),
    { id: 'dsh:host', type: 'HOST', role: 'main', label: 'Windows', subtitle: windowsOsLabel(inspection), ...hostAddress === undefined ? {} : { address: hostAddress }, status: 'healthy' },
    proxyNode,
    {
      id: 'dsh:adapter', type: 'INTERFACE', role: 'main', label: interfaceLabel(adapter),
      subtitle: adapter === undefined ? '未识别活动接口' : `${adapter.name} · ${adapter.kind}`,
      ...adapterIp === undefined ? {} : { address: adapterIp },
      status: adapterStatus,
      details: adapter === undefined ? [] : adapterDetails(adapter),
    },
    ...uplinkNodes(egress, adapterStatus),
    gatewayNode(gateway, endpointFailed ? 'not-applicable' : gatewayReachable ? 'healthy' : 'unknown',
      gateway === undefined ? '未识别默认网关' : gatewayReachable ? gatewayEvidenceLabel(windowsOf(inspection).network, gatewayMeasured, 'subtitle') : '网关未响应探测 · 可能禁 ping'),
    internetNode(endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown'),
    targetNode(target, targetStatus),
  ]

  const proxyEdgeStatus: PathStatus = endpointFailed ? 'error' : endpointHealthy ? 'healthy' : 'unknown'
  const edges: PathEdge[] = [
    { from: 'dsh:process', to: 'dsh:host', relation: 'DIRECT', status: 'healthy', label: '本机网络栈' },
    { from: 'dsh:host', to: 'dsh:proxy', relation: 'PROXY', status: proxyEdgeStatus, label: config.source, evidence: [...config.evidence, ...probeEvidenceList(probe)] },
    { from: 'dsh:proxy', to: 'dsh:adapter', relation: 'ROUTE', status: downstream, label: endpointFailed ? '未到达' : '代理进程出站（Windows 路由推断）' },
    ...uplinkEdges(egress, adapterStatus),
    { from: egress.uplink === undefined ? 'dsh:adapter' : 'dsh:uplink', to: 'dsh:gateway', relation: 'ROUTE', status: endpointFailed ? 'not-applicable' : gatewayReachable ? 'healthy' : 'unknown', label: gateway === undefined ? '无默认网关' : gatewayReachable ? gatewayEvidenceLabel(windowsOf(inspection).network, gatewayMeasured, 'edge') : '下一跳' },
    { from: 'dsh:gateway', to: 'dsh:internet', relation: 'ROUTE', status: endpointFailed ? 'not-applicable' : http === 'healthy' || gatewayReachable ? 'healthy' : 'unknown', label: '默认路由' },
    {
      from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION', status: targetStatus,
      label: targetStatus === 'healthy' ? '经代理 TLS/HTTP 实测' : targetStatus === 'error' ? failureLayerLabel(probe) : '未探测',
      evidence: [probeEvidence(probe, 'http')],
    },
  ]

  const firstFailure = edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  return {
    path: {
      id: 'dsh',
      label: '链路',
      status: endpointFailed ? 'error' : pathStatusOfProbe(probe),
      egress: { mode: 'PROXY', proxyConfiguration: config, ...effectiveEndpoint === undefined ? {} : { proxyEndpoint: effectiveEndpoint } },
      nodes,
      edges,
      dns: [dnsBranchFromProbe(probe, target, 'dsh:dns', true)],
      ...firstFailure === undefined ? {} : { firstFailingEdgeId: `${firstFailure.from}->${firstFailure.to}` },
      ...probe === undefined ? {} : { probe },
    },
    proxyNodeId: proxyNode.id,
  }
}

function windowsOsLabel(inspection: GraphSurvey['inspection']): string {
  const os = windowsOf(inspection).os
  return os === undefined ? 'Windows' : `${os.caption} · build ${os.build}`
}

function adapterDetails(adapter: WindowsInterface): Array<{ label: string; value: string }> {
  return [
    { label: '接口名称', value: adapter.name },
    { label: '接口描述', value: adapter.description },
    { label: 'IPv4', value: adapter.ipv4.join(', ') || '-' },
    { label: '网关', value: adapter.gateways.join(', ') || '-' },
    { label: 'DNS', value: adapter.dns.join(', ') || '-' },
  ]
}

function routeEvidence(inspection: GraphSurvey['inspection']): string {
  const route = windowsOf(inspection).network.defaultRoutes[0]
  return route === undefined ? 'no default route' : `default route via ${route.nextHop} metric ${route.metric ?? '?'}`
}

function routeLabel(inspection: GraphSurvey['inspection']): string {
  const route = windowsOf(inspection).network.defaultRoutes[0]
  return route === undefined ? '默认路由未识别' : `默认路由 · metric ${route.metric ?? '?'}`
}

function proxyDetails(config: ProxyConfiguration, endpoint: ProxyEndpoint | undefined, state: ProxyEndpoint['state'], probe: LayeredProbe | undefined) {
  return [
    { label: '配置来源', value: config.source, evidence: config.evidence },
    { label: '配置地址', value: config.displayValue, evidence: config.evidence },
    { label: '监听状态', value: endpoint?.listener === undefined ? '未知' : endpoint.listener.state === 'LISTENING' ? '正常' : '未找到', evidence: endpoint?.listener?.evidence ?? [] },
    ...endpoint?.listener?.processName === undefined ? [] : [{ label: '监听进程', value: endpoint.listener.processName }],
    ...endpoint?.listener?.pid === undefined ? [] : [{ label: 'PID', value: String(endpoint.listener.pid) }],
    { label: 'Endpoint 状态', value: state },
    { label: 'TCP status', value: statusText(statusOfCheck(probe?.layers.tcp)) },
    { label: 'HTTP status', value: statusText(statusOfCheck(probe?.layers.http)) },
  ]
}

function probeDetails(probe: LayeredProbe | undefined, targetDisplay: string) {
  return [
    { label: 'Target', value: targetDisplay },
    { label: 'TCP status', value: statusText(statusOfCheck(probe?.layers.tcp)) },
    { label: 'TLS status', value: statusText(statusOfCheck(probe?.layers.tls)) },
    { label: 'HTTP status', value: statusText(statusOfCheck(probe?.layers.http)) },
  ]
}



