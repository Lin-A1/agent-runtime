import { useCallback, useMemo } from "react"

/**
 * Data access for the UI-shell stage. Per the current build decision all data
 * is HARD-CODED: the `fn` returns its shape synchronously (it reads the
 * in-repo fixtures directly), so there is no fetch, no latency, and no
 * loading/error flicker — pages render the working state immediately.
 *
 * The return shape deliberately keeps `loading`/`error`/`retry` so call sites
 * stay identical on wiring day: swap `fn` for a real async fetch and these
 * light up without touching components.
 */
export interface ApiState<T> {
  data: T
  error: null
  loading: false
  retry: () => void
  isEmpty: boolean
}

export function useApi<T>(fn: () => T, deps: ReadonlyArray<unknown> = [], emptyIf?: (data: T) => boolean): ApiState<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(fn, deps)
  const retry = useCallback(() => {}, [])
  return { data, error: null, loading: false, retry, isEmpty: emptyIf ? emptyIf(data) : false }
}
