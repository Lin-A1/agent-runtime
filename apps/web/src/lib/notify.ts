/**
 * Turn-completion notifications: when a reply lands while the user is looking
 * somewhere else (another tab, phone locked, different session), surface it
 * through the Notification API + a title flash so scheduled prompts and
 * background agents actually reach a human.
 *
 * Permission is requested lazily (first eligible notification while hidden) —
 * a permission prompt on page load is hostile. Everything degrades silently
 * where notifications don't exist (old webviews).
 */

const TITLE_BASE = "newhorse"
let flashTimer: ReturnType<typeof setInterval> | null = null
let flashOn = false

export function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationSupported()) return "unsupported"
  return Notification.permission
}

/** Ask once, from a user gesture, when the user opts in (settings/entry). */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationSupported()) return "unsupported"
  if (Notification.permission !== "default") return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return "denied"
  }
}

/** Stop the title flash and restore the plain title. */
function stopFlash(): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  if (flashOn) {
    document.title = TITLE_BASE
    flashOn = false
  }
}

function startFlash(label: string): void {
  if (flashTimer) return
  let on = false
  flashTimer = setInterval(() => {
    on = !on
    document.title = on ? `🔔 ${label}` : TITLE_BASE
    flashOn = true
  }, 1200)
  // The moment the user comes back, the flash has done its job.
  window.addEventListener(
    "focus",
    () => stopFlash(),
    { once: true },
  )
}

/**
 * Notify for a finished turn — only when the page is hidden OR a DIFFERENT
 * session is being viewed (a user watching this exact conversation does not
 * need a toast about it). Fires the system notification (where supported and
 * permitted) and flashes the tab title (works everywhere).
 */
export function notifyTurnDone(sessionId: string, summary: string, opts?: { viewedSessionId?: string; isError?: boolean }): void {
  const watchingThisSession = opts?.viewedSessionId === sessionId && !document.hidden
  if (!watchingThisSession) startFlash(opts?.isError ? "回合出错" : "新回复")
  if (watchingThisSession) return
  if (!notificationSupported() || Notification.permission !== "granted") return
  try {
    const n = new Notification(opts?.isError ? "newhorse · 回合出错" : "newhorse · 新回复", {
      body: summary.slice(0, 140) || "任务已完成",
      tag: sessionId, // one notification per session — replaces, never stacks
      silent: false,
    })
    // Clicking focuses the tab (deep-link back into the app).
    n.onclick = () => {
      window.focus()
      n.close()
    }
    setTimeout(() => n.close(), 8000)
  } catch {
    // Some webviews throw on constructor despite feature-detect — degrade to
    // title-flash only.
  }
}
