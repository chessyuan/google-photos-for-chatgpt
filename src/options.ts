import { errorMessage } from './shared/errors'
import { localizeDocument, message } from './shared/i18n'
import type {
  GoogleAuthState,
  RuntimeRequest,
  RuntimeResponse,
} from './shared/types'

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('Options HTML is incomplete: ' + selector)
  return element
}

localizeDocument()

const status = required<HTMLElement>('#status')
const connectionDot = required<HTMLSpanElement>('#connection-dot')
const connectionStatus = required<HTMLElement>('#connection-status')
const connectionDetail = required<HTMLParagraphElement>('#connection-detail')
const connect = required<HTMLButtonElement>('#connect')
const reconnect = required<HTMLButtonElement>('#reconnect')
const disconnect = required<HTMLButtonElement>('#disconnect')
let browserAuthorizationSupported = true

function sendRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>
}

function setStatus(
  text: string,
  kind: 'info' | 'success' | 'error' = 'info',
): void {
  status.textContent = text
  status.className = 'status' + (kind === 'info' ? '' : ' ' + kind)
}

function authDetail(state: GoogleAuthState): string {
  return state.diagnosticCode
    ? state.message + '\n' + message('diagnosticCode', state.diagnosticCode)
    : state.message
}

function renderAuthState(state: GoogleAuthState): void {
  browserAuthorizationSupported = state.reason !== 'unsupported'
  connectionDot.className = 'connection-dot ' + state.status
  connect.hidden = state.authorized
  reconnect.hidden = !state.authorized
  disconnect.hidden = !state.authorized
  if (state.connected) {
    connectionStatus.textContent = message('connected')
    connectionDetail.textContent = state.message || message('pickerReadyDetail')
    setStatus(message('ready'), 'success')
  } else if (state.status === 'checking') {
    connectionStatus.textContent = message('checkingConnection')
    connectionDetail.textContent = authDetail(state)
    setStatus(message('checkingGooglePhotosAccess'))
  } else if (state.status === 'error') {
    connectionStatus.textContent = message('error')
    connectionDetail.textContent = authDetail(state)
    setStatus(authDetail(state), 'error')
  } else {
    connectionStatus.textContent = message('connectGooglePhotos')
    connectionDetail.textContent = state.message
    setStatus(state.message)
  }
  setBusy(false)
}

function setBusy(busy: boolean): void {
  connect.disabled = busy || !browserAuthorizationSupported
  reconnect.disabled = busy || !browserAuthorizationSupported
  disconnect.disabled = busy
}

async function runConnection(force: boolean): Promise<void> {
  setBusy(true)
  setStatus(message('checkingConnection'))
  try {
    const response = await sendRequest({ type: 'CONNECT_AUTH', force })
    if (!response.ok || !response.authState) {
      throw new Error(response.ok ? message('authorizationFailed') : response.error)
    }
    renderAuthState(response.authState)
    if (response.authState.connected) {
      setStatus(
        force ? message('reconnectComplete') : message('connectComplete'),
        'success',
      )
    } else {
      setStatus(authDetail(response.authState), 'error')
    }
  } catch (error) {
    setStatus(errorMessage(error), 'error')
  } finally {
    setBusy(false)
  }
}

connect.addEventListener('click', () => void runConnection(false))
reconnect.addEventListener('click', () => void runConnection(true))
disconnect.addEventListener('click', () => {
  void (async () => {
    setBusy(true)
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
      setBusy(false)
    }
  })()
})

void (async () => {
  try {
    let response = await sendRequest({ type: 'GET_AUTH_STATE' })
    if (!response.ok || !response.authState) {
      throw new Error(response.ok ? message('authorizationFailed') : response.error)
    }
    renderAuthState(response.authState)
    if (response.authState.status === 'checking') {
      await sendRequest({ type: 'WARM_PICKER' })
      response = await sendRequest({ type: 'GET_AUTH_STATE' })
      if (!response.ok || !response.authState) {
        throw new Error(
          response.ok ? message('authorizationFailed') : response.error,
        )
      }
      renderAuthState(response.authState)
    }
  } catch (error) {
    setStatus(errorMessage(error), 'error')
  }
})()
