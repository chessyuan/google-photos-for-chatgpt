import { describe, expect, it, vi } from 'vitest'
import { authorizeAndCreatePickerSession } from './picker-authorization'

describe('Picker authorization handoff', () => {
  it('creates the Picker session immediately after first authorization', async () => {
    const events: string[] = []
    const authorize = vi.fn(async () => {
      events.push('authorized')
    })
    const createSession = vi.fn(async () => {
      events.push('session-created')
      return { id: 'session-1' }
    })

    await expect(
      authorizeAndCreatePickerSession(authorize, createSession),
    ).resolves.toEqual({ id: 'session-1' })
    expect(events).toEqual(['authorized', 'session-created'])
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('does not create a Picker session after authorization cancellation', async () => {
    const createSession = vi.fn()

    await expect(
      authorizeAndCreatePickerSession(
        async () => {
          throw new Error('cancelled')
        },
        createSession,
      ),
    ).rejects.toThrow('cancelled')
    expect(createSession).not.toHaveBeenCalled()
  })
})
