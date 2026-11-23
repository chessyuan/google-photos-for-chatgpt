import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOB_RETENTION_MS, JOB_STORAGE_KEY } from '../shared/constants'
import type { PickerJob } from '../shared/types'

function job(id = 'one'): PickerJob {
  return {
    id, targetTabId: 1, targetKind: 'chatgpt', status: 'ready',
    message: '', createdAt: Date.now(), updatedAt: Date.now(),
    maxItemCount: 50, warnings: [],
  }
}

describe('job persistence recovery', () => {
  const get = vi.fn()
  const set = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    get.mockReset().mockResolvedValue({})
    set.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('chrome', { storage: { session: { get, set } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('recovers after a failed initial storage read', async () => {
    const store = await import('./job-store')
    get.mockRejectedValueOnce(new Error('temporary read failure'))
    await expect(store.loadJobs()).rejects.toThrow('temporary read failure')
    await store.putJob(job())
    expect(await store.getJob('one')).toBeDefined()
  })

  it('allows later writes after one write fails', async () => {
    const store = await import('./job-store')
    set.mockRejectedValueOnce(new Error('temporary write failure'))
    await expect(store.putJob(job())).rejects.toThrow('temporary write failure')
    await store.putJob(job('two'))
    expect(Object.keys(set.mock.calls[1]![0][JOB_STORAGE_KEY])).toEqual(['one', 'two'])
  })

  it('serializes immutable snapshots in write order', async () => {
    const store = await import('./job-store')
    const record = job()
    await store.putJob(record)
    record.message = 'next'
    await store.putJob(record)
    expect(set.mock.calls[0]![0][JOB_STORAGE_KEY].one.message).toBe('')
    expect(set.mock.calls[1]![0][JOB_STORAGE_KEY].one.message).toBe('next')
  })

  it('prunes expired terminal history during long worker sessions', async () => {
    const store = await import('./job-store')
    const old = job('old')
    old.status = 'complete'
    await store.putJob(old)
    old.updatedAt = Date.now() - JOB_RETENTION_MS - 1
    await store.putJob(job('new'))
    expect(await store.getJob('old')).toBeUndefined()
  })

  it('keeps the most recently opened Picker current when an older one updates', async () => {
    const store = await import('./job-store')
    const older = job('older')
    older.createdAt -= 1000
    const newer = job('newer')
    await store.putJob(older)
    await store.putJob(newer)
    await store.putJob(older)
    expect((await store.getLatestJobForTab(1))?.id).toBe('newer')
  })

  it('chooses the last inserted Picker when creation timestamps are equal', async () => {
    const store = await import('./job-store')
    const first = job('first')
    const second = job('second')
    second.createdAt = first.createdAt
    await store.putJob(first)
    await store.putJob(second)
    await store.putJob(first)
    expect((await store.getLatestJobForTab(1))?.id).toBe('second')
  })
})
