export interface FileNavigationState {
  path: string
  back: string[]
  forward: string[]
}

export type FileNavigationAction =
  | { type: "push"; path: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reset"; path: string }

export function createFileNavigation(path = "."): FileNavigationState {
  return { path, back: [], forward: [] }
}

export function reduceFileNavigation(state: FileNavigationState, action: FileNavigationAction): FileNavigationState {
  if (action.type === "reset") return createFileNavigation(action.path)
  if (action.type === "push") {
    if (action.path === state.path) return state
    return { path: action.path, back: [...state.back, state.path], forward: [] }
  }
  if (action.type === "back") {
    const previous = state.back.at(-1)
    if (!previous) return state
    return { path: previous, back: state.back.slice(0, -1), forward: [state.path, ...state.forward] }
  }
  const next = state.forward[0]
  if (!next) return state
  return { path: next, back: [...state.back, state.path], forward: state.forward.slice(1) }
}
