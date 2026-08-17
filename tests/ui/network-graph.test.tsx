// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NetworkGraph } from '../../src/client/NetworkGraph.tsx'
import { zh } from '../../src/client/locales.ts'
import type { NetworkLocaleKey } from '../../src/client/locales.ts'
import type { NetworkPathGraph, NetworkPathSummary } from '../../src/client/contract.ts'

const t = (key: NetworkLocaleKey, params?: Record<string, string | number>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replaceAll('{target}', String(params.target ?? ''))
}

const graph: NetworkPathGraph = {
  model: 'WINDOWS_NATIVE',
  runtime: { type: 'WINDOWS_NATIVE', platform: 'win32', nodeVersion: 'v22.19.0', confidence: 'verified' },
  target: { id: 'deepseek', label: 'DeepSeek', host: 'api.deepseek.com', port: 443, url: 'https://api.deepseek.com', kind: 'deepseek', display: 'api.deepseek.com:443' },
  dshPath: {
    id: 'dsh', label: 'DSH', status: 'error',
    egress: {
      mode: 'PROXY',
      proxyConfiguration: { id: 'dsh:env', source: 'DSH Process / HTTPS_PROXY', sourceKey: 'DSH_PROCESS_ENV', mode: 'FIXED_SERVERS', displayValue: 'http://127.0.0.1:7890', host: '127.0.0.1', port: 7890, evidence: [] },
      proxyEndpoint: {
        id: 'proxy:127.0.0.1:7890', host: '127.0.0.1', port: 7890, scheme: 'http', state: 'UNREACHABLE', configurationIds: ['dsh:env'],
        listener: { address: '127.0.0.1', port: 7890, state: 'NOT_FOUND', evidence: [] }, reachableFrom: [], evidence: [],
      },
    },
    nodes: [
      { id: 'dsh:process', type: 'PROCESS', role: 'main', label: 'DSH', status: 'healthy' },
      { id: 'dsh:host', type: 'HOST', role: 'main', label: 'Windows', status: 'healthy' },
      { id: 'dsh:proxy', type: 'PROXY', role: 'main', label: 'Proxy :7890', address: '127.0.0.1', port: 7890, status: 'error' },
      { id: 'dsh:internet', type: 'INTERNET', role: 'main', label: 'Internet', status: 'not-applicable' },
      { id: 'dsh:target', type: 'TARGET', role: 'main', label: 'api.deepseek.com:443', status: 'not-applicable' },
    ],
    edges: [
      { from: 'dsh:process', to: 'dsh:host', relation: 'DIRECT', status: 'healthy' },
      { from: 'dsh:host', to: 'dsh:proxy', relation: 'PROXY', status: 'error', label: 'HTTPS_PROXY · TCP ✕' },
      { from: 'dsh:proxy', to: 'dsh:internet', relation: 'ROUTE', status: 'not-applicable' },
      { from: 'dsh:internet', to: 'dsh:target', relation: 'TARGET_CONNECTION', status: 'not-applicable' },
    ],
    dns: [{ id: 'dsh:dns', host: 'api.deepseek.com', resolvedAddresses: [], status: 'not-applicable', resolution: 'DELEGATED_TO_PROXY', evidence: [] }],
    firstFailingEdgeId: 'dsh:host->dsh:proxy',
  },
  diagnostics: [{
    code: 'DRIFT_DSH_PROXY_STALE', severity: 'error', confidence: 0.95, pathIds: ['dsh'],
    humanMessage: '发现配置漂移：DSH 仍在使用已经失效的代理配置。', technicalMessage: 'no listener',
    evidence: [{ source: 'PROCESS_TABLE', confidence: 'verified', value: 'no listener' }],
    actions: [{ code: 'clear-dsh-process-proxy', scope: 'dsh.process', label: '清除当前 DSH 进程的失效代理配置', safe: true }],
  }],
  recommendedRepair: { diagnosisCode: 'DRIFT_DSH_PROXY_STALE', actionCodes: ['clear-dsh-process-proxy'], label: '清除当前 DSH 进程的失效代理配置' },
  generatedAt: '2026-01-01T00:00:00.000Z',
}

const summary: NetworkPathSummary = {
  model: 'WINDOWS_NATIVE', target: graph.target,
  dsh: { status: 'error', label: 'DSH' }, problemCount: 1,
}

describe('NetworkGraph', () => {
  it('renders a single DSH lane, first failure and drift diagnosis', () => {
    render(<NetworkGraph graph={graph} summary={summary} t={t} />)
    expect(screen.getAllByText('DSH').length).toBeGreaterThan(0)
    expect(screen.getByText('问题出现在：')).toBeTruthy()
    expect(screen.getByText('Windows → Proxy :7890')).toBeTruthy()
    const detailButton = screen.getAllByText('查看详情')[0]!
    fireEvent.click(detailButton.closest('button')!)
    expect(screen.getByText('失败层')).toBeTruthy()
    expect(screen.getByText('错误信息')).toBeTruthy()
    expect(screen.queryByText('Windows 浏览器')).toBeNull()
  })
})
