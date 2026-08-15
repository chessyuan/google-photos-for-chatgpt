import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletionCoordinator } from './completion-coordinator'

describe('completion fast-path coordinator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('wakes a pending official poll immediately on completion', async () => {
    const coordinator = new CompletionCoordinator()
    const wait = coordinator.wait('job-1', 2000)

    expect(coordinator.request('job-1')).toBe(true)
    expect(coordinator.request('job-1')).toBe(false)
    await expect(wait).resolves.toBe('completion')
  })

  it('deduplicates completion events before they are consumed', async () => {
    const coordinator = new CompletionCoordinator()

    expect(coordinator.request('job-1')).toBe(true)
    expect(coordinator.request('job-1')).toBe(false)
    await expect(coordinator.wait('job-1', 2000)).resolves.toBe('completion')
  })

  it('falls back to the polling interval when no completion event occurs', async () => {
    const coordinator = new CompletionCoordinator()
    const wait = coordinator.wait('job-1', 2000)

    await vi.advanceTimersByTimeAsync(2000)
    await expect(wait).resolves.toBe('interval')
  })

  it('returns to the official interval after a fast-path response is not ready', async () => {
    const coordinator = new CompletionCoordinator()
    const fastPath = coordinator.wait('job-1', 2000)
    coordinator.request('job-1')
    await expect(fastPath).resolves.toBe('completion')

    const fallback = coordinator.wait('job-1', 2000)
    await vi.advanceTimersByTimeAsync(1999)
    let settled = false
    void fallback.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(fallback).resolves.toBe('interval')
  })
})
