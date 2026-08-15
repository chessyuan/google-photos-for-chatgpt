/* global HTMLElement, MutationObserver, chrome, document, getComputedStyle, requestAnimationFrame, window */

import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const runtimeModules = process.env.GPFC_RUNTIME_NODE_MODULES
const { chromium } = runtimeModules
  ? require(resolve(runtimeModules, 'playwright'))
  : require('playwright')

const extensionPath = resolve(process.cwd(), 'dist')
const expectedExtensionId = 'igacbcmbkglkglkindhcpmagafnboolj'
const browserPath =
  process.env.GPFC_CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const userDataDirectory = await mkdtemp(join(tmpdir(), 'gpfc-smoke-'))
const syntheticPngPath = join(userDataDirectory, 'synthetic.png')
const smokeCounts = (process.env.GPFC_SMOKE_COUNTS || '1,3,5')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5)
const chatGptSettleMilliseconds = Number(
  process.env.GPFC_CHATGPT_SETTLE_MS || 1500,
)
const smokeRepeats = Math.max(
  1,
  Math.min(10, Number(process.env.GPFC_SMOKE_REPEATS || 1)),
)
await writeFile(
  syntheticPngPath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4sUAAAAASUVORK5CYII=',
    'base64',
  ),
)

let context
try {
  context = await chromium.launchPersistentContext(userDataDirectory, {
    executablePath: browserPath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--disable-extensions-except=' + extensionPath,
      '--load-extension=' + extensionPath,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--window-position=-32000,-32000',
      '--window-size=1200,900',
      '--no-first-run',
    ],
  })

  let workers = context.serviceWorkers()
  if (workers.length === 0) {
    const bootstrap = await context.newPage()
    await bootstrap.goto(
      'chrome-extension://' + expectedExtensionId + '/test.html',
      { waitUntil: 'domcontentloaded', timeout: 20_000 },
    )
    workers = context.serviceWorkers()
    if (workers.length === 0) {
      workers = [await context.waitForEvent('serviceworker', { timeout: 20_000 })]
    }
  }
  const worker = workers[0]
  const extensionId = new URL(worker.url()).host
  const phaseOne = await context.newPage()
  await phaseOne.goto('chrome-extension://' + extensionId + '/test.html')
  await phaseOne.waitForSelector('#phase-one-input')

  const preloadWindowProbe = await worker.evaluate(async () => {
    const [sourceTab] = await chrome.tabs.query({
      url: chrome.runtime.getURL('test.html'),
    })
    const createdAt = performance.now()
    const preload = await chrome.windows.create({
      url: chrome.runtime.getURL('test.html'),
      type: 'popup',
      focused: false,
      state: 'minimized',
    })
    if (preload?.id === undefined) throw new Error('Preload probe window missing')
    if (preload.state !== 'minimized') {
      await chrome.windows.update(preload.id, { state: 'minimized' })
    }
    const [preloadTab] = await chrome.tabs.query({ windowId: preload.id })
    if (preloadTab?.id === undefined) throw new Error('Preload probe tab missing')
    const createMilliseconds = performance.now() - createdAt
    const deadline = Date.now() + 10_000
    let tab = preloadTab
    while (tab.status !== 'complete' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      tab = await chrome.tabs.get(preloadTab.id)
    }
    const loadedState = (await chrome.windows.get(preload.id)).state
    const activatedAt = performance.now()
    await chrome.windows.update(preload.id, { state: 'normal' })
    await chrome.windows.update(preload.id, { focused: true })
    const activationMilliseconds = performance.now() - activatedAt
    const activatedWindow = await chrome.windows.get(preload.id)
    await chrome.windows.remove(preload.id)
    if (sourceTab?.windowId !== undefined) {
      await chrome.windows.update(sourceTab.windowId, { focused: true })
    }
    return {
      createMilliseconds,
      loadedState,
      tabStatus: tab.status,
      activationMilliseconds,
      activatedState: activatedWindow.state,
      activatedFocused: activatedWindow.focused,
    }
  })

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest())
  const result = {
    extensionId,
    oauthClient: manifest.oauth2?.client_id,
    pickerScope: manifest.oauth2?.scopes?.[0],
    preloadWindowProbe,
    messageSerialization: manifest.message_serialization,
    phaseOnePage: await phaseOne.title(),
    chatgpt: { available: false },
  }

  const chatgpt = await context.newPage()
  try {
    await chatgpt.goto('https://chatgpt.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await chatgpt.waitForSelector('#gpfc-google-photos-button', {
      timeout: 45_000,
    })
    const buttonCount = await chatgpt.locator('#gpfc-google-photos-button').count()
    const buttonWidth = await chatgpt
      .locator('#gpfc-google-photos-button')
      .evaluate((button) => getComputedStyle(button).minWidth)
    const stableButtonPlacement = await chatgpt.evaluate(async () => {
      const host = document.querySelector('#gpfc-extension-ui')
      if (!(host instanceof HTMLElement)) return { ok: false, reason: 'missing host' }
      const snapshot = () => ({
        parent: host.parentElement?.tagName,
        position: getComputedStyle(host).position,
        left: host.style.left,
        top: host.style.top,
        bottom: host.style.bottom,
      })
      const before = snapshot()
      const editor = document.querySelector(
        'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
      )
      const composer = editor?.closest('form') ?? editor?.parentElement
      const marker = document.createElement('span')
      marker.hidden = true
      marker.dataset.gpfcSmokeMutation = 'true'
      composer?.append(marker)
      marker.remove()
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      const after = snapshot()
      return {
        ok:
          before.parent === 'HTML' &&
          before.position === 'fixed' &&
          JSON.stringify(before) === JSON.stringify(after),
        before,
        after,
      }
    })
    if (!stableButtonPlacement.ok) {
      throw new Error(
        'Google Photos button was not stable across a composer DOM mutation: ' +
          JSON.stringify(stableButtonPlacement),
      )
    }

    await chatgpt.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await chatgpt.waitForSelector('#gpfc-google-photos-button', {
      timeout: 45_000,
    })
    const countAfterReload = await chatgpt
      .locator('#gpfc-google-photos-button')
      .count()

    const localChangeToMutation = []
    for (let repeat = 0; repeat < smokeRepeats; repeat += 1) {
      await chatgpt.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
      await chatgpt.waitForSelector('#gpfc-google-photos-button', {
        timeout: 45_000,
      })
      await chatgpt.waitForTimeout(chatGptSettleMilliseconds)
      const localInput = chatgpt.locator('input[type="file"]').first()
      if ((await localInput.count()) === 0) continue
      await chatgpt.evaluate(() => {
        const input = document.querySelector('input[type="file"]')
        const root = input?.closest('form') ?? document.body
        window.__gpfcLocalUpload = {}
        const recordInputStart = () => {
          if (window.__gpfcLocalUpload.started === undefined) {
            window.__gpfcLocalUpload.started = performance.now()
          }
        }
        input?.addEventListener('input', recordInputStart, { once: true })
        input?.addEventListener('change', recordInputStart, { once: true })
        const observer = new MutationObserver(() => {
          if (
            window.__gpfcLocalUpload?.started !== undefined &&
            window.__gpfcLocalUpload.mutation === undefined
          ) {
            window.__gpfcLocalUpload.mutation =
              performance.now() - window.__gpfcLocalUpload.started
            observer.disconnect()
          }
        })
        observer.observe(root, { subtree: true, childList: true, attributes: true })
      })
      await localInput.setInputFiles(syntheticPngPath)
      await chatgpt
        .waitForFunction(() => window.__gpfcLocalUpload?.mutation !== undefined, {
          timeout: 15_000,
        })
        .catch(() => undefined)
      const timing = await chatgpt.evaluate(
        () => window.__gpfcLocalUpload?.mutation,
      )
      if (timing !== undefined) localChangeToMutation.push(timing)
    }

    const fileInputs = await chatgpt.evaluate(() =>
      [...document.querySelectorAll('input[type="file"]')].map((input) => ({
        id: input.id,
        name: input.getAttribute('name'),
        accept: input.getAttribute('accept'),
        multiple: input.hasAttribute('multiple'),
        testId: input.getAttribute('data-testid'),
        ariaLabel: input.getAttribute('aria-label'),
        inForm: Boolean(input.closest('form')),
        parent: input.parentElement?.outerHTML.slice(0, 500),
      })),
    )
    const phaseTwo = {}
    for (const count of smokeCounts) {
      phaseTwo[count] = []
      for (let repeat = 0; repeat < smokeRepeats; repeat += 1) {
        await chatgpt.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
        await chatgpt.waitForSelector('#gpfc-google-photos-button', {
          timeout: 45_000,
        })
        await chatgpt.waitForTimeout(chatGptSettleMilliseconds)
        phaseTwo[count].push(
          await worker.evaluate(async (photoCount) => {
            const [tab] = await chrome.tabs.query({
              url: 'https://chatgpt.com/*',
              active: true,
            })
            if (tab?.id === undefined) throw new Error('ChatGPT tab id not found')
            const started = performance.now()
            const response = await chrome.tabs.sendMessage(tab.id, {
              type: 'RUN_PHASE2',
              count: photoCount,
            })
            return { response, milliseconds: performance.now() - started }
          }, count),
        )
      }
    }

    result.chatgpt = {
      available: true,
      buttonCount,
      countAfterReload,
      buttonMinWidth: buttonWidth,
      stableButtonPlacement,
      backgroundGooglePhotosTabs: await worker.evaluate(async () =>
        (await chrome.tabs.query({ url: 'https://photos.google.com/*' })).map(
          (tab) => ({ id: tab.id, active: tab.active, url: tab.url }),
        ),
      ),
      fileInputs,
      localChangeToMutation,
      syntheticGpfcInjectionByCount: phaseTwo,
    }
  } catch (error) {
    result.chatgpt = {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      url: chatgpt.url(),
      title: await chatgpt.title().catch(() => ''),
    }
  }

  console.log(JSON.stringify(result, null, 2))
} finally {
  await context?.close().catch(() => undefined)
  await rm(userDataDirectory, { recursive: true, force: true })
}
