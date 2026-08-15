import { errorMessage } from './shared/errors'
import type {
  PublicJob,
  RuntimeRequest,
  RuntimeResponse,
} from './shared/types'

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('Popup HTML is incomplete: ' + selector)
  return element
}

const status = required<HTMLDivElement>('#status')
const selectButton = required<HTMLButtonElement>('#select-photos')
const maxItems = required<HTMLInputElement>('#max-items')
const phaseOne = required<HTMLButtonElement>('#phase-one')
const phaseTwo = required<HTMLButtonElement>('#phase-two')
const openSetup = required<HTMLButtonElement>('#open-setup')
const disconnect = required<HTMLButtonElement>('#disconnect')

let activeTabId: number | undefined
let activeTabIsChatGPT = false
let oauthConfigured = false

function setStatus(
  message: string,
  kind: 'info' | 'success' | 'error' = 'info',
): void {
  status.textContent = message
  status.className = 'status' + (kind === 'info' ? '' : ' ' + kind)
}

function sendRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>
}

function showJob(job: PublicJob): void {
  const warnings =
    job.warnings.length > 0 ? '\nWarnings:\n' + job.warnings.join('\n') : ''
  setStatus(
    job.message + warnings,
    job.status === 'error'
      ? 'error'
      : job.status === 'complete'
        ? 'success'
        : 'info',
  )
}

function updateButton(): void {
  selectButton.disabled = !(activeTabIsChatGPT && oauthConfigured)
}

async function initialize(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    activeTabId = tab?.id
    activeTabIsChatGPT = Boolean(tab?.url?.startsWith('https://chatgpt.com/'))

    const config = await sendRequest({ type: 'GET_CONFIG' })
    if (!config.ok) throw new Error(config.error)
    oauthConfigured = Boolean(config.oauthConfigured)

    if (!oauthConfigured) {
      setStatus(
        'OAuth Client ID is not configured. Open “OAuth setup” below before using the Picker.',
        'error',
      )
    } else if (!activeTabIsChatGPT) {
      setStatus('Open https://chatgpt.com in the active tab first.', 'error')
    } else if (activeTabId !== undefined) {
      const response = await sendRequest({
        type: 'GET_JOB',
        targetTabId: activeTabId,
      })
      if (response.ok && response.job) showJob(response.job)
      else setStatus('Ready. Photos stay in browser memory until ChatGPT receives them.')
    }
    updateButton()
  } catch (error) {
    setStatus(errorMessage(error), 'error')
  }
}

selectButton.addEventListener('click', () => {
  void (async () => {
    if (activeTabId === undefined) return
    selectButton.disabled = true
    setStatus('Starting Google Photos Picker…')
    try {
      const response = await sendRequest({
        type: 'START_PICKER',
        targetTabId: activeTabId,
        targetKind: 'chatgpt',
        maxItemCount: Number(maxItems.value),
        clickStartedAt: performance.timeOrigin + performance.now(),
      })
      if (!response.ok) throw new Error(response.error)
      if (response.job) showJob(response.job)
    } catch (error) {
      setStatus(errorMessage(error), 'error')
      updateButton()
    }
  })()
})

phaseOne.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('test.html') })
})

phaseTwo.addEventListener('click', () => {
  void (async () => {
    if (!activeTabIsChatGPT || activeTabId === undefined) {
      setStatus('Open ChatGPT before running Phase 2.', 'error')
      return
    }
    try {
      const response = (await chrome.tabs.sendMessage(activeTabId, {
        type: 'RUN_PHASE2',
      })) as { ok: boolean; detail?: string; error?: string }
      if (!response.ok) throw new Error(response.error)
      setStatus('Phase 2 started: ' + (response.detail ?? ''), 'success')
    } catch (error) {
      setStatus(
        'Phase 2 could not reach the ChatGPT content script. Reload ChatGPT and try again. ' +
          errorMessage(error),
        'error',
      )
    }
  })()
})

openSetup.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

disconnect.addEventListener('click', () => {
  void (async () => {
    try {
      const response = await sendRequest({ type: 'CLEAR_AUTH' })
      if (!response.ok) throw new Error(response.error)
      setStatus('Cached Google authorization was cleared.', 'success')
    } catch (error) {
      setStatus(errorMessage(error), 'error')
    }
  })()
})

void initialize()
