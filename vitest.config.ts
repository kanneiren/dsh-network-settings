import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/ui/primitives-mock.tsx', import.meta.url)),
    },
  },
  test: {
    include: ['tests/ui/**/*.test.tsx', 'tests/ui/**/*.test.ts'],
    environment: 'node',
  },
})
