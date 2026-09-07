/**
 * UUID v4 helper with a fallback for non-secure contexts (http://LAN-IP):
 * `crypto.randomUUID` is only defined in secure contexts (HTTPS or
 * localhost) in some browsers — a phone reaching the shell over
 * http://192.168.1.4:3927 would crash on it. The fallback uses the Chrome
 * Secure Random (crypto.getRandomValues, available everywhere) to build a
 * spec-shaped v4 UUID.
 */
export function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  } catch {
    // fall through
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
