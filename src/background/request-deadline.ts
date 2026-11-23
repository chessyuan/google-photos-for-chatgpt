// Keep the deadline active through response-body consumption, not just headers.
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  timeoutError: Error,
  callerSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abortFromCaller: () => void = () => undefined
  const interrupted = new Promise<never>((_, reject) => {
    abortFromCaller = () => {
      const reason: unknown = callerSignal?.reason ?? new DOMException('Aborted', 'AbortError')
      controller.abort(reason)
      reject(reason)
    }
    timer = setTimeout(() => {
      controller.abort(timeoutError)
      reject(timeoutError)
    }, milliseconds)
    if (callerSignal?.aborted) abortFromCaller()
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  })
  try {
    if (controller.signal.aborted) return await interrupted
    return await Promise.race([operation(controller.signal), interrupted])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}
