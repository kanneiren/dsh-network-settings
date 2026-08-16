import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('NetworkTab CSS uses only DSH tokens', () => {
  const css = readFileSync(new URL('../../src/client/NetworkTab.module.css', import.meta.url), 'utf8')

  it('contains no literal colors', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgb\(|\brgba\(/)
  })

  it('contains no global element or dark-theme selectors', () => {
    expect(css).not.toMatch(/(^|[,{])body/)
    expect(css).not.toMatch(/data-ds-dark-theme|prefers-color-scheme/)
  })

  it('consumes semantic DSH alias tokens', () => {
    expect(css).toMatch(/var\(--dsw-alias-/)
  })
})
