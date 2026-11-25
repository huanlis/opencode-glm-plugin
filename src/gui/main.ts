import type { Plugin } from "@opencode/plugin/gui"
import { GlmQuota } from "./contract"
import { fetchSnapshot, type Snapshot } from "./bigmodel"

/** The cached snapshot stays fresh for this long before `snapshot` refetches. */
const MIN_INTERVAL_MS = 90_000

export const main: Plugin.MainSetup = (ctx) => {
  let cache: Snapshot | undefined
  let inflight: Promise<Snapshot> | undefined

  const load = (force: boolean): Promise<Snapshot> => {
    const age = cache ? Date.now() - cache.fetchedAt : Number.POSITIVE_INFINITY
    if (!force && cache && age < MIN_INTERVAL_MS) return Promise.resolve(cache)
    if (inflight) return inflight
    inflight = fetchSnapshot(ctx.options)
      .then((next) => {
        cache = next
        return next
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }

  const provider = ctx.provide(GlmQuota, {
    snapshot: () => load(false),
    refresh: () => load(true),
  })

  // Warm the cache so the first panel or pill read is instant.
  void load(false).catch(() => {})

  return () => provider.dispose()
}
