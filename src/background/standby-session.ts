import { STANDBY_SESSION_STORAGE_KEY } from '../shared/constants'
import type {
  PickingSession,
  StandbyPickerSession,
} from '../shared/types'
import { appendAutoclose } from './picker-api'

let standbyStorageQueue: Promise<void> = Promise.resolve()

export type StandbyMissReason =
  | 'no session'
  | 'expired'
  | 'used'
  | 'max item count mismatch'

export interface StandbyConsumeResult {
  standby?: StandbyPickerSession
  missReason?: StandbyMissReason
  storageReadMilliseconds: number
}

export function withStandbySessionLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = standbyStorageQueue.then(operation, operation)
  standbyStorageQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function standbyFromPickingSession(
  session: PickingSession,
  maxItemCount: number,
  createdAt = Date.now(),
): StandbyPickerSession {
  return {
    sessionId: session.id,
    pickerUri: appendAutoclose(session.pickerUri),
    expireTime: session.expireTime,
    pollingConfig: session.pollingConfig,
    createdAt,
    used: false,
    maxItemCount,
    ready: false,
  }
}

export function getStandbyMissReason(
  session: StandbyPickerSession | undefined,
  maxItemCount: number,
  now = Date.now(),
): StandbyMissReason | undefined {
  if (!session) return 'no session'
  if (session.used) return 'used'
  if (session.maxItemCount !== maxItemCount) {
    return 'max item count mismatch'
  }
  const expireAt = Date.parse(session.expireTime)
  if (!Number.isFinite(expireAt) || expireAt <= now) return 'expired'
  return undefined
}

export function standbyIsUsable(
  session: StandbyPickerSession | undefined,
  maxItemCount: number,
  now = Date.now(),
): boolean {
  return getStandbyMissReason(session, maxItemCount, now) === undefined
}

export function clearStandbyPreloadState(
  session: StandbyPickerSession,
  dismissed = false,
): StandbyPickerSession {
  const cleared = {
    ...session,
    ready: false,
    ...(dismissed ? { preloadDismissed: true } : {}),
  }
  delete cleared.pickerTabId
  delete cleared.pickerWindowId
  delete cleared.tabStatus
  delete cleared.preloadPresentation
  if (!dismissed) delete cleared.preloadDismissed
  return cleared
}

export async function readStandbySession(): Promise<
  StandbyPickerSession | undefined
> {
  const stored = await chrome.storage.session.get(STANDBY_SESSION_STORAGE_KEY)
  return stored[STANDBY_SESSION_STORAGE_KEY] as
    | StandbyPickerSession
    | undefined
}

export async function writeStandbySession(
  session: StandbyPickerSession,
): Promise<void> {
  await chrome.storage.session.set({
    [STANDBY_SESSION_STORAGE_KEY]: structuredClone(session),
  })
}

export async function removeStandbySession(): Promise<void> {
  await chrome.storage.session.remove(STANDBY_SESSION_STORAGE_KEY)
}

export async function consumeStandbySession(
  maxItemCount: number,
  now = Date.now(),
): Promise<StandbyConsumeResult> {
  return withStandbySessionLock(async () => {
    const readStartedAt = performance.now()
    const session = await readStandbySession()
    const storageReadMilliseconds = Math.max(
      0,
      performance.now() - readStartedAt,
    )
    const missReason = getStandbyMissReason(session, maxItemCount, now)
    if (!session || missReason) {
      return { missReason, storageReadMilliseconds }
    }
    const consumed = { ...session, used: true }
    await writeStandbySession(consumed)
    return { standby: consumed, storageReadMilliseconds }
  })
}
