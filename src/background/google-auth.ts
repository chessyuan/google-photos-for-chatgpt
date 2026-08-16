import {
  AUTH_DISCONNECTED_STORAGE_KEY,
  OAUTH_PLACEHOLDER_PREFIX,
  PICKER_SCOPE,
  WEB_OAUTH_STORAGE_KEY,
} from '../shared/constants'
import { UserFacingError } from '../shared/errors'
import { message } from '../shared/i18n'
import type { GoogleAuthState } from '../shared/types'
import {
  clearGooglePhotosReadiness,
  readGooglePhotosReadiness,
} from './google-photos-readiness'

export type GoogleAuthErrorCode =
  | 'required'
  | 'cancelled'
  | 'expired'
  | 'scope'
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
  const chromeClientConfigured =
    clientId.endsWith('.apps.googleusercontent.com') &&
    !clientId.startsWith(OAUTH_PLACEHOLDER_PREFIX)
  return chromeClientConfigured || isGoogleAccountChooserConfigured()
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
    case 'scope':
      return message('authorizationScopeMissing')
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

export interface GoogleAuthorization {
  token: string
  grantedScopes: string[]
  accountEmail?: string
  accountKey?: string
  provider: 'chrome-profile' | 'google-chooser'
}

interface StoredWebAuthorization {
  token: string
  grantedScopes: string[]
  expiresAt: number
  selectedAt: number
}

interface RuntimeWebOAuthConfig {
  __GPFC_GOOGLE_WEB_CLIENT_ID__?: string
}

interface ChromeProfileAccount {
  id: string
  email?: string
}

export function getWebOAuthClientId(): string {
  return (
    (globalThis as typeof globalThis & RuntimeWebOAuthConfig)
      .__GPFC_GOOGLE_WEB_CLIENT_ID__?.trim() ?? ''
  )
}

export function isGoogleAccountChooserConfigured(): boolean {
  const clientId = getWebOAuthClientId()
  return (
    clientId.endsWith('.apps.googleusercontent.com') &&
    !clientId.startsWith(OAUTH_PLACEHOLDER_PREFIX)
  )
}

function normalizeTokenResult(
  result: chrome.identity.GetAuthTokenResult | string,
  account?: ChromeProfileAccount,
): GoogleAuthorization {
  const token = typeof result === 'string' ? result : result.token
  if (!token) {
    throw new GoogleAuthError(
      'failed',
      publicMessage('failed'),
      'Chrome Identity returned no access token.',
    )
  }
  const grantedScopes =
    typeof result === 'string' ? undefined : result.grantedScopes
  if (!grantedScopes?.includes(PICKER_SCOPE)) {
    throw new GoogleAuthError(
      'scope',
      publicMessage('scope'),
      grantedScopes
        ? 'Chrome Identity did not grant the required Picker scope.'
        : 'Chrome Identity did not report granted scopes.',
    )
  }
  return {
    token,
    grantedScopes: [...grantedScopes],
    accountEmail: account?.email,
    accountKey: account?.id ? 'chrome:' + account.id : undefined,
    provider: 'chrome-profile',
  }
}

async function getChromeProfileAccount(): Promise<
  ChromeProfileAccount | undefined
> {
  if (typeof chrome.identity.getProfileUserInfo !== 'function') return undefined
  try {
    const profile = await chrome.identity.getProfileUserInfo({
      accountStatus: 'ANY',
    })
    if (!profile.id) return undefined
    return { id: profile.id, email: profile.email || undefined }
  } catch {
    return undefined
  }
}

async function readStoredWebAuthorization(): Promise<
  StoredWebAuthorization | undefined
> {
  const stored = await chrome.storage.session.get(WEB_OAUTH_STORAGE_KEY)
  return stored[WEB_OAUTH_STORAGE_KEY] as StoredWebAuthorization | undefined
}

async function clearStoredWebAuthorization(token?: string): Promise<void> {
  if (token) {
    const current = await readStoredWebAuthorization()
    if (current?.token !== token) return
  }
  await chrome.storage.session.remove(WEB_OAUTH_STORAGE_KEY)
}

async function getStoredWebAuthorization(): Promise<GoogleAuthorization> {
  const stored = await readStoredWebAuthorization()
  if (!stored) {
    throw new GoogleAuthError('required', publicMessage('required'))
  }
  return normalizeWebAuthorization(stored)
}

function normalizeWebAuthorization(
  stored: StoredWebAuthorization,
): GoogleAuthorization {
  if (!stored.grantedScopes.includes(PICKER_SCOPE)) {
    throw new GoogleAuthError(
      'scope',
      publicMessage('scope'),
      'Google OAuth did not grant the required Picker scope.',
    )
  }
  if (!stored.token || stored.expiresAt <= Date.now() + 30_000) {
    throw new GoogleAuthError(
      'expired',
      publicMessage('expired'),
      'The account-chooser access token is missing or expired.',
    )
  }
  return {
    token: stored.token,
    grantedScopes: [...stored.grantedScopes],
    accountKey: 'chooser:' + stored.selectedAt,
    provider: 'google-chooser',
  }
}

function oauthResponseParameters(url: URL): URLSearchParams {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  if (fragment.size > 0) return fragment
  return url.searchParams
}

async function authorizeWithGoogleAccountChooser(): Promise<GoogleAuthorization> {
  const clientId = getWebOAuthClientId()
  if (!isGoogleAccountChooserConfigured()) {
    throw new GoogleAuthError(
      'configuration',
      publicMessage('configuration'),
      'A Web application OAuth Client ID is required for account selection.',
    )
  }

  const redirectUri = chrome.identity.getRedirectURL()
  const state = crypto.randomUUID()
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('response_type', 'token')
  authorizationUrl.searchParams.set('scope', PICKER_SCOPE)
  authorizationUrl.searchParams.set('prompt', 'select_account')
  authorizationUrl.searchParams.set('include_granted_scopes', 'false')
  authorizationUrl.searchParams.set('state', state)

  let redirectedTo: string | undefined
  try {
    redirectedTo = await chrome.identity.launchWebAuthFlow({
      url: authorizationUrl.toString(),
      interactive: true,
    })
  } catch (error) {
    throw asGoogleAuthError(error, true)
  }
  if (!redirectedTo) {
    throw new GoogleAuthError('cancelled', publicMessage('cancelled'))
  }

  const resultUrl = new URL(redirectedTo)
  const redirectUrl = new URL(redirectUri)
  if (resultUrl.origin !== redirectUrl.origin) {
    throw new GoogleAuthError(
      'failed',
      publicMessage('failed'),
      'Google OAuth returned to an unexpected origin.',
    )
  }
  const response = oauthResponseParameters(resultUrl)
  if (response.get('state') !== state) {
    throw new GoogleAuthError(
      'failed',
      publicMessage('failed'),
      'Google OAuth state verification failed.',
    )
  }
  const oauthError = response.get('error')
  if (oauthError) {
    const code = oauthError === 'access_denied' ? 'cancelled' : 'failed'
    throw new GoogleAuthError(
      code,
      publicMessage(code),
      'Google OAuth error: ' + oauthError,
    )
  }

  const token = response.get('access_token') ?? ''
  const grantedScopes = (response.get('scope') ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const expiresIn = Number(response.get('expires_in'))
  if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new GoogleAuthError(
      'failed',
      publicMessage('failed'),
      'Google OAuth returned an incomplete access token response.',
    )
  }

  const stored: StoredWebAuthorization = {
    token,
    grantedScopes,
    expiresAt: Date.now() + expiresIn * 1000,
    selectedAt: Date.now(),
  }
  const authorization = normalizeWebAuthorization(stored)
  await chrome.storage.session.set({ [WEB_OAUTH_STORAGE_KEY]: stored })
  return authorization
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

export async function getGoogleAuthorization(
  interactive: boolean,
): Promise<GoogleAuthorization> {
  if (!isOAuthConfigured()) {
    throw new GoogleAuthError(
      'configuration',
      publicMessage('configuration'),
    )
  }
  if (!interactive && (await explicitDisconnectRequested())) {
    throw new GoogleAuthError('required', publicMessage('required'))
  }

  if (isGoogleAccountChooserConfigured()) {
    try {
      const authorization = interactive
        ? await authorizeWithGoogleAccountChooser()
        : await getStoredWebAuthorization()
      await setExplicitDisconnect(false)
      return authorization
    } catch (error) {
      throw asGoogleAuthError(error, interactive)
    }
  }

  try {
    const account = await getChromeProfileAccount()
    const details: chrome.identity.TokenDetails = {
      interactive,
      enableGranularPermissions: true,
      scopes: [PICKER_SCOPE],
    }
    if (account?.id) details.account = { id: account.id }
    const result = await chrome.identity.getAuthToken(details)
    const authorization = normalizeTokenResult(result, account)
    await setExplicitDisconnect(false)
    return authorization
  } catch (error) {
    throw asGoogleAuthError(error, interactive)
  }
}

export async function getAccessToken(interactive: boolean): Promise<string> {
  return (await getGoogleAuthorization(interactive)).token
}

export async function getAuthorizationForUserAction(): Promise<
  GoogleAuthorization
> {
  try {
    return await getGoogleAuthorization(false)
  } catch (error) {
    const authError = asGoogleAuthError(error, false)
    if (authError.code !== 'required' && authError.code !== 'expired') {
      throw authError
    }
  }
  return getGoogleAuthorization(true)
}

export async function getAccessTokenForUserAction(): Promise<string> {
  return (await getAuthorizationForUserAction()).token
}

export async function clearAccessToken(token: string): Promise<void> {
  if (isGoogleAccountChooserConfigured()) {
    await clearStoredWebAuthorization(token)
    return
  }
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
  if (force) {
    if (isGoogleAccountChooserConfigured()) {
      await clearStoredWebAuthorization()
    } else {
      await chrome.identity.clearAllCachedAuthTokens()
    }
  }
  await clearGooglePhotosReadiness()
  await getGoogleAuthorization(true)
}

export async function disconnectGooglePhotos(): Promise<void> {
  if (isGoogleAccountChooserConfigured()) {
    const authorization = await readStoredWebAuthorization()
    await clearStoredWebAuthorization()
    if (authorization?.token) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: authorization.token }),
        })
      } catch {
        // Local disconnect must still succeed if Google's revoke endpoint is offline.
      }
    }
  } else {
    await chrome.identity.clearAllCachedAuthTokens()
  }
  await clearGooglePhotosReadiness()
  await setExplicitDisconnect(true)
}

export async function clearAllAccessTokens(): Promise<void> {
  await disconnectGooglePhotos()
}

export async function getGoogleAuthState(): Promise<GoogleAuthState> {
  const accountSelection: GoogleAuthState['accountSelection'] =
    isGoogleAccountChooserConfigured()
    ? 'google-chooser'
    : 'chrome-profile'
  if (!isOAuthConfigured()) {
    return {
      status: 'error',
      connected: false,
      authorized: false,
      reason: 'failed',
      message: publicMessage('configuration'),
      accountSelection,
    }
  }
  if (await explicitDisconnectRequested()) {
    return {
      status: 'disconnected',
      connected: false,
      authorized: false,
      reason: 'required',
      message: publicMessage('required'),
      accountSelection,
    }
  }
  try {
    const authorization = await getGoogleAuthorization(false)
    const account = {
      accountEmail: authorization.accountEmail,
      accountKey: authorization.accountKey,
      accountSelection,
    }
    const readiness = await readGooglePhotosReadiness()
    const readinessExpiresAt = readiness?.validUntil
      ? Date.parse(readiness.validUntil)
      : Number.NaN
    if (
      readiness?.status === 'ready' &&
      Number.isFinite(readinessExpiresAt) &&
      readinessExpiresAt > Date.now()
    ) {
      return {
        status: 'connected',
        connected: true,
        authorized: true,
        message: readiness.message || message('pickerReadyDetail'),
        ...account,
      }
    }
    if (readiness?.status === 'error') {
      return {
        status: 'error',
        connected: false,
        authorized: true,
        reason: 'api',
        message: readiness.message,
        diagnosticCode: readiness.diagnosticCode,
        ...account,
      }
    }
    return {
      status: 'checking',
      connected: false,
      authorized: true,
      message: message('checkingGooglePhotosAccess'),
      ...account,
    }
  } catch (error) {
    const authError = asGoogleAuthError(error, false)
    const reason: NonNullable<GoogleAuthState['reason']> =
      authError.code === 'unsupported'
        ? 'unsupported'
        : authError.code === 'scope'
          ? 'scope'
          : authError.code === 'expired'
            ? 'expired'
            : authError.code === 'failed'
              ? 'failed'
              : 'required'
    return {
      status:
        authError.code === 'failed' ||
        authError.code === 'unsupported' ||
        authError.code === 'scope'
          ? 'error'
          : 'disconnected',
      connected: false,
      authorized: false,
      reason,
      message: authError.message,
      accountSelection,
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
