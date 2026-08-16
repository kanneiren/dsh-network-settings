/** DSH model-service target collection from Host services (no hardcoding). */
import type { ModelServiceTarget } from '../model.ts'

interface SettingsFace {
  describe(options: { redactSecrets: boolean }): { ns: string; value: unknown }[]
}

interface LlmFace {
  listConfigurableProviders(): { provider: string; displayName: string; settingsNs: string; settingsPath: readonly string[] }[]
  listProviders(): { id: string; name: string }[]
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function baseUrlFromDescriptor(value: unknown, settingsPath: readonly string[]): string | undefined {
  let cursor: unknown = value
  for (const segment of settingsPath) {
    const object = objectValue(cursor)
    cursor = object?.[segment]
  }
  const object = objectValue(cursor)
  return typeof object?.['baseURL'] === 'string' && object['baseURL'] !== '' ? object['baseURL'] : undefined
}

/** Resolve active providers and explicitly configured base URLs. */
export function collectModelServiceTargets(settings: SettingsFace, llm: LlmFace): ModelServiceTarget[] {
  try {
    const descriptors = settings.describe({ redactSecrets: true })
    const byNamespace = new Map(descriptors.map(descriptor => [descriptor.ns, descriptor.value]))
    const live = new Set(llm.listProviders().map(provider => provider.id))
    const targets: ModelServiceTarget[] = []
    for (const provider of llm.listConfigurableProviders()) {
      const value = byNamespace.get(provider.settingsNs)
      const baseURL = value === undefined ? undefined : baseUrlFromDescriptor(value, provider.settingsPath)
      const environment = provider.provider === 'deepseek-official' && baseURL === undefined
        ? process.env['DEEPSEEK_BASE_URL']
        : undefined
      targets.push({
        provider: provider.provider,
        displayName: provider.displayName,
        active: live.has(provider.provider),
        settingsNs: provider.settingsNs,
        ...baseURL !== undefined ? { baseURL, baseURLSource: 'settings' as const } : {},
        ...baseURL === undefined && environment !== undefined ? { baseURL: environment, baseURLSource: 'environment' as const } : {},
        ...baseURL === undefined && environment === undefined ? { baseURLSource: 'unknown' as const } : {},
      })
    }
    return targets
  } catch {
    return []
  }
}
