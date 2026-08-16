import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_PHOTOS_READINESS_STORAGE_KEY } from '../shared/constants'
import {
  clearGooglePhotosReadiness,
  markGooglePhotosError,
  markGooglePhotosReady,
  readGooglePhotosReadiness,
} from './google-photos-readiness'

describe('Google Photos Picker readiness storage', () => {
  let stored: Record<string, unknown>

  beforeEach(() => {
    stored = {}
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(stored, structuredClone(values))
          }),
          remove: vi.fn(async (key: string) => {
            delete stored[key]
          }),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stores only a non-sensitive successful API readiness result', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)

    await markGooglePhotosReady(
      'Picker verified',
      '2030-01-01T00:00:00.000Z',
    )

    await expect(readGooglePhotosReadiness()).resolves.toEqual({
      status: 'ready',
      checkedAt: 1234,
      message: 'Picker verified',
      validUntil: '2030-01-01T00:00:00.000Z',
    })
    expect(
      JSON.stringify(stored[GOOGLE_PHOTOS_READINESS_STORAGE_KEY]),
    ).not.toMatch(/token|authorization|bearer/i)
  })

  it('stores a sanitized diagnostic code without credentials', async () => {
    await markGooglePhotosError(
      'Google Photos Picker access was rejected.',
      'PICKER_API_HTTP_403_PERMISSION_DENIED',
    )

    await expect(readGooglePhotosReadiness()).resolves.toMatchObject({
      status: 'error',
      diagnosticCode: 'PICKER_API_HTTP_403_PERMISSION_DENIED',
    })
    expect(
      JSON.stringify(stored[GOOGLE_PHOTOS_READINESS_STORAGE_KEY]),
    ).not.toContain('ya29.')
  })

  it('clears readiness when the account is reconnected or disconnected', async () => {
    await markGooglePhotosReady(
      'Picker verified',
      '2030-01-01T00:00:00.000Z',
    )
    await clearGooglePhotosReadiness()

    await expect(readGooglePhotosReadiness()).resolves.toBeUndefined()
  })
})
