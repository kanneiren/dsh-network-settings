import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { collectModelServiceTargets } from '../../src/host/dsh/model-services.ts'

describe('DSH model service target collection', () => {
  const settings = {
    describe: () => [
      { ns: 'llm-deepseek', value: { baseURL: 'https://api.example.com/v1' } },
      { ns: 'llm-pi-ai', value: { providers: { anthropic: { baseURL: 'https://anthropic.example' } } } },
    ],
  }
  const llm = {
    listConfigurableProviders: () => [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'anthropic', displayName: 'Anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] },
      { provider: 'unknown-endpoint', displayName: 'Unknown', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'unknown-endpoint'] },
    ],
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
  }

  it('reads baseURL from settings without hardcoding endpoints', () => {
    const targets = collectModelServiceTargets(settings, llm)
    assert.equal(targets[0]?.baseURL, 'https://api.example.com/v1')
    assert.equal(targets[1]?.baseURL, 'https://anthropic.example')
    assert.equal(targets[2]?.baseURL, undefined)
    assert.equal(targets[0]?.active, true)
  })

  it('degrades to empty when services are absent or throw', () => {
    assert.deepEqual(collectModelServiceTargets({ describe: () => { throw new Error('no settings') } }, llm as never), [])
  })
})
