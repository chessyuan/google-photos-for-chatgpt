const debugEnabled = import.meta.env.MODE !== 'production'

function epochNow(): number {
  return performance.timeOrigin + performance.now()
}

export function debugEvent(
  label: string,
  details?: Record<string, unknown>,
): void {
  if (!debugEnabled) return
  if (details) console.debug('[GPFC performance] ' + label, details)
  else console.debug('[GPFC performance] ' + label)
}

export function debugEpochTimestamp(label: string, timestamp = epochNow()): void {
  if (!debugEnabled) return
  console.debug('[GPFC performance] ' + label + ': ' + timestamp.toFixed(1) + 'ms epoch')
}

export function debugLatency(label: string, startedAt: number): void {
  if (!debugEnabled) return
  const duration = Math.max(0, performance.now() - startedAt)
  console.debug('[GPFC performance] ' + label + ': ' + duration.toFixed(1) + 'ms')
}

export function debugEpochLatency(label: string, startedAt?: number): void {
  if (!debugEnabled || startedAt === undefined) return
  const now = epochNow()
  const duration = Math.max(0, now - startedAt)
  console.debug('[GPFC performance] ' + label + ': ' + duration.toFixed(1) + 'ms')
}
