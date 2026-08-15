import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: process.cwd(),
  resolve: { preserveSymlinks: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
})
