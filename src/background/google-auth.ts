import {
  AUTH_DISCONNECTED_STORAGE_KEY,
  OAUTH_PLACEHOLDER_PREFIX,
} from '../shared/constants'
import { UserFacingError } from '../shared/errors'
import { message } from '../shared/i18n'
import type { GoogleAuthState } from '../shared/types'

export type GoogleAuthErrorCode =
  | 'required'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'unsupported'
  | 'configuration'

export class GoogleAuthError extends UserFacingError {
  readonly code: GoogleAuthErrorCode
  readonly technicalDetail?: string

  constructor(
    code: GoogleAuthErrorCode,
    publicMessage: string,
    technicalDetail?: string,
  ) {
    super(publicMessage)
    this.name = 'GoogleAuthError'
    this.code = code
    this.technicalDetail = technicalDetail
  }
}

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

function sanitizeTechnicalDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/ya29\.[A-Za-z0-9._~-]+/gi, '[redacted-token]')
    .slice(0, 500)
}

export function classifyIdentityError(
  error: unknown,
  interactive: boolean,
): Exclude<GoogleAuthErrorCode, 'configuration'> {
  const detail = sanitizeTechnicalDetail(error)
  if (/api is not supported on microsoft edge|identity\.getauthtoken.*not supported/i.test(detail)) {
    return 'unsupported'
  }
  if (/cancel|closed|denied|not granted|user rejected|user did not approve/i.test(detail)) {
    return interactive ? 'cancelled' : 'required'
  }
  if (/invalid[_ ]grant|expired|invalid token|token has been revoked/i.test(detail)) {
    return 'expired'
  }
  if (!interactive && /oauth2 request failed|no token|not signed in|interaction/i.test(detail)) {
    return 'required'
  }
  return 'failed'
}

function publicMessage(code: GoogleAuthErrorCode): string {
  switch (code) {
    case 'required':
      return message('authorizationRequired')
    case 'cancelled':
      return message('authorizationCancelled')
    case 'expired':
      return message('authorizationExpired')
    case 'failed':
      return message('authorizationFailed')
    case 'configuration':
      return message('developmentBuildNotConfigured')
    case 'unsupported':
      return message('browserAuthorizationUnsupported')
  }
}

function asGoogleAuthError(
  error: unknown,
  interactive: boolean,
): GoogleAuthError {
  if (error instanceof GoogleAuthError) return error
  const code = classifyIdentityError(error, interactive)
  return new GoogleAuthError(
    code,
    publicMessage(code),
    sanitizeTechnicalDetail(error),
  )
}

function normalizeTokenResult(
  result: chrome.identity.GetAuthTokenResult | string,
): string {
  const token = typeof result === 'string' ? result : result.token
  if (!token) {
    throw new GoogleAuthError(
      'failed',
      publicMessage('failed'),
      'Chrome Identity returned no access token.',
    )
  }
  return token
}

async function explicitDisconnectRequested(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTH_DISCONNECTED_STORAGE_KEY)
  return stored[AUTH_DISCONNECTED_STORAGE_KEY] === true
}

async function setExplicitDisconnect(disconnected: boolean): Promise<void> {
  if (disconnected) {
    await chrome.storage.local.set({ [AUTH_DISCONNECTED_STORAGE_KEY]: true })
  } else {
    await chrome.storage.local.remove(AUTH_DISCONNECTED_STORAGE_KEY)
  }
}

export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!isOAuthConfigured()) {
    throw new GoogleAuthError(
      'configuration',
      publicMessage('configuration'),
    )
  }
  if (!interactive && (await explicitDisconnectRequested())) {
    throw new GoogleAuthError('required', publicMessage('required'))
  }

  try {
    const result = await chrome.identity.getAuthToken({
      interactive,
      enableGranularPermissions: true,
    })
    const token = normalizeTokenResult(result)
    await setExplicitDisconnect(false)
    return token
  } catch (error) {
    throw asGoogleAuthError(error, interactive)
  }
}

export async function getAccessTokenForUserAction(): Promise<string> {
  try {
    return await getAccessToken(false)
  } catch (error) {
    const authError = asGoogleAuthError(error, false)
    if (authError.code !== 'required' && authError.code !== 'expired') {
      throw authError
    }
  }
  return getAccessToken(true)
}

export async function clearAccessToken(token: string): Promise<void> {
  await chrome.identity.removeCachedAuthToken({ token })
}

async function refreshAccessToken(
  staleToken: string,
  interactive: boolean,
): Promise<string> {
  await clearAccessToken(staleToken)
  try {
    return await getAccessToken(false)
  } catch (error) {
    if (interactive) return getAccessToken(true)
    const detail =
      error instanceof GoogleAuthError ? error.technicalDetail : undefined
    throw new GoogleAuthError(
      'expired',
      publicMessage('expired'),
      detail,
    )
  }
}

export async function connectGooglePhotos(force = false): Promise<void> {
  if (force) await chrome.identity.clearAllCachedAuthTokens()
  await getAccessToken(true)
}

export async function disconnectGooglePhotos(): Promise<void> {
  await chrome.identity.clearAllCachedAuthTokens()
  await setExplicitDisconnect(true)
}

export async function clearAllAccessTokens(): Promise<void> {
  await disconnectGooglePhotos()
}

export async function getGoogleAuthState(): Promise<GoogleAuthState> {
  if (!isOAuthConfigured()) {
    return {
      status: 'error',
      connected: false,
      reason: 'failed',
      message: publicMessage('configuration'),
    }
  }
  if (await explicitDisconnectRequested()) {
    return {
      status: 'disconnected',
      connected: false,
      reason: 'required',
      message: publicMessage('required'),
    }
  }
  try {
    await getAccessToken(false)
    return {
      status: 'connected',
      connected: true,
      message: message('connectedDetail'),
    }
  } catch (error) {
    const authError = asGoogleAuthError(error, false)
    return {
      status:
        authError.code === 'failed' || authError.code === 'unsupported'
          ? 'error'
          : 'disconnected',
      connected: false,
      reason:
        authError.code === 'unsupported'
          ? 'unsupported'
          : authError.code === 'expired'
          ? 'expired'
          : authError.code === 'failed'
            ? 'failed'
            : 'required',
      message: authError.message,
    }
  }
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

  token = await refreshAccessToken(token, interactive)
  response = await run()
  return response
}

export type AuthorizedFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export async function createAuthorizedFetchSession(
  initialToken?: string,
): Promise<AuthorizedFetch> {
  let token = initialToken ?? (await getAccessToken(false))
  let refresh: Promise<string> | undefined

  const refreshToken = async (staleToken: string): Promise<string> => {
    if (token !== staleToken) return token
    if (!refresh) {
      refresh = refreshAccessToken(staleToken, false).finally(() => {
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
