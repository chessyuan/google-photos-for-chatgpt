export type PollWakeReason = 'completion' | 'interval'

interface Waiter {
  resolve: (reason: PollWakeReason) => void
  timer: ReturnType<typeof setTimeout>
}

export class CompletionCoordinator {
  private readonly pending = new Set<string>()
  private readonly delivered = new Set<string>()
  private readonly waiters = new Map<string, Waiter>()

  request(jobId: string): boolean {
    if (this.pending.has(jobId)) return false
    this.pending.add(jobId)
    const waiter = this.waiters.get(jobId)
    if (waiter) {
      clearTimeout(waiter.timer)
      this.waiters.delete(jobId)
      this.delivered.add(jobId)
      waiter.resolve('completion')
    }
    return true
  }

  wait(jobId: string, intervalMilliseconds: number): Promise<PollWakeReason> {
    if (this.pending.has(jobId) && !this.delivered.has(jobId)) {
      this.delivered.add(jobId)
      return Promise.resolve('completion')
    }

    return new Promise((resolve) => {
      const existing = this.waiters.get(jobId)
      if (existing) {
        clearTimeout(existing.timer)
        existing.resolve('interval')
      }
      const timer = setTimeout(() => {
        this.waiters.delete(jobId)
        resolve('interval')
      }, intervalMilliseconds)
      this.waiters.set(jobId, { resolve, timer })
    })
  }

  clear(jobId: string): void {
    this.pending.delete(jobId)
    this.delivered.delete(jobId)
    const waiter = this.waiters.get(jobId)
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.waiters.delete(jobId)
    waiter.resolve('interval')
  }
}
