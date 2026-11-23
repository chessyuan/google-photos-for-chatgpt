import {
  JOB_RETENTION_MS,
  JOB_STORAGE_KEY,
} from '../shared/constants'
import type { PickerJob, PublicJob } from '../shared/types'

const jobs = new Map<string, PickerJob>()
let loaded: Promise<void> | undefined
let persistQueue: Promise<void> = Promise.resolve()

function cloneJob(job: PickerJob): PickerJob {
  return structuredClone(job)
}

export function publicJob(job: PickerJob): PublicJob {
  return {
    id: job.id,
    targetTabId: job.targetTabId,
    targetKind: job.targetKind,
    status: job.status,
    message: job.message,
    selectedCount: job.mediaItems?.length ?? 0,
    warnings: [...job.warnings],
    error: job.error,
    updatedAt: job.updatedAt,
    attachment: job.attachment,
    performanceTrace: job.performanceTrace
      ? structuredClone(job.performanceTrace)
      : undefined,
  }
}

export async function loadJobs(): Promise<void> {
  loaded ??= (async () => {
    const stored = await chrome.storage.session.get(JOB_STORAGE_KEY)
    const records = stored[JOB_STORAGE_KEY] as
      | Record<string, PickerJob>
      | undefined
    const cutoff = Date.now() - JOB_RETENTION_MS

    for (const job of Object.values(records ?? {})) {
      if (job.updatedAt >= cutoff) jobs.set(job.id, job)
    }
  })().catch((error: unknown) => {
    loaded = undefined
    throw error
  })
  await loaded
}

export async function persistJobs(): Promise<void> {
  const snapshot = Object.fromEntries(
    [...jobs.entries()].map(([id, job]) => [id, cloneJob(job)]),
  )
  persistQueue = persistQueue.catch(() => undefined).then(async () => {
    await chrome.storage.session.set({ [JOB_STORAGE_KEY]: snapshot })
  })
  await persistQueue
}

export async function putJob(job: PickerJob): Promise<void> {
  await loadJobs()
  const cutoff = Date.now() - JOB_RETENTION_MS
  for (const [id, existing] of jobs) {
    if (
      existing.updatedAt < cutoff &&
      ['complete', 'cancelled', 'error'].includes(existing.status)
    ) jobs.delete(id)
  }
  job.updatedAt = Date.now()
  jobs.set(job.id, job)
  await persistJobs()
}

export async function getJob(jobId: string): Promise<PickerJob | undefined> {
  await loadJobs()
  return jobs.get(jobId)
}

export async function getLatestJobForTab(
  targetTabId: number,
): Promise<PickerJob | undefined> {
  await loadJobs()
  return [...jobs.values()]
    .filter((job) => job.targetTabId === targetTabId)
    // Earlier jobs may finish after a newer Picker is already open. Their
    // background updates must not make them the current Picker again.
    .reverse()
    .sort((left, right) => right.createdAt - left.createdAt)[0]
}

export async function getAllJobs(): Promise<PickerJob[]> {
  await loadJobs()
  return [...jobs.values()]
}

export async function deleteJob(jobId: string): Promise<void> {
  await loadJobs()
  jobs.delete(jobId)
  await persistJobs()
}
