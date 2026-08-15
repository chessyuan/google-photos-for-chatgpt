export const performanceDebugEnabled = import.meta.env.MODE !== 'production'

export const performancePoints = {
  userClick: 'T00 user_click_google_photos',
  pickerActivateStart: 'T01 picker_tab_activate_start',
  pickerVisible: 'T02 picker_visible',
  pickerDoneDetected: 'T03 picker_done_detected',
  pickerClosedDetected: 'T04 picker_tab_closed_detected',
  completionFastPathStart: 'T05 completion_fastpath_start',
  sessionGetStart: 'T06 sessions_get_start',
  sessionGetResponse: 'T07 sessions_get_response',
  mediaItemsSet: 'T08 mediaItemsSet_true',
  mediaListStart: 'T09 mediaitems_list_start',
  mediaListResponse: 'T10 mediaitems_list_response',
  mediaMetadataReady: 'T11 media_metadata_ready',
  imageFetchStart: 'T12 image_fetch_start',
  imageHeaders: 'T13 image_response_headers',
  imageBodyStart: 'T14 image_body_read_start',
  imageBlobReady: 'T15 image_blob_ready',
  fileReady: 'T16 file_object_ready',
  messageSendStart: 'T17 extension_message_send_start',
  contentReceivedFile: 'T18 content_script_received_file',
  uploadResolveStart: 'T19 chatgpt_upload_target_resolve_start',
  uploadResolved: 'T20 chatgpt_upload_target_resolved',
  dataTransferStart: 'T21 datatransfer_start',
  inputFilesAssigned: 'T22 input_files_assigned',
  changeDispatched: 'T23 change_event_dispatched',
  uploadProcessingDetected: 'T24 chatgpt_upload_processing_detected',
  previewInserted: 'T25 chatgpt_preview_dom_inserted',
  previewRendered: 'T26 chatgpt_preview_rendered',
  totalComplete: 'T27 total_complete',
} as const

export type PerformancePoint =
  (typeof performancePoints)[keyof typeof performancePoints]

export interface PerformanceEntry {
  point: PerformancePoint
  at: number
  itemIndex?: number
  bytes?: number
  mimeType?: string
  requestedDimension?: number
  note?: string
}

export interface PerformanceTrace {
  operationId: string
  entries: PerformanceEntry[]
}

export function epochPerformanceNow(): number {
  return performance.timeOrigin + performance.now()
}

export function createPerformanceTrace(
  operationId: string,
  clickStartedAt?: number,
): PerformanceTrace | undefined {
  if (!performanceDebugEnabled) return undefined
  const trace: PerformanceTrace = { operationId, entries: [] }
  markPerformance(
    trace,
    performancePoints.userClick,
    undefined,
    clickStartedAt,
  )
  return trace
}

export function markPerformance(
  trace: PerformanceTrace | undefined,
  point: PerformancePoint,
  details?: Omit<PerformanceEntry, 'point' | 'at'>,
  at = epochPerformanceNow(),
): number {
  if (!performanceDebugEnabled || !trace) return at
  trace.entries.push({ point, at, ...details })
  return at
}

export function mergePerformanceEntries(
  trace: PerformanceTrace | undefined,
  entries: PerformanceEntry[] | undefined,
): void {
  if (!performanceDebugEnabled || !trace || !entries) return
  trace.entries.push(...entries)
}

export function hasPerformancePoint(
  trace: PerformanceTrace | undefined,
  point: PerformancePoint,
): boolean {
  return Boolean(trace?.entries.some((entry) => entry.point === point))
}

function firstAt(
  trace: PerformanceTrace,
  point: PerformancePoint,
  itemIndex?: number,
): number | undefined {
  return trace.entries.find(
    (entry) =>
      entry.point === point &&
      (itemIndex === undefined || entry.itemIndex === itemIndex),
  )?.at
}

function lastAt(
  trace: PerformanceTrace,
  point: PerformancePoint,
): number | undefined {
  return trace.entries.findLast((entry) => entry.point === point)?.at
}

function duration(
  trace: PerformanceTrace,
  start: PerformancePoint,
  end: PerformancePoint,
  itemIndex?: number,
): number | undefined {
  const startAt = firstAt(trace, start, itemIndex)
  const endAt =
    itemIndex === undefined
      ? lastAt(trace, end)
      : firstAt(trace, end, itemIndex)
  if (startAt === undefined || endAt === undefined) return undefined
  return Math.max(0, endAt - startAt)
}

function format(milliseconds: number | undefined): string {
  return milliseconds === undefined ? 'n/a' : milliseconds.toFixed(1) + ' ms'
}

export function printPerformanceReport(trace: PerformanceTrace | undefined): void {
  if (!performanceDebugEnabled || !trace) return

  const session = duration(
    trace,
    performancePoints.sessionGetStart,
    performancePoints.sessionGetResponse,
  )
  const mediaList = duration(
    trace,
    performancePoints.mediaListStart,
    performancePoints.mediaListResponse,
  )
  const mediaDownload = duration(
    trace,
    performancePoints.imageFetchStart,
    performancePoints.imageBlobReady,
  )
  const messaging = duration(
    trace,
    performancePoints.messageSendStart,
    performancePoints.contentReceivedFile,
  )
  const domResolution = duration(
    trace,
    performancePoints.uploadResolveStart,
    performancePoints.uploadResolved,
  )
  const injection = duration(
    trace,
    performancePoints.dataTransferStart,
    performancePoints.changeDispatched,
  )
  const chatGpt = duration(
    trace,
    performancePoints.changeDispatched,
    performancePoints.previewRendered,
  )
  const total = duration(
    trace,
    performancePoints.pickerDoneDetected,
    performancePoints.totalComplete,
  )
  const doneToSessionRequest = duration(
    trace,
    performancePoints.pickerDoneDetected,
    performancePoints.sessionGetStart,
  )
  const sessionToMediaList = duration(
    trace,
    performancePoints.sessionGetResponse,
    performancePoints.mediaListStart,
  )
  const backgroundConversion = duration(
    trace,
    performancePoints.imageBlobReady,
    performancePoints.messageSendStart,
  )
  const contentFileConversion = duration(
    trace,
    performancePoints.contentReceivedFile,
    performancePoints.fileReady,
  )
  const conversion =
    backgroundConversion === undefined && contentFileConversion === undefined
      ? undefined
      : (backgroundConversion ?? 0) + (contentFileConversion ?? 0)
  const network = (session ?? 0) + (mediaList ?? 0) + (mediaDownload ?? 0)
  const controlled =
    total === undefined
      ? undefined
      : Math.max(0, total - network - (chatGpt ?? 0))

  const itemIndexes = [
    ...new Set(
      trace.entries
        .map((entry) => entry.itemIndex)
        .filter((value): value is number => value !== undefined),
    ),
  ].sort((left, right) => left - right)

  console.debug('========== GPFC PERF ==========')
  console.debug('operation', trace.operationId)
  console.debug('Picker Done → session request', format(doneToSessionRequest))
  console.debug('sessions.get', format(session))
  console.debug('session → mediaItems.list', format(sessionToMediaList))
  console.debug('mediaItems.list', format(mediaList))
  console.debug('media download wall time', format(mediaDownload))
  console.debug('Blob/File conversion', format(conversion))
  console.debug('extension messaging', format(messaging))
  console.debug('ChatGPT DOM resolution', format(domResolution))
  console.debug('File injection', format(injection))
  console.debug('change → preview rendered', format(chatGpt))
  console.debug('Extension-controlled latency', format(controlled))
  console.debug('ChatGPT-controlled latency', format(chatGpt))
  console.debug('Google API/network + image transfer', format(network))
  console.debug('TOTAL Done → Preview', format(total))
  for (const itemIndex of itemIndexes) {
    const itemEntry = trace.entries.find(
      (entry) =>
        entry.itemIndex === itemIndex &&
        entry.point === performancePoints.imageBlobReady,
    )
    console.debug('image[' + itemIndex + ']', {
      fetchToBlob: format(
        duration(
          trace,
          performancePoints.imageFetchStart,
          performancePoints.imageBlobReady,
          itemIndex,
        ),
      ),
      messageToFile: format(
        duration(
          trace,
          performancePoints.messageSendStart,
          performancePoints.fileReady,
          itemIndex,
        ),
      ),
      bytes: itemEntry?.bytes,
      mimeType: itemEntry?.mimeType,
      requestedDimension: itemEntry?.requestedDimension,
    })
  }
  console.debug(
    trace.entries
      .slice()
      .sort((left, right) => left.at - right.at)
      .map((entry) => ({
        ...entry,
        sinceDone:
          firstAt(trace, performancePoints.pickerDoneDetected) === undefined
            ? undefined
            : Number(
                (
                  entry.at -
                  (firstAt(trace, performancePoints.pickerDoneDetected) ?? 0)
                ).toFixed(1),
              ),
      })),
  )
  console.debug('================================')
}
