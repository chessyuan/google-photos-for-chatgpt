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
import { AUTH_DISCONNECTED_STORAGE_KEY } from '../shared/constants'

const clientId =
  '43154637059-a8t1kbv88cv9kj51edigsluh0gkbvn2m.apps.googleusercontent.com'

describe('Google authorization state', () => {
  let localStorage: Record<string, unknown>
  let getAuthToken: ReturnType<typeof vi.fn>
  let removeCachedAuthToken: ReturnType<typeof vi.fn>
  let clearAllCachedAuthTokens: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage = {}
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
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports connected when a valid cached token is available', async () => {
    getAuthToken.mockResolvedValue({ token: 'cached-token' })

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'connected',
      connected: true,
    })
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: false,
      enableGranularPermissions: true,
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
      .mockResolvedValueOnce({ token: 'new-token' })

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
    getAuthToken.mockResolvedValue({ token: 'cached-token' })

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
      .mockResolvedValueOnce({ token: 'stale-token' })
      .mockResolvedValueOnce({ token: 'fresh-token' })
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
      .mockResolvedValueOnce({ token: 'stale-token' })
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
    getAuthToken.mockResolvedValue({ token: 'reconnected-token' })

    await connectGooglePhotos(true)

    expect(clearAllCachedAuthTokens).toHaveBeenCalledTimes(1)
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: true,
      enableGranularPermissions: true,
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
