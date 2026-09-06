import { expect, test } from "bun:test"
import { consumePromptStream, StreamInterruptedError } from "./client"

function response(chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift()
      if (chunk === undefined) return controller.close()
      controller.enqueue(new TextEncoder().encode(chunk))
    },
  }))
}
const handlers = { onEvent: () => {} }

test("EOF without a framed terminal is interrupted, including malformed terminals", async () => {
  for (const text of ["", ': open\n\n', 'data: {"type":"text","text":"partial"}\n\n', 'data: {bad}\n\n', 'data: {"type":"done"}\n\n', 'data: [DONE]']) {
    await expect(consumePromptStream(response([text]), handlers)).rejects.toBeInstanceOf(StreamInterruptedError)
  }
})

test("done, result, and DONE are legitimate completion boundaries", async () => {
  for (const type of ["done", "result"]) {
    expect(await consumePromptStream(response([`data: {"type":"${type}","finish":"length"}\n\n`]), handlers)).toEqual({ finish: "length" })
  }
  expect(await consumePromptStream(response(['data: [DONE]\n\n']), handlers)).toEqual({ finish: "stop" })
})

test("CRLF chunk boundaries do not prematurely dispatch frames", async () => {
  const seen: unknown[] = []
  expect(await consumePromptStream(response(['data: {"type":"result",\r', '\n', 'data: "finish":"stop"}\r', '\n\r', '\n']), { onEvent: (event) => seen.push(event) })).toEqual({ finish: "stop" })
  expect(seen).toEqual([{ type: "result", finish: "stop" }])
})

test("abort during pending read cancels and releases reader", async () => {
  const ctrl = new AbortController()
  let cancelled = false
  const res = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  const pending = consumePromptStream(res, { ...handlers, signal: ctrl.signal })
  ctrl.abort()
  await expect(pending).rejects.toHaveProperty("name", "AbortError")
  expect(cancelled).toBe(true)
  expect(res.body?.locked).toBe(false)
})

test("terminal sentinel cancels open source; callback failures are not swallowed", async () => {
  let cancelled = false
  const res = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')) },
    cancel() { cancelled = true },
  }))
  await consumePromptStream(res, handlers)
  expect(cancelled).toBe(true)
  expect(res.body?.locked).toBe(false)
  await expect(consumePromptStream(response(['data: {"type":"text","text":"x"}\n\n']), { onEvent() { throw new Error("consumer failed") } })).rejects.toThrow("consumer failed")
})
