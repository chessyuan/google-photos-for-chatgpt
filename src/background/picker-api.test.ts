import { describe, expect, it, vi } from 'vitest'
import {
  appendAutoclose,
  parseGoogleDuration,
  PickerApi,
} from './picker-api'
import type { AuthorizedFetch } from './picker-api'

describe('Picker API helpers', () => {
  it('appends autoclose without losing query parameters', () => {
    expect(
      appendAutoclose('https://photos.google.com/picker/session-1?authuser=0'),
    ).toBe(
      'https://photos.google.com/picker/session-1/autoclose?authuser=0',
    )
    expect(
      appendAutoclose(
        'https://photos.google.com/picker/session-1/autoclose/?authuser=0',
      ),
    ).toBe(
      'https://photos.google.com/picker/session-1/autoclose?authuser=0',
    )
  })

  it('parses protobuf durations', () => {
    expect(parseGoogleDuration('3.5s')).toBe(3500)
    expect(parseGoogleDuration(undefined)).toBe(0)
    expect(() => parseGoogleDuration('3500ms')).toThrow(
      'Invalid Google polling duration',
    )
  })

  it('uses pickingConfig and paginates media items', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'session-1',
            pickerUri: 'https://photos.google.com/picker/session-1',
            expireTime: '2030-01-01T00:00:00Z',
            mediaItemsSet: false,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mediaItems: [{ id: 'one', type: 'PHOTO' }],
            nextPageToken: 'next',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mediaItems: [{ id: 'two', type: 'PHOTO' }],
          }),
          { status: 200 },
        ),
      )

    const api = new PickerApi(request)
    await api.createSession(15)
    const createInit = request.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(createInit.body))).toEqual({
      pickingConfig: { maxItemCount: '15' },
    })

    const items = await api.listAllMediaItems('session-1')
    expect(items.map((item) => item.id)).toEqual(['one', 'two'])
    expect(String(request.mock.calls[2]?.[0])).toContain('pageToken=next')
  })

  it('aborts and reports a product error when the Picker API hangs', async () => {
    vi.useFakeTimers()
    const request: AuthorizedFetch = vi.fn(
      () => new Promise<Response>(() => undefined),
    )
    const api = new PickerApi(request, 100)

    const creating = api.createSession(50)
    const rejected = expect(creating).rejects.toThrow('did not respond in time')
    await vi.advanceTimersByTimeAsync(100)

    await rejected
    const init = vi.mocked(request).mock.calls[0]?.[1]
    expect(init?.signal?.aborted).toBe(true)
    vi.useRealTimers()
  })
})
