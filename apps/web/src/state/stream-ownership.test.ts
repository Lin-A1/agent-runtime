import { expect, test } from "bun:test"
import { updateOwnedTurn } from "./stream-ownership"

test("late frame and final cleanup cannot change replacement with same timestamp", () => {
  const current = new Map([["s", { promptId: "new", startedAt: 1, text: "new", busy: true }]])
  expect(updateOwnedTurn(current, "s", "old", (turn) => ({ ...turn, text: "old frame" }))).toBe(current)
  expect(updateOwnedTurn(current, "s", "old", (turn) => ({ ...turn, busy: false }))).toBe(current)
  expect(updateOwnedTurn(current, "s", "new", (turn) => ({ ...turn, text: "updated" })).get("s")?.text).toBe("updated")
  expect(updateOwnedTurn(new Map(), "s", "old", (turn) => turn).size).toBe(0)
})
