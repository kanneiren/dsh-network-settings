/** WSL_DISTRIBUTION graph builder: DSH-only path. */
import type { LayeredProbe, WindowsInterface, WslDistribution } from '../model.ts'
import {
  dnsBranchFromProbe, endpointFromConfig, endpointStatusFromProbe,
  evidence, gatewayOf, interfaceIpv4, interfaceLabel, pathStatusOfProbe,
  resolveEnvProxy, selectActiveAdapter, selectUplinkAdapter, sameAdapter, statusOfCheck,
} from './shared.ts'
import type { GraphSurvey } from './survey.ts'
import type {
  NetworkPath, PathEdge, PathEdgeRelation, PathNode, PathStatus,
  ProxyConfiguration, ProxyEndpoint, WslDistributionRuntime,
} from './types.ts'

export interface BuiltDshPath {
  path: NetworkPath
  proxyNodeId?: string
}

export function currentDistribution(runtime: WslDistributionRuntime, survey: GraphSurvey): WslDistribution | undefined {
  const distributions = survey.inspection.wsl?.distributions ?? []
  const running = distributions.filter(distribution => distribution.state === 'running')
  if (runtime.registeredName !== undefined) {
    return running.find(distribution => distribution.name === runtime.registeredName)
      ?? distributions.find(distribution => distribution.name === runtime.registeredName)
  }
  return running[0]
}

export function buildWslDshPath(survey: GraphSurvey): BuiltDshPath {
  const runtime = survey.runtime as WslDistributionRuntime
  const distro = currentDistribution(runtime, survey)
  const { inspection, target } = survey
  const adapter = selectActiveAdapter(inspection.windows.network)
  const physical = selectUplinkAdapter(inspection.windows.network)
  const egress = {
    adapter,
    adapterIp: interfaceIpv4(adapter),
    uplink: sameAdapter(physical, adapter) ? undefined : physical,
    uplinkIp: interfaceIpv4(physical),
    gateway: (sameAdapter(physical, adapter) ? undefined : gatewayOf(physical)) ?? gatewayOf(adapter),
    gatewayMeasured: false as boolean,
  }
  egress.gatewayMeasured = egress.gateway !== undefined && egress.gateway === inspection.windows.network.defaultRoutes[0]?.nextHop
  const config = resolveEnvProxy(inspection.windows.dshProcessEnvironment, target, 'DSH_PROCESS_ENV', 'DSH Process / 代理环境变量')
  return config === undefined
    ? buildWslDirectPath(survey, runtime, distro, egress)
    : buildWslProxyPath(survey, runtime, distro, config, egress)
}

interface WslEgress {
  adapter: WindowsInterface | undefined
  adapterIp: string | undefined
  uplink: WindowsInterface | undefined
  uplinkIp: string | undefined
  gateway: string | undefined
  gatewayMeasured: boolean
}

function uplinkNode(egress: WslEgress, status: PathStatus): PathNode | undefined {
  if (egress.uplink === undefined) return undefined
  return {
    id: 'dsh:uplink', type: 'INTERFACE', role: 'main', label: interfaceLabel(egress.uplink),
    subtitle: `${egress.uplink.name} · 物理出口`,
    ...egress.uplinkIp === undefined ? {} : { address: egress.uplinkIp },
    status,
  }
}

function buildWslDirectPath(
  survey: GraphSurvey,
  runtime: WslDistributionRuntime,
  distro: WslDistribution | undefined,
  egress: WslEgress,
): BuiltDshPath {
  const { inspection, target } = survey
  const { adapter, adapterIp, gateway, gatewayMeasured } = egress
  const baseProbe = directWslProbeFor(target, distro, inspection.probes)
  const dnsProbe = wslDnsProbeFor(target, distro, inspection.probes)
  const probe = baseProbe !== undefined && dnsProbe?.layers.dns !== undefined
    ? { ...baseProbe, layers: { ...baseProbe.layers, dns: dnsProbe.layers.dns } }
    : baseProbe
  const hostProbe = windowsHostProbeFor(distro, inspection.probes)
  const hostTcp: PathStatus = statusOfCheck(hostProbe?.layers.tcp)
  const tcp: PathStatus = statusOfCheck(probe?.layers.tcp)
  const tls: PathStatus = statusOfCheck(probe?.layers.tls)
  const http: PathStatus = statusOfCheck(probe?.layers.http)
  const targetReached = http === 'healthy' || tls === 'healthy'
  // End-to-end success proves traffic already traversed WSL Network and the
  // Windows host hop; a host TCP probe that timed out (dropped SYN, common
  // behind firewalls/VPN TUN) must not mark that segment as failed then.
  const hostSegment = hostSegmentStatus(hostTcp, targetReached)
  const gatewayReachable = gatewayEvidenceOf(inspection.windows.network, targetReached, gatewayMeasured)
  const targetFailed = http === 'error' || tls === 'error' || tcp === 'error'
  const linuxIp = distro?.network?.interfaces?.flatMap(item => item.ipv4)[0]
  const hostAddress = hostAddressOf(distro)

  const nodes: PathNode[] = [
    { id: 'dsh:process', type: 'PROCESS', role: 'main', label: 'DSH', subtitle: `DSH / ${runtime.registeredName ?? runtime.displayName}`, status: 'healthy' },
    {
      id: 'dsh:distro', type: 'DISTRIBUTION', role: 'main', label: distro?.name ?? runtime.registeredName ?? runtime.displayName,
      subtitle: `${runtime.displayName}${linuxIp === undefined ? '' : ` · ${linuxIp}`}`,
      ...linuxIp === undefined ? {} : { address: linuxIp },
      status: 'healthy',
      details: distroDetails(distro, runtime),
      evidence: [evidence('OS_RELEASE', 'verified', runtime.displayName), evidence('WSL_LIST', runtime.registeredName === undefined ? 'inferred' : 'verified', distro?.name ?? runtime.registeredName ?? 'unknown distro')],
    },
    {
      id: 'dsh:layer', type: 'NETWORK_LAYER', role: 'main', label: 'WSL Network',
      subtitle: networkLayerLabel(runtime),
      status: hostSegment,
      details: [{ label: 'Network mode', value: runtime.networkLayer.mode }, { label: '配置来源', value: runtime.networkLayer.modeConfigured ? '.wslconfig' : 'WSL 默认' }],
      evidence: [evidence('WSL_CONFIG', 'verified', `mode=${runtime.networkLayer.mode}`)],
    },
    {
      id: 'dsh:host', type: 'HOST', role: 'main', label: 'Windows Host', subtitle: 'WSL 可达',
      ...hostAddress === undefined ? {} : { address: hostAddress },
      status: hostSegment,
      evidence: [
        evidence('WSL_ROUTE', 'verified', hostRouteEvidence(distro)),
        ...hostTcp === 'healthy' || !targetReached ? [] : [evidence('HTTP_PROBE', 'inferred', '端到端直连成功 · 反推 WSL→Windows Host 可达')],
      ],
    },
    {
      id: 'dsh:adapter', type: 'INTERFACE', role: 'main', label: interfaceLabel(adapter),
      subtitle: adapter === undefined ? '未识别活动接口' : `${adapter.name} · ${adapter.kind}`,
      ...adapterIp === undefined ? {} : { address: adapterIp },
      status: targetReached || gatewayReachable ? 'healthy' : 'unknown',
    },
    ...uplinkNode(egress, targetReached || gatewayReachable ? 'healthy' : 'unknown') === undefined ? [] : [uplinkNode(egress, targetReached || gatewayReachable ? 'healthy' : 'unknown')!],
    { id: 'dsh:gateway', type: 'GATEWAY', role: 'main', label: 'Gateway', ...gateway === undefined ? {} : { address: gateway }, status: gatewayReachable ? 'healthy' : 'unknown', subtitle: gateway === undefined ? '未识别默认网关' : gatewayReachable ? gatewaySubtitle(inspection, gatewayMeasured) : '网关未响应探测 · 可能禁 ping' },
    { id: 'dsh:internet', type: 'INTERNET', role: 'main', label: 'Internet', status: targetReached ? 'healthy' : 'unknown' },
    {
      id: 'dsh:target', type: 'TARGET', role: 'main', label: target.display, subtitle: target.label,
      ...target.port === undefined ? {} : { port: target.port },
      status: targetFailed ? 'error' : targetReached ? 'healthy' : 'unknown',
      details: probeDetails(probe, target.display),
    },
  ]

  const edges: PathEdge[] = [
    { from: 'dsh:process', to: 'dsh:distro', relation: 'DIRECT', status: 'healthy', label: 'WSL 用户空间' },
    { from: 'dsh:distro', to: 'dsh:layer', relation: relationFor(runtime), status: hostSegment, label: networkLayerLabel(runtime), evidence: [evidence('WSL_CONFIG', 'verified', `mode=${runtime.networkLayer.mode}`)] },
    { from: 'dsh:layer', to: 'dsh:host', relation: relationFor(runtime) === 'MIRRORED' ? 'MIRRORED' : 'ROUTE', status: hostSegment, label: hostEdgeLabel(runtime, distro), evidence: [evidence('WSL_ROUTE', 'verified', hostRouteEvidence(distro)), probeEvidence(hostProbe, 'tcp')] },
    { from: 'dsh:host', to: 'dsh:adapter', relation: 'ROUTE', status: targetReached || gatewayReachable ? 'healthy' : 'unknown', label: 'Windows 路由' },
    ...(egress.uplink === undefined ? [] : [{ from: 'dsh:adapter', to: 'dsh:uplink', relation: 'ROUTE' as const, status: targetReached || gatewayReachable ? ('healthy' as const) : ('unknown' as const), label: egress.adapter?.kind === 'vpn' ? 'TUN/VPN 出站' : 'Windows 路由' }]),
    { from: egress.uplink === undefined ? 'dsh:adapter' : 'dsh:uplink', to: 'dsh:gateway', relation: 'ROUTE', status: gatewayReachable ? 'healthy' : 'unknown', label: gatewayReachable ? gatewayEdgeLabel(inspection, gatewayMeasured) : '下一跳' },
    { from: 'dsh:gateway', to: 'dsh:internet', relation: 'ROUTE', status: targetReached || gatewayReachable ? 'healthy' : 'unknown', label: '默认路由' },
    {
      from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION',
      status: targetFailed ? 'error' : targetReached ? 'healthy' : 'unknown',
      label: targetReached ? 'TLS/HTTP 实测' : targetFailed ? failureLayerLabel(probe) : '未探测',
      evidence: [probeEvidence(probe, 'http')],
    },
  ]

  const firstFailure = edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  return {
    path: {
      id: 'dsh',
      label: `链路 / ${runtime.registeredName ?? runtime.displayName}`,
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

function buildWslProxyPath(
  survey: GraphSurvey,
  runtime: WslDistributionRuntime,
  distro: WslDistribution | undefined,
  config: ProxyConfiguration,
  egress: WslEgress,
): BuiltDshPath {
  const { inspection, target } = survey
  const { adapter, adapterIp, gateway, gatewayMeasured } = egress
  const endpoint = endpointFromConfig(config, inspection.windows.listeners)
  const probe = endpoint === undefined ? undefined : wslProxyProbeFor(config, distro, inspection.probes)
  const endpointState = endpointStatusFromProbe(probe)
  const effectiveEndpoint: ProxyEndpoint | undefined = endpoint === undefined ? undefined : { ...endpoint, state: endpointState }
  const tcp: PathStatus = statusOfCheck(probe?.layers.tcp)
  const http: PathStatus = statusOfCheck(probe?.layers.http)
  const tls: PathStatus = statusOfCheck(probe?.layers.tls)
  const gatewayReachable = gatewayEvidenceOf(inspection.windows.network, http === 'healthy', gatewayMeasured)
  const endpointHealthy = endpointState === 'USABLE' || endpointState === 'REACHABLE'
  const endpointFailed = endpointState === 'UNREACHABLE' || endpointState === 'UNUSABLE'
  const linuxIp = distro?.network?.interfaces?.flatMap(item => item.ipv4)[0]
  const hostAddress = hostAddressOf(distro)

  const nodes: PathNode[] = [
    { id: 'dsh:process', type: 'PROCESS', role: 'main', label: 'DSH', subtitle: `DSH / ${runtime.registeredName ?? runtime.displayName}`, status: 'healthy' },
    {
      id: 'dsh:distro', type: 'DISTRIBUTION', role: 'main', label: distro?.name ?? runtime.registeredName ?? runtime.displayName,
      subtitle: `${runtime.displayName}${linuxIp === undefined ? '' : ` · ${linuxIp}`}`,
      ...linuxIp === undefined ? {} : { address: linuxIp }, status: 'healthy',
      details: distroDetails(distro, runtime),
    },
    {
      id: 'dsh:layer', type: 'NETWORK_LAYER', role: 'main', label: 'WSL Network', subtitle: networkLayerLabel(runtime),
      status: 'healthy', evidence: [evidence('WSL_CONFIG', 'verified', `mode=${runtime.networkLayer.mode}`)],
    },
    {
      id: 'dsh:host', type: 'HOST', role: 'main', label: 'Windows Host', subtitle: 'WSL 可达',
      ...hostAddress === undefined ? {} : { address: hostAddress },
      status: endpointHealthy || endpointFailed ? 'healthy' : 'unknown',
      evidence: [evidence('WSL_ROUTE', 'verified', hostRouteEvidence(distro))],
    },
    {
      id: 'dsh:proxy', type: 'PROXY', role: 'main', label: `Proxy :${config.port ?? '?'}`,
      subtitle: effectiveEndpoint?.listener?.state === 'LISTENING'
        ? `${effectiveEndpoint.listener.processName ?? '监听进程'}${effectiveEndpoint.listener.pid === undefined ? '' : ` · PID ${effectiveEndpoint.listener.pid}`}`
        : effectiveEndpoint?.listener?.state === 'NOT_FOUND' ? '未找到监听进程' : '监听状态未知',
      ...config.host === undefined ? {} : { address: config.host },
      ...config.port === undefined ? {} : { port: config.port },
      status: endpointFailed ? 'error' : endpointHealthy ? 'healthy' : 'unknown',
      details: proxyDetails(config, effectiveEndpoint, endpointState, probe),
      evidence: [...config.evidence, ...effectiveEndpoint?.evidence ?? [], ...probeEvidenceList(probe)],
    },
    {
      id: 'dsh:adapter', type: 'INTERFACE', role: 'main', label: interfaceLabel(adapter),
      subtitle: adapter === undefined ? '未识别活动接口' : `${adapter.name} · ${adapter.kind}`,
      ...adapterIp === undefined ? {} : { address: adapterIp },
      status: endpointFailed ? 'not-applicable' : http === 'healthy' || gatewayReachable ? 'healthy' : 'unknown',
    },
    ...uplinkNode(egress, endpointFailed ? 'not-applicable' : http === 'healthy' || gatewayReachable ? 'healthy' : 'unknown') === undefined ? [] : [uplinkNode(egress, endpointFailed ? 'not-applicable' : http === 'healthy' || gatewayReachable ? 'healthy' : 'unknown')!],
    { id: 'dsh:gateway', type: 'GATEWAY', role: 'main', label: 'Gateway', ...gateway === undefined ? {} : { address: gateway }, status: endpointFailed ? 'not-applicable' : gatewayReachable ? 'healthy' : 'unknown', subtitle: gatewayReachable ? gatewaySubtitle(inspection, gatewayMeasured) : '网关未响应探测 · 可能禁 ping' },
    { id: 'dsh:internet', type: 'INTERNET', role: 'main', label: 'Internet', status: endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown' },
    {
      id: 'dsh:target', type: 'TARGET', role: 'main', label: target.display, subtitle: target.label,
      ...target.port === undefined ? {} : { port: target.port },
      status: endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : http === 'error' || tls === 'error' ? 'error' : 'unknown',
      details: probeDetails(probe, target.display),
    },
  ]

  const proxyEdgeStatus: PathStatus = endpointFailed ? 'error' : endpointHealthy ? 'healthy' : 'unknown'
  const downstream: PathStatus = endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : 'unknown'
  const targetStatus: PathStatus = endpointFailed ? 'not-applicable' : http === 'healthy' ? 'healthy' : http === 'error' || tls === 'error' ? 'error' : 'unknown'

  const edges: PathEdge[] = [
    { from: 'dsh:process', to: 'dsh:distro', relation: 'DIRECT', status: 'healthy', label: 'WSL 用户空间' },
    { from: 'dsh:distro', to: 'dsh:layer', relation: relationFor(runtime), status: 'healthy', label: networkLayerLabel(runtime) },
    { from: 'dsh:layer', to: 'dsh:host', relation: relationFor(runtime) === 'MIRRORED' ? 'MIRRORED' : 'ROUTE', status: 'healthy', label: hostEdgeLabel(runtime, distro) },
    { from: 'dsh:host', to: 'dsh:proxy', relation: 'PROXY', status: proxyEdgeStatus, label: `${config.source} · ${config.displayValue}`, evidence: [...config.evidence, ...probeEvidenceList(probe)] },
    { from: 'dsh:proxy', to: 'dsh:adapter', relation: 'ROUTE', status: downstream, label: '代理进程出站（Windows 路由推断）' },
    ...(egress.uplink === undefined ? [] : [{ from: 'dsh:adapter', to: 'dsh:uplink', relation: 'ROUTE' as const, status: endpointFailed ? ('not-applicable' as const) : http === 'healthy' || gatewayReachable ? ('healthy' as const) : ('unknown' as const), label: egress.adapter?.kind === 'vpn' ? 'TUN/VPN 出站' : 'Windows 路由' }]),
    { from: egress.uplink === undefined ? 'dsh:adapter' : 'dsh:uplink', to: 'dsh:gateway', relation: 'ROUTE', status: endpointFailed ? 'not-applicable' : gatewayReachable ? 'healthy' : 'unknown', label: gatewayReachable ? gatewayEdgeLabel(inspection, gatewayMeasured) : '下一跳' },
    { from: 'dsh:gateway', to: 'dsh:internet', relation: 'ROUTE', status: endpointFailed ? 'not-applicable' : http === 'healthy' || gatewayReachable ? 'healthy' : 'unknown', label: '默认路由' },
    {
      from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION', status: targetStatus,
      label: http === 'healthy' ? '经代理 TLS/HTTP 实测' : http === 'error' ? failureLayerLabel(probe) : '未探测',
      evidence: [probeEvidence(probe, 'http')],
    },
  ]

  const firstFailure = edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  return {
    path: {
      id: 'dsh',
      label: `链路 / ${runtime.registeredName ?? runtime.displayName}`,
      status: endpointFailed ? 'error' : pathStatusOfProbe(probe),
      egress: { mode: 'PROXY', proxyConfiguration: config, ...effectiveEndpoint === undefined ? {} : { proxyEndpoint: effectiveEndpoint } },
      nodes,
      edges,
      dns: [dnsBranchFromProbe(probe, target, 'dsh:dns', true)],
      ...firstFailure === undefined ? {} : { firstFailingEdgeId: `${firstFailure.from}->${firstFailure.to}` },
      ...probe === undefined ? {} : { probe },
    },
    proxyNodeId: nodes.find(node => node.type === 'PROXY')?.id,
  }
}

/**
 * WSL Network / Windows Host segment status. A healthy end-to-end direct
 * probe proves the segment works even when the dedicated host TCP probe
 * timed out (dropped SYN behind a firewall/VPN). Extracted for unit tests.
 */
export function hostSegmentStatus(hostTcp: PathStatus, targetReached: boolean): PathStatus {
  if (hostTcp === 'healthy' || targetReached) return 'healthy'
  if (hostTcp === 'error') return 'error'
  if (hostTcp === 'warning') return 'warning'
  return 'unknown'
}

function positiveNeighborState(state: string | undefined): boolean {
  return state === 'Reachable' || state === 'Stale' || state === 'Permanent' || state === 'Probe' || state === 'Delay'
}

/** ICMP/neighbor evidence is only claimed for the gateway it was measured against. */
function gatewayEvidenceOf(network: GraphSurvey['inspection']['windows']['network'], targetReached: boolean, measured: boolean): boolean {
  if (measured && network.gatewayPing === true) return true
  if (measured && positiveNeighborState(network.gatewayNeighborState)) return true
  return targetReached
}

function gatewaySubtitle(inspection: GraphSurvey['inspection'], measured: boolean): string {
  const network = inspection.windows.network
  if (measured && network.gatewayPing === true) return '网关 ICMP 可达'
  if (measured && positiveNeighborState(network.gatewayNeighborState)) return `网关邻居 ${network.gatewayNeighborState} · 端到端可达`
  return '端到端探测通过默认网关'
}

function gatewayEdgeLabel(inspection: GraphSurvey['inspection'], measured: boolean): string {
  const network = inspection.windows.network
  if (measured && network.gatewayPing === true) return '网关 ICMP 可达'
  if (measured && positiveNeighborState(network.gatewayNeighborState)) return `网关 ${network.gatewayNeighborState}`
  return '端到端可达'
}

function relationFor(runtime: WslDistributionRuntime): PathEdgeRelation {
  switch (runtime.networkLayer.mode) {
    case 'MIRRORED': return 'MIRRORED'
    case 'BRIDGED': return 'HOST_BRIDGE'
    case 'VIRTIOPROXY': return 'VIRTIOPROXY'
    case 'NONE': return 'ROUTE'
    case 'WSL1': return 'WSL1'
    default: return 'NAT'
  }
}

function networkLayerLabel(runtime: WslDistributionRuntime): string {
  const mode = runtime.networkLayer.mode
  if (mode === 'WSL1') return 'WSL 1'
  if (mode === 'NAT') return 'WSL 2 · NAT'
  if (mode === 'MIRRORED') return 'WSL 2 · Mirrored'
  if (mode === 'BRIDGED') return 'WSL 2 · Bridged'
  if (mode === 'NONE') return 'WSL 2 · None'
  if (mode === 'VIRTIOPROXY') return 'WSL 2 · VirtioProxy'
  return 'WSL Network'
}

function hostAddressOf(distro: WslDistribution | undefined): string | undefined {
  const candidates = distro?.network?.hostCandidates ?? []
  return candidates.find(candidate => candidate.source === 'default-route')?.address ?? candidates[0]?.address
}

function hostRouteEvidence(distro: WslDistribution | undefined): string {
  const candidates = distro?.network?.hostCandidates ?? []
  return candidates.length === 0 ? 'no host candidate' : `${candidates[0]!.source} ${candidates[0]!.address}`
}

function hostEdgeLabel(runtime: WslDistributionRuntime, distro: WslDistribution | undefined): string {
  const address = hostAddressOf(distro)
  return runtime.networkLayer.mode === 'MIRRORED' ? 'mirrored · localhost' : address === undefined ? 'WSL → Windows Host' : `→ ${address}`
}

function directWslProbeFor(target: GraphSurvey['target'], distro: WslDistribution | undefined, probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  if (distro === undefined) return undefined
  return probes.find(probe => probe.target.id === `wsl:${distro.name}:direct:${target.id}` && probe.path === 'direct')
    ?? probes.find(probe => probe.target.id.startsWith(`wsl:${distro.name}:direct:`) && probe.target.host === target.host && probe.path === 'direct')
}

function wslDnsProbeFor(target: GraphSurvey['target'], distro: WslDistribution | undefined, probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  if (distro === undefined) return undefined
  return probes.find(probe => probe.target.id === `wsl:${distro.name}:dns:${target.id}` && probe.path === 'direct')
}

function windowsHostProbeFor(distro: WslDistribution | undefined, probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  if (distro === undefined) return undefined
  return probes.find(probe => probe.target.kind === 'windows-host' && probe.target.id.startsWith(`wsl:${distro.name}:host:`))
}

function wslProxyProbeFor(config: ProxyConfiguration, distro: WslDistribution | undefined, probes: readonly LayeredProbe[]): LayeredProbe | undefined {
  if (distro === undefined) return undefined
  return probes.find(probe => probe.target.kind === 'wsl-proxy' && probe.target.id.startsWith(`wsl:${distro.name}:proxy`))
    ?? probes.find(probe => {
      const details = probe.layers.tcp?.details as { host?: unknown; port?: unknown } | undefined
      return details?.host === config.host && details?.port === config.port
    })
}

function distroDetails(distro: WslDistribution | undefined, runtime: WslDistributionRuntime): Array<{ label: string; value: string }> {
  return [
    { label: '注册名', value: distro?.name ?? runtime.registeredName ?? 'UNKNOWN' },
    { label: '显示名', value: runtime.displayName },
    { label: 'WSL version', value: String(runtime.wslVersion ?? 'UNKNOWN') },
    { label: 'Network mode', value: runtime.networkLayer.mode },
  ]
}

function proxyDetails(config: ProxyConfiguration, endpoint: ProxyEndpoint | undefined, state: ProxyEndpoint['state'], probe: LayeredProbe | undefined) {
  return [
    { label: '配置来源', value: config.source, evidence: config.evidence },
    { label: '配置地址', value: config.displayValue, evidence: config.evidence },
    { label: '监听状态', value: endpoint?.listener === undefined ? '未知' : endpoint.listener.state === 'LISTENING' ? '正常' : '未找到' },
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

function probeEvidence(probe: LayeredProbe | undefined, layer: 'dns' | 'tcp' | 'tls' | 'http') {
  const check = probe?.layers[layer]
  if (check === undefined) return evidence('HTTP_PROBE', 'inferred', '未探测')
  return {
    source: layer === 'dns' ? 'DNS_PROBE' as const : layer === 'tcp' ? 'TCP_PROBE' as const : layer === 'tls' ? 'TLS_PROBE' as const : 'HTTP_PROBE' as const,
    confidence: (check.status === 'healthy' ? 'verified' : 'inferred') as 'verified' | 'inferred',
    value: check.humanMessage,
    ref: `${probe?.target.id ?? 'probe'}:${layer}`,
  }
}

function probeEvidenceList(probe: LayeredProbe | undefined) {
  return (['tcp', 'http'] as const).map(layer => probeEvidence(probe, layer))
}

function failureLayerLabel(probe: LayeredProbe | undefined): string {
  if (probe?.layers.http?.status === 'error') return `HTTP 失败 · ${probe.layers.http.humanMessage}`
  if (probe?.layers.tls?.status === 'error') return `TLS 失败 · ${probe.layers.tls.humanMessage}`
  if (probe?.layers.tcp?.status === 'error') return `TCP 失败 · ${probe.layers.tcp.humanMessage}`
  return '连接失败'
}

function statusText(status: PathStatus): string {
  return status === 'healthy' ? '正常' : status === 'error' ? '失败' : status === 'warning' ? '警告' : status === 'not-applicable' ? '不适用' : '未知'
}
