import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: mode !== 'production',
    lib: {
      entry: resolve(import.meta.dirname, 'src/content.ts'),
      name: 'GooglePhotosForChatGPTContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
}))
