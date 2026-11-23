import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizedFetch,
  connectGooglePhotos,
  createAuthorizedFetchSession,
  disconnectGooglePhotos,
  getAccessTokenForUserAction,
  getGoogleAuthorization,
  getGoogleAuthState,
  GoogleAuthError,
  prepareGoogleAuthorization,
} from './google-auth'
import {
  AUTH_DISCONNECTED_STORAGE_KEY,
  GOOGLE_PHOTOS_READINESS_STORAGE_KEY,
  PICKER_SCOPE,
  WEB_OAUTH_STORAGE_KEY,
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
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request in unit test')))
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
          setAccessLevel: vi.fn().mockResolvedValue(undefined),
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

  it('binds Chrome Identity authorization to the visible Chrome profile account', async () => {
    chrome.identity.getProfileUserInfo = vi.fn().mockResolvedValue({
      id: 'gaia-primary',
      email: 'photos@example.com',
    })
    getAuthToken.mockResolvedValue(authorization('profile-token'))

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      authorized: true,
      accountEmail: 'photos@example.com',
      accountKey: 'chrome:gaia-primary',
      accountSelection: 'chrome-profile',
    })
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: false,
      enableGranularPermissions: true,
      scopes: [PICKER_SCOPE],
      account: { id: 'gaia-primary' },
    })
  })

  it('uses the official Google account chooser when a Web OAuth client is configured', async () => {
    const webClientId =
      '43154637059-accountchooser.apps.googleusercontent.com'
    vi.stubGlobal('__GPFC_GOOGLE_WEB_CLIENT_ID__', webClientId)
    chrome.identity.getRedirectURL = vi
      .fn()
      .mockReturnValue('https://igacbcmbkglkglkindhcpmagafnboolj.chromiumapp.org/')
    chrome.identity.launchWebAuthFlow = vi.fn(
      async ({ url }: chrome.identity.WebAuthFlowDetails) => {
        const authorizationUrl = new URL(url)
        expect(authorizationUrl.searchParams.get('client_id')).toBe(webClientId)
        expect(authorizationUrl.searchParams.get('prompt')).toBe(
          'select_account',
        )
        expect(authorizationUrl.searchParams.get('scope')).toBe(PICKER_SCOPE)
        const state = authorizationUrl.searchParams.get('state')
        return (
          'https://igacbcmbkglkglkindhcpmagafnboolj.chromiumapp.org/#' +
          new URLSearchParams({
            access_token: 'chooser-token',
            expires_in: '3600',
            scope: PICKER_SCOPE,
            state: state ?? '',
          })
        )
      },
    )

    await connectGooglePhotos(true)

    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
    expect(getAuthToken).not.toHaveBeenCalled()
    expect(sessionStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({
      token: 'chooser-token',
      grantedScopes: [PICKER_SCOPE],
    })
    await expect(getGoogleAuthState()).resolves.toMatchObject({
      authorized: true,
      accountSelection: 'google-chooser',
    })
  })

  it('reports chooser mode as disconnected when no session token exists', async () => {
    vi.stubGlobal(
      '__GPFC_GOOGLE_WEB_CLIENT_ID__',
      '43154637059-accountchooser.apps.googleusercontent.com',
    )

    await expect(getGoogleAuthState()).resolves.toMatchObject({
      status: 'disconnected',
      connected: false,
      authorized: false,
      reason: 'required',
      accountSelection: 'google-chooser',
    })
    expect(getAuthToken).not.toHaveBeenCalled()
  })

  function chooserLogin(overrides: Record<string, unknown> = {}) {
    vi.stubGlobal('__GPFC_GOOGLE_WEB_CLIENT_ID__', 'test-chooser.apps.googleusercontent.com')
    chrome.identity.getRedirectURL = vi.fn().mockReturnValue('https://test.chromiumapp.org/')
    chrome.identity.launchWebAuthFlow = vi.fn(async ({ url }: chrome.identity.WebAuthFlowDetails) => {
      const state = new URL(url).searchParams.get('state') ?? ''
      return 'https://test.chromiumapp.org/#' + new URLSearchParams({
        access_token: 'renewed-token', expires_in: '3600', scope: PICKER_SCOPE, state,
      })
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      aud: 'test-chooser.apps.googleusercontent.com', sub: 'account-original',
    }), { status: 200 })))
    const stored = {
      token: 'saved-token', grantedScopes: [PICKER_SCOPE],
      expiresAt: Date.now() + 3600_000, selectedAt: 12345,
      loginHint: 'account-original', ...overrides,
    }
    localStorage[WEB_OAUTH_STORAGE_KEY] = stored
    return stored
  }

  it('restores a still-valid chooser login after session storage is cleared', async () => {
    chooserLogin()
    await expect(getGoogleAuthorization(false)).resolves.toMatchObject({
      token: 'saved-token', accountKey: 'chooser:12345',
    })
    expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('migrates a valid legacy session token without asking for another login', async () => {
    const stored = chooserLogin()
    delete localStorage[WEB_OAUTH_STORAGE_KEY]
    sessionStorage[WEB_OAUTH_STORAGE_KEY] = stored
    await expect(getGoogleAuthorization(false)).resolves.toMatchObject({ token: 'saved-token' })
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toEqual(stored)
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('learns the account binding for a valid legacy token without opening login UI', async () => {
    const stored = chooserLogin({ loginHint: undefined })
    delete localStorage[WEB_OAUTH_STORAGE_KEY]
    sessionStorage[WEB_OAUTH_STORAGE_KEY] = stored
    await expect(getGoogleAuthorization(false)).resolves.toMatchObject({ token: 'saved-token' })
    await vi.waitFor(() => expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({
      token: 'saved-token', loginHint: 'account-original', selectedAt: 12345,
    }))
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('renews an expired login once for concurrent requests and preserves the account key', async () => {
    chooserLogin({ expiresAt: 0 })
    const results = await Promise.all([
      getGoogleAuthorization(false), getGoogleAuthorization(false), getGoogleAuthorization(false),
    ])
    expect(results.map((result) => result.token)).toEqual(['renewed-token', 'renewed-token', 'renewed-token'])
    expect(results.every((result) => result.accountKey === 'chooser:12345')).toBe(true)
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
    const details = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0]![0]
    expect(details).toMatchObject({ interactive: false, abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 5000 })
    const url = new URL(details.url)
    expect(url.searchParams.get('prompt')).toBe('none')
    expect(url.searchParams.get('login_hint')).toBe('account-original')
    expect(url.searchParams.get('scope')).toBe(PICKER_SCOPE)
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({ token: 'renewed-token', selectedAt: 12345 })
  })

  it('renews the same account silently before the access token expires', async () => {
    chooserLogin({ expiresAt: Date.now() + 2 * 60_000 })
    const [next, other] = await Promise.all([
      prepareGoogleAuthorization(), prepareGoogleAuthorization(),
    ])
    expect(next).toBeGreaterThan(Date.now() + 50 * 60_000)
    expect(other).toBeGreaterThan(Date.now() + 50 * 60_000)
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0]![0].interactive).toBe(false)
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({
      token: 'renewed-token', loginHint: 'account-original', selectedAt: 12345,
    })
  })

  it('keeps a working token when early silent renewal is unavailable', async () => {
    const expiresAt = Date.now() + 2 * 60_000
    const original = chooserLogin({ token: 'failure-token', expiresAt })
    vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(new Error('interaction required'))
    const next = await prepareGoogleAuthorization()
    expect(next).toBeGreaterThan(expiresAt)
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toEqual(original)
    await expect(getGoogleAuthorization(false)).resolves.toMatchObject({ token: 'failure-token' })
    await prepareGoogleAuthorization()
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
  })

  it('does not switch accounts during proactive renewal', async () => {
    const original = chooserLogin({ token: 'mismatch-token', expiresAt: Date.now() + 2 * 60_000 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      aud: 'test-chooser.apps.googleusercontent.com', sub: 'account-other',
    }), { status: 200 })))
    await prepareGoogleAuthorization()
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toEqual(original)
    await expect(getGoogleAuthorization(false)).resolves.toMatchObject({ token: 'mismatch-token' })
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
  })

  it('does not immediately retry if Google returns a token with little lifetime left', async () => {
    chooserLogin({ token: 'short-start-token', expiresAt: Date.now() + 2 * 60_000 })
    chrome.identity.launchWebAuthFlow = vi.fn(async ({ url }: chrome.identity.WebAuthFlowDetails) =>
      'https://test.chromiumapp.org/#' + new URLSearchParams({
        access_token: 'short-token', expires_in: '90', scope: PICKER_SCOPE,
        state: new URL(url).searchParams.get('state') ?? '',
      }),
    )
    const next = await prepareGoogleAuthorization()
    expect(next).toBeGreaterThanOrEqual(Date.now() + 90_000)
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
  })

  it('does not use background maintenance to reconnect an explicitly disconnected account', async () => {
    chooserLogin({ expiresAt: 0 })
    localStorage[AUTH_DISCONNECTED_STORAGE_KEY] = true
    await expect(prepareGoogleAuthorization()).resolves.toBeUndefined()
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('does not delay the first authorized action while the account hint is being checked', async () => {
    chooserLogin()
    delete localStorage[WEB_OAUTH_STORAGE_KEY]
    let finishLookup!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishLookup = resolve })))
    await expect(connectGooglePhotos(true)).resolves.toBeUndefined()
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({ token: 'renewed-token' })
    finishLookup(new Response(JSON.stringify({
      aud: 'test-chooser.apps.googleusercontent.com', sub: 'account-original',
    }), { status: 200 }))
    await vi.waitFor(() => expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({
      loginHint: 'account-original',
    }))
  })

  it('does not silently switch to a different Google account', async () => {
    const original = chooserLogin({ expiresAt: 0 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      aud: 'test-chooser.apps.googleusercontent.com', sub: 'account-other',
    }), { status: 200 })))
    await expect(getGoogleAuthorization(false)).rejects.toMatchObject({ code: 'expired' })
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toEqual(original)
  })

  it('does not renew without a verified account binding', async () => {
    chooserLogin({ expiresAt: 0, loginHint: undefined })
    await expect(getGoogleAuthorization(false)).rejects.toMatchObject({ code: 'expired' })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('preserves the current account when choosing another account is cancelled', async () => {
    const original = chooserLogin()
    vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(new Error('The user did not approve access'))
    await expect(connectGooglePhotos(true)).rejects.toMatchObject({ code: 'cancelled' })
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toEqual(original)
    await expect(getGoogleAuthorization(false)).resolves.toMatchObject({ token: 'saved-token' })
  })

  it('removes durable and session authorization on explicit disconnect', async () => {
    const original = chooserLogin()
    sessionStorage[WEB_OAUTH_STORAGE_KEY] = original
    await disconnectGooglePhotos()
    expect(localStorage).toEqual({ [AUTH_DISCONNECTED_STORAGE_KEY]: true })
    expect(sessionStorage[WEB_OAUTH_STORAGE_KEY]).toBeUndefined()
    await expect(getGoogleAuthorization(false)).rejects.toMatchObject({ code: 'required' })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('cannot restore authorization after the user disconnects during renewal', async () => {
    chooserLogin({ expiresAt: 0 })
    let finishFlow: (() => void) | undefined
    const flowStarted = new Promise<void>((resolve) => {
      chrome.identity.launchWebAuthFlow = vi.fn(({ url }: chrome.identity.WebAuthFlowDetails) => {
        resolve()
        return new Promise<string>((finish) => {
          finishFlow = () => finish('https://test.chromiumapp.org/#' + new URLSearchParams({
            access_token: 'renewed-token', expires_in: '3600', scope: PICKER_SCOPE,
            state: new URL(url).searchParams.get('state') ?? '',
          }))
        })
      })
    })
    const result = getGoogleAuthorization(false).catch((error: unknown) => error)
    await flowStarted
    await disconnectGooglePhotos()
    finishFlow?.()
    await expect(result).resolves.toMatchObject({ code: 'required' })
    expect(localStorage).toEqual({ [AUTH_DISCONNECTED_STORAGE_KEY]: true })
    expect(sessionStorage[WEB_OAUTH_STORAGE_KEY]).toBeUndefined()
  })

  it('rejects an OAuth redirect with the wrong path before saving a token', async () => {
    const original = chooserLogin()
    chrome.identity.launchWebAuthFlow = vi.fn().mockResolvedValue('https://test.chromiumapp.org/unexpected#access_token=bad')
    await expect(connectGooglePhotos(true)).rejects.toMatchObject({ code: 'failed' })
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toEqual(original)
  })

  it('renews a rejected chooser token after 401 without losing its account binding', async () => {
    chooserLogin()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        aud: 'test-chooser.apps.googleusercontent.com', sub: 'account-original',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(authorizedFetch('https://example.test')).resolves.toMatchObject({ status: 200 })
    expect(localStorage[WEB_OAUTH_STORAGE_KEY]).toMatchObject({
      token: 'renewed-token', loginHint: 'account-original', selectedAt: 12345,
    })
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('Authorization')).toBe('Bearer renewed-token')
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
  })

  it('serializes disconnect with a renewal whose storage write is still pending', async () => {
    chooserLogin({ expiresAt: 0 })
    let finishWrite: (() => void) | undefined
    let startedWrite: (() => void) | undefined
    const started = new Promise<void>((resolve) => { startedWrite = resolve })
    vi.mocked(chrome.storage.local.set).mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(localStorage, values)
      if ((values[WEB_OAUTH_STORAGE_KEY] as { token?: string } | undefined)?.token === 'renewed-token') {
        startedWrite?.()
        await new Promise<void>((resolve) => { finishWrite = resolve })
      }
    })
    const renewing = getGoogleAuthorization(false).catch((error: unknown) => error)
    await started
    const disconnecting = disconnectGooglePhotos()
    finishWrite?.()
    await disconnecting
    await expect(renewing).resolves.toMatchObject({ code: 'required' })
    expect(localStorage).toEqual({ [AUTH_DISCONNECTED_STORAGE_KEY]: true })
    expect(sessionStorage[WEB_OAUTH_STORAGE_KEY]).toBeUndefined()
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
