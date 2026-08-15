import { errorMessage } from './shared/errors'
import { localizeDocument, message } from './shared/i18n'
import type {
  GoogleAuthState,
  PublicJob,
  RuntimeRequest,
  RuntimeResponse,
} from './shared/types'

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('Popup HTML is incomplete: ' + selector)
  return element
}

localizeDocument()

const status = required<HTMLDivElement>('#status')
const selectButton = required<HTMLButtonElement>('#select-photos')
const maxItems = required<HTMLInputElement>('#max-items')
const phaseOne = required<HTMLButtonElement>('#phase-one')
const phaseTwo = required<HTMLButtonElement>('#phase-two')
const openOptions = required<HTMLButtonElement>('#open-options')
const reconnect = required<HTMLButtonElement>('#reconnect')
const disconnect = required<HTMLButtonElement>('#disconnect')
const connectedActions = required<HTMLDivElement>('#connected-actions')
const connectionDot = required<HTMLSpanElement>('#connection-dot')
const connectionStatus = required<HTMLElement>('#connection-status')
const connectionDetail = required<HTMLParagraphElement>('#connection-detail')

let activeTabId: number | undefined
let activeTabIsChatGPT = false
let oauthConfigured = false
let actionRunning = false
let browserAuthorizationSupported = true

function setStatus(
  text: string,
  kind: 'info' | 'success' | 'error' = 'info',
): void {
  status.textContent = text
  status.className = 'status' + (kind === 'info' ? '' : ' ' + kind)
}

function sendRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>
}

function renderAuthState(state: GoogleAuthState): void {
  browserAuthorizationSupported = state.reason !== 'unsupported'
  connectionDot.className = 'connection-dot ' + state.status
  connectedActions.hidden = !state.connected
  reconnect.hidden = !state.connected
  disconnect.hidden = !state.connected
  if (state.connected) {
    connectionStatus.textContent = message('connected')
    connectionDetail.textContent = state.message || message('connectedDetail')
    selectButton.textContent = message('selectFromGooglePhotos')
  } else if (state.status === 'error') {
    connectionStatus.textContent = message('error')
    connectionDetail.textContent = state.message
    selectButton.textContent = message('connectGooglePhotos')
  } else {
    connectionStatus.textContent = message('connectGooglePhotos')
    connectionDetail.textContent = state.message
    selectButton.textContent = message('connectGooglePhotos')
  }
  updateButton()
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
  selectButton.disabled =
    actionRunning ||
    !browserAuthorizationSupported ||
    !(activeTabIsChatGPT && oauthConfigured)
}

async function readAuthState(): Promise<GoogleAuthState> {
  const response = await sendRequest({ type: 'GET_AUTH_STATE' })
  if (!response.ok || !response.authState) {
    throw new Error(response.ok ? message('authorizationFailed') : response.error)
  }
  return response.authState
}

async function initialize(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    activeTabId = tab?.id
    activeTabIsChatGPT = Boolean(tab?.url?.startsWith('https://chatgpt.com/'))

    const config = await sendRequest({ type: 'GET_CONFIG' })
    if (!config.ok) throw new Error(config.error)
    oauthConfigured = Boolean(config.oauthConfigured)

    const state = await readAuthState()
    renderAuthState(state)

    if (!oauthConfigured) {
      setStatus(message('developmentBuildNotConfigured'), 'error')
    } else if (!activeTabIsChatGPT) {
      setStatus(message('openChatGptFirst'), 'error')
    } else if (activeTabId !== undefined) {
      const response = await sendRequest({
        type: 'GET_JOB',
        targetTabId: activeTabId,
      })
      if (response.ok && response.job) showJob(response.job)
      else if (state.connected) setStatus(message('ready'), 'success')
      else setStatus(state.message)
    }
    updateButton()
  } catch (error) {
    setStatus(errorMessage(error), 'error')
  }
}

selectButton.addEventListener('click', () => {
  void (async () => {
    if (activeTabId === undefined) return
    actionRunning = true
    updateButton()
    setStatus(message('openingGooglePhotos'))
    try {
      const response = await sendRequest({
        type: 'START_PICKER',
        targetTabId: activeTabId,
        targetKind: 'chatgpt',
        maxItemCount: Number(maxItems.value),
        clickStartedAt: performance.timeOrigin + performance.now(),
      })
      if (!response.ok) throw new Error(response.error)
      renderAuthState({
        status: 'connected',
        connected: true,
        message: message('connectedDetail'),
      })
      if (response.job) showJob(response.job)
    } catch (error) {
      setStatus(errorMessage(error), 'error')
      try {
        renderAuthState(await readAuthState())
      } catch {
        // Preserve the actionable error from the Picker request.
      }
    } finally {
      actionRunning = false
      updateButton()
    }
  })()
})

reconnect.addEventListener('click', () => {
  void (async () => {
    actionRunning = true
    updateButton()
    setStatus(message('checkingConnection'))
    try {
      const response = await sendRequest({ type: 'CONNECT_AUTH', force: true })
      if (!response.ok || !response.authState) {
        throw new Error(response.ok ? message('authorizationFailed') : response.error)
      }
      renderAuthState(response.authState)
      setStatus(message('reconnectComplete'), 'success')
    } catch (error) {
      setStatus(errorMessage(error), 'error')
    } finally {
      actionRunning = false
      updateButton()
    }
  })()
})

disconnect.addEventListener('click', () => {
  void (async () => {
    actionRunning = true
    updateButton()
    try {
      const response = await sendRequest({ type: 'DISCONNECT_AUTH' })
      if (!response.ok || !response.authState) {
        throw new Error(response.ok ? message('authorizationFailed') : response.error)
      }
      renderAuthState(response.authState)
      setStatus(message('disconnectComplete'), 'success')
    } catch (error) {
      setStatus(errorMessage(error), 'error')
    } finally {
      actionRunning = false
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
      setStatus(message('openChatGptFirst'), 'error')
      return
    }
    try {
      const response = (await chrome.tabs.sendMessage(activeTabId, {
        type: 'RUN_PHASE2',
      })) as { ok: boolean; detail?: string; error?: string }
      if (!response.ok) throw new Error(response.error)
      setStatus('Phase 2: ' + (response.detail ?? ''), 'success')
    } catch (error) {
      setStatus(errorMessage(error), 'error')
    }
  })()
})

openOptions.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

void initialize()
