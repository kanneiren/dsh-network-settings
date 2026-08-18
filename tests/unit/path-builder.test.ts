import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { LayeredProbe, NetworkInspection, ProbeCheck } from '../../src/host/model.ts'
import { buildWindowsNativeDshPath } from '../../src/host/network/build-windows.ts'
import { buildWslDshPath } from '../../src/host/network/build-wsl.ts'
import { detectDrift } from '../../src/host/network/drift.ts'
import type { GraphSurvey } from '../../src/host/network/survey.ts'
import type { NetworkPathGraph, NetworkTarget, WindowsNativeRuntime, WslDistributionRuntime } from '../../src/host/network/types.ts'

const target: NetworkTarget = {
  id: 'deepseek', label: 'DeepSeek', host: 'api.deepseek.com', port: 443,
  url: 'https://api.deepseek.com', kind: 'deepseek', display: 'api.deepseek.com:443',
}

function check(status: ProbeCheck['status'], source: string, details: Record<string, unknown> = {}): ProbeCheck {
  return { status, humanMessage: source, source, timestamp: '2026-01-01T00:00:00.000Z', details }
}

function directHealthyProbe(): LayeredProbe {
  return {
    target: { id: target.id, label: target.label, host: target.host, port: 443, url: target.url, kind: 'deepseek' },
    path: 'direct',
    layers: {
      dns: check('healthy', 'node:dns', { addresses: ['104.18.12.34'] }),
      tcp: check('healthy', 'node:net', { host: target.host, port: 443 }),
      tls: check('healthy', 'node:tls'),
      http: check('healthy', 'node:fetch'),
    },
  }
}

function proxyFailedProbe(): LayeredProbe {
  return {
    target: { id: target.id, label: target.label, host: target.host, port: 443, url: target.url, kind: 'deepseek' },
    path: 'proxy',
    layers: {
      dns: check('not-applicable', 'delegated'),
      tcp: check('error', 'node:net', { host: '127.0.0.1', port: 7890 }),
      tls: check('not-tested', 'skipped'),
      http: check('not-tested', 'skipped'),
    },
  }
}

function windowsInspection(dshEnv: Record<string, string | undefined>, listeners: NetworkInspection['windows']['listeners'] = []): NetworkInspection {
  return {
    runtime: { platform: 'win32', version: 'v22.19.0' },
    windows: {
      os: { caption: 'Windows 11', version: '10.0', build: '26100', architecture: 'x64' },
      network: {
        interfaces: [{ name: 'WLAN', description: 'Intel Wi-Fi', status: 'up', virtual: false, kind: 'wi-fi', ipv4: ['192.168.1.101'], ipv6: [], gateways: ['192.168.1.1'], dns: ['192.168.1.1'] }],
        defaultRoutes: [{ family: 4, destination: '0.0.0.0/0', nextHop: '192.168.1.1', interfaceIndex: 1, metric: 25 }],
      },
      proxy: { wininet: { enabled: false, autoDetect: false }, winhttp: [], endpoints: [] },
      environment: { scopes: { process: {}, user: {}, machine: {}, dsh: dshEnv } },
      hosts: { overrides: [] },
      listeners,
      dshProcessEnvironment: dshEnv,
      modelServices: [],
      rawErrors: [],
    },
    probes: [],
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

function windowsRuntime(): WindowsNativeRuntime {
  return { type: 'WINDOWS_NATIVE', platform: 'win32', nodeVersion: 'v22.19.0', confidence: 'verified' }
}

function windowsSurvey(inspection: NetworkInspection): GraphSurvey {
  return { runtime: windowsRuntime(), inspection, target }
}

function graphFrom(survey: GraphSurvey): NetworkPathGraph {
  const built = buildWindowsNativeDshPath(survey)
  const graph: NetworkPathGraph = {
    model: 'WINDOWS_NATIVE', runtime: windowsRuntime(), target,
    dshPath: built.path, diagnostics: [], generatedAt: 'now',
  }
  const diagnostics = detectDrift(graph, survey)
  return { ...graph, diagnostics }
}

describe('Windows native DSH path builder', () => {
  it('builds a healthy direct path from an actual probe', () => {
    const inspection = { ...windowsInspection({}), probes: [directHealthyProbe()] }
    const built = buildWindowsNativeDshPath(windowsSurvey(inspection))
    assert.equal(built.path.status, 'healthy')
    assert.equal(built.path.egress.mode, 'DIRECT')
    assert.ok(built.path.nodes.some(node => node.type === 'INTERFACE'))
    assert.equal(built.path.dns[0]?.resolvedAddresses[0], '104.18.12.34')
  })

  it('marks a broken DSH proxy as first failing edge and detects drift', () => {
    const inspection = { ...windowsInspection({ HTTPS_PROXY: 'http://127.0.0.1:7890' }), probes: [proxyFailedProbe()] }
    const graph = graphFrom(windowsSurvey(inspection))
    assert.equal(graph.dshPath.status, 'error')
    assert.equal(graph.dshPath.firstFailingEdgeId, 'dsh:host->dsh:proxy')
    assert.ok(graph.diagnostics.some(item => item.code === 'DRIFT_DSH_PROXY_STALE'))
  })

  it('chains the physical uplink behind a TUN/VPN egress adapter', () => {
    const base = windowsInspection({})
    const inspection = {
      ...base,
      windows: {
        ...base.windows,
        network: {
          interfaces: [
            { name: 'BoostNet', description: 'BoostNet TUN', status: 'up' as const, virtual: true, kind: 'vpn' as const, ipv4: ['198.18.0.1'], ipv6: [], gateways: ['198.18.0.2'], dns: [], interfaceIndex: 5 },
            { name: 'WLAN', description: 'Intel Wi-Fi', status: 'up' as const, virtual: false, kind: 'wi-fi' as const, ipv4: ['192.168.31.236'], ipv6: [], gateways: ['192.168.31.1'], dns: ['192.168.31.1'], interfaceIndex: 12 },
          ],
          defaultRoutes: [
            { family: 4 as const, destination: '0.0.0.0/0', nextHop: '198.18.0.2', interfaceIndex: 5, metric: 1 },
            { family: 4 as const, destination: '0.0.0.0/0', nextHop: '192.168.31.1', interfaceIndex: 12, metric: 30 },
          ],
        },
      },
      probes: [directHealthyProbe()],
    }
    const built = buildWindowsNativeDshPath(windowsSurvey(inspection))
    const nodeById = new Map(built.path.nodes.map(node => [node.id, node]))
    assert.equal(nodeById.get('dsh:adapter')?.address, '198.18.0.1')
    assert.equal(nodeById.get('dsh:uplink')?.address, '192.168.31.236')
    assert.equal(nodeById.get('dsh:gateway')?.address, '192.168.31.1')
    assert.equal(nodeById.get('dsh:host')?.address, '192.168.31.236')
    assert.ok(built.path.edges.some(edge => edge.from === 'dsh:adapter' && edge.to === 'dsh:uplink'))
    assert.ok(built.path.edges.some(edge => edge.from === 'dsh:uplink' && edge.to === 'dsh:gateway'))
  })
})

function wslRuntime(): WslDistributionRuntime {
  return {
    type: 'WSL_DISTRIBUTION', confidence: 'verified', registeredName: 'Ubuntu-24.04',
    displayName: 'Ubuntu 24.04.4 LTS',
    linux: { id: 'ubuntu', prettyName: 'Ubuntu 24.04.4 LTS', versionId: '24.04', kernelRelease: 'microsoft-standard-WSL2' },
    wslVersion: 2,
    networkLayer: { mode: 'NAT', modeConfigured: false, dnsTunneling: true, autoProxy: true },
    interopAvailable: true,
  }
}

function wslInspection(): NetworkInspection {
  const base = windowsInspection({ HTTPS_PROXY: 'http://172.28.96.1:7890' }, [{ address: '127.0.0.1', port: 7890, pid: 12345, processName: 'mihomo.exe' }])
  return {
    ...base,
    windows: { ...base.windows, dshProcessEnvironment: { HTTPS_PROXY: 'http://172.28.96.1:7890' } },
    wsl: {
      available: true,
      version: '2.7.10',
      globalConfig: { mode: 'nat', modeConfigured: false, modeSupported: true },
      distributions: [{
        name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: true,
        osMetadata: { id: 'ubuntu', prettyName: 'Ubuntu 24.04.4 LTS', versionId: '24.04' },
        network: {
          hostCandidates: [{ address: '172.28.96.1', source: 'default-route', confidence: 0.8 }],
          resolvConf: ['10.255.255.254'],
          defaultRoute: '172.28.96.1',
          interfaces: [{ name: 'eth0', ipv4: ['172.28.101.23'], ipv6: [] }],
          environment: { HTTPS_PROXY: 'http://172.28.96.1:7890' },
        },
      }],
      rawErrors: [],
    },
  }
}

describe('WSL DSH path builder and drift', () => {
  it('builds distribution → WSL NAT → Windows Host → broken proxy and detects WSL drift', () => {
    const inspection = wslInspection()
    const hostProbe: LayeredProbe = {
      target: { id: 'wsl:Ubuntu-24.04:host:default-route', label: 'host', host: '172.28.96.1', port: 443, kind: 'windows-host' },
      path: 'direct', layers: { tcp: check('healthy', 'wsl:tcp') },
    }
    const proxyProbe: LayeredProbe = {
      target: { id: 'wsl:Ubuntu-24.04:proxy-endpoint', label: 'proxy', host: '172.28.96.1', port: 7890, kind: 'wsl-proxy' },
      path: 'proxy', layers: { tcp: check('error', 'wsl:tcp', { host: '172.28.96.1', port: 7890 }), http: check('not-tested', 'skipped') },
    }
    const survey: GraphSurvey = {
      runtime: wslRuntime(),
      inspection: { ...inspection, probes: [hostProbe, proxyProbe] },
      target,
    }
    const built = buildWslDshPath(survey)
    assert.equal(built.path.status, 'error')
    assert.equal(built.path.firstFailingEdgeId, 'dsh:host->dsh:proxy')
    const graph: NetworkPathGraph = {
      model: 'WSL_DISTRIBUTION', runtime: wslRuntime(), target,
      dshPath: built.path, diagnostics: [], generatedAt: 'now',
    }
    const drift = detectDrift(graph, survey)
    assert.ok(drift.some(item => item.code === 'DRIFT_WSL_PROXY_STALE'))
  })
})
