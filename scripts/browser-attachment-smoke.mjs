/* global document, window */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const profile = resolve('.cache/browser-attachment-profile')
await mkdir(profile, { recursive: true })
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-first-run', '--disable-features=AutofillAiWalletPrivatePasses'],
})
try {
  await context.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><form id="composer"><textarea id="prompt-textarea"></textarea><div hidden><input id="upload" type="file" multiple accept="image/*"></div></form></body></html>',
  }))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.gpfcListeners = []
    Object.assign(globalThis.chrome ??= {}, {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        onMessage: { addListener: (listener) => window.gpfcListeners.push(listener) },
      },
      i18n: { getMessage: () => '' },
    })
  })
  const results = []
  async function reset() {
    await page.goto('https://chatgpt.com/')
    await page.addScriptTag({ path: resolve('dist/content.js') })
  }
  async function attach(count) {
    return page.evaluate((photoCount) => new Promise((resolveReply) => {
      const handled = window.gpfcListeners.some((listener) => listener(
        { type: 'RUN_PHASE2', count: photoCount }, {}, resolveReply,
      ))
      if (!handled) throw new Error('Missing production attachment listener')
    }), count)
  }
  for (const count of [1, 3, 5]) {
    await reset()
    await page.evaluate(() => {
      document.querySelector('#upload').addEventListener('change', (event) => {
        window.uploaded = [...event.target.files].map((file) => ({ name: file.name, size: file.size, type: file.type }))
        const preview = document.createElement('div')
        preview.dataset.testid = 'attachment-preview'
        document.querySelector('#composer').append(preview)
      })
    })
    const response = await attach(count)
    assert.equal(response.ok, true)
    assert.match(response.detail, /composer DOM changed/)
    const files = await page.evaluate(() => window.uploaded)
    assert.equal(files.length, count)
    assert.ok(files.every((file) => file.size > 0 && file.type === 'image/png'))
    results.push({ name: 'native FileList upload', count, passed: true })
  }
  await reset()
  await page.evaluate(() => {
    const old = document.querySelector('#composer')
    const next = old.cloneNode(true)
    old.hidden = true
    old.id = 'old-composer'
    next.querySelector('input').id = 'new-upload'
    old.after(next)
    document.querySelector('#new-upload').addEventListener('change', (event) => {
      window.uploaded = event.target.files.length
      const preview = document.createElement('div')
      preview.dataset.testid = 'attachment-preview'
      next.append(preview)
    })
  })
  await attach(3)
  assert.equal(await page.evaluate(() => window.uploaded), 3)
  results.push({ name: 'SPA replacement with retained hidden input', passed: true })

  await reset()
  await page.evaluate(() => {
    document.querySelector('#upload').remove()
    const composer = document.querySelector('#composer')
    composer.addEventListener('dragover', (event) => event.preventDefault())
  })
  const rejected = await attach(1)
  assert.match(rejected.detail, /did not accept drag-and-drop/)
  results.push({ name: 'dragover cancellation alone is not upload success', passed: true })

  await reset()
  await page.evaluate(() => {
    const general = document.createElement('input')
    general.type = 'file'
    general.multiple = true
    document.querySelector('#composer').append(general)
    general.addEventListener('change', (event) => {
      const file = event.target.files[0]
      window.videoReceived = { name: file.name, type: file.type, size: file.size }
      const preview = document.createElement('video')
      document.querySelector('#composer').append(preview)
    })
    globalThis.chrome.runtime.connect = () => {
      let receive
      return {
        onMessage: { addListener: (listener) => { receive = listener } },
        onDisconnect: { addListener() {} }, disconnect() {},
        postMessage: () => queueMicrotask(() => {
          for (const message of [
            { type: 'FILE_START', index: 0, filename: 'clip.mp4', mimeType: 'video/mp4', lastModified: 1 },
            { type: 'FILE_CHUNK', index: 0, base64: 'AAECAw==' },
            { type: 'FILE_END', index: 0, size: 4 },
            { type: 'ALL_DONE', downloaded: 1, skipped: [] },
          ]) receive(message)
        }),
      }
    }
    globalThis.chrome.runtime.sendMessage = async (request) => {
      if (request.type === 'ATTACH_RESULT') window.videoResult = request.result
      return { ok: true }
    }
    for (const listener of window.gpfcListeners) listener({
      type: 'JOB_STATUS', targetTabId: 1, job: {
        id: 'video-job', targetTabId: 1, targetKind: 'chatgpt', status: 'ready',
        selectedCount: 1, warnings: [], message: '', updatedAt: Date.now(),
      },
    }, {}, () => {})
  })
  await page.waitForFunction(() => window.videoResult)
  assert.deepEqual(await page.evaluate(() => window.videoReceived), { name: 'clip.mp4', type: 'video/mp4', size: 4 })
  assert.equal(await page.evaluate(() => window.videoResult.method), 'file-input')
  results.push({ name: 'video chunks become a native FileList in a general upload input', passed: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({
    environment: 'Isolated headless Chrome; local ChatGPT fixture; production content bundle; stubbed extension messaging; no external upload',
    checks: results,
  }, null, 2))
} finally {
  await context.close()
}
