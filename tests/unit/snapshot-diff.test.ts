import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffJson, summarizeDiff } from '../../src/host/snapshot/diff.ts'

describe('snapshot diff', () => {
  it('diffs nested objects field by field', () => {
    assert.deepEqual(diffJson({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), [
      { path: '$.b.c', before: 2, after: 3 },
    ])
  })

  it('summarizes for display', () => {
    assert.deepEqual(summarizeDiff(diffJson({ a: 1 }, { a: 2 })), ['$.a: 1 → 2'])
  })

  it('handles arrays and removed keys', () => {
    const entries = diffJson({ x: [1], y: 'v' }, { x: [2] })
    assert.ok(entries.some(entry => entry.path === '$.x'))
    assert.ok(entries.some(entry => entry.path === '$.y' && entry.after === undefined))
  })
})

describe('snapshot store', () => {
  it('writes redacted snapshots atomically and lists latest first', async () => {
    const oldHome = process.env['DSH_HOME']
    const dir = await mkdtemp(join(tmpdir(), 'dshns-'))
    process.env['DSH_HOME'] = dir
    try {
      const { saveSnapshot, listSnapshots } = await import('../../src/host/snapshot/store.ts')
      const first = await saveSnapshot({ reason: 't1', scope: 'windows.env.user', before: { HTTPS_PROXY: 'http://u:p@127.0.0.1:7890', token: 'secret' }, reversible: true })
      const second = await saveSnapshot({ reason: 't2', scope: 'dsh.process', before: { HTTP_PROXY: 'x' }, reversible: true })
      assert.equal(first.id.length > 0, true)
      const listed = await listSnapshots()
      assert.equal(listed[0]?.id, second.id)
      const raw = JSON.parse(await readFile(join(dir, 'dsh-network-settings', 'snapshots', `${first.id}.json`), 'utf8'))
      assert.equal(raw.before.HTTPS_PROXY, 'http://127.0.0.1:7890')
      assert.equal(raw.before.token, '***')
    } finally {
      if (oldHome === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = oldHome
      await rm(dir, { recursive: true, force: true })
    }
  })
})
