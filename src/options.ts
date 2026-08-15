import type { RuntimeResponse } from './shared/types'

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('Options HTML is incomplete: ' + selector)
  return element
}

const extensionId = required<HTMLElement>('#extension-id')
const clientId = required<HTMLElement>('#client-id')
const clientState = required<HTMLElement>('#client-state')

async function initialize(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_CONFIG',
  })) as RuntimeResponse
  if (!response.ok) {
    clientState.textContent = response.error
    clientState.className = 'status error'
    return
  }

  extensionId.textContent = response.extensionId ?? chrome.runtime.id
  clientId.textContent = response.clientId ?? 'Not configured'
  clientState.textContent = response.oauthConfigured
    ? 'Configured. Reload the ChatGPT tab after rebuilding or reloading the extension.'
    : 'Not configured. The Picker is intentionally disabled until a real Client ID is built into dist/manifest.json.'
  clientState.className =
    'status ' + (response.oauthConfigured ? 'success' : 'error')
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', () => {
    const targetId = button.dataset.copy
    const text = targetId
      ? document.getElementById(targetId)?.textContent
      : undefined
    if (text) {
      void navigator.clipboard.writeText(text)
      button.textContent = 'Copied'
      window.setTimeout(() => {
        button.textContent = 'Copy'
      }, 1200)
    }
  })
}

void initialize()
