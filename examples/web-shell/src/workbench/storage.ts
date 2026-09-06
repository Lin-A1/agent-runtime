import type { WorkbenchTab } from "./types"

export const TERMINAL_LIMIT = 80
export const PANE_MIN = 420
export const PANE_MAX = 760
export const PANE_DEFAULT = 560

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // UI preferences are best effort.
  }
}

export function sessionKey(sessionId: string, name: string): string {
  return `newhorse:workbench:${sessionId}:${name}`
}

export function readTab(sessionId: string): WorkbenchTab {
  const value = read<unknown>(sessionKey(sessionId, "tab"), "terminal")
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value) ? value : "terminal"
}

export function readPaneWidth(sessionId: string): number {
  const value = read<unknown>(sessionKey(sessionId, "width"), PANE_DEFAULT)
  return typeof value === "number" && Number.isFinite(value) && value >= PANE_MIN && value <= PANE_MAX ? value : PANE_DEFAULT
}

export function readHistory(sessionId: string): string[] {
  const value = read<unknown>(sessionKey(sessionId, "history"), [])
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-TERMINAL_LIMIT) : []
}
