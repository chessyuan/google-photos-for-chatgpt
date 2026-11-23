/* global chrome */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = process.env.GPFC_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.GPFC_RUNTIME_NODE_MODULES, 'playwright'))
  : require('playwright')
const extensionPath = resolve(process.env.GPFC_EXTENSION_PATH || 'dist')
const context = await chromium.launchPersistentContext(resolve('.cache/browser-download-profile'), {
  executablePath: process.env.GPFC_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-features=AutofillAiWalletPrivatePasses', '--enable-unsafe-extension-debugging', '--no-first-run'],
})
try {
  const manager = await context.newPage()
  await manager.goto('chrome://extensions/')
  const toggle = manager.locator('#devMode')
  if (!await toggle.evaluate((element) => element.checked)) await toggle.click()
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath })
  const page = await context.newPage()
  await page.goto('chrome-extension://' + id + '/test.html')
  assert.equal((await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CONFIG' }))).ok, true)
  const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://' + id + '/'))
  assert.ok(worker)
  const { targetInfos } = await cdp.send('Target.getTargets')
  const target = targetInfos.find((entry) => entry.type === 'service_worker' && entry.url === worker.url())
  assert.ok(target)
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
  let sequence = 0
  const pending = new Map()
  const requests = []
  const interceptionErrors = []
  function workerCommand(method, params = {}) {
    return new Promise((resolveReply, reject) => {
      const commandId = ++sequence
      pending.set(commandId, { resolve: resolveReply, reject })
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: commandId, method, params }) }).catch(reject)
    })
  }
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message)
    if (message.id) {
      const reply = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reply?.reject(new Error(message.error.message))
      else reply?.resolve(message.result)
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      requests.push({ host: url.hostname, method: request.method, hasAuthorization: Object.keys(request.headers).some((name) => name.toLowerCase() === 'authorization') })
      const redirect = url.hostname === 'lh3.googleusercontent.com' && url.search === '?video'
      void workerCommand('Fetch.fulfillRequest', {
        requestId, responseCode: redirect ? 302 : 200,
        responseHeaders: redirect
          ? [{ name: 'Location', value: 'https://rr1---gpfc-test.googlevideo.com/gpfc-network-test?bytes' }]
          : [{ name: 'Content-Type', value: url.search === '?image' ? 'image/png' : 'video/mp4' }],
        body: redirect ? '' : Buffer.from([0, 1, 2, 3]).toString('base64'),
      }).catch((error) => interceptionErrors.push(error.message))
    }
  })
  // Intercept every native request, including redirect hops. Playwright's route
  // handler only sees the first hop and cannot verify this cross-origin case.
  await workerCommand('Fetch.enable', { patterns: [{ urlPattern: '*gpfc-network-test*' }] })
  const results = []
  for (const [name, url] of [
    ['image host', 'https://lh3.googleusercontent.com/gpfc-network-test?image'],
    ['video CDN redirect', 'https://lh3.googleusercontent.com/gpfc-network-test?video'],
  ]) {
    const result = await worker.evaluate(async (targetUrl) => {
      try {
        const response = await fetch(targetUrl, { headers: { Authorization: 'Bearer test-only-media-token' }, signal: AbortSignal.timeout(5000) })
        return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength, redirected: response.redirected }
      } catch (error) { return { ok: false, error: error.message } }
    }, url)
    results.push({ name, ...result })
  }
  const permissions = await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://*.googlevideo.com/*'] }))
  console.log(JSON.stringify({ extensionPath, videoCdnPermission: permissions, results, requests, interceptionErrors }, null, 2))
  assert.deepEqual(interceptionErrors, [])
  for (const result of results) assert.equal(result.ok, true, result.name)
  assert.equal(results[1].redirected, true)
  assert.equal(requests.find((request) => request.host.endsWith('.googlevideo.com'))?.hasAuthorization, false)
} finally {
  await context.close()
}
