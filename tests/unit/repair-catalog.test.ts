import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosisActionOperations, findRepairOperation, isRecommendableOperation, RECOMMEND_CONFIDENCE_THRESHOLD, repairCatalog } from '../../src/host/repair/catalog.ts'
import { withDriftRecommendation } from '../../src/host/network/drift.ts'
import type { NetworkDiagnostic, NetworkPathGraph } from '../../src/host/network/types.ts'

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

  it('maps proxy endpoint actions to the operation of their own scope only', () => {
    const wininet = diagnosisActionOperations({ code: 'repair-proxy-endpoint', scope: 'wininet.user', label: 'x', safe: true })
    assert.deepEqual(wininet.map(operation => operation.id), ['clear-wininet-user-proxy'])
    const winhttpUser = diagnosisActionOperations({ code: 'PROXY_ENDPOINT_UNREACHABLE', scope: 'winhttp.user', label: 'x', safe: true })
    assert.deepEqual(winhttpUser.map(operation => operation.id), ['clear-winhttp-user-proxy'])
    const winhttpMachine = diagnosisActionOperations({ code: 'PROXY_CONFIGURED_BUT_UNUSABLE', scope: 'winhttp.machine', label: 'x', safe: true })
    assert.deepEqual(winhttpMachine.map(operation => operation.id), ['reset-winhttp-machine-proxy'])
    const envUser = diagnosisActionOperations({ code: 'repair-proxy-usability', scope: 'env.user', label: 'x', safe: true })
    assert.deepEqual(envUser.map(operation => operation.id), ['clear-user-env-proxy'])
  })

  it('suggests nothing for proxy actions with an unknown scope', () => {
    const generic = diagnosisActionOperations({ code: 'repair-proxy-endpoint', scope: 'proxy', label: 'x', safe: true })
    assert.deepEqual(generic, [])
  })

  it('does not let one operation include another scope', () => {
    const scopes = new Set(repairCatalog().map(operation => operation.scope))
    assert.equal(scopes.has('dsh.process'), true)
    assert.equal(scopes.has('windows.env.user'), true)
    assert.equal(repairCatalog().some(operation => operation.label.includes('全部')), false)
    assert.equal(findRepairOperation('does-not-exist'), undefined)
  })
})

describe('repair recommendation policy', () => {
  it('only whitelists common low-risk operations', () => {
    for (const id of ['flush-dns', 'clear-user-env-proxy', 'clear-wininet-user-proxy', 'clear-winhttp-user-proxy', 'clear-dsh-process-proxy']) {
      assert.equal(isRecommendableOperation(id), true, id)
    }
    for (const id of ['clear-machine-env-proxy', 'wsl-autoproxy-enable', 'reset-winhttp-machine-proxy', 'reset-winsock', 'reset-ip']) {
      assert.equal(isRecommendableOperation(id), false, id)
    }
  })

  it('maps ENV_SCOPE_CONFLICT to the user scope only', () => {
    const operations = diagnosisActionOperations({ code: 'ENV_SCOPE_CONFLICT', scope: 'windows.env', label: 'x', safe: true })
    assert.deepEqual(operations.map(operation => operation.id), ['clear-user-env-proxy'])
  })

  it('exposes a confidence threshold at or above 0.85', () => {
    assert.ok(RECOMMEND_CONFIDENCE_THRESHOLD >= 0.85)
  })
})

describe('withDriftRecommendation gating', () => {
  const diagnostic = (code: string, confidence: number, actionCodes: string[]): NetworkDiagnostic => ({
    code,
    severity: 'error',
    confidence,
    pathIds: ['dsh'],
    humanMessage: code,
    technicalMessage: code,
    evidence: [],
    actions: actionCodes.map(code => ({ code, scope: 'dsh.process', label: code, safe: true })),
  })

  it('skips actionable diagnostics below the confidence threshold', () => {
    const graph = withDriftRecommendation({} as NetworkPathGraph, [diagnostic('LOW_CONF', 0.8, ['clear-dsh-process-proxy'])])
    assert.equal(graph.recommendedRepair, undefined)
  })

  it('skips eligible-confidence diagnostics mapping only to non-recommendable operations', () => {
    const graph = withDriftRecommendation({} as NetworkPathGraph, [diagnostic('WSL_STALE', 0.95, ['wsl-autoproxy-enable'])])
    assert.equal(graph.recommendedRepair, undefined)
  })

  it('recommends the highest-confidence eligible diagnostic', () => {
    const graph = withDriftRecommendation({} as NetworkPathGraph, [
      diagnostic('STALE_A', 0.9, ['clear-user-env-proxy']),
      diagnostic('STALE_B', 0.95, ['clear-wininet-user-proxy']),
    ])
    assert.equal(graph.recommendedRepair?.diagnosisCode, 'STALE_B')
  })
})

describe('macOS repair integration', () => {
  it('catalog filters Windows-only operations on darwin', async () => {
    const { operationsForPlatform } = await import('../../src/host/repair/catalog.ts')
    const macOps = operationsForPlatform('darwin')
    assert.equal(macOps.some(op => op.id === 'clear-wininet-user-proxy'), false, 'wininet op must not appear on darwin')
    assert.equal(macOps.some(op => op.id === 'reset-winsock'), false, 'winsock reset must not appear on darwin')
    assert.equal(macOps.some(op => op.id === 'flush-dns'), false, 'ipconfig flush-dns must not appear on darwin')
    assert.equal(macOps.some(op => op.id === 'clear-user-env-proxy'), false, 'Windows env op must not appear on darwin')
    assert.equal(macOps.some(op => op.id === 'mac-flush-dns'), true, 'mac flush-dns must appear on darwin')
    assert.equal(macOps.some(op => op.id === 'clear-dsh-process-proxy'), true, 'platform-neutral op must appear on darwin')
  })

  it('catalog keeps Windows operations on win32', async () => {
    const { operationsForPlatform } = await import('../../src/host/repair/catalog.ts')
    const winOps = operationsForPlatform('win32')
    assert.equal(winOps.some(op => op.id === 'clear-wininet-user-proxy'), true)
    assert.equal(winOps.some(op => op.id === 'flush-dns'), true)
    assert.equal(winOps.some(op => op.id === 'mac-flush-dns'), false, 'mac op must not appear on win32')
  })

  it('WSL keeps Windows-host operations (interop) but never macOS ones', async () => {
    const { operationsForPlatform } = await import('../../src/host/repair/catalog.ts')
    const wslOps = operationsForPlatform('linux')
    assert.equal(wslOps.some(op => op.id === 'clear-wininet-user-proxy'), true, 'Windows-host ops apply inside WSL via interop')
    assert.equal(wslOps.some(op => op.id === 'flush-dns'), true)
    assert.equal(wslOps.some(op => op.id === 'mac-flush-dns'), false, 'mac op must not appear on WSL')
    assert.equal(wslOps.some(op => op.id === 'clear-dsh-process-proxy'), true)
  })

  it('MAC_SHELL_PROXY_RESIDUE maps to mac-clear-shell-proxy in recommendations', () => {
    const ops = diagnosisActionOperations({ code: 'MAC_SHELL_PROXY_RESIDUE', scope: 'macos.shell', label: 'x', safe: true })
    assert.deepEqual(ops.map(op => op.id), ['mac-clear-shell-proxy'])
    assert.equal(isRecommendableOperation('mac-clear-shell-proxy'), true)
  })

  it('MAC_SCUTIL_PROXY_STALE maps to mac-clear-scutil-proxy in recommendations', () => {
    const ops = diagnosisActionOperations({ code: 'MAC_SCUTIL_PROXY_STALE', scope: 'macos.scutil', label: 'x', safe: true })
    assert.deepEqual(ops.map(op => op.id), ['mac-clear-scutil-proxy'])
    assert.equal(isRecommendableOperation('mac-clear-scutil-proxy'), true)
  })
})
