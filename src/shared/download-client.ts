import { errorMessage } from './errors'
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

    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
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
      const message = rawMessage
      try {
        if (message.type === 'FILE_START') {
          pending.set(message.index, {
            filename: message.filename,
            mimeType: message.mimeType,
            lastModified: message.lastModified,
            chunks: [],
          })
          onProgress?.('Downloading ' + message.filename + '…')
        } else if (message.type === 'FILE_CHUNK') {
          const file = pending.get(message.index)
          if (!file) throw new Error('Received bytes before file metadata.')
          file.chunks.push(base64ToBytes(message.base64))
        } else if (message.type === 'FILE_END') {
          const file = pending.get(message.index)
          if (!file) throw new Error('Received a file end before file metadata.')
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
    port.postMessage(start)
  })
}
