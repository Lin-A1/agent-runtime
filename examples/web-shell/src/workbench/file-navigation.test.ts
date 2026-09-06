import { describe, expect, test } from "bun:test"
import { createFileNavigation, reduceFileNavigation } from "./file-navigation"

describe("file navigation reducer", () => {
  test("tracks back and forward history", () => {
    let state = createFileNavigation()
    state = reduceFileNavigation(state, { type: "push", path: "src" })
    state = reduceFileNavigation(state, { type: "push", path: "src/main.tsx" })
    expect(state.path).toBe("src/main.tsx")
    state = reduceFileNavigation(state, { type: "back" })
    expect(state.path).toBe("src")
    state = reduceFileNavigation(state, { type: "forward" })
    expect(state.path).toBe("src/main.tsx")
  })

  test("new navigation clears forward history", () => {
    let state = createFileNavigation(".")
    state = reduceFileNavigation(state, { type: "push", path: "a" })
    state = reduceFileNavigation(state, { type: "back" })
    state = reduceFileNavigation(state, { type: "push", path: "b" })
    expect(state.forward).toEqual([])
  })
})
