/* global chrome, document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const extensionPath = resolve('dist')
const context = await chromium.launchPersistentContext(resolve('.cache/browser-picker-reopen-profile'), {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-features=AutofillAiWalletPrivatePasses', '--enable-unsafe-extension-debugging', '--no-first-run'],
})

try {
  // These routes and the mock worker fetch below prevent access to live accounts.
  await context.route('https://**/*', (route) => route.abort())
  await context.route('https://photos.google.com/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Local mock Picker</title>',
  }))
  await context.route('https://chatgpt.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>
      #shell { position: fixed; bottom: 40px; left: 30%; width: 40%; height: 100px; }
      #visual-composer { position: fixed; left: 5%; right: 5%; bottom: 40px; height: 100px; border: 1px solid; }
      #composer-plus-btn { position: absolute; left: 16px; bottom: 30px; width: 32px; height: 32px; }
      #voice { position: absolute; right: 16px; bottom: 30px; width: 32px; height: 32px; }
      #ghost-sidebar { position: fixed; left: 0; top: 0; width: 32%; height: 100vh; pointer-events: none; }
      #history { position: fixed; left: 5%; bottom: 110px; width: 90%; height: 380px; }
      #history p { margin-left: 100px; }
      #hidden-layer { position: fixed; inset: 0; opacity: 0; pointer-events: none; }
      #hidden-dialog { position: absolute; left: 700px; top: 50px; width: 200px; height: 100px; }
    </style></head><body><nav id="ghost-sidebar"></nav><article id="history" data-testid="conversation-turn-1" data-message-author-role="assistant"><p>Previous conversation</p></article>
    <div id="hidden-layer"><div id="hidden-dialog" role="dialog" aria-modal="true">Hidden</div></div>
    <main><div id="shell"><form id="composer"><div id="visual-composer">
      <button id="composer-plus-btn" data-testid="composer-plus-btn" type="button">+</button>
      <textarea id="prompt-textarea"></textarea><input id="upload" type="file" multiple accept="image/*">
      <button id="voice" aria-label="Start Voice" type="button">V</button>
    </div></form></div></main></body></html>`,
  }))
  const manager = await context.newPage()
  await manager.goto('chrome://extensions/')
  const developerMode = manager.locator('#devMode')
  if (!await developerMode.evaluate((toggle) => toggle.checked)) await developerMode.click()
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath })
  assert.equal(id, 'igacbcmbkglkglkindhcpmagafnboolj')
  let worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://' + id + '/'))
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 })

  await worker.evaluate(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    await chrome.storage.local.remove('gpfcGoogleAuthDisconnected')
    await chrome.storage.local.set({ gpfcGoogleWebOAuth: {
      token: 'synthetic-test-token', grantedScopes: ['https://www.googleapis.com/auth/photospicker.mediaitems.readonly'],
      expiresAt: Date.now() + 3600_000, selectedAt: 1, loginHint: 'synthetic-account',
    } })
    await chrome.storage.session.remove(['gpfcJobs', 'gpfcStandbyPickerSession', 'gpfcGoogleWebOAuth'])
    const state = { created: 0, waiting: false, release: undefined }
    globalThis.__gpfcPickerTest = state
    const session = (id, completed = false) => ({
      id, pickerUri: 'https://photos.google.com/picker/' + id,
      expireTime: new Date(Date.now() + 60_000).toISOString(), mediaItemsSet: completed,
      pollingConfig: { pollInterval: '2s', timeoutIn: '60s' },
    })
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url)
      const method = (init.method || 'GET').toUpperCase()
      if (url.hostname === 'photospicker.googleapis.com' && url.pathname === '/v1/sessions' && method === 'POST') {
        state.created += 1
        return Response.json(session('mock-' + state.created))
      }
      if (url.hostname === 'photospicker.googleapis.com' && url.pathname.startsWith('/v1/sessions/')) {
        const sessionId = decodeURIComponent(url.pathname.split('/').pop())
        if (method === 'DELETE') return new Response('', { status: 200 })
        if (sessionId === 'mock-1') {
          state.waiting = true
          await new Promise((resolve) => { state.release = resolve })
          return Response.json(session(sessionId, true))
        }
        return Response.json(session(sessionId))
      }
      if (url.hostname === 'photospicker.googleapis.com' && url.pathname === '/v1/mediaItems') {
        return Response.json({ mediaItems: [{
          id: 'synthetic', type: 'PHOTO', createTime: new Date().toISOString(),
          mediaFile: { baseUrl: 'https://lh3.googleusercontent.com/synthetic', filename: 'synthetic.png', mimeType: 'image/png' },
        }] })
      }
      if (url.hostname === 'lh3.googleusercontent.com') {
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4sUAAAAASUVORK5CYII='), (char) => char.charCodeAt(0))
        return new Response(bytes, { headers: { 'content-type': 'image/png' } })
      }
      throw new Error('Unexpected network request in isolated test')
    }
  })

  const chat = await context.newPage()
  await chat.goto('https://chatgpt.com/')
  await chat.evaluate(() => {
    document.querySelector('#upload').addEventListener('change', (event) => {
      const preview = document.createElement('span')
      preview.dataset.testid = 'attachment-preview'
      preview.textContent = event.target.files[0].name
      document.querySelector('#composer').append(preview)
    })
  })
  const button = chat.locator('#gpfc-google-photos-button')
  await button.waitFor()
  const positions = await chat.evaluate(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    const form = document.querySelector('#composer').getBoundingClientRect()
    return { icon: { left: icon.left, width: icon.width }, plus: { left: plus.left, width: plus.width }, form: { left: form.left, width: form.width }, mode: document.querySelector('#gpfc-extension-ui').dataset.gpfcPosition }
  })
  assert.ok(Math.abs((positions.icon.left + positions.icon.width / 2) - (positions.plus.left + positions.plus.width / 2)) <= 2,
    'The actual extension must align with the widened visible composer: ' + JSON.stringify(positions))
  const firstPopupPromise = context.waitForEvent('page', { timeout: 5000 })
  await button.click()
  const firstPopup = await firstPopupPromise
  await firstPopup.waitForURL('https://photos.google.com/**')
  await chat.waitForFunction(() => !document.querySelector('#gpfc-google-photos-button').disabled)
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const stored = await chrome.storage.session.get('gpfcStandbyPickerSession')
      if (stored.gpfcStandbyPickerSession && !stored.gpfcStandbyPickerSession.used) return
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw new Error('The synthetic standby session was not prepared.')
  })
  await firstPopup.close()
  await worker.evaluate(async () => {
    const deadline = Date.now() + 3000
    while (!globalThis.__gpfcPickerTest.waiting && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!globalThis.__gpfcPickerTest.waiting) throw new Error('The first close did not start its completion check.')
  })
  await chat.bringToFront()
  const startedAt = Date.now()
  const secondPopupPromise = context.waitForEvent('page', { timeout: 4000 })
  await button.click()
  const secondPopup = await secondPopupPromise
  await secondPopup.waitForURL('https://photos.google.com/**')
  assert.ok(Date.now() - startedAt < 4000, 'A new Picker should not wait for the earlier completion check')
  await worker.evaluate(() => globalThis.__gpfcPickerTest.release())
  await chat.waitForFunction(() => document.querySelector('[data-testid="attachment-preview"]')?.textContent === 'synthetic.png', undefined, { timeout: 6000 })
  assert.equal(secondPopup.isClosed(), false, 'The older result must not close the newly opened Picker')
  console.log('Passed: actual extension aligns with the widened composer, stays visible in a long chat, reopens its popup, and attaches the earlier synthetic selection.')
} finally {
  await context.close()
}
