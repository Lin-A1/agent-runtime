/**
 * Theme preference — the pre-paint inline script in index.html applies the
 * same resolution before first paint (keep the two in sync). Manual choice
 * persists in localStorage; "system" follows prefers-color-scheme.
 */
import { useEffect, useState } from "react"

export type ThemePref = "dark" | "light" | "system"
const KEY = "NEWHORSE_THEME"

export function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref === "system") return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
  return pref
}

export function useTheme(): { pref: ThemePref; theme: "dark" | "light"; setPref: (p: ThemePref) => void; toggle: () => void } {
  const [pref, setPrefState] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref) || "system")
  const [theme, setTheme] = useState<"dark" | "light">(() => resolveTheme((localStorage.getItem(KEY) as ThemePref) || "system"))

  useEffect(() => {
    const t = resolveTheme(pref)
    setTheme(t)
    document.documentElement.dataset.theme = t
    document.documentElement.style.colorScheme = t
    const mq = window.matchMedia("(prefers-color-scheme: light)")
    const onChange = (): void => {
      if (pref === "system") {
        const nt = resolveTheme("system")
        setTheme(nt)
        document.documentElement.dataset.theme = nt
        document.documentElement.style.colorScheme = nt
      }
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [pref])

  const setPref = (p: ThemePref): void => {
    localStorage.setItem(KEY, p)
    setPrefState(p)
  }
  const toggle = (): void => setPref(theme === "dark" ? "light" : "dark")

  return { pref, theme, setPref, toggle }
}
