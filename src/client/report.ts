/** Build a compact, agent-friendly Markdown diagnostic report. */
import type { DiagnosisReport, NetworkInspection, NetworkPathGraph, NetworkPathSummary } from './contract.ts'
import type { NetworkLocaleKey } from './locales.ts'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

function statusText(status: string): string {
  return status
}

export function buildDiagnosticReport(inspection: NetworkInspection, report: DiagnosisReport, t: T, graph?: NetworkPathGraph, summary?: NetworkPathSummary): string {
  const lines: string[] = []
  lines.push(`# ${t('reportTitle')}`)
  lines.push('')
  lines.push(`- ${t('reportGeneratedAt')}: ${inspection.timestamp}`)
  lines.push(`- ${t('reportStatus')}: ${statusText(report.worst)}`)
  lines.push(`- ${t('reportProblems')}: ${report.problemCount}`)
  lines.push('')

  if (summary !== undefined) {
    lines.push(`## ${t('networkGraphTitle')}`)
    lines.push(`- ${t('currentTarget')}: ${summary.target.label} · ${summary.target.display}`)
    lines.push(`- DSH: ${summary.dsh.label} · ${summary.dsh.status}`)
    if (graph !== undefined) {
      lines.push('- path:')
      for (const node of graph.dshPath.nodes.filter(node => node.role === 'main')) {
        lines.push(`  - ${node.status} ${node.type} ${node.label}${node.address === undefined ? '' : ` ${node.address}${node.port === undefined ? '' : `:${node.port}`}`}`)
      }
      if (graph.dshPath.firstFailingEdgeId !== undefined) lines.push(`- first failure: ${graph.dshPath.firstFailingEdgeId}`)
      if (graph.diagnostics.length > 0) {
        lines.push('- drift diagnostics:')
        for (const item of graph.diagnostics) lines.push(`  - ${item.code} ${item.severity}: ${item.humanMessage}`)
      }
      if (graph.recommendedRepair !== undefined) lines.push(`- recommended repair: ${graph.recommendedRepair.label}`)
    }
    lines.push('')
  }

  lines.push(`## ${t('reportDiagnosis')}`)
  if (report.diagnoses.length === 0) {
    lines.push(t('noDiagnosis'))
  } else {
    for (const diagnosis of report.diagnoses) {
      lines.push(`### ${diagnosis.code}`)
      lines.push(`- ${diagnosis.humanMessage}`)
      lines.push(`- technical: ${diagnosis.technicalMessage}`)
      lines.push(`- severity: ${diagnosis.severity} · confidence: ${diagnosis.confidence} · scope: ${diagnosis.scope}`)
      if (diagnosis.evidence.length > 0) {
        lines.push('- evidence:')
        for (const entry of diagnosis.evidence) lines.push(`  - ${entry.ref}: ${entry.message} (${entry.status})`)
      }
      if (diagnosis.actions.length > 0) {
        lines.push('- actions:')
        for (const action of diagnosis.actions) lines.push(`  - ${action.code}: ${action.label}`)
      }
      lines.push('')
    }
  }

  lines.push(`## ${t('reportWindows')}`)
  const os = inspection.windows.os
  if (os !== undefined) lines.push(`- OS: ${os.caption} ${os.version} build ${os.build} ${os.architecture}`)
  lines.push(`- ${t('interfaces')}:`)
  for (const item of inspection.windows.network.interfaces) {
    lines.push(`  - ${item.name} (${item.kind}) ${item.description}: ${item.status}`)
    if (item.ipv4.length > 0) lines.push(`    IPv4: ${item.ipv4.join(', ')}`)
    if (item.ipv6.length > 0) lines.push(`    IPv6: ${item.ipv6.join(', ')}`)
    if (item.gateways.length > 0) lines.push(`    gateway: ${item.gateways.join(', ')}`)
    if (item.dns.length > 0) lines.push(`    dns: ${item.dns.join(', ')}`)
  }
  const routes = inspection.windows.network.defaultRoutes
  if (routes.length > 0) {
    lines.push('- default routes:')
    for (const route of routes) lines.push(`  - ${route.destination} via ${route.nextHop} (if ${route.interfaceIndex})`)
  }

  lines.push('')
  lines.push(`## ${t('reportProxy')}`)
  lines.push(`- WinINet: enabled=${String(inspection.windows.proxy.wininet.enabled)}${inspection.windows.proxy.wininet.proxyServer === undefined ? '' : ` proxy=${inspection.windows.proxy.wininet.proxyServer}`}`)
  for (const entry of inspection.windows.proxy.winhttp) {
    lines.push(`- WinHTTP ${entry.scope}: enabled=${String(entry.proxyEnabled)}${entry.proxy === undefined ? '' : ` proxy=${entry.proxy}`}`)
  }
  for (const [scope, snapshot] of Object.entries(inspection.windows.environment.scopes)) {
    const value = snapshot.HTTPS_PROXY ?? snapshot.https_proxy
    if (value !== undefined) lines.push(`- env ${scope}: HTTPS_PROXY=${value}`)
  }

  lines.push('')
  lines.push(`## ${t('reportWsl')}`)
  const wsl = inspection.wsl
  if (wsl === undefined || !wsl.available) {
    lines.push('- WSL: unavailable')
  } else {
    if (wsl.version !== undefined) lines.push(`- WSL version: ${wsl.version}`)
    if (wsl.globalConfig !== undefined) lines.push(`- global config: mode=${wsl.globalConfig.mode} autoProxy=${String(wsl.globalConfig.autoProxy)} dnsTunneling=${String(wsl.globalConfig.dnsTunneling)}`)
    for (const distro of wsl.distributions) {
      lines.push(`- ${distro.name}: ${distro.state}${distro.wslVersion === undefined ? '' : ` WSL${distro.wslVersion}`}${distro.osMetadata?.prettyName === undefined ? '' : ` ${distro.osMetadata.prettyName}`}`)
      const env = distro.network?.environment
      if (env?.HTTPS_PROXY !== undefined) lines.push(`  HTTPS_PROXY=${env.HTTPS_PROXY}`)
      if (distro.network?.defaultRoute !== undefined) lines.push(`  default route: ${distro.network.defaultRoute}`)
      const resolv = distro.network?.resolvConf ?? []
      if (resolv.length > 0) lines.push(`  resolv.conf: ${resolv.join(', ')}`)
      if (distro.network?.wslConf?.network?.generateResolvConf !== undefined) lines.push(`  /etc/wsl.conf [network] generateResolvConf=${String(distro.network.wslConf.network.generateResolvConf)}`)
      if (distro.network?.wslConf?.network?.generateHosts !== undefined) lines.push(`  /etc/wsl.conf [network] generateHosts=${String(distro.network.wslConf.network.generateHosts)}`)
      if (distro.network?.wslConf?.boot?.systemd !== undefined) lines.push(`  /etc/wsl.conf [boot] systemd=${String(distro.network.wslConf.boot.systemd)}`)
    }
  }

  lines.push('')
  lines.push(`## ${t('reportProbe')}`)
  for (const probe of inspection.probes) {
    const layers = Object.entries(probe.layers).map(([layer, check]) => `${layer}:${check?.status ?? '-'}`).join(' ')
    lines.push(`- ${probe.target.label} [${probe.path}] ${layers}`)
    for (const check of Object.values(probe.layers)) {
      if (check?.technicalMessage !== undefined) lines.push(`  - ${check.technicalMessage}`)
      const details = check?.details as { attemptCount?: unknown; successCount?: unknown; avgLatencyMs?: unknown; minLatencyMs?: unknown; maxLatencyMs?: unknown } | undefined
      if (details?.attemptCount !== undefined) {
        lines.push(`  - attempts: ${String(details.successCount ?? 0)}/${String(details.attemptCount)}${details.avgLatencyMs === undefined ? '' : ` avg=${String(details.avgLatencyMs)}ms`}${details.minLatencyMs === undefined ? '' : ` min=${String(details.minLatencyMs)}ms`}${details.maxLatencyMs === undefined ? '' : ` max=${String(details.maxLatencyMs)}ms`}`)
      }
    }
  }

  return lines.join('\n')
}
