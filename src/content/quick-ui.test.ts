import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuickUi } from './quick-ui'

interface TestWindow extends Window {
  __gpfcQuickUiCleanup?: () => void
}

describe('ChatGPT quick UI', () => {
  beforeEach(() => {
    ;(window as TestWindow).__gpfcQuickUiCleanup?.()
    document.body.replaceChildren()
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    ;(window as TestWindow).__gpfcQuickUiCleanup?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps one icon-only button above the composer', () => {
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea aria-label="Message"></textarea>',
      '<div id="actions"><button data-testid="composer-plus-btn">+</button></div>',
      '</form>',
    ].join('')

    setRect(document.querySelector('form')!, 200, 600, 800, 100)

    createQuickUi(() => undefined)
    createQuickUi(() => undefined)

    const button = document.querySelector<HTMLButtonElement>(
      '#gpfc-google-photos-button',
    )
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')
    expect(document.querySelectorAll('#gpfc-extension-ui')).toHaveLength(1)
    expect(document.querySelectorAll('#gpfc-extension-toast')).toHaveLength(1)
    expect(host?.parentElement).toBe(document.documentElement)
    expect(host?.dataset.gpfcPosition).toBe('composer-above-left')
    expect(host?.style.position).toBe('fixed')
    expect(button?.textContent).toBe('')
    expect(button?.querySelector('svg')).not.toBeNull()
    expect(button?.style.height).toBe('32px')
    expect(button?.style.width).toBe('32px')
    expect(button?.style.border).toBe('0px')
    expect(document.querySelector<HTMLElement>('#gpfc-extension-toast')?.hidden).toBe(
      true,
    )
  })

  it('automatically removes toast text and remounts without duplicates', async () => {
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea aria-label="Message"></textarea>',
      '<div id="actions"><button aria-label="Attach files">+</button></div>',
      '</form>',
    ].join('')
    const ui = createQuickUi(() => undefined)
    ui.showToast('Temporary message', 'error')

    const toast = document.querySelector<HTMLElement>('#gpfc-extension-toast')
    expect(toast?.hidden).toBe(false)
    expect(toast?.textContent).toBe('Temporary message')

    document.querySelector('#actions')?.replaceChildren()
    const replacement = document.createElement('button')
    replacement.setAttribute('aria-label', 'Upload files')
    document.querySelector('#actions')?.append(replacement)
    await vi.runAllTimersAsync()

    expect(toast?.hidden).toBe(true)
    expect(toast?.textContent).toBe('')
    expect(document.querySelectorAll('#gpfc-extension-ui')).toHaveLength(1)
    expect(document.querySelector('#gpfc-extension-ui')?.parentElement).toBe(
      document.documentElement,
    )
    expect(replacement.nextElementSibling).toBeNull()
  })

  it('does not move into voice controls when the composer rerenders', async () => {
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea aria-label="Message"></textarea>',
      '<div id="actions"><button data-testid="composer-plus-btn">+</button></div>',
      '</form>',
    ].join('')
    const composer = document.querySelector<HTMLElement>('#composer')!
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue({
      x: 200,
      y: 600,
      left: 200,
      top: 600,
      right: 1000,
      bottom: 700,
      width: 800,
      height: 100,
      toJSON: () => ({}),
    })

    createQuickUi(() => undefined)
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    expect(host.style.left).toBe('208px')
    expect(host.style.top).toBe('560px')

    document.querySelector('#actions')?.replaceChildren()
    const voice = document.createElement('button')
    voice.setAttribute('aria-label', 'Stop voice input')
    document.querySelector('#actions')?.append(voice)
    await vi.runAllTimersAsync()

    expect(document.querySelector('#gpfc-extension-ui')).toBe(host)
    expect(host.parentElement).toBe(document.documentElement)
    expect(host.style.left).toBe('208px')
    expect(host.style.top).toBe('560px')
    expect(document.querySelectorAll('#gpfc-extension-ui')).toHaveLength(1)

    const replacementComposer = document.createElement('form')
    replacementComposer.innerHTML = [
      '<textarea aria-label="Message"></textarea>',
      '<button aria-label="Start voice input">Voice</button>',
    ].join('')
    vi.spyOn(replacementComposer, 'getBoundingClientRect').mockReturnValue({
      x: 200,
      y: 600,
      left: 200,
      top: 600,
      right: 1000,
      bottom: 700,
      width: 800,
      height: 100,
      toJSON: () => ({}),
    })
    composer.replaceWith(replacementComposer)
    await vi.runAllTimersAsync()

    expect(document.querySelector('#gpfc-extension-ui')).toBe(host)
    expect(host.parentElement).toBe(document.documentElement)
    expect(host.style.left).toBe('208px')
    expect(host.style.top).toBe('560px')
    expect(document.querySelectorAll('#gpfc-extension-ui')).toHaveLength(1)
  })

  it('restores the compact button immediately when launch busy state ends', () => {
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea aria-label="Message"></textarea>',
      '<button aria-label="Attach files">+</button>',
      '</form>',
    ].join('')
    const ui = createQuickUi(() => undefined)
    const button = document.querySelector<HTMLButtonElement>(
      '#gpfc-google-photos-button',
    )

    ui.setBusy(true)
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toBe('')

    ui.setBusy(false)
    expect(button?.disabled).toBe(false)
    expect(button?.textContent).toBe('')
    expect(button?.getAttribute('aria-busy')).toBe('false')
  })

  function setRect(element: HTMLElement, left: number, top: number, width: number, height: number) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: left, y: top, left, top, right: left + width, bottom: top + height,
      width, height, toJSON: () => ({}),
    })
  }

  it('follows composer size changes even without a DOM mutation', async () => {
    let resized: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe = vi.fn()
      disconnect = vi.fn()
    })
    document.body.innerHTML = '<form><textarea id="prompt-textarea"></textarea></form>'
    const composer = document.querySelector('form')!
    setRect(composer, 200, 500, 700, 100)
    createQuickUi(() => undefined)
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    expect(host.style.top).toBe('460px')
    setRect(composer, 240, 450, 650, 200)
    resized?.()
    await vi.runAllTimersAsync()
    expect(host.style.left).toBe('248px')
    expect(host.style.top).toBe('410px')
  })

  it('switches away from a hidden composer that remains connected', async () => {
    document.body.innerHTML = '<form id="old"><textarea></textarea></form>'
    const old = document.querySelector<HTMLElement>('#old')!
    setRect(old, 200, 500, 700, 100)
    createQuickUi(() => undefined)
    old.hidden = true
    const next = document.createElement('form')
    next.innerHTML = '<div id="prompt-textarea" contenteditable="true" role="textbox"></div>'
    setRect(next, 280, 550, 600, 100)
    document.body.append(next)
    await vi.runAllTimersAsync()
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    expect(host.style.left).toBe('288px')
    expect(host.style.top).toBe('510px')
    next.remove()
    await vi.runAllTimersAsync()
    expect(host.style.display).toBe('inline-flex')
    expect(host.dataset.gpfcPosition).toBe('viewport-fallback')
  })

  it('places the button above a narrow composer without overlapping attachment controls', () => {
    document.body.innerHTML = '<form><textarea></textarea><button data-testid="composer-plus-btn">+</button></form>'
    setRect(document.querySelector('form')!, 10, 600, 360, 100)
    setRect(document.querySelector<HTMLButtonElement>('[data-testid="composer-plus-btn"]')!, 20, 650, 32, 32)
    createQuickUi(() => undefined)
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    expect(host.style.left).toBe('20px')
    expect(host.style.top).toBe('560px')
    expect(host.dataset.gpfcPosition).toBe('composer-above-left')
  })

  it('keeps the same coordinates when a voice tooltip appears and disappears', async () => {
    document.body.innerHTML = '<form><textarea></textarea><button aria-label="Start Voice">Voice</button></form>'
    setRect(document.querySelector('form')!, 200, 600, 800, 100)
    setRect(document.querySelector<HTMLButtonElement>('[aria-label="Start Voice"]')!, 930, 650, 32, 32)
    createQuickUi(() => undefined)
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    const before = [host.style.left, host.style.top, host.style.display]
    const tooltip = document.createElement('div')
    tooltip.setAttribute('role', 'tooltip')
    setRect(tooltip, 890, 570, 100, 28)
    document.body.append(tooltip)
    await vi.runAllTimersAsync()
    expect([host.style.left, host.style.top, host.style.display]).toEqual(before)
    tooltip.remove()
    await vi.runAllTimersAsync()
    expect([host.style.left, host.style.top, host.style.display]).toEqual(before)
  })

  it('aligns horizontally with the attachment control while staying above the composer', () => {
    document.body.innerHTML = '<form><textarea></textarea><button data-testid="composer-plus-btn">+</button></form>'
    setRect(document.querySelector('form')!, 200, 450, 600, 200)
    setRect(document.querySelector<HTMLButtonElement>('[data-testid="composer-plus-btn"]')!, 210, 602, 36, 36)
    createQuickUi(() => undefined)
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    expect(host.style.left).toBe('212px')
    expect(host.style.top).toBe('410px')
  })

  it('keeps its position during a viewport resize while it remains visible', async () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 100, offsetTop: 300, width: 360, height: 250,
    })
    vi.stubGlobal('visualViewport', viewport)
    document.body.innerHTML = '<form><textarea></textarea></form>'
    setRect(document.querySelector('form')!, 250, 420, 350, 120)
    createQuickUi(() => undefined)
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')!
    expect(host.style.left).toBe('258px')
    expect(host.style.top).toBe('380px')
    viewport.height = 180
    viewport.dispatchEvent(new Event('resize'))
    await vi.runAllTimersAsync()
    expect(host.style.top).toBe('380px')
  })
})
