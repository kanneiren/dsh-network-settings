/**
 * dsh-network-settings client half.
 * Registers the Network tab inside Settings → Plugins and calls the host half
 * only through the typed NetworkService. React components never execute
 * platform commands.
 */
import { createNetworkService } from './service.ts'
import { NetworkTab } from './NetworkTab.tsx'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale', 'connection'] as const

const NS = 'settings.network'

interface ClientContext {
  effect(thunk: () => unknown, label?: string): void
  slots: {
    inject(name: string, factory: () => unknown): void
    register(entry: unknown, component: unknown): unknown
  }
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): void
    bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
  }
  connection: Parameters<typeof createNetworkService>[0]
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-network-settings: locale')
  const t = ctx.locale.bind(NS)
  const service = createNetworkService(ctx.connection)
  const injected = () => ({ service, t })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'network',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, NetworkTab))
}
