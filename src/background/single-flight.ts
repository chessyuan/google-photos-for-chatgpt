export class SingleFlight {
  private readonly running = new Map<string, Promise<void>>()

  run(key: string, task: () => Promise<void>): Promise<void> {
    const existing = this.running.get(key)
    if (existing) return existing

    const operation = task().finally(() => {
      if (this.running.get(key) === operation) this.running.delete(key)
    })
    this.running.set(key, operation)
    return operation
  }
}
