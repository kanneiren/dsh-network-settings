import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WslScriptResult } from '../../src/host/probe/wsl.ts'
import { addressesFromDnsOutput, internetCheckFromResult, tcpCheckFromResult } from '../../src/host/probe/wsl.ts'
import { hostSegmentStatus } from '../../src/host/network/build-wsl.ts'

function result(overrides: Partial<WslScriptResult> = {}): WslScriptResult {
  return {
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    aborted: false,
    durationMs: 10,
    ...overrides,
  }
}

describe('tcpCheckFromResult', () => {
  it('connected or refused counts as healthy', () => {
    const check = tcpCheckFromResult('wsl:Ubuntu:tcp', '172.17.80.1', 443, result({ code: 0 }))
    assert.equal(check.status, 'healthy')
    assert.match(check.humanMessage, /172\.17\.80\.1:443/)
  })

  it('timeout exit code 2 becomes a warning, not an error', () => {
    const check = tcpCheckFromResult('wsl:Ubuntu:tcp', '172.17.80.1', 443, result({ code: 2, stderr: 'timed out' }))
    assert.equal(check.status, 'warning')
    assert.equal(check.errorCode, 'WSL_TCP_TIMEOUT')
    assert.match(check.humanMessage, /防火墙/)
  })

  it('a killed wsl.exe command (timedOut) becomes a warning', () => {
    const check = tcpCheckFromResult('wsl:Ubuntu:tcp', '172.17.80.1', 443, result({ code: null, timedOut: true }))
    assert.equal(check.status, 'warning')
    assert.equal(check.errorCode, 'WSL_TCP_TIMEOUT')
  })

  it('other failures stay errors', () => {
    const check = tcpCheckFromResult('wsl:Ubuntu:tcp', '172.17.80.1', 443, result({ code: 1, stderr: 'boom' }))
    assert.equal(check.status, 'error')
    assert.equal(check.errorCode, 'WSL_TCP_FAILED')
  })
})

describe('internetCheckFromResult', () => {
  it('direct: a received HTTP 401 still counts as reachable', () => {
    const check = internetCheckFromResult('wsl:Ubuntu:direct', 'direct', 'api.deepseek.com', result({ code: 0, stdout: 'HTTP 401' }))
    assert.equal(check.status, 'healthy')
    assert.match(check.humanMessage, /直连 api\.deepseek\.com（HTTP 401）/)
  })

  it('direct: empty stdout (wget/python fallback) counts as healthy', () => {
    const check = internetCheckFromResult('wsl:Ubuntu:direct', 'direct', 'api.deepseek.com', result({ code: 0, stdout: 'OK' }))
    assert.equal(check.status, 'healthy')
    assert.match(check.humanMessage, /直连 api\.deepseek\.com/)
  })

  it('direct: script failure stays an error', () => {
    const check = internetCheckFromResult('wsl:Ubuntu:direct', 'direct', 'api.deepseek.com', result({ code: 1, stderr: 'curl: (28) timeout' }))
    assert.equal(check.status, 'error')
    assert.equal(check.errorCode, 'WSL_DIRECT_FAILED')
  })

  it('proxy: received status counts as healthy with proxy wording', () => {
    const check = internetCheckFromResult('wsl:Ubuntu:proxy', 'proxy', 'api.deepseek.com', result({ code: 0, stdout: 'HTTP 200' }))
    assert.equal(check.status, 'healthy')
    assert.match(check.humanMessage, /经代理访问 api\.deepseek\.com（HTTP 200）/)
  })

  it('proxy: failure stays an error', () => {
    const check = internetCheckFromResult('wsl:Ubuntu:proxy', 'proxy', 'api.deepseek.com', result({ code: 1 }))
    assert.equal(check.status, 'error')
    assert.equal(check.errorCode, 'WSL_PROXY_FAILED')
  })
})

describe('hostSegmentStatus', () => {
  it('healthy host probe wins', () => {
    assert.equal(hostSegmentStatus('healthy', false), 'healthy')
  })

  it('end-to-end success rescues a failed host probe', () => {
    assert.equal(hostSegmentStatus('error', true), 'healthy')
  })

  it('end-to-end success rescues an unknown host probe', () => {
    assert.equal(hostSegmentStatus('unknown', true), 'healthy')
  })

  it('host error without end-to-end success stays an error', () => {
    assert.equal(hostSegmentStatus('error', false), 'error')
  })

  it('timeout warning without end-to-end success stays a warning', () => {
    assert.equal(hostSegmentStatus('warning', false), 'warning')
  })

  it('unknown stays unknown', () => {
    assert.equal(hostSegmentStatus('unknown', false), 'unknown')
  })
})

describe('WSL DNS address extraction', () => {
  it('extracts unique IPv4 addresses from getent output', () => {
    const output = '104.18.12.34     STREAM api.deepseek.com\r\n104.18.12.34     DGRAM\r\n198.18.0.37      STREAM api.deepseek.com\n'
    assert.deepEqual(addressesFromDnsOutput(output), ['104.18.12.34', '198.18.0.37'])
  })

  it('returns empty for non-address output', () => {
    assert.deepEqual(addressesFromDnsOutput('getent: not found\n'), [])
  })
})
