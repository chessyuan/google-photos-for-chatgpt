import { describe, expect, it } from 'vitest'
import type { JobStatus } from '../shared/types'
import { pickerStartDisposition } from './picker-start'

describe('Picker start disposition', () => {
  it('focuses only a Picker that is actually open', () => {
    expect(pickerStartDisposition('picking')).toBe('focus-existing')
  })

  it('deduplicates OAuth and session creation only while work is active', () => {
    expect(pickerStartDisposition('authorizing', true)).toBe('wait')
    expect(pickerStartDisposition('creating_session', true)).toBe('wait')
  })

  it('restarts orphaned MV3 jobs instead of waiting forever', () => {
    expect(pickerStartDisposition('authorizing', false)).toBe('start-new')
    expect(pickerStartDisposition('creating_session', false)).toBe('start-new')
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
