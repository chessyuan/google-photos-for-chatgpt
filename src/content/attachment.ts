import { CHATGPT_IMAGE_LIMIT_BYTES } from '../shared/constants'
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

function visibleRect(element: Element): DOMRect {
  return element.getBoundingClientRect()
}

function editorCandidates(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
    ),
  ].filter((element) => !element.closest('#gpfc-extension-ui'))
}

export function findComposerRoot(): HTMLElement | null {
  if (cachedComposer?.isConnected) return cachedComposer
  const editors = editorCandidates()
  const ranked = editors
    .map((editor) => {
      const form = editor.closest<HTMLElement>('form')
      const root = form ?? editor.parentElement ?? editor
      const rect = visibleRect(root)
      let score = 0
      if (form) score += 20
      if (editor === document.activeElement) score += 10
      if (rect.bottom > window.innerHeight * 0.55) score += 8
      if (rect.width > 300) score += 4
      if (rect.height > 0 && rect.width > 0) score += 2
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

export function findFileInputs(files: File[]): HTMLInputElement[] {
  const composer = findComposerRoot()
  if (
    cachedFileInputs.length === 0 ||
    cachedFileInputs.some((input) => !input.isConnected)
  ) {
    cachedFileInputs = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ]
  }
  return cachedFileInputs
    .filter(
      (input) =>
        !input.disabled && (files.length === 1 || Boolean(input.multiple)),
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

function meaningfulMutation(records: MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.type === 'attributes') return true
    return [...record.addedNodes, ...record.removedNodes].some((node) => {
      const element =
        node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      return !element?.closest('#gpfc-extension-ui')
    })
  })
}

async function observeMutation(
  root: HTMLElement,
  action: () => boolean,
  trace?: PerformanceTrace,
  timeoutMilliseconds = 2500,
  acceptedWithoutMutation?: () => boolean,
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
      if (!meaningfulMutation(records)) return
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
  }, trace, timeoutMilliseconds, () => input.files?.length === 0)

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
    const enterResult = target.dispatchEvent(enter)
    const overResult = target.dispatchEvent(over)
    transfer.dropEffect = 'copy'
    const dropResult = target.dispatchEvent(drop)
    markPerformance(trace, performancePoints.changeDispatched, {
      note: 'synthetic drop dispatched',
    })
    return !enterResult || !overResult || !dropResult || drop.defaultPrevented
  }, trace)

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
): Promise<HTMLInputElement | undefined> {
  const immediate = findFileInputs(files)[0]
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
      const input = findFileInputs(files)[0]
      if (input) finish(input)
    }
    const observer = new MutationObserver(check)
    const composer = findComposerRoot()
    observer.observe(composer?.parentElement ?? document.body, {
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
  const eligible = files.filter((file) => file.size <= CHATGPT_IMAGE_LIMIT_BYTES)
  if (eligible.length === 0) {
    return {
      attempted: 0,
      method: 'none',
      verified: false,
      detail: 'No file is within ChatGPT’s documented 20 MB image limit.',
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
    )
    if (result.accepted) {
      return {
        attempted: eligible.length,
        method: 'file-input',
        verified: result.verified,
        detail: result.detail,
      }
    }
  }

  const dynamicInput = await waitForFileInput(eligible, 1800)
  if (dynamicInput && !tried.has(dynamicInput)) {
    markPerformance(trace, performancePoints.uploadResolved, {
      note: 'dynamically inserted file input',
    })
    const result = await attachToInput(dynamicInput, eligible, trace)
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
