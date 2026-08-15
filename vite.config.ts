import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArU3i7COCluP1d1w24jyNo/YAES8ZOJCMQY6cfgVkzIv/b06aejPfVk3UgbVqoS31+YVJhf8WssYEzFiZKs8/k/UXnGamhfyC9kE4l1GHp9qSgYGaa0mbDLzgLndkrSPujazWeWFHVF22pdDzgSQ2gMG9yzKUvGDNvO3siNAnbXcd0z1cGtSyn+8XQhLVgM86n3ZSez/xHnnp0etAMUxLVy6dTxU5vVOflT2Npsc9eSVsteEUIgoXjw4wNJYpASHLHjMFLRXQZHzd/A94szX+kW8Oo2qmiK1L5gZN5gZjoES1mZJxbqyTYUkpA5DKOgRKIe+XUJntZw9pgJVxkQsQZQIDAQAB'

const OAUTH_SCOPE =
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'

function manifestPlugin(clientId: string): Plugin {
  return {
    name: 'gpfc-manifest',
    generateBundle() {
      const manifest = {
        manifest_version: 3,
        name: '__MSG_extensionName__',
        version: '1.1.0',
        description: '__MSG_extensionDescription__',
        default_locale: 'en',
        minimum_chrome_version: '120',
        key: EXTENSION_PUBLIC_KEY,
        permissions: ['identity', 'storage', 'activeTab', 'alarms'],
        host_permissions: [
          'https://chatgpt.com/*',
          'https://photospicker.googleapis.com/*',
          'https://lh3.googleusercontent.com/*',
        ],
        oauth2: {
          client_id: clientId,
          scopes: [OAUTH_SCOPE],
        },
        background: {
          service_worker: 'background.js',
          type: 'module',
        },
        action: {
          default_title: '__MSG_extensionName__',
          default_popup: 'popup.html',
        },
        options_page: 'options.html',
        content_scripts: [
          {
            matches: ['https://chatgpt.com/*'],
            js: ['content.js'],
            run_at: 'document_idle',
          },
        ],
        content_security_policy: {
          extension_pages: "script-src 'self'; object-src 'self'",
        },
      }

      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(manifest, null, 2) + '\n',
      })
      for (const locale of ['en', 'zh_CN']) {
        this.emitFile({
          type: 'asset',
          fileName: `_locales/${locale}/messages.json`,
          source: readFileSync(
            resolve(import.meta.dirname, '_locales', locale, 'messages.json'),
            'utf8',
          ),
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GPFC_')
  const clientId =
    env.GPFC_GOOGLE_CLIENT_ID?.trim() ||
    'REPLACE_WITH_CHROME_EXTENSION_OAUTH_CLIENT_ID.apps.googleusercontent.com'

  return {
    base: './',
    plugins: [manifestPlugin(clientId)],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production',
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(import.meta.dirname, 'popup.html'),
          options: resolve(import.meta.dirname, 'options.html'),
          test: resolve(import.meta.dirname, 'test.html'),
          background: resolve(import.meta.dirname, 'src/background.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  }
})
