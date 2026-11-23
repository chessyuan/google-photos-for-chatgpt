/* global document, getComputedStyle, innerHeight */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const context = await chromium.launchPersistentContext(resolve('.cache/browser-visibility-profile'), {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-features=AutofillAiWalletPrivatePasses', '--no-first-run'],
})

try {
  const page = await context.newPage()
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>
      body { margin: 0; font: 16px system-ui; }
      #shell { position: fixed; bottom: 40px; left: 320px; width: 640px; }
      #composer { height: 100px; border: 1px solid; box-sizing: border-box; }
      #prompt-textarea { margin: 8px; min-height: 30px; }
      #voice { position: absolute; right: 12px; bottom: 8px; width: 32px; height: 32px; }
      #voice-tooltip { position: absolute; right: 0; bottom: 104px; display: none; }
      #voice:hover + #voice-tooltip { display: block; }
      #history { position: fixed; left: 320px; bottom: 110px; width: 640px; height: 380px; }
      #history p { margin-left: 100px; }
      #sidebar { position: fixed; left: 0; top: 0; width: 350px; height: 100vh; background: #ddd; z-index: 5; }
      #sidebar[hidden] { display: none; }
      #hidden-layer { position: fixed; inset: 0; opacity: 0; pointer-events: none; }
      #hidden-dialog { position: absolute; left: 700px; top: 50px; width: 200px; height: 100px; }
    </style></head><body><nav id="sidebar" hidden>Sidebar</nav>
      <article id="history" data-testid="conversation-turn-1" data-message-author-role="assistant"><p>Previous conversation</p></article>
      <div id="hidden-layer"><div id="hidden-dialog" role="dialog" aria-modal="true">Hidden dialog</div></div>
      <main><div id="shell"><form id="composer"><div id="prompt-textarea" contenteditable="true" role="textbox"></div>
        <button type="button" id="voice" aria-label="Start Voice">V</button><div id="voice-tooltip" role="tooltip">Start Voice</div>
      </form></div></main></body></html>`,
  }))
  await page.addInitScript(() => {
    globalThis.__gpfcVisibilityMessages = []
    Object.assign(globalThis.chrome ??= {}, {
      runtime: {
        sendMessage: async (request) => { globalThis.__gpfcVisibilityMessages.push(request.type); return { ok: true } },
        onMessage: { addListener() {} },
      },
      i18n: { getMessage: () => '' },
    })
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('https://chatgpt.com/')
  await page.addScriptTag({ path: resolve('dist/content.js') })
  const button = page.locator('#gpfc-google-photos-button')
  await button.waitFor({ state: 'visible', timeout: 3000 })
  await button.click()
  assert.ok(await page.evaluate(() => globalThis.__gpfcVisibilityMessages.includes('START_PICKER')))
  const initial = await button.boundingBox()
  await page.locator('#voice').hover()
  await page.locator('#voice-tooltip').waitFor({ state: 'visible' })
  assert.deepEqual(await button.boundingBox(), initial)
  await page.mouse.move(1000, 100)
  await page.locator('#voice-tooltip').waitFor({ state: 'hidden' })
  assert.deepEqual(await button.boundingBox(), initial)

  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.hidden = false })
  await page.waitForFunction(() => {
    const button = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const sidebar = document.querySelector('#sidebar').getBoundingClientRect()
    return getComputedStyle(document.querySelector('#gpfc-extension-ui')).display !== 'none' && button.left >= sidebar.right
  })
  await button.click()
  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.hidden = true })
  await page.waitForFunction((left) => Math.abs(document.querySelector('#gpfc-google-photos-button').getBoundingClientRect().left - left) < 1, initial.x)

  await page.evaluate(() => {
    const shell = document.querySelector('#shell')
    shell.style.top = '0px'
    shell.style.bottom = 'auto'
  })
  await page.waitForFunction(() => {
    const button = document.querySelector('#gpfc-google-photos-button')
    const rect = button.getBoundingClientRect()
    return getComputedStyle(button).display !== 'none' && rect.top >= 0 && rect.bottom <= innerHeight
  })
  await button.click()
  await page.locator('#prompt-textarea').evaluate((editor) => editor.remove())
  await page.waitForFunction(() => document.querySelector('#gpfc-extension-ui').dataset.gpfcPosition === 'viewport-fallback')
  await button.click()
  assert.deepEqual(errors, [])
  console.log('Passed: visible and clickable with long chat, invisible modal, voice tooltip, sidebar, viewport edge, and temporarily missing composer.')
} finally {
  await context.close()
}
