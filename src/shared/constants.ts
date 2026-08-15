export const PICKER_API_ROOT = 'https://photospicker.googleapis.com/v1'
export const PICKER_SCOPE =
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
export const OAUTH_PLACEHOLDER_PREFIX = 'REPLACE_WITH_'
export const CHATGPT_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024
export const DOWNLOAD_CHUNK_BYTES = 256 * 1024
export const DOWNLOAD_CONCURRENCY = 3
export const JOB_STORAGE_KEY = 'gpfcJobs'
export const STANDBY_SESSION_STORAGE_KEY = 'gpfcStandbyPickerSession'
export const STANDBY_SESSION_ALARM = 'gpfcStandbyPickerSessionExpiry'
export const AUTH_DISCONNECTED_STORAGE_KEY = 'gpfcGoogleAuthDisconnected'
export const DEFAULT_MAX_ITEM_COUNT = 50
export const MAX_ITEM_COUNT = 2000
export const JOB_RETENTION_MS = 60 * 60 * 1000

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

export const OPENAI_DOCUMENTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
])
