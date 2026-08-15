import { describe, expect, it } from 'vitest'
import type { JobStatus } from '../shared/types'
import { pickerStartDisposition } from './picker-start'

describe('Picker start disposition', () => {
  it('focuses only a Picker that is actually open', () => {
    expect(pickerStartDisposition('picking')).toBe('focus-existing')
  })

  it('deduplicates only OAuth and session creation', () => {
    expect(pickerStartDisposition('authorizing')).toBe('wait')
    expect(pickerStartDisposition('creating_session')).toBe('wait')
  })

  it('allows another selection while earlier photos finish processing', () => {
    const processing: JobStatus[] = [
      'selected',
      'ready',
      'downloading',
      'attaching',
      'complete',
      'cancelled',
      'error',
    ]
    for (const status of processing) {
      expect(pickerStartDisposition(status)).toBe('start-new')
    }
  })
})
