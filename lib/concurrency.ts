// Runs `worker` over `items` with at most `concurrency` in flight at once, instead of
// firing every call in a single Promise.all. Public APIs like TVmaze rate-limit per IP
// (~20 req/10s for TVmaze) — a handful of lanes running in parallel is still fast but
// doesn't blow through that ceiling the moment a list has more than a few entries.
//
// `onItemDone`, if given, fires as each item resolves (not in input order) —
// lets a caller with a large list (e.g. 200+ shows) render results as they
// arrive instead of blocking on the very last one before showing anything.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onItemDone?: (result: R, item: T, index: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runLane() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      const result = await worker(items[current], current);
      results[current] = result;
      onItemDone?.(result, items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runLane));
  return results;
}
