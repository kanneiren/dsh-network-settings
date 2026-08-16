import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actionToConfigureRequest, rollbackLatest, rollbackScope } from '../../src/host/repair/index.ts'
import { saveSnapshot } from '../../src/host/snapshot/store.ts'

const originalEnv = { ...process.env }

describe('repair action mapping and rollback', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('maps known diagnosis actions to safe configure requests', () => {
    assert.deepEqual(actionToConfigureRequest({ code: 'clear-dsh-process-proxy', scope: 'dsh.process', label: 'clear', safe: true }), { scope: 'dsh.process', action: 'clear' })
    assert.equal(actionToConfigureRequest({ code: 'unknown', scope: 'dsh.process', label: 'x', safe: false }), undefined)
  })

  it('rolls back the latest DSH process snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dshns-repair-'))
    process.env['DSH_HOME'] = dir
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:7890'
    const snapshot = await saveSnapshot({ reason: 'test', scope: 'dsh.process', before: { HTTPS_PROXY: 'http://127.0.0.1:7890' }, reversible: true })
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:9999'
    const result = await rollbackScope(snapshot.scope)
    assert.equal(process.env['HTTPS_PROXY'], 'http://127.0.0.1:7890')
    assert.equal(result.snapshot.id, snapshot.id)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports no history when nothing can be undone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dshns-empty-'))
    process.env['DSH_HOME'] = dir
    await assert.rejects(() => rollbackLatest(), /没有可撤销的修改/)
    await rm(dir, { recursive: true, force: true })
  })
})
