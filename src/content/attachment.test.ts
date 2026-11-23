import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachFilesToChatGPT,
  findComposerRoot,
  findFileInputs,
  warmChatGPTUploadTargets,
  invalidateComposerRoot,
} from './attachment'

class TestDataTransfer {
  private readonly filesList: File[] = []
  readonly items = {
    add: (file: File) => {
      this.filesList.push(file)
      return null
    },
  }
  effectAllowed = 'none'
  dropEffect = 'none'
  get files(): FileList {
    return this.filesList as unknown as FileList
  }
}

describe('ChatGPT attachment discovery', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    invalidateComposerRoot()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('prefers a multiple image input inside the composer', () => {
    document.body.innerHTML = [
      '<input id="outside" type="file">',
      '<form id="composer">',
      '<textarea aria-label="Message"></textarea>',
      '<input id="inside" type="file" multiple accept="image/*">',
      '</form>',
    ].join('')
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

    expect(findComposerRoot()?.id).toBe('composer')
    expect(findFileInputs([file])[0]?.id).toBe('inside')
  })

  it('routes videos and mixed selections to a general upload input', () => {
    document.body.innerHTML = '<form><textarea></textarea><input id="images" type="file" multiple accept="image/*">' +
      '<input id="files" type="file" multiple><input id="videos" type="file" multiple accept="video/*"></form>'
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const image = new File(['image'], 'photo.png', { type: 'image/png' })
    expect(findFileInputs([video]).map((input) => input.id)).not.toContain('images')
    expect(findFileInputs([image, video]).map((input) => input.id)).toEqual(['files'])
  })

  it('allows a video larger than the image limit to reach the upload input', async () => {
    vi.stubGlobal('DataTransfer', TestDataTransfer)
    document.body.innerHTML = '<form><textarea></textarea><input type="file" multiple></form>'
    const input = document.querySelector('input')!
    Object.defineProperty(input, 'files', { writable: true, value: null })
    input.addEventListener('change', () => { document.querySelector('form')!.append(document.createElement('video')) })
    const video = new File([new Uint8Array(21 * 1024 * 1024)], 'clip.mp4', { type: 'video/mp4' })
    await expect(attachFilesToChatGPT([video])).resolves.toMatchObject({ attempted: 1, method: 'file-input', verified: true })
  })

  it('ignores a single-select input for a multi-file attachment', () => {
    document.body.innerHTML = [
      '<form>',
      '<div contenteditable="true" role="textbox"></div>',
      '<input id="single" type="file" accept="image/*">',
      '<input id="multi" type="file" multiple accept="image/*">',
      '</form>',
    ].join('')
    const files = [
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
    ]

    expect(findFileInputs(files).map((input) => input.id)).toEqual(['multi'])
  })

  it('refreshes the warm cache when React replaces the file input', () => {
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea></textarea>',
      '<input id="old" type="file" multiple accept="image/*">',
      '</form>',
    ].join('')
    warmChatGPTUploadTargets()
    document.querySelector('#old')?.remove()
    document.querySelector('#composer')?.insertAdjacentHTML(
      'beforeend',
      '<input id="replacement" type="file" multiple accept="image/*">',
    )

    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    expect(findFileInputs([file])[0]?.id).toBe('replacement')
  })

  it('discovers a new input even when the old one remains connected', () => {
    document.body.innerHTML = '<form><textarea></textarea><input id="old" type="file"></form>'
    warmChatGPTUploadTargets()
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<input id="new" type="file" multiple>')
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')]
    expect(findFileInputs(files).map((input) => input.id)).toEqual(['new'])
  })

  it('excludes inputs in hidden retained forms while allowing hidden upload inputs', () => {
    document.body.innerHTML = '<form hidden><textarea></textarea><input id="old" type="file" multiple></form>' +
      '<form><textarea id="prompt-textarea"></textarea><input id="new" type="file" multiple style="display:none"></form>'
    expect(findFileInputs([new File(['a'], 'a.png')]).map((input) => input.id)).toEqual(['new'])
  })

  it('allows upload inputs intentionally kept in hidden utility containers', () => {
    document.body.innerHTML = '<form><textarea id="prompt-textarea"></textarea>' +
      '<div hidden><input id="upload" type="file" multiple></div></form>'
    expect(findFileInputs([new File(['a'], 'a.png')]).map((input) => input.id)).toEqual(['upload'])
  })

  it('waits for an input inserted into a portal after the initial input failed', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('DataTransfer', TestDataTransfer)
    try {
      document.body.innerHTML = '<form><textarea></textarea><input id="old" type="file" multiple></form>'
      Object.defineProperty(document.querySelector('#old'), 'files', { writable: true, value: null })
      const operation = attachFilesToChatGPT([new File(['a'], 'a.png')])
      await vi.advanceTimersByTimeAsync(1250)
      const portal = document.createElement('div')
      portal.innerHTML = '<input id="portal" type="file" multiple>'
      const input = portal.querySelector('input')!
      Object.defineProperty(input, 'files', { writable: true, value: null })
      input.addEventListener('change', () => { input.value = ''; Object.defineProperty(input, 'files', { value: [] }) })
      document.body.append(portal)
      await expect(operation).resolves.toMatchObject({ method: 'file-input', attempted: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves attachment verification from the DOM event without polling', async () => {
    vi.stubGlobal('DataTransfer', TestDataTransfer)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()))
      return 1
    })
    document.body.innerHTML = [
      '<form id="composer">',
      '<textarea></textarea>',
      '<input id="upload" type="file" multiple accept="image/*">',
      '</form>',
    ].join('')
    const input = document.querySelector<HTMLInputElement>('#upload')
    Object.defineProperty(input, 'files', { writable: true, value: null })
    input?.addEventListener('change', () => {
      const preview = document.createElement('div')
      preview.dataset.testid = 'attachment-preview'
      document.querySelector('#composer')?.append(preview)
    })

    const result = await attachFilesToChatGPT([
      new File(['x'], 'photo.png', { type: 'image/png' }),
    ])
    expect(result).toMatchObject({
      attempted: 1,
      method: 'file-input',
      verified: true,
    })
  })

  it('does not mistake unrelated composer redraws for successful uploads', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('DataTransfer', TestDataTransfer)
    vi.stubGlobal('DragEvent', class extends Event {})
    try {
      document.body.innerHTML = '<form><textarea></textarea><input type="file" multiple></form>'
      const input = document.querySelector('input')!
      Object.defineProperty(input, 'files', { writable: true, value: null })
      input.addEventListener('change', () => {
        document.querySelector('form')!.insertAdjacentHTML('beforeend', '<span>Unrelated status</span>')
      })
      const operation = attachFilesToChatGPT([new File(['a'], 'a.png')])
      await vi.advanceTimersByTimeAsync(6000)
      await expect(operation).resolves.toMatchObject({ method: 'none', attempted: 0, verified: false })
    } finally {
      vi.useRealTimers()
    }
  })
})
