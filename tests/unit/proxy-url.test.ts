import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseProxyUrl, proxyEndpointsFromValue } from '../../src/host/proxy/proxy-url.ts'
import { matchesNoProxy, parseNoProxy } from '../../src/host/proxy/no-proxy.ts'

describe('proxy URL parser', () => {
  it('parses http://host:port and strips credentials from the URL', () => {
    const parsed = parseProxyUrl('http://user:pass@127.0.0.1:7890')
    assert.equal(parsed.url, 'http://127.0.0.1:7890')
    assert.equal(parsed.host, '127.0.0.1')
    assert.equal(parsed.port, 7890)
    assert.equal(parsed.protocol, 'http')
    assert.equal(parsed.hasCredentials, true)
  })

  it('treats a schemeless host:port as HTTP', () => {
    const parsed = parseProxyUrl('127.0.0.1:7890')
    assert.equal(parsed.url, 'http://127.0.0.1:7890')
    assert.equal(parsed.protocol, 'http')
    assert.equal(parsed.schemeExplicit, false)
  })

  it('parses bracketed IPv6 addresses', () => {
    const parsed = parseProxyUrl('socks5://[::1]:1080')
    assert.equal(parsed.host, '::1')
    assert.equal(parsed.port, 1080)
    assert.equal(parsed.protocol, 'socks5')
  })

  it('rejects empty and invalid endpoints', () => {
    assert.throws(() => parseProxyUrl(''))
    assert.throws(() => parseProxyUrl('http://:7890'))
    assert.throws(() => parseProxyUrl('127.0.0.1:99999'))
  })

  it('parses a multi-endpoint WinINet style value', () => {
    const endpoints = proxyEndpointsFromValue('http=127.0.0.1:7890;https=127.0.0.1:7890', 'wininet.user')
    assert.equal(endpoints.length, 2)
    assert.equal(endpoints[0]?.port, 7890)
  })
})

describe('NO_PROXY matcher', () => {
  it('matches exact hosts, domain suffixes and wildcards', () => {
    const rules = parseNoProxy('localhost,.example.com,10.*')
    assert.equal(matchesNoProxy(rules, 'localhost'), true)
    assert.equal(matchesNoProxy(rules, 'api.example.com'), true)
    assert.equal(matchesNoProxy(rules, 'example.com'), true)
    assert.equal(matchesNoProxy(rules, '10.1.2.3'), true)
    assert.equal(matchesNoProxy(rules, 'evil-example.com'), false)
  })

  it('honors an explicit port suffix', () => {
    const rules = parseNoProxy('127.0.0.1:7890')
    assert.equal(matchesNoProxy(rules, '127.0.0.1', 7890), true)
    assert.equal(matchesNoProxy(rules, '127.0.0.1', 8080), false)
  })
})
