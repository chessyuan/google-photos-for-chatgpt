/* global document, getComputedStyle, requestAnimationFrame, window */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const context = await chromium.launchPersistentContext(resolve('.cache/browser-overlap-profile'), {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: ['--no-first-run', '--disable-features=AutofillAiWalletPrivatePasses'],
})

try {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>
      body { margin: 0; font: 16px system-ui; }
      #shell { position: fixed; bottom: 40px; left: 400px; width: 600px; }
      form { height: 100px; margin: 0; border: 1px solid; box-sizing: border-box; }
      #prompt-textarea { min-height: 35px; margin: 10px; }
      [data-testid="composer-plus-btn"] { position: absolute; bottom: 8px; left: 12px; width: 32px; height: 32px; }
      #voice { position: absolute; bottom: 8px; right: 12px; width: 32px; height: 32px; }
      #voice-tooltip { position: absolute; right: 0; bottom: 104px; width: 100px; height: 28px; display: none; }
      #voice:hover + #voice-tooltip { display: block; }
      #sidebar { position: fixed; top: 0; left: 0; height: 100vh; width: 380px; background: #ddd; }
      #sidebar[hidden] { display: none; }
      .blocker { position: fixed; width: 32px; height: 32px; background: #bbb; }
    </style></head><body><div id="sidebar" hidden><button id="sidebar-action">Action</button></div>
    <main><div id="shell"><form id="composer"><div id="prompt-textarea" contenteditable="true" role="textbox"></div>
    <button type="button" data-testid="composer-plus-btn">+</button>
    <button type="button" id="voice" aria-label="Start Voice">V</button><div id="voice-tooltip" role="tooltip">Start Voice</div>
    </form></div></main></body></html>`,
  }))
  await page.addInitScript(() => {
    globalThis.__gpfcTestMessages = []
    Object.assign(globalThis.chrome ??= {}, {
      runtime: {
        sendMessage: async (request) => { globalThis.__gpfcTestMessages.push(request.type); return { ok: true } },
        onMessage: { addListener() {} },
      },
      i18n: { getMessage: () => '' },
    })
  })
  await page.goto('https://chatgpt.com/')
  await page.addScriptTag({ path: resolve('dist/content.js') })
  await page.locator('#gpfc-google-photos-button').waitFor()
  await page.waitForFunction(() => globalThis.__gpfcTestMessages.includes('WARM_PICKER'))
  const initialWarmCount = await page.evaluate(() => globalThis.__gpfcTestMessages.filter((type) => type === 'WARM_PICKER').length)
  await page.locator('#gpfc-google-photos-button').dispatchEvent('pointerenter')
  await page.locator('#gpfc-google-photos-button').focus()
  await page.waitForFunction((count) => globalThis.__gpfcTestMessages.filter((type) => type === 'WARM_PICKER').length === count + 1, initialWarmCount)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForFunction((count) => globalThis.__gpfcTestMessages.filter((type) => type === 'WARM_PICKER').length === count + 2, initialWarmCount)

  async function position(expected) {
    await page.waitForFunction((mode) => {
      const host = document.querySelector('#gpfc-extension-ui')
      return getComputedStyle(host).display !== 'none' && host.dataset.gpfcPosition === mode
    }, expected)
  }

  await position('composer-above-left')
  const initialPosition = await page.locator('#gpfc-extension-ui').boundingBox()
  await page.locator('#voice').hover()
  await page.locator('#voice-tooltip').waitFor({ state: 'visible' })
  await position('composer-above-left')
  assert.deepEqual(await page.locator('#gpfc-extension-ui').boundingBox(), initialPosition)
  await page.mouse.move(30, 30)
  await page.locator('#voice-tooltip').waitFor({ state: 'hidden' })
  await position('composer-above-left')
  assert.deepEqual(await page.locator('#gpfc-extension-ui').boundingBox(), initialPosition)
  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.hidden = false })
  await position('composer-above-left')
  await page.evaluate(() => {
    const composer = document.querySelector('#composer').getBoundingClientRect()
    const menu = document.createElement('div')
    menu.id = 'menu'
    menu.className = 'blocker'
    menu.setAttribute('role', 'menu')
    menu.tabIndex = -1
    Object.assign(menu.style, { left: composer.left + 8 + 'px', top: composer.top - 40 + 'px', zIndex: '100' })
    document.body.append(menu)
    menu.focus()
  })
  await position('composer-above-left')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#gpfc-extension-ui')).zIndex === '0')
  await page.locator('#menu').evaluate((menu) => menu.remove())
  await position('composer-above-left')
  await page.evaluate(() => {
    const composer = document.querySelector('#composer').getBoundingClientRect()
    const message = document.createElement('article')
    message.id = 'message'
    message.dataset.messageAuthorRole = 'assistant'
    message.textContent = 'Previous conversation'
    Object.assign(message.style, { position: 'fixed', width: '600px', height: '40px', paddingLeft: '100px', left: composer.left + 'px', top: composer.top - 40 + 'px' })
    document.body.append(message)
  })
  await position('composer-above-left')
  await page.evaluate(() => {
    document.querySelector('#sidebar').hidden = true
    document.querySelector('#message').remove()
  })
  await position('composer-above-left')
  await page.evaluate(() => {
    const dialog = document.createElement('div')
    dialog.id = 'dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.tabIndex = -1
    Object.assign(dialog.style, { position: 'fixed', left: '700px', top: '100px', width: '200px', height: '100px', zIndex: '100' })
    document.body.append(dialog)
    dialog.focus()
  })
  await position('composer-above-left')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#gpfc-extension-ui')).zIndex === '0')
  await page.locator('#dialog').evaluate((dialog) => dialog.remove())
  await position('composer-above-left')

  // A sidebar can animate over a stationary composer without moving it.
  await page.evaluate(() => {
    const sidebar = document.querySelector('#sidebar')
    sidebar.style.width = '0px'
    sidebar.style.transition = 'width 600ms linear'
    sidebar.hidden = false
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.style.width = '420px' })
  await page.waitForFunction(() => {
    const button = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const sidebar = document.querySelector('#sidebar').getBoundingClientRect()
    return button.left >= sidebar.right
  })
  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.style.width = '0px' })
  await position('composer-above-left')
  assert.deepEqual(await page.locator('#gpfc-extension-ui').boundingBox(), initialPosition)
  assert.deepEqual(errors, [])
  console.log('Passed: stable voice hover, intent/online prewarm, sidebar, menu, message, modal, restoration, animated sidebar.')
} finally {
  await context.close()
}
