import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseIni, parseWslGlobalConfig, parseWslConf, supportsWslNetworkFeatures, normalizeNetworkMode } from '../../src/host/wsl/wslconfig.ts'

describe('.wslconfig parser', () => {
  it('parses [wsl2] and [experimental] with defaults', () => {
    const config = parseWslGlobalConfig('[wsl2]\nnetworkingMode=mirrored\nautoProxy=true\nmemory=12GB\n[experimental]\nhostAddressLoopback=true\n', 26100)
    assert.equal(config.mode, 'mirrored')
    assert.equal(config.modeConfigured, true)
    assert.equal(config.modeSupported, true)
    assert.equal(config.autoProxy, true)
    assert.equal(config.dnsTunneling, true)
    assert.equal(config.hostAddressLoopback, true)
  })

  it('unknown networkingMode falls back to NAT and reports unsupported', () => {
    const config = parseWslGlobalConfig('[wsl2]\nnetworkingMode=quantum\n', 26100)
    assert.equal(config.mode, 'nat')
    assert.equal(config.modeSupported, false)
  })

  it('defaults to NAT, dnsTunneling and autoProxy enabled', () => {
    const config = parseWslGlobalConfig('', 22631)
    assert.equal(config.mode, 'nat')
    assert.equal(config.dnsTunneling, true)
    assert.equal(config.autoProxy, true)
  })

  it('supports feature availability by Windows build', () => {
    assert.equal(supportsWslNetworkFeatures(22621), true)
    assert.equal(supportsWslNetworkFeatures(22000), false)
  })

  it('normalizeNetworkMode accepts current documented values', () => {
    for (const mode of ['none', 'nat', 'bridged', 'mirrored', 'virtioproxy']) {
      assert.equal(normalizeNetworkMode(mode).known, true)
    }
  })

  it('parses inline comments and repeated keys (last wins)', () => {
    const document = parseIni('[wsl2]\nmemory=4GB # old\nmemory=12GB\n')
    assert.equal(document['wsl2']?.['memory'], '12GB')
  })

  it('parseWslConf separates [network], [boot] and [interop]', () => {
    const conf = parseWslConf('[network]\ngenerateResolvConf = false\n[boot]\nsystemd=true\n[interop]\nenabled=false\n')
    assert.equal(conf.network?.generateResolvConf, false)
    assert.equal(conf.boot?.systemd, true)
    assert.equal(conf.interop?.enabled, false)
  })
})
