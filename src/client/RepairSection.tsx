/** Independent repair operations: recommended candidates + full catalog. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, DisclosureRow, IconCheckOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Diagnosis, HostsDeletePreview, HostsEntry, NetworkInspection, RepairOperation, RepairOperationPreview, RepairRecommendation, SnapshotRecord, WslProxyPreview, WslProxySource } from './contract.ts'
import type { NetworkService } from './service.ts'
import type { NetworkLocaleKey } from './locales.ts'
import css from './NetworkTab.module.css'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface RepairSectionProps {
  service: NetworkService
  diagnoses: Diagnosis[]
  inspection?: NetworkInspection
  t: T
}

type Pending =
  | { kind: 'operation'; operation: RepairOperation; preview: RepairOperationPreview }
  | { kind: 'wsl'; source: WslProxySource; preview: WslProxyPreview }
  | { kind: 'hosts'; entry: HostsEntry; preview: HostsDeletePreview }

export function RepairSection({ service, diagnoses, inspection, t }: RepairSectionProps): ReactNode {
  const [catalog, setCatalog] = useState<RepairOperation[]>([])
  const [recommendations, setRecommendations] = useState<RepairRecommendation[]>([])
  const [recentlyAppliedIds, setRecentlyAppliedIds] = useState<string[]>([])
  const [wslSources, setWslSources] = useState<WslProxySource[]>([])
  const [hostsEntries, setHostsEntries] = useState<HostsEntry[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    void service.repairCatalog().then(setCatalog)
    void service.recommendedRepairs(diagnoses).then(result => {
      setRecommendations(result.recommendations)
      setRecentlyAppliedIds(result.recentlyAppliedIds)
    })
    void service.listSnapshots().then(setSnapshots)
    const running = inspection?.wsl?.distributions.filter(distro => distro.state === 'running') ?? []
    void Promise.all(running.map(distro => service.wslProxySources(distro.name)))
      .then(groups => setWslSources(groups.flat()))
    void service.hostsEntries().then(setHostsEntries)
  }, [service, diagnoses, inspection])

  const onOperation = async (operation: RepairOperation): Promise<void> => {
    setFailure(undefined)
    const preview = await service.previewRepairOperation(operation.id)
    if (preview === undefined) {
      setFailure(t('previewFailed'))
      return
    }
    setPending({ kind: 'operation', operation, preview })
  }

  const onHostsEntry = async (entry: HostsEntry): Promise<void> => {
    setFailure(undefined)
    const preview = await service.previewHostsDelete(entry)
    if (preview === undefined) {
      setFailure(t('previewFailed'))
      return
    }
    setPending({ kind: 'hosts', entry, preview })
  }

  const onWslSource = async (source: WslProxySource): Promise<void> => {
    setFailure(undefined)
    const preview = await service.previewWslProxySource(source)
    if (preview === undefined) {
      setFailure(t('previewFailed'))
      return
    }
    setPending({ kind: 'wsl', source, preview })
  }

  const confirm = async (): Promise<void> => {
    if (pending === null || busy) return
    setBusy(true)
    setFailure(undefined)
    if (pending.kind === 'operation') {
      const result = await service.applyRepairOperation(pending.operation.id)
      if (result === undefined) {
        setFailure(t('applyFailed'))
        setBusy(false)
        return
      }
      setNotice(t('appliedScope', { scope: result.operation.scope }))
    } else if (pending.kind === 'wsl') {
      const result = await service.applyWslProxySource(pending.source)
      if (result === undefined) {
        setFailure(t('applyFailed'))
        setBusy(false)
        return
      }
      setNotice(t('appliedScope', { scope: pending.source.scope }))
    } else {
      const result = await service.applyHostsDelete(pending.entry)
      if (result === undefined) {
        setFailure(t('applyFailed'))
        setBusy(false)
        return
      }
      setNotice(t('appliedScope', { scope: 'windows.hosts' }))
    }
    setBusy(false)
    setPending(null)
    void service.run()
    void service.listSnapshots().then(setSnapshots)
  }

  const undo = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    const result = await service.rollbackLatest()
    setBusy(false)
    if (result === undefined) {
      setFailure(t('applyFailed'))
      return
    }
    setNotice(t('appliedScope', { scope: result.snapshot.scope }))
    void service.run()
    void service.listSnapshots().then(setSnapshots)
  }

  const recommendedIds = new Set(recommendations.flatMap(recommendation => recommendation.operations.map(operation => operation.id)))
  const otherOperations = catalog.filter(operation => !recommendedIds.has(operation.id))

  const metadata = (operation: RepairOperation): string => [
    operation.scope,
    `${operation.requiresAdmin ? t('advancedAdmin') : t('advancedNoAdmin')}`,
    `${operation.requiresReboot ? t('advancedReboot') : t('advancedNoReboot')}`,
    `${operation.recoverable ? t('advancedRecoverable') : t('advancedNotRecoverable')}`,
  ].join(' · ')

  return (
    <div className={css.configList}>
      <h3 className={css.subtitle}>{t('repairTitle')}</h3>

      {recommendations.map((recommendation, index) => {
        const freshOperations = recommendation.operations.filter(operation => !recentlyAppliedIds.includes(operation.id))
        const recentOperations = recommendation.operations.filter(operation => recentlyAppliedIds.includes(operation.id))
        return (
        <div key={`${recommendation.action.code}:${index}`} className={css.configCard}>
          <div className={css.detailName}>{recommendation.action.label}</div>
          <div className={css.detailMeta}>{recommendation.action.scope}</div>
          {recommendation.operations.length === 0
            ? <p className={css.muted}>{t('noRepairForDiagnosis')}</p>
            : (
                <>
                  {recentOperations.length > 0 ? <p className={css.muted}>{t('recentlyApplied', { label: recentOperations.map(operation => operation.label).join('、') })}</p> : null}
                  {freshOperations.length > 0 && freshOperations.length > 1 ? <div className={css.detailMeta}>{t('suggestedOrder')}</div> : null}
                  {freshOperations.map((operation, step) => (
                    <OperationButton key={operation.id} operation={operation} metadata={metadata(operation)} label={t('advancedExecute')} recommended step={freshOperations.length > 1 ? step + 1 : undefined} onOperation={() => { void onOperation(operation) }} t={t} />
                  ))}
                </>
              )}
        </div>
        )
      })}

      {diagnoses.length === 0 ? <p className={css.muted}>{t('noRecommendedRepair')}</p> : null}

      {hostsEntries.length === 0 ? null : (
        <div className={css.configCard}>
          <div className={css.detailName}>{t('hostsRepairTitle')}</div>
          {hostsEntries.map(entry => (
            <div key={entry.id} className={css.operationCard}>
              <div className={css.detailMeta}>{entry.ip} → {entry.hostnames.join(' ')}</div>
              <div className={css.technical}>{entry.raw.trim()}</div>
              <Button variant="outline" size="sm" onClick={() => { void onHostsEntry(entry) }}>{t('deleteHostsEntry')}</Button>
            </div>
          ))}
        </div>
      )}

      {wslSources.length === 0 ? null : (
        <div className={css.configCard}>
          <div className={css.detailName}>{t('wslFileRepairTitle')}</div>
          {wslSources.map(source => (
            <div key={source.id} className={css.operationCard}>
              <div className={css.detailMeta}>{source.file}:{source.line}</div>
              <div className={css.technical}>{source.raw}</div>
              <Button variant="outline" size="sm" onClick={() => { void onWslSource(source) }}>{t('deleteProxyLine')}</Button>
            </div>
          ))}
        </div>
      )}

      <DisclosureRow
        icon={<IconCheckOutline16 size={16} />}
        title={recommendations.length === 0 ? t('allRepairs') : t('otherRepairs')}
        open={catalogOpen}
        expandable
        expandOnRowClick
        onToggle={() => { setCatalogOpen(previous => !previous) }}
        collapsedContent={<span className={css.muted}>{otherOperations.length}</span>}
      >
        <div className={css.detailList}>
          {otherOperations.map(operation => (
            <OperationButton key={operation.id} operation={operation} metadata={metadata(operation)} label={t('advancedExecute')} onOperation={() => { void onOperation(operation) }} t={t} />
          ))}
        </div>
      </DisclosureRow>

      <div className={css.configCard}>
        <div className={css.detailName}>{t('undoLast')}</div>
        <div className={css.detailMeta}>{snapshots.length === 0 ? t('noHistory') : snapshots[0]?.reason}</div>
        <Button variant="outline" size="sm" disabled={snapshots.length === 0 || busy} onClick={() => { void undo() }}>{t('undoLast')}</Button>
      </div>

      <div className={css.configCard}>
        <div className={css.detailName}>{t('history')}</div>
        {snapshots.length === 0
          ? <p className={css.muted}>{t('noHistory')}</p>
          : snapshots.slice(0, 10).map(snapshot => (
              <div key={snapshot.id} className={css.detailRow}>
                <span className={css.detailName}>{snapshot.reason}</span>
                <span className={css.detailMeta}>{snapshot.scope} · {new Date(snapshot.timestamp).toLocaleString()}</span>
              </div>
            ))}
      </div>

      {notice === undefined ? null : <p className={css.successText}>{notice}</p>}
      {failure === undefined ? null : <p className={css.errorText} role="alert">{failure}</p>}

      <Modal
        open={pending !== null}
        onClose={() => { if (!busy) setPending(null) }}
        title={pending?.kind === 'wsl' ? `${pending.source.file}:${pending.source.line}` : pending?.kind === 'hosts' ? `Hosts:${pending.entry.line}` : pending?.operation.label ?? ''}
        closeLabel={t('close')}
        description={pending?.kind === 'wsl' ? pending.preview.scopeDescription : pending?.kind === 'hosts' ? pending.preview.scopeDescription : pending?.operation.description}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setPending(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void confirm() }}>{busy ? t('applying') : t('confirmApply')}</Button>
          </>
        )}
      >
        <div className={css.detailList}>
          {pending?.kind === 'operation' ? <div className={css.technical}>{metadata(pending.operation)}</div> : null}
          {pending?.kind === 'operation' && pending.preview.preview?.scopeDescription !== undefined ? <div className={css.technical}>{pending.preview.preview.scopeDescription}</div> : null}
          {pending?.kind === 'operation' && pending.preview.preview !== undefined
            ? pending.preview.preview.diffText.length === 0
              ? <p className={css.muted}>{t('noChanges')}</p>
              : pending.preview.preview.diffText.map(line => <div key={line} className={css.technical}>{line}</div>)
            : null}
          {pending?.kind === 'operation' && pending.preview.advanced !== undefined ? <div className={css.technical}>{pending.preview.advanced.purpose}</div> : null}
          {pending?.kind === 'wsl' ? pending.preview.diffText.map(line => <div key={line} className={css.technical}>{line}</div>) : null}
          {pending?.kind === 'hosts' ? pending.preview.diffText.map(line => <div key={line} className={css.technical}>{line}</div>) : null}
        </div>
      </Modal>
    </div>
  )
}

function OperationButton({ operation, metadata, label, recommended = false, step, onOperation, t }: {
  operation: RepairOperation
  metadata: string
  label: string
  recommended?: boolean
  step?: number
  onOperation: () => void
  t: T
}): ReactNode {
  return (
    <div className={css.operationCard}>
      <div className={css.detailName}>
        {operation.label}
        {recommended ? <span className={css.recommendedBadge}>{step === undefined ? t('recommended') : t('step', { step })}</span> : null}
      </div>
      <div className={css.detailMeta}>{operation.description}</div>
      <div className={css.detailMeta}>{metadata}</div>
      <Button variant="outline" size="sm" onClick={onOperation}>{label}</Button>
    </div>
  )
}
