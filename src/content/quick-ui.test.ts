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

  it('keeps one icon-only button outside the composer left edge', () => {
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea aria-label="Message"></textarea>',
      '<div id="actions"><button data-testid="composer-plus-btn">+</button></div>',
      '</form>',
    ].join('')

    createQuickUi(() => undefined)
    createQuickUi(() => undefined)

    const button = document.querySelector<HTMLButtonElement>(
      '#gpfc-google-photos-button',
    )
    const host = document.querySelector<HTMLElement>('#gpfc-extension-ui')
    expect(document.querySelectorAll('#gpfc-extension-ui')).toHaveLength(1)
    expect(document.querySelectorAll('#gpfc-extension-toast')).toHaveLength(1)
    expect(host?.parentElement).toBe(document.documentElement)
    expect(host?.dataset.gpfcPosition).toBe('composer-outside-left')
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
    expect(host.style.left).toBe('160px')
    expect(host.style.top).toBe('660px')

    document.querySelector('#actions')?.replaceChildren()
    const voice = document.createElement('button')
    voice.setAttribute('aria-label', 'Stop voice input')
    document.querySelector('#actions')?.append(voice)
    await vi.runAllTimersAsync()

    expect(document.querySelector('#gpfc-extension-ui')).toBe(host)
    expect(host.parentElement).toBe(document.documentElement)
    expect(host.style.left).toBe('160px')
    expect(host.style.top).toBe('660px')
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
    expect(host.style.left).toBe('160px')
    expect(host.style.top).toBe('660px')
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
})
