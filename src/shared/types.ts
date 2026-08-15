import type {
  PerformanceEntry,
  PerformanceTrace,
} from './performance'

export interface PollingConfig {
  pollInterval: string
  timeoutIn: string
}

export interface PickingSession {
  id: string
  pickerUri: string
  pollingConfig?: PollingConfig
  expireTime: string
  mediaItemsSet: boolean
  pickingConfig?: { maxItemCount?: string }
}

export interface StandbyPickerSession {
  sessionId: string
  pickerUri: string
  expireTime: string
  pollingConfig?: PollingConfig
  createdAt: number
  used: boolean
  maxItemCount: number
  pickerTabId?: number
  pickerWindowId?: number
  ready: boolean
  tabStatus?: 'loading' | 'complete'
  preloadPresentation?: 'minimized-popup'
}

export interface MediaFileMetadata {
  width?: number
  height?: number
  photoMetadata?: Record<string, unknown>
  videoMetadata?: {
    processingStatus?: 'UNSPECIFIED' | 'PROCESSING' | 'READY' | 'FAILED'
    [key: string]: unknown
  }
}

export interface PickedMediaItem {
  id: string
  createTime: string
  type: 'PHOTO' | 'VIDEO' | 'TYPE_UNSPECIFIED'
  mediaFile?: {
    baseUrl: string
    mimeType: string
    filename: string
    mediaFileMetadata?: MediaFileMetadata
  }
}

export interface MediaItemsResponse {
  mediaItems?: PickedMediaItem[]
  nextPageToken?: string
}

export type JobStatus =
  | 'authorizing'
  | 'creating_session'
  | 'picking'
  | 'selected'
  | 'ready'
  | 'downloading'
  | 'attaching'
  | 'complete'
  | 'cancelled'
  | 'error'

export type TargetKind = 'chatgpt' | 'test'

export type SessionLifecycleState =
  | 'CREATING'
  | 'READY'
  | 'OPENING'
  | 'VISIBLE'
  | 'WAITING_SELECTION'
  | 'COMPLETING'
  | 'FETCHING_MEDIA'
  | 'METADATA_READY'
  | 'CONSUMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'

export interface PickerJob {
  id: string
  targetTabId: number
  targetKind: TargetKind
  status: JobStatus
  sessionState?: SessionLifecycleState
  message: string
  createdAt: number
  updatedAt: number
  maxItemCount: number
  sessionId?: string
  pickerWindowId?: number
  pickerTabId?: number
  pickerPresentation?: 'popup-window' | 'tab'
  pickerWindowClosedAt?: number
  expireTime?: string
  pollingConfig?: PollingConfig
  mediaItems?: PickedMediaItem[]
  warnings: string[]
  error?: string
  attachment?: AttachmentResult
  performanceTrace?: PerformanceTrace
}

export interface PublicJob {
  id: string
  targetTabId: number
  targetKind: TargetKind
  status: JobStatus
  message: string
  selectedCount: number
  warnings: string[]
  error?: string
  updatedAt: number
  attachment?: AttachmentResult
  performanceTrace?: PerformanceTrace
}

export interface AttachmentResult {
  attempted: number
  method: 'file-input' | 'drag-drop' | 'test-input' | 'none'
  verified: boolean
  detail: string
  performanceEntries?: PerformanceEntry[]
}

export type GoogleAuthStatus =
  | 'connected'
  | 'checking'
  | 'disconnected'
  | 'error'

export interface GoogleAuthState {
  status: GoogleAuthStatus
  connected: boolean
  authorized: boolean
  message: string
  reason?:
    | 'required'
    | 'expired'
    | 'scope'
    | 'api'
    | 'failed'
    | 'unsupported'
  diagnosticCode?: string
}

export type RuntimeRequest =
  | {
      type: 'START_PICKER'
      targetTabId?: number
      targetKind?: TargetKind
      maxItemCount?: number
      clickStartedAt?: number
    }
  | { type: 'WARM_PICKER' }
  | { type: 'GET_JOB'; targetTabId?: number }
  | { type: 'GET_CONFIG' }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'CONNECT_AUTH'; force?: boolean }
  | { type: 'DISCONNECT_AUTH' }
  | { type: 'ATTACH_RESULT'; jobId: string; result: AttachmentResult }
  | { type: 'CANCEL_JOB'; jobId: string }
  | { type: 'CLEAR_AUTH' }

export type RuntimeResponse =
  | {
      ok: true
      job?: PublicJob
      jobId?: string
      extensionId?: string
      clientId?: string
      oauthConfigured?: boolean
      authState?: GoogleAuthState
      pickerOpened?: boolean
      pickerReused?: boolean
      pickerMode?: 'standby' | 'fallback'
    }
  | { ok: false; error: string }

export interface JobStatusMessage {
  type: 'JOB_STATUS'
  targetTabId: number
  job: PublicJob
}

export type DownloadPortMessage =
  | { type: 'START_DOWNLOAD'; supportsBinary?: boolean }
  | {
      type: 'FILE_START'
      index: number
      filename: string
      mimeType: string
      lastModified: number
      expectedSize?: number
    }
  | { type: 'FILE_CHUNK'; index: number; base64: string }
  | {
      type: 'FILE_BLOB'
      index: number
      filename: string
      mimeType: string
      lastModified: number
      blob: Blob
      size: number
    }
  | { type: 'FILE_END'; index: number; size: number }
  | { type: 'FILE_ERROR'; index: number; filename: string; error: string }
  | { type: 'PERF_ENTRIES'; entries: PerformanceEntry[] }
  | { type: 'ALL_DONE'; downloaded: number; skipped: string[] }
  | { type: 'STREAM_ERROR'; error: string }
