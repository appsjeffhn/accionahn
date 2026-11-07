import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The real package throws outside a react-server bundle; tests run in plain Node.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
      // same as tsconfig "paths", so route handlers can be imported by tests
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
