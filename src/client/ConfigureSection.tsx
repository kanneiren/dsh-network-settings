/** Read-only scoped configuration status. Mutations live in RepairSection. */
import type { ReactNode } from 'react'
import type { NetworkInspection } from './contract.ts'
import type { NetworkLocaleKey } from './locales.ts'
import css from './NetworkTab.module.css'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface ConfigureSectionProps {
  inspection: NetworkInspection
  t: T
}

export function ConfigureSection({ inspection, t }: ConfigureSectionProps): ReactNode {
  const wininet = inspection.windows.proxy.wininet
  const winhttpUser = inspection.windows.proxy.winhttp.find(entry => entry.scope === 'user')
  const userEnv = inspection.windows.environment.scopes.user
  const dshEnv = inspection.windows.dshProcessEnvironment
  const hasUserEnvProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some(name => userEnv[name] !== undefined && userEnv[name] !== '')
  const hasDshEnvProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some(name => dshEnv[name] !== undefined && dshEnv[name] !== '')

  const cards = [
    {
      name: t('clearWininet'),
      value: wininet.enabled ? `${t('currentEnabled')}${wininet.proxyServer === undefined ? '' : `：${wininet.proxyServer}`}` : t('currentDisabled'),
    },
    {
      name: t('clearWinHttp'),
      value: winhttpUser?.proxyEnabled === true ? `${t('currentEnabled')}${winhttpUser.proxy === undefined ? '' : `：${winhttpUser.proxy}`}` : t('currentDisabled'),
    },
    {
      name: t('clearEnvUser'),
      value: hasUserEnvProxy ? t('envHasProxy') : t('envNoProxy'),
    },
    {
      name: t('clearDshEnv'),
      value: hasDshEnvProxy ? t('dshHasProxy') : t('dshNoProxy'),
    },
  ]

  return (
    <div className={css.configList}>
      <h3 className={css.subtitle}>{t('configureTitle')}</h3>
      {cards.map(card => (
        <div key={card.name} className={css.configCard}>
          <div className={css.detailName}>{card.name}</div>
          <div className={css.detailMeta}>{card.value}</div>
        </div>
      ))}
      <div className={css.configCard}>
        <div className={css.detailName}>{t('wslDistroNetwork')}</div>
        {inspection.wsl?.distributions.length === 0
          ? <div className={css.detailMeta}>{t('wslNoConfig')}</div>
          : inspection.wsl?.distributions.map(distro => {
              const resolv = distro.network?.resolvConf ?? []
              const wslConf = distro.network?.wslConf
              return (
                <div key={distro.name} className={css.detailMeta}>
                  <div>{distro.name} · {distro.state === 'running' ? t('stateRunning') : t('stateStopped')}{distro.osMetadata?.prettyName === undefined ? '' : ` · ${distro.osMetadata.prettyName}`}</div>
                  {distro.network?.defaultRoute === undefined ? null : <div>默认路由：{distro.network.defaultRoute}</div>}
                  {resolv.length === 0 ? null : <div>resolv.conf：{resolv.join(', ')}</div>}
                  {wslConf?.network?.generateResolvConf === undefined ? null : <div>generateResolvConf：{String(wslConf.network.generateResolvConf)}</div>}
                  {wslConf?.network?.generateHosts === undefined ? null : <div>generateHosts：{String(wslConf.network.generateHosts)}</div>}
                  {wslConf?.boot?.systemd === undefined ? null : <div>systemd：{String(wslConf.boot.systemd)}</div>}
                </div>
              )
            })}
      </div>
      <div className={css.configCard}>
        <div className={css.detailName}>{t('wslGlobalNetwork')}</div>
        {inspection.wsl?.globalConfig === undefined
          ? <div className={css.detailMeta}>{t('wslNoConfig')}</div>
          : (
              <div className={css.detailMeta}>
                <div>{t('wslMode', { mode: inspection.wsl.globalConfig.mode })}</div>
                {inspection.wsl.globalConfig.autoProxy === undefined ? null : <div>{t('wslAutoProxy', { value: String(inspection.wsl.globalConfig.autoProxy) })}</div>}
                {inspection.wsl.globalConfig.dnsTunneling === undefined ? null : <div>{t('wslDnsTunneling', { value: String(inspection.wsl.globalConfig.dnsTunneling) })}</div>}
                <div>{t('wslReadonly')}</div>
              </div>
            )}
      </div>
    </div>
  )
}
