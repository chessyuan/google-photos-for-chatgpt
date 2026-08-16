import { GOOGLE_PHOTOS_READINESS_STORAGE_KEY } from '../shared/constants'

export interface GooglePhotosReadiness {
  status: 'ready' | 'error'
  checkedAt: number
  message: string
  validUntil?: string
  diagnosticCode?: string
}

export async function readGooglePhotosReadiness(): Promise<
  GooglePhotosReadiness | undefined
> {
  const stored = await chrome.storage.session.get(
    GOOGLE_PHOTOS_READINESS_STORAGE_KEY,
  )
  return stored[GOOGLE_PHOTOS_READINESS_STORAGE_KEY] as
    | GooglePhotosReadiness
    | undefined
}

export async function markGooglePhotosReady(
  message: string,
  validUntil: string,
): Promise<void> {
  const readiness: GooglePhotosReadiness = {
    status: 'ready',
    checkedAt: Date.now(),
    message,
    validUntil,
  }
  await chrome.storage.session.set({
    [GOOGLE_PHOTOS_READINESS_STORAGE_KEY]: readiness,
  })
}

export async function markGooglePhotosError(
  message: string,
  diagnosticCode?: string,
): Promise<void> {
  const readiness: GooglePhotosReadiness = {
    status: 'error',
    checkedAt: Date.now(),
    message,
    diagnosticCode,
  }
  await chrome.storage.session.set({
    [GOOGLE_PHOTOS_READINESS_STORAGE_KEY]: readiness,
  })
}

export async function clearGooglePhotosReadiness(): Promise<void> {
  await chrome.storage.session.remove(GOOGLE_PHOTOS_READINESS_STORAGE_KEY)
}
