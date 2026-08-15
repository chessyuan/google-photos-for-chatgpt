import { describe, expect, it } from 'vitest'

import { mapConcurrentOrdered } from './download-queue'

describe('mapConcurrentOrdered', () => {
  it('limits active work and preserves result order', async () => {
    let active = 0
    let maximumActive = 0
    const results = await mapConcurrentOrdered(
      [30, 5, 20, 1, 10],
      3,
      async (delay, index) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, delay))
        active -= 1
        return 'item-' + index
      },
    )

    expect(maximumActive).toBe(3)
    expect(results).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
      'item-4',
    ])
  })

  it('rejects invalid concurrency', async () => {
    await expect(
      mapConcurrentOrdered([1], 0, async (value) => value),
    ).rejects.toThrow('positive integer')
  })
})
