import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  inspectMacFacts, parseMacDns, parseMacHardwarePorts, parseMacListeners,
  parseMacRoute, parseMacSystemProxy, parseSwVers,
} from '../../src/host/mac/inspect.ts'

const fixture = async (name: string): Promise<string> =>
  readFile(join('tests/fixtures/mac', name + '.txt'), 'utf8')

describe('mac parsers (recorded macOS runner fixtures)', () => {
  it('parseMacSystemProxy: clean runner output has every proxy disabled', async () => {
    const parsed = parseMacSystemProxy(await fixture('scutil-proxy'))
    assert.equal(parsed.httpEnabled, false)
    assert.equal(parsed.httpsEnabled, false)
    assert.equal(parsed.socksEnabled, false)
    assert.equal(parsed.pacEnabled, false)
    assert.deepEqual(parsed.exceptions, ['*.local', '169.254/16'])
  })

  it('parseMacSystemProxy: enabled dictionaries expose host/port pairs', () => {
    const parsed = parseMacSystemProxy([
      '<dictionary> {',
      '  HTTPEnable : 1',
      '  HTTPPort : 7890',
      '  HTTPProxy : 127.0.0.1',
      '  HTTPSEnable : 1',
      '  HTTPSPort : 7890',
      '  HTTPSProxy : 127.0.0.1',
      '  ProxyAutoConfigEnable : 1',
      '  ProxyAutoConfigURLString : http://pac.example.com/proxy.pac',
      '}',
    ].join('\n'))
    assert.equal(parsed.httpEnabled, true)
    assert.equal(parsed.httpHost, '127.0.0.1')
    assert.equal(parsed.httpPort, 7890)
    assert.equal(parsed.httpsEnabled, true)
    assert.equal(parsed.pacEnabled, true)
    assert.equal(parsed.pacUrl, 'http://pac.example.com/proxy.pac')
  })

  it('parseMacHardwarePorts: blocks map to interfaces with kinds; footer dropped', async () => {
    const interfaces = parseMacHardwarePorts(await fixture('networksetup-ports'))
    assert.ok(interfaces.length >= 2)
    assert.deepEqual(interfaces[0], { name: 'Ethernet', device: 'en0', kind: 'ethernet' })
    assert.equal(interfaces.every(item => !/vlan/i.test(item.name)), true)
  })

  it('parseMacRoute: gateway and interface extracted', async () => {
    const route = parseMacRoute(await fixture('route-default'))
    assert.equal(route.gateway, '192.168.64.1')
    assert.equal(route.interface, 'en0')
  })

  it('parseMacDns: first resolver nameservers', async () => {
    const nameservers = parseMacDns(await fixture('scutil-dns'))
    assert.deepEqual(nameservers, ['192.168.64.1'])
  })

  it('parseMacListeners: empty lsof output tolerated', async () => {
    assert.deepEqual(parseMacListeners(await fixture('lsof-listeners')), [])
  })

  it('parseMacListeners: rows map to the shared listener shape', () => {
    const listeners = parseMacListeners([
      'COMMAND   PID  USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME',
      'rapportd  619  user   8u  IPv4  0x1234      0t0  TCP *:49152 (LISTEN)',
      'node      999  user   9u  IPv6  0x5678      0t0  TCP 127.0.0.1:3099 (LISTEN)',
    ].join('\n'))
    assert.deepEqual(listeners, [
      { address: '0.0.0.0', port: 49152, pid: 619, processName: 'rapportd' },
      { address: '127.0.0.1', port: 3099, pid: 999, processName: 'node' },
    ])
  })

  it('parseSwVers: product metadata', async () => {
    const os = parseSwVers(await fixture('sw-vers'))
    assert.equal(os.caption, 'macOS')
    assert.equal(os.version, '26.5.2')
    assert.equal(os.build, '25F84')
  })

  it('inspectMacFacts: fixture-driven full assembly', async () => {
    const facts = await inspectMacFacts({
      fixtures: {
        'scutil-proxy': await fixture('scutil-proxy'),
        'networksetup-ports': await fixture('networksetup-ports'),
        'route-default': await fixture('route-default'),
        'scutil-dns': await fixture('scutil-dns'),
        'lsof-listeners': await fixture('lsof-listeners'),
        'sw-vers': await fixture('sw-vers'),
        'hosts': '127.0.0.1 localhost\n',
      },
    })
    assert.equal(facts.os.version, '26.5.2')
    assert.equal(facts.network.gateway, '192.168.64.1')
    assert.equal(facts.network.gatewayInterface, 'en0')
    assert.equal(facts.network.interfaces[0]?.device, 'en0')
    assert.deepEqual(facts.dns.nameservers, ['192.168.64.1'])
    assert.equal(facts.proxy.scutil.httpEnabled, false)
    assert.equal(facts.hosts.overrides[0]?.hostnames[0], 'localhost')
  })
})

describe('macOS runtime detection', () => {
  it('darwin platform yields a verified MACOS_NATIVE runtime', async () => {
    const { detectRuntime } = await import('../../src/host/network/runtime.ts')
    const runtime = detectRuntime({ platform: 'darwin' })
    assert.equal(runtime.type, 'MACOS_NATIVE')
    assert.equal(runtime.confidence, 'verified')
  })
})

describe('macOS shell-profile proxy residue', () => {
  it('parseMacShellProxyExports picks first proxy export per var across profiles', async () => {
    const { parseMacShellProxyExports } = await import('../../src/host/mac/inspect.ts')
    const parsed = parseMacShellProxyExports([
      { file: '.zshenv', text: 'export HTTPS_PROXY=http://127.0.0.1:7890\nexport NO_PROXY=localhost\n# export HTTPS_PROXY=ignored\n' },
      { file: '.zprofile', text: 'https_proxy=http://127.0.0.1:7890\nexport PATH=/usr/bin\n' },
    ])
    assert.equal(parsed.HTTPS_PROXY, 'http://127.0.0.1:7890')
    assert.equal(parsed.NO_PROXY, 'localhost')
    assert.equal(parsed.https_proxy, 'http://127.0.0.1:7890')
    assert.equal('PATH' in parsed, false)
  })

  it('ruleMacProxyResidue fires for dead shell-profile endpoints, not live ones', async () => {
    const { ruleMacProxyResidue } = await import('../../src/host/diagnose/rules.ts')
    const base = (listeners: Array<{ address: string; port: number; pid: number }>) => ({
      dsh: {},
      probes: [],
      endpoints: [],
      macos: {
        os: { caption: 'macOS', version: '26.5', build: '25F84' },
        network: { interfaces: [] },
        proxy: { scutil: { httpEnabled: false, httpsEnabled: false, socksEnabled: false, pacEnabled: false }, endpoints: [] },
        dns: { nameservers: [] },
        hosts: { overrides: [] },
        listeners,
        environment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
        rawErrors: [],
      },
    })
    const dead = ruleMacProxyResidue(base([]))
    assert.equal(dead.length, 1)
    assert.equal(dead[0]?.code, 'MAC_SHELL_PROXY_RESIDUE')
    assert.equal(dead[0]?.severity, 'error')
    const live = ruleMacProxyResidue(base([{ address: '127.0.0.1', port: 7890, pid: 1 }]))
    assert.equal(live.length, 0)
  })

  it('ruleMacProxyResidue flags enabled scutil proxy without a listener', async () => {
    const { ruleMacProxyResidue } = await import('../../src/host/diagnose/rules.ts')
    const result = ruleMacProxyResidue({
      dsh: {},
      probes: [],
      endpoints: [],
      macos: {
        os: { caption: 'macOS', version: '26.5', build: '25F84' },
        network: { interfaces: [] },
        proxy: { scutil: { httpEnabled: true, httpsEnabled: true, httpHost: '127.0.0.1', httpPort: 7890, httpsHost: '127.0.0.1', httpsPort: 7890, socksEnabled: false, pacEnabled: false }, endpoints: [] },
        dns: { nameservers: [] },
        hosts: { overrides: [] },
        listeners: [],
        rawErrors: [],
      },
    } as never)
    assert.equal(result.length, 1)
    assert.equal(result[0]?.code, 'MAC_SCUTIL_PROXY_STALE')
    assert.equal(result[0]?.severity, 'warning')
  })

  it('ruleMacProxyResidue stays silent outside macOS', async () => {
    const { ruleMacProxyResidue } = await import('../../src/host/diagnose/rules.ts')
    assert.deepEqual(ruleMacProxyResidue({ dsh: {}, probes: [], endpoints: [] }), [])
  })
})
