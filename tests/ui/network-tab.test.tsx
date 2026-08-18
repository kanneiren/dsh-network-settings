// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NetworkTab } from '../../src/client/NetworkTab.tsx'
import type { NetworkService, NetworkServiceSnapshot } from '../../src/client/service.ts'
import type { NetworkLocaleKey } from '../../src/client/locales.ts'

const zh: Record<NetworkLocaleKey, string> = {
  nav: '网络', title: '网络', intro: '查看 Windows、WSL 与 DSH 的网络状态，检测并定位常见网络问题。',
  run: '单次检测', runStability: '稳定性检测', running: '检测中…', cancel: '取消', notTested: '尚未检测', healthy: '网络正常',
  warning: '发现 {count} 个问题', problemCount: '{count} 个问题', interfaceCount: '{count} 个网络接口', error: '网络有问题', cached: '最近一次检测：{time}', viewDetails: '查看详情',
  hideDetails: '收起详情', copyReport: '复制诊断报告', copied: '已复制诊断报告', windows: 'Windows', wsl: 'WSL',
  proxy: '代理', dns: 'DNS', internet: '互联网', modelService: 'DSH 模型服务', healthyLabel: '正常',
  warningLabel: '有问题', errorLabel: '异常', unknownLabel: '未知', notApplicableLabel: '不适用', notTestedLabel: '未检测',
  diagnosisTitle: '诊断结果', windowsTitle: 'Windows 详情', wslTitle: 'WSL 详情', proxyTitle: '代理详情',
  probeTitle: '分层检测详情', probeAllHealthy: '全部层级正常', noDiagnosis: '没有发现已知网络问题。', endpointConfigured: '已配置',
  endpointListener: '监听进程', scopeProcess: 'Process', scopeUser: 'User', scopeMachine: 'Machine', scopeDsh: 'DSH Process',
  mode: '网络模式', stateRunning: '运行中', stateStopped: '未运行', copyFailed: '复制失败',
  environmentGroup: '环境与配置', connectivityGroup: '连通性', direct: '直连', proxyPath: '代理',
  conclusionHealthy: 'DSH 链路正常。', conclusionUnknown: 'DSH 链路状态未知。', conclusionProxyFailed: '代理端点 {label} 连接失败。', conclusionTargetFailedLocalOk: '目标 {label} 连接失败；本机到网关正常。', conclusionTargetFailed: '目标 {label} 连接失败。', conclusionEdgeFailed: '{label} 这一段失败。', interfaces: '网络接口',
  standbyHint: '打开页面不会执行系统命令或网络探测；点击一键检测后才会显示完整链路。',
  networkGraphTitle: '网络链路', currentTarget: '当前目标', problemAt: '问题出现在：', failureLayer: '失败层', failureMessage: '错误信息',
  egressTarget: '出口：见下方链路 · 目标：{target}',
  dnsDelegated: 'DNS 由代理侧解析',
  detailPathStatus: '链路状态', detailEgress: '出口', detailProxyEndpoint: '代理端点', detailEvidence: 'Evidence',
}

const t = (key: NetworkLocaleKey, params?: Record<string, string | number>): string => {
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replaceAll('{count}', String(params.count ?? '')).replaceAll('{mode}', String(params.mode ?? '')).replaceAll('{value}', String(params.value ?? ''))
}

class MockService implements NetworkService {
  listeners = new Set<() => void>()
  snapshot: NetworkServiceSnapshot
  runMock = vi.fn(async () => {})
  runTargetMock = vi.fn(async (_id: string) => {})
  runStabilityMock = vi.fn(async (_id?: string) => {})
  runWithPlanMock = vi.fn(async (_plan: 'single' | 'multi', _id?: string) => {})
  refreshMock = vi.fn(async () => {})
  cancelMock = vi.fn(() => {})
  previewMock = vi.fn(async (_request: any) => ({ scope: 'windows.wininet', scopeDescription: 'only wininet', before: {}, after: {}, diff: [], diffText: [], requiresElevation: false }))
  applyMock = vi.fn(async (_request: any) => ({ scope: 'windows.wininet', scopeDescription: 'only wininet', before: {}, after: {}, diff: [], diffText: [], requiresElevation: false, snapshotId: 's1', applied: true }))
  listMock = vi.fn(async () => [])
  repairPreviewMock = vi.fn(async (_action: any) => ({ supported: true, preview: { scope: 'dsh.process', scopeDescription: 'only dsh', before: {}, after: {}, diff: [], diffText: [], requiresElevation: false } }))
  repairApplyMock = vi.fn(async (_action: any) => ({ supported: true, result: { scope: 'dsh.process', scopeDescription: 'only dsh', before: {}, after: {}, diff: [], diffText: [], requiresElevation: false, snapshotId: 's2', applied: true } }))
  rollbackMock = vi.fn(async () => ({ snapshot: { id: 's1', timestamp: '2026-01-01T00:00:00.000Z', reason: 'test', scope: 'dsh.process', before: {}, reversible: true }, diff: [], diffText: [] }))
  advancedListMock = vi.fn(async () => [])
  advancedRunMock = vi.fn(async (_id: string) => ({ action: { id: 'flush-dns', label: 'Flush DNS', purpose: 'p', risk: 'low', requiresAdmin: false, requiresReboot: false, recoverable: true, command: 'ipconfig /flushdns' }, executedAt: '2026-01-01T00:00:00.000Z', code: 0, stdout: '', stderr: '' }))
  repairCatalogMock = vi.fn(async () => [])
  recommendedRepairsMock = vi.fn(async () => ({ recentlyAppliedIds: [], recommendations: [] }))
  previewRepairOperationMock = vi.fn(async (_id: string) => ({ operation: { id: 'clear-dsh-process-proxy', label: 'clear dsh', description: 'd', scope: 'dsh.process', risk: 'low', requiresAdmin: false, requiresReboot: false, recoverable: true, kind: 'configure' }, preview: { scope: 'dsh.process', scopeDescription: 'only dsh', before: {}, after: {}, diff: [], diffText: [], requiresElevation: false } }))
  applyRepairOperationMock = vi.fn(async (_id: string) => ({ operation: { id: 'clear-dsh-process-proxy', label: 'clear dsh', description: 'd', scope: 'dsh.process', risk: 'low', requiresAdmin: false, requiresReboot: false, recoverable: true, kind: 'configure' }, result: { scope: 'dsh.process', scopeDescription: 'only dsh', before: {}, after: {}, diff: [], diffText: [], requiresElevation: false, snapshotId: 's2', applied: true } }))
  wslSourcesMock = vi.fn(async () => [])
  wslPreviewMock = vi.fn(async (_source: any) => ({ distribution: 'd', file: 'f', line: 1, raw: 'x', scopeDescription: 's', diffText: [] }))
  wslApplyMock = vi.fn(async (_source: any) => ({ distribution: 'd', file: 'f', line: 1, raw: 'x', scopeDescription: 's', diffText: [], snapshotId: 's3' }))
  hostsEntriesMock = vi.fn(async () => [])
  hostsPreviewMock = vi.fn(async (_entry: any) => ({ entry: { id: 'hosts:1', ip: '127.0.0.1', hostnames: ['x'], line: 1, raw: '127.0.0.1 x' }, scopeDescription: 'only hosts', diffText: [] }))
  hostsApplyMock = vi.fn(async (_entry: any) => ({ entry: { id: 'hosts:1', ip: '127.0.0.1', hostnames: ['x'], line: 1, raw: '127.0.0.1 x' }, scopeDescription: 'only hosts', diffText: [], snapshotId: 's4' }))

  constructor(snapshot: NetworkServiceSnapshot) { this.snapshot = snapshot }

  getSnapshot(): NetworkServiceSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  publish(next: Partial<NetworkServiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }
  refreshStatus(): Promise<void> { return this.refreshMock() }
  run(): Promise<void> { return this.runMock() }
  runTarget(id: string): Promise<void> { return this.runTargetMock(id) }
  runStability(id?: string): Promise<void> { return this.runStabilityMock(id) }
  runWithPlan(plan: 'single' | 'multi', id?: string): Promise<void> { return this.runWithPlanMock(plan, id) }
  cancel(): void { this.cancelMock() }
  previewConfigure(request: any): Promise<any> { return this.previewMock(request) }
  applyConfigure(request: any): Promise<any> { return this.applyMock(request) }
  listSnapshots(): Promise<any[]> { return this.listMock() }
  repairPreview(action: any): Promise<any> { return this.repairPreviewMock(action) }
  repairApply(action: any): Promise<any> { return this.repairApplyMock(action) }
  rollbackLatest(): Promise<any> { return this.rollbackMock() }
  advancedList(): Promise<any[]> { return this.advancedListMock() }
  advancedRun(id: string): Promise<any> { return this.advancedRunMock(id) }
  repairCatalog(): Promise<any[]> { return this.repairCatalogMock() }
  recommendedRepairs(_actions: any[]): Promise<any[]> { return this.recommendedRepairsMock() }
  previewRepairOperation(id: string): Promise<any> { return this.previewRepairOperationMock(id) }
  applyRepairOperation(id: string): Promise<any> { return this.applyRepairOperationMock(id) }
  wslProxySources(_distribution: string): Promise<any[]> { return this.wslSourcesMock() }
  previewWslProxySource(source: any): Promise<any> { return this.wslPreviewMock(source) }
  applyWslProxySource(source: any): Promise<any> { return this.wslApplyMock(source) }
  hostsEntries(): Promise<any[]> { return this.hostsEntriesMock() }
  previewHostsDelete(entry: any): Promise<any> { return this.hostsPreviewMock(entry) }
  applyHostsDelete(entry: any): Promise<any> { return this.hostsApplyMock(entry) }
}

function baseInspection(): any {
  return {
    runtime: { platform: 'win32', version: 'v22.23.2' },
    windows: {
      os: { caption: 'Windows', version: '10', build: '26100', architecture: 'x64' },
      network: { interfaces: [{ name: 'WLAN', description: 'Intel Wi-Fi', status: 'up', virtual: false, kind: 'wi-fi', ipv4: ['192.168.1.2'], ipv6: [], gateways: ['192.168.1.1'], dns: ['192.168.1.1'] }], defaultRoutes: [] },
      proxy: { wininet: { enabled: false, autoDetect: false }, winhttp: [], endpoints: [] },
      environment: { scopes: { process: {}, user: {}, machine: {}, dsh: {} } },
      hosts: { overrides: [] },
      listeners: [],
      dshProcessEnvironment: {},
      modelServices: [],
    },
    wsl: { available: true, distributions: [{ name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false }] },
    probes: [],
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

describe('NetworkTab', () => {
  // No vitest globals: without this, renders leak across tests in this file.
  afterEach(cleanup)

  it('renders the not-tested state and the primary action', () => {
    const service = new MockService({ phase: 'idle' })
    render(<NetworkTab service={service} t={t} />)
    expect(screen.getByText('尚未检测')).toBeTruthy()
    expect(screen.getByText('单次检测')).toBeTruthy()
  })

  it('renders loading and cancel actions', async () => {
    const service = new MockService({ phase: 'loading' })
    render(<NetworkTab service={service} t={t} />)
    expect(screen.getByText('检测中…')).toBeTruthy()
    fireEvent.click(screen.getByText('取消'))
    expect(service.cancelMock).toHaveBeenCalledOnce()
  })

  it('renders diagnosis, status rows and details for a ready report', () => {
    const inspection = baseInspection()
    const service = new MockService({
      phase: 'ready',
      inspection,
      diagnosis: {
        worst: 'error',
        problemCount: 1,
        diagnoses: [{
          code: 'TLS_FAILURE', severity: 'error', confidence: 0.95, scope: 'tls',
          humanMessage: '有 1 个目标的 TCP 连接正常，但 TLS 握手失败',
          technicalMessage: 'github.com: certificate expired',
          evidence: [{ ref: 'probe:github:tls', message: 'TLS 失败', status: 'error' }],
          actions: [],
        }],
      },
      summary: {
        model: 'WINDOWS_NATIVE',
        target: { id: 'github', label: 'GitHub', host: 'github.com', port: 443, url: 'https://github.com', kind: 'github', display: 'github.com:443' },
        dsh: { status: 'error', label: 'DSH' }, problemCount: 1,
      },
    })
    render(<NetworkTab service={service} t={t} />)
    expect(screen.getByText('网络链路')).toBeTruthy()
    fireEvent.click(screen.getAllByText('诊断结果')[0]!)
    expect(screen.getByText('有 1 个目标的 TCP 连接正常，但 TLS 握手失败')).toBeTruthy()
    expect(screen.getByText('TLS_FAILURE')).toBeTruthy()
  })

  it('shows an RPC error without crashing the rest of the page', () => {
    const service = new MockService({ phase: 'error', error: 'RPC failed' })
    render(<NetworkTab service={service} t={t} />)
    expect(screen.getByText('RPC failed')).toBeTruthy()
  })

  it('shows the target switcher in the cached state and defaults to DeepSeek', () => {
    const npmTarget = { id: 'npm-registry', label: 'npm Registry', host: 'registry.npmjs.org', port: 443, url: 'https://registry.npmjs.org', kind: 'npm-registry' as const, display: 'registry.npmjs.org:443' }
    const deepseekTarget = { id: 'deepseek', label: 'DeepSeek', host: 'api.deepseek.com', port: 443, url: 'https://api.deepseek.com', kind: 'deepseek' as const, display: 'api.deepseek.com:443' }
    const service = new MockService({
      phase: 'idle',
      cached: {
        timestamp: '2026-08-18T20:43:40.000Z',
        diagnosis: { worst: 'healthy', problemCount: 0, diagnoses: [] },
        summary: { model: 'WINDOWS_NATIVE', target: npmTarget, dsh: { status: 'healthy', label: 'DSH' }, problemCount: 0 },
      },
      targets: [deepseekTarget, npmTarget],
    })
    render(<NetworkTab service={service} t={t} />)
    // The switcher is visible and defaults to DeepSeek, not the stale cached npm target.
    expect(screen.getByText('DeepSeek · api.deepseek.com:443')).toBeTruthy()
    fireEvent.click(screen.getByText('单次检测'))
    expect(service.runTargetMock).toHaveBeenCalledWith('deepseek')
  })
})
