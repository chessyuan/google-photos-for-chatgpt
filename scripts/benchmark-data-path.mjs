import { File } from 'node:buffer'
import { performance } from 'node:perf_hooks'

function stats(samples) {
  const sorted = samples.slice().sort((left, right) => left - right)
  const percentile = (value) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
  return {
    min: sorted[0],
    median: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    max: sorted.at(-1),
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function legacyRoundTrip(source) {
  const base64 = bytesToBase64(source)
  const decoded = base64ToBytes(base64)
  const blob = new Blob([decoded], { type: 'image/jpeg' })
  return new File([blob], 'photo.jpg', { type: blob.type })
}

function structuredClonePath(source) {
  const blob = new Blob([source], { type: 'image/jpeg' })
  const cloned = structuredClone(blob)
  return new File([cloned], 'photo.jpg', { type: cloned.type })
}

async function measure(megabytes, operation) {
  const source = new Uint8Array(megabytes * 1024 * 1024)
  operation(source)
  const samples = []
  for (let index = 0; index < 15; index += 1) {
    const started = performance.now()
    const file = operation(source)
    if (file.size !== source.byteLength) throw new Error('Size mismatch')
    samples.push(performance.now() - started)
    await new Promise((resolve) => setImmediate(resolve))
  }
  return stats(samples)
}

const results = {}
for (const megabytes of [1, 5, 12]) {
  results[megabytes + 'MB'] = {
    legacyBase64: await measure(megabytes, legacyRoundTrip),
    structuredCloneBlob: await measure(megabytes, structuredClonePath),
  }
}

console.log(JSON.stringify(results, null, 2))
