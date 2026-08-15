import { describe, expect, it } from 'vitest'

import type {
  DownloadPortMessage,
  PickerJob,
  PickedMediaItem,
} from '../shared/types'
import {
  downloadUrl,
  responseMimeType,
  streamJobToPort,
} from './download-stream'

function item(mimeType: string): PickedMediaItem {
  return {
    id: 'item',
    createTime: '2026-01-01T00:00:00Z',
    type: 'PHOTO',
    mediaFile: {
      baseUrl: 'https://lh3.googleusercontent.com/example',
      filename: 'photo',
      mimeType,
    },
  }
}

describe('downloadUrl', () => {
  it('requests original bytes for every supported image format', () => {
    for (const mimeType of [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ]) {
      expect(downloadUrl(item(mimeType))).toBe(
        'https://lh3.googleusercontent.com/example=d',
      )
    }
  })

  it('keeps Picker metadata MIME when a response header disagrees', () => {
    const response = new Response('bytes', {
      headers: { 'content-type': 'image/jpeg' },
    })
    expect(responseMimeType(response, 'image/png')).toBe('image/png')
    expect(responseMimeType(response, '')).toBe('image/jpeg')
  })
})

function testPort(): {
  port: chrome.runtime.Port
  messages: DownloadPortMessage[]
  disconnect: () => void
} {
  const messages: DownloadPortMessage[] = []
  const listeners: Array<() => void> = []
  return {
    port: {
      postMessage(message: DownloadPortMessage) {
        messages.push(message)
      },
      onDisconnect: {
        addListener(listener: () => void) {
          listeners.push(listener)
        },
      },
    } as unknown as chrome.runtime.Port,
    messages,
    disconnect: () => listeners.forEach((listener) => listener()),
  }
}

function job(items: PickedMediaItem[]): PickerJob {
  return {
    id: 'job-1',
    targetTabId: 1,
    targetKind: 'chatgpt',
    status: 'ready',
    message: 'ready',
    createdAt: 1,
    updatedAt: 1,
    maxItemCount: 50,
    mediaItems: items,
    warnings: [],
  }
}

describe('streamJobToPort', () => {
  it('keeps successful images when one download fails', async () => {
    const first = item('image/jpeg')
    first.id = 'first'
    first.mediaFile!.baseUrl += '/first'
    const failed = item('image/jpeg')
    failed.id = 'failed'
    failed.mediaFile!.baseUrl += '/failed'
    const third = item('image/jpeg')
    third.id = 'third'
    third.mediaFile!.baseUrl += '/third'
    const { port, messages } = testPort()

    const result = await streamJobToPort(
      port,
      job([first, failed, third]),
      true,
      undefined,
      async (url) =>
        url.includes('/failed')
          ? new Response('failed', { status: 500, statusText: 'Failed' })
          : new Response(new Uint8Array([1, 2, 3]), {
              status: 200,
              headers: { 'content-type': 'image/jpeg' },
            }),
    )

    expect(result.downloaded).toBe(2)
    expect(result.skipped).toHaveLength(1)
    expect(
      messages.filter((message) => message.type === 'FILE_BLOB').map(
        (message) => message.index,
      ),
    ).toEqual([0, 2])
    expect(messages.some((message) => message.type === 'FILE_ERROR')).toBe(true)
  })

  it('aborts in-flight downloads when the message port disconnects', async () => {
    const { port, disconnect } = testPort()
    const operation = streamJobToPort(
      port,
      job([item('image/jpeg')]),
      true,
      undefined,
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    disconnect()
    await expect(operation).rejects.toThrow('Aborted')
  })
})
