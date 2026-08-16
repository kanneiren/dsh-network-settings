/**
 * tsdown preset for a dual-face DSH plugin package.
 * Mirrors the client bundle contract of deepseek-harness
 * (packages/client/tsdown.client.ts) and the public @dshthemes/ui build:
 * - host half: ESM library;
 * - client half: CJS factory registered through
 *   `window.__ModuleLoader__.load({ id, factory })`;
 * - CSS Modules are inlined by lightningcss and inject one style tag per
 *   plugin module (`<style data-plugin="<id>" data-plugin-css="<tagId>">`).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { TsdownPlugin, UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

export const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
] as const

const HOST_MODULE = /^@deepseek-ai(?:\/|$)/
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

export interface ClientBundleOptions {
  externals?: readonly string[]
  bundledDependencies?: readonly string[]
}

function matchesModule(id: string, moduleId: string): boolean {
  return id === moduleId || id.startsWith(`${moduleId}/`)
}

function isClientExternal(id: string, externals: readonly string[]): boolean {
  return HOST_MODULE.test(id) || externals.some(item => matchesModule(id, item))
}

function cssModulesPlugin(id: string): TsdownPlugin {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolve(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      if (!existsSync(fileId)) return null
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) {
        classMap[local] = exp.name
      }
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${id}/${fileId.split('/').pop()}`)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        '  const tag = document.createElement("style");',
        `  tag.dataset.plugin = ${JSON.stringify(id)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

export function clientBundle(
  id: string,
  libEntry: string,
  clientEntry: string,
  options: ClientBundleOptions = {},
): UserConfig[] {
  const clientExternals = [...PLATFORM_MODULES, ...(options.externals ?? [])]
  const bundledDependencies = options.bundledDependencies ?? []
  return [
    {
      name: id,
      entry: { index: libEntry },
      outDir: 'lib',
      format: ['esm'],
      fixedExtension: false,
      dts: false,
      clean: false,
    },
    {
      name: `${id}/client`,
      entry: { client: clientEntry },
      outDir: 'lib',
      format: 'cjs',
      platform: 'browser',
      clean: false,
      deps: {
        neverBundle: [HOST_MODULE, ...clientExternals],
        alwaysBundle: specifier => bundledDependencies.some(dependency => matchesModule(specifier, dependency)) && !isClientExternal(specifier, clientExternals),
        onlyBundle: [...bundledDependencies],
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      },
      plugins: [cssModulesPlugin(id)],
      outputOptions: {
        entryFileNames: 'client.js',
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
        footer: 'return module.exports; } });',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
      },
    },
  ]
}
