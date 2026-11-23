import { mediaByteLimit } from '../shared/media'
import {
  markPerformance,
  performancePoints,
  type PerformanceTrace,
} from '../shared/performance'
import type { AttachmentResult } from '../shared/types'

interface AttemptResult {
  accepted: boolean
  verified: boolean
  detail: string
}

let cachedComposer: HTMLElement | null = null
let cachedFileInputs: HTMLInputElement[] = []
export const editorSelector =
  'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]'

export function invalidateComposerRoot(): void {
  cachedComposer = null
}

function isEditorAvailable(editor: HTMLElement): boolean {
  if (editor.closest('[hidden], [aria-hidden="true"], [inert], [data-gpfc-root]')) {
    return false
  }
  for (let node: HTMLElement | null = editor; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function visibleRect(element: Element): DOMRect {
  return element.getBoundingClientRect()
}

function editorCandidates(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(editorSelector),
  ].filter(isEditorAvailable)
}

export function findComposerRoot(): HTMLElement | null {
  if (
    cachedComposer?.isConnected &&
    [...cachedComposer.querySelectorAll<HTMLElement>(editorSelector)].some(
      isEditorAvailable,
    )
  ) return cachedComposer
  const editors = editorCandidates()
  const ranked = editors
    .map((editor) => {
      const form = editor.closest<HTMLElement>('form')
      const root = form ?? editor.parentElement ?? editor
      const rect = visibleRect(root)
      let score = 0
      if (editor.id === 'prompt-textarea') score += 100
      if (form) score += 20
      if (editor === document.activeElement) score += 10
      if (rect.bottom > window.innerHeight * 0.55) score += 8
      if (rect.width > 300) score += 4
      if (rect.height > 0 && rect.width > 0) score += 2
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) score -= 40
      return { root, score, bottom: rect.bottom }
    })
    .sort((left, right) => right.score - left.score || right.bottom - left.bottom)

  cachedComposer = ranked[0]?.root ?? null
  return cachedComposer
}

function scoreFileInput(
  input: HTMLInputElement,
  composer: HTMLElement | null,
): number {
  let score = 0
  const accept = input.accept.toLowerCase()
  if (!input.disabled) score += 20
  if (input.multiple) score += 12
  if (!accept || accept.includes('image') || accept.includes('.png')) score += 10
  if (composer?.contains(input)) score += 30
  if (input.form && input.form === composer) score += 20
  if (input.id === 'upload-files') score += 25
  if (input.dataset.testid === 'upload-photos-input') score += 8
  if (/camera/i.test(input.id)) score -= 30
  if (input.isConnected) score += 5
  return score
}

function inputAcceptsFiles(input: HTMLInputElement, files: File[]): boolean {
  const accepted = input.accept.toLowerCase().split(',').map((part) => part.trim()).filter(Boolean)
  if (accepted.length === 0) return true
  return files.every((file) => accepted.some((type) =>
    type === '*/*' ||
    (type.startsWith('.') ? file.name.toLowerCase().endsWith(type) :
      type.endsWith('/*') ? file.type.toLowerCase().startsWith(type.slice(0, -1)) : file.type.toLowerCase() === type),
  ))
}

export function findFileInputs(files: File[]): HTMLInputElement[] {
  const composer = findComposerRoot()
  // React can retain the old input while inserting a new composer or portal.
  // Connectivity alone does not make the cached list current.
  cachedFileInputs = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ]
  return cachedFileInputs
    .filter(
      (input) =>
        !input.disabled &&
        !input.closest('[inert], [data-gpfc-root]') &&
        !(input.form?.querySelector(editorSelector) && !isEditorAvailable(input.form)) &&
        !input.closest('[hidden], [aria-hidden="true"]')?.querySelector(editorSelector) &&
        inputAcceptsFiles(input, files) &&
        (files.length === 1 || Boolean(input.multiple)),
    )
    .sort(
      (left, right) =>
        scoreFileInput(right, composer) - scoreFileInput(left, composer),
    )
}

function refreshUploadTargets(): void {
  cachedComposer = null
  cachedFileInputs = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ]
  findComposerRoot()
}

export function warmChatGPTUploadTargets(): void {
  if (
    !cachedComposer?.isConnected ||
    cachedFileInputs.length === 0 ||
    cachedFileInputs.some((input) => !input.isConnected)
  ) {
    refreshUploadTargets()
  }
}

function dataTransferFor(files: File[]): DataTransfer {
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  return transfer
}

const attachmentSelector = 'img, video, [data-testid*="attachment"]:not(input):not(button), [data-testid*="upload"]:not(input):not(button), [data-testid*="file"]:not(input):not(button), [role="progressbar"], a[download]'

function meaningfulMutation(records: MutationRecord[], filenames: string[]): boolean {
  return records.some((record) => {
    if (record.type === 'attributes') {
      return record.target instanceof Element && Boolean(record.target.closest(attachmentSelector))
    }
    return [...record.addedNodes].some((node) => {
      const element =
        node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      if (element?.closest('#gpfc-extension-ui')) return false
      return Boolean(element?.matches(attachmentSelector) || element?.querySelector(attachmentSelector)) ||
        filenames.some((filename) => Boolean(filename && node.textContent?.includes(filename)))
    })
  })
}

async function observeMutation(
  root: HTMLElement,
  action: () => boolean,
  trace?: PerformanceTrace,
  timeoutMilliseconds = 2500,
  acceptedWithoutMutation?: () => boolean,
  filenames: string[] = [],
): Promise<{ mutated: boolean; eventAccepted: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false
    let eventAccepted = false
    const finish = (mutated: boolean) => {
      if (settled) return
      settled = true
      observer.disconnect()
      window.clearTimeout(timer)
      resolve({ mutated, eventAccepted })
    }
    const observer = new MutationObserver((records) => {
      if (!meaningfulMutation(records, filenames)) return
      markPerformance(trace, performancePoints.uploadProcessingDetected)
      markPerformance(trace, performancePoints.previewInserted, {
        note: 'inferred from a meaningful composer DOM mutation',
      })
      queueMicrotask(() => {
        markPerformance(trace, performancePoints.previewRendered)
      })
      finish(true)
    })
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'aria-label', 'data-state'],
    })
    const timer = window.setTimeout(
      () => finish(false),
      timeoutMilliseconds,
    )
    try {
      eventAccepted = action()
      queueMicrotask(() => {
        if (eventAccepted || acceptedWithoutMutation?.()) finish(false)
      })
    } catch (error) {
      observer.disconnect()
      window.clearTimeout(timer)
      reject(error)
    }
  })
}

async function attachToInput(
  input: HTMLInputElement,
  files: File[],
  trace?: PerformanceTrace,
  timeoutMilliseconds = 1200,
): Promise<AttemptResult> {
  const root =
    input.form ??
    findComposerRoot() ??
    input.parentElement ??
    document.body
  markPerformance(trace, performancePoints.dataTransferStart)
  const transfer = dataTransferFor(files)

  const observation = await observeMutation(root, () => {
    input.files = transfer.files
    markPerformance(trace, performancePoints.inputFilesAssigned)
    const inputAccepted = input.dispatchEvent(
      new Event('input', { bubbles: true, composed: true }),
    )
    const changeAccepted = input.dispatchEvent(
      new Event('change', { bubbles: true, composed: true }),
    )
    markPerformance(trace, performancePoints.changeDispatched)
    return !inputAccepted || !changeAccepted
  }, trace, timeoutMilliseconds, () => input.files?.length === 0, files.map((file) => file.name))

  const consumed = input.files?.length === 0
  const accepted = observation.mutated || consumed || observation.eventAccepted
  if (!accepted) {
    try {
      input.value = ''
    } catch {
      // Some page-owned inputs reject resets; drag-and-drop remains available.
    }
  }
  return {
    accepted,
    verified: observation.mutated,
    detail: observation.mutated
      ? 'The file input fired input/change and the composer DOM changed.'
      : consumed
        ? 'ChatGPT consumed and reset the file input.'
        : 'The file input did not show evidence that ChatGPT accepted the files.',
  }
}

function createDragEvent(
  type: string,
  transfer: DataTransfer,
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer: transfer,
  })
  if (!event.dataTransfer) {
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
  }
  return event
}

async function attachByDrop(
  files: File[],
  trace?: PerformanceTrace,
): Promise<AttemptResult> {
  const composer = findComposerRoot()
  const editor =
    composer?.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
    ) ?? editorCandidates()[0]
  const target = editor ?? composer ?? document.body
  const observeRoot = composer ?? document.body
  markPerformance(trace, performancePoints.dataTransferStart)
  const transfer = dataTransferFor(files)
  transfer.effectAllowed = 'copy'

  const observation = await observeMutation(observeRoot, () => {
    const enter = createDragEvent('dragenter', transfer)
    const over = createDragEvent('dragover', transfer)
    const drop = createDragEvent('drop', transfer)
    target.dispatchEvent(enter)
    target.dispatchEvent(over)
    transfer.dropEffect = 'copy'
    const dropResult = target.dispatchEvent(drop)
    markPerformance(trace, performancePoints.changeDispatched, {
      note: 'synthetic drop dispatched',
    })
    return !dropResult || drop.defaultPrevented
  }, trace, 2500, undefined, files.map((file) => file.name))

  return {
    accepted: observation.mutated || observation.eventAccepted,
    verified: observation.mutated,
    detail: observation.mutated
      ? 'Drag/drop reached the composer and the attachment DOM changed.'
      : observation.eventAccepted
        ? 'ChatGPT accepted the synthetic drop event; attachment rendering was not observable.'
        : 'ChatGPT did not accept the synthetic drop event.',
  }
}

async function waitForFileInput(
  files: File[],
  timeoutMilliseconds: number,
  tried: Set<HTMLInputElement>,
): Promise<HTMLInputElement | undefined> {
  const immediate = findFileInputs(files).find((input) => !tried.has(input))
  if (immediate) return immediate

  return new Promise((resolve) => {
    let settled = false
    const finish = (input?: HTMLInputElement) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      resolve(input)
    }
    const check = () => {
      refreshUploadTargets()
      const input = findFileInputs(files).find((input) => !tried.has(input))
      if (input) finish(input)
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
    })
    const timer = window.setTimeout(
      () => finish(undefined),
      timeoutMilliseconds,
    )
  })
}

export async function attachFilesToChatGPT(
  files: File[],
  trace?: PerformanceTrace,
): Promise<AttachmentResult> {
  warmChatGPTUploadTargets()
  markPerformance(trace, performancePoints.uploadResolveStart)
  const eligible = files.filter((file) => file.size > 0 && file.size <= mediaByteLimit(file.type))
  if (eligible.length === 0) {
    return {
      attempted: 0,
      method: 'none',
      verified: false,
      detail: 'No file is within the extension limits (images: 20 MB; videos: 100 MB).',
    }
  }

  const tried = new Set<HTMLInputElement>()
  const initialInputs = findFileInputs(eligible)
  if (initialInputs[0]) {
    markPerformance(trace, performancePoints.uploadResolved, {
      note: 'cached or immediate file input',
    })
  }
  for (const [inputIndex, input] of initialInputs.entries()) {
    tried.add(input)
    const result = await attachToInput(
      input,
      eligible,
      trace,
      inputIndex === 0 ? 1200 : 350,
    ).catch(() => ({ accepted: false, verified: false, detail: 'File input unavailable.' }))
    if (result.accepted) {
      return {
        attempted: eligible.length,
        method: 'file-input',
        verified: result.verified,
        detail: result.detail,
      }
    }
  }

  const dynamicInput = await waitForFileInput(eligible, 1800, tried)
  if (dynamicInput && !tried.has(dynamicInput)) {
    markPerformance(trace, performancePoints.uploadResolved, {
      note: 'dynamically inserted file input',
    })
    const result = await attachToInput(dynamicInput, eligible, trace)
      .catch(() => ({ accepted: false, verified: false, detail: 'File input unavailable.' }))
    if (result.accepted) {
      return {
        attempted: eligible.length,
        method: 'file-input',
        verified: result.verified,
        detail: result.detail,
      }
    }
  }

  if (!initialInputs[0] && !dynamicInput) {
    markPerformance(trace, performancePoints.uploadResolved, {
      note: 'drag/drop fallback target',
    })
  }
  const dropResult = await attachByDrop(eligible, trace)
  if (dropResult.accepted) {
    return {
      attempted: eligible.length,
      method: 'drag-drop',
      verified: dropResult.verified,
      detail: dropResult.detail,
    }
  }

  return {
    attempted: 0,
    method: 'none',
    verified: false,
    detail:
      'Could not find a usable file input and ChatGPT did not accept drag-and-drop. Reload ChatGPT and try again.',
  }
}
