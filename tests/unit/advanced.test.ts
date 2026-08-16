import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advancedCatalog } from '../../src/host/repair/advanced.ts'

describe('advanced network first aid catalog', () => {
  it('lists the four official operations with independent metadata', () => {
    const actions = advancedCatalog()
    assert.deepEqual(actions.map(action => action.id), ['flush-dns', 'reset-winhttp-proxy', 'reset-winsock', 'reset-ip'])
    assert.equal(actions[0]?.requiresAdmin, false)
    assert.equal(actions[1]?.requiresAdmin, true)
    assert.equal(actions[2]?.requiresReboot, true)
    assert.equal(actions[3]?.requiresReboot, true)
  })

  it('marks winsock/ip resets as not automatically recoverable', () => {
    const actions = advancedCatalog()
    assert.equal(actions[2]?.recoverable, false)
    assert.equal(actions[3]?.recoverable, false)
  })
})
