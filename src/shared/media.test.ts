import { describe, expect, it } from 'vitest'
import { mediaByteLimit, mediaFilename, VIDEO_LIMIT_BYTES } from './media'

describe('media policies', () => {
  it('keeps image and video limits separate', () => {
    expect(mediaByteLimit('image/jpeg')).toBe(20 * 1024 * 1024)
    expect(mediaByteLimit('video/mp4')).toBe(VIDEO_LIMIT_BYTES)
  })
  it('matches video filenames to Google’s transcoded response format', () => {
    expect(mediaFilename('holiday.MOV', 'video/mp4')).toBe('holiday.mp4')
    expect(mediaFilename('holiday.mp4', 'video/mp4')).toBe('holiday.mp4')
    expect(mediaFilename('photo.png', 'image/png')).toBe('photo.png')
  })
})
