import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STANDBY_SESSION_STORAGE_KEY } from '../shared/constants'
import type { StandbyPickerSession } from '../shared/types'
import {
  clearStandbyPreloadState,
  consumeStandbySession,
  getStandbyMissReason,
  readStandbySession,
  standbyFromPickingSession,
  standbyIsUsable,
} from './standby-session'

describe('standby Picker session storage', () => {
  let stored: StandbyPickerSession | undefined

  beforeEach(() => {
    stored = undefined
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          async get(key: string) {
            return stored ? { [key]: structuredClone(stored) } : {}
          },
          async set(values: Record<string, StandbyPickerSession>) {
            stored = structuredClone(values[STANDBY_SESSION_STORAGE_KEY])
          },
          async remove() {
            stored = undefined
          },
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the official expiry and an autoclose URI without inventing a TTL', () => {
    const standby = standbyFromPickingSession(
      {
        id: 'session-1',
        pickerUri: 'https://photos.google.com/picker/session-1?authuser=0',
        expireTime: '2030-01-01T00:00:00.000Z',
        mediaItemsSet: false,
        pollingConfig: { pollInterval: '2s', timeoutIn: '600s' },
      },
      50,
      1234,
    )

    expect(standby).toEqual({
      sessionId: 'session-1',
      pickerUri:
        'https://photos.google.com/picker/session-1/autoclose?authuser=0',
      expireTime: '2030-01-01T00:00:00.000Z',
      pollingConfig: { pollInterval: '2s', timeoutIn: '600s' },
      createdAt: 1234,
      used: false,
      maxItemCount: 50,
      ready: false,
    })
  })

  it('uses expireTime and rejects used, expired, invalid, or mismatched sessions', () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z')
    const base: StandbyPickerSession = {
      sessionId: 'session-1',
      pickerUri: 'https://photos.google.com/picker/session-1/autoclose',
      expireTime: '2030-01-01T00:00:01.000Z',
      createdAt: 1,
      used: false,
      maxItemCount: 50,
      ready: false,
    }

    expect(standbyIsUsable(base, 50, now)).toBe(true)
    expect(standbyIsUsable({ ...base, used: true }, 50, now)).toBe(false)
    expect(
      standbyIsUsable({ ...base, expireTime: new Date(now).toISOString() }, 50, now),
    ).toBe(false)
    expect(standbyIsUsable({ ...base, expireTime: 'invalid' }, 50, now)).toBe(
      false,
    )
    expect(standbyIsUsable(base, 15, now)).toBe(false)
    expect(getStandbyMissReason(undefined, 50, now)).toBe('no session')
    expect(getStandbyMissReason({ ...base, used: true }, 50, now)).toBe('used')
    expect(
      getStandbyMissReason(
        { ...base, expireTime: new Date(now).toISOString() },
        50,
        now,
      ),
    ).toBe('expired')
    expect(getStandbyMissReason(base, 15, now)).toBe(
      'max item count mismatch',
    )
  })

  it('removes legacy preloaded-tab state without changing the session', () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z')
    const legacy: StandbyPickerSession = {
      sessionId: 'session-ready',
      pickerUri: 'https://photos.google.com/picker/session-ready/autoclose',
      expireTime: '2030-01-01T00:01:00.000Z',
      createdAt: now - 1000,
      used: false,
      maxItemCount: 50,
      pickerTabId: 77,
      pickerWindowId: 3,
      ready: true,
      tabStatus: 'complete',
      preloadPresentation: 'minimized-popup',
    }

    const cleared = clearStandbyPreloadState(legacy)

    expect(cleared).toEqual({
      sessionId: 'session-ready',
      pickerUri: 'https://photos.google.com/picker/session-ready/autoclose',
      expireTime: '2030-01-01T00:01:00.000Z',
      createdAt: now - 1000,
      used: false,
      maxItemCount: 50,
      ready: false,
    })
  })

  it('remembers when a user dismisses a preloaded popup', () => {
    const session: StandbyPickerSession = {
      sessionId: 'session-dismissed',
      pickerUri: 'https://photos.google.com/picker/session/autoclose',
      expireTime: '2030-01-01T00:01:00.000Z',
      createdAt: 1,
      used: false,
      maxItemCount: 50,
      pickerTabId: 12,
      pickerWindowId: 34,
      ready: true,
      tabStatus: 'complete',
      preloadPresentation: 'minimized-popup',
    }

    expect(clearStandbyPreloadState(session, true)).toMatchObject({
      sessionId: 'session-dismissed',
      ready: false,
      preloadDismissed: true,
    })
    expect(clearStandbyPreloadState(session, true)).not.toHaveProperty(
      'pickerWindowId',
    )
  })

  it('atomically marks a cached session used and never returns it twice', async () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z')
    stored = {
      sessionId: 'session-1',
      pickerUri: 'https://photos.google.com/picker/session-1/autoclose',
      expireTime: '2030-01-01T00:01:00.000Z',
      createdAt: now - 1000,
      used: false,
      maxItemCount: 50,
      ready: false,
    }

    const results = await Promise.all([
      consumeStandbySession(50, now),
      consumeStandbySession(50, now),
    ])
    const consumed = results.flatMap((result) =>
      result.standby ? [result.standby] : [],
    )

    expect(consumed).toHaveLength(1)
    expect(consumed[0]?.sessionId).toBe('session-1')
    expect(consumed[0]?.used).toBe(true)
    expect((await readStandbySession())?.used).toBe(true)
    expect(results.some((result) => result.missReason === 'used')).toBe(true)
  })
})
