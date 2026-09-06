import { useCallback, useEffect, useState } from "react"

/**
 * Async data access (wired). `fn` may return data or a Promise — the hook
 * normalizes into { data, error, loading, retry }. `data` is NULL while the
 * first fetch is in flight: pages route through AsyncRegion (loading/error
 * branches), and any direct `data.` access must null-guard.
 *
 * `retry` refetches (also the polling primitive — Sidebar/Approvals drive it
 * with intervals per handoff §6.7).
 */
export interface ApiState<T> {
  data: T | null
  error: Error | null
  loading: boolean
  retry: () => void
  isEmpty: boolean
}

export function useApi<T>(fn: () => T | Promise<T>, deps: ReadonlyArray<unknown> = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  // Stale-while-refetch: once data has landed, a refetch (retry / PUT-then-
  // refresh) keeps the previous view mounted — resetting it to null is what
  // made the settings page flash on every interaction.
  const [everLoaded, setEverLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.resolve()
      .then(fn)
      .then((d) => {
        if (!alive) return
        setData(d)
        setEverLoaded(true)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const retry = useCallback(() => setTick((t) => t + 1), [])
  const isEmpty = everLoaded && data === null
  // `loading` is TRUE only before the first landing — refetches keep the
  // stale view mounted (no flash). AsyncRegion treats data!=null as content.
  return { data, error, loading: loading && data === null, retry, isEmpty }
}
