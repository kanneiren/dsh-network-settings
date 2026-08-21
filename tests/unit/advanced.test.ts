import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advancedCatalog } from '../../src/host/repair/advanced.ts'

const WIN32 = advancedCatalog('win32').map(action => action.id)
const DARWIN = advancedCatalog('darwin').map(action => action.id)
const LINUX = advancedCatalog('linux').map(action => action.id)

describe('advanced network first aid catalog', () => {
  it('lists all operations with independent metadata', () => {
    const byId = new Map([...advancedCatalog('win32'), ...advancedCatalog('darwin')].map(a => [a.id, a]))
    assert.deepEqual(WIN32, ['flush-dns', 'reset-winhttp-proxy', 'reset-winsock', 'reset-ip'])
    assert.deepEqual(DARWIN, ['mac-flush-dns', 'mac-clear-shell-proxy', 'mac-clear-scutil-proxy'])
    assert.equal(byId.get('flush-dns')?.requiresAdmin, false)
    assert.equal(byId.get('reset-winhttp-proxy')?.requiresAdmin, true)
    assert.equal(byId.get('mac-flush-dns')?.requiresAdmin, false)
    assert.equal(byId.get('mac-clear-shell-proxy')?.requiresAdmin, false)
    assert.equal(byId.get('mac-clear-scutil-proxy')?.requiresAdmin, false)
    assert.equal(byId.get('reset-winsock')?.requiresReboot, true)
    assert.equal(byId.get('reset-ip')?.requiresReboot, true)
  })

  it('never leaks macOS actions onto Windows or WSL', () => {
    for (const id of DARWIN) {
      assert.equal(WIN32.includes(id), false, `${id} must not appear on win32`)
      assert.equal(LINUX.includes(id), false, `${id} must not appear on WSL`)
    }
  })

  it('keeps Windows-host actions on win32 and WSL (interop)', () => {
    assert.deepEqual(LINUX, WIN32)
  })

  it('marks winsock/ip resets as not automatically recoverable', () => {
    const byId = new Map(advancedCatalog('win32').map(a => [a.id, a]))
    assert.equal(byId.get('reset-winsock')?.recoverable, false)
    assert.equal(byId.get('reset-ip')?.recoverable, false)
  })

  it('mac operations are low-risk, no-admin, no-reboot, recoverable', () => {
    const byId = new Map(advancedCatalog('darwin').map(a => [a.id, a]))
    for (const id of ['mac-flush-dns', 'mac-clear-shell-proxy', 'mac-clear-scutil-proxy']) {
      const op = byId.get(id)
      assert.equal(op?.risk, 'low', `${id} risk`)
      assert.equal(op?.requiresAdmin, false, `${id} admin`)
      assert.equal(op?.requiresReboot, false, `${id} reboot`)
      assert.equal(op?.recoverable, true, `${id} recoverable`)
    }
  })
})
