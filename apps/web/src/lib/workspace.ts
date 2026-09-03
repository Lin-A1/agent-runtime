import { useEffect, useState } from "react"

/**
 * Workspace selection — one localStorage key + a custom event so every mounted
 * consumer flips together (no provider tree needed). Session workspaces are
 * normalized to forward slashes before comparison: the engine stores whatever
 * string the creator passed, and Windows callers mix G:\ and G:/ spellings.
 */
const KEY = "nh-workspace"

export function normWorkspace(w: string): string {
  return w.replaceAll("\\", "/").replace(/\/+$/, "")
}

export function getWorkspace(): string | null {
  const v = localStorage.getItem(KEY)
  return v && v !== "" ? v : null
}

export function setWorkspace(ws: string | null): void {
  if (ws) localStorage.setItem(KEY, normWorkspace(ws))
  else localStorage.removeItem(KEY)
  window.dispatchEvent(new Event("nh-workspace-changed"))
}

export function useWorkspace(fallback: string | undefined): [string, (ws: string | null) => void] {
  const [sel, setSel] = useState<string | null>(getWorkspace())
  useEffect(() => {
    const on = (): void => setSel(getWorkspace())
    window.addEventListener("nh-workspace-changed", on)
    return () => window.removeEventListener("nh-workspace-changed", on)
  }, [])
  return [sel ?? (fallback ? normWorkspace(fallback) : ""), setWorkspace]
}
