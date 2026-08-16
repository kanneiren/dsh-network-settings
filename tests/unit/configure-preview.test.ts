import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { previewConfigure } from '../../src/host/configure/index.ts'

describe('configure preview (no system mutation)', () => {
  const previous = { ...process.env }

  afterEach(() => {
    process.env = { ...previous }
  })

  it('previews a DSH process proxy clear with a field-level diff', async () => {
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:7890'
    const preview = await previewConfigure({ scope: 'dsh.process', action: 'clear' })
    assert.equal(preview.scope, 'dsh.process')
    assert.ok(preview.diff.some(entry => entry.path === '$.HTTPS_PROXY' && entry.after === undefined))
  })

  it('previews a DSH process proxy set', async () => {
    delete process.env['HTTPS_PROXY']
    const preview = await previewConfigure({ scope: 'dsh.process', action: 'set', patch: { HTTPS_PROXY: 'http://127.0.0.1:7890' } })
    assert.ok(preview.diff.some(entry => entry.path === '$.HTTPS_PROXY' && entry.after === 'http://127.0.0.1:7890'))
  })

  it('rejects unknown scopes', async () => {
    await assert.rejects(() => previewConfigure({ scope: 'wsl.unsafe', action: 'clear' } as never), /unknown configure scope/)
  })
})
