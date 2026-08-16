import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decodeWslUtf16 } from '../../src/host/wsl/encoding.ts'

describe('WSL UTF-16 decoder', () => {
  it('decodes UTF-16LE with BOM and CRLF', () => {
    const bytes = Buffer.from('\uFEFFNAME\r\nUbuntu-24.04\r\n', 'utf16le')
    const result = decodeWslUtf16(new Uint8Array(bytes))
    assert.equal(result.encoding, 'utf16le')
    assert.match(result.text, /Ubuntu-24.04/)
  })

  it('falls back to UTF-8 for Linux command output', () => {
    const bytes = Buffer.from('HTTP_PROXY=http://127.0.0.1:7890\n', 'utf8')
    const result = decodeWslUtf16(new Uint8Array(bytes))
    assert.equal(result.encoding, 'utf8')
    assert.match(result.text, /HTTP_PROXY/)
  })

  it('accepts already-decoded strings', () => {
    assert.equal(decodeWslUtf16('NAME\nUbuntu\r\n').text, 'NAME\nUbuntu\r\n')
  })
})
