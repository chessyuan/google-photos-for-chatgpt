import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DownloadPortMessage } from './types'
import {
  downloadJobFiles,
  supportsBinaryMessaging,
} from './download-client'

afterEach(() => vi.unstubAllGlobals())

describe('supportsBinaryMessaging', () => {
  it('keeps compatibility messaging enabled on current Chrome and Edge', () => {
    expect(
      supportsBinaryMessaging(
        'Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36',
      ),
    ).toBe(false)
    expect(
      supportsBinaryMessaging(
        'Mozilla/5.0 Chrome/147.0.0.0 Safari/537.36',
      ),
    ).toBe(false)
  })

  it('recognizes Edge through its Chromium version', () => {
    expect(
      supportsBinaryMessaging(
        'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
      ),
    ).toBe(false)
  })
})

describe('downloadJobFiles binary path', () => {
  it('constructs Files once and restores Picker order', async () => {
    const messageListeners: Array<(message: DownloadPortMessage) => void> = []
    const disconnectListeners: Array<() => void> = []
    const port = {
      onMessage: {
        addListener(listener: (message: DownloadPortMessage) => void) {
          messageListeners.push(listener)
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListeners.push(listener)
        },
      },
      postMessage(message: DownloadPortMessage) {
        if (message.type !== 'START_DOWNLOAD') return
        queueMicrotask(() => {
          for (const next of [
            {
              type: 'FILE_BLOB',
              index: 1,
              filename: 'two.png',
              mimeType: 'image/png',
              lastModified: 2,
              blob: new Blob(['two'], { type: 'image/png' }),
              size: 3,
            },
            {
              type: 'FILE_BLOB',
              index: 0,
              filename: 'one.png',
              mimeType: 'image/png',
              lastModified: 1,
              blob: new Blob(['one'], { type: 'image/png' }),
              size: 3,
            },
            { type: 'ALL_DONE', downloaded: 2, skipped: [] },
          ] satisfies DownloadPortMessage[]) {
            for (const listener of messageListeners) listener(next)
          }
        })
      },
      disconnect() {
        for (const listener of disconnectListeners) listener()
      },
    }
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        connect: () => port,
      },
    })

    const result = await downloadJobFiles('job-1')
    expect(result.files.map((file) => file.name)).toEqual([
      'one.png',
      'two.png',
    ])
    expect(result.files.map((file) => file.type)).toEqual([
      'image/png',
      'image/png',
    ])
  })
})

describe('downloadJobFiles compatibility path', () => {
  it('reconstructs original PNG bytes and metadata exactly', async () => {
    const messageListeners: Array<(message: DownloadPortMessage) => void> = []
    const disconnectListeners: Array<() => void> = []
    const original = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
    ])
    const base64 = btoa(String.fromCharCode(...original))
    let requestedBinary = true
    const port = {
      onMessage: {
        addListener(listener: (message: DownloadPortMessage) => void) {
          messageListeners.push(listener)
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListeners.push(listener)
        },
      },
      postMessage(message: DownloadPortMessage) {
        if (message.type !== 'START_DOWNLOAD') return
        requestedBinary = Boolean(message.supportsBinary)
        queueMicrotask(() => {
          const messages: DownloadPortMessage[] = [
            {
              type: 'FILE_START',
              index: 0,
              filename: 'screenshot.png',
              mimeType: 'image/png',
              lastModified: 123,
              expectedSize: original.byteLength,
            },
            { type: 'FILE_CHUNK', index: 0, base64 },
            { type: 'FILE_END', index: 0, size: original.byteLength },
            { type: 'ALL_DONE', downloaded: 1, skipped: [] },
          ]
          for (const next of messages) {
            for (const listener of messageListeners) listener(next)
          }
        })
      },
      disconnect() {
        for (const listener of disconnectListeners) listener()
      },
    }
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        connect: () => port,
      },
    })

    const result = await downloadJobFiles('job-compatible')

    expect(requestedBinary).toBe(false)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.name).toBe('screenshot.png')
    expect(result.files[0]?.type).toBe('image/png')
    expect(new Uint8Array(await result.files[0]!.arrayBuffer())).toEqual(original)
  })
})
