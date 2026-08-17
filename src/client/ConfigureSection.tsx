/** Scoped proxy configuration status. Only enabled scopes get a card. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { DisclosureRow, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NetworkInspection } from './contract.ts'
import type { NetworkLocaleKey } from './locales.ts'
import css from './NetworkTab.module.css'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface ConfigureSectionProps {
  inspection: NetworkInspection
  t: T
}

function proxyValue(env: Record<string, string | undefined> | undefined): string | undefined {
  if (env === undefined) return undefined
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

export function ConfigureSection({ inspection, t }: ConfigureSectionProps): ReactNode {
  const [openDisabled, setOpenDisabled] = useState(false)
  const wininet = inspection.windows.proxy.wininet
  const winhttpUser = inspection.windows.proxy.winhttp.find(entry => entry.scope === 'user')
  const userEnvProxy = proxyValue(inspection.windows.environment.scopes.user)
  const dshEnvProxy = proxyValue(inspection.windows.dshProcessEnvironment)

  const cards: Array<{ key: string; name: string; value: string }> = []
  const disabled: Array<{ key: string; name: string }> = []

  if (wininet.enabled) cards.push({ key: 'wininet', name: t('clearWininet'), value: wininet.proxyServer ?? t('currentEnabled') })
  else disabled.push({ key: 'wininet', name: t('clearWininet') })

  if (winhttpUser?.proxyEnabled === true) cards.push({ key: 'winhttp-user', name: t('clearWinHttp'), value: winhttpUser.proxy ?? t('currentEnabled') })
  else disabled.push({ key: 'winhttp-user', name: t('clearWinHttp') })

  if (userEnvProxy !== undefined) cards.push({ key: 'env-user', name: t('clearEnvUser'), value: userEnvProxy })
  else disabled.push({ key: 'env-user', name: t('clearEnvUser') })

  if (dshEnvProxy !== undefined) cards.push({ key: 'dsh', name: t('clearDshEnv'), value: dshEnvProxy })
  else disabled.push({ key: 'dsh', name: t('clearDshEnv') })

  return (
    <div className={css.configList}>
      <h3 className={css.subtitle}>{t('configureTitle')}</h3>
      {cards.length === 0 ? <p className={css.muted}>{t('noEnabledProxyConfig')}</p> : null}
      {cards.map(card => (
        <div key={card.key} className={css.configCard}>
          <div className={css.detailName}>{card.name}</div>
          <div className={css.detailMeta}>{card.value}</div>
        </div>
      ))}
      <DisclosureRow
        icon={<IconGlobeOutline14 size={16} />}
        title={t('disabledConfigs', { count: disabled.length })}
        open={openDisabled}
        expandable
        expandOnRowClick
        onToggle={() => { setOpenDisabled(previous => !previous) }}
      >
        <div className={css.detailList}>
          {disabled.map(item => <div key={item.key} className={css.detailRow}><span className={css.detailName}>{item.name}</span><span className={css.detailMeta}>{t('currentDisabled')}</span></div>)}
        </div>
      </DisclosureRow>
    </div>
  )
}
