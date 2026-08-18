import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteHostsEntry, parseHostsEntries, previewHostsDelete, rollbackHostsSnapshot, windowsHostsPath } from '../../src/host/repair/hosts.ts'

describe('Hosts entry parser and single-entry repair', () => {
  it('parses non-comment entries with line numbers and ignores comments', () => {
    const entries = parseHostsEntries('# comment\n127.0.0.1 github.com\n\n127.0.0.1 a b\n')
    assert.equal(entries.length, 2)
    assert.equal(entries[0]?.line, 2)
    assert.deepEqual(entries[0]?.hostnames, ['github.com'])
    assert.equal(entries[1]?.line, 4)
  })

  it('previews deletion scope and diff', () => {
    const entry = parseHostsEntries('127.0.0.1 github.com\n')[0]!
    const preview = previewHostsDelete(entry)
    assert.match(preview.scopeDescription, /只会删除 Hosts 文件第 1 行/)
    assert.equal(preview.diffText[0], 'hosts:1: 127.0.0.1 github.com → (删除)')
  })

  it('converts /mnt/c paths to Windows drive-letter form for elevated scripts', () => {
    assert.equal(windowsHostsPath('/mnt/c/Windows/System32/drivers/etc/hosts'), 'C:\\Windows\\System32\\drivers\\etc\\hosts')
    assert.equal(windowsHostsPath('C:\\Windows\\System32\\drivers\\etc\\hosts'), 'C:\\Windows\\System32\\drivers\\etc\\hosts')
  })

  it('deletes exactly one line with a backup and can roll back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dshns-hosts-'))
    const oldHome = process.env['DSH_HOME']
    process.env['DSH_HOME'] = join(dir, 'dsh-home')
    const file = join(dir, 'hosts')
    const original = '127.0.0.1 localhost\n127.0.0.1 github.com\n127.0.0.1 keep.test\n'
    await writeFile(file, original, 'utf8')
    try {
      const entry = parseHostsEntries(original)[1]!
      const result = await deleteHostsEntry(entry, file)
      assert.equal(result.snapshotId.length > 0, true)
      const after = await readFile(file, 'utf8')
      assert.equal(after, '127.0.0.1 localhost\n127.0.0.1 keep.test\n')
      const backup = await readFile(`${file}.dsh-network-settings.bak`, 'utf8')
      assert.equal(backup, original)

      const restored = await rollbackHostsSnapshot({ before: { file, line: entry.line, backup: `${file}.dsh-network-settings.bak` } })
      assert.equal(restored.diffText[0], 'Hosts 第 2 行已从备份恢复')
      assert.equal(await readFile(file, 'utf8'), original)
    } finally {
      if (oldHome === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = oldHome
      await rm(dir, { recursive: true, force: true })
    }
  })
})
