import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosisActionOperations, findRepairOperation, repairCatalog } from '../../src/host/repair/catalog.ts'

describe('repair operation catalog', () => {
  it('has unique independent operations with exactly one executable target', () => {
    const catalog = repairCatalog()
    assert.equal(new Set(catalog.map(operation => operation.id)).size, catalog.length)
    for (const operation of catalog) {
      if (operation.kind === 'configure') {
        assert.ok(operation.request !== undefined)
        assert.equal(operation.advancedId, undefined)
      } else {
        assert.ok(operation.advancedId !== undefined)
        assert.equal(operation.request, undefined)
      }
    }
  })

  it('maps common diagnosis codes to expected operations', () => {
    const stale = diagnosisActionOperations({ code: 'STALE_DSH_PROXY_ENV', scope: 'dsh', label: 'x', safe: true })
    assert.deepEqual(stale.map(operation => operation.id), ['clear-dsh-process-proxy'])
    const dns = diagnosisActionOperations({ code: 'DNS_FAILURE', scope: 'dns', label: 'x', safe: true })
    assert.deepEqual(dns.map(operation => operation.id), ['flush-dns'])
    const unknown = diagnosisActionOperations({ code: 'UNKNOWN_CODE', scope: 'dsh', label: 'x', safe: true })
    assert.equal(unknown.length, 0)
  })

  it('does not let one operation include another scope', () => {
    const scopes = new Set(repairCatalog().map(operation => operation.scope))
    assert.equal(scopes.has('dsh.process'), true)
    assert.equal(scopes.has('windows.env.user'), true)
    assert.equal(repairCatalog().some(operation => operation.label.includes('全部')), false)
    assert.equal(findRepairOperation('does-not-exist'), undefined)
  })
})
