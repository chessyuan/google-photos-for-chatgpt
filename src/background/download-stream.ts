import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_CONCURRENCY,
} from '../shared/constants'
import { errorMessage, UserFacingError } from '../shared/errors'
import { message } from '../shared/i18n'
import {
  epochPerformanceNow,
  markPerformance,
  performanceDebugEnabled,
  performancePoints,
  type PerformanceEntry,
  type PerformancePoint,
} from '../shared/performance'
import type {
  DownloadPortMessage,
  PickerJob,
  PickedMediaItem,
} from '../shared/types'
import { mapConcurrentOrdered } from './download-queue'
import { withRequestDeadline } from './request-deadline'
import { isVideo, mediaByteLimit, mediaFilename, TRANSFER_LIMIT_BYTES, VIDEO_LIMIT_BYTES } from '../shared/media'
import {
  createAuthorizedFetchSession,
  type AuthorizedFetch,
} from './google-auth'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const block = 0x8000
  for (let index = 0; index < bytes.length; index += block) {
    binary += String.fromCharCode(...bytes.subarray(index, index + block))
  }
  return btoa(binary)
}

function post(port: chrome.runtime.Port, message: DownloadPortMessage): void {
  port.postMessage(message)
}

export function downloadUrl(item: PickedMediaItem): string {
  const mediaFile = item.mediaFile
  const baseUrl = mediaFile?.baseUrl?.trim()
  if (!baseUrl) throw new UserFacingError('Selected item has no media base URL.')

  // Picker media metadata describes the original file. Requesting a resized
  // rendition can change the encoded bytes while retaining the original
  // filename, which ChatGPT may reject as a filename/MIME mismatch.
  return baseUrl + (isVideo(item) ? '=dv' : '=d')
}

export function responseMimeType(response: Response, fallback: string): string {
  const pickerMimeType = fallback.split(';', 1)[0]?.trim().toLowerCase()
  if (pickerMimeType?.startsWith('image/')) return pickerMimeType

  const responseMimeType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  return responseMimeType?.startsWith('image/') || responseMimeType?.startsWith('video/')
    ? responseMimeType
    : pickerMimeType?.startsWith('video/') ? pickerMimeType : 'application/octet-stream'
}

function record(
  job: PickerJob,
  entries: PerformanceEntry[],
  point: PerformancePoint,
  details?: Omit<PerformanceEntry, 'point' | 'at'>,
): void {
  const at = epochPerformanceNow()
  markPerformance(job.performanceTrace, point, details, at)
  if (performanceDebugEnabled) entries.push({ point, at, ...details })
}

async function* responseChunks(
  response: Response,
  signal: AbortSignal,
  limit: number,
  budget: { bytes: number },
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    throw new UserFacingError('Google media download returned no byte stream.')
  }

  const reader = response.body.getReader()
  let total = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        throw new UserFacingError(
          'File exceeded the ' + String(limit / 1024 / 1024) + ' MB download limit.',
        )
      }
      budget.bytes += value.byteLength
      if (budget.bytes > TRANSFER_LIMIT_BYTES) {
        throw new UserFacingError('This selection exceeds the extension’s 200 MB memory budget. Select fewer files.')
      }
      yield new Uint8Array(value)
    }
    if (total === 0) throw new UserFacingError('Google returned an empty photo. Please try again.')
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

async function downloadResponse(
  fetchMedia: AuthorizedFetch,
  item: PickedMediaItem,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response
  try {
    response = await fetchMedia(downloadUrl(item), { signal })
  } catch (error) {
    if (signal.aborted || !isVideo(item) || !(error instanceof TypeError)) throw error
    let hasVideoPermission: boolean | undefined
    try {
      if (typeof chrome !== 'undefined' && chrome.permissions?.contains) {
        hasVideoPermission = await chrome.permissions.contains({ origins: ['https://*.googlevideo.com/*'] })
      }
    } catch {
      // A failed diagnostic must not hide the original download failure.
    }
    throw new UserFacingError(message(
      hasVideoPermission === false ? 'videoDownloadPermissionMissing' : 'videoDownloadNetworkFailed',
    ), { cause: error })
  }
  if (!response.ok) {
    throw new UserFacingError(
      'Google media download failed (' +
        response.status +
        ' ' +
        response.statusText +
        ').',
    )
  }
  const expectedSize = Number(response.headers.get('content-length') || 0)
  const limit = isVideo(item) ? VIDEO_LIMIT_BYTES : mediaByteLimit(item.mediaFile?.mimeType ?? '')
  if (isVideo(item) && response.headers.get('content-type')?.startsWith('image/')) {
    await response.body?.cancel()
    throw new UserFacingError('Google returned a video thumbnail instead of video bytes. Try again after video processing finishes.')
  }
  if (expectedSize > limit) {
    await response.body?.cancel()
    throw new UserFacingError(
      'File is ' +
        (expectedSize / 1024 / 1024).toFixed(1) +
        ' MB; the extension limit for this file is ' + String(limit / 1024 / 1024) + ' MB.',
    )
  }
  return response
}

async function sendOneBinary(
  port: chrome.runtime.Port,
  job: PickerJob,
  item: PickedMediaItem,
  index: number,
  signal: AbortSignal,
  fetchMedia: AuthorizedFetch,
  budget: { bytes: number },
): Promise<number> {
  const mediaFile = item.mediaFile
  if (!mediaFile) throw new UserFacingError('Selected item has no media file.')
  const entries: PerformanceEntry[] = []
  const details = { itemIndex: index }

  record(job, entries, performancePoints.imageFetchStart, details)
  const response = await downloadResponse(fetchMedia, item, signal)
  const mimeType = responseMimeType(response, mediaFile.mimeType)
  record(job, entries, performancePoints.imageHeaders, {
    ...details,
    mimeType,
  })
  record(job, entries, performancePoints.imageBodyStart, details)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  for await (const chunk of responseChunks(response, signal, mediaByteLimit(mimeType), budget)) {
    chunks.push(chunk)
    total += chunk.byteLength
  }
  const blob = new Blob(chunks, { type: mimeType })
  record(job, entries, performancePoints.imageBlobReady, {
    ...details,
    bytes: total,
    mimeType,
  })
  record(job, entries, performancePoints.messageSendStart, details)
  post(port, {
    type: 'FILE_BLOB',
    index,
    filename: mediaFilename(mediaFile.filename || 'google-media-' + (index + 1), mimeType),
    mimeType,
    lastModified: Date.parse(item.createTime) || Date.now(),
    blob,
    size: total,
  })
  if (entries.length > 0) post(port, { type: 'PERF_ENTRIES', entries })
  return total
}

async function sendOneBase64(
  port: chrome.runtime.Port,
  job: PickerJob,
  item: PickedMediaItem,
  index: number,
  signal: AbortSignal,
  fetchMedia: AuthorizedFetch,
  budget: { bytes: number },
): Promise<number> {
  const mediaFile = item.mediaFile
  if (!mediaFile) throw new UserFacingError('Selected item has no media file.')
  const entries: PerformanceEntry[] = []
  const details = { itemIndex: index }

  record(job, entries, performancePoints.imageFetchStart, details)
  const response = await downloadResponse(fetchMedia, item, signal)
  const mimeType = responseMimeType(response, mediaFile.mimeType)
  record(job, entries, performancePoints.imageHeaders, {
    ...details,
    mimeType,
  })
  record(job, entries, performancePoints.messageSendStart, details)
  post(port, {
    type: 'FILE_START',
    index,
    filename: mediaFilename(mediaFile.filename || 'google-media-' + (index + 1), mimeType),
    mimeType,
    lastModified: Date.parse(item.createTime) || Date.now(),
    expectedSize: Number(response.headers.get('content-length') || 0) || undefined,
  })

  let total = 0
  record(job, entries, performancePoints.imageBodyStart, details)
  for await (const value of responseChunks(response, signal, mediaByteLimit(mimeType), budget)) {
    total += value.byteLength
    for (
      let offset = 0;
      offset < value.byteLength;
      offset += DOWNLOAD_CHUNK_BYTES
    ) {
      const chunk = value.subarray(offset, offset + DOWNLOAD_CHUNK_BYTES)
      post(port, { type: 'FILE_CHUNK', index, base64: bytesToBase64(chunk) })
    }
  }

  record(job, entries, performancePoints.imageBlobReady, {
    ...details,
    bytes: total,
    mimeType,
    note: 'legacy base64 compatibility path',
  })
  post(port, { type: 'FILE_END', index, size: total })
  if (entries.length > 0) post(port, { type: 'PERF_ENTRIES', entries })
  return total
}

export async function streamJobToPort(
  port: chrome.runtime.Port,
  job: PickerJob,
  supportsBinary = false,
  externalSignal?: AbortSignal,
  fetchMediaOverride?: AuthorizedFetch,
  beforeComplete?: (result: { downloaded: number; skipped: string[] }) => Promise<void>,
): Promise<{ downloaded: number; skipped: string[] }> {
  const mediaItems = job.mediaItems ?? []
  if (mediaItems.length === 0) {
    throw new UserFacingError('This Picker job has no selected media items.')
  }

  const controller = new AbortController()
  const budget = { bytes: 0 }
  externalSignal?.throwIfAborted()
  port.onDisconnect.addListener(() => controller.abort())
  externalSignal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  })
  const fetchMedia =
    fetchMediaOverride ?? (await createAuthorizedFetchSession())

  const outcomes = await mapConcurrentOrdered(
    mediaItems,
    DOWNLOAD_CONCURRENCY,
    async (item, index) => {
      const filename = item.mediaFile?.filename || 'item-' + (index + 1)
      try {
        await withRequestDeadline(
          (signal) => supportsBinary
            ? sendOneBinary(port, job, item, index, signal, fetchMedia, budget)
            : sendOneBase64(port, job, item, index, signal, fetchMedia, budget),
          60_000,
          new UserFacingError('Photo download timed out. Please try again.'),
          controller.signal,
        )
        return { downloaded: true as const }
      } catch (error) {
        if (controller.signal.aborted) throw error
        const detail = filename + ': ' + errorMessage(error)
        post(port, {
          type: 'FILE_ERROR',
          index,
          filename,
          error: errorMessage(error),
        })
        return { downloaded: false as const, detail }
      }
    },
  )

  const downloaded = outcomes.filter((outcome) => outcome.downloaded).length
  const skipped = outcomes.flatMap((outcome) =>
    outcome.downloaded ? [] : [outcome.detail],
  )
  controller.signal.throwIfAborted()
  await beforeComplete?.({ downloaded, skipped })
  post(port, { type: 'ALL_DONE', downloaded, skipped })
  return { downloaded, skipped }
}
