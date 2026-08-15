export async function mapConcurrentOrdered<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Download concurrency must be a positive integer.')
  }

  const results = new Array<R>(values.length)
  let cursor = 0

  const runWorker = async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(values[index], index)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      runWorker,
    ),
  )
  return results
}
