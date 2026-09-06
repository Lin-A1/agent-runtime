export type CompletionKind = "slash" | "mention"
export type CursorCompletion = { kind: CompletionKind; query: string; start: number; end: number }

export function cursorCompletion(value: string, cursor: number): CursorCompletion | null {
  const bounded = Math.max(0, Math.min(value.length, cursor))
  const before = value.slice(0, bounded)
  const match = before.match(/(^|\s)([\/@])([^\s]*)$/)
  if (!match) return null
  const marker = match[2]
  return { kind: marker === "/" ? "slash" : "mention", query: match[3], start: bounded - match[0].length + match[1].length, end: bounded }
}

export function replaceCompletion(value: string, completion: CursorCompletion, token: string): { value: string; cursor: number } {
  if (completion.start < 0 || completion.end < completion.start || completion.end > value.length) return { value, cursor: Math.max(0, Math.min(value.length, completion.end)) }
  const next = value.slice(0, completion.start) + token + value.slice(completion.end)
  return { value: next, cursor: completion.start + token.length }
}
