import { expect, test } from "bun:test"
import { readJsonOr400 } from "./server"

function request(chunks: string[], headers?: Record<string, string>) {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift()
      if (chunk === undefined) return controller.close()
      controller.enqueue(new TextEncoder().encode(chunk))
    },
    cancel() { cancelled = true },
  })
  return { req: new Request("http://localhost/test", { method: "POST", body, headers }), cancelled: () => cancelled }
}

test("chunked overflow without declared length cancels before parsing", async () => {
  const input = request(['{"x":"', '12345', 'never read'])
  const result = await readJsonOr400(input.req, 10)
  expect(result).toBeInstanceOf(Response)
  const response = result as Response
  expect(response.status).toBe(413)
  expect(await response.json()).toEqual({ error: "request body too large" })
  expect(input.cancelled()).toBe(true)
  expect(input.req.body?.locked).toBe(false)
})

test("declared overflow cancels and lying low length cannot bypass actual cap", async () => {
  for (const length of ["1", "100"]) {
    const input = request(['{"x":123456}', 'extra'], { "content-length": length })
    expect((await readJsonOr400(input.req, 10) as Response).status).toBe(413)
    expect(input.cancelled()).toBe(true)
  }
})

test("exact byte boundary accepts JSON and preserves empty/malformed handling", async () => {
  const text = JSON.stringify({ x: "é" })
  const size = new TextEncoder().encode(text).length
  const exact = await readJsonOr400(request([text]).req, size)
  expect(exact).toEqual({ x: "é" })
  expect((await readJsonOr400(request([text]).req, size - 1) as Response).status).toBe(413)
  const malformed = await readJsonOr400(request(["{bad}"]).req, 5)
  expect(malformed).toEqual({ error: "malformed JSON body" })
  const empty = await readJsonOr400(request([]).req, 5)
  expect(empty).toEqual({})
})
