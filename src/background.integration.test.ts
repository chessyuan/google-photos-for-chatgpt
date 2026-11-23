import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadPortMessage, PickerJob, PickedMediaItem, RuntimeRequest, RuntimeResponse, StandbyPickerSession } from './shared/types'
import { JOB_STORAGE_KEY, STANDBY_SESSION_STORAGE_KEY } from './shared/constants'
import type * as PickerApiModule from './background/picker-api'

const api = vi.hoisted(() => ({
  getSession: vi.fn(), listAllMediaItems: vi.fn(), deleteSession: vi.fn(), createSession: vi.fn(),
}))
const auth = vi.hoisted(() => ({ prepareGoogleAuthorization: vi.fn() }))
vi.mock('./background/picker-api', async (original) => ({
  ...await original<typeof PickerApiModule>(),
  PickerApi: class {
    getSession = api.getSession
    listAllMediaItems = api.listAllMediaItems
    deleteSession = api.deleteSession
    createSession = api.createSession
  },
}))
vi.mock('./background/google-auth', () => ({
  authorizedFetch: vi.fn(),
  connectGooglePhotos: vi.fn(), disconnectGooglePhotos: vi.fn(),
  createAuthorizedFetchSession: vi.fn(async () => async () => new Response(new Uint8Array([1, 2, 3]))),
  getAccessToken: vi.fn(async () => { throw new Error('not connected') }),
  getAccessTokenForUserAction: vi.fn(async () => 'test-token'),
  getGoogleAuthState: vi.fn(), getManifestClientId: vi.fn(), isOAuthConfigured: vi.fn(),
  prepareGoogleAuthorization: auth.prepareGoogleAuthorization,
}))

function event<T>() {
  const listeners: T[] = []
  return { listeners, addListener: (listener: T) => listeners.push(listener), removeListener: vi.fn() }
}

function job(status: PickerJob['status'] = 'picking'): PickerJob {
  return {
    id: 'job', targetTabId: 1, targetKind: 'chatgpt', status,
    sessionState: status === 'picking' ? 'WAITING_SELECTION' : 'METADATA_READY',
    sessionId: 'session', pickerWindowId: 2, pickerTabId: 2,
    message: '', createdAt: Date.now(), updatedAt: Date.now(), maxItemCount: 50,
    expireTime: new Date(Date.now() + 3600_000).toISOString(),
    pollingConfig: { pollInterval: '0.01s', timeoutIn: '600s' }, warnings: [],
    mediaItems: [{ id: 'photo', createTime: '', type: 'PHOTO', mediaFile: {
      baseUrl: 'https://lh3.googleusercontent.com/test', mimeType: 'image/png', filename: 'photo.png',
    } }],
  }
}

async function flush() {
  for (let index = 0; index < 60; index += 1) await Promise.resolve()
}

describe('background lifecycle integration', () => {
  let runtimeMessage: ReturnType<typeof event<(request: unknown, sender: chrome.runtime.MessageSender, reply: (response: RuntimeResponse) => void) => boolean>>
  let connect: ReturnType<typeof event<(port: chrome.runtime.Port) => void>>
  let windowRemoved: ReturnType<typeof event<(windowId: number) => void>>
  let sendMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    api.deleteSession.mockResolvedValue(undefined)
    auth.prepareGoogleAuthorization.mockResolvedValue(undefined)
    api.listAllMediaItems.mockResolvedValue(job().mediaItems)
    api.getSession.mockResolvedValue({ mediaItemsSet: false, expireTime: job().expireTime, pollingConfig: job().pollingConfig })
  })
  afterEach(async () => {
    const store = await import('./background/job-store')
    for (const record of await store.getAllJobs()) {
      if (!['complete', 'cancelled', 'error'].includes(record.status)) {
        await request({ type: 'CANCEL_JOB', jobId: record.id })
      }
    }
    await vi.runOnlyPendingTimersAsync()
    await flush()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function start(record: PickerJob, standby?: StandbyPickerSession) {
    runtimeMessage = event()
    connect = event()
    windowRemoved = event()
    sendMessage = vi.fn().mockResolvedValue(undefined)
    const stored: Record<string, unknown> = {
      [JOB_STORAGE_KEY]: { [record.id]: structuredClone(record) },
      ...(standby ? { [STANDBY_SESSION_STORAGE_KEY]: standby } : {}),
    }
    vi.stubGlobal('chrome', {
      runtime: { onMessage: runtimeMessage, onConnect: connect, onInstalled: event(), onStartup: event(), sendMessage, getURL: () => 'chrome-extension://test/' },
      storage: { session: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) }),
        remove: vi.fn(async (key: string) => { delete stored[key] }),
      } },
      tabs: {
        get: vi.fn(async (id: number) => ({ id, url: 'https://chatgpt.com/', active: true, windowId: 1 })),
        sendMessage, update: vi.fn(), remove: vi.fn(), onRemoved: event(), onUpdated: event(),
      },
      windows: { get: vi.fn(async () => ({ focused: true })), remove: vi.fn(), update: vi.fn(), create: vi.fn(), onRemoved: windowRemoved, WINDOW_ID_NONE: -1 },
      alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: event() },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    })
    await import('./background')
    await flush()
    return import('./background/job-store')
  }

  function request(value: RuntimeRequest) {
    return new Promise<RuntimeResponse>((resolve) => {
      runtimeMessage.listeners[0]!(value, { tab: { id: 1 } as chrome.tabs.Tab, url: 'https://chatgpt.com/' }, resolve)
    })
  }

  it('does not revive a cancelled job when an in-flight poll completes', async () => {
    let finishPoll!: (value: unknown) => void
    api.getSession.mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve }))
    const store = await start(job())
    await vi.advanceTimersByTimeAsync(10)
    expect(api.getSession).toHaveBeenCalledOnce()
    await request({ type: 'CANCEL_JOB', jobId: 'job' })
    finishPoll({ mediaItemsSet: true })
    await flush()
    expect((await store.getJob('job'))?.status).toBe('cancelled')
    expect(api.listAllMediaItems).not.toHaveBeenCalled()
  })

  it('does not revive a cancelled job when metadata arrives late', async () => {
    let finishList!: (value: unknown) => void
    api.getSession.mockResolvedValueOnce({ mediaItemsSet: true })
    api.listAllMediaItems.mockImplementationOnce(() => new Promise((resolve) => { finishList = resolve }))
    const store = await start(job())
    await vi.advanceTimersByTimeAsync(10)
    expect(api.listAllMediaItems).toHaveBeenCalledOnce()
    await request({ type: 'CANCEL_JOB', jobId: 'job' })
    finishList(job().mediaItems)
    await flush()
    expect((await store.getJob('job'))?.status).toBe('cancelled')
    expect(sendMessage.mock.calls.some(([, value]) => value?.job?.status === 'ready')).toBe(false)
  })

  it('persists the handoff before ALL_DONE and retains the session until acknowledgement', async () => {
    const store = await start(job('ready'))
    const messages = event<(message: DownloadPortMessage) => void>()
    const disconnected = event<() => void>()
    const sent: DownloadPortMessage[] = []
    let handoffStatus: string | undefined
    const port = {
      name: 'gpfc-download:job', sender: { tab: { id: 1 } },
      onMessage: messages, onDisconnect: disconnected,
      postMessage: (message: DownloadPortMessage) => {
        sent.push(message)
        if (message.type === 'ALL_DONE') {
          void store.getJob('job').then((record) => { handoffStatus = record?.status })
          disconnected.listeners.forEach((listener) => listener())
        }
      },
    } as unknown as chrome.runtime.Port
    connect.listeners[0]!(port)
    messages.listeners[0]!({ type: 'START_DOWNLOAD' })
    await vi.advanceTimersByTimeAsync(0)
    await flush()
    expect(sent.at(-1)?.type).toBe('ALL_DONE')
    expect(handoffStatus).toBe('attaching')
    expect((await store.getJob('job'))?.sessionId).toBe('session')
    expect(api.deleteSession).not.toHaveBeenCalled()
    await request({ type: 'ATTACH_RESULT', jobId: 'job', result: {
      method: 'file-input', attempted: 1, verified: true, detail: 'attached',
    } })
    expect((await store.getJob('job'))?.status).toBe('complete')
    expect(api.deleteSession).toHaveBeenCalledWith('session')
  })

  it('requires checking attachments after a restart during handoff', async () => {
    const store = await start(job('attaching'))
    expect((await store.getJob('job'))?.status).toBe('error')
    expect((await store.getJob('job'))?.message).toContain('Check ChatGPT attachments')
  })

  it('resumes metadata retrieval from FETCHING_MEDIA after worker termination', async () => {
    const record = job('selected')
    record.sessionState = 'FETCHING_MEDIA'
    const store = await start(record)
    expect((await store.getJob('job'))?.status).toBe('ready')
    expect(api.listAllMediaItems).toHaveBeenCalledOnce()
  })

  it('retains ready videos and skips videos still processing in Google Photos', async () => {
    const record = job('selected')
    record.sessionState = 'FETCHING_MEDIA'
    const ready = { ...record.mediaItems![0]!, id: 'video', type: 'VIDEO' as const, mediaFile: {
      baseUrl: 'https://lh3.googleusercontent.com/clip', filename: 'clip.mp4', mimeType: 'video/mp4',
      mediaFileMetadata: { videoMetadata: { processingStatus: 'READY' as const } },
    } }
    const pending: PickedMediaItem = structuredClone(ready)
    pending.id = 'pending'
    pending.mediaFile!.mediaFileMetadata!.videoMetadata!.processingStatus = 'PROCESSING'
    api.listAllMediaItems.mockResolvedValueOnce([record.mediaItems![0], ready, pending])
    const store = await start(record)
    const result = await store.getJob('job')
    expect(result?.status).toBe('ready')
    expect(result?.mediaItems?.map((item) => item.id)).toEqual(['photo', 'video'])
    expect(result?.warnings).toContainEqual(expect.stringContaining('not ready'))
  })

  it('reopens immediately while the closed session is still checking for a completed selection', async () => {
    const previous = job()
    previous.createdAt -= 1000
    const standby: StandbyPickerSession = {
      sessionId: 'next-session', pickerUri: 'https://photos.google.com/picker/next/autoclose',
      expireTime: new Date(Date.now() + 60_000).toISOString(), createdAt: Date.now(),
      used: false, maxItemCount: 50, ready: false,
      pollingConfig: { pollInterval: '2s', timeoutIn: '60s' },
    }
    let finishOldPoll!: (value: unknown) => void
    api.getSession.mockImplementationOnce(() => new Promise((resolve) => { finishOldPoll = resolve }))
    const store = await start(previous, standby)
    vi.mocked(chrome.windows.create).mockResolvedValue({ id: 3, tabs: [{ id: 3, windowId: 3 }] } as unknown as void)
    vi.mocked(chrome.windows.get).mockResolvedValue({ focused: false } as unknown as void)
    windowRemoved.listeners[0]!(2)
    await flush()
    expect(api.getSession).toHaveBeenCalledOnce()

    const response = await request({ type: 'START_PICKER' })
    expect(response).toMatchObject({ ok: true, pickerOpened: true, pickerMode: 'standby' })
    expect(chrome.windows.create).toHaveBeenCalledOnce()
    expect(response.ok && response.jobId).not.toBe('job')
    expect((await store.getJob('job'))?.status).toBe('picking')

    finishOldPoll({ mediaItemsSet: true, expireTime: previous.expireTime, pollingConfig: previous.pollingConfig })
    await flush()
    expect((await store.getJob('job'))?.status).toBe('ready')
    expect(chrome.windows.update).not.toHaveBeenCalled()
    const restored = await request({ type: 'GET_JOB' })
    expect(restored).toMatchObject({
      ok: true,
      job: { id: response.ok ? response.jobId : '' },
      readyJobs: [expect.objectContaining({ id: 'job', status: 'ready' })],
    })
    const focused = await request({ type: 'START_PICKER' })
    expect(focused).toMatchObject({ ok: true, pickerReused: true, jobId: response.ok ? response.jobId : '' })
    expect(chrome.windows.create).toHaveBeenCalledOnce()
  })

  it('opens a new Picker if the old window vanished before its close event arrived', async () => {
    const standby: StandbyPickerSession = {
      sessionId: 'replacement', pickerUri: 'https://photos.google.com/picker/replacement/autoclose',
      expireTime: new Date(Date.now() + 60_000).toISOString(), createdAt: Date.now(),
      used: false, maxItemCount: 50, ready: false,
      pollingConfig: { pollInterval: '2s', timeoutIn: '60s' },
    }
    const store = await start(job(), standby)
    vi.mocked(chrome.windows.get).mockRejectedValueOnce(new Error('window no longer exists'))
    vi.mocked(chrome.windows.create).mockResolvedValue({ id: 3, tabs: [{ id: 3, windowId: 3 }] } as unknown as void)
    const response = await request({ type: 'START_PICKER' })
    expect(response).toMatchObject({ ok: true, pickerOpened: true, pickerMode: 'standby' })
    expect(chrome.windows.create).toHaveBeenCalledOnce()
    expect((await store.getJob('job'))?.pickerWindowClosedAt).toBeDefined()
  })

  it('does not restore focus to an old result if a new Picker opens while the tab lookup is pending', async () => {
    const previous = job()
    previous.createdAt -= 1000
    const standby: StandbyPickerSession = {
      sessionId: 'next-focus', pickerUri: 'https://photos.google.com/picker/next-focus/autoclose',
      expireTime: new Date(Date.now() + 60_000).toISOString(), createdAt: Date.now(),
      used: false, maxItemCount: 50, ready: false,
      pollingConfig: { pollInterval: '2s', timeoutIn: '60s' },
    }
    api.getSession.mockResolvedValueOnce({ mediaItemsSet: true, expireTime: previous.expireTime, pollingConfig: previous.pollingConfig })
    await start(previous, standby)
    let finishLookup!: (value: chrome.tabs.Tab) => void
    vi.mocked(chrome.tabs.get).mockImplementationOnce(() =>
      new Promise<chrome.tabs.Tab>((resolve) => { finishLookup = resolve }),
    )
    vi.mocked(chrome.windows.create).mockResolvedValue({ id: 3, tabs: [{ id: 3, windowId: 3 }] } as unknown as void)
    windowRemoved.listeners[0]!(2)
    await flush()
    expect(finishLookup).toBeTypeOf('function')
    const response = await request({ type: 'START_PICKER' })
    expect(response).toMatchObject({ ok: true, pickerOpened: true })
    finishLookup({ id: 1, active: false, windowId: 1, url: 'https://chatgpt.com/' } as chrome.tabs.Tab)
    await flush()
    expect(chrome.tabs.update).not.toHaveBeenCalled()
  })

  it('schedules silent authorization renewal while warming a ChatGPT page', async () => {
    const renewAt = Date.now() + 20 * 60_000
    auth.prepareGoogleAuthorization.mockResolvedValue(renewAt)
    await start(job('complete'))
    await request({ type: 'WARM_PICKER' })
    await flush()
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'gpfcGoogleAuthorizationRenewal', { when: renewAt },
    )
    expect(chrome.windows.create).not.toHaveBeenCalled()
  })

  it('opens a prepared picker without waiting for toolbar badge updates', async () => {
    const standby: StandbyPickerSession = {
      sessionId: 'standby', pickerUri: 'https://photos.google.com/picker/standby/autoclose',
      expireTime: new Date(Date.now() + 60_000).toISOString(), createdAt: Date.now(),
      used: false, maxItemCount: 50, ready: false,
      pollingConfig: { pollInterval: '2s', timeoutIn: '60s' },
    }
    await start(job('complete'), standby)
    let releaseBadge: (() => void) | undefined
    vi.mocked(chrome.action.setBadgeBackgroundColor).mockImplementation(() =>
      new Promise<void>((resolve) => { releaseBadge = resolve }),
    )
    vi.mocked(chrome.windows.create).mockResolvedValue({ id: 3, tabs: [{ id: 3, windowId: 3 }] } as unknown as void)
    try {
      const starting = request({ type: 'START_PICKER' })
      await flush()
      expect(chrome.windows.create).toHaveBeenCalledOnce()
      await expect(starting).resolves.toMatchObject({ ok: true, pickerOpened: true, pickerMode: 'standby' })
    } finally {
      releaseBadge?.()
      vi.mocked(chrome.action.setBadgeBackgroundColor).mockResolvedValue(undefined)
    }
  })

  it('ignores late attachment acknowledgements after cancellation', async () => {
    const store = await start(job('attaching'))
    const record = (await store.getJob('job'))!
    record.status = 'cancelled'
    record.sessionState = 'CANCELLED'
    await store.putJob(record)
    await request({ type: 'ATTACH_RESULT', jobId: 'job', result: {
      method: 'file-input', attempted: 1, verified: true, detail: 'late result',
    } })
    expect((await store.getJob('job'))?.status).toBe('cancelled')
    expect((await store.getJob('job'))?.attachment).toBeUndefined()
  })
})
