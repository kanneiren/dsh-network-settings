import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advancedCatalog } from '../../src/host/repair/advanced.ts'

describe('advanced network first aid catalog', () => {
  it('lists all operations with independent metadata', () => {
    const actions = advancedCatalog()
    const byId = new Map(actions.map(a => [a.id, a]))
    assert.deepEqual(actions.map(a => a.id), [
      'flush-dns', 'reset-winhttp-proxy',
      'mac-flush-dns', 'mac-clear-shell-proxy', 'mac-clear-scutil-proxy',
      'reset-winsock', 'reset-ip',
    ])
    assert.equal(byId.get('flush-dns')?.requiresAdmin, false)
    assert.equal(byId.get('reset-winhttp-proxy')?.requiresAdmin, true)
    assert.equal(byId.get('mac-flush-dns')?.requiresAdmin, false)
    assert.equal(byId.get('mac-clear-shell-proxy')?.requiresAdmin, false)
    assert.equal(byId.get('mac-clear-scutil-proxy')?.requiresAdmin, false)
    assert.equal(byId.get('reset-winsock')?.requiresReboot, true)
    assert.equal(byId.get('reset-ip')?.requiresReboot, true)
  })

  it('marks winsock/ip resets as not automatically recoverable', () => {
    const byId = new Map(advancedCatalog().map(a => [a.id, a]))
    assert.equal(byId.get('reset-winsock')?.recoverable, false)
    assert.equal(byId.get('reset-ip')?.recoverable, false)
  })

  it('mac operations are low-risk, no-admin, no-reboot, recoverable', () => {
    const byId = new Map(advancedCatalog().map(a => [a.id, a]))
    for (const id of ['mac-flush-dns', 'mac-clear-shell-proxy', 'mac-clear-scutil-proxy']) {
      const op = byId.get(id)
      assert.equal(op?.risk, 'low', `${id} risk`)
      assert.equal(op?.requiresAdmin, false, `${id} admin`)
      assert.equal(op?.requiresReboot, false, `${id} reboot`)
      assert.equal(op?.recoverable, true, `${id} recoverable`)
    }
  })
})
