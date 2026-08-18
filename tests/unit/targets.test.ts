import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTargets, defaultTarget } from '../../src/host/network/index.ts'

describe('network targets', () => {
  it('includes DeepSeek and OpenAI public targets', () => {
    const { targets } = buildTargets(undefined)
    assert.ok(targets.some(target => target.id === 'deepseek' && target.host === 'api.deepseek.com' && target.port === 443))
    assert.ok(targets.some(target => target.id === 'openai' && target.host === 'api.openai.com' && target.port === 443))
  })

  it('defaults to DeepSeek even when a model service is available', () => {
    const model = [{ provider: 'deepseek-official', displayName: 'DeepSeek', active: true, settingsNs: 'x', baseURL: 'https://example.com/v1', baseURLSource: 'settings' as const }]
    assert.equal(defaultTarget(buildTargets(model).targets).id, 'deepseek')
    assert.equal(defaultTarget(buildTargets(undefined).targets).id, 'deepseek')
  })
})
