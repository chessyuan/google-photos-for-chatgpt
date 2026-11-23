/* global chrome, document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const extensionPath = resolve(process.env.GPFC_EXTENSION_PATH || 'dist')
const previousPath = process.env.GPFC_PREVIOUS_EXTENSION_PATH
const context = await chromium.launchPersistentContext(resolve('.cache/browser-runtime-profile'), {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-features=AutofillAiWalletPrivatePasses', '--enable-unsafe-extension-debugging', '--no-first-run'],
})
try {
  const manager = await context.newPage()
  await manager.goto('chrome://extensions/')
  const developerMode = manager.locator('#devMode')
  if (!await developerMode.evaluate((toggle) => toggle.checked)) await developerMode.click()
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: previousPath ? resolve(previousPath) : extensionPath })
  assert.equal(id, 'igacbcmbkglkglkindhcpmagafnboolj')
  const extensionPage = await context.newPage()
  await extensionPage.goto('chrome-extension://' + id + '/test.html')
  assert.equal((await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CONFIG' }))).ok, true)

  await context.route('https://chatgpt.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><style>form { position: fixed; bottom: 40px; left: 30%; width: 40%; height: 100px; } #visual-composer { position: fixed; left: 5%; right: 5%; bottom: 40px; height: 100px; border: 1px solid; } #composer-plus-btn { position: absolute; left: 16px; bottom: 30px; width: 32px; height: 32px; } #history { position: fixed; left: 5%; bottom: 110px; width: 90%; height: 380px; } #history p { margin-left: 100px; } #ghost-sidebar { position: fixed; left: 0; top: 0; width: 32%; height: 100vh; pointer-events: none; } #hidden-layer { position: fixed; inset: 0; opacity: 0; pointer-events: none; } #hidden-dialog { position: absolute; left: 700px; top: 50px; width: 200px; height: 100px; }</style></head><body><nav id="ghost-sidebar"></nav><article id="history" data-testid="conversation-turn-1"><p>Previous conversation</p></article><div id="hidden-layer"><div id="hidden-dialog" role="dialog" aria-modal="true">Hidden</div></div><form><div id="visual-composer"><button id="composer-plus-btn" data-testid="composer-plus-btn" type="button">+</button><textarea id="prompt-textarea"></textarea><input type="file" multiple></div></form></body></html>',
  }))
  const chat = await context.newPage()
  await chat.goto('https://chatgpt.com/')
  await chat.locator('#gpfc-google-photos-button').waitFor({ state: 'attached' })
  const previousButtonVisible = await chat.locator('#gpfc-google-photos-button').isVisible()
  const previousAlignmentError = await chat.evaluate(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2))
  })
  await chat.locator('#prompt-textarea').fill('unsent draft must survive extension reload')
  let navigations = 0
  chat.on('framenavigated', () => { navigations += 1 })
  await chat.locator('#gpfc-google-photos-button').evaluate((button) => { button.dataset.runtimeBeforeReload = 'true' })
  const newWorker = context.waitForEvent('serviceworker', { timeout: 15_000 })
  if (previousPath) await cdp.send('Extensions.loadUnpacked', { path: extensionPath })
  else await extensionPage.evaluate(() => { chrome.runtime.reload() }).catch(() => undefined)
  try {
    await newWorker
  } catch (error) {
    console.error(JSON.stringify(await cdp.send('Extensions.getExtensions')))
    throw error
  }
  await chat.waitForFunction(() => {
    const button = document.querySelector('#gpfc-google-photos-button')
    return button && !button.hasAttribute('data-runtime-before-reload')
  }, undefined, { timeout: 10_000 })
  await chat.locator('#gpfc-google-photos-button').waitFor({ state: 'visible', timeout: 10_000 })
  const buttonReceivesClicks = await chat.locator('#gpfc-google-photos-button').evaluate((button) => {
    const rect = button.getBoundingClientRect()
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('#gpfc-google-photos-button') === button
  })
  assert.equal(buttonReceivesClicks, true)
  const currentAlignmentError = await chat.evaluate(() => {
    const icon = document.querySelector('#gpfc-google-photos-button').getBoundingClientRect()
    const plus = document.querySelector('#composer-plus-btn').getBoundingClientRect()
    return Math.abs((icon.left + icon.width / 2) - (plus.left + plus.width / 2))
  })
  assert.ok(currentAlignmentError <= 2, 'The reloaded icon must align with the widened composer')
  assert.equal(await chat.locator('#gpfc-google-photos-button').count(), 1)
  assert.equal(await chat.locator('#prompt-textarea').inputValue(), 'unsent draft must survive extension reload')
  assert.equal(navigations, 0)
  const freshExtensionPage = await context.newPage()
  await freshExtensionPage.goto('chrome-extension://' + id + '/test.html')
  assert.equal((await freshExtensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CONFIG' }))).ok, true)
  const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://' + id + '/'))
  assert.ok(worker)
  const reply = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' })
    return chrome.tabs.sendMessage(tab.id, { type: 'GPFC_PING' })
  })
  assert.equal(reply.ok, true)
  console.log(JSON.stringify({ extensionPath, previousPath, extensionId: id, previousButtonVisible, previousAlignmentError, currentAlignmentError, checks: [
    'real MV3 worker starts and answers messages',
    'worker restarts after extension reload',
    'existing ChatGPT tab receives a fresh content script',
    'unsent draft preserved without page navigation',
    'one visible, clickable button aligned with the widened composer after reload',
  ] }, null, 2))
} finally {
  await context.close()
}
