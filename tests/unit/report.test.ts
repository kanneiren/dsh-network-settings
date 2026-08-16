import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnosticReport } from '../../src/client/report.ts'
import { zh, type NetworkLocaleKey } from '../../src/client/locales.ts'

const t = (key: NetworkLocaleKey, params?: Record<string, string | number>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replaceAll('{count}', String(params.count ?? '')).replaceAll('{step}', String(params.step ?? ''))
}

const inspection = {
  runtime: { platform: 'win32', version: 'v22' },
  windows: {
    os: { caption: 'Windows 11', version: '10.0.26100', build: '26100', architecture: 'x64' },
    network: { interfaces: [{ name: 'WLAN', description: 'Wi-Fi', status: 'up', virtual: false, kind: 'wi-fi', ipv4: ['192.168.1.2'], ipv6: [], gateways: ['192.168.1.1'], dns: ['192.168.1.1'] }], defaultRoutes: [] },
    proxy: { wininet: { enabled: true, proxyServer: '127.0.0.1:7890', autoDetect: false }, winhttp: [], endpoints: [] },
    environment: { scopes: { process: {}, user: {}, machine: {}, dsh: { HTTPS_PROXY: 'http://127.0.0.1:7890' } } },
    hosts: { overrides: [] },
    listeners: [],
    dshProcessEnvironment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
    modelServices: [],
  },
  wsl: { available: false, distributions: [] },
  probes: [{ target: { id: 'github', label: 'GitHub', host: 'github.com', port: 443, kind: 'github' }, path: 'direct', layers: { tcp: { status: 'error', humanMessage: 'tcp failed', technicalMessage: 'ECONNREFUSED', source: 'node:net', timestamp: '2026-01-01T00:00:00.000Z' } } }],
  timestamp: '2026-01-01T00:00:00.000Z',
} as any

describe('agent-friendly diagnostic report', () => {
  it('renders markdown sections and deterministic details instead of raw JSON', () => {
    const report = buildDiagnosticReport(inspection, {
      worst: 'error', problemCount: 1,
      diagnoses: [{ code: 'TLS_FAILURE', severity: 'error', confidence: 0.95, scope: 'tls', humanMessage: 'TLS 失败', technicalMessage: 'certificate expired', evidence: [{ ref: 'x', message: 'y', status: 'error' }], actions: [] }],
    }, t)
    assert.match(report, /^# DSH 网络诊断报告/)
    assert.match(report, /## 诊断/)
    assert.match(report, /TLS_FAILURE/)
    assert.match(report, /## Windows/)
    assert.match(report, /WLAN/)
    assert.match(report, /ECONNREFUSED/)
    assert.doesNotMatch(report, /"diagnosis"/)
  })
})
