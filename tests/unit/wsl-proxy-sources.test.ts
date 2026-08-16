import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseProxySources } from '../../src/host/wsl/sources.ts'
import { setWslAutoProxyInText } from '../../src/host/configure/wslconfig.ts'

describe('WSL proxy source attribution', () => {
  it('parses grep -Hn output into file:line sources', () => {
    const sources = parseProxySources('Ubuntu-24.04', [
      '/home/u/.bashrc:37:export HTTPS_PROXY=http://user:pass@127.0.0.1:7890',
      '/etc/environment:3:HTTP_PROXY=http://127.0.0.1:7890',
    ].join('\n'))
    assert.equal(sources.length, 2)
    assert.equal(sources[0]?.file, '/home/u/.bashrc')
    assert.equal(sources[0]?.line, 37)
    assert.equal(sources[0]?.raw.includes('user:pass'), false)
  })

  it('ignores malformed lines', () => {
    assert.deepEqual(parseProxySources('d', 'not a grep line'), [])
  })
})

describe('wslconfig autoProxy line editor', () => {
  it('replaces an existing autoProxy value preserving other lines', () => {
    const text = '[wsl2]\nmemory=8GB\nautoProxy=false\n'
    const next = setWslAutoProxyInText(text, true)
    assert.match(next, /autoProxy=true/)
    assert.match(next, /memory=8GB/)
  })

  it('inserts autoProxy under [wsl2] when missing', () => {
    const next = setWslAutoProxyInText('[wsl2]\nmemory=8GB\n', true)
    assert.match(next, /\[wsl2\]\nautoProxy=true/)
  })

  it('creates a minimal [wsl2] section when file is empty', () => {
    const next = setWslAutoProxyInText('', true)
    assert.match(next, /\[wsl2\]/)
    assert.match(next, /autoProxy=true/)
  })
})
