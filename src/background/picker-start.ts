import type { JobStatus } from '../shared/types'

export type PickerStartDisposition = 'focus-existing' | 'wait' | 'start-new'

export function pickerStartDisposition(
  status: JobStatus,
  startInFlight = false,
): PickerStartDisposition {
  if (status === 'picking') return 'focus-existing'
  if (
    startInFlight &&
    (status === 'authorizing' || status === 'creating_session')
  ) {
    return 'wait'
  }
  return 'start-new'
}
