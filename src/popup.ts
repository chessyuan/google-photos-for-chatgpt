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

function authDetail(state: GoogleAuthState): string {
  const account = state.accountEmail
    ? message(
        state.accountSelection === 'google-chooser'
          ? 'connectedAccount'
          : 'currentChromeAccount',
        state.accountEmail,
      )
    : state.accountSelection === 'google-chooser' && state.authorized
      ? message('selectedGoogleAccount')
      : state.authorized
        ? message('currentChromeAccountUnknown')
        : ''
  const detail = state.diagnosticCode
    ? state.message + '\n' + message('diagnosticCode', state.diagnosticCode)
    : state.message
  return account ? account + '\n' + detail : detail
}

function renderAuthState(state: GoogleAuthState): void {
  browserAuthorizationSupported = state.reason !== 'unsupported'
  connectionDot.className = 'connection-dot ' + state.status
  connectedActions.hidden = !state.authorized
  reconnect.hidden = !state.authorized
  disconnect.hidden = !state.authorized
  reconnect.textContent = message(
    state.accountSelection === 'google-chooser'
      ? 'chooseAnotherAccount'
      : 'reconnectChromeAccount',
  )
  if (state.connected) {
    connectionStatus.textContent = message('connected')
    connectionDetail.textContent = authDetail(state)
    selectButton.textContent = message('selectFromGooglePhotos')
  } else if (state.status === 'checking') {
    connectionStatus.textContent = message('checkingConnection')
    connectionDetail.textContent = authDetail(state)
    selectButton.textContent = message('selectFromGooglePhotos')
  } else if (state.status === 'error') {
    connectionStatus.textContent = message('error')
    connectionDetail.textContent = authDetail(state)
    selectButton.textContent = state.authorized
      ? message('selectFromGooglePhotos')
      : message('connectGooglePhotos')
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

    let state = await readAuthState()
    renderAuthState(state)

    if (state.status === 'checking') {
      setStatus(message('checkingGooglePhotosAccess'))
      await sendRequest({ type: 'WARM_PICKER' })
      state = await readAuthState()
      renderAuthState(state)
    }

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
      renderAuthState(await readAuthState())
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
      if (response.authState.connected) {
        setStatus(message('reconnectComplete'), 'success')
      } else {
        setStatus(authDetail(response.authState), 'error')
      }
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
