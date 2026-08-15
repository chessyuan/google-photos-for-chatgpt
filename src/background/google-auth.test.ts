import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizedFetch,
  connectGooglePhotos,
  createAuthorizedFetchSession,
  disconnectGooglePhotos,
  getAccessTokenForUserAction,
  getGoogleAuthState,
  GoogleAuthError,
} from './google-auth'
import {
  AUTH_DISCONNECTED_STORAGE_KEY,
  GOOGLE_PHOTOS_READINESS_STORAGE_KEY,
  PICKER_SCOPE,
} from '../shared/constants'

const clientId =
  '43154637059-a8t1kbv88cv9kj51edigsluh0gkbvn2m.apps.googleusercontent.com'
const authorization = (token: string) => ({
  token,
  grantedScopes: [PICKER_SCOPE],
})

describe('Google authorization state', () => {
  let localStorage: Record<string, unknown>
  let sessionStorage: Record<string, unknown>
  let getAuthToken: ReturnType<typeof vi.fn>
  let removeCachedAuthToken: ReturnType<typeof vi.fn>
  let clearAllCachedAuthTokens: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage = {}
    sessionStorage = {}
    getAuthToken = vi.fn()
    removeCachedAuthToken = vi.fn().mockResolvedValue(undefined)
    clearAllCachedAuthTokens = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ oauth2: { client_id: clientId } }),
      },
      i18n: {
        getMessage: () => '',
      },
      identity: {
        getAuthToken,
        removeCachedAuthToken,
        clearAllCachedAuthTokens,
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStorage[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(localStorage, value)
          }),
          remove: vi.fn(async (key: string) => {
            delete localStorage[key]
          }),
        },
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(sessionStorage, value)
          }),
          remove: vi.fn(async (key: string) => {
            delete sessionStorage[key]
          }),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports connected only after the Picker API was verified', async () => {
    getAuthToken.mockResolvedValue(authorization('cached-token'))
    sessionStorage[GOOGLE_PHOTOS_READINESS_STORAGE_KEY] = {
      status: 'ready',
      checkedAt: 1,
      message: 'Picker verified',
      validUntil: '2999-01-01T00:00:00.000Z',
    }

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'connected',
      connected: true,
    })
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: false,
      enableGranularPermissions: true,
      scopes: [PICKER_SCOPE],
    })
  })

  it('reports checking instead of a false connected state for a token alone', async () => {
    getAuthToken.mockResolvedValue(authorization('cached-token'))

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'checking',
      connected: false,
      authorized: true,
    })
  })

  it('reverifies Picker API access after the official session expiry', async () => {
    getAuthToken.mockResolvedValue(authorization('cached-token'))
    sessionStorage[GOOGLE_PHOTOS_READINESS_STORAGE_KEY] = {
      status: 'ready',
      checkedAt: 1,
      message: 'Picker verified',
      validUntil: '2000-01-01T00:00:00.000Z',
    }

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'checking',
      connected: false,
      authorized: true,
    })
  })

  it('reports a verified Picker API failure instead of a false connected state', async () => {
    getAuthToken.mockResolvedValue(authorization('cached-token'))
    sessionStorage[GOOGLE_PHOTOS_READINESS_STORAGE_KEY] = {
      status: 'error',
      checkedAt: 1,
      message: 'Picker access rejected',
      diagnosticCode: 'PICKER_API_HTTP_403_PERMISSION_DENIED',
    }

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'error',
      connected: false,
      authorized: true,
      reason: 'api',
      diagnosticCode: 'PICKER_API_HTTP_403_PERMISSION_DENIED',
    })
  })

  it('rejects a token that does not include the Picker scope', async () => {
    getAuthToken.mockResolvedValue({
      token: 'wrong-scope-token',
      grantedScopes: ['openid'],
    })

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'error',
      connected: false,
      authorized: false,
      reason: 'scope',
    })
  })

  it('reports disconnected without starting interactive authorization', async () => {
    getAuthToken.mockRejectedValue(new Error('OAuth2 request failed: no token'))

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'disconnected',
      connected: false,
      reason: 'required',
    })
    expect(getAuthToken).toHaveBeenCalledTimes(1)
    expect(getAuthToken.mock.calls[0]?.[0]).toMatchObject({ interactive: false })
  })

  it('turns Edge getAuthToken incompatibility into a product-facing state', async () => {
    getAuthToken.mockRejectedValue(
      new Error(
        'This API is not supported on Microsoft Edge. For more details, see extensions API documentation.',
      ),
    )

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'error',
      connected: false,
      reason: 'unsupported',
    })
  })

  it('continues from silent auth to interactive auth after a user action', async () => {
    getAuthToken
      .mockRejectedValueOnce(new Error('OAuth2 request failed: no token'))
      .mockResolvedValueOnce(authorization('new-token'))

    await expect(getAccessTokenForUserAction()).resolves.toBe('new-token')
    expect(getAuthToken.mock.calls.map(([details]) => details.interactive)).toEqual([
      false,
      true,
    ])
  })

  it('turns user cancellation into a product-facing authorization error', async () => {
    getAuthToken
      .mockRejectedValueOnce(new Error('OAuth2 request failed: no token'))
      .mockRejectedValueOnce(new Error('The user did not approve access'))

    const error = await getAccessTokenForUserAction().catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(GoogleAuthError)
    expect(error).toMatchObject({ code: 'cancelled' })
    expect((error as Error).message).not.toContain('OAuth2 request failed')
  })

  it('does not request interactive OAuth for an already-authorized user', async () => {
    getAuthToken.mockResolvedValue(authorization('cached-token'))

    await expect(getAccessTokenForUserAction()).resolves.toBe('cached-token')
    expect(getAuthToken).toHaveBeenCalledTimes(1)
    expect(getAuthToken.mock.calls[0]?.[0]).toMatchObject({ interactive: false })
  })

  it('uses the first authorization token without requesting it again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = await createAuthorizedFetchSession('first-auth-token')
    await request('https://example.test')

    expect(getAuthToken).not.toHaveBeenCalled()
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer first-auth-token')
  })

  it('invalidates a rejected cached token and retries after API 401', async () => {
    getAuthToken
      .mockResolvedValueOnce(authorization('stale-token'))
      .mockResolvedValueOnce(authorization('fresh-token'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await authorizedFetch('https://example.test')

    expect(response.status).toBe(200)
    expect(removeCachedAuthToken).toHaveBeenCalledWith({ token: 'stale-token' })
    expect(getAuthToken).toHaveBeenCalledTimes(2)
  })

  it('reports an expired authorization when a 401 refresh cannot get a token', async () => {
    getAuthToken
      .mockResolvedValueOnce(authorization('stale-token'))
      .mockRejectedValueOnce(new Error('invalid_grant for stale-token'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )

    const error = await authorizedFetch('https://example.test').catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(GoogleAuthError)
    expect(error).toMatchObject({ code: 'expired' })
    expect((error as Error).message).not.toContain('invalid_grant')
    expect((error as Error).message).not.toContain('stale-token')
  })

  it('reconnects interactively and clears the explicit disconnect flag', async () => {
    localStorage[AUTH_DISCONNECTED_STORAGE_KEY] = true
    getAuthToken.mockResolvedValue(authorization('reconnected-token'))

    await connectGooglePhotos(true)

    expect(clearAllCachedAuthTokens).toHaveBeenCalledTimes(1)
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: true,
      enableGranularPermissions: true,
      scopes: [PICKER_SCOPE],
    })
    expect(localStorage[AUTH_DISCONNECTED_STORAGE_KEY]).toBeUndefined()
  })

  it('disconnects without storing an OAuth token', async () => {
    await disconnectGooglePhotos()

    expect(clearAllCachedAuthTokens).toHaveBeenCalledTimes(1)
    expect(localStorage).toEqual({ [AUTH_DISCONNECTED_STORAGE_KEY]: true })

    const state = await getGoogleAuthState()
    expect(state).toMatchObject({ connected: false, status: 'disconnected' })
    expect(getAuthToken).not.toHaveBeenCalled()
  })
})
