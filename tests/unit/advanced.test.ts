import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advancedCatalog } from '../../src/host/repair/advanced.ts'

describe('advanced network first aid catalog', () => {
  it('lists the four official operations with independent metadata', () => {
    const actions = advancedCatalog()
    assert.deepEqual(actions.map(action => action.id), ['flush-dns',
      'reset-winhttp-proxy', 'mac-flush-dns', 'reset-winsock', 'reset-ip'])
    assert.equal(actions[0]?.requiresAdmin, false)
    assert.equal(actions[1]?.requiresAdmin, true) // reset-winhttp-proxy
    assert.equal(actions[2]?.requiresAdmin, false) // mac-flush-dns
    assert.equal(actions[3]?.requiresReboot, true) // reset-winsock
    assert.equal(actions[4]?.requiresReboot, true) // reset-ip
  })

  it('marks winsock/ip resets as not automatically recoverable', () => {
    const actions = advancedCatalog()
    const winsock = actions.find(a => a.id === 'reset-winsock')
    const resetIp = actions.find(a => a.id === 'reset-ip')
    assert.equal(winsock?.recoverable, false)
    assert.equal(resetIp?.recoverable, false)
  })
})
