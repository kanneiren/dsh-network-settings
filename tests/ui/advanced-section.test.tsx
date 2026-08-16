// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { AdvancedSection } from '../../src/client/AdvancedSection.tsx'
import { zh, type NetworkLocaleKey } from '../../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = (key: NetworkLocaleKey, params?: Record<string, string | number>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replaceAll('{risk}', String(params.risk ?? '')).replaceAll('{label}', String(params.label ?? ''))
}

function makeService(): any {
  const service = {
    advancedListMock: vi.fn(async () => [{
      id: 'flush-dns', label: '刷新 DNS 解析缓存', purpose: '清除 DNS 缓存', risk: 'low',
      requiresAdmin: false, requiresReboot: false, recoverable: true, command: 'ipconfig /flushdns',
    }]),
    advancedRunMock: vi.fn(async (_id: string) => ({
      action: { id: 'flush-dns', label: '刷新 DNS 解析缓存', purpose: '清除 DNS 缓存', risk: 'low', requiresAdmin: false, requiresReboot: false, recoverable: true, command: 'ipconfig /flushdns' },
      executedAt: '2026-01-01T00:00:00.000Z', code: 0, stdout: '', stderr: '',
    })),
    run: vi.fn(async () => {}),
  }
  return {
    ...service,
    advancedList: () => service.advancedListMock(),
    advancedRun: (id: string) => service.advancedRunMock(id),
  }
}

describe('AdvancedSection', () => {
  it('lists each action with risk/admin/reboot/recoverable and confirms execution', async () => {
    const service = makeService()
    render(<AdvancedSection service={service} t={t} />)
    expect(await screen.findByText('刷新 DNS 解析缓存')).toBeTruthy()
    expect(screen.getByText(/风险：low/)).toBeTruthy()
    fireEvent.click(screen.getAllByText('执行').find(el => el.tagName === 'BUTTON')!)
    const buttons = await screen.findAllByText('执行')
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(service.advancedRunMock).toHaveBeenCalledOnce())
    expect(service.run).toHaveBeenCalledOnce()
  })
})
