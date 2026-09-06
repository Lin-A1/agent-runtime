export function safeExternalUrl(value: string, origin = typeof window === "undefined" ? "http://localhost" : window.location.origin): string | null {
  try {
    const url = new URL(value, origin)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}
