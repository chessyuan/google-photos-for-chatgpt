const minimumCloseGraceMilliseconds = 6000
const maximumCloseGraceMilliseconds = 15000

export function pickerCloseGraceMilliseconds(
  pollIntervalMilliseconds: number,
): number {
  return Math.min(
    maximumCloseGraceMilliseconds,
    Math.max(minimumCloseGraceMilliseconds, pollIntervalMilliseconds * 3),
  )
}

export function pickerCloseIsSettled(
  closedAt: number | undefined,
  now: number,
  pollIntervalMilliseconds: number,
): boolean {
  if (closedAt === undefined || closedAt > now) return false
  return (
    now - closedAt >= pickerCloseGraceMilliseconds(pollIntervalMilliseconds)
  )
}
