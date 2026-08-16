import {
  DEFAULT_MAX_ITEM_COUNT,
  MAX_ITEM_COUNT,
  OPENAI_DOCUMENTED_IMAGE_MIME_TYPES,
  STANDBY_SESSION_ALARM,
  SUPPORTED_IMAGE_MIME_TYPES,
} from './shared/constants'
import { ApiError, errorMessage, UserFacingError } from './shared/errors'
import type {
  DownloadPortMessage,
  JobStatus,
  JobStatusMessage,
  PickerJob,
  RuntimeRequest,
  RuntimeResponse,
  StandbyPickerSession,
  TargetKind,
} from './shared/types'
import {
  debugEpochLatency,
  debugEpochTimestamp,
  debugEvent,
  debugLatency,
} from './shared/debug'
import { CompletionCoordinator } from './background/completion-coordinator'
import { streamJobToPort } from './background/download-stream'
import {
  authorizedFetch,
  connectGooglePhotos,
  createAuthorizedFetchSession,
  disconnectGooglePhotos,
  getAccessToken,
  getAccessTokenForUserAction,
  getGoogleAuthState,
  getManifestClientId,
  isOAuthConfigured,
} from './background/google-auth'
import {
  markGooglePhotosError,
  markGooglePhotosReady,
} from './background/google-photos-readiness'
import { authorizeAndCreatePickerSession } from './background/picker-authorization'
import {
  getAllJobs,
  getJob,
  getLatestJobForTab,
  loadJobs,
  publicJob,
  putJob,
} from './background/job-store'
import {
  appendAutoclose,
  parseGoogleDuration,
  PickerApi,
} from './background/picker-api'
import { pickerCloseIsSettled } from './background/picker-lifecycle'
import { pickerStartDisposition } from './background/picker-start'
import { SingleFlight } from './background/single-flight'
import { transitionSessionState } from './background/session-state'
import {
  clearStandbyPreloadState,
  consumeStandbyAfterCreation,
  readStandbySession,
  removeStandbySession,
  standbyFromPickingSession,
  standbyIsUsable,
  withStandbySessionLock,
  writeStandbySession,
} from './background/standby-session'
import {
  createPerformanceTrace,
  epochPerformanceNow,
  hasPerformancePoint,
  markPerformance,
  performancePoints,
} from './shared/performance'
import { message } from './shared/i18n'

const pickerApi = new PickerApi(authorizedFetch)
const activePolls = new Set<string>()
const finalizationFlight = new SingleFlight()
const activePickerApis = new Map<string, Promise<PickerApi>>()
const activePickerStartsByTab = new Map<number, PickerJob>()
const completionCoordinator = new CompletionCoordinator()
const completionProbesUsed = new Set<string>()
const activeStreams = new Map<string, AbortController>()
let standbyCreation: Promise<void> | undefined
let standbyReplaceRequested = false
let lastPrewarmMissReason: 'auth unavailable' | undefined
const terminalStatuses = new Set<JobStatus>([
  'complete',
  'cancelled',
  'error',
])

function pickerDiagnosticCode(error: unknown): string {
  if (error instanceof ApiError) {
    const apiStatus = error.apiStatus?.replace(/[^A-Z0-9_]/gi, '_')
    return (
      'PICKER_API_HTTP_' +
      error.status +
      (apiStatus ? '_' + apiStatus : '')
    )
  }
  if (
    error instanceof UserFacingError &&
    error.message === message('googlePhotosRequestTimedOut')
  ) {
    return 'PICKER_API_TIMEOUT'
  }
  if (error instanceof TypeError) return 'PICKER_API_NETWORK_ERROR'
  return 'PICKER_API_REQUEST_FAILED'
}

async function recordPickerApiError(error: unknown): Promise<void> {
  try {
    await markGooglePhotosError(
      friendlyError(error),
      pickerDiagnosticCode(error),
    )
  } catch (storageError) {
    debugEvent('could not persist Picker readiness error', {
      error: errorMessage(storageError),
    })
  }
}

function transitionJobSession(
  job: PickerJob,
  next: NonNullable<PickerJob['sessionState']>,
): void {
  job.sessionState = transitionSessionState(job.sessionState, next)
}

function pickerApiForJob(jobId: string): Promise<PickerApi> {
  let api = activePickerApis.get(jobId)
  if (!api) {
    api = createAuthorizedFetchSession().then(
      (fetchSession) => new PickerApi(fetchSession),
    )
    activePickerApis.set(jobId, api)
  }
  return api
}

async function cancelOrphanedPickerStart(job: PickerJob): Promise<boolean> {
  if (
    (job.status !== 'authorizing' && job.status !== 'creating_session') ||
    activePickerStartsByTab.get(job.targetTabId)?.id === job.id
  ) {
    return false
  }
  transitionJobSession(job, 'CANCELLED')
  job.status = 'cancelled'
  job.message = message('pickerOpeningInterrupted')
  await putJob(job)
  await closePickerWindow(job)
  await cleanupSession(job)
  return true
}

async function standbyBelongsToActiveJob(
  standby: StandbyPickerSession,
): Promise<boolean> {
  return (await getAllJobs()).some(
    (job) =>
      job.sessionId === standby.sessionId &&
      !terminalStatuses.has(job.status),
  )
}

async function scheduleStandbyExpiry(
  standby: StandbyPickerSession,
): Promise<void> {
  const expireAt = Date.parse(standby.expireTime)
  if (!Number.isFinite(expireAt) || expireAt <= Date.now()) return
  await chrome.alarms.create(STANDBY_SESSION_ALARM, { when: expireAt })
}

async function discardStandbySession(
  expectedSessionId?: string,
): Promise<void> {
  const removed = await withStandbySessionLock(async () => {
    const current = await readStandbySession()
    if (
      !current ||
      (expectedSessionId !== undefined &&
        current.sessionId !== expectedSessionId)
    ) {
      return undefined
    }
    await removeStandbySession()
    return current
  })
  if (!removed) return
  await chrome.alarms.clear(STANDBY_SESSION_ALARM)
  if (
    removed.preloadPresentation === 'minimized-popup' &&
    removed.pickerWindowId !== undefined
  ) {
    try {
      await chrome.windows.remove(removed.pickerWindowId)
    } catch {
      // The minimized preload window may already have been closed.
    }
  } else if (removed.pickerTabId !== undefined) {
    try {
      await chrome.tabs.remove(removed.pickerTabId)
    } catch {
      // A legacy preloaded tab may already have been closed.
    }
  }
  try {
    await pickerApi.deleteSession(removed.sessionId)
  } catch {
    // Standby cleanup is best effort; Google also expires sessions server-side.
  }
}

async function retirePreloadedPicker(): Promise<void> {
  let pickerWindowId: number | undefined
  let pickerTabId: number | undefined
  await withStandbySessionLock(async () => {
    const current = await readStandbySession()
    if (
      !current ||
      current.used ||
      (current.pickerTabId === undefined && current.pickerWindowId === undefined)
    ) {
      return
    }
    pickerWindowId = current.pickerWindowId
    pickerTabId = current.pickerTabId
    await writeStandbySession(clearStandbyPreloadState(current))
  })

  if (pickerWindowId !== undefined) {
    try {
      await chrome.windows.remove(pickerWindowId)
    } catch {
      // A preloaded popup from an older build may already be closed.
    }
  } else if (pickerTabId !== undefined) {
    try {
      await chrome.tabs.remove(pickerTabId)
    } catch {
      // A preloaded tab from an older build may already be closed.
    }
  }
}

async function createStandbySession(replaceUsed: boolean): Promise<void> {
  await retirePreloadedPicker()
  let current = await withStandbySessionLock(readStandbySession)
  if (
    current?.used &&
    replaceUsed &&
    (await standbyBelongsToActiveJob(current))
  ) {
    const consumedSessionId = current.sessionId
    await withStandbySessionLock(async () => {
      const stored = await readStandbySession()
      if (stored?.sessionId === consumedSessionId && stored.used) {
        await removeStandbySession()
      }
    })
    current = undefined
  }
  if (current && standbyIsUsable(current, DEFAULT_MAX_ITEM_COUNT)) {
    await markGooglePhotosReady(
      message('pickerReadyDetail'),
      current.expireTime,
    )
    await scheduleStandbyExpiry(current)
    return
  }
  if (
    current?.used &&
    !replaceUsed &&
    (await standbyBelongsToActiveJob(current))
  ) {
    return
  }
  if (current) await discardStandbySession(current.sessionId)

  let accessToken: string
  const authStartedAt = performance.now()
  try {
    accessToken = await getAccessToken(false)
  } catch {
    lastPrewarmMissReason = 'auth unavailable'
    return
  } finally {
    debugLatency('auth token latency', authStartedAt)
  }
  lastPrewarmMissReason = undefined

  let session
  const createStartedAt = performance.now()
  try {
    const standbyApi = new PickerApi(
      await createAuthorizedFetchSession(accessToken),
    )
    session = await standbyApi.createSession(DEFAULT_MAX_ITEM_COUNT, false)
    await markGooglePhotosReady(
      message('pickerReadyDetail'),
      session.expireTime,
    )
  } catch (error) {
    await recordPickerApiError(error)
    throw error
  } finally {
    debugLatency('session create latency', createStartedAt)
  }

  const standby = standbyFromPickingSession(
    session,
    DEFAULT_MAX_ITEM_COUNT,
  )
  let duplicate = false
  await withStandbySessionLock(async () => {
    const existing = await readStandbySession()
    if (standbyIsUsable(existing, DEFAULT_MAX_ITEM_COUNT)) {
      duplicate = true
      return
    }
    await writeStandbySession(standby)
  })
  if (duplicate) {
    try {
      await pickerApi.deleteSession(standby.sessionId)
    } catch {
      // The unused duplicate will expire if cleanup is unavailable.
    }
  } else {
    await scheduleStandbyExpiry(standby)
  }
}

async function prewarmStandbySession(replaceUsed = false): Promise<void> {
  if (standbyCreation) {
    if (replaceUsed) standbyReplaceRequested = true
    return standbyCreation
  }
  standbyCreation = createStandbySession(replaceUsed)
    .catch((error) => {
      // Prewarming is opportunistic and must never affect the normal Picker flow.
      debugEvent('standby session prewarm failed', {
        error: friendlyError(error),
      })
    })
    .finally(() => {
      standbyCreation = undefined
      if (standbyReplaceRequested) {
        standbyReplaceRequested = false
        scheduleStandbyPrewarm(true)
      }
    })
  return standbyCreation
}

function scheduleStandbyPrewarm(replaceUsed = false): void {
  void prewarmStandbySession(replaceUsed)
}

async function takeStandbySession(
  maxItemCount: number,
): Promise<{
  standby?: StandbyPickerSession
  missReason?: string
}> {
  await retirePreloadedPicker()
  const result = await consumeStandbyAfterCreation(
    maxItemCount,
    standbyCreation,
  )
  debugEvent('chrome.storage.session read latency', {
    milliseconds: Number(result.storageReadMilliseconds.toFixed(1)),
  })
  if (result.standby) {
    void chrome.alarms.clear(STANDBY_SESSION_ALARM)
    debugEvent('standby hit', { mode: 'standby' })
    return { standby: result.standby }
  }
  const missReason =
    result.missReason === 'no session' && standbyCreation
      ? 'prewarm still running'
      : result.missReason === 'no session' && lastPrewarmMissReason
        ? lastPrewarmMissReason
        : result.missReason ?? 'no session'
  debugEvent('standby miss', { reason: missReason })
  return { missReason }
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return message('authorizationExpired')
    }
    if (error.status === 403) {
      return message('googlePhotosPermissionDenied')
    }
    if (error.apiStatus === 'FAILED_PRECONDITION') {
      return message('googlePhotosServiceUnavailable')
    }
    if (error.apiStatus === 'RESOURCE_EXHAUSTED') {
      return message('googlePhotosServiceUnavailable')
    }
  }
  return errorMessage(error)
}

function statusBadge(status: JobStatus, selectedCount: number): string {
  if (status === 'error') return '!'
  if (status === 'complete') return '✓'
  if (status === 'ready' || status === 'downloading' || status === 'attaching') {
    return selectedCount > 99 ? '99+' : String(selectedCount || '•')
  }
  if (status === 'cancelled') return ''
  return '…'
}

async function notifyJob(job: PickerJob): Promise<void> {
  const visible = publicJob(job)
  const message: JobStatusMessage = {
    type: 'JOB_STATUS',
    targetTabId: job.targetTabId,
    job: visible,
  }

  try {
    await chrome.action.setBadgeBackgroundColor({
      tabId: job.targetTabId,
      color: job.status === 'error' ? '#b91c1c' : '#2563eb',
    })
    await chrome.action.setBadgeText({
      tabId: job.targetTabId,
      text: statusBadge(job.status, visible.selectedCount),
    })
  } catch {
    // The target tab may have closed. The persisted popup status remains.
  }

  try {
    if (job.targetKind === 'chatgpt') {
      await chrome.tabs.sendMessage(job.targetTabId, message)
    } else {
      await chrome.runtime.sendMessage(message)
    }
  } catch {
    // Content scripts can be absent during navigation. They query the job on load.
  }
}

async function updateJob(
  job: PickerJob,
  status: JobStatus,
  message: string,
): Promise<void> {
  job.status = status
  job.message = message
  await putJob(job)
  await notifyJob(job)
}

async function closePickerWindow(job: PickerJob): Promise<void> {
  if (job.pickerPresentation === 'tab' && job.pickerTabId !== undefined) {
    try {
      await chrome.tabs.remove(job.pickerTabId)
    } catch {
      // The /autoclose Picker usually closed itself already.
    }
  } else if (job.pickerWindowId !== undefined) {
    try {
      await chrome.windows.remove(job.pickerWindowId)
    } catch {
      // The /autoclose Picker usually closed itself already.
    }
  } else if (job.pickerTabId !== undefined) {
    try {
      await chrome.tabs.remove(job.pickerTabId)
    } catch {
      // The Picker tab is already gone.
    }
  }
  job.pickerWindowId = undefined
  job.pickerTabId = undefined
  job.pickerPresentation = undefined
}

async function focusTargetTab(job: PickerJob): Promise<void> {
  try {
    const tab = await chrome.tabs.get(job.targetTabId)
    if (!tab.active) {
      await chrome.tabs.update(job.targetTabId, { active: true })
    }
    if (tab.windowId !== chrome.windows.WINDOW_ID_NONE) {
      const targetWindow = await chrome.windows.get(tab.windowId)
      if (!targetWindow.focused) {
        await chrome.windows.update(tab.windowId, { focused: true })
      }
    }
  } catch {
    // The target tab may have closed while the Picker was open.
  }
}

async function reconcilePickerWindow(job: PickerJob): Promise<void> {
  if (job.pickerWindowClosedAt !== undefined) {
    return
  }
  try {
    if (job.pickerTabId !== undefined) {
      await chrome.tabs.get(job.pickerTabId)
    } else if (job.pickerWindowId !== undefined) {
      await chrome.windows.get(job.pickerWindowId)
    } else {
      return
    }
  } catch {
    job.pickerWindowId = undefined
    job.pickerTabId = undefined
    job.pickerPresentation = undefined
    markPickerClosed(job)
    requestCompletionCheck(job)
    await putJob(job)
  }
}

async function cleanupSession(job: PickerJob): Promise<void> {
  if (!job.sessionId) return
  try {
    await pickerApi.deleteSession(job.sessionId)
    job.sessionId = undefined
    if (job.status === 'cancelled') transitionJobSession(job, 'CANCELLED')
    else if (job.status !== 'error') transitionJobSession(job, 'CONSUMED')
    await putJob(job)
  } catch (error) {
    job.warnings.push(
      'Session cleanup failed; Google will expire it automatically: ' +
        friendlyError(error),
    )
    await putJob(job)
  }
  scheduleStandbyPrewarm(true)
}

async function failJob(job: PickerJob, error: unknown): Promise<void> {
  job.error = friendlyError(error)
  if (
    !job.sessionState ||
    !['CONSUMED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(
      job.sessionState,
    )
  ) {
    transitionJobSession(job, 'FAILED')
  }
  await updateJob(job, 'error', job.error)
  await closePickerWindow(job)
  await focusTargetTab(job)
  await cleanupSession(job)
}

async function targetTabExists(job: PickerJob): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(job.targetTabId)
    if (job.targetKind === 'chatgpt') {
      return Boolean(tab.url?.startsWith('https://chatgpt.com/'))
    }
    return true
  } catch {
    return false
  }
}

function filterPickedImages(job: PickerJob, allItems: PickerJob['mediaItems']) {
  const valid = []
  const seenIds = new Set<string>()
  for (const item of allItems ?? []) {
    const mediaFile = item.mediaFile
    const mimeType = mediaFile?.mimeType?.toLowerCase() ?? ''
    const filename = mediaFile?.filename || item.id

    if (
      item.type === 'VIDEO' ||
      !mimeType.startsWith('image/') ||
      !mediaFile?.baseUrl
    ) {
      job.warnings.push(filename + ': skipped because it is not a downloadable image.')
      continue
    }

    if (seenIds.has(item.id)) {
      job.warnings.push(filename + ': duplicate Picker result was ignored.')
      continue
    }
    seenIds.add(item.id)

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      job.warnings.push(
        filename + ': uncommon image MIME type ' + mimeType + '; ChatGPT may reject it.',
      )
    } else if (mimeType === 'image/gif') {
      job.warnings.push(
        filename +
          ': OpenAI currently documents non-animated GIF only; animated GIF may be rejected.',
      )
    } else if (!OPENAI_DOCUMENTED_IMAGE_MIME_TYPES.has(mimeType)) {
      job.warnings.push(
        filename +
          ': compatibility mode — OpenAI currently documents PNG, JPEG, and non-animated GIF, so ChatGPT may reject ' +
          mimeType +
          '.',
      )
    }
    valid.push(item)
  }
  return valid
}

function markPickerClosed(job: PickerJob): void {
  const closedAt = epochPerformanceNow()
  job.pickerWindowClosedAt = closedAt
  if (
    !hasPerformancePoint(
      job.performanceTrace,
      performancePoints.pickerDoneDetected,
    )
  ) {
    markPerformance(
      job.performanceTrace,
      performancePoints.pickerDoneDetected,
      { note: 'inferred from official /autoclose tab or window close' },
      closedAt,
    )
  }
  if (
    !hasPerformancePoint(
      job.performanceTrace,
      performancePoints.pickerClosedDetected,
    )
  ) {
    markPerformance(
      job.performanceTrace,
      performancePoints.pickerClosedDetected,
      undefined,
      closedAt,
    )
  }
}

function requestCompletionCheck(job: PickerJob): void {
  completionCoordinator.request(job.id)
  if (!activePolls.has(job.id)) void pollSession(job)
}

async function finalizeSelection(job: PickerJob): Promise<void> {
  const finalization = finalizationFlight.run(job.id, async () => {
    if (!job.sessionId) {
      throw new UserFacingError('Picker session is missing during completion.')
    }
    job.pickerWindowClosedAt = undefined
    transitionJobSession(job, 'COMPLETING')
    job.status = 'selected'
    job.message = 'Selection complete. Reading selected media metadata…'
    const selectionPersistence = putJob(job)
    void notifyJob(job)
    const restoreTarget = (async () => {
      await closePickerWindow(job)
      if (
        !hasPerformancePoint(
          job.performanceTrace,
          performancePoints.pickerClosedDetected,
        )
      ) {
        markPerformance(
          job.performanceTrace,
          performancePoints.pickerClosedDetected,
          { note: 'Picker closed after session completion was detected' },
        )
      }
      await focusTargetTab(job)
    })()

    transitionJobSession(job, 'FETCHING_MEDIA')
    markPerformance(job.performanceTrace, performancePoints.mediaListStart)
    const api = await pickerApiForJob(job.id)
    const mediaItemsPromise = api.listAllMediaItems(job.sessionId).then((items) => {
      markPerformance(job.performanceTrace, performancePoints.mediaListResponse)
      return items
    })
    const [allItems] = await Promise.all([
      mediaItemsPromise,
      selectionPersistence,
      restoreTarget,
    ])
    job.mediaItems = filterPickedImages(job, allItems)
    markPerformance(job.performanceTrace, performancePoints.mediaMetadataReady, {
      note: String(job.mediaItems.length) + ' unique image item(s)',
    })

    if (job.mediaItems.length === 0) {
      throw new UserFacingError(
        allItems.length === 0
          ? 'The Picker completed without any selected photos.'
          : 'No selected item is an image that can be sent to ChatGPT.',
      )
    }

    if (!(await targetTabExists(job))) {
      throw new UserFacingError(
        'The target ChatGPT page no longer exists. Open ChatGPT and start again.',
      )
    }

    transitionJobSession(job, 'METADATA_READY')
    job.status = 'ready'
    job.message =
      String(job.mediaItems.length) +
      ' photo(s) selected. Downloading directly into memory…'
    const readyPersistence = putJob(job)
    await notifyJob(job)
    await readyPersistence
  })
  try {
    await finalization
  } finally {
    if (!activePolls.has(job.id)) activePickerApis.delete(job.id)
  }
}

async function pollSession(job: PickerJob): Promise<void> {
  if (activePolls.has(job.id) || !job.sessionId) return
  activePolls.add(job.id)

  try {
    const api = await pickerApiForJob(job.id)
    const apiTimeout = parseGoogleDuration(job.pollingConfig?.timeoutIn)
    const expireAt = job.expireTime ? Date.parse(job.expireTime) : 0
    const fallbackDeadline = Date.now() + (apiTimeout || 10 * 60 * 1000)
    const deadline =
      expireAt > Date.now()
        ? Math.min(expireAt, fallbackDeadline)
        : fallbackDeadline

    while (Date.now() < deadline) {
      const configuredInterval = parseGoogleDuration(
        job.pollingConfig?.pollInterval,
      )
      const interval = configuredInterval > 0 ? configuredInterval : 2000
      const wakeReason = await completionCoordinator.wait(job.id, interval)
      if (wakeReason === 'completion') {
        if (completionProbesUsed.has(job.id)) continue
        completionProbesUsed.add(job.id)
        markPerformance(
          job.performanceTrace,
          performancePoints.completionFastPathStart,
        )
      }

      markPerformance(job.performanceTrace, performancePoints.sessionGetStart)
      const session = await api.getSession(job.sessionId)
      markPerformance(job.performanceTrace, performancePoints.sessionGetResponse)
      job.pollingConfig = session.pollingConfig
      job.expireTime = session.expireTime

      if (session.mediaItemsSet) {
        if (
          !hasPerformancePoint(
            job.performanceTrace,
            performancePoints.pickerDoneDetected,
          )
        ) {
          markPerformance(
            job.performanceTrace,
            performancePoints.pickerDoneDetected,
            { note: 'detected by official session polling' },
          )
        }
        markPerformance(job.performanceTrace, performancePoints.mediaItemsSet)
        await finalizeSelection(job)
        return
      }

      await reconcilePickerWindow(job)
      if (
        pickerCloseIsSettled(
          job.pickerWindowClosedAt,
          Date.now(),
          interval,
        )
      ) {
        transitionJobSession(job, 'CANCELLED')
        await updateJob(
          job,
          'cancelled',
          'Google Photos Picker was closed before a selection was completed.',
        )
        await closePickerWindow(job)
        await focusTargetTab(job)
        await cleanupSession(job)
        return
      }

      await updateJob(
        job,
        'picking',
        'Google Photos Picker is open. Choose one or more photos and click Done.',
      )
    }

    if (expireAt > 0 && Date.now() >= expireAt) {
      transitionJobSession(job, 'EXPIRED')
    }
    throw new UserFacingError(
      'Google Photos Picker timed out before the selection was completed.',
    )
  } catch (error) {
    if (!terminalStatuses.has(job.status)) await failJob(job, error)
  } finally {
    activePolls.delete(job.id)
    completionCoordinator.clear(job.id)
    completionProbesUsed.delete(job.id)
    activePickerApis.delete(job.id)
  }
}

function observePickerTabForClick(
  tab: chrome.tabs.Tab,
  clickStartedAt?: number,
): void {
  if (tab.id === undefined) return
  const tabId = tab.id
  let loadingLogged = false

  const logLoading = () => {
    if (loadingLogged) return
    loadingLogged = true
    debugEpochTimestamp('Picker tab status=loading')
  }
  const logComplete = () => {
    debugEpochTimestamp('Picker tab status=complete')
    debugEpochLatency('click → picker tab complete', clickStartedAt)
  }

  if (tab.status === 'complete') {
    logComplete()
    return
  }
  logLoading()

  const onUpdated = (
    updatedTabId: number,
    changeInfo: { status?: string },
  ) => {
    if (updatedTabId !== tabId) return
    if (changeInfo.status === 'loading') logLoading()
    if (changeInfo.status === 'complete') {
      cleanup()
      logComplete()
    }
  }
  const onRemoved = (removedTabId: number) => {
    if (removedTabId !== tabId) return
    cleanup()
  }
  const cleanup = () => {
    chrome.tabs.onUpdated.removeListener(onUpdated)
    chrome.tabs.onRemoved.removeListener(onRemoved)
  }
  chrome.tabs.onUpdated.addListener(onUpdated)
  chrome.tabs.onRemoved.addListener(onRemoved)
}

async function focusExistingPicker(
  job: PickerJob,
  clickStartedAt?: number,
): Promise<boolean> {
  try {
    if (job.pickerTabId !== undefined) {
      const tab = await chrome.tabs.get(job.pickerTabId)
      markPerformance(job.performanceTrace, performancePoints.pickerActivateStart)
      if (!tab.active) {
        await chrome.tabs.update(job.pickerTabId, { active: true })
      }
      if (tab.windowId !== chrome.windows.WINDOW_ID_NONE) {
        const pickerWindow = await chrome.windows.get(tab.windowId)
        if (!pickerWindow.focused) {
          await chrome.windows.update(tab.windowId, { focused: true })
        }
      }
      markPerformance(job.performanceTrace, performancePoints.pickerVisible)
      observePickerTabForClick(tab, clickStartedAt)
      debugEpochLatency('click → existing Picker focused', clickStartedAt)
      return true
    }
    if (job.pickerWindowId !== undefined) {
      await chrome.windows.update(job.pickerWindowId, { focused: true })
      debugEpochLatency('click → existing Picker focused', clickStartedAt)
      return true
    }
  } catch {
    return false
  }
  return false
}

async function openPickerWindow(
  job: PickerJob,
  pickerUri: string,
  clickStartedAt?: number,
): Promise<void> {
  transitionJobSession(job, 'OPENING')
  markPerformance(job.performanceTrace, performancePoints.pickerActivateStart)
  debugEpochTimestamp('chrome.windows.create start')
  debugEpochLatency('click → picker navigation started', clickStartedAt)
  const pickerWindow = await chrome.windows.create({
    url: pickerUri,
    type: 'popup',
    focused: true,
    width: 1180,
    height: 820,
  })
  if (!pickerWindow || pickerWindow.id === undefined) {
    throw new UserFacingError(
      'The browser blocked the Google Photos Picker window.',
    )
  }
  debugEpochLatency('click → window created', clickStartedAt)
  markPerformance(job.performanceTrace, performancePoints.pickerVisible)
  transitionJobSession(job, 'VISIBLE')
  job.pickerWindowId = pickerWindow.id
  job.pickerPresentation = 'popup-window'
  const pickerTab = pickerWindow.tabs?.[0]
  if (pickerTab?.id !== undefined) {
    job.pickerTabId = pickerTab.id
    observePickerTabForClick(pickerTab, clickStartedAt)
  } else {
    void chrome.tabs
      .query({ windowId: pickerWindow.id })
      .then(([tab]) => {
        if (tab) observePickerTabForClick(tab, clickStartedAt)
      })
      .catch(() => {
        // Window creation was already confirmed; tab timing is debug-only.
      })
  }
}

async function beginPicker(
  job: PickerJob,
  clickStartedAt?: number,
  standby?: StandbyPickerSession,
): Promise<'standby' | 'fallback'> {
  try {
    let pickerUri = standby?.pickerUri
    const pickerMode: 'standby' | 'fallback' = standby ? 'standby' : 'fallback'
    if (!pickerUri) {
      const session = await authorizeAndCreatePickerSession(
        async () => {
          const authStartedAt = performance.now()
          try {
            return await getAccessTokenForUserAction()
          } finally {
            debugLatency('auth token latency', authStartedAt)
          }
        },
        async (accessToken) => {
          await updateJob(
            job,
            'creating_session',
            message('openingGooglePhotos'),
          )
          const createStartedAt = performance.now()
          try {
            const jobApi = new PickerApi(
              await createAuthorizedFetchSession(accessToken),
            )
            activePickerApis.set(job.id, Promise.resolve(jobApi))
            try {
              const session = await jobApi.createSession(
                job.maxItemCount,
                false,
              )
              await markGooglePhotosReady(
                message('pickerReadyDetail'),
                session.expireTime,
              )
              return session
            } catch (error) {
              await recordPickerApiError(error)
              throw error
            }
          } finally {
            debugLatency('session create latency', createStartedAt)
          }
        },
      )
      job.sessionId = session.id
      job.expireTime = session.expireTime
      job.pollingConfig = session.pollingConfig
      transitionJobSession(job, 'READY')
      pickerUri = appendAutoclose(session.pickerUri)
      await putJob(job)
    }

    await openPickerWindow(job, pickerUri, clickStartedAt)
    job.status = 'picking'
    transitionJobSession(job, 'WAITING_SELECTION')
    job.message =
      'Google Photos Picker is open. Choose one or more photos and click Done.'
    await putJob(job)
    void notifyJob(job)
    void pollSession(job)
    return pickerMode
  } catch (error) {
    activePickerApis.delete(job.id)
    await failJob(job, error)
    throw error
  }
}

async function resolveTarget(
  request: Extract<RuntimeRequest, { type: 'START_PICKER' }>,
  sender: chrome.runtime.MessageSender,
): Promise<{ tabId: number; kind: TargetKind }> {
  const tabId = request.targetTabId ?? sender.tab?.id
  if (tabId === undefined) {
    throw new UserFacingError('No target browser tab was provided.')
  }
  const tab = await chrome.tabs.get(tabId)
  const targetUrl =
    sender.tab?.id === tabId && sender.url ? sender.url : tab.url
  const inferredKind: TargetKind = targetUrl?.startsWith('https://chatgpt.com/')
    ? 'chatgpt'
    : 'test'
  const kind = request.targetKind ?? inferredKind

  if (kind === 'chatgpt' && !targetUrl?.startsWith('https://chatgpt.com/')) {
    throw new UserFacingError(
      'Open https://chatgpt.com in the active tab before selecting photos.',
    )
  }
  if (
    kind === 'test' &&
    !targetUrl?.startsWith(chrome.runtime.getURL(''))
  ) {
    throw new UserFacingError('The Phase 1 target is not an extension test page.')
  }
  return { tabId, kind }
}

async function startPicker(
  request: Extract<RuntimeRequest, { type: 'START_PICKER' }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  debugEpochTimestamp(
    'click timestamp',
    request.clickStartedAt ?? performance.timeOrigin + performance.now(),
  )
  const { tabId, kind } = await resolveTarget(request, sender)
  const existing = await getLatestJobForTab(tabId)
  if (existing && !terminalStatuses.has(existing.status)) {
    const disposition = pickerStartDisposition(
      existing.status,
      activePickerStartsByTab.get(tabId)?.id === existing.id,
    )
    if (disposition === 'focus-existing') {
      const focused = await focusExistingPicker(
        existing,
        request.clickStartedAt,
      )
      if (focused) {
        void notifyJob(existing)
        return {
          ok: true,
          jobId: existing.id,
          job: publicJob(existing),
          pickerOpened: true,
          pickerReused: true,
        }
      }
      requestCompletionCheck(existing)
    } else if (disposition === 'wait') {
      void notifyJob(existing)
      return {
        ok: true,
        jobId: existing.id,
        job: publicJob(existing),
        pickerOpened: false,
        pickerReused: true,
      }
    } else {
      await cancelOrphanedPickerStart(existing)
    }
  }

  const requestedMaximum =
    request.maxItemCount ?? DEFAULT_MAX_ITEM_COUNT
  if (
    !Number.isInteger(requestedMaximum) ||
    requestedMaximum < 1 ||
    requestedMaximum > MAX_ITEM_COUNT
  ) {
    throw new UserFacingError(
      'Maximum photo count must be an integer from 1 to ' +
        MAX_ITEM_COUNT +
        '.',
    )
  }

  const concurrentStart = activePickerStartsByTab.get(tabId)
  if (concurrentStart) {
    return {
      ok: true,
      jobId: concurrentStart.id,
      job: publicJob(concurrentStart),
      pickerOpened: false,
      pickerReused: true,
    }
  }

  const now = Date.now()
  const job: PickerJob = {
    id: crypto.randomUUID(),
    targetTabId: tabId,
    targetKind: kind,
    status: 'authorizing',
    sessionState: 'CREATING',
    message: message('openingGooglePhotos'),
    createdAt: now,
    updatedAt: now,
    maxItemCount: requestedMaximum,
    warnings: [],
  }
  job.performanceTrace = createPerformanceTrace(job.id, request.clickStartedAt)
  activePickerStartsByTab.set(tabId, job)
  try {
    await putJob(job)
    await notifyJob(job)
    const taken =
      kind === 'chatgpt'
        ? await takeStandbySession(requestedMaximum)
        : { standby: undefined }
    const standby = taken.standby
    if (standby) {
      job.status = 'picking'
      job.message =
        'Google Photos Picker is open. Choose one or more photos and click Done.'
      job.sessionId = standby.sessionId
      job.expireTime = standby.expireTime
      job.pollingConfig = standby.pollingConfig
      transitionJobSession(job, 'READY')
      await putJob(job)
    }
    const pickerMode = await beginPicker(
      job,
      request.clickStartedAt,
      standby,
    )
    if (kind === 'chatgpt') scheduleStandbyPrewarm(true)
    return {
      ok: true,
      jobId: job.id,
      job: publicJob(job),
      pickerOpened: true,
      pickerMode,
    }
  } finally {
    if (activePickerStartsByTab.get(tabId)?.id === job.id) {
      activePickerStartsByTab.delete(tabId)
    }
  }
}

async function cancelActiveJobsForAuthorizationChange(): Promise<void> {
  for (const job of await getAllJobs()) {
    if (terminalStatuses.has(job.status)) continue
    if (
      job.sessionState === 'CONSUMED' ||
      job.sessionState === 'CANCELLED' ||
      job.sessionState === 'EXPIRED' ||
      job.sessionState === 'FAILED'
    ) {
      continue
    }
    try {
      transitionJobSession(job, 'CANCELLED')
      activeStreams.get(job.id)?.abort()
      await updateJob(
        job,
        'cancelled',
        'Google account connection changed. The previous Picker was closed.',
      )
      await closePickerWindow(job)
      await cleanupSession(job)
    } catch (error) {
      debugEvent('could not fully clean up Picker during account change', {
        jobId: job.id,
        error: friendlyError(error),
      })
    }
  }
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  const type = (value as { type: unknown }).type
  return [
    'START_PICKER',
    'WARM_PICKER',
    'GET_JOB',
    'GET_CONFIG',
    'GET_AUTH_STATE',
    'CONNECT_AUTH',
    'DISCONNECT_AUTH',
    'ATTACH_RESULT',
    'CANCEL_JOB',
    'CLEAR_AUTH',
  ].includes(String(type))
}

async function handleRequest(
  request: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  switch (request.type) {
    case 'START_PICKER':
      return startPicker(request, sender)
    case 'WARM_PICKER':
      await prewarmStandbySession(false)
      return { ok: true }
    case 'GET_JOB': {
      const tabId = request.targetTabId ?? sender.tab?.id
      if (tabId === undefined) return { ok: true }
      const job = await getLatestJobForTab(tabId)
      if (job) await cancelOrphanedPickerStart(job)
      return { ok: true, job: job ? publicJob(job) : undefined }
    }
    case 'GET_CONFIG':
      return {
        ok: true,
        extensionId: chrome.runtime.id,
        clientId: getManifestClientId(),
        oauthConfigured: isOAuthConfigured(),
      }
    case 'GET_AUTH_STATE': {
      const authState = await getGoogleAuthState()
      if (authState.status === 'checking') scheduleStandbyPrewarm(false)
      return { ok: true, authState }
    }
    case 'CONNECT_AUTH':
      if (request.force) {
        await cancelActiveJobsForAuthorizationChange()
        if (standbyCreation) await standbyCreation
        await discardStandbySession()
      }
      await connectGooglePhotos(Boolean(request.force))
      await prewarmStandbySession(false)
      return { ok: true, authState: await getGoogleAuthState() }
    case 'DISCONNECT_AUTH':
    case 'CLEAR_AUTH':
      await cancelActiveJobsForAuthorizationChange()
      if (standbyCreation) await standbyCreation
      await discardStandbySession()
      await disconnectGooglePhotos()
      return { ok: true, authState: await getGoogleAuthState() }
    case 'CANCEL_JOB': {
      const job = await getJob(request.jobId)
      if (!job) throw new UserFacingError('Picker job was not found.')
      transitionJobSession(job, 'CANCELLED')
      activeStreams.get(job.id)?.abort()
      await updateJob(job, 'cancelled', 'Picker job cancelled.')
      await closePickerWindow(job)
      await focusTargetTab(job)
      await cleanupSession(job)
      return { ok: true, job: publicJob(job) }
    }
    case 'ATTACH_RESULT': {
      const job = await getJob(request.jobId)
      if (!job) throw new UserFacingError('Picker job was not found.')
      const { performanceEntries, ...attachment } = request.result
      job.attachment = attachment
      if (performanceEntries) {
        job.performanceTrace = {
          operationId: job.id,
          entries: performanceEntries,
        }
      }
      if (
        request.result.method === 'none' ||
        request.result.attempted === 0
      ) {
        job.error = request.result.detail
        await updateJob(job, 'error', request.result.detail)
      } else {
        const verification = request.result.verified
          ? 'ChatGPT attachment UI changed.'
          : 'Files were handed to ChatGPT, but its attachment UI could not be verified.'
        await updateJob(
          job,
          'complete',
          String(request.result.attempted) +
            ' photo(s) handed to ChatGPT via ' +
            request.result.method +
            '. ' +
            verification,
        )
      }
      return { ok: true, job: publicJob(job) }
    }
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse) => void,
  ) => {
    if (!isRuntimeRequest(message)) return false

    void handleRequest(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: friendlyError(error) })
      })
    return true
  },
)

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('gpfc-download:')) return
  const jobId = port.name.slice('gpfc-download:'.length)
  let portDisconnected = false
  port.onDisconnect.addListener(() => {
    portDisconnected = true
  })

  port.onMessage.addListener((message: DownloadPortMessage) => {
    if (message.type !== 'START_DOWNLOAD' || activeStreams.has(jobId)) return
    const streamController = new AbortController()
    activeStreams.set(jobId, streamController)

    void (async () => {
      const job = await getJob(jobId)
      if (!job) throw new UserFacingError('Picker download job was not found.')
      if (port.sender?.tab?.id !== job.targetTabId) {
        throw new UserFacingError('Download request came from the wrong tab.')
      }
      if (job.status !== 'ready' && job.status !== 'downloading') {
        throw new UserFacingError(
          'Picker job is not ready for download (status: ' + job.status + ').',
        )
      }

      await updateJob(
        job,
        'downloading',
        'Downloading selected photos into browser memory…',
      )
      const result = await streamJobToPort(
        port,
        job,
        message.supportsBinary === true,
        streamController.signal,
      )
      if (result.skipped.length > 0) job.warnings.push(...result.skipped)

      if (result.downloaded === 0) {
        throw new UserFacingError(
          'No photo could be downloaded. ' + result.skipped.join(' | '),
        )
      }

      await cleanupSession(job)
      if (job.status === 'downloading') {
        await updateJob(
          job,
          'attaching',
          'Downloaded ' +
            result.downloaded +
            ' photo(s). Adding them to ChatGPT…',
        )
      }
    })()
      .catch(async (error: unknown) => {
        const job = await getJob(jobId)
        if (job?.status === 'cancelled') return
        if (job) {
          if (portDisconnected) {
            await updateJob(
              job,
              'ready',
              'The download connection closed. Reload ChatGPT to retry.',
            )
          } else {
            await failJob(job, error)
          }
        }
        try {
          const message: DownloadPortMessage = {
            type: 'STREAM_ERROR',
            error: friendlyError(error),
          }
          port.postMessage(message)
        } catch {
          // The receiving tab closed.
        }
      })
      .finally(() => activeStreams.delete(jobId))
  })
})

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    for (const job of await getAllJobs()) {
      if (job.pickerWindowId === windowId && job.status === 'picking') {
        markPickerClosed(job)
        job.pickerWindowId = undefined
        job.pickerTabId = undefined
        job.pickerPresentation = undefined
        requestCompletionCheck(job)
        await putJob(job)
      }
    }
  })()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    for (const job of await getAllJobs()) {
      if (
        job.pickerPresentation === 'tab' &&
        job.pickerTabId === tabId &&
        job.status === 'picking'
      ) {
        markPickerClosed(job)
        job.pickerWindowId = undefined
        job.pickerTabId = undefined
        job.pickerPresentation = undefined
        requestCompletionCheck(job)
        await putJob(job)
      }
    }

  })()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== STANDBY_SESSION_ALARM) return
  void (async () => {
    const standby = await withStandbySessionLock(readStandbySession)
    if (
      standby &&
      !standby.used &&
      !standbyIsUsable(standby, DEFAULT_MAX_ITEM_COUNT)
    ) {
      await discardStandbySession(standby.sessionId)
    }
    try {
      const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' })
      if (tabs.length > 0) {
        scheduleStandbyPrewarm(false)
      }
    } catch {
      // A future ChatGPT page load will request the next prewarm.
    }
  })()
})

async function resumeJobs(): Promise<void> {
  await loadJobs()
  await retirePreloadedPicker()
  for (const job of await getAllJobs()) {
    if (job.status === 'picking' && job.sessionId) {
      void pollSession(job)
    } else if (job.status === 'selected' && job.sessionId) {
      void finalizeSelection(job).catch((error: unknown) => failJob(job, error))
    } else if (job.status === 'ready') {
      await notifyJob(job)
    } else if (job.status === 'downloading' || job.status === 'attaching') {
      await updateJob(
        job,
        'ready',
        'The extension background restarted. Reload ChatGPT to retry the in-memory download.',
      )
    } else if (
      (job.status === 'authorizing' || job.status === 'creating_session') &&
      !job.sessionId
    ) {
      await cancelOrphanedPickerStart(job)
    }
  }
}

void resumeJobs()
