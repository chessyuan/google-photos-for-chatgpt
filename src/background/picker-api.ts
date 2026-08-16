import { PICKER_API_ROOT } from '../shared/constants'
import { ApiError, UserFacingError } from '../shared/errors'
import { message } from '../shared/i18n'
import type {
  MediaItemsResponse,
  PickedMediaItem,
  PickingSession,
} from '../shared/types'

export type AuthorizedFetch = (
  input: string,
  init?: RequestInit,
  interactive?: boolean,
) => Promise<Response>

interface GoogleErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 12_000

async function readError(response: Response): Promise<ApiError> {
  let body: GoogleErrorBody | undefined
  try {
    body = (await response.clone().json()) as GoogleErrorBody
  } catch {
    body = undefined
  }

  const apiStatus = body?.error?.status
  const detail =
    body?.error?.message || response.statusText || 'HTTP ' + response.status
  return new ApiError(
    response.status,
    'Google Photos Picker API ' + response.status + ': ' + detail,
    apiStatus,
  )
}

export class PickerApi {
  constructor(
    private readonly request: AuthorizedFetch,
    private readonly requestTimeoutMilliseconds =
      DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
  ) {}

  private async requestWithTimeout(
    url: string,
    init: RequestInit = {},
    interactive = false,
  ): Promise<Response> {
    const controller = new AbortController()
    const callerSignal = init.signal
    const abortFromCaller = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) abortFromCaller()
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })

    let timeout: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<Response>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new UserFacingError(message('googlePhotosRequestTimedOut')))
      }, this.requestTimeoutMilliseconds)
    })

    try {
      return await Promise.race([
        this.request(
          url,
          { ...init, signal: controller.signal },
          interactive,
        ),
        timedOut,
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }
  }

  private async json<T>(
    url: string,
    init?: RequestInit,
    interactive = false,
  ): Promise<T> {
    const response = await this.requestWithTimeout(url, init, interactive)
    if (!response.ok) throw await readError(response)
    return (await response.json()) as T
  }

  async createSession(
    maxItemCount: number,
    interactive = true,
  ): Promise<PickingSession> {
    return this.json<PickingSession>(
      PICKER_API_ROOT + '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickingConfig: { maxItemCount: String(maxItemCount) },
        }),
      },
      interactive,
    )
  }

  async getSession(sessionId: string): Promise<PickingSession> {
    if (!sessionId) throw new UserFacingError('Picker session ID is missing.')
    return this.json<PickingSession>(
      PICKER_API_ROOT + '/sessions/' + encodeURIComponent(sessionId),
    )
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) return
    const response = await this.requestWithTimeout(
      PICKER_API_ROOT + '/sessions/' + encodeURIComponent(sessionId),
      { method: 'DELETE' },
    )
    if (!response.ok && response.status !== 404) {
      throw await readError(response)
    }
  }

  async listAllMediaItems(sessionId: string): Promise<PickedMediaItem[]> {
    const items: PickedMediaItem[] = []
    const seenTokens = new Set<string>()
    let pageToken: string | undefined

    do {
      const params = new URLSearchParams({
        sessionId,
        pageSize: '100',
      })
      if (pageToken) params.set('pageToken', pageToken)

      const result = await this.json<MediaItemsResponse>(
        PICKER_API_ROOT + '/mediaItems?' + params,
      )
      items.push(...(result.mediaItems ?? []))

      pageToken = result.nextPageToken
      if (pageToken) {
        if (seenTokens.has(pageToken)) {
          throw new UserFacingError(
            'Google Photos Picker returned a repeated pagination token.',
          )
        }
        seenTokens.add(pageToken)
      }
    } while (pageToken)

    return items
  }
}

export function parseGoogleDuration(value: string | undefined): number {
  if (!value) return 0
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim())
  if (!match) {
    throw new UserFacingError('Invalid Google polling duration: ' + value)
  }
  return Number(match[1]) * 1000
}

export function appendAutoclose(pickerUri: string): string {
  const url = new URL(pickerUri)
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/autoclose')
    ? pathname
    : pathname + '/autoclose'
  return url.toString()
}
