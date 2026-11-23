import {
  editorSelector,
  findComposerRoot,
  invalidateComposerRoot,
} from './attachment'
import { message } from '../shared/i18n'

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

export function createQuickUi(onSelect: () => void, onIntent?: () => void): QuickUi {
  document.dispatchEvent(new Event('gpfc-dispose-content-ui'))
  const quickWindow = window as QuickUiWindow
  quickWindow.__gpfcQuickUiCleanup?.()

  // Older invalidated worlds can retain observers. Reuse their DOM hosts so
  // those observers cannot resurrect a second button during this migration.
  const host = document.getElementById(hostId) ?? document.createElement('span')
  host.replaceChildren()
  host.id = hostId
  host.dataset.gpfcRoot = 'true'
  host.dataset.gpfcPosition = 'composer-above-left'
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
  button.setAttribute('aria-label', message('selectFromGooglePhotos'))
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
  if (onIntent) {
    button.addEventListener('pointerenter', onIntent)
    button.addEventListener('focus', onIntent)
  }
  host.append(button)

  const toast = document.getElementById(toastId) ?? document.createElement('div')
  toast.replaceChildren()
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
  let observedComposer: HTMLElement | null = null
  let observedPlus: HTMLElement | undefined
  let observedVoice: HTMLElement | undefined
  let settleTimer: number | undefined
  let trackLayoutUntil = 0
  const viewport = window.visualViewport

  const viewportBounds = () => ({
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
    bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
  })
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.max(minimum, Math.min(value, Math.max(minimum, maximum)))

  const sidebarSelector = [
    'nav', 'aside', '[role="navigation"]', '[role="complementary"]',
    '[id*="sidebar" i]', '[class*="sidebar" i]', '[data-testid*="sidebar" i]',
  ].join(',')
  const plusSelector = [
    '[data-testid="composer-plus-btn"]', '#composer-plus-btn',
    'button[aria-label*="attach" i]', 'button[aria-label*="add files" i]',
    'button[aria-label*="add photos" i]', 'button[aria-label*="upload" i]',
    'button[aria-label*="添加文件"]', 'button[aria-label*="添加照片"]',
    'button[aria-label*="添加图片"]', 'button[aria-label*="上传"]',
  ].join(',')
  const voiceSelector = [
    '[data-testid="voice-mode-button"]', '[data-testid="composer-voice-button"]',
    'button[aria-label="Start Voice" i]', 'button[aria-label*="voice mode" i]',
    'button[aria-label*="语音模式"]', 'button[aria-label*="语音聊天"]',
  ].join(',')

  const isRendered = (element: HTMLElement): boolean => {
    if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const findControl = (composer: HTMLElement, selector: string): HTMLElement | undefined => {
    const composerRect = composer.getBoundingClientRect()
    const editor = composer.querySelector<HTMLElement>('#prompt-textarea, ' + editorSelector)
    const editorRect = editor && isRendered(editor) ? editor.getBoundingClientRect() : undefined
    const reference = composerRect.width > 0 && composerRect.height > 0 ? composerRect : editorRect
    let scope: HTMLElement | null = composer
    for (let depth = 0; scope && scope !== document.body && depth < 3; depth += 1, scope = scope.parentElement) {
      const control = [...scope.querySelectorAll<HTMLElement>(selector)].find((element) => {
        if (element.closest('[data-gpfc-root="true"]') || !isRendered(element)) return false
        const rect = element.getBoundingClientRect()
        const bounds = viewportBounds()
        return rect.right > bounds.left && rect.left < bounds.right &&
          rect.bottom > bounds.top && rect.top < bounds.bottom &&
          (!reference || (rect.bottom > reference.top - 96 && rect.top < reference.bottom + 96))
      })
      if (control) return control
    }
    return undefined
  }

  const visualComposerBounds = (
    composer: HTMLElement,
    control: HTMLElement | undefined,
    editor: HTMLElement | null | undefined,
  ): DOMRect | undefined => {
    if (!control || !editor) return undefined
    for (let node = control.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.contains(editor) && isRendered(node)) return node.getBoundingClientRect()
      if (node === composer.parentElement) break
    }
    return undefined
  }

  const sidebarBlocks = (composer: HTMLElement | null, left: number, top: number): boolean => {
    for (const panel of document.querySelectorAll<HTMLElement>(sidebarSelector)) {
      if (panel.contains(composer) || panel.closest('[data-gpfc-root="true"]') || !isRendered(panel)) continue
      const occupied = panel.getBoundingClientRect()
      if (left + 32 <= occupied.left || left >= occupied.right ||
        top + 32 <= occupied.top || top >= occupied.bottom) continue
      const x = (Math.max(left, occupied.left) + Math.min(left + 32, occupied.right)) / 2
      const y = (Math.max(top, occupied.top) + Math.min(top + 32, occupied.bottom)) / 2
      if (typeof document.elementsFromPoint !== 'function') {
        if (getComputedStyle(panel).pointerEvents !== 'none') return true
        continue
      }
      const hit = document.elementsFromPoint(x, y).find((element) =>
        !element.closest('[data-gpfc-root="true"], [role="tooltip"], [data-radix-popper-content-wrapper]') &&
        getComputedStyle(element).pointerEvents !== 'none',
      )
      if (hit && panel.contains(hit)) return true
    }
    return false
  }

  const placeStable = (
    composer: HTMLElement | null,
    plus: HTMLElement | undefined,
    voice: HTMLElement | undefined,
  ) => {
    if (host.parentElement !== document.documentElement) {
      document.documentElement.append(host)
    }

    const bounds = viewportBounds()
    const plusRect = plus?.getBoundingClientRect()
    const voiceRect = voice?.getBoundingClientRect()
    const editor = composer?.querySelector<HTMLElement>('#prompt-textarea, ' + editorSelector)
    const editorRect = editor && isRendered(editor) ? editor.getBoundingClientRect() : undefined
    const composerRect = composer?.getBoundingClientRect()
    const rect = (composer && visualComposerBounds(composer, plus ?? voice, editor)) ||
      (composerRect && composerRect.width > 0 && composerRect.height > 0 ? composerRect : undefined) ||
      plusRect || voiceRect || editorRect
    const composerVisible = Boolean(composer && rect && rect.width > 0 && rect.height > 0 &&
      rect.bottom > bounds.top && rect.top < bounds.bottom &&
      rect.right > bounds.left && rect.left < bounds.right)
    let mode = composerVisible ? 'composer-above-left' : 'viewport-fallback'
    const anchor = plusRect ?? voiceRect
    if (!plusRect && voiceRect) mode = 'composer-above-voice'
    const fallbackLeft = editorRect && rect && Math.abs(editorRect.left - rect.left) > 48
      ? editorRect.left - 40
      : rect ? rect.left + 8 : bounds.right - 48
    let left = clamp(composerVisible
      ? anchor ? anchor.left + (anchor.width - 32) / 2 : fallbackLeft
      : bounds.right - 48, bounds.left + 8, bounds.right - 40)
    const top = clamp(composerVisible && rect ? rect.top - 40 : bounds.bottom - 88, bounds.top + 8, bounds.bottom - 40)

    // Invisible sidebar containers must not push the icon into the middle.
    // When a real sidebar blocks the left slot, use another composer edge.
    if (composerVisible && sidebarBlocks(composer, left, top) && mode !== 'composer-above-voice') {
      if (voiceRect) {
        left = clamp(voiceRect.left + (voiceRect.width - 32) / 2, bounds.left + 8, bounds.right - 40)
        mode = 'composer-above-voice'
      } else if (rect) {
        left = clamp((editorRect?.right ?? rect.right) - 40, bounds.left + 8, bounds.right - 40)
        mode = 'composer-above-right'
      }
    }

    // A focused modal or menu should be able to cover the button, without
    // mistaking invisible dialogs elsewhere in ChatGPT for an active modal.
    const overlay = document.activeElement?.closest<HTMLElement>(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open], [role="menu"], [role="listbox"]',
    )
    const overlayRect = overlay?.getBoundingClientRect()
    const overlayCoversButton = Boolean(overlay && overlayRect && isRendered(overlay) &&
      !overlay.contains(composer) &&
      (overlay.matches('[aria-modal="true"], dialog[open]') ||
        (left + 32 > overlayRect.left && left < overlayRect.right &&
          top + 32 > overlayRect.top && top < overlayRect.bottom)))
    host.style.zIndex = overlayCoversButton ? '0' : '2147483646'
    host.style.display = 'inline-flex'
    host.dataset.gpfcPosition = mode
    host.style.left = left + 'px'
    host.style.top = top + 'px'
    host.style.bottom = 'auto'
  }

  const positionToast = (composer: HTMLElement | null) => {
    if (toast.hidden) return
    const rect = composer?.getBoundingClientRect()
    const toastRect = toast.getBoundingClientRect()
    const bounds = viewportBounds()
    const left = rect
      ? Math.min(
          window.innerWidth - toastRect.width - 12,
          Math.max(12, rect.left + 8),
        )
      : 12
    const top = rect
      ? Math.max(12, rect.top - toastRect.height - 10)
      : window.innerHeight - toastRect.height - 92
    toast.style.left = clamp(left, bounds.left + 12, bounds.right - toastRect.width - 12) + 'px'
    toast.style.top = clamp(top, bounds.top + 12, bounds.bottom - toastRect.height - 12) + 'px'
  }

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => scheduleMount())
    : undefined

  const mount = () => {
    if (disposed) return
    const composer = findComposerRoot()
    const plus = composer ? findControl(composer, plusSelector) : undefined
    const voice = composer ? findControl(composer, voiceSelector) : undefined
    if (composer !== observedComposer || plus !== observedPlus || voice !== observedVoice) {
      observedComposer = composer
      observedPlus = plus
      observedVoice = voice
      resizeObserver?.disconnect()
      // Width modifiers can resize an inner visual composer while the form
      // itself stays unchanged, so observe the controls' ancestors too.
      const nodes = new Set<HTMLElement>()
      for (const start of [composer, plus, voice]) {
        for (let node: HTMLElement | null | undefined = start; node; node = node.parentElement) {
          nodes.add(node)
        }
      }
      for (const node of nodes) resizeObserver?.observe(node)
    }
    placeStable(composer, plus, voice)
    positionToast(composer)
    if (performance.now() < trackLayoutUntil) scheduleMount()
  }

  const scheduleMount = () => {
    if (disposed || animationFrame) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0
      mount()
    })
  }

  const observer = new MutationObserver((records) => {
    const editorsChanged = records.some((record) => {
      if (record.type === 'attributes') {
        const target = record.target as Element
        return target.contains(observedComposer) ||
          target.matches(editorSelector) || Boolean(target.querySelector(editorSelector))
      }
      return [...record.addedNodes, ...record.removedNodes].some((node) =>
        node instanceof Element &&
        (node.matches(editorSelector) || Boolean(node.querySelector(editorSelector))),
      )
    })
    if (editorsChanged) invalidateComposerRoot()
    const pageChanged = records.some((record) =>
      record.type === 'attributes'
        ? !(record.target as Element).closest('[data-gpfc-root="true"]')
        :
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
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-modal', 'data-state', 'open', 'popover', 'inert', 'contenteditable'],
  })
  const onLayoutTransition = (event: Event) => {
    const target = event.target as Element
    if (target?.closest?.('[data-gpfc-root="true"]')) return
    if ((event.type === 'transitionrun' || event.type === 'animationstart') &&
      (target?.contains?.(observedComposer) || target?.closest?.('nav, aside, [role="navigation"], [role="complementary"], [id*="sidebar" i], [class*="sidebar" i], [data-testid*="sidebar" i], [role="dialog"], [role="menu"]'))) {
      const style = getComputedStyle(target)
      const times = [style.transitionDuration, style.transitionDelay, style.animationDuration, style.animationDelay]
        .flatMap((value) => value.split(',').map((part) => {
          const parsed = Number.parseFloat(part)
          return Number.isFinite(parsed) ? parsed * (part.trim().endsWith('ms') ? 1 : 1000) : 0
        }))
      trackLayoutUntil = Math.max(trackLayoutUntil, performance.now() + Math.min(2000, Math.max(250, ...times) + 100))
    }
    scheduleMount()
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(scheduleMount, 200)
  }
  const onFocus = () => {
    invalidateComposerRoot()
    scheduleMount()
  }
  window.addEventListener('resize', scheduleMount)
  window.addEventListener('scroll', scheduleMount, true)
  viewport?.addEventListener('resize', scheduleMount)
  viewport?.addEventListener('scroll', scheduleMount)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('transitionrun', onLayoutTransition, true)
  document.addEventListener('transitionend', onLayoutTransition, true)
  document.addEventListener('animationstart', onLayoutTransition, true)
  document.addEventListener('animationend', onLayoutTransition, true)
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
    document.removeEventListener('gpfc-dispose-content-ui', cleanup)
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    resizeObserver?.disconnect()
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    window.removeEventListener('resize', scheduleMount)
    window.removeEventListener('scroll', scheduleMount, true)
    viewport?.removeEventListener('resize', scheduleMount)
    viewport?.removeEventListener('scroll', scheduleMount)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('transitionrun', onLayoutTransition, true)
    document.removeEventListener('transitionend', onLayoutTransition, true)
    document.removeEventListener('animationstart', onLayoutTransition, true)
    document.removeEventListener('animationend', onLayoutTransition, true)
    clearToast()
    host.remove()
    toast.remove()
  }
  document.addEventListener('gpfc-dispose-content-ui', cleanup)
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
