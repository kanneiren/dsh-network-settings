/**
 * Architecture constraint tests — prevent structural degradation.
 *
 * These tests enforce the layering rules documented in docs/architecture.md:
 *   L3 (pure core) must not have RUNTIME imports from L1/L2/L4
 *   Client must not import from host platform collector FILES
 *   Diagnosis must not spawn processes
 *   UI must not scatter platform checks
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, basename, sep } from 'node:path'

const norm = (p: string): string => p.split(sep).join('/')
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [norm(join(d, e.name))] : []
  )

const read = (f: string): string => readFileSync(f, 'utf8')

/** Strip type-only imports — they don't create runtime dependencies. */
function runtimeImports(src: string): string {
  return src.replace(/^import type .*$/gm, '')
}

describe('architecture constraints', () => {
  it('L3 pure core has no runtime imports from effectful layers', () => {
    const l3Modules = [
      'network/shared.ts', 'network/build-windows.ts', 'network/build-wsl.ts',
      'network/build-mac.ts', 'network/drift.ts', 'diagnose/rules.ts',
    ]
    const forbiddenPatterns = [
      /from '\.\.\/windows\/inspect/,
      /from '\.\.\/wsl\/inspect/,
      /from '\.\.\/mac\/inspect/,
      /from '\.\.\/probe\//,
      /from '\.\.\/configure\//,
      /from '\.\.\/repair\/advanced/,
      /from '\.\.\/repair\/hosts/,
      /from '\.\.\/runtime\/powershell/,
      /runCommand\(/,
      /runPowerShell\(/,
    ]
    for (const mod of l3Modules) {
      const src = runtimeImports(read(join('src/host', mod)))
      for (const pattern of forbiddenPatterns) {
        assert.equal(pattern.test(src), false,
          `${mod} violates L3 purity: ${pattern} found`)
      }
    }
  })

  it('client has no file-level imports from host platform collectors', () => {
    const clientFiles = walk('src/client').filter(f => !f.endsWith('.d.ts'))
    const forbiddenImports = [
      /from '\.\.\/host\//,
      /from '\.\.\/\.\.\/src\/host\//,
    ]
    for (const f of clientFiles) {
      const src = runtimeImports(read(f))
      for (const pattern of forbiddenImports) {
        assert.equal(pattern.test(src), false,
          `${basename(f)} imports from host — client/platform boundary violation`)
      }
    }
  })

  it('diagnosis rules do not spawn processes or execute commands', () => {
    const src = read('src/host/diagnose/rules.ts')
    assert.equal(src.includes('runCommand('), false)
    assert.equal(src.includes('runPowerShell('), false)
    assert.equal(src.includes('spawn('), false)
    assert.equal(src.includes('child_process'), false)
  })

  it('UI platform checks are concentrated, not scattered (≤5 per component)', () => {
    const uiFiles = ['src/client/NetworkConfig.tsx', 'src/client/NetworkTab.tsx', 'src/client/RepairSection.tsx']
    for (const f of uiFiles) {
      const src = read(f)
      const count = (src.match(/runtime\.type\s*===/g) ?? []).length
      assert.ok(count <= 8,
        `${basename(f)} has ${count} runtime.type checks — use platformOf() helper to concentrate`)
    }
  })
})
