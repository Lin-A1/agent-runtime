/**
 * Fixture helpers — timestamps are offsets from load time so relative-time
 * rendering stays realistic; images are generated in-browser (no HTTP) but
 * keep the wire shape {mime, data: rawBase64} exactly (§5.5: no data: prefix
 * on the wire; imageUrl() adds it only at render).
 */
import type { StoredEventRow } from "../api/types"

const NOW = Date.now()
export const now = (): number => NOW
/** ts for an event N minutes ago. */
export const ago = (minutes: number): number => NOW - minutes * 60_000
/** ts N hours ago. */
export const hoursAgo = (h: number): number => NOW - h * 3_600_000
/** ts N days ago (same hour). */
export const daysAgo = (d: number, h = 10): number => {
  const t = new Date(NOW - d * 86_400_000)
  t.setHours(h, 15, 0, 0)
  return t.getTime()
}

let seqCounter = 0
export function ev(type: string, data: Record<string, unknown>, tsMinAgo = 0): StoredEventRow {
  seqCounter += 1
  return { seq: seqCounter, type, data, ts: ago(tsMinAgo) }
}

/** Reset the event seq counter (fixtures build multiple independent logs). */
export function resetSeq(start = 0): void {
  seqCounter = start
}

let imgCache: string | null = null
/** Draw a neutral placeholder "screenshot" and return raw base64 (no prefix). */
export function placeholderImage(label: string, tone: "light" | "dark" = "dark"): { mime: string; data: string } {
  if (imgCache === null) {
    const c = document.createElement("canvas")
    c.width = 480
    c.height = 300
    const g = c.getContext("2d")
    if (g) {
      g.fillStyle = tone === "dark" ? "#202020" : "#e8e8ea"
      g.fillRect(0, 0, 480, 300)
      g.strokeStyle = tone === "dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"
      g.lineWidth = 1
      for (let x = 0; x <= 480; x += 24) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 300); g.stroke()
      }
      for (let y = 0; y <= 300; y += 24) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(480, y); g.stroke()
      }
      g.fillStyle = tone === "dark" ? "#a0a0a0" : "#6f6f6f"
      g.font = "13px ui-monospace, monospace"
      g.fillText("attachment preview", 18, 280)
      void label
      imgCache = c.toDataURL("image/png").split(",")[1] ?? ""
    }
  }
  return { mime: "image/png", data: imgCache ?? "" }
}
