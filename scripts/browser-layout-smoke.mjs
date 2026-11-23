/* global document, getComputedStyle */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const profile = await mkdtemp(join(tmpdir(), 'gpfc-layout-'))
const contentPath = resolve(process.env.GPFC_CONTENT_PATH || 'dist/content.js')
const fixture = `<!doctype html><html><head><style>
  body { margin: 0; font: 16px system-ui; }
  #shell { position: fixed; bottom: 40px; left: 20%; width: 60%; }
  form { margin: 0; height: 100px; border: 1px solid #888; border-radius: 24px; box-sizing: border-box; }
  #prompt-textarea { min-height: 40px; margin: 10px 16px; }
  [data-testid="composer-plus-btn"] { position: absolute; bottom: 8px; left: 12px; width: 32px; height: 32px; }
  @media(max-width: 500px) { #shell { left: 10px; width: calc(100% - 20px); } }
</style></head><body><main><div id="shell"><form id="composer">
<div id="prompt-textarea" contenteditable="true" role="textbox"></div>
<button type="button" data-testid="composer-plus-btn">+</button>
</form></div></main></body></html>`
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--disable-features=AutofillAiWalletPrivatePasses'],
  })
  // Test the production content bundle in a real layout engine. Runtime
  // messages are stubbed; no live ChatGPT, Google account or extension storage
  // is accessed. This is layout verification, not a full integration test.
  await context.route('**/*', (route) => {
    if (route.request().url() === 'https://chatgpt.com/') {
      return route.fulfill({ contentType: 'text/html', body: fixture })
    }
    return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => {
    Object.assign(globalThis.chrome ??= {}, {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        onMessage: { addListener() {} },
      },
      i18n: { getMessage: () => '' },
    })
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('https://chatgpt.com/')
  await page.addScriptTag({ path: contentPath })
  await page.waitForSelector('#gpfc-google-photos-button')
  const results = []
  async function check(name) {
    await page.waitForFunction(() => {
      const host = document.querySelector('#gpfc-extension-ui')
      const composer = document.querySelector('#composer')
      if (!host || !composer || getComputedStyle(host).display === 'none') return false
      const root = composer.getBoundingClientRect()
      const button = host.getBoundingClientRect()
      const plus = composer.querySelector('[data-testid="composer-plus-btn"]').getBoundingClientRect()
      const expectedLeft = plus.left + (plus.width - 32) / 2
      const expectedTop = root.top - 40
      return Math.abs(button.left - expectedLeft) <= 1 && Math.abs(button.top - expectedTop) <= 1
    }, undefined, { timeout: 5000 }).catch((error) => {
      throw new Error('Layout check failed: ' + name, { cause: error })
    })
    const snapshot = await page.evaluate(() => {
      const host = document.querySelector('#gpfc-extension-ui')
      const rect = host.getBoundingClientRect()
      return {
        count: document.querySelectorAll('#gpfc-google-photos-button').length,
        mode: host.dataset.gpfcPosition,
        parent: host.parentElement.tagName,
        left: rect.left, top: rect.top,
        width: rect.width, height: rect.height,
      }
    })
    assert.equal(snapshot.count, 1)
    assert.equal(snapshot.parent, 'HTML')
    assert.equal(snapshot.width, 32)
    assert.equal(snapshot.height, 32)
    results.push({ name, ...snapshot })
  }
  await check('desktop initial')
  await page.evaluate(() => { document.querySelector('#composer').style.height = '240px' })
  await check('multiline input')
  await page.evaluate(() => {
    const shell = document.querySelector('#shell')
    shell.style.left = '30%'
    shell.style.width = '50%'
  })
  await check('sidebar resized')
  await page.evaluate(() => {
    document.querySelector('#composer').animate([{ height: '240px' }, { height: '160px' }], { duration: 180, fill: 'forwards' })
  })
  await page.evaluate(async () => {
    await Promise.all(document.querySelector('#composer').getAnimations().map((animation) => animation.finished))
  })
  await check('size animation without DOM changes')
  await page.evaluate(() => {
    const old = document.querySelector('#composer')
    const next = old.cloneNode(true)
    old.id = 'retained-old-composer'
    old.hidden = true
    old.querySelector('#prompt-textarea').removeAttribute('id')
    next.style.height = '140px'
    old.after(next)
  })
  await check('route replacement with hidden retained form')
  await page.evaluate(() => {
    const shell = document.querySelector('#shell')
    shell.style.left = ''
    shell.style.width = ''
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await check('narrow mobile viewport')
  await page.setViewportSize({ width: 390, height: 400 })
  await check('keyboard sized viewport')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  await page.addScriptTag({ path: contentPath })
  await page.waitForSelector('#gpfc-google-photos-button')
  await check('page reload without duplicates')
  await page.evaluate(() => { document.querySelector('#composer').hidden = true })
  await page.waitForFunction(() => {
    const host = document.querySelector('#gpfc-extension-ui')
    return getComputedStyle(host).display !== 'none' && host.dataset.gpfcPosition === 'viewport-fallback'
  })
  results.push({ name: 'no visible composer', fallbackVisible: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({
    environment: 'Isolated headless Chrome, production content bundle, local fixture, stubbed runtime messages',
    contentPath, checks: results,
  }, null, 2))
} finally {
  await context?.close()
  // Only the unique directory created by mkdtemp above is removed.
  await rm(profile, { recursive: true, force: true })
}
