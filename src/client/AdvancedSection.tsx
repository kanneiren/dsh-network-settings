/** Advanced network first-aid actions, each listed with risk and executed alone. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdvancedAction } from './contract.ts'
import type { NetworkService } from './service.ts'
import type { NetworkLocaleKey } from './locales.ts'
import { MetaBadges } from './MetaBadges.tsx'
import css from './NetworkTab.module.css'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface AdvancedSectionProps {
  service: NetworkService
  t: T
  /** Render without its own section heading (embedded in NetworkConfig). */
  embedded?: boolean
}

export function AdvancedSection({ service, t, embedded = false }: AdvancedSectionProps): ReactNode {
  const [actions, setActions] = useState<AdvancedAction[]>([])
  const [pending, setPending] = useState<AdvancedAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    void service.advancedList().then(setActions)
  }, [service])

  const confirm = async (): Promise<void> => {
    if (pending === null || busy) return
    setBusy(true)
    setFailure(undefined)
    const result = await service.advancedRun(pending.id)
    setBusy(false)
    setPending(null)
    if (result === undefined) {
      setFailure(t('applyFailed'))
      return
    }
    setNotice(t('advancedDone', { label: result.action.label }))
    void service.run()
  }

  const riskLabel = (risk: AdvancedAction['risk']): string => {
    if (risk === 'low') return 'low'
    if (risk === 'medium') return 'medium'
    return 'high'
  }

  return (
    <div className={css.configList}>
      {embedded ? null : <h3 className={css.subtitle}>{t('advancedTitle')}</h3>}
      {actions.map(action => (
        <div key={action.id} className={css.configCard}>
          <div className={css.detailName}>{action.label}</div>
          <div className={css.detailMeta}>{action.purpose}</div>
          <MetaBadges labels={[
            t('advancedRisk', { risk: riskLabel(action.risk) }),
            ...(action.requiresAdmin ? [t('advancedAdmin')] : []),
            ...(action.requiresReboot ? [t('advancedReboot')] : []),
            action.recoverable ? t('advancedRecoverable') : t('advancedNotRecoverable'),
          ]} />
          <Button variant="outline" size="sm" onClick={() => { setPending(action) }}>{t('advancedExecute')}</Button>
        </div>
      ))}
      {notice === undefined ? null : <p className={css.successText}>{notice}</p>}
      {failure === undefined ? null : <p className={css.errorText} role="alert">{failure}</p>}

      <Modal
        open={pending !== null}
        onClose={() => { if (!busy) setPending(null) }}
        title={pending?.label ?? ''}
        closeLabel={t('close')}
        description={pending?.purpose}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setPending(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void confirm() }}>{busy ? t('advancedExecuting') : t('advancedExecute')}</Button>
          </>
        )}
      >
        <div className={css.detailList}>
          {pending === null ? null : (
            <MetaBadges labels={[
              t('advancedRisk', { risk: riskLabel(pending.risk) }),
              ...(pending.requiresAdmin ? [t('advancedAdmin')] : []),
              ...(pending.requiresReboot ? [t('advancedReboot')] : []),
              pending.recoverable ? t('advancedRecoverable') : t('advancedNotRecoverable'),
            ]} />
          )}
        </div>
      </Modal>
    </div>
  )
}
