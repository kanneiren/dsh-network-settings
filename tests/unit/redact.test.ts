import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactProxyUrl, redactUrlCredentials, REDACTED } from '../../src/host/redact.ts'

describe('secret redaction', () => {
  it('redacts secret-looking keys recursively', () => {
    const output = redact({
      http: { authorization: 'Bearer abc', apiKey: 'sk-123', nested: [{ token: 't' }] },
      keep: 'ok',
    })
    assert.deepEqual(output, { http: { authorization: REDACTED, apiKey: REDACTED, nested: [{ token: REDACTED }] }, keep: 'ok' })
  })

  it('strips URL userinfo', () => {
    assert.equal(redactUrlCredentials('https://user:pass@example.com/path'), 'https://example.com/path')
    assert.equal(redactUrlCredentials('https://example.com/path'), 'https://example.com/path')
  })

  it('strips proxy credentials through the parser', () => {
    assert.equal(redactProxyUrl('http://user:pass@127.0.0.1:7890'), 'http://127.0.0.1:7890')
  })
})
