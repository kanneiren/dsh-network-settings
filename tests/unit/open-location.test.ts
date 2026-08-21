import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { openTargetFor } from '../../src/host/configure/open.ts'

const HOME = join('C:\\', 'Users', 'user')

describe('openTargetFor platform resolution', () => {
  it('hosts: darwin opens /etc/hosts with the native open command', () => {
    const target = openTargetFor('hosts', 'darwin', undefined, HOME)
    assert.equal(target.path, '/etc/hosts')
    assert.deepEqual(target.opener, ['open', '-t', '/etc/hosts'])
  })

  it('hosts: win32 and WSL resolve the Windows hosts file', () => {
    assert.equal(openTargetFor('hosts', 'win32', undefined, HOME).path, 'C:\\Windows\\System32\\drivers\\etc\\hosts')
    assert.equal(openTargetFor('hosts', 'linux', undefined, HOME).path, '/mnt/c/Windows/System32/drivers/etc/hosts')
  })

  it('system proxy settings use the native settings pane per platform', () => {
    const mac = openTargetFor('system-proxy-settings', 'darwin', undefined, HOME)
    assert.equal(mac.opener?.[0], 'open')
    assert.match(mac.path, /Network-Settings/)
    const win = openTargetFor('system-proxy-settings', 'win32', undefined, HOME)
    assert.equal(win.path, 'ms-settings:network-proxy')
  })

  it('shell-profile only opens well-known files under the home dir', () => {
    assert.equal(openTargetFor('shell-profile', 'darwin', '/etc/passwd', HOME).opener, undefined, 'non-profile basename rejected')
    assert.equal(openTargetFor('shell-profile', 'darwin', '../../etc/hosts', HOME).opener, undefined, 'traversal rejected')
    const zshrc = openTargetFor('shell-profile', 'darwin', '~/.zshrc', HOME)
    assert.equal(zshrc.path, join(HOME, '.zshrc'))
    assert.deepEqual(zshrc.opener, ['open', '-t', join(HOME, '.zshrc')])
    assert.equal(openTargetFor('shell-profile', 'win32', '.zshrc', HOME).opener, undefined, 'shell profiles are a darwin location')
  })

  it('WSL locations are darwin-unavailable and need a distribution', () => {
    assert.equal(openTargetFor('wslconfig', 'darwin', undefined, HOME).opener, undefined)
    assert.equal(openTargetFor('wsl-conf', 'darwin', 'Ubuntu', HOME).opener, undefined)
    assert.equal(openTargetFor('wsl-conf', 'win32', undefined, HOME).opener, undefined)
    assert.match(openTargetFor('wsl-conf', 'win32', 'Ubuntu', HOME).path, /wsl\.localhost/)
    assert.equal(openTargetFor('wslconfig', 'win32', undefined, HOME).path, join(HOME, '.wslconfig'))
  })
})
