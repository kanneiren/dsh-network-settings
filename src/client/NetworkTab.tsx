/** Network settings tab (mounted in Settings → Plugins → Network). */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  Button, DisclosureRow, IconCheckOutline16, IconGlobeOutline14, IconRefreshOutline16,
  IconWarningOutline16, Menu, StateDot, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  Diagnosis, DiagnosisReport, LayeredProbe, NetworkInspection, NetworkPathGraph,
  NetworkPathSummary, NetworkStatus, NetworkTarget, WslDistribution, WslInspection,
} from './contract.ts'
import { NetworkGraph } from './NetworkGraph.tsx'
import type { NetworkService } from './service.ts'
import type { NetworkLocaleKey } from './locales.ts'
import { buildDiagnosticReport } from './report.ts'
import { NetworkConfig } from './NetworkConfig.tsx'
import { RepairSection } from './RepairSection.tsx'
import css from './NetworkTab.module.css'
import graphCss from './NetworkGraph.module.css'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface NetworkTabProps {
  service: NetworkService
  t: T
}

interface StatusRow {
  key: string
  label: string
  status: NetworkStatus
  detail?: string
}

const dotState = (status: NetworkStatus): StateDotState | undefined => {
  if (status === 'healthy') return 'done'
  if (status === 'warning') return 'warning'
  if (status === 'error') return 'error'
  if (status === 'unknown') return 'ongoing'
  return undefined
}

function summarizeDiagnosis(diagnosis: DiagnosisReport | undefined, scope?: string): { status: NetworkStatus; count: number } {
  if (diagnosis === undefined) return { status: 'not-tested', count: 0 }
  const relevant = diagnosis.diagnoses.filter(item => scope === undefined || item.scope === scope)
  if (relevant.some(item => item.severity === 'error')) return { status: 'error', count: relevant.length }
  if (relevant.some(item => item.severity === 'warning')) return { status: 'warning', count: relevant.length }
  return { status: 'healthy', count: 0 }
}

interface RowGroup {
  key: string
  label: string
  rows: StatusRow[]
}

function rowGroupsFrom(inspection: NetworkInspection | undefined, diagnosis: DiagnosisReport | undefined, t: T): RowGroup[] {
  const environment: StatusRow[] = []
  const windows = summarizeDiagnosis(diagnosis, 'windows')
  const isMac = inspection?.macos !== undefined
  environment.push({
    key: isMac ? 'macos' : 'windows',
    label: isMac ? 'macOS' : t('windows'),
    status: inspection === undefined ? (diagnosis === undefined ? 'not-tested' : windows.status) : windows.status === 'healthy' ? 'healthy' : windows.status,
    detail: inspection === undefined ? undefined : isMac
      ? (inspection.macos?.os.version ?? '')
      : t('interfaceCount', { count: inspection.windows?.network.interfaces.length ?? 0 }),
  })

  const wsl = inspection?.wsl
  const wslDiagnosis = summarizeDiagnosis(diagnosis, 'wsl')
  environment.push({
    key: 'wsl',
    label: t('wsl'),
    status: wsl === undefined ? 'not-tested' : !wsl.available ? 'not-applicable' : wslDiagnosis.status,
    detail: wsl === undefined ? undefined : wsl.distributions.map(item => item.name).join('、'),
  })

  const proxy = summarizeDiagnosis(diagnosis, 'proxy')
  const proxyConfigured = inspection?.windows?.proxy.endpoints.some(item => item.configured) === true
  environment.push({
    key: 'proxy',
    label: t('proxy'),
    status: proxyConfigured ? proxy.status : 'not-tested',
    detail: inspection?.windows?.proxy.endpoints.find(item => item.configured)?.url,
  })

  const connectivity: StatusRow[] = []

  const dns = summarizeDiagnosis(diagnosis, 'dns')
  const dnsHealthy = inspection?.probes.some(probe => probe.layers.dns?.status === 'healthy') === true
  const dnsFailed = inspection?.probes.some(probe => probe.layers.dns?.status === 'error') === true
  connectivity.push({
    key: 'dns',
    label: t('dns'),
    status: dnsFailed ? 'error' : dnsHealthy ? 'healthy' : diagnosis === undefined ? 'not-tested' : dns.status,
  })

  const directHttp = inspection?.probes.filter(probe => probe.path === 'direct').map(probe => probe.layers.http).filter((check): check is NonNullable<typeof check> => check !== undefined) ?? []
  const proxyHttp = inspection?.probes.filter(probe => probe.path === 'proxy').map(probe => probe.layers.http).filter((check): check is NonNullable<typeof check> => check !== undefined) ?? []
  const directHealthy = directHttp.some(check => check.status === 'healthy')
  const directFailed = directHttp.some(check => check.status === 'error')
  const proxyHealthy = proxyHttp.some(check => check.status === 'healthy')
  const proxyFailed = proxyHttp.some(check => check.status === 'error')
  const directLabel = directHealthy ? statusLabel('healthy', t) : directFailed ? statusLabel('error', t) : statusLabel('not-tested', t)
  const proxyPathLabel = proxyHealthy ? statusLabel('healthy', t) : proxyFailed ? statusLabel('error', t) : statusLabel('not-tested', t)
  connectivity.push({
    key: 'internet',
    label: t('internet'),
    status: directHealthy || proxyHealthy ? 'healthy' : directFailed || proxyFailed ? 'error' : 'not-tested',
    detail: `${t('direct')}：${directLabel} · ${t('proxyPath')}：${proxyPathLabel}`,
  })

  const model = inspection?.modelServices ?? []
  const modelProbes = inspection?.probes.filter(probe => probe.target.kind === 'model-service') ?? []
  const modelHealthy = modelProbes.some(probe => probe.layers.http?.status === 'healthy')
  const modelFailed = modelProbes.some(probe => probe.layers.http?.status === 'error' || probe.layers.tls?.status === 'error')
  const activeModel = model.find(item => item.active) ?? model[0]
  connectivity.push({
    key: 'model',
    label: t('modelService'),
    status: modelHealthy ? 'healthy' : modelFailed ? 'error' : 'not-tested',
    detail: model.length === 0
      ? undefined
      : modelProbes.length > 0
        ? activeModel?.displayName
        : activeModel === undefined ? undefined : `${activeModel.displayName} · ${t('modelServiceNoEndpoint')}`,
  })

  return [
    { key: 'environment', label: t('environmentGroup'), rows: environment },
    { key: 'connectivity', label: t('connectivityGroup'), rows: connectivity },
  ]
}

function statusLabel(status: NetworkStatus, t: T): string {
  if (status === 'healthy') return t('healthyLabel')
  if (status === 'warning') return t('warningLabel')
  if (status === 'error') return t('errorLabel')
  if (status === 'not-applicable') return t('notApplicableLabel')
  if (status === 'unknown') return t('unknownLabel')
  return t('notTestedLabel')
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function truncate(text: string, limit = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

function firstFailedLayer(probe: LayeredProbe): { layer: 'dns' | 'tcp' | 'tls' | 'http'; message: string; status: NetworkStatus } | undefined {
  for (const layer of ['dns', 'tcp', 'tls', 'http'] as const) {
    const check = probe.layers[layer]
    if (check === undefined) continue
    if (check.status === 'error' || check.status === 'warning') {
      return { layer, message: truncate(check.technicalMessage ?? check.humanMessage), status: check.status }
    }
  }
  return undefined
}

function ProbeDetails({ probes, t }: { probes: LayeredProbe[]; t: T }): ReactNode {
  return (
    <div className={css.detailList}>
      {probes.map(probe => {
        const failed = firstFailedLayer(probe)
        if (failed === undefined) return (
          <div key={`${probe.target.id}:${probe.path}`} className={css.detailRow}>
            <span className={css.detailName}>{probe.target.label} · {probe.path}</span>
            <span className={css.detailMeta}>{t('probeAllHealthy')}</span>
          </div>
        )
        return (
          <div key={`${probe.target.id}:${probe.path}`} className={css.detailRow}>
            <span className={css.detailName}>{probe.target.label} · {probe.path}</span>
            <span className={css.detailMeta}>{failed.layer.toUpperCase()} {statusLabel(failed.status, t)} · {failed.message}</span>
          </div>
        )
      })}
    </div>
  )
}

function WindowsDetails({ inspection, t }: { inspection: NetworkInspection; t: T }): ReactNode {
  const windows = inspection.windows
  if (windows === undefined) return null
  return (
    <div className={css.detailList}>
      {windows.os === undefined ? null : <div className={css.detailRow}><span className={css.detailName}>Windows</span><span className={css.detailMeta}>{windows.os.caption} {windows.os.build}</span></div>}
      {windows.network.interfaces.map(item => (
        <div key={`${item.name}:${item.description}`} className={css.detailRow}>
          <span className={css.detailName}>{item.name} <span className={css.detailTag}>{item.kind}</span></span>
          <span className={css.detailMeta}>{statusLabel(item.status === 'up' ? 'healthy' : 'not-tested', t)} · {item.ipv4.join(', ') || 'IPv4 -'} {item.ipv6.length > 0 ? `· ${item.ipv6.join(', ')}` : ''}</span>
        </div>
      ))}
      <div className={css.detailRow}><span className={css.detailName}>WinINet</span><span className={css.detailMeta}>{windows.proxy.wininet.enabled ? windows.proxy.wininet.proxyServer ?? 'on' : 'off'}</span></div>
      {windows.proxy.winhttp.map((entry, index) => (
        <div key={`${entry.scope}:${index}`} className={css.detailRow}><span className={css.detailName}>WinHTTP {entry.scope}</span><span className={css.detailMeta}>{entry.proxyEnabled ? entry.proxy ?? 'on' : 'DIRECT'}</span></div>
      ))}
      {Object.entries(windows.environment.scopes).map(([scope, snapshot]) => {
        const value = snapshot.HTTPS_PROXY ?? snapshot.https_proxy
        return <div key={scope} className={css.detailRow}><span className={css.detailName}>{scope}</span><span className={css.detailMeta}>{value ?? '未设置'}</span></div>
      })}
    </div>
  )
}

function WslDetails({ wsl, t }: { wsl: WslInspection; t: T }): ReactNode {
  return (
    <div className={css.detailList}>
      {wsl.globalConfig === undefined ? null : <div className={css.detailRow}><span className={css.detailName}>{t('mode')}</span><span className={css.detailMeta}>{wsl.globalConfig.mode}{wsl.globalConfig.autoProxy === true ? ' · autoProxy' : ''}</span></div>}
      {wsl.distributions.map(distro => (
        <DistributionDetails key={distro.name} distro={distro} t={t} />
      ))}
    </div>
  )
}

function DistributionDetails({ distro, t }: { distro: WslDistribution; t: T }): ReactNode {
  const env = distro.network?.environment
  return (
    <div className={css.detailRow}>
      <span className={css.detailName}>{distro.name} <span className={css.detailTag}>{distro.state === 'running' ? t('stateRunning') : t('stateStopped')}</span></span>
      <span className={css.detailMeta}>
        {distro.osMetadata?.prettyName ?? `WSL ${String(distro.wslVersion ?? '?')}`}
        {env?.HTTPS_PROXY === undefined ? '' : ` · HTTPS_PROXY=${env.HTTPS_PROXY}`}
      </span>
    </div>
  )
}

function MacDetails({ inspection, t }: { inspection: NetworkInspection; t: T }): ReactNode {
  const mac = inspection.macos
  if (mac === undefined) return null
  return (
    <div className={css.detailList}>
      <div className={css.detailRow}><span className={css.detailName}>macOS</span><span className={css.detailMeta}>{mac.os.caption} {mac.os.version} build {mac.os.build}</span></div>
      {mac.network.interfaces.map(item => (
        <div key={item.device} className={css.detailRow}>
          <span className={css.detailName}>{item.name} <span className={css.detailTag}>{item.kind}</span></span>
          <span className={css.detailMeta}>{item.device}{mac.network.gatewayInterface === item.device ? ' · default route' : ''}</span>
        </div>
      ))}
      {mac.network.gateway !== undefined ? <div className={css.detailRow}><span className={css.detailName}>Gateway</span><span className={css.detailMeta}>{mac.network.gateway}</span></div> : null}
      <div className={css.detailRow}><span className={css.detailName}>scutil proxy</span><span className={css.detailMeta}>{mac.proxy.scutil.httpEnabled || mac.proxy.scutil.httpsEnabled ? `${mac.proxy.scutil.httpsHost ?? mac.proxy.scutil.httpHost}:${mac.proxy.scutil.httpsPort ?? mac.proxy.scutil.httpPort}` : 'off'}</span></div>
      {mac.dns.nameservers.length > 0 ? <div className={css.detailRow}><span className={css.detailName}>DNS</span><span className={css.detailMeta}>{mac.dns.nameservers.join(', ')}</span></div> : null}
      {(() => {
        const entries = Object.entries(mac.environment ?? {}).filter(([, v]) => v)
        if (entries.length === 0) return null
        return <div className={css.detailRow}><span className={css.detailName}>Shell env</span><span className={css.detailMeta}>{entries.map(([k, v]) => `${k}=${v}`).join(', ')}</span></div>
      })()}
    </div>
  )
}

function DiagnosisDetails({ diagnoses, t }: { diagnoses: Diagnosis[]; t: T }): ReactNode {
  if (diagnoses.length === 0) return <p className={css.muted}>{t('noDiagnosis')}</p>
  return (
    <div className={css.detailList}>
      {diagnoses.map(item => (
        <div key={item.code} className={css.diagnosisCard}>
          <div className={css.diagnosisHead}>
            <span className={css.detailName}>{item.humanMessage}</span>
            <span className={css.detailTag}>{item.code}</span>
            <span className={css.detailMeta}>{statusLabel(item.severity === 'error' ? 'error' : 'warning', t)}</span>
          </div>
          <div className={css.technical}>{item.technicalMessage}</div>
          {item.evidence.map(evidence => <div key={evidence.ref} className={css.technical}>· {evidence.message} ({evidence.status})</div>)}
        </div>
      ))}
    </div>
  )
}

export function NetworkTab({ service, t }: NetworkTabProps): ReactNode {
  const state = useSyncExternalStore(listener => service.subscribe(listener), () => service.getSnapshot())
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [targetMenuOpen, setTargetMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void service.refreshStatus()
  }, [service])

  const toggle = (key: string): void => {
    setOpen(previous => ({ ...previous, [key]: !(previous[key] === true) }))
  }

  const diagnosis = state.diagnosis
  const report: DiagnosisReport = diagnosis ?? { diagnoses: [], worst: 'healthy', problemCount: 0 }
  const phase = state.phase
  const graph = state.graph
  const summary = state.summary ?? state.cached?.summary
  const targets = state.targets ?? (summary === undefined ? [] : [summary.target])
  const [pickedTargetId, setPickedTargetId] = useState<string | undefined>(undefined)
  // Fresh sessions default to DeepSeek (the requested default target). Once a
  // graph is displayed, the selection follows the graph's own target unless
  // the user picked another one explicitly.
  const defaultPick = targets.find(target => target.id === 'deepseek')
  const effectiveTarget = pickedTargetId !== undefined
    ? targets.find(target => target.id === pickedTargetId)
    : graph !== undefined
      ? summary?.target
      : defaultPick ?? summary?.target ?? targets[0]
  const effectiveTargetId = effectiveTarget?.id

  const canCopy = state.inspection !== undefined || state.cached?.diagnosis !== undefined
  const onCopy = async (): Promise<void> => {
    // In the cached state there is no inspection yet, but a diagnosis-only
    // briefing is still valuable to paste to an agent.
    if (!canCopy) return
    const reportFor = state.diagnosis ?? state.cached?.diagnosis ?? report
    try {
      await writeClipboard(buildDiagnosticReport(state.inspection, reportFor, graph, summary))
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1500)
    } catch {
      setCopied(false)
    }
  }

  const run = (targetId?: string): void => {
    setTargetMenuOpen(false)
    void (targetId === undefined ? service.run() : service.runTarget(targetId))
  }

  const pickTarget = (id: string): void => {
    setPickedTargetId(id)
    run(id)
  }

  const targetBar = targets.length === 0 ? null : (
    <div className={graphCss.targetBar}>
      <span className={graphCss.targetLabel}>{t('currentTarget')}</span>
      <Menu
        open={targetMenuOpen}
        onClose={() => { setTargetMenuOpen(false) }}
        onSelect={pickTarget}
        selectedId={effectiveTarget?.id ?? 'deepseek'}
        items={targets.map(target => ({ id: target.id, label: `${target.label} · ${target.display}` }))}
        anchor={(
          <Button variant="outline" size="sm" onClick={() => { setTargetMenuOpen(previous => !previous) }}>
            {effectiveTarget === undefined ? t('currentTarget') : `${effectiveTarget.label} · ${effectiveTarget.display}`}
          </Button>
        )}
      />
    </div>
  )

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>

      {summary === undefined && state.phase !== 'loading' ? (
        <div className={css.summaryCard}>
          <div className={css.summaryHead}>
            {phase === 'error' ? <StateDot state="error" className={css.dot} /> : null}
            <span className={css.summaryText}>{phase === 'error' ? t('error') : t('notTested')}</span>
          </div>
          <p className={css.muted}>{t('standbyHint')}</p>
          {targetBar}
          <div className={css.actions}>
            <Button
              variant="primary"
              disabled={phase === 'loading'}
              icon={phase === 'loading' ? undefined : <IconRefreshOutline16 size={16} />}
              onClick={() => { run(effectiveTargetId) }}
            >
              {phase === 'loading' ? t('running') : t('run')}
            </Button>
            {phase === 'loading' ? <Button variant="ghost" onClick={() => { service.cancel() }}>{t('cancel')}</Button> : null}
          </div>
          {state.error === undefined ? null : <p className={css.errorText} role="alert">{state.error}</p>}
        </div>
      ) : null}

      {summary !== undefined && graph === undefined && state.phase !== 'loading' ? (
        <div className={css.summaryCard}>
          <div className={css.summaryHead}><span className={css.summaryText}>{t('networkGraphTitle')}</span><span className={css.muted}>{t('cached', { time: formatTime(state.cached?.timestamp ?? '') })}</span></div>
          <div className={css.statusRow}><StateDot state={dotState(summary.dsh.status) ?? 'ongoing'} className={css.dot} /><span className={css.rowLabel}>{t('linkLabel')}</span><span className={css.rowStatus}>{statusLabel(summary.dsh.status, t)}</span></div>
          {targetBar}
          <div className={css.actions}>
            <Button variant="primary" disabled={phase === 'loading'} onClick={() => { run(effectiveTargetId) }}>{t('run')}</Button>
            <Button variant="outline" disabled={phase === 'loading'} onClick={() => { void service.runStability(effectiveTargetId ?? summary.target.id) }}>{t('runStability')}</Button>
            {canCopy ? <Button variant="outline" onClick={() => { void onCopy() }}>{copied ? t('copied') : t('copyNetworkReport')}</Button> : null}
          </div>
        </div>
      ) : null}

      {phase === 'loading' ? (
        <div className={css.summaryCard}>
          <div className={css.summaryHead}><StateDot state="ongoing" className={css.dot} /><span className={css.summaryText}>{t('running')}</span></div>
          <div className={css.actions}><Button variant="ghost" onClick={() => { service.cancel() }}>{t('cancel')}</Button></div>
        </div>
      ) : null}

      {graph === undefined ? <NetworkConfig service={service} inspection={state.inspection} diagnosis={report} graph={undefined} t={t} /> : null}

      {graph !== undefined && summary !== undefined ? (
        <>
          {targetBar}
          <div className={css.actions}>
            <Button variant="primary" disabled={phase === 'loading'} onClick={() => { run(summary.target.id) }}>{t('run')}</Button>
            <Button variant="outline" disabled={phase === 'loading'} onClick={() => { void service.runStability(summary.target.id) }}>{t('runStability')}</Button>
            {canCopy ? <Button variant="outline" onClick={() => { void onCopy() }}>{copied ? t('copied') : t('copyNetworkReport')}</Button> : null}
          </div>
          <NetworkGraph graph={graph} summary={summary} t={t} />
          {state.inspection === undefined ? null : <NetworkConfig service={service} inspection={state.inspection} diagnosis={report} graph={graph} t={t} />}
          <div id="dsh-network-repair-section">
            {report.diagnoses.length === 0 ? null : <RepairSection service={service} diagnoses={report.diagnoses} inspection={state.inspection} t={t} />}
          </div>
        </>
      ) : null}

      {state.error !== undefined && summary !== undefined ? <p className={css.errorText} role="alert">{state.error}</p> : null}
      {state.cancelled === true ? <p className={css.muted}>{t('cancel')}</p> : null}

      {state.inspection === undefined ? null : (
        <div className={css.disclosureList}>
          <DisclosureRow
            icon={<IconWarningOutline16 size={16} />}
            title={t('diagnosisTitle')}
            open={open['diagnosis'] === true}
            expandable
            expandOnRowClick
            onToggle={() => { toggle('diagnosis') }}
          >
            <DiagnosisDetails diagnoses={report.diagnoses} t={t} />
          </DisclosureRow>
        </div>
      )}
    </div>
  )
}