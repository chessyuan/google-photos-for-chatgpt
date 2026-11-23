import { errorMessage } from './errors'
import { mediaByteLimit, TRANSFER_LIMIT_BYTES } from './media'
import {
  epochPerformanceNow,
  performanceDebugEnabled,
  performancePoints,
  type PerformanceEntry,
} from './performance'
import type { DownloadPortMessage } from './types'

interface PendingFile {
  filename: string
  mimeType: string
  lastModified: number
  chunks: Uint8Array<ArrayBuffer>[]
  size: number
}

export interface DownloadResult {
  files: File[]
  skipped: string[]
  performanceEntries?: PerformanceEntry[]
}

export function supportsBinaryMessaging(
  _userAgent = navigator.userAgent,
): boolean {
  // Keep the Blob implementation available for controlled testing, but use
  // the proven JSON/base64 chunk protocol in production. The structured-clone
  // path regressed real ChatGPT uploads even though synthetic Files passed.
  return false
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function downloadJobFiles(
  jobId: string,
  onProgress?: (message: string) => void,
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'gpfc-download:' + jobId })
    const pending = new Map<number, PendingFile>()
    const completed = new Map<number, File>()
    const performanceEntries: PerformanceEntry[] = []
    let settled = false
    let receivedBytes = 0
    let idleTimer: ReturnType<typeof setTimeout>
    const resetDeadline = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        finish(() => reject(new Error('The photo download stopped responding. Please try again.')))
      }, 90_000)
    }

    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      pending.clear()
      completed.clear()
      operation()
      port.disconnect()
    }

    port.onDisconnect.addListener(() => {
      if (!settled) {
        finish(() =>
          reject(
            new Error(
              chrome.runtime.lastError?.message ||
                'The background download connection closed.',
            ),
          ),
        )
      }
    })

    port.onMessage.addListener((rawMessage: DownloadPortMessage) => {
      if (settled) return
      resetDeadline()
      const message = rawMessage
      try {
        if (message.type === 'FILE_START') {
          pending.set(message.index, {
            filename: message.filename,
            mimeType: message.mimeType,
            lastModified: message.lastModified,
            chunks: [],
            size: 0,
          })
          onProgress?.('Downloading ' + message.filename + '…')
        } else if (message.type === 'FILE_CHUNK') {
          const file = pending.get(message.index)
          if (!file) throw new Error('Received bytes before file metadata.')
          const bytes = base64ToBytes(message.base64)
          file.size += bytes.byteLength
          receivedBytes += bytes.byteLength
          if (file.size > mediaByteLimit(file.mimeType)) throw new Error('Downloaded media exceeds the size limit.')
          if (receivedBytes > TRANSFER_LIMIT_BYTES) throw new Error('This selection exceeds the extension’s 200 MB memory budget.')
          file.chunks.push(bytes)
        } else if (message.type === 'FILE_END') {
          const file = pending.get(message.index)
          if (!file) throw new Error('Received a file end before file metadata.')
          if (file.size !== message.size || file.size === 0) {
            throw new Error('The downloaded photo is incomplete. Please try again.')
          }
          const receivedAt = epochPerformanceNow()
          if (performanceDebugEnabled) {
            performanceEntries.push({
              point: performancePoints.contentReceivedFile,
              at: receivedAt,
              itemIndex: message.index,
              bytes: message.size,
            })
          }
          completed.set(
            message.index,
            new File(file.chunks, file.filename, {
              type: file.mimeType,
              lastModified: file.lastModified,
            }),
          )
          if (performanceDebugEnabled) {
            performanceEntries.push({
              point: performancePoints.fileReady,
              at: epochPerformanceNow(),
              itemIndex: message.index,
              bytes: message.size,
              mimeType: file.mimeType,
              note: 'legacy base64 compatibility path',
            })
          }
          pending.delete(message.index)
          onProgress?.('Ready: ' + file.filename)
        } else if (message.type === 'FILE_BLOB') {
          if (!(message.blob instanceof Blob) || message.blob.size !== message.size || message.size === 0 || message.size > mediaByteLimit(message.mimeType)) {
            throw new Error('The downloaded photo is incomplete. Please try again.')
          }
          receivedBytes += message.size
          if (receivedBytes > TRANSFER_LIMIT_BYTES) throw new Error('This selection exceeds the extension’s 200 MB memory budget.')
          if (performanceDebugEnabled) {
            performanceEntries.push({
              point: performancePoints.contentReceivedFile,
              at: epochPerformanceNow(),
              itemIndex: message.index,
              bytes: message.size,
              mimeType: message.mimeType,
            })
          }
          completed.set(
            message.index,
            new File([message.blob], message.filename, {
              type: message.mimeType,
              lastModified: message.lastModified,
            }),
          )
          if (performanceDebugEnabled) {
            performanceEntries.push({
              point: performancePoints.fileReady,
              at: epochPerformanceNow(),
              itemIndex: message.index,
              bytes: message.size,
              mimeType: message.mimeType,
            })
          }
          onProgress?.('Ready: ' + message.filename)
        } else if (message.type === 'FILE_ERROR') {
          pending.delete(message.index)
          onProgress?.('Skipped ' + message.filename + ': ' + message.error)
        } else if (message.type === 'STREAM_ERROR') {
          finish(() => reject(new Error(message.error)))
        } else if (message.type === 'PERF_ENTRIES') {
          if (performanceDebugEnabled) {
            performanceEntries.push(...message.entries)
          }
        } else if (message.type === 'ALL_DONE') {
          if (pending.size > 0 || completed.size !== message.downloaded) {
            throw new Error('The photo download ended before all files arrived. Please try again.')
          }
          const files = [...completed.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, file]) => file)
          finish(() =>
            resolve({
              files,
              skipped: message.skipped,
              performanceEntries:
                performanceEntries.length > 0
                  ? performanceEntries
                  : undefined,
            }),
          )
        }
      } catch (error) {
        finish(() => reject(new Error(errorMessage(error))))
      }
    })

    const start: DownloadPortMessage = {
      type: 'START_DOWNLOAD',
      supportsBinary: supportsBinaryMessaging(),
    }
    resetDeadline()
    try {
      port.postMessage(start)
    } catch (error) {
      finish(() => reject(new Error(errorMessage(error))))
    }
  })
}
