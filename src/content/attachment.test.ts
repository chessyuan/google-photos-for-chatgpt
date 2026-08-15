import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachFilesToChatGPT,
  findComposerRoot,
  findFileInputs,
  warmChatGPTUploadTargets,
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
})
