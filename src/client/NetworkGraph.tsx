/** Read-only DSH network path visualization (single lane). */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NetworkPath, NetworkPathGraph, NetworkPathSummary, PathEdge, PathNode, PathStatus } from './contract.ts'
import type { NetworkLocaleKey } from './locales.ts'
import css from './NetworkGraph.module.css'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface NetworkGraphProps {
  graph: NetworkPathGraph
  summary: NetworkPathSummary
  t: T
}

const dotState = (status: PathStatus): StateDotState | undefined => {
  if (status === 'healthy') return 'done'
  if (status === 'warning') return 'warning'
  if (status === 'error') return 'error'
  if (status === 'unknown') return 'ongoing'
  return undefined
}

const symbol = (status: PathStatus): string => {
  if (status === 'healthy') return '✓'
  if (status === 'warning') return '!'
  if (status === 'error') return '✕'
  if (status === 'unknown') return '?'
  return '·'
}

function statusLabel(status: PathStatus, t: T): string {
  if (status === 'healthy') return t('healthyLabel')
  if (status === 'warning') return t('warningLabel')
  if (status === 'error') return t('errorLabel')
  if (status === 'not-applicable') return t('notApplicableLabel')
  return t('unknownLabel')
}

function NodeChip({ node, t }: { node: PathNode; t: T }): ReactNode {
  const chip = (
    <span className={css.node} data-status={node.status} data-type={node.type} data-role={node.role}>
      <span className={css.nodeStatus} aria-hidden="true">{symbol(node.status)}</span>
      <span className={css.nodeBody}>
        <span className={css.nodeLabel}>{node.label}</span>
        {node.subtitle === undefined ? null : <span className={css.nodeSubtitle}>{node.subtitle}</span>}
      </span>
    </span>
  )
  const tip = node.address === undefined && node.port === undefined
    ? `${node.label} · ${statusLabel(node.status, t)}`
    : `${node.label} · ${node.address ?? ''}${node.port === undefined ? '' : `:${node.port}`}`
  return <Tooltip label={tip}>{chip}</Tooltip>
}

function EdgeConnector({ edge, t }: { edge: PathEdge; t: T }): ReactNode {
  const connector = (
    <span className={css.connector} data-status={edge.status}>
      <span className={css.connectorLine} />
      <span className={css.connectorGlyph} aria-hidden="true">{symbol(edge.status)}</span>
      {edge.label === undefined || edge.label === '' ? null : <span className={css.connectorLabel}>{edge.label}</span>}
    </span>
  )
  const tip = `${edge.relation} · ${statusLabel(edge.status, t)}${edge.label === undefined || edge.label === '' ? '' : ` · ${edge.label}`}`
  return <Tooltip label={tip}>{connector}</Tooltip>
}

function PathLane({ path, t }: { path: NetworkPath; t: T }): ReactNode {
  const mainNodes = path.nodes.filter(node => node.role === 'main')
  const nodeById = new Map(path.nodes.map(node => [node.id, node]))
  const mainEdges = path.edges.filter(edge => nodeById.get(edge.from)?.role !== 'auxiliary' && nodeById.get(edge.to)?.role !== 'auxiliary')

  return (
    <section className={css.lane} data-path="dsh" aria-label={path.label}>
      <header className={css.laneHeader}>
        <span className={css.laneTitle}>{path.label}</span>
        {dotState(path.status) === undefined ? null : <StateDot state={dotState(path.status)!} className={css.dot} />}
        <span className={css.laneStatus}>{statusLabel(path.status, t)}</span>
      </header>

      <div className={css.pathFlow}>
        {mainNodes.map((node, index) => {
          const previous = index === 0 ? undefined : mainNodes[index - 1]
          const edge = previous === undefined ? undefined : mainEdges.find(item => item.from === previous.id && item.to === node.id)
          return (
            <div className={css.flowSegment} key={node.id}>
              {edge === undefined ? null : <EdgeConnector edge={edge} t={t} />}
              <NodeChip node={node} t={t} />
            </div>
          )
        })}
      </div>

      {path.dns.length === 0 ? null : (
        <div className={css.dnsBranch}>
          {path.dns.map(dns => (
            <div key={dns.id} className={css.dnsRow}>
              <span className={css.dnsGlyph} aria-hidden="true">{dns.resolution === 'DELEGATED_TO_PROXY' ? '⇢' : 'DNS'}</span>
              <span className={css.dnsText}>
                {dns.host}
                {dns.resolvedAddresses.length > 0 ? ` → ${dns.resolvedAddresses.join(', ')}` : ''}
                {dns.resolution === 'DELEGATED_TO_PROXY' ? ` · ${t('dnsDelegated')}` : ''}
              </span>
              <span className={css.dnsStatus}>{symbol(dns.status)} {statusLabel(dns.status, t)}</span>
            </div>
          ))}
        </div>
      )}

    </section>
  )
}

function conclusionFor(graph: NetworkPathGraph, t: T): string {
  const failing = graph.dshPath.edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  if (failing === undefined) return graph.dshPath.status === 'healthy' ? t('conclusionHealthy') : t('conclusionUnknown')
  const to = graph.dshPath.nodes.find(node => node.id === failing.to)
  const hostHealthy = graph.dshPath.nodes.find(node => node.type === 'HOST')?.status === 'healthy'
  const gatewayHealthy = graph.dshPath.nodes.find(node => node.type === 'GATEWAY')?.status === 'healthy'
  if (failing.relation === 'PROXY') return t('conclusionProxyFailed', { label: to?.label ?? '代理' })
  if (to?.type === 'TARGET') return hostHealthy && gatewayHealthy ? t('conclusionTargetFailedLocalOk', { label: to.label }) : t('conclusionTargetFailed', { label: to.label })
  return t('conclusionEdgeFailed', { label: `${failing.from} → ${failing.to}` })
}

export function NetworkGraph({ graph, summary, t }: NetworkGraphProps): ReactNode {
  const [repairNotice, setRepairNotice] = useState(false)
  const [showFailureDetails, setShowFailureDetails] = useState(false)
  const firstFailureEdge = graph.dshPath.edges.find(edge => edge.status === 'error' || edge.status === 'warning')
  const fromNode = firstFailureEdge === undefined ? undefined : graph.dshPath.nodes.find(node => node.id === firstFailureEdge.from)
  const toNode = firstFailureEdge === undefined ? undefined : graph.dshPath.nodes.find(node => node.id === firstFailureEdge.to)
  const failureLayer = firstFailedLayer(graph.dshPath.probe)
  const diagnostic = graph.diagnostics.find(item => item.severity !== 'info') ?? graph.diagnostics[0]
  const repairLabel = graph.recommendedRepair?.label ?? diagnostic?.actions[0]?.label

  return (
    <div className={css.root}>
      <div className={css.statusCard}>
        <div className={css.summaryHead}>
          <span className={css.summaryTitle}>{t('networkGraphTitle')}</span>
        </div>
        <div className={css.summaryRows}>
          <div className={css.summaryRow} data-status={summary.dsh.status}>
            <StateDot state={dotState(summary.dsh.status) ?? 'ongoing'} className={css.dot} />
            <span className={css.summaryLabel}>{t('linkLabel')}</span>
            <span className={css.summaryStatus}>{statusLabel(summary.dsh.status, t)}</span>
          </div>
        </div>
        <div className={css.summaryMeta}>{t('egressTarget', { target: summary.target.display })}</div>
        <p className={css.comparisonText}>{conclusionFor(graph, t)}</p>

        {firstFailureEdge === undefined ? null : (
          <div className={css.problemBlock}>
            <div className={css.failureTitle}>{t('problemAt')}</div>
            <div className={css.failurePath}>{fromNode?.label ?? firstFailureEdge.from} → {toNode?.label ?? firstFailureEdge.to}</div>
            <p className={css.failureMessage}>{firstFailureEdge.label ?? t('errorLabel')}</p>
            <div className={css.failureActions}>
              {repairLabel === undefined ? null : (
                <Button variant="primary" size="sm" onClick={() => {
                  setRepairNotice(true)
                  document.getElementById('dsh-network-repair-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}>
                  {t('recommendedRepair')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => { setShowFailureDetails(previous => !previous) }}>
                {t('viewDetails')}
              </Button>
            </div>
            {repairNotice && repairLabel !== undefined ? <p className={css.repairNotice}>{repairLabel}</p> : null}
            {showFailureDetails ? (
              <div className={css.failureDetails}>
                <div className={css.failureDetailRow}>
                  <span className={css.detailName}>{t('failureLayer')}</span>
                  <span className={css.detailMeta}>{failureLayer?.layer.toUpperCase() ?? t('unknownLabel')}</span>
                </div>
                <div className={css.failureDetailRow}>
                  <span className={css.detailName}>{t('failureMessage')}</span>
                  <span className={css.detailMeta}>{failureLayer?.message ?? firstFailureEdge.label ?? t('errorLabel')}</span>
                </div>
                {failureLayer === undefined ? null : (
                  <div className={css.failureDetailRow}>
                    <span className={css.detailName}>{t('detailEvidence')}</span>
                    <span className={css.detailMeta}>{failureLayer.source} · {failureLayer.message}</span>
                  </div>
                )}
                {repairLabel === undefined ? null : (
                  <div className={css.failureDetailRow}>
                    <span className={css.detailName}>{t('recommendedRepair')}</span>
                    <span className={css.detailMeta}>{repairLabel}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {firstFailureEdge === undefined && diagnostic !== undefined ? (
          <div className={css.diagnosticList}>
            <div className={css.diagnosticRow} data-severity={diagnostic.severity}>
              <span className={css.diagnosticGlyph} aria-hidden="true">{diagnostic.severity === 'error' ? '✕' : diagnostic.severity === 'warning' ? '!' : 'i'}</span>
              <span className={css.diagnosticText}>{diagnostic.humanMessage}</span>
            </div>
          </div>
        ) : null}
      </div>

      <PathLane path={graph.dshPath} t={t} />
    </div>
  )
}

function firstFailedLayer(probe: NetworkPath['probe']): { layer: 'dns' | 'tcp' | 'tls' | 'http'; message: string; source: string } | undefined {
  if (probe === undefined) return undefined
  for (const layer of ['dns', 'tcp', 'tls', 'http'] as const) {
    const check = probe.layers[layer]
    if (check === undefined) continue
    if (check.status === 'error' || check.status === 'warning') {
      const raw = check.technicalMessage ?? check.humanMessage
      const normalized = raw.replace(/\s+/g, ' ').trim()
      return { layer, message: normalized.length <= 200 ? normalized : `${normalized.slice(0, 200)}…`, source: check.source ?? layer.toUpperCase() }
    }
  }
  return undefined
}