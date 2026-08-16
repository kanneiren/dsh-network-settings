/** Network settings tab (mounted in Settings → Plugins → Network). */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  Button, DisclosureRow, IconCheckOutline16, IconGlobeOutline14, IconRefreshOutline16,
  IconWarningOutline16, StateDot, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  Diagnosis, DiagnosisReport, LayeredProbe, NetworkInspection, NetworkStatus, WslDistribution, WslInspection,
} from './contract.ts'
import type { NetworkService } from './service.ts'
import type { NetworkLocaleKey } from './locales.ts'
import { buildDiagnosticReport } from './report.ts'
import { ConfigureSection } from './ConfigureSection.tsx'
import { RepairSection } from './RepairSection.tsx'
import css from './NetworkTab.module.css'

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
  environment.push({
    key: 'windows',
    label: t('windows'),
    status: inspection === undefined ? (diagnosis === undefined ? 'not-tested' : windows.status) : windows.status === 'healthy' ? 'healthy' : windows.status,
    detail: inspection === undefined ? undefined : t('interfaceCount', { count: inspection.windows.network.interfaces.length }),
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
  const proxyConfigured = inspection?.windows.proxy.endpoints.some(item => item.configured) === true
  environment.push({
    key: 'proxy',
    label: t('proxy'),
    status: proxyConfigured ? proxy.status : 'not-tested',
    detail: inspection?.windows.proxy.endpoints.find(item => item.configured)?.url,
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

  const model = inspection?.windows.modelServices ?? []
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

function ProbeDetails({ probes, t }: { probes: LayeredProbe[]; t: T }): ReactNode {
  return (
    <div className={css.detailList}>
      {probes.map(probe => (
        <div key={`${probe.target.id}:${probe.path}`} className={css.detailRow}>
          <span className={css.detailName}>{probe.target.label} · {probe.path}</span>
          <span className={css.detailMeta}>
            {(['dns', 'tcp', 'tls', 'http'] as const).map(layer => {
              const check = probe.layers[layer]
              if (check === undefined) return null
              return <span key={layer} className={css.layer}>{layer.toUpperCase()} {statusLabel(check.status, t)}{check.technicalMessage === undefined ? '' : ` · ${check.technicalMessage}`}</span>
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

function WindowsDetails({ inspection, t }: { inspection: NetworkInspection; t: T }): ReactNode {
  const { windows } = inspection
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

function DiagnosisDetails({ diagnoses, t }: { diagnoses: Diagnosis[]; t: T }): ReactNode {
  if (diagnoses.length === 0) return <p className={css.muted}>{t('noDiagnosis')}</p>
  return (
    <div className={css.detailList}>
      {diagnoses.map(item => (
        <div key={item.code} className={css.diagnosisCard}>
          <div className={css.detailRow}><span className={css.detailName}>{item.humanMessage}</span><span className={css.detailMeta}>{statusLabel(item.severity === 'error' ? 'error' : 'warning', t)}</span></div>
          <div className={css.technical}>Diagnostic Code: {item.code}</div>
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
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void service.refreshStatus()
  }, [service])

  const toggle = (key: string): void => {
    setOpen(previous => ({ ...previous, [key]: !(previous[key] === true) }))
  }

  const diagnosis = state.diagnosis
  const report: DiagnosisReport = diagnosis ?? { diagnoses: [], worst: 'healthy', problemCount: 0 }
  const overall: NetworkStatus = state.phase === 'loading'
    ? 'unknown'
    : state.inspection === undefined
      ? 'not-tested'
      : report.worst === 'error'
        ? 'error'
        : report.worst === 'warning'
          ? 'warning'
          : 'healthy'

  const summary = overall === 'not-tested'
    ? t('notTested')
    : overall === 'healthy'
      ? t('healthy')
      : overall === 'error'
        ? t('error')
        : t('warning', { count: report.problemCount })

  const onCopy = async (): Promise<void> => {
    if (state.inspection === undefined) return
    try {
      await writeClipboard(buildDiagnosticReport(state.inspection, report, t))
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>

      <div className={css.summaryCard}>
        <div className={css.summaryHead}>
          {dotState(overall) === undefined ? null : <StateDot state={dotState(overall)!} className={css.dot} />}
          <span className={css.summaryText}>{summary}</span>
        </div>
        {rowGroupsFrom(state.inspection, report, t).map(group => (
          <div key={group.key} className={css.rowGroup}>
            <div className={css.groupLabel}>{group.label}</div>
            {group.rows.map(row => (
              <div key={row.key} className={css.statusRow}>
                {dotState(row.status) === undefined ? null : <StateDot state={dotState(row.status)!} className={css.dot} />}
                <div className={css.rowBody}>
                  <span className={css.rowLabel}>{row.label}</span>
                  {row.detail === undefined ? null : <span className={css.rowDetail}>{row.detail}</span>}
                </div>
                <span className={css.rowStatus}>{statusLabel(row.status, t)}</span>
              </div>
            ))}
          </div>
        ))}

        <div className={css.actions}>
          <Button
            variant="primary"
            disabled={state.phase === 'loading'}
            icon={state.phase === 'loading' ? undefined : <IconRefreshOutline16 size={16} />}
            onClick={() => { void service.run() }}
          >
            {state.phase === 'loading' ? t('running') : t('run')}
          </Button>
          {state.phase === 'loading' ? <Button variant="ghost" onClick={() => { service.cancel() }}>{t('cancel')}</Button> : null}
          {state.inspection === undefined ? null : <Button variant="outline" onClick={() => { void onCopy() }}>{copied ? t('copied') : t('copyReport')}</Button>}
        </div>
        {state.error === undefined ? null : <p className={css.errorText} role="alert">{state.error}</p>}
        {state.cancelled === true ? <p className={css.muted}>{t('cancel')}</p> : null}
      </div>

      {report.diagnoses.length === 0 ? null : <RepairSection service={service} diagnoses={report.diagnoses} inspection={state.inspection} t={t} />}
      {state.inspection === undefined ? null : <ConfigureSection inspection={state.inspection} t={t} />}

      {state.inspection === undefined && state.cached === undefined ? null : (
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
          {state.inspection === undefined ? null : (
            <DisclosureRow
              icon={<IconGlobeOutline14 size={16} />}
              title={t('windowsTitle')}
              open={open['windows'] === true}
              expandable
              expandOnRowClick
              onToggle={() => { toggle('windows') }}
            >
              <WindowsDetails inspection={state.inspection} t={t} />
            </DisclosureRow>
          )}
          {state.inspection?.wsl === undefined ? null : (
            <DisclosureRow
              icon={<IconGlobeOutline14 size={16} />}
              title={t('wslTitle')}
              open={open['wsl'] === true}
              expandable
              expandOnRowClick
              onToggle={() => { toggle('wsl') }}
            >
              <WslDetails wsl={state.inspection.wsl} t={t} />
            </DisclosureRow>
          )}
          {state.inspection === undefined ? null : (
            <DisclosureRow
              icon={<IconGlobeOutline14 size={16} />}
              title={t('proxyTitle')}
              open={open['proxy'] === true}
              expandable
              expandOnRowClick
              onToggle={() => { toggle('proxy') }}
            >
              <div className={css.detailList}>
                {state.inspection.windows.proxy.endpoints.map(endpoint => (
                  <div key={`${endpoint.source}:${endpoint.host}:${endpoint.port}`} className={css.detailRow}>
                    <span className={css.detailName}>{endpoint.source}</span>
                    <span className={css.detailMeta}>{endpoint.url}{endpoint.listener === undefined ? '' : ` · ${t('endpointListener')} ${endpoint.listener.processName} (${endpoint.listener.pid})`}</span>
                  </div>
                ))}
              </div>
            </DisclosureRow>
          )}
          {state.inspection === undefined ? null : (
            <DisclosureRow
              icon={<IconCheckOutline16 size={16} />}
              title={t('probeTitle')}
              open={open['probes'] === true}
              expandable
              expandOnRowClick
              onToggle={() => { toggle('probes') }}
            >
              <ProbeDetails probes={state.inspection.probes} t={t} />
            </DisclosureRow>
          )}
        </div>
      )}
    </div>
  )
}
