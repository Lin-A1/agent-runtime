/** Identity is independent of timestamps, including turns started in one tick. */
export function updateOwnedTurn<T extends { promptId: string }>(
  turns: ReadonlyMap<string, T>,
  sessionId: string,
  promptId: string,
  update: (turn: T) => T,
): ReadonlyMap<string, T> {
  const current = turns.get(sessionId)
  if (!current || current.promptId !== promptId) return turns
  const next = new Map(turns)
  next.set(sessionId, update(current))
  return next
}
