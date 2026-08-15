import { OAUTH_PLACEHOLDER_PREFIX } from '../shared/constants'
import { UserFacingError } from '../shared/errors'

export function getManifestClientId(): string {
  const manifest = chrome.runtime.getManifest()
  const oauth2 = manifest.oauth2 as { client_id?: string } | undefined
  return oauth2?.client_id?.trim() ?? ''
}

export function isOAuthConfigured(): boolean {
  const clientId = getManifestClientId()
  return (
    clientId.endsWith('.apps.googleusercontent.com') &&
    !clientId.startsWith(OAUTH_PLACEHOLDER_PREFIX)
  )
}

function normalizeTokenResult(
  result: chrome.identity.GetAuthTokenResult | string,
): string {
  const token = typeof result === 'string' ? result : result.token
  if (!token) {
    throw new UserFacingError(
      'Google OAuth did not return an access token. Check the OAuth client, consent screen, test user, and signed-in browser profile.',
    )
  }
  return token
}

export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!isOAuthConfigured()) {
    throw new UserFacingError(
      'OAuth is not configured. Open “OAuth setup”, add this extension ID to a Chrome Extension OAuth client, configure its Client ID, rebuild, and reload dist.',
    )
  }

  try {
    const result = await chrome.identity.getAuthToken({
      interactive,
      enableGranularPermissions: true,
    })
    return normalizeTokenResult(result)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/cancel|closed|denied|not granted/i.test(detail)) {
      throw new UserFacingError(
        'Google OAuth was cancelled or denied: ' + detail,
      )
    }
    throw new UserFacingError('Google OAuth failed: ' + detail)
  }
}

export async function clearAccessToken(token: string): Promise<void> {
  await chrome.identity.removeCachedAuthToken({ token })
}

export async function clearAllAccessTokens(): Promise<void> {
  await chrome.identity.clearAllCachedAuthTokens()
}

export async function authorizedFetch(
  input: string,
  init: RequestInit = {},
  interactive = false,
): Promise<Response> {
  let token = await getAccessToken(interactive)

  const run = () => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', 'Bearer ' + token)
    return fetch(input, { ...init, headers })
  }

  let response = await run()
  if (response.status !== 401) return response

  await clearAccessToken(token)
  token = await getAccessToken(false)
  response = await run()
  return response
}

export type AuthorizedFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export async function createAuthorizedFetchSession(): Promise<AuthorizedFetch> {
  let token = await getAccessToken(false)
  let refresh: Promise<string> | undefined

  const refreshToken = async (staleToken: string): Promise<string> => {
    if (token !== staleToken) return token
    if (!refresh) {
      refresh = (async () => {
        await clearAccessToken(staleToken)
        return getAccessToken(false)
      })().finally(() => {
        refresh = undefined
      })
    }
    token = await refresh
    return token
  }

  return async (input: string, init: RequestInit = {}) => {
    const run = (accessToken: string) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', 'Bearer ' + accessToken)
      return fetch(input, { ...init, headers })
    }

    const requestToken = token
    let response = await run(requestToken)
    if (response.status !== 401) return response
    const replacement = await refreshToken(requestToken)
    response = await run(replacement)
    return response
  }
}
