import { describe, expect, it } from 'vitest'
import { pickerPreloadWindowOptions } from './preload-window'

describe('Picker preload window', () => {
  it('loads in an unfocused minimized popup instead of the main tab strip', () => {
    expect(
      pickerPreloadWindowOptions(
        'https://photos.google.com/picker/session/autoclose',
      ),
    ).toEqual({
      url: 'https://photos.google.com/picker/session/autoclose',
      type: 'popup',
      focused: false,
      state: 'minimized',
    })
  })
})
