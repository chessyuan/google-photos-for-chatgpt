/* global document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const context = await chromium.launchPersistentContext(resolve('.cache/browser-wide-layout-profile'), {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  viewport: { width: 1600, height: 900 },
  args: ['--disable-features=AutofillAiWalletPrivatePasses', '--no-first-run'],
})

try {
  const page = await context.newPage()
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>
      body { margin: 0; font: 16px system-ui; }
      #logical-form { position: fixed; left: 30%; width: 40%; bottom: 40px; height: 100px; }
      #visual-composer { position: fixed; left: 5%; right: 5%; bottom: 40px; height: 100px; border: 1px solid #bbb; border-radius: 24px; background: white; box-sizing: border-box; }
      #prompt-textarea { position: absolute; left: 64px; right: 110px; top: 20px; min-height: 40px; }
      #composer-plus-btn { position: absolute; left: 16px; bottom: 30px; width: 32px; height: 32px; }
      #voice { position: absolute; right: 16px; bottom: 30px; width: 32px; height: 32px; }
      #voice-tooltip { position: absolute; right: 0; bottom: 110px; display: none; }
      #voice:hover + #voice-tooltip { display: block; }
      #sidebar { position: fixed; left: 0; top: 0; width: 500px; height: 100vh; pointer-events: none; }
    </style></head><body><nav id="sidebar"></nav><main><form id="logical-form">
      <div id="visual-composer"><button id="composer-plus-btn" data-testid="composer-plus-btn" type="button">+</button>
      <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
      <button id="voice" aria-label="Start Voice" type="button">V</button><div id="voice-tooltip" role="tooltip">Start Voice</div></div>
    </form></main></body></html>`,
  }))
  await page.addInitScript(() => {
    globalThis.__gpfcWideMessages = []
    Object.assign(globalThis.chrome ??= {}, {
      runtime: {
        sendMessage: async (request) => { globalThis.__gpfcWideMessages.push(request.type); return { ok: true } },
        onMessage: { addListener() {} },
      },
      i18n: { getMessage: () => '' },
    })
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('https://chatgpt.com/')
  await page.addScriptTag({ path: resolve('dist/content.js') })
  const photos = page.locator('#gpfc-google-photos-button')
  await photos.waitFor({ state: 'visible', timeout: 5000 })
  const initial = await page.evaluate(() => {
    const rect = (selector) => {
      const { left, top, width, height } = document.querySelector(selector).getBoundingClientRect()
      return { left, top, width, height }
    }
    return { photo: rect('#gpfc-google-photos-button'), plus: rect('#composer-plus-btn'),
      form: rect('#logical-form'), visual: rect('#visual-composer') }
  })
  assert.ok(Math.abs((initial.photo.left + initial.photo.width / 2) - (initial.plus.left + initial.plus.width / 2)) <= 2,
    'Photo icon should align with the visible left-side plus, even when the form is narrower: ' + JSON.stringify(initial))
  assert.ok(initial.photo.top + initial.photo.height <= initial.visual.top,
    'Photo icon must remain above the visible composer: ' + JSON.stringify(initial))
  await photos.click()
  assert.ok(await page.evaluate(() => globalThis.__gpfcWideMessages.includes('START_PICKER')))
  await page.locator('#voice').hover()
  await page.locator('#voice-tooltip').waitFor({ state: 'visible' })
  const hovered = await photos.boundingBox()
  assert.equal(hovered.x, initial.photo.left)
  assert.equal(hovered.y, initial.photo.top)
  await page.mouse.move(800, 200)

  // If ChatGPT removes the plus control during a redraw, use the visible
  // voice control as the other approved edge, rather than an old form margin.
  await page.evaluate(() => {
    globalThis.__gpfcHeldPlus = document.querySelector('#composer-plus-btn')
    globalThis.__gpfcHeldPlus.remove()
  })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const voice = document.querySelector('#voice').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (voice.left + voice.width / 2)) <= 2
  }, undefined, { timeout: 5000 })
  await page.evaluate(() => document.querySelector('#visual-composer').prepend(globalThis.__gpfcHeldPlus))
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 5000 })

  // ChatGPT sometimes names the plus by its accessible label instead of a
  // stable id; it should still be the positioning anchor after a redraw.
  await page.evaluate(() => {
    const plus = globalThis.__gpfcHeldPlus
    plus.remove()
    plus.removeAttribute('id')
    plus.removeAttribute('data-testid')
    plus.setAttribute('aria-label', 'Add photos & files')
    document.querySelector('#visual-composer').prepend(plus)
  })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = globalThis.__gpfcHeldPlus.getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 3000 })
  await page.evaluate(() => {
    const plus = globalThis.__gpfcHeldPlus
    plus.remove()
    plus.id = 'composer-plus-btn'
    plus.dataset.testid = 'composer-plus-btn'
    plus.removeAttribute('aria-label')
    document.querySelector('#visual-composer').prepend(plus)
  })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 3000 })

  // A width-modifying extension can resize its inner visual wrapper without
  // changing the logical form or any DOM attribute.
  await page.evaluate(() => {
    document.querySelector('#visual-composer').animate([{ left: '5%' }, { left: '18%' }], { duration: 180, fill: 'forwards' })
  })
  await page.evaluate(async () => {
    await Promise.all(document.querySelector('#visual-composer').getAnimations().map((animation) => animation.finished))
  })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 3000 })
  await page.evaluate(() => document.querySelector('#visual-composer').getAnimations().forEach((animation) => animation.cancel()))
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 3000 })

  // A visible sidebar changes the available page area; the icon must follow
  // the actual attachment control instead of the narrow logical form.
  await page.evaluate(() => {
    const sidebar = document.querySelector('#sidebar')
    sidebar.style.width = '220px'
    sidebar.style.pointerEvents = 'auto'
    sidebar.style.background = '#ddd'
    document.querySelector('#visual-composer').style.left = '250px'
  })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 5000 })
  await photos.click()
  await page.screenshot({ path: resolve('.cache/browser-wide-layout-result.png') })

  // If an actual sidebar covers the left slot, use the other requested edge,
  // rather than landing at an arbitrary point in the middle of the composer.
  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.style.width = '300px' })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const voice = document.querySelector('#voice').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (voice.left + voice.width / 2)) <= 2
  }, undefined, { timeout: 5000 })
  const aboveVoice = await photos.boundingBox()
  await page.locator('#voice').hover()
  await page.locator('#voice-tooltip').waitFor({ state: 'visible' })
  assert.deepEqual(await photos.boundingBox(), aboveVoice)
  await page.mouse.move(800, 200)
  await page.locator('#sidebar').evaluate((sidebar) => { sidebar.style.width = '220px' })
  await page.waitForFunction(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2)) <= 2
  }, undefined, { timeout: 5000 })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ initial, checks: ['wide visual composer', 'alternate plus label', 'inner width animation', 'invisible sidebar', 'voice hover', 'voice fallback', 'sidebar collision fallback', 'clickable icon'] }, null, 2))
} finally {
  await context.close()
}
