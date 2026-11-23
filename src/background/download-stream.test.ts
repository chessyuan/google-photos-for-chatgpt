import { afterEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => vi.unstubAllGlobals())

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
  it('requests video bytes rather than a JPEG thumbnail', () => {
    const video = item('video/mp4')
    video.type = 'VIDEO'
    expect(downloadUrl(video)).toBe('https://lh3.googleusercontent.com/example=dv')
  })
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
  it.each([false, true])('distinguishes video network failures when CDN permission is %s', async (allowed) => {
    const video = item('video/mp4')
    video.type = 'VIDEO'
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(allowed) } })
    const { port } = testPort()
    const result = await streamJobToPort(port, job([video]), false, undefined, async () => { throw new TypeError('Failed to fetch') })
    expect(result.downloaded).toBe(0)
    expect(result.skipped[0]).toContain(allowed ? 'VIDEO_NETWORK_ERROR' : 'VIDEO_PERMISSION_MISSING')
  })
  it('streams a video with the MIME and filename of Google’s transcoded response', async () => {
    const video = item('video/quicktime')
    video.type = 'VIDEO'
    video.mediaFile!.filename = 'clip.MOV'
    const { port, messages } = testPort()
    const fetchMedia = vi.fn(async (_url: string) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }))
    await expect(streamJobToPort(port, job([video]), false, undefined, fetchMedia)).resolves.toMatchObject({ downloaded: 1 })
    expect(fetchMedia.mock.calls[0]?.[0]).toContain('=dv')
    expect(messages.find((message) => message.type === 'FILE_START')).toMatchObject({ filename: 'clip.mp4', mimeType: 'video/mp4' })
  })

  it('accepts videos over the image limit but skips videos over the local video limit', async () => {
    const video = item('video/mp4')
    video.type = 'VIDEO'
    const { port } = testPort()
    await expect(streamJobToPort(port, job([video]), false, undefined, async () => new Response(
      new Uint8Array([1]), { headers: { 'content-length': String(25 * 1024 * 1024), 'content-type': 'video/mp4' } },
    ))).resolves.toMatchObject({ downloaded: 1 })
    await expect(streamJobToPort(port, job([video]), false, undefined, async () => new Response(
      new Uint8Array([1]), { headers: { 'content-length': String(101 * 1024 * 1024), 'content-type': 'video/mp4' } },
    ))).resolves.toMatchObject({ downloaded: 0, skipped: [expect.stringContaining('100 MB')] })
  })

  it('does not pass a video thumbnail off as the video file', async () => {
    const video = item('video/mp4')
    video.type = 'VIDEO'
    await expect(streamJobToPort(testPort().port, job([video]), false, undefined,
      async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }),
    )).resolves.toMatchObject({ downloaded: 0, skipped: [expect.stringContaining('thumbnail')] })
  })
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
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects an already cancelled transfer before starting network requests', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMedia = vi.fn()
    await expect(streamJobToPort(testPort().port, job([item('image/png')]), false, controller.signal, fetchMedia)).rejects.toThrow()
    expect(fetchMedia).not.toHaveBeenCalled()
  })

  it('times out a stalled body and still delivers the other photos', async () => {
    vi.useFakeTimers()
    try {
      const { port, messages } = testPort()
      const cancel = vi.fn()
      let calls = 0
      const operation = streamJobToPort(port, job([item('image/png'), item('image/png')]), false, undefined,
        async () => ++calls === 1
          ? new Response(new ReadableStream({ start() {}, cancel }))
          : new Response(new Uint8Array([1, 2, 3])),
      )
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(operation).resolves.toMatchObject({ downloaded: 1, skipped: [expect.stringContaining('timed out')] })
      expect(cancel).toHaveBeenCalledOnce()
      expect(messages.filter((message) => message.type === 'FILE_END').map((message) => message.index)).toEqual([1])
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips empty photo responses', async () => {
    const { port } = testPort()
    await expect(streamJobToPort(port, job([item('image/png')]), false, undefined,
      async () => new Response(new Uint8Array()),
    )).resolves.toMatchObject({ downloaded: 0, skipped: [expect.stringContaining('empty photo')] })
  })

  it('does not release files if persisting the handoff fails', async () => {
    const { port, messages } = testPort()
    await expect(streamJobToPort(port, job([item('image/png')]), false, undefined,
      async () => new Response(new Uint8Array([1])),
      async () => { throw new Error('storage unavailable') },
    )).rejects.toThrow('storage unavailable')
    expect(messages.some((message) => message.type === 'ALL_DONE')).toBe(false)
  })
})
