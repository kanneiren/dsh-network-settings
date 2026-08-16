import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type {
  EnvironmentScopeSnapshot, LayeredProbe, ProbeCheck, ProbeTarget, ProxyEndpoint,
  WindowsInspection, WslDistribution, WslInspection,
} from '../../src/host/model.ts'
import type { DiagnosisInput } from '../../src/host/diagnose/model.ts'
import {
  ruleDnsFailure, ruleEnvScopeConflict, ruleHostsOverride, ruleProxyConfiguredButUnusable,
  ruleProxyEndpointUnreachable, ruleStaleDshProxyEnv, ruleTlsFailure, ruleWslAutoProxyStale,
  ruleWslProxyUnreachable, runDiagnosis,
} from '../../src/host/diagnose/rules.ts'

function probe(
  id: string,
  host: string,
  path: 'direct' | 'proxy',
  layers: Partial<LayeredProbe['layers']>,
  kind: ProbeTarget['kind'] = 'internet',
  port = 443,
): LayeredProbe {
  return { target: { id, label: host, host, port, kind }, path, layers }
}

function check(status: ProbeCheck['status'], message: string = status, details: Record<string, unknown> = {}): ProbeCheck {
  return {
    status,
    humanMessage: message,
    source: 'fixture',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...details === undefined ? {} : { details },
  }
}

function endpoint(source: ProxyEndpoint['source'], host = '127.0.0.1', port = 7890): ProxyEndpoint {
  return { source, url: `http://${host}:${port}`, host, port, protocol: 'http', configured: true }
}

function baseWindows(overrides: Partial<WindowsInspection> = {}): WindowsInspection {
  return {
    network: { interfaces: [], defaultRoutes: [] },
    proxy: { wininet: { enabled: false, autoDetect: false }, winhttp: [], endpoints: [] },
    environment: { scopes: { process: {}, user: {}, machine: {}, dsh: {} } },
    hosts: { overrides: [] },
    listeners: [],
    dshProcessEnvironment: {},
    modelServices: [],
    rawErrors: [],
    ...overrides,
  }
}

function wslWith(distro: Partial<WslDistribution>): WslInspection {
  return {
    available: true,
    distributions: [{ name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false, ...distro }],
    rawErrors: [],
  }
}

function input(windows: WindowsInspection, probes: LayeredProbe[], wsl?: WslInspection, endpoints: ProxyEndpoint[] = []): DiagnosisInput {
  return { windows, probes, ...wsl === undefined ? {} : { wsl }, endpoints }
}

describe('ruleProxyEndpointUnreachable', () => {
  it('fires when a configured endpoint has an error TCP probe', () => {
    const ep = endpoint('wininet.user')
    const result = ruleProxyEndpointUnreachable(input(baseWindows(), [probe('github-proxy', 'github.com', 'proxy', {
      tcp: check('error', 'connection refused', { host: '127.0.0.1', port: 7890 }),
    })], undefined, [ep]))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'PROXY_ENDPOINT_UNREACHABLE')
    assert.equal(result[0]?.severity, 'error')
  })

  it('does not fire when the endpoint has a healthy TCP probe', () => {
    const ep = endpoint('wininet.user')
    const result = ruleProxyEndpointUnreachable(input(baseWindows(), [probe('github-proxy', 'github.com', 'proxy', {
      tcp: check('healthy', 'ok', { host: '127.0.0.1', port: 7890 }),
    })], undefined, [ep]))
    assert.equal(result.length, 0)
  })

  it('does not fire for endpoints that were not probed', () => {
    const ep = endpoint('env.user')
    const result = ruleProxyEndpointUnreachable(input(baseWindows(), [], undefined, [ep]))
    assert.equal(result.length, 0)
  })
})

describe('ruleProxyConfiguredButUnusable', () => {
  it('fires when proxy TCP is healthy but proxied HTTP fails', () => {
    const ep = endpoint('wininet.user')
    const result = ruleProxyConfiguredButUnusable(input(baseWindows(), [probe('github-proxy', 'github.com', 'proxy', {
      tcp: check('healthy', 'ok', { host: '127.0.0.1', port: 7890 }),
      http: check('error', '502 through proxy', { host: '127.0.0.1', port: 7890, proxy: '127.0.0.1:7890' }),
    })], undefined, [ep]))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'PROXY_CONFIGURED_BUT_UNUSABLE')
  })

  it('does not fire when proxied HTTP is healthy', () => {
    const ep = endpoint('wininet.user')
    const result = ruleProxyConfiguredButUnusable(input(baseWindows(), [probe('github-proxy', 'github.com', 'proxy', {
      tcp: check('healthy', 'ok', { host: '127.0.0.1', port: 7890 }),
      http: check('healthy', '200', { host: '127.0.0.1', port: 7890 }),
    })], undefined, [ep]))
    assert.equal(result.length, 0)
  })
})

describe('ruleDnsFailure', () => {
  it('fires when DNS failed and another TCP path is healthy', () => {
    const result = ruleDnsFailure(input(baseWindows(), [
      probe('github-direct', 'github.com', 'direct', { dns: check('error', 'ENOTFOUND') }),
      probe('npm-direct', 'registry.npmjs.org', 'direct', { tcp: check('healthy', 'ok') }),
    ]))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'DNS_FAILURE')
  })

  it('does not fire without a healthy TCP control', () => {
    const result = ruleDnsFailure(input(baseWindows(), [probe('github-direct', 'github.com', 'direct', {
      dns: check('error', 'ENOTFOUND'), tcp: check('error', 'refused'),
    })]))
    assert.equal(result.length, 0)
  })

  it('does not fire when every DNS probe is healthy', () => {
    const result = ruleDnsFailure(input(baseWindows(), [probe('github-direct', 'github.com', 'direct', { dns: check('healthy') })]))
    assert.equal(result.length, 0)
  })
})

describe('ruleTlsFailure', () => {
  it('fires when TCP is healthy but TLS failed', () => {
    const result = ruleTlsFailure(input(baseWindows(), [probe('github-direct', 'github.com', 'direct', {
      tcp: check('healthy', 'ok'),
      tls: check('error', 'certificate expired'),
    })]))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'TLS_FAILURE')
  })

  it('does not fire when TCP also failed', () => {
    const result = ruleTlsFailure(input(baseWindows(), [probe('github-direct', 'github.com', 'direct', {
      tcp: check('error', 'refused'),
      tls: check('error', 'unreachable'),
    })]))
    assert.equal(result.length, 0)
  })

  it('does not fire when all layers are healthy', () => {
    const result = ruleTlsFailure(input(baseWindows(), [probe('github-direct', 'github.com', 'direct', {
      tcp: check('healthy'), tls: check('healthy'), http: check('healthy'),
    })]))
    assert.equal(result.length, 0)
  })
})

describe('ruleStaleDshProxyEnv', () => {
  it('fires when DSH has a proxy the User scope no longer has', () => {
    const windows = baseWindows({
      dshProcessEnvironment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      environment: { scopes: { process: {}, user: {}, machine: {}, dsh: { HTTPS_PROXY: 'http://127.0.0.1:7890' } } },
    })
    const result = ruleStaleDshProxyEnv(input(windows, []))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'STALE_DSH_PROXY_ENV')
  })

  it('fires when DSH and User values differ', () => {
    const windows = baseWindows({
      dshProcessEnvironment: { HTTP_PROXY: 'http://127.0.0.1:7890' },
      environment: { scopes: { process: {}, user: { HTTP_PROXY: 'http://127.0.0.1:9999' }, machine: {}, dsh: {} } },
    })
    const result = ruleStaleDshProxyEnv(input(windows, []))
    assert.equal(result.length, 1)
  })

  it('does not fire when values match or are absent', () => {
    const windows = baseWindows({
      dshProcessEnvironment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      environment: { scopes: { process: {}, user: { HTTPS_PROXY: 'http://127.0.0.1:7890' }, machine: {}, dsh: {} } },
    })
    const result = ruleStaleDshProxyEnv(input(windows, []))
    assert.equal(result.length, 0)
  })
})

describe('ruleEnvScopeConflict', () => {
  it('fires when Process/User/Machine disagree for one variable', () => {
    const windows = baseWindows({
      environment: { scopes: {
        process: { HTTP_PROXY: 'http://a:1' },
        user: { HTTP_PROXY: 'http://b:2' },
        machine: {},
        dsh: {},
      } },
    })
    const result = ruleEnvScopeConflict(input(windows, []))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'ENV_SCOPE_CONFLICT')
  })

  it('treats unset scopes as absent and same values as no conflict', () => {
    const windows = baseWindows({
      environment: { scopes: {
        process: { HTTPS_PROXY: 'http://p:7890' },
        user: { HTTPS_PROXY: 'http://p:7890' },
        machine: {},
        dsh: {},
      } },
    })
    assert.equal(ruleEnvScopeConflict(input(windows, [])).length, 0)
  })

  it('fires once even when several variables conflict, with combined evidence', () => {
    const windows = baseWindows({
      environment: { scopes: {
        process: { HTTP_PROXY: 'http://a:1', NO_PROXY: 'x' },
        user: { HTTP_PROXY: 'http://b:2' },
        machine: { NO_PROXY: 'y' },
        dsh: {},
      } },
    })
    const result = ruleEnvScopeConflict(input(windows, []))
    assert.equal(result.length, 1)
    assert.ok(result[0]!.evidence.length >= 3)
  })
})

describe('ruleWslProxyUnreachable', () => {
  function hostProbe(distribution: string, tcp: ProbeCheck): LayeredProbe {
    return { target: { id: `wsl:${distribution}:host:default-route`, label: `${distribution} → host`, host: '172.0.0.1', port: 443, kind: 'windows-host' }, path: 'direct', layers: { tcp } }
  }
  function wslProxyProbe(distribution: string, tcp: ProbeCheck): LayeredProbe {
    return { target: { id: `wsl:${distribution}:proxy-endpoint`, label: `${distribution} → proxy`, host: '127.0.0.1', port: 7890, kind: 'wsl-proxy' }, path: 'proxy', layers: { tcp } }
  }

  it('fires generic WSL_PROXY_UNREACHABLE when Windows proxy works but WSL cannot reach it', () => {
    const windows = baseWindows()
    const distro: WslDistribution = { name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false, network: { hostCandidates: [{ address: '172.0.0.1', source: 'default-route', confidence: 0.8 }] } }
    const probes = [
      probe('github-proxy', 'github.com', 'proxy', { tcp: check('healthy'), http: check('healthy') }),
      hostProbe('Ubuntu-24.04', check('healthy')),
      wslProxyProbe('Ubuntu-24.04', check('error', 'refused')),
    ]
    const result = ruleWslProxyUnreachable(input(windows, probes, wslWith(distro)))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'WSL_PROXY_UNREACHABLE')
  })

  it('uses WSL_PROXY_LOOPBACK_UNREACHABLE for loopback proxy in NAT mode', () => {
    const distro: WslDistribution = {
      name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false,
      network: {
        hostCandidates: [{ address: '172.0.0.1', source: 'default-route', confidence: 0.8 }],
        environment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      },
    }
    const probes = [
      probe('github-proxy', 'github.com', 'proxy', { tcp: check('healthy'), http: check('healthy') }),
      hostProbe('Ubuntu-24.04', check('healthy')),
      wslProxyProbe('Ubuntu-24.04', check('error', 'refused')),
    ]
    const result = ruleWslProxyUnreachable(input(baseWindows(), probes, wslWith(distro)))
    assert.equal(result[0]?.code, 'WSL_PROXY_LOOPBACK_UNREACHABLE')
  })

  it('does not fire when WSL reaches the proxy', () => {
    const probes = [
      probe('github-proxy', 'github.com', 'proxy', { tcp: check('healthy'), http: check('healthy') }),
      hostProbe('Ubuntu-24.04', check('healthy')),
      wslProxyProbe('Ubuntu-24.04', check('healthy')),
    ]
    const result = ruleWslProxyUnreachable(input(baseWindows(), probes, wslWith({})))
    assert.equal(result.length, 0)
  })
})

describe('ruleWslAutoProxyStale', () => {
  it('fires when WSL inherits a proxy that no configured endpoint can reach', () => {
    const distro: WslDistribution = {
      name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false,
      network: { environment: { HTTPS_PROXY: 'http://127.0.0.1:7890' }, hostCandidates: [] },
    }
    const result = ruleWslAutoProxyStale(input(baseWindows(), [], wslWith(distro), [endpoint('wininet.user')]))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'WSL_AUTOPROXY_STALE')
  })

  it('does not fire when the inherited proxy is reachable', () => {
    const ep = endpoint('wininet.user')
    const distro: WslDistribution = {
      name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false,
      network: { environment: { HTTPS_PROXY: ep.url }, hostCandidates: [] },
    }
    const probes = [probe('github-proxy', 'github.com', 'proxy', {
      tcp: check('healthy', 'ok', { host: ep.host, port: ep.port }),
      http: check('healthy'),
    })]
    const result = ruleWslAutoProxyStale(input(baseWindows(), probes, wslWith(distro), [ep]))
    assert.equal(result.length, 0)
  })
})

describe('ruleHostsOverride', () => {
  it('fires when a hosts override matches a broken diagnostic target', () => {
    const windows = baseWindows({ hosts: { overrides: [{ ip: '127.0.0.1', hostnames: ['github.com'], raw: '127.0.0.1 github.com' }] } })
    const probes = [probe('github-direct', 'github.com', 'direct', { dns: check('error', 'unexpected 127.0.0.1'), tcp: check('error') })]
    const result = ruleHostsOverride(input(windows, probes))
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'HOSTS_OVERRIDE')
  })

  it('does not fire for unrelated hosts or healthy targets', () => {
    const windows = baseWindows({ hosts: { overrides: [{ ip: '127.0.0.1', hostnames: ['example.com'], raw: '127.0.0.1 example.com' }] } })
    const probes = [probe('github-direct', 'github.com', 'direct', { http: check('healthy') })]
    assert.equal(ruleHostsOverride(input(windows, probes)).length, 0)
  })
})

describe('runDiagnosis', () => {
  it('sorts errors before warnings and returns a healthy report when nothing matches', () => {
    const healthyReport = runDiagnosis(input(baseWindows(), [probe('github-direct', 'github.com', 'direct', {
      dns: check('healthy'), tcp: check('healthy'), tls: check('healthy'), http: check('healthy'),
    })]))
    assert.equal(healthyReport.worst, 'healthy')
    assert.equal(healthyReport.problemCount, 0)

    const ep = endpoint('wininet.user')
    const report = runDiagnosis(input(baseWindows({
      environment: { scopes: {
        process: { HTTP_PROXY: 'http://a:1' }, user: { HTTP_PROXY: 'http://b:2' }, machine: {}, dsh: {},
      } },
    }), [probe('github-proxy', 'github.com', 'proxy', {
      tcp: check('error', 'refused', { host: ep.host, port: ep.port }),
    })], undefined, [ep]))
    assert.equal(report.worst, 'error')
    assert.ok(report.problemCount >= 1)
  })
})
