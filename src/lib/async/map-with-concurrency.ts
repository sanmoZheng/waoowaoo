export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return []

  const normalizedConcurrency = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1
  const workerCount = Math.min(normalizedConcurrency, items.length)
  const results = new Array<TResult>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) return
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  })

  // 等待所有并行 worker 都收敛后再抛出首个错误，避免其中一个请求失败时，
  // 其他仍在运行的请求稍后拒绝并逃逸到进程级 unhandledRejection。
  const settledWorkers = await Promise.allSettled(workers)
  const firstFailure = settledWorkers.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (firstFailure) throw firstFailure.reason
  return results
}
