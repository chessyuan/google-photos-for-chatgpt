import { describe, expect, it, vi } from 'vitest'

import { SingleFlight } from './single-flight'

describe('SingleFlight', () => {
  it('runs one finalize task for duplicate completion signals', async () => {
    const flight = new SingleFlight()
    const task = vi.fn(async () => {
      await Promise.resolve()
    })

    await Promise.all([
      flight.run('session-1', task),
      flight.run('session-1', task),
      flight.run('session-1', task),
    ])
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('allows a recovery attempt after failure', async () => {
    const flight = new SingleFlight()
    await expect(
      flight.run('session-1', async () => {
        throw new Error('failed')
      }),
    ).rejects.toThrow('failed')

    const recovered = vi.fn(async () => undefined)
    await flight.run('session-1', recovered)
    expect(recovered).toHaveBeenCalledOnce()
  })
})
