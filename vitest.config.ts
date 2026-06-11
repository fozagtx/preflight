import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Vitest config. The @ alias matches the @/* path in tsconfig.json.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // each test file imports describe/it/expect from 'vitest'
    globals: false,
  },
})
