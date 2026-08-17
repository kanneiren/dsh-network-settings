// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ConfigureSection } from '../../src/client/ConfigureSection.tsx'
import { zh, type NetworkLocaleKey } from '../../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = (key: NetworkLocaleKey, params?: Record<string, string | number>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replaceAll('{mode}', String(params.mode ?? '')).replaceAll('{value}', String(params.value ?? ''))
}

function inspection(): any {
  return {
    runtime: { platform: 'win32', version: 'v22' },
    windows: {
      network: { interfaces: [], defaultRoutes: [] },
      proxy: {
        wininet: { enabled: true, proxyServer: '127.0.0.1:7890', autoDetect: false },
        winhttp: [{ scope: 'user', proxyEnabled: false, autoConfigEnabled: false, autoDetect: false }],
        endpoints: [],
      },
      environment: { scopes: { process: {}, user: {}, machine: {}, dsh: {} } },
      hosts: { overrides: [] },
      listeners: [],
      dshProcessEnvironment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      modelServices: [],
    },
    wsl: {
      available: true,
      globalConfig: { mode: 'mirrored', modeConfigured: true, modeSupported: true, autoProxy: true, dnsTunneling: true },
      distributions: [],
    },
    probes: [],
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

describe('ConfigureSection (read-only status)', () => {
  it('shows only enabled scopes and collapses disabled scopes', () => {
    render(<ConfigureSection inspection={inspection()} t={t} />)
    expect(screen.getByText(zh.configureTitle)).toBeTruthy()
    expect(screen.getByText(zh.clearWininet)).toBeTruthy()
    expect(screen.getByText(zh.clearDshEnv)).toBeTruthy()
    expect(screen.getByText('127.0.0.1:7890')).toBeTruthy()
    expect(screen.getByText(/未启用配置/)).toBeTruthy()
    expect(screen.queryByText(zh.wslGlobalNetwork)).toBeNull()
  })
})
