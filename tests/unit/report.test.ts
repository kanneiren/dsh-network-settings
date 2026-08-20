import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnosticReport } from '../../src/client/report.ts'

const inspection = {
  runtime: { platform: 'win32', version: 'v22' },
  windows: {
    os: { caption: 'Windows 11', version: '10.0.26100', build: '26100', architecture: 'x64' },
    network: {
      interfaces: [
        { name: 'WLAN', description: 'Wi-Fi', status: 'up', virtual: false, kind: 'wi-fi', ipv4: ['192.168.1.2'], ipv6: [], gateways: ['192.168.1.1'], dns: ['192.168.1.1'] },
        { name: '以太网 2', description: 'VirtualBox Host-Only', status: 'down', virtual: true, kind: 'virtualbox', ipv4: [], ipv6: [], gateways: [], dns: [] },
      ],
      defaultRoutes: [{ family: 4, destination: '0.0.0.0/0', nextHop: '192.168.1.1', interfaceIndex: 1, metric: 25 }],
    },
    proxy: {
      wininet: { enabled: true, proxyServer: '127.0.0.1:7890', autoDetect: false },
      winhttp: [],
      endpoints: [
        { id: 'proxy:127.0.0.1:7890', source: 'wininet.user', host: '127.0.0.1', port: 7890, url: 'http://127.0.0.1:7890', configured: true, state: 'UNREACHABLE', listener: { address: '127.0.0.1', port: 7890, state: 'NOT_FOUND' } },
      ],
    },
    environment: {
      scopes: {
        process: {},
        user: { HTTPS_PROXY: 'http://127.0.0.1:7890', http_proxy: 'http://127.0.0.1:7890' },
        machine: {},
        dsh: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      },
    },
    hosts: { overrides: [] },
    listeners: [],
  },
  dsh: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
  modelServices: [],
  wsl: {
    available: true,
    version: '2.7.10',
    globalConfig: { mode: 'nat', modeConfigured: false, modeSupported: true, autoProxy: true, dnsTunneling: true },
    distributions: [{
      name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: true,
      network: {
        hostCandidates: [{ address: '172.28.96.1', source: 'default-route', confidence: 0.8 }],
        resolvConf: ['10.255.255.254'],
        defaultRoute: '172.28.96.1',
        interfaces: [{ name: 'eth0', ipv4: ['172.28.101.23'], ipv6: [] }],
        environment: { https_proxy: 'http://172.28.96.1:7890' },
      },
    }],
    rawErrors: [],
  },
  probes: [
    {
      target: { id: 'github', label: 'GitHub', host: 'github.com', port: 443, kind: 'github' },
      path: 'direct',
      layers: {
        dns: { status: 'healthy', humanMessage: 'ok', source: 'node:dns', timestamp: '2026-01-01T00:00:00.000Z', latencyMs: 12, addresses: ['1.2.3.4'] },
        tcp: { status: 'error', humanMessage: 'tcp failed', technicalMessage: 'ECONNREFUSED', source: 'node:net', timestamp: '2026-01-01T00:00:00.000Z' },
      },
    },
  ],
  timestamp: '2026-01-01T00:00:00.000Z',
} as any

const graph = {
  model: 'WINDOWS_NATIVE',
  runtime: { type: 'WINDOWS_NATIVE', platform: 'win32', nodeVersion: 'v22', confidence: 'verified' },
  target: { id: 'github', label: 'GitHub', host: 'github.com', port: 443, kind: 'github', display: 'github.com:443' },
  dshPath: {
    id: 'dsh', label: '链路', status: 'error',
    egress: { mode: 'DIRECT' },
    nodes: [
      { id: 'dsh:process', type: 'PROCESS', role: 'main', label: 'DSH', status: 'healthy' },
      { id: 'dsh:host', type: 'HOST', role: 'main', label: 'Windows', address: '192.168.1.2', status: 'healthy' },
      { id: 'dsh:adapter', type: 'INTERFACE', role: 'main', label: 'Wi-Fi', address: '192.168.1.2', status: 'unknown', evidence: [{ source: 'WINDOWS_ROUTE', confidence: 'inferred', value: 'x' }] },
      { id: 'dsh:target', type: 'TARGET', role: 'main', label: 'github.com:443', status: 'error' },
    ],
    edges: [
      { from: 'dsh:host', to: 'dsh:adapter', relation: 'ROUTE', status: 'unknown', label: '默认路由 · metric 25' },
      { from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION', status: 'error', label: 'TCP 失败' },
    ],
    dns: [{ id: 'dsh:dns', host: 'github.com', resolvedAddresses: ['1.2.3.4'], status: 'healthy', resolution: 'LOCAL' }],
    firstFailingEdgeId: 'dsh:internet->dsh:target',
  },
  diagnostics: [{ code: 'DSH_PATH_FAILED', severity: 'error', confidence: 0.95, pathIds: ['dsh'], humanMessage: 'DSH 链路失败', technicalMessage: 'tcp', evidence: [], actions: [] }],
  recommendedRepair: { diagnosisCode: 'DSH_PATH_FAILED', actionCodes: ['repair-tls'], label: '检查 TLS' },
  generatedAt: '2026-01-01T00:00:00.000Z',
} as any

const summary = {
  model: 'WINDOWS_NATIVE',
  target: { id: 'github', label: 'GitHub', host: 'github.com', port: 443, kind: 'github', display: 'github.com:443' },
  dsh: { status: 'error', label: 'DSH' },
  problemCount: 1,
} as any

const diagnosis = {
  worst: 'error', problemCount: 1,
  diagnoses: [{
    code: 'TLS_FAILURE', severity: 'error', confidence: 0.95, scope: 'tls',
    humanMessage: 'TLS 失败', technicalMessage: 'certificate expired',
    evidence: [{ ref: 'probe:github:tls', message: 'y', status: 'error' }],
    actions: [{ code: 'repair-tls', scope: 'tls', label: '检查 TLS', safe: true }],
  }],
} as any

describe('agent-friendly diagnostic report', () => {
  it('renders fixed English headers, version and TL;DR first', () => {
    const report = buildDiagnosticReport(inspection, diagnosis, graph, summary)
    assert.match(report, /^# DSH Network Diagnostic Report/)
    assert.match(report, /- report-version: 1/)
    const tldr = report.indexOf('## TL;DR')
    assert.ok(tldr > 0)
    assert.match(report.slice(tldr, tldr + 400), /- runtime: WINDOWS_NATIVE · Windows 11 build 26100/)
    assert.match(report.slice(tldr, tldr + 400), /- dsh-path: error · target: GitHub · github\.com:443/)
    assert.match(report, /## TL;DR/)
    assert.match(report, /## DSH Path/)
    assert.match(report, /## Diagnoses/)
    assert.match(report, /## Windows/)
    assert.match(report, /## Proxy/)
    assert.match(report, /## WSL/)
    assert.match(report, /## Probes/)
  })

  it('includes probe latency, target ids and per-layer failures', () => {
    const report = buildDiagnosticReport(inspection, diagnosis, graph, summary)
    assert.match(report, /- github \[direct\] GitHub/)
    assert.match(report, /dns:healthy\(12ms\)/)
    assert.match(report, /tcp:error/)
    assert.match(report, /ECONNREFUSED/)
  })

  it('includes the proxy endpoint table with listener state and full env vars', () => {
    const report = buildDiagnosticReport(inspection, diagnosis, graph, summary)
    assert.match(report, /- wininet\.user 127\.0\.0\.1:7890 · configured · listener: NOT_FOUND · UNREACHABLE/)
    assert.match(report, /- env user: HTTPS_PROXY=http:\/\/127\.0\.0\.1:7890, http_proxy=http:\/\/127\.0\.0\.1:7890/)
    assert.match(report, /- env machine: \(no proxy variables\)/)
    assert.match(report, /- DSH process: HTTPS_PROXY=http:\/\/127\.0\.0\.1:7890/)
  })

  it('chains readable edges, evidence marks and a readable first failure', () => {
    const report = buildDiagnosticReport(inspection, diagnosis, graph, summary)
    assert.match(report, /- unknown ROUTE Windows → Wi-Fi · 默认路由 · metric 25/)
    assert.match(report, /- error TARGET_CONNECTION .* → github\.com:443 · TCP 失败/)
    assert.match(report, /INTERFACE Wi-Fi 192\.168\.1\.2 · inferred/)
    assert.match(report, /- first-failure: .* → github\.com:443 · TCP 失败 \(error\)/)
    assert.match(report, /- dns: github\.com → 1\.2\.3\.4 · LOCAL · healthy/)
  })

  it('collapses down adapters and keeps WSL details including host candidates', () => {
    const report = buildDiagnosticReport(inspection, diagnosis, graph, summary)
    assert.match(report, /- adapters down \(1\): 以太网 2 \(virtualbox\)/)
    assert.doesNotMatch(report, /adapters down[\s\S]*IPv4/)
    assert.match(report, /- Ubuntu-24\.04: running WSL2/)
    assert.match(report, /  env: https_proxy=http:\/\/172\.28\.96\.1:7890/)
    assert.match(report, /  host candidates: 172\.28\.96\.1 \(default-route\)/)
  })

  it('renders a diagnosis-only briefing without an inspection', () => {
    const report = buildDiagnosticReport(undefined, diagnosis)
    assert.match(report, /^# DSH Network Diagnostic Report/)
    assert.match(report, /- runtime: unknown/)
    assert.match(report, /TLS_FAILURE/)
    assert.doesNotMatch(report, /## Windows/)
    assert.doesNotMatch(report, /## Probes/)
  })

  it('truncates oversized technical lines', () => {
    const long = { ...diagnosis, diagnoses: [{ ...diagnosis.diagnoses[0], technicalMessage: 'x'.repeat(600) }] }
    const report = buildDiagnosticReport(inspection, long as any)
    assert.doesNotMatch(report, /x{400,}/)
  })
})
