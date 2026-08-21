/** Hierarchical network configuration surface with progressive disclosure. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, DisclosureRow, IconGlobeOutline14, Modal, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Diagnosis, DiagnosisReport, NetworkInspection, NetworkPathGraph, RepairOperation, RepairOperationPreview } from './contract.ts'
import type { NetworkService, OpenLocationKind } from './service.ts'
import type { NetworkLocaleKey } from './locales.ts'
import { AdvancedSection } from './AdvancedSection.tsx'
import css from './NetworkTab.module.css'
import { MetaBadges } from './MetaBadges.tsx'

type T = (key: NetworkLocaleKey, params?: Record<string, string | number>) => string

export interface NetworkConfigProps {
  service: NetworkService
  inspection?: NetworkInspection
  diagnosis?: DiagnosisReport
  graph?: NetworkPathGraph
  t: T
}

interface OpenState { proxy: boolean; dsh: boolean; wsl: boolean; advanced: boolean }


/** Platform-aware helpers — keep UI components free of runtime.type checks. */

function platformOf(inspection: NetworkInspection | undefined, graph: NetworkPathGraph | undefined): 'windows' | 'wsl' | 'macos' | 'unknown' {
  if (graph?.runtime.type === 'WSL_DISTRIBUTION') return 'wsl'
  if (graph?.runtime.type === 'MACOS_NATIVE') return 'macos'
  if (graph?.runtime.type === 'WINDOWS_NATIVE') return 'windows'
  if (inspection?.macos !== undefined) return 'macos'
  if (inspection?.windows !== undefined) return 'windows'
  return 'unknown'
}

function hostsPathFor(platform: string): string {
  if (platform === 'macos') return '/etc/hosts'
  if (platform === 'wsl') return '/mnt/c/Windows/System32/drivers/etc/hosts'
  return 'C:\\Windows\\System32\\drivers\\etc\\hosts'
}

function runtimeDisplayLabel(graph: NetworkPathGraph | undefined): string {
  if (graph === undefined) return '未知'
  if (graph.runtime.type === 'WINDOWS_NATIVE') return 'Windows'
  if (graph.runtime.type === 'MACOS_NATIVE') return graph.runtime.os === undefined ? 'macOS' : `${graph.runtime.os.caption} ${graph.runtime.os.version}`
  return `${graph.runtime.registeredName ?? graph.runtime.displayName} · WSL ${String(graph.runtime.wslVersion ?? '?')}`
}

export function NetworkConfig({ service, inspection, diagnosis, graph, t }: NetworkConfigProps): ReactNode {
  const hasInspection = inspection !== undefined
  const data = inspection ?? emptyInspection()
  const [open, setOpen] = useState<OpenState>({ proxy: true, dsh: false, wsl: false, advanced: false })
  const [pending, setPending] = useState<RepairOperationPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [copiedPath, setCopiedPath] = useState<string | undefined>(undefined)

  const diagnoses = diagnosis?.diagnoses ?? []
  const staleDshProxy = diagnoses.some(item => item.code === 'DRIFT_DSH_PROXY_STALE')
  const staleWinHttpUser = diagnoses.some(item => item.code === 'DRIFT_WINHTTP_STALE' && item.actions.some(action => action.scope === 'windows.winhttp.user'))
  const staleWinHttpMachine = diagnoses.some(item => item.code === 'DRIFT_WINHTTP_STALE' && item.actions.some(action => action.scope === 'windows.winhttp.machine'))

  const toggle = (key: keyof OpenState): void => setOpen(previous => ({ ...previous, [key]: !previous[key] }))

  const prepareOperation = async (id: string): Promise<void> => {
    setFailure(undefined)
    const preview = await service.previewRepairOperation(id)
    if (preview === undefined) {
      setFailure(t('previewFailed'))
      return
    }
    setPending(preview)
  }

  const applyPending = async (): Promise<void> => {
    if (pending === null || busy) return
    setBusy(true)
    setFailure(undefined)
    const result = await service.applyRepairOperation(pending.operation.id)
    setBusy(false)
    setPending(null)
    if (result === undefined) {
      setFailure(t('applyFailed'))
      return
    }
    setNotice(t('appliedScope', { scope: result.operation.scope }))
  }

  const openLocation = async (kind: OpenLocationKind, target?: string): Promise<void> => {
    const result = await service.openConfigLocation(kind, target)
    if (result === undefined || !result.opened) setFailure(t('openLocationFailed'))
  }

  const copyPath = async (path: string): Promise<void> => {
    await writeClipboard(path)
    setCopiedPath(path)
    window.setTimeout(() => { setCopiedPath(undefined) }, 1500)
  }

  const windows = data.windows ?? emptyWindows()
  const mac = data.macos
  const isMac = mac !== undefined
  const wininet = windows.proxy.wininet
  const winhttp = windows.proxy.winhttp
  const env = windows.environment.scopes
  const dshEnv = data.dsh
  const registeredName = platformOf(data, graph) === 'wsl' && graph?.runtime.type === 'WSL_DISTRIBUTION' ? graph.runtime.registeredName : undefined
  const currentDistro = registeredName === undefined
    ? data.wsl?.distributions.find(item => item.state === 'running')
    : data.wsl?.distributions.find(item => item.state === 'running' && item.name === registeredName)
      ?? data.wsl?.distributions.find(item => item.state === 'running')
  const otherDistros = (data.wsl?.distributions ?? []).filter(item => item.name !== currentDistro?.name)

  return (
    <div className={css.configList}>
      <h3 className={css.subtitle}>{t('configureTitle')}</h3>

      <DisclosureRow
        icon={<IconGlobeOutline14 size={16} />}
        title={isMac ? t('macSystemProxy') : t('configGroupProxy')}
        open={open.proxy}
        expandable
        expandOnRowClick
        onToggle={() => { toggle('proxy') }}
      >
        <div className={css.detailList}>
          {isMac ? (
            <>
              <div className={css.configCard}>
                <div className={css.detailName}>{t('macSystemProxy')}</div>
                <div className={css.detailMeta}>{t('statusLabel')}：{mac.proxy.scutil.httpEnabled || mac.proxy.scutil.httpsEnabled ? t('macSystemProxyOn') : t('macSystemProxyOff')}</div>
                {(mac.proxy.scutil.httpEnabled || mac.proxy.scutil.httpsEnabled) && (mac.proxy.scutil.httpsHost ?? mac.proxy.scutil.httpHost) !== undefined ? (
                  <div className={css.detailMeta}>{t('currentValue')}：{mac.proxy.scutil.httpsHost ?? mac.proxy.scutil.httpHost}:{mac.proxy.scutil.httpsPort ?? mac.proxy.scutil.httpPort}</div>
                ) : null}
                {mac.proxy.scutil.pacEnabled && mac.proxy.scutil.pacUrl !== undefined ? <div className={css.detailMeta}>{t('macPacUrl')}：{mac.proxy.scutil.pacUrl}</div> : null}
                <div className={css.actions}>
                  <Button variant="outline" size="sm" onClick={() => { void openLocation('system-proxy-settings') }}>{t('macOpenNetworkSettings')}</Button>
                </div>
              </div>
              <div className={css.configCard}>
                <div className={css.detailName}>{t('macShellEnv')}</div>
                <div className={css.detailMeta}>{t('macShellEnvHint')}</div>
                {(() => {
                  const entries = envEntries(mac.environment)
                  if (entries.length === 0) return <div className={css.detailMeta}>{t('envProxyNotSet')}</div>
                  return entries.map(([name, value]) => (
                    <div key={name} className={css.detailRow}>
                      <span className={css.detailName}>{name}</span>
                      <span className={css.detailMeta}>{value}</span>
                    </div>
                  ))
                })()}
                <div className={css.actions}>
                  <Button variant="outline" size="sm" onClick={() => { void openLocation('shell-profile') }}>{t('macOpenShellProfile')}</Button>
                </div>
              </div>
              <div className={css.configCard}>
                <div className={css.detailName}>{t('macDnsServers')}</div>
                {mac.dns.nameservers.length === 0 ? <div className={css.detailMeta}>{t('unknownLabel')}</div> : null}
                {mac.dns.nameservers.map(ns => <div key={ns} className={css.detailMeta}>{ns}</div>)}
              </div>
            </>
          ) : (
            <>
              <div className={css.configCard}>
                <div className={css.detailName}>{t('configWinInet')}</div>
                <div className={css.detailMeta}>{t('statusLabel')}：{hasInspection ? (wininet.enabled ? t('currentEnabled') : t('currentDisabled')) : t('unknownLabel')}</div>
                {wininet.enabled && wininet.proxyServer !== undefined ? <div className={css.detailMeta}>{t('currentValue')}：{wininet.proxyServer}</div> : null}
                <div className={css.detailMeta}>{t('configSource')}：{hasInspection ? t('configSourceWinInet') : t('notTestedLabel')}</div>
                <div className={css.actions}>
                  <Button variant="outline" size="sm" onClick={() => { void openLocation('system-proxy-settings') }}>{t('openWindowsProxySettings')}</Button>
                </div>
              </div>

              <div className={css.configCard}>
                <div className={css.detailName}>{t('configEnvVars')}</div>
                {(() => {
                  const entries = hasInspection ? envEntries(env['user']) : []
                  return (
                    <div className={css.detailRow}>
                      <span className={css.detailName}>{t('envScopeUser')}</span>
                      {!hasInspection ? <span className={css.detailMeta}>{t('notTestedLabel')}</span> : null}
                      {hasInspection && entries.length === 0 ? <span className={css.detailMeta}>{t('envProxyNotSet')}</span> : null}
                      {entries.map(([name, value]) => (
                        <span key={name} className={css.detailMeta}>{name}={value}</span>
                      ))}
                    </div>
                  )
                })()}
                {(() => {
                  const entries = hasInspection ? envEntries(env['machine']) : []
                  if (entries.length === 0) return null
                  return (
                    <div className={css.detailRow}>
                      <span className={css.detailName}>{t('envScopeMachine')}</span>
                      {entries.map(([name, value]) => (
                        <span key={name} className={css.detailMeta}>{name}={value}</span>
                      ))}
                    </div>
                  )
                })()}
                {staleDshProxy ? (
                  <>
                    <div className={css.detailMeta}>{t('staleProxyHint')}</div>
                    <Button variant="outline" size="sm" onClick={() => { void prepareOperation('clear-dsh-process-proxy') }}>{t('deleteStaleProxyVar')}</Button>
                  </>
                ) : null}
              </div>

              <div className={css.configCard}>
                <div className={css.detailName}>{t('configPac')}</div>
                <div className={css.detailMeta}>{hasInspection ? pacSummary(wininet, t) : t('unknownLabel')}</div>
                {wininet.autoConfigUrl !== undefined ? <div className={css.detailMeta}>{wininet.autoConfigUrl}</div> : null}
              </div>
            </>
          )}
        </div>
      </DisclosureRow>

      <DisclosureRow
        icon={<IconGlobeOutline14 size={16} />}
        title={t('configGroupDsh')}
        open={open.dsh}
        expandable
        expandOnRowClick
        onToggle={() => { toggle('dsh') }}
      >
        <div className={css.detailList}>
          {!hasInspection && graph === undefined ? (
            <div className={css.configCard}>
              <div className={css.detailMeta}>{t('dshNotTested')}</div>
            </div>
          ) : (
          <div className={css.configCard}>
            <div className={css.detailName}>{t('dshRuntime')}</div>
            <div className={css.detailMeta}>{hasInspection || graph !== undefined ? dshRuntimeLabel(graph, t) : t('unknownLabel')}</div>
            {(() => {
              const egress = graph?.dshPath.egress
              const endpoint = egress?.proxyEndpoint
              const listener = endpoint?.listener
              return (
                <>
                  <div className={css.detailName}>{t('dshEgressMode')}</div>
                  {egress === undefined ? <div className={css.detailMeta}>{t('unknownLabel')}</div>
                    : egress.mode === 'DIRECT' ? <div className={css.detailMeta}>{t('dshEgressDirect')}</div>
                      : (
                        <>
                          <div className={css.detailMeta}>{t('dshEgressProxy')}{egress.proxyConfiguration?.displayValue === undefined ? '' : ` · ${egress.proxyConfiguration.displayValue}`}</div>
                          {(endpoint?.state === 'UNREACHABLE' || endpoint?.state === 'UNUSABLE') ? (
                            <div className={css.errorText}>{t('dshEgressUnavailable')}</div>
                          ) : null}
                          {listener?.state === 'LISTENING' ? (
                            <div className={css.detailRow}>
                              <span className={css.detailName}>{t('dshListener')}</span>
                              <span className={css.detailMeta}>{listener.processName ?? t('unknownLabel')}{listener.pid === undefined ? '' : ` · PID ${listener.pid}`}</span>
                            </div>
                          ) : listener?.state === 'NOT_FOUND' ? (
                            <div className={css.detailRow}>
                              <span className={css.detailName}>{t('dshListener')}</span>
                              <span className={css.errorText}>{t('dshListenerMissing')}</span>
                            </div>
                          ) : null}
                          {egress.proxyConfiguration?.source === undefined ? null : (
                            <div className={css.detailRow}>
                              <span className={css.detailName}>{t('configSource')}</span>
                              <span className={css.detailMeta}>{egress.proxyConfiguration.source}</span>
                            </div>
                          )}
                        </>
                      )}
                </>
              )
            })()}
            <div className={css.detailName}>{t('dshProxyEnv')}</div>
            {(() => {
              const entries = hasInspection ? envEntries(dshEnv) : []
              if (!hasInspection) return <div className={css.detailMeta}>{t('unknownLabel')}</div>
              if (entries.length === 0) return <div className={css.detailMeta}>{t('envProxyNotSet')}</div>
              return entries.map(([name, value]) => (
                <div key={name} className={css.detailRow}>
                  <span className={css.detailName}>{name}</span>
                  <span className={css.detailMeta}>{value}</span>
                </div>
              ))
            })()}
            {staleDshProxy ? <div className={css.detailMeta}>{t('staleProxyHint')}</div> : null}
          </div>
          )}
        </div>
      </DisclosureRow>

      {hasInspection && data.wsl?.available === true ? (
        <DisclosureRow
          icon={<IconGlobeOutline14 size={16} />}
          title={t('configGroupWsl')}
          open={open.wsl}
          expandable
          expandOnRowClick
          onToggle={() => { toggle('wsl') }}
        >
          <div className={css.detailList}>
            <div className={css.configCard}>
              <div className={css.detailName}>{t('currentDistribution')}</div>
              <div className={css.detailMeta}>{currentDistro?.name ?? t('sourceUnknown')}{currentDistro?.osMetadata?.prettyName === undefined ? '' : ` · ${currentDistro.osMetadata.prettyName}`}</div>
              <div className={css.detailMeta}>{t('wslMode', { mode: data.wsl?.globalConfig?.mode ?? 'unknown' })}</div>
              <div className={css.detailMeta}>{t('wslAutoProxy', { value: String(data.wsl?.globalConfig?.autoProxy ?? false) })}</div>
              <div className={css.detailMeta}>{t('wslDnsTunneling', { value: String(data.wsl?.globalConfig?.dnsTunneling ?? false) })}</div>
              <div className={css.detailMeta}>/etc/wsl.conf{currentDistro === undefined ? '' : ` · ${currentDistro.name}`}</div>
              <div className={css.actions}>
                <Button variant="outline" size="sm" onClick={() => { void openLocation('wsl-conf', currentDistro?.name) }}>{t('openConfigLocation')}</Button>
                <Button variant="outline" size="sm" onClick={() => { void copyPath(`\\\\wsl.localhost\\${currentDistro?.name ?? '<distro>'}\etc\wsl.conf`) }}>{copiedPath === `\\\\wsl.localhost\\${currentDistro?.name ?? '<distro>'}\etc\wsl.conf` ? t('copied') : t('copyPath')}</Button>
              </div>
            </div>
            <div className={css.configCard}>
              <div className={css.detailName}>{t('distroEnvironment')}</div>
              {(() => {
                const entries = envEntries(currentDistro?.network?.environment)
                if (entries.length === 0) return <div className={css.detailMeta}>{t('envProxyNotSet')}</div>
                return entries.map(([name, value]) => <div key={name} className={css.detailMeta}>{name}={value}</div>)
              })()}
            </div>
            <div className={css.configCard}>
              <div className={css.detailName}>{t('wslGlobalConfigFile')}</div>
              <div className={css.detailMeta}>%UserProfile%\\.wslconfig</div>
              <div className={css.actions}>
                <Button variant="outline" size="sm" onClick={() => { void openLocation('wslconfig') }}>{t('openConfigLocation')}</Button>
                <Button variant="outline" size="sm" onClick={() => { void copyPath('%UserProfile%\\.wslconfig') }}>{copiedPath === '%UserProfile%\\.wslconfig' ? t('copied') : t('copyPath')}</Button>
              </div>
            </div>
            {otherDistros.length === 0 ? null : (
              <div className={css.configCard}>
                <div className={css.detailName}>{t('otherDistros')}</div>
                {otherDistros.map(distro => <div key={distro.name} className={css.detailMeta}>{distro.name} · {distro.state}</div>)}
              </div>
            )}
          </div>
        </DisclosureRow>
      ) : null}

      <DisclosureRow
        icon={<IconGlobeOutline14 size={16} />}
        title={t('configGroupAdvanced')}
        open={open.advanced}
        expandable
        expandOnRowClick
        onToggle={() => { toggle('advanced') }}
      >
        <div className={css.detailList}>
          <div className={css.configCard}>
            <div className={css.detailName}>{t('configDns')}</div>
            <div className={css.detailMeta}>{hasInspection ? dnsSummary(data, t) : t('unknownLabel')}</div>
            <Button variant="outline" size="sm" onClick={() => { void prepareOperation(isMac ? 'mac-flush-dns' : 'flush-dns') }}>{t('clearDnsCache')}</Button>
          </div>
          {isMac ? null : (
          <div className={css.configCard}>
            <div className={css.detailName}>{t('configWinHttp')}</div>
            {!hasInspection ? <div className={css.detailMeta}>{t('unknownLabel')}</div> : null}
            {winhttp.map(entry => (
              <div key={entry.scope} className={css.detailRow}>
                <span className={css.detailName}>{entry.scope === 'user' ? t('scopeUser') : t('scopeMachine')}</span>
                <span className={css.detailMeta}>{entry.proxyEnabled ? entry.proxy ?? t('currentEnabled') : 'DIRECT'}</span>
              </div>
            ))}
            {staleWinHttpUser ? <Button variant="outline" size="sm" onClick={() => { void prepareOperation('clear-winhttp-user-proxy') }}>{t('restoreDirect')}</Button> : null}
            {staleWinHttpMachine ? <Button variant="outline" size="sm" onClick={() => { void prepareOperation('reset-winhttp-machine-proxy') }}>{t('restoreDirect')}</Button> : null}
          </div>
          )}
          <div className={css.configCard}>
            <div className={css.detailName}>{t('configInterfacesRoutes')}</div>
            {!hasInspection ? <div className={css.detailMeta}>{t('unknownLabel')}</div> : null}
            {isMac && mac ? (
              <>
                {mac.network.interfaces.map(item => (
                  <div key={item.device} className={css.detailMeta}>{item.name} · {item.device} · {item.kind}</div>
                ))}
                {mac.network.gateway !== undefined ? <div className={css.detailMeta}>gateway: {mac.network.gateway} ({mac.network.gatewayInterface ?? '?'})</div> : null}
              </>
            ) : (
              activeInterfaces(data).map(item => (
                <div key={`${item.name}:${item.description}`} className={css.detailMeta}>{item.name} · {item.kind} · {item.ipv4.join(', ') || 'IPv4 -'} · gateway {item.gateways.join(', ') || '-'}</div>
              ))
            )}
          </div>
          <div className={css.configCard}>
            <div className={css.detailName}>{t('configHosts')}</div>
            {!hasInspection ? <div className={css.detailMeta}>{t('unknownLabel')}</div> : null}
            {hostsFor(data, graph).map(entry => <div key={entry.raw} className={css.detailMeta}>{entry.raw}</div>)}
            {(() => {
              const hostsPath = hostsPathFor(platformOf(data, graph))
              return (
                <div className={css.actions}>
                  <Button variant="outline" size="sm" onClick={() => { void openLocation('hosts') }}>{t('openConfigLocation')}</Button>
                  <Button variant="outline" size="sm" onClick={() => { void copyPath(hostsPath) }}>{copiedPath === hostsPath ? t('copied') : t('copyPath')}</Button>
                </div>
              )
            })()}
          </div>
          <AdvancedSection service={service} t={t} embedded />
        </div>
      </DisclosureRow>

      {notice === undefined ? null : <p className={css.successText}>{notice}</p>}
      {failure === undefined ? null : <p className={css.errorText} role="alert">{failure}</p>}

      <Modal
        open={pending !== null}
        onClose={() => { if (!busy) setPending(null) }}
        title={pending?.operation.label ?? ''}
        closeLabel={t('close')}
        description={pending?.operation.description}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setPending(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void applyPending() }}>{busy ? t('applying') : t('confirmApply')}</Button>
          </>
        )}
      >
        <div className={css.detailList}>
          {pending?.operation === undefined ? null : (
            <MetaBadges labels={[
              pending.operation.scope,
              ...(pending.operation.requiresAdmin ? [t('advancedAdmin')] : []),
              ...(pending.operation.requiresReboot ? [t('advancedReboot')] : []),
              pending.operation.recoverable ? t('advancedRecoverable') : t('advancedNotRecoverable'),
            ]} />
          )}
          {pending?.preview?.scopeDescription === undefined ? null : <div className={css.technical}>{pending.preview.scopeDescription}</div>}
          {pending?.advanced !== undefined ? (
            <div className={css.technical}>
              {pending.advanced.purpose}
              <div>{pending.advanced.requiresAdmin ? t('advancedAdmin') : t('advancedNoAdmin')} · {pending.advanced.requiresReboot ? t('advancedReboot') : t('advancedNoReboot')} · {pending.advanced.recoverable ? t('advancedRecoverable') : t('advancedNotRecoverable')}</div>
            </div>
          ) : null}
          {pending?.preview?.diffText.length === 0 ? <p className={css.muted}>{t('noChanges')}</p> : pending?.preview?.diffText.map(line => <div key={line} className={css.technical}>{line}</div>)}
        </div>
      </Modal>
    </div>
  )
}

function emptyInspection(): NetworkInspection {
  return {
    runtime: { platform: 'unknown', version: '' },
    dsh: {},
    modelServices: [],
    windows: emptyWindows(),
    probes: [],
    timestamp: '',
  }
}

function emptyWindows(): NonNullable<NetworkInspection['windows']> {
  return {
    network: { interfaces: [], defaultRoutes: [] },
    proxy: { wininet: { enabled: false, autoDetect: false }, winhttp: [], endpoints: [] },
    environment: { scopes: { process: {}, user: {}, machine: {}, dsh: {} } },
    hosts: { overrides: [] },
    listeners: [],
  }
}

function pacSummary(wininet: NonNullable<NetworkInspection['windows']>['proxy']['wininet'], t: T): string {
  if (wininet.autoConfigUrl !== undefined && wininet.autoConfigUrl !== '') return `PAC · ${wininet.autoConfigUrl}`
  if (wininet.autoDetect) return t('pacAutoDetect')
  return t('currentDisabled')
}

function envEntries(env: Record<string, string | undefined> | undefined): Array<[string, string]> {
  if (env === undefined) return []
  const entries: Array<[string, string]> = []
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') entries.push([name, value.trim()])
  }
  return entries
}

function scopeLabel(scope: 'process' | 'user' | 'machine' | 'dsh'): NetworkLocaleKey {
  if (scope === 'process') return 'scopeProcess'
  if (scope === 'user') return 'scopeUser'
  if (scope === 'machine') return 'scopeMachine'
  return 'scopeDsh'
}

function dshRuntimeLabel(graph: NetworkPathGraph | undefined, t: T): string {
  if (graph === undefined) return t('sourceUnknown')
  return runtimeDisplayLabel(graph)
}

function dnsSummary(inspection: NetworkInspection, t: T): string {
  const failed = inspection.probes.some(probe => Object.values(probe.layers).some(check => check?.status === 'error' && probe.layers.dns?.status === 'error'))
  const healthy = inspection.probes.some(probe => probe.layers.dns?.status === 'healthy')
  if (failed) return t('warningLabel')
  if (healthy) return t('healthyLabel')
  return t('notTestedLabel')
}

type WindowsFacts = NonNullable<NetworkInspection['windows']>

function activeInterfaces(inspection: NetworkInspection): WindowsFacts['network']['interfaces'] {
  return (inspection.windows?.network.interfaces ?? []).filter(item => item.status === 'up')
}

function hostsFor(inspection: NetworkInspection, graph: NetworkPathGraph | undefined): NonNullable<NetworkInspection['windows']>['hosts']['overrides'] {
  const overrides = inspection.windows?.hosts.overrides ?? []
  if (graph === undefined) return overrides.slice(0, 3)
  return overrides.filter(item => item.hostnames.includes(graph.target.host)).slice(0, 5)
}
