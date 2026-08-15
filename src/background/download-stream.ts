import {
  CHATGPT_IMAGE_LIMIT_BYTES,
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_CONCURRENCY,
} from '../shared/constants'
import { errorMessage, UserFacingError } from '../shared/errors'
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
  return baseUrl + '=d'
}

export function responseMimeType(response: Response, fallback: string): string {
  const pickerMimeType = fallback.split(';', 1)[0]?.trim().toLowerCase()
  if (pickerMimeType?.startsWith('image/')) return pickerMimeType

  const responseMimeType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  return responseMimeType?.startsWith('image/')
    ? responseMimeType
    : 'application/octet-stream'
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

async function readResponseBytes(
  response: Response,
  signal: AbortSignal,
): Promise<{ chunks: Uint8Array<ArrayBuffer>[]; total: number }> {
  if (!response.body) {
    throw new UserFacingError('Google media download returned no byte stream.')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  while (true) {
    signal.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > CHATGPT_IMAGE_LIMIT_BYTES) {
      await reader.cancel()
      throw new UserFacingError(
        "File exceeded ChatGPT's documented 20 MB image limit while downloading.",
      )
    }
    chunks.push(new Uint8Array(value))
  }
  return { chunks, total }
}

async function downloadResponse(
  fetchMedia: AuthorizedFetch,
  item: PickedMediaItem,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetchMedia(downloadUrl(item), { signal })
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
  if (expectedSize > CHATGPT_IMAGE_LIMIT_BYTES) {
    await response.body?.cancel()
    throw new UserFacingError(
      'File is ' +
        (expectedSize / 1024 / 1024).toFixed(1) +
        " MB; ChatGPT's documented image limit is 20 MB.",
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
  const { chunks, total } = await readResponseBytes(response, signal)
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
    filename: mediaFile.filename || 'google-photo-' + (index + 1),
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
    filename: mediaFile.filename || 'google-photo-' + (index + 1),
    mimeType,
    lastModified: Date.parse(item.createTime) || Date.now(),
    expectedSize: Number(response.headers.get('content-length') || 0) || undefined,
  })

  if (!response.body) {
    throw new UserFacingError('Google media download returned no byte stream.')
  }
  const reader = response.body.getReader()
  let total = 0
  record(job, entries, performancePoints.imageBodyStart, details)
  while (true) {
    signal.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > CHATGPT_IMAGE_LIMIT_BYTES) {
      await reader.cancel()
      throw new UserFacingError(
        "File exceeded ChatGPT's documented 20 MB image limit while downloading.",
      )
    }
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
): Promise<{ downloaded: number; skipped: string[] }> {
  const mediaItems = job.mediaItems ?? []
  if (mediaItems.length === 0) {
    throw new UserFacingError('This Picker job has no selected image items.')
  }

  const controller = new AbortController()
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
        if (supportsBinary) {
          await sendOneBinary(
            port,
            job,
            item,
            index,
            controller.signal,
            fetchMedia,
          )
        } else {
          await sendOneBase64(
            port,
            job,
            item,
            index,
            controller.signal,
            fetchMedia,
          )
        }
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
  post(port, { type: 'ALL_DONE', downloaded, skipped })
  return { downloaded, skipped }
}
