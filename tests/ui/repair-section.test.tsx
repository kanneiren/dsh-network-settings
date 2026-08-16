// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RepairSection } from '../../src/client/RepairSection.tsx'
import { zh, type NetworkLocaleKey } from '../../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = (key: NetworkLocaleKey, params?: Record<string, string | number>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replaceAll('{scope}', String(params.scope ?? '')).replaceAll('{label}', String(params.label ?? ''))
}

const operation = {
  id: 'clear-dsh-process-proxy', label: '清除当前 DSH 进程代理', description: '只清除当前 DSH 进程代理',
  scope: 'dsh.process', risk: 'low', requiresAdmin: false, requiresReboot: false, recoverable: true, kind: 'configure',
}

function makeService(): any {
  const service = {
    repairCatalogMock: vi.fn(async () => [operation]),
    recommendedMock: vi.fn(async () => ({ recentlyAppliedIds: [], recommendations: [{ action: { code: 'STALE_DSH_PROXY_ENV', label: 'DSH 当前继承了旧代理', scope: 'dsh', safe: true }, operations: [operation] }] })),
    previewMock: vi.fn(async (_id: string) => ({ operation, preview: { scope: 'dsh.process', scopeDescription: '只会修改当前 DSH 进程', before: { HTTPS_PROXY: 'x' }, after: {}, diff: [{ path: '$.HTTPS_PROXY', before: 'x', after: undefined }], diffText: ['$.HTTPS_PROXY: "x" → undefined'], requiresElevation: false } })),
    applyMock: vi.fn(async (_id: string) => ({ operation, result: { scope: 'dsh.process', scopeDescription: '只会修改当前 DSH 进程', before: { HTTPS_PROXY: 'x' }, after: {}, diff: [], diffText: [], requiresElevation: false, snapshotId: 's1', applied: true } })),
    rollbackMock: vi.fn(async () => ({ snapshot: { id: 's1', timestamp: '2026-01-01T00:00:00.000Z', reason: 'test', scope: 'dsh.process', before: {}, reversible: true }, diff: [], diffText: [] })),
    listMock: vi.fn(async () => []),
    run: vi.fn(async () => {}),
    hostsEntries: vi.fn(async () => []),
    previewHostsDelete: vi.fn(async () => undefined),
    applyHostsDelete: vi.fn(async () => undefined),
  }
  return {
    ...service,
    repairCatalog: () => service.repairCatalogMock(),
    recommendedRepairs: (actions: any[]) => service.recommendedMock(actions),
    previewRepairOperation: (id: string) => service.previewMock(id),
    applyRepairOperation: (id: string) => service.applyMock(id),
    rollbackLatest: () => service.rollbackMock(),
    listSnapshots: () => service.listMock(),
  }
}

describe('RepairSection', () => {
  it('shows recommended independent operations and applies after preview', async () => {
    const service = makeService()
    render(<RepairSection service={service} diagnoses={[{ code: 'STALE_DSH_PROXY_ENV', severity: 'warning', confidence: 0.8, scope: 'dsh', humanMessage: 'DSH 当前继承了旧代理', technicalMessage: 'x', evidence: [], actions: [{ code: 'STALE_DSH_PROXY_ENV', label: 'DSH 当前继承了旧代理', scope: 'dsh', safe: true }] }]} t={t} />)
    expect(await screen.findByText('DSH 当前继承了旧代理')).toBeTruthy()
    expect(screen.getByText('推荐')).toBeTruthy()
    fireEvent.click(screen.getAllByText('执行').find(el => el.tagName === 'BUTTON')!)
    expect(await screen.findByText('只会修改当前 DSH 进程')).toBeTruthy()
    fireEvent.click(screen.getByText('确认修改'))
    await waitFor(() => expect(service.applyMock).toHaveBeenCalledOnce())
    expect(service.run).toHaveBeenCalledOnce()
  })
})
