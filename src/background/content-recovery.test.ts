import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverOpenChatGPTPages } from './content-recovery'

afterEach(() => vi.unstubAllGlobals())

describe('content script recovery after updates', () => {
  it('reattaches stale pages while leaving live scripts and discarded tabs alone', async () => {
    const executeScript = vi.fn().mockResolvedValue([])
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3, discarded: true }]),
        sendMessage: vi.fn().mockRejectedValueOnce(new Error('context invalidated')).mockResolvedValueOnce({ ok: true }),
      },
      scripting: { executeScript },
    })
    await recoverOpenChatGPTPages()
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 1 }, files: ['content.js'] })
  })

  it('continues recovering other pages if one tab closes during injection', async () => {
    const executeScript = vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValueOnce([])
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]), sendMessage: vi.fn().mockRejectedValue(new Error('no receiver')) },
      scripting: { executeScript },
    })
    await expect(recoverOpenChatGPTPages()).resolves.toBeUndefined()
    expect(executeScript).toHaveBeenCalledTimes(2)
  })
})
