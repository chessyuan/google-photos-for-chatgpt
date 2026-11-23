import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicJob } from './shared/types'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  attach: vi.fn(),
  showToast: vi.fn(),
  clearToast: vi.fn(),
  setBusy: vi.fn(),
}))

vi.mock('./shared/download-client', () => ({ downloadJobFiles: mocks.download }))
vi.mock('./content/attachment', () => ({
  attachFilesToChatGPT: mocks.attach,
  warmChatGPTUploadTargets: vi.fn(),
}))
vi.mock('./content/quick-ui', () => ({
  createQuickUi: () => ({ showToast: mocks.showToast, clearToast: mocks.clearToast, setBusy: mocks.setBusy }),
}))

function readyJob(id: string): PublicJob {
  return {
    id, targetTabId: 1, targetKind: 'chatgpt', status: 'ready',
    message: '', selectedCount: 1, warnings: [], updatedAt: 1,
  }
}

describe('pending selections in the ChatGPT content script', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('restores older ready jobs and hands off files one at a time despite duplicate events', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const first = readyJob('first')
    const second = readyJob('second')
    const current: PublicJob = { ...readyJob('current'), status: 'picking' }
    let finishFirst!: (value: { files: File[]; skipped: string[] }) => void
    mocks.download.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce({ files: [new File(['2'], 'second.png')], skipped: [] })
    mocks.attach.mockResolvedValue({ attempted: 1, method: 'file-input', verified: true, detail: 'attached' })
    const listeners: ((message: unknown, sender: unknown, reply: () => void) => boolean)[] = []
    const sendMessage = vi.fn(async (request: { type: string }) => request.type === 'GET_JOB'
      ? { ok: true, job: current, readyJobs: [first, second] }
      : { ok: true })
    vi.stubGlobal('chrome', { runtime: { sendMessage, onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) } } })

    await import('./content')
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1))
    expect(mocks.download.mock.calls[0]?.[0]).toBe('first')
    listeners[0]!({ type: 'JOB_STATUS', targetTabId: 1, job: first }, {}, () => undefined)
    listeners[0]!({ type: 'JOB_STATUS', targetTabId: 1, job: second }, {}, () => undefined)
    expect(mocks.download).toHaveBeenCalledTimes(1)

    finishFirst({ files: [new File(['1'], 'first.png')], skipped: [] })
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2))
    expect(mocks.download.mock.calls[1]?.[0]).toBe('second')
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([value]) => value.type === 'ATTACH_RESULT')).toHaveLength(2))
    expect(mocks.attach).toHaveBeenCalledTimes(2)
  })
})
