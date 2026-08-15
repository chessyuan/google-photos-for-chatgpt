import { describe, expect, it } from 'vitest'

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

describe('internal performance budgets', () => {
  it('constructs a 5 MB File from a Blob without base64 work', () => {
    const blob = new Blob([new Uint8Array(5 * 1024 * 1024)], {
      type: 'image/jpeg',
    })
    const samples: number[] = []
    for (let index = 0; index < 9; index += 1) {
      const started = performance.now()
      const file = new File([blob], 'photo.jpg', { type: blob.type })
      samples.push(performance.now() - started)
      expect(file.size).toBe(blob.size)
    }

    expect(median(samples)).toBeLessThan(25)
  })
})
