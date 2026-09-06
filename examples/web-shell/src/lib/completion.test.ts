import { describe, expect, it } from "bun:test"
import { cursorCompletion, replaceCompletion } from "./completion"

describe("composer completion parser", () => {
  it("finds slash and mention tokens near the cursor", () => {
    expect(cursorCompletion("请运行 /bu", 7)).toEqual({ kind: "slash", query: "bu", start: 4, end: 7 })
    expect(cursorCompletion("look @skill:doc", 15)).toEqual({ kind: "mention", query: "skill:doc", start: 5, end: 15 })
  })

  it("does not treat punctuation or earlier completed tokens as active", () => {
    expect(cursorCompletion("路径/@file", 9)).toBeNull()
    expect(cursorCompletion("/one done", 9)).toBeNull()
    expect(cursorCompletion("第一行\n@file", 9)).toEqual({ kind: "mention", query: "file", start: 4, end: 9 })
  })

  it("replaces only the token around the cursor and preserves surrounding text", () => {
    const target = cursorCompletion("前缀 /bu 后缀", 6)
    expect(target).toEqual({ kind: "slash", query: "bu", start: 3, end: 6 })
    expect(replaceCompletion("前缀 /bu 后缀", target!, "/build ")).toEqual({ value: "前缀 /build  后缀", cursor: 10 })
  })
})
