import { describe, expect, it } from 'vitest'

import type { SessionLifecycleState } from '../shared/types'
import { transitionSessionState } from './session-state'

describe('Picker session state machine', () => {
  it('accepts the successful official Picker lifecycle', () => {
    const states = [
      'CREATING',
      'READY',
      'OPENING',
      'VISIBLE',
      'WAITING_SELECTION',
      'COMPLETING',
      'FETCHING_MEDIA',
      'METADATA_READY',
      'CONSUMED',
    ] as const
    let current: SessionLifecycleState | undefined
    for (const state of states) current = transitionSessionState(current, state)
    expect(current).toBe('CONSUMED')
  })

  it('rejects stale or duplicate-consumption transitions', () => {
    expect(() => transitionSessionState('CONSUMED', 'FETCHING_MEDIA')).toThrow(
      'Invalid Picker session transition',
    )
    expect(() => transitionSessionState('WAITING_SELECTION', 'READY')).toThrow(
      'Invalid Picker session transition',
    )
  })

  it('allows cancellation and failure from active states', () => {
    expect(transitionSessionState('WAITING_SELECTION', 'CANCELLED')).toBe(
      'CANCELLED',
    )
    expect(transitionSessionState('FETCHING_MEDIA', 'FAILED')).toBe('FAILED')
  })
})
