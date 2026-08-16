import {
  attachFilesToChatGPT,
  warmChatGPTUploadTargets,
} from './content/attachment'
import { createQuickUi } from './content/quick-ui'
import { errorMessage } from './shared/errors'
import { message } from './shared/i18n'
import { downloadJobFiles } from './shared/download-client'
import {
  markPerformance,
  mergePerformanceEntries,
  performancePoints,
  printPerformanceReport,
} from './shared/performance'
import type {
  JobStatusMessage,
  PublicJob,
  RuntimeRequest,
  RuntimeResponse,
} from './shared/types'

interface PhaseTwoCommand {
  type: 'RUN_PHASE2'
  count?: number
}

const activeDownloads = new Set<string>()
let lastTerminalToast = ''

function sendRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>
}

const ui = createQuickUi(() => {
  void startPicker()
})

async function warmPicker(): Promise<void> {
  try {
    await sendRequest({ type: 'WARM_PICKER' })
  } catch {
    // Prewarming is opportunistic and must never affect the page or first click.
  }
}

function displayJob(job: PublicJob, showTerminalToast = true): void {
  if (job.status === 'cancelled') {
    ui.clearToast()
    return
  }
  if (!showTerminalToast || !['complete', 'error'].includes(job.status)) {
    return
  }

  const toastKey = job.id + ':' + job.status + ':' + job.updatedAt
  if (toastKey === lastTerminalToast) return
  lastTerminalToast = toastKey

  if (job.status === 'complete') {
    const warningSuffix =
      job.warnings.length > 0
        ? ' ' +
          message('compatibilityWarnings', String(job.warnings.length))
        : ''
    ui.showToast(
      message('photosAdded', String(job.selectedCount)) + warningSuffix,
      'success',
    )
  } else {
    ui.showToast(job.message, 'error')
  }
}

async function attachReadyJob(job: PublicJob): Promise<void> {
  if (activeDownloads.has(job.id)) return
  activeDownloads.add(job.id)
  const trace = job.performanceTrace
    ? structuredClone(job.performanceTrace)
    : undefined
  let workingToastShown = false
  const workingToastTimer = window.setTimeout(() => {
    workingToastShown = true
    ui.showToast(message('addingPhotos'), 'info', 30_000)
  }, 300)

  try {
    const downloaded = await downloadJobFiles(job.id, () => undefined)
    mergePerformanceEntries(trace, downloaded.performanceEntries)
    if (downloaded.files.length === 0) {
      const detail =
        'No photo was downloaded. ' + downloaded.skipped.join(' | ')
      await sendRequest({
        type: 'ATTACH_RESULT',
        jobId: job.id,
        result: {
          attempted: 0,
          method: 'none',
          verified: false,
          detail,
        },
      })
      throw new Error(detail)
    }

    const result = await attachFilesToChatGPT(downloaded.files, trace)
    markPerformance(trace, performancePoints.totalComplete)
    result.performanceEntries = trace?.entries
    window.clearTimeout(workingToastTimer)
    if (workingToastShown) ui.clearToast()
    printPerformanceReport(trace)
    const response = await sendRequest({
      type: 'ATTACH_RESULT',
      jobId: job.id,
      result,
    })
    if (!response.ok) throw new Error(response.error)

    if (response.job) displayJob(response.job)
  } catch (error) {
    window.clearTimeout(workingToastTimer)
    if (workingToastShown) ui.clearToast()
    ui.showToast(errorMessage(error), 'error')
    window.setTimeout(() => {
      void refreshJob(false)
    }, 1200)
  } finally {
    window.clearTimeout(workingToastTimer)
    activeDownloads.delete(job.id)
  }
}

async function handleJob(job: PublicJob): Promise<void> {
  displayJob(job)
  if (job.status === 'ready') await attachReadyJob(job)
}

async function startPicker(): Promise<void> {
  ui.setBusy(true)
  ui.clearToast()
  try {
    const response = await sendRequest({
      type: 'START_PICKER',
      targetKind: 'chatgpt',
      clickStartedAt: performance.timeOrigin + performance.now(),
    })
    if (!response.ok) throw new Error(response.error)
    if (response.job) await handleJob(response.job)
  } catch (error) {
    ui.showToast(errorMessage(error), 'error')
  } finally {
    ui.setBusy(false)
  }
}

function phaseTwoFiles(count = 2): File[] {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4sUAAAAASUVORK5CYII='
  const binary = atob(pngBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const safeCount = Math.max(1, Math.min(5, Math.trunc(count)))
  return Array.from(
    { length: safeCount },
    (_, index) =>
      new File([bytes], 'gpfc-phase2-' + (index + 1) + '.png', {
        type: 'image/png',
      }),
  )
}

async function runPhaseTwo(count = 2): Promise<string> {
  ui.setBusy(true)
  ui.clearToast()
  try {
    const result = await attachFilesToChatGPT(phaseTwoFiles(count))
    ui.showToast(
      'Phase 2: ' + result.detail,
      result.method === 'none' ? 'error' : result.verified ? 'success' : 'info',
    )
    return result.detail
  } finally {
    ui.setBusy(false)
  }
}

function isJobStatusMessage(value: unknown): value is JobStatusMessage {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'JOB_STATUS'
  )
}

function isPhaseTwoCommand(value: unknown): value is PhaseTwoCommand {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'RUN_PHASE2'
  )
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: { ok: boolean; detail?: string; error?: string }) => void,
  ) => {
    if (isJobStatusMessage(message)) {
      void handleJob(message.job)
      return false
    }
    if (isPhaseTwoCommand(message)) {
      void runPhaseTwo(message.count)
        .then((detail) => sendResponse({ ok: true, detail }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: errorMessage(error) }),
        )
      return true
    }
    return false
  },
)

async function refreshJob(showTerminalToast = false): Promise<void> {
  try {
    const response = await sendRequest({ type: 'GET_JOB' })
    if (response.ok && response.job) {
      displayJob(response.job, showTerminalToast)
      if (response.job.status === 'ready') await attachReadyJob(response.job)
    }
  } catch {
    // The quick button remains available even when no old job can be restored.
  }
}

void refreshJob()
warmChatGPTUploadTargets()
void warmPicker()
