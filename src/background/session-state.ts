import type { SessionLifecycleState } from '../shared/types'

const transitions: Record<SessionLifecycleState, Set<SessionLifecycleState>> = {
  CREATING: new Set(['READY', 'CANCELLED', 'FAILED']),
  READY: new Set(['OPENING', 'CANCELLED', 'EXPIRED', 'FAILED']),
  OPENING: new Set(['VISIBLE', 'CANCELLED', 'FAILED']),
  VISIBLE: new Set(['WAITING_SELECTION', 'CANCELLED', 'FAILED']),
  WAITING_SELECTION: new Set([
    'COMPLETING',
    'CANCELLED',
    'EXPIRED',
    'FAILED',
  ]),
  COMPLETING: new Set(['FETCHING_MEDIA', 'CANCELLED', 'FAILED']),
  FETCHING_MEDIA: new Set(['METADATA_READY', 'CANCELLED', 'FAILED']),
  METADATA_READY: new Set(['CONSUMED', 'CANCELLED', 'FAILED']),
  CONSUMED: new Set(),
  CANCELLED: new Set(),
  EXPIRED: new Set(),
  FAILED: new Set(),
}

export function transitionSessionState(
  current: SessionLifecycleState | undefined,
  next: SessionLifecycleState,
): SessionLifecycleState {
  if (current === undefined || current === next) return next
  if (!transitions[current].has(next)) {
    throw new Error('Invalid Picker session transition: ' + current + ' → ' + next)
  }
  return next
}
