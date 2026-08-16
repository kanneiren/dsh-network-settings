import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseWslList, parseVerboseRow, distributionsFromRegistry, parseQuietList } from '../../src/host/wsl/list.ts'

describe('WSL list parser', () => {
  it('combines quiet + running + verbose with UTF-16/CRLF text', () => {
    const result = parseWslList({
      quiet: 'docker-desktop\r\nUbuntu-24.04\r\n',
      running: 'Ubuntu-24.04\r\n',
      verbose: '  NAME              STATE           VERSION\r\n* docker-desktop    Stopped         2\r\n  Ubuntu-24.04      Running         2\r\n',
    })
    assert.deepEqual(result, [
      { name: 'docker-desktop', state: 'stopped', wslVersion: 2, default: true },
      { name: 'Ubuntu-24.04', state: 'running', wslVersion: 2, default: false },
    ])
  })

  it('keeps distribution names containing spaces verbatim', () => {
    const result = parseWslList({
      quiet: 'My Fancy Distro\r\n',
      running: 'My Fancy Distro\r\n',
      verbose: '  NAME              STATE           VERSION\r\n  My Fancy Distro   Running         2\r\n',
    })
    assert.equal(result[0]?.name, 'My Fancy Distro')
    assert.equal(result[0]?.state, 'running')
  })

  it('falls back to verbose rows when quiet output is absent', () => {
    const result = parseWslList({ verbose: '  NAME     STATE      VERSION\r\n  Alpine   Stopped    2\r\n' })
    assert.equal(result[0]?.name, 'Alpine')
    assert.equal(result[0]?.state, 'stopped')
    assert.equal(result[0]?.wslVersion, 2)
  })

  it('handles WSL1 and unknown states', () => {
    const result = parseWslList({
      quiet: 'Old\r\n',
      running: '',
      verbose: '  NAME    STATE      VERSION\r\n  Old     Stopped    1\r\n',
    })
    assert.equal(result[0]?.wslVersion, 1)
    assert.equal(result[0]?.state, 'stopped')
  })

  it('parses a localized Chinese header as header, not distribution', () => {
    const result = parseWslList({
      quiet: 'Ubuntu-24.04\r\n',
      running: 'Ubuntu-24.04\r\n',
      verbose: '  名称             状态           版本\r\n* Ubuntu-24.04      正在运行       2\r\n',
    })
    assert.equal(result.length, 1)
    assert.equal(result[0]?.name, 'Ubuntu-24.04')
  })

  it('parseVerboseRow strips the default marker and keeps spaces in the name', () => {
    assert.deepEqual(parseVerboseRow('* My Fancy Distro  Running  2'), { name: 'My Fancy Distro', state: 'Running', version: 2, default: true })
  })

  it('parses the quiet list including a default marker', () => {
    assert.deepEqual(parseQuietList('* docker-desktop\r\nUbuntu-24.04\r\n'), ['docker-desktop', 'Ubuntu-24.04'])
  })

  it('uses Lxss registry records as a fallback', () => {
    const result = distributionsFromRegistry([
      { DistributionName: 'Ubuntu-24.04', Version: 2, DefaultUid: 1000, Flags: 15 },
      { DistributionName: '', Version: 2, DefaultUid: 0, Flags: 15 },
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0]?.state, 'unknown')
    assert.equal(result[0]?.wslVersion, 2)
  })
})
