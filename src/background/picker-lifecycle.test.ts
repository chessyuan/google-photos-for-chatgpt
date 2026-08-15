import { describe, expect, it } from 'vitest'
import {
  pickerCloseGraceMilliseconds,
  pickerCloseIsSettled,
} from './picker-lifecycle'

describe('Picker window lifecycle', () => {
  it('waits for several polls after autoclose before treating it as cancel', () => {
    expect(pickerCloseGraceMilliseconds(2000)).toBe(6000)
    expect(pickerCloseIsSettled(10_000, 15_999, 2000)).toBe(false)
    expect(pickerCloseIsSettled(10_000, 16_000, 2000)).toBe(true)
  })

  it('caps long polling intervals and ignores an open or future close marker', () => {
    expect(pickerCloseGraceMilliseconds(10_000)).toBe(15_000)
    expect(pickerCloseIsSettled(undefined, 20_000, 2000)).toBe(false)
    expect(pickerCloseIsSettled(21_000, 20_000, 2000)).toBe(false)
  })
})
