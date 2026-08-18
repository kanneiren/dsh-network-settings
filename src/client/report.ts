/** Build a compact, agent-friendly Markdown diagnostic report.
 *  Report copy is intentionally locale-independent (fixed English section
 *  headers, stable field names) so agents and scripts can parse it
 *  deterministically regardless of the UI language. */
import type { DiagnosisReport, NetworkInspection, NetworkPathGraph, NetworkPathSummary, PathEdge, PathNode } from './contract.ts'

const REPORT_VERSION = 1
const MAX_LINE = 300

function truncate(text: string, limit = MAX_LINE): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

/** Non-empty proxy variables, both letter cases, canonical order. */
function envEntries(env: Record<string, string | undefined> | undefined): Array<[string, string]> {
  if (env === undefined) return []
  const entries: Array<[string, string]> = []
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') entries.push([name, value.trim()])
  }
  return entries
}

function envLines(label: string, env: Record<string, string | undefined> | undefined, out: string[]): void {
  const entries = envEntries(env)
  out.push(entries.length === 0 ? `- ${label}: (no proxy variables)` : `- ${label}: ${entries.map(([name, value]) => `${name}=${value}`).join(', ')}`)
}

function runtimeLine(inspection: NetworkInspection | undefined, graph: NetworkPathGraph | undefined): string {
  const os = inspection?.windows.os
  const osSuffix = os === undefined ? '' : ` · ${os.caption} build ${os.build}`
  const runtime = graph?.runtime
  if (runtime?.type === 'WSL_DISTRIBUTION') {
    return `WSL_DISTRIBUTION · ${runtime.registeredName ?? runtime.displayName}`
      + `${runtime.wslVersion === undefined ? '' : ` · WSL${runtime.wslVersion}`}`
      + ` · ${runtime.networkLayer.mode}${osSuffix}`
  }
  if (runtime?.type === 'WINDOWS_NATIVE') return `WINDOWS_NATIVE${osSuffix}`
  return `${inspection?.runtime.platform ?? 'unknown'}${osSuffix}`
}

/** `verified` when at least one evidence item is verified; `inferred` when a
 *  node carries evidence but none of it is verified. */
function evidenceMark(node: PathNode): string {
  if (node.evidence === undefined || node.evidence.length === 0) return ''
  return node.evidence.some(item => item.confidence === 'verified') ? '' : ' · inferred'
}

function firstFailureLine(graph: NetworkPathGraph | undefined): string {
  const id = graph?.dshPath.firstFailingEdgeId
  if (graph === undefined || id === undefined) return '- first-failure: —'
  const labels = new Map(graph.dshPath.nodes.map(node => [node.id, node]))
  const edge = graph.dshPath.edges.find(candidate => `${candidate.from}->${candidate.to}` === id)
  if (edge === undefined) return `- first-failure: ${id}`
  const from = labels.get(edge.from)?.label ?? edge.from
  const to = labels.get(edge.to)?.label ?? edge.to
  return `- first-failure: ${from} → ${to}${edge.label === undefined || edge.label === '' ? '' : ` · ${edge.label}`} (${edge.status})`
}

function recommendedLine(graph: NetworkPathGraph | undefined): string {
  const repair = graph?.recommendedRepair
  if (repair === undefined) return '- recommended: —'
  const confidence = graph?.diagnostics.find(item => item.code === repair.diagnosisCode)?.confidence
  return `- recommended: ${repair.label} [${repair.actionCodes.join(', ')}]${confidence === undefined ? '' : ` (confidence ${confidence})`}`
}

export function buildDiagnosticReport(
  inspection: NetworkInspection | undefined,
  report: DiagnosisReport,
  graph?: NetworkPathGraph,
  summary?: NetworkPathSummary,
): string {
  const lines: string[] = []
  lines.push('# DSH Network Diagnostic Report')
  lines.push('')
  lines.push(`- report-version: ${REPORT_VERSION}`)
  lines.push(`- generated: ${inspection?.timestamp ?? 'unknown'}`)
  lines.push(`- overall: ${report.worst} · problems: ${report.problemCount}`)
  lines.push('')

  lines.push('## TL;DR')
  lines.push(`- runtime: ${runtimeLine(inspection, graph)}`)
  lines.push(summary === undefined
    ? '- dsh-path: unknown'
    : `- dsh-path: ${summary.dsh.status} · target: ${summary.target.label} · ${summary.target.display}`)
  lines.push(firstFailureLine(graph))
  lines.push(recommendedLine(graph))
  const top = report.diagnoses.slice(0, 3)
  lines.push(top.length === 0
    ? '- diagnoses: none'
    : `- diagnoses: ${top.map(item => `${item.code} (${item.severity} ${item.confidence})`).join(', ')}`)
  lines.push('')

  if (graph !== undefined) {
    lines.push('## DSH Path')
    const egress = graph.dshPath.egress
    lines.push(egress.mode === 'PROXY'
      ? `- egress: PROXY · ${egress.proxyConfiguration?.source ?? 'unknown'} · ${egress.proxyConfiguration?.displayValue ?? ''}`
      : '- egress: DIRECT')
    lines.push('- nodes:')
    for (const node of graph.dshPath.nodes.filter(node => node.role === 'main')) {
      lines.push(`  - ${node.status} ${node.type} ${node.label}${node.address === undefined ? '' : ` ${node.address}${node.port === undefined ? '' : `:${node.port}`}`}${evidenceMark(node)}`)
    }
    lines.push('- edges:')
    const labels = new Map(graph.dshPath.nodes.map(node => [node.id, node.label]))
    for (const edge of graph.dshPath.edges) {
      lines.push(edgeLine(edge, labels))
    }
    for (const dns of graph.dshPath.dns) {
      const addresses = dns.resolvedAddresses.length > 0 ? ` → ${dns.resolvedAddresses.join(', ')}` : ''
      lines.push(`- dns: ${dns.host}${addresses} · ${dns.resolution} · ${dns.status}`)
    }
    lines.push(firstFailureLine(graph))
    if (graph.diagnostics.length > 0) {
      lines.push('- drift diagnostics:')
      for (const item of graph.diagnostics) lines.push(`  - ${item.code} ${item.severity}: ${truncate(item.humanMessage)}`)
    }
    lines.push(recommendedLine(graph))
    lines.push('')
  }

  lines.push('## Diagnoses')
  if (report.diagnoses.length === 0) {
    lines.push('- none')
  } else {
    for (const diagnosis of report.diagnoses) {
      lines.push(`### ${diagnosis.code}`)
      lines.push(`- message: ${truncate(diagnosis.humanMessage)}`)
      lines.push(`- technical: ${truncate(diagnosis.technicalMessage)}`)
      lines.push(`- severity: ${diagnosis.severity} · confidence: ${diagnosis.confidence} · scope: ${diagnosis.scope}`)
      if (diagnosis.evidence.length > 0) {
        lines.push('- evidence:')
        for (const entry of diagnosis.evidence) lines.push(`  - ${entry.ref}: ${truncate(entry.message)} (${entry.status})`)
      }
      if (diagnosis.actions.length > 0) {
        lines.push('- actions:')
        for (const action of diagnosis.actions) lines.push(`  - ${action.code}: ${action.label}`)
      }
      lines.push('')
    }
  }

  if (inspection !== undefined) {
    lines.push('## Windows')
    const os = inspection.windows.os
    if (os !== undefined) lines.push(`- OS: ${os.caption} ${os.version} build ${os.build} ${os.architecture}`)
    const up = inspection.windows.network.interfaces.filter(item => item.status === 'up')
    const down = inspection.windows.network.interfaces.filter(item => item.status !== 'up')
    if (up.length > 0) {
      lines.push('- adapters up:')
      for (const item of up) {
        lines.push(`  - ${item.name} (${item.kind}) ${item.description}`)
        if (item.ipv4.length > 0) lines.push(`    IPv4: ${item.ipv4.join(', ')}`)
        if (item.ipv6.length > 0) lines.push(`    IPv6: ${item.ipv6.join(', ')}`)
        if (item.gateways.length > 0) lines.push(`    gateway: ${item.gateways.join(', ')}`)
        if (item.dns.length > 0) lines.push(`    dns: ${item.dns.join(', ')}`)
      }
    }
    if (down.length > 0) {
      lines.push(`- adapters down (${down.length}): ${down.map(item => `${item.name} (${item.kind})`).join(', ')}`)
    }
    const routes = inspection.windows.network.defaultRoutes
    if (routes.length > 0) {
      lines.push('- default routes:')
      for (const route of routes) lines.push(`  - ${route.destination} via ${route.nextHop} (if ${route.interfaceIndex}${route.metric === undefined ? '' : `, metric ${route.metric}`})`)
    }
    lines.push('')

    lines.push('## Proxy')
    const wininet = inspection.windows.proxy.wininet
    lines.push(`- WinINet: enabled=${String(wininet.enabled)}${wininet.proxyServer === undefined ? '' : ` proxy=${wininet.proxyServer}`}${wininet.autoDetect ? ' autoDetect=true' : ''}${wininet.autoConfigUrl === undefined ? '' : ` pac=${wininet.autoConfigUrl}`}`)
    for (const entry of inspection.windows.proxy.winhttp) {
      lines.push(`- WinHTTP ${entry.scope}: enabled=${String(entry.proxyEnabled)}${entry.proxy === undefined ? '' : ` proxy=${entry.proxy}`}`)
    }
    const endpoints = inspection.windows.proxy.endpoints
    if (endpoints.length > 0) {
      lines.push('- endpoints:')
      for (const endpoint of endpoints) {
        const listener = endpoint.listener === undefined
          ? 'listener: unknown'
          : endpoint.listener.state === 'LISTENING'
            ? `listener: ${endpoint.listener.processName ?? 'pid'}${endpoint.listener.pid === undefined ? '' : ` PID ${endpoint.listener.pid}`}`
            : 'listener: NOT_FOUND'
        lines.push(`  - ${endpoint.source} ${endpoint.host}:${endpoint.port} · ${endpoint.configured ? 'configured' : 'detected'} · ${listener}${endpoint.state === 'CONFIGURED' ? '' : ` · ${endpoint.state}`}`)
      }
    }
    const scopes = inspection.windows.environment.scopes
    envLines('env user', scopes.user, lines)
    envLines('env machine', scopes.machine, lines)
    envLines('env process', scopes.process, lines)
    envLines('DSH process', inspection.windows.dshProcessEnvironment, lines)

    const wsl = inspection.wsl
    if (wsl === undefined || !wsl.available) {
      lines.push('')
      lines.push('## WSL')
      lines.push('- unavailable')
    } else {
      lines.push('')
      lines.push('## WSL')
      if (wsl.version !== undefined) lines.push(`- WSL version: ${wsl.version}`)
      if (wsl.globalConfig !== undefined) lines.push(`- global config: mode=${wsl.globalConfig.mode} autoProxy=${String(wsl.globalConfig.autoProxy)} dnsTunneling=${String(wsl.globalConfig.dnsTunneling)}`)
      for (const distro of wsl.distributions) {
        lines.push(`- ${distro.name}: ${distro.state}${distro.wslVersion === undefined ? '' : ` WSL${distro.wslVersion}`}${distro.osMetadata?.prettyName === undefined ? '' : ` ${distro.osMetadata.prettyName}`}`)
        const network = distro.network
        if (network === undefined) continue
        envLines('  env', network.environment, lines)
        if (network.defaultRoute !== undefined) lines.push(`  default route: ${network.defaultRoute}`)
        if (network.resolvConf !== undefined && network.resolvConf.length > 0) lines.push(`  resolv.conf: ${network.resolvConf.join(', ')}`)
        if (network.hostCandidates.length > 0) lines.push(`  host candidates: ${network.hostCandidates.map(candidate => `${candidate.address} (${candidate.source})`).join(', ')}`)
        const conf = network.wslConf
        if (conf?.network?.generateResolvConf !== undefined) lines.push(`  /etc/wsl.conf [network] generateResolvConf=${String(conf.network.generateResolvConf)}`)
        if (conf?.network?.generateHosts !== undefined) lines.push(`  /etc/wsl.conf [network] generateHosts=${String(conf.network.generateHosts)}`)
        if (conf?.boot?.systemd !== undefined) lines.push(`  /etc/wsl.conf [boot] systemd=${String(conf.boot.systemd)}`)
      }
    }

    lines.push('')
    lines.push('## Probes')
    for (const probe of inspection.probes) {
      lines.push(`- ${probe.target.id} [${probe.path}] ${probe.target.label}`)
      const layers = Object.entries(probe.layers)
        .map(([layer, check]) => check?.latencyMs === undefined ? `${layer}:${check?.status ?? '-'}` : `${layer}:${check?.status}(${check.latencyMs}ms)`)
        .join(' ')
      lines.push(`  - layers: ${layers}`)
      for (const [layer, check] of Object.entries(probe.layers)) {
        if (check === undefined || (check.status !== 'error' && check.status !== 'warning' && check.status !== 'not-tested')) continue
        lines.push(`  - ${layer}: ${truncate(check.technicalMessage ?? check.humanMessage)}`)
      }
      const details = Object.values(probe.layers)[0]?.details as { attemptCount?: unknown; successCount?: unknown; avgLatencyMs?: unknown; minLatencyMs?: unknown; maxLatencyMs?: unknown } | undefined
      if (details?.attemptCount !== undefined) {
        lines.push(`  - attempts: ${String(details.successCount ?? 0)}/${String(details.attemptCount)}${details.avgLatencyMs === undefined ? '' : ` avg=${String(details.avgLatencyMs)}ms`}${details.minLatencyMs === undefined ? '' : ` min=${String(details.minLatencyMs)}ms`}${details.maxLatencyMs === undefined ? '' : ` max=${String(details.maxLatencyMs)}ms`}`)
      }
    }
  }

  return lines.join('\n')
}

function edgeLine(edge: PathEdge, labels: Map<string, string>): string {
  const from = labels.get(edge.from) ?? edge.from
  const to = labels.get(edge.to) ?? edge.to
  return `  - ${edge.status} ${edge.relation} ${from} → ${to}${edge.label === undefined || edge.label === '' ? '' : ` · ${edge.label}`}`
}
