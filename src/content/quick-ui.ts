import { findComposerRoot } from './attachment'

export interface QuickUi {
  showToast(
    message: string,
    kind?: 'info' | 'success' | 'error',
    durationMilliseconds?: number,
  ): void
  clearToast(): void
  setBusy(busy: boolean): void
}

interface QuickUiWindow extends Window {
  __gpfcQuickUiCleanup?: () => void
}

const hostId = 'gpfc-extension-ui'
const toastId = 'gpfc-extension-toast'
const buttonId = 'gpfc-google-photos-button'
const defaultToastDurationMilliseconds = 2600

function createPhotosIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '18')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.display = 'block'
  svg.style.flex = '0 0 18px'

  const paths = [
    ['#4285f4', 'M12 2a5 5 0 0 0-5 5v5h5a5 5 0 0 0 0-10Z'],
    ['#ea4335', 'M22 12a5 5 0 0 0-5-5h-5v5a5 5 0 0 0 10 0Z'],
    ['#fbbc04', 'M12 22a5 5 0 0 0 5-5v-5h-5a5 5 0 0 0 0 10Z'],
    ['#34a853', 'M2 12a5 5 0 0 0 5 5h5v-5a5 5 0 0 0-10 0Z'],
  ] as const
  for (const [fill, pathData] of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('fill', fill)
    path.setAttribute('d', pathData)
    svg.append(path)
  }
  return svg
}

export function createQuickUi(onSelect: () => void): QuickUi {
  const quickWindow = window as QuickUiWindow
  quickWindow.__gpfcQuickUiCleanup?.()
  document.getElementById(hostId)?.remove()
  document.getElementById(toastId)?.remove()

  const host = document.createElement('span')
  host.id = hostId
  host.dataset.gpfcRoot = 'true'
  host.dataset.gpfcPosition = 'composer-outside-left'
  Object.assign(host.style, {
    zIndex: '2147483646',
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    pointerEvents: 'auto',
    position: 'fixed',
    margin: '0',
  })

  const button = document.createElement('button')
  button.id = buttonId
  button.type = 'button'
  button.setAttribute('aria-label', 'Select from Google Photos')
  button.append(createPhotosIcon())
  Object.assign(button.style, {
    appearance: 'none',
    boxSizing: 'border-box',
    height: '32px',
    minHeight: '32px',
    maxHeight: '32px',
    width: '32px',
    minWidth: '32px',
    maxWidth: '32px',
    border: '0',
    borderRadius: '50%',
    padding: '7px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'inherit',
    background: 'transparent',
    boxShadow: 'none',
    cursor: 'pointer',
    pointerEvents: 'auto',
  })
  button.addEventListener('mouseenter', () => {
    if (!button.disabled) button.style.background = 'rgb(127 127 127 / 0.14)'
  })
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent'
  })
  button.addEventListener('click', onSelect)
  host.append(button)

  const toast = document.createElement('div')
  toast.id = toastId
  toast.dataset.gpfcRoot = 'true'
  toast.setAttribute('role', 'status')
  toast.setAttribute('aria-live', 'polite')
  toast.hidden = true
  Object.assign(toast.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    maxWidth: 'min(340px, calc(100vw - 24px))',
    padding: '8px 11px',
    borderRadius: '9px',
    color: '#f9fafb',
    background: '#1f2937',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.22)',
    font: '12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
  })
  document.documentElement.append(toast)

  let animationFrame = 0
  let toastTimer: number | undefined
  let disposed = false

  const placeStable = (composer: HTMLElement | null) => {
    if (host.parentElement !== document.documentElement) {
      document.documentElement.append(host)
    }

    if (!composer) {
      host.style.left = '12px'
      host.style.top = 'auto'
      host.style.bottom = '84px'
      return
    }

    const rect = composer.getBoundingClientRect()
    const left = Math.max(8, rect.left - 40)
    const top = Math.min(
      window.innerHeight - 40,
      Math.max(8, rect.bottom - 40),
    )

    if (rect.width > 0 && rect.height > 0) {
      host.style.left = left + 'px'
      host.style.top = top + 'px'
      host.style.bottom = 'auto'
    } else {
      host.style.left = '12px'
      host.style.top = 'auto'
      host.style.bottom = '84px'
    }
  }

  const positionToast = (composer: HTMLElement | null) => {
    if (toast.hidden) return
    const rect = composer?.getBoundingClientRect()
    const toastRect = toast.getBoundingClientRect()
    const left = rect
      ? Math.min(
          window.innerWidth - toastRect.width - 12,
          Math.max(12, rect.left + 8),
        )
      : 12
    const top = rect
      ? Math.max(12, rect.top - toastRect.height - 10)
      : window.innerHeight - toastRect.height - 92
    toast.style.left = left + 'px'
    toast.style.top = top + 'px'
  }

  const mount = () => {
    if (disposed) return
    const composer = findComposerRoot()
    placeStable(composer)
    positionToast(composer)
  }

  const scheduleMount = () => {
    cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(mount)
  }

  const observer = new MutationObserver((records) => {
    const pageChanged = records.some((record) =>
      [...record.addedNodes, ...record.removedNodes].some((node) => {
        const element =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as Element)
            : node.parentElement
        return !element?.closest('[data-gpfc-root="true"]')
      }),
    )
    if (pageChanged || !host.isConnected) scheduleMount()
  })
  observer.observe(document.documentElement, { subtree: true, childList: true })
  window.addEventListener('resize', scheduleMount)
  window.addEventListener('scroll', scheduleMount, true)
  mount()

  const clearToast = () => {
    if (toastTimer !== undefined) window.clearTimeout(toastTimer)
    toastTimer = undefined
    toast.textContent = ''
    toast.hidden = true
    toast.style.display = 'none'
  }

  const cleanup = () => {
    disposed = true
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    window.removeEventListener('resize', scheduleMount)
    window.removeEventListener('scroll', scheduleMount, true)
    clearToast()
    host.remove()
    toast.remove()
  }
  quickWindow.__gpfcQuickUiCleanup = cleanup

  return {
    showToast(message, kind = 'info', durationMilliseconds) {
      clearToast()
      if (!message) return
      toast.textContent = message
      toast.hidden = false
      toast.style.display = 'block'
      toast.style.background =
        kind === 'error'
          ? '#991b1b'
          : kind === 'success'
            ? '#065f46'
            : '#1f2937'
      positionToast(findComposerRoot())
      const duration = Math.max(
        1200,
        durationMilliseconds ?? defaultToastDurationMilliseconds,
      )
      toastTimer = window.setTimeout(clearToast, duration)
    },
    clearToast,
    setBusy(busy) {
      button.disabled = busy
      button.setAttribute('aria-busy', String(busy))
      button.style.opacity = busy ? '0.58' : '1'
      button.style.cursor = busy ? 'wait' : 'pointer'
    },
  }
}
