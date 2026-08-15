import { downloadJobFiles } from './shared/download-client'
import { errorMessage } from './shared/errors'
import type {
  AttachmentResult,
  JobStatusMessage,
  RuntimeResponse,
} from './shared/types'

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('Phase 1 HTML is incomplete: ' + selector)
  return element
}

const input = required<HTMLInputElement>('#phase-one-input')
const button = required<HTMLButtonElement>('#phase-one-start')
const status = required<HTMLDivElement>('#phase-one-status')
const list = required<HTMLUListElement>('#phase-one-files')

let currentTabId: number | undefined
const activeDownloads = new Set<string>()

function setStatus(
  message: string,
  kind: 'info' | 'success' | 'error' = 'info',
): void {
  status.textContent = message
  status.className = 'status' + (kind === 'info' ? '' : ' ' + kind)
}

async function attachJob(jobId: string): Promise<void> {
  if (activeDownloads.has(jobId)) return
  activeDownloads.add(jobId)
  button.disabled = true
  try {
    const result = await downloadJobFiles(jobId, (message) => setStatus(message))
    if (result.files.length === 0) {
      throw new Error('No file was downloaded. ' + result.skipped.join(' | '))
    }

    const transfer = new DataTransfer()
    for (const file of result.files) transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    list.replaceChildren(
      ...result.files.map((file) => {
        const item = document.createElement('li')
        item.textContent =
          file.name +
          ' — ' +
          file.type +
          ' — ' +
          (file.size / 1024).toFixed(1) +
          ' KB'
        return item
      }),
    )

    const verified = input.files?.length === result.files.length
    const attachment: AttachmentResult = {
      attempted: result.files.length,
      method: 'test-input',
      verified,
      detail: verified
        ? 'Phase 1 passed: File[] is present in the ordinary multiple file input.'
        : 'Phase 1 failed: the ordinary file input did not retain all files.',
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'ATTACH_RESULT',
      jobId,
      result: attachment,
    })) as RuntimeResponse
    if (!response.ok) throw new Error(response.error)

    setStatus(
      attachment.detail +
        (result.skipped.length ? '\nSkipped:\n' + result.skipped.join('\n') : ''),
      verified ? 'success' : 'error',
    )
  } catch (error) {
    setStatus(errorMessage(error), 'error')
  } finally {
    activeDownloads.delete(jobId)
    button.disabled = false
  }
}

button.addEventListener('click', () => {
  void (async () => {
    button.disabled = true
    setStatus('Starting official Google Photos Picker…')
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'START_PICKER',
        targetKind: 'test',
        maxItemCount: 50,
        clickStartedAt: performance.timeOrigin + performance.now(),
      })) as RuntimeResponse
      if (!response.ok) throw new Error(response.error)
      if (response.job?.status === 'ready') await attachJob(response.job.id)
    } catch (error) {
      setStatus(errorMessage(error), 'error')
      button.disabled = false
    }
  })()
})

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: unknown }).type !== 'JOB_STATUS'
  ) {
    return
  }
  const update = message as JobStatusMessage
  if (update.targetTabId !== currentTabId) return

  setStatus(
    update.job.message,
    update.job.status === 'error'
      ? 'error'
      : update.job.status === 'complete'
        ? 'success'
        : 'info',
  )
  if (update.job.status === 'ready') void attachJob(update.job.id)
})

void (async () => {
  currentTabId = (await chrome.tabs.getCurrent())?.id
})()
