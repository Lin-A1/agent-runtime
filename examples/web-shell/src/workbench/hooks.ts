import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../api/client"
import { useBus } from "../api/bus"
import { foldGoal, foldTodos } from "../api/fold"
import type { ContextView, FileContent, FsEntry, GoalView, PolicyLevel, StoredEventRow, TodoItem } from "../api/types"

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  stale: boolean
}

export interface ContextBundle {
  context: ContextView | null
  goal: GoalView | ReturnType<typeof foldGoal> | null
  todos: TodoItem[]
  policy: PolicyLevel | null
}

export function useDirectory(workspace: string | undefined, path: string): { state: AsyncState<{ path: string; entries: FsEntry[] }>; reload: () => void } {
  const [state, setState] = useState<AsyncState<{ path: string; entries: FsEntry[] }>>({ data: null, error: null, loading: true, stale: false })
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)
  const reload = useCallback(() => setReloadKey((value) => value + 1), [])
  useEffect(() => {
    const requestId = ++seq.current
    const controller = new AbortController()
    if (!workspace) {
      setState({ data: null, error: "当前 session 尚未解析工作区", loading: false, stale: false })
      return () => controller.abort()
    }
    setState((current) => ({ ...current, loading: true, error: null, stale: current.data !== null }))
    void api.fs(workspace, path, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted || requestId !== seq.current) return
      setState({ data, error: null, loading: false, stale: false })
    }).catch((error) => {
      if (controller.signal.aborted || requestId !== seq.current) return
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error), loading: false, stale: false }))
    })
    return () => controller.abort()
  }, [path, reloadKey, workspace])
  return { state, reload }
}

export function useFilePreview(workspace: string | undefined, path: string | null): AsyncState<FileContent> {
  const [state, setState] = useState<AsyncState<FileContent>>({ data: null, error: null, loading: false, stale: false })
  const seq = useRef(0)
  useEffect(() => {
    const requestId = ++seq.current
    const controller = new AbortController()
    if (!workspace || !path) {
      setState({ data: null, error: null, loading: false, stale: false })
      return () => controller.abort()
    }
    setState((current) => ({ ...current, loading: true, error: null, stale: current.data !== null }))
    void api.file(workspace, path, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted || requestId !== seq.current) return
      setState({ data, error: null, loading: false, stale: false })
    }).catch((error) => {
      if (controller.signal.aborted || requestId !== seq.current) return
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error), loading: false, stale: false }))
    })
    return () => controller.abort()
  }, [path, workspace])
  return state
}

export function useSessionContext(sessionId: string, events: StoredEventRow[] | null): { state: AsyncState<ContextBundle>; reload: () => void } {
  const [state, setState] = useState<AsyncState<ContextBundle>>({ data: null, error: null, loading: true, stale: false })
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)
  const reload = useCallback(() => setReloadKey((value) => value + 1), [])
  // events is ONLY a fallback for goal/todos when the endpoints fail. It is a
  // NEW array reference on every transcript bus refresh — depending on it here
  // re-ran (and aborted) all four requests on every frame, and a burst could
  // leave the panel frozen on "刷新中…" with the refresh button disabled
  // forever. Keep it in a ref instead; the effect re-runs on session/reload.
  const eventsRef = useRef(events)
  eventsRef.current = events
  useEffect(() => {
    const requestId = ++seq.current
    const controller = new AbortController()
    const fallbackSource = eventsRef.current
    const fallbackGoal = fallbackSource?.length ? foldGoal(fallbackSource) : null
    const fallbackTodos = fallbackSource?.length ? foldTodos(fallbackSource) : []
    setState((current) => ({ ...current, loading: true, error: null, stale: current.data !== null }))
    void Promise.allSettled([api.context(sessionId, { signal: controller.signal }), api.goal(sessionId, { signal: controller.signal }), api.todos(sessionId, { signal: controller.signal }), api.policy(sessionId, { signal: controller.signal })]).then(([contextResult, goalResult, todosResult, policyResult]) => {
      if (controller.signal.aborted || requestId !== seq.current) return
      const failures = [contextResult, goalResult, todosResult, policyResult].filter((result) => result.status === "rejected")
      setState({
        data: {
          context: contextResult.status === "fulfilled" ? contextResult.value : null,
          goal: goalResult.status === "fulfilled" ? goalResult.value.goal : fallbackGoal,
          todos: todosResult.status === "fulfilled" ? todosResult.value.todos : fallbackTodos,
          policy: policyResult.status === "fulfilled" ? policyResult.value.policy : null,
        },
        error: failures.length === 4 ? "上下文接口暂不可用" : failures.length ? `${failures.length} 个上下文分区暂时不可用` : null,
        loading: false,
        stale: false,
      })
    })
    return () => controller.abort()
  }, [reloadKey, sessionId])
  // Refresh when the session's turn settles (usage/calls change per turn).
  useBus((frame) => {
    if (frame.sessionId !== sessionId) return
    if (frame.event.type === "result" || frame.event.type === "error") reload()
  })
  return { state, reload }
}
