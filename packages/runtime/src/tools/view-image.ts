import { readFile } from "node:fs/promises"
import { resolveInWorkspace } from "./path"
import { fail, isLikelyBinary } from "./common"
import type { Tool, ToolCtx } from "@newhorse/core"

const MAX_IMAGE_BYTES = 5_000_000

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

/**
 * View a local image file and attach it as a base64 payload into the tool
 * result, so the model can inspect screenshots, designs, or generated assets
 * (codex view_image / ZCode multimodal intake pattern).
 *
 * Sandboxed to the workspace; non-image extensions are refused; size capped at
 * 5MiB. sideEffects: false (pure read).
 */
export function createViewImageTool(workspace: string): Tool {
  return {
    name: "view_image",
    sideEffects: false,
    description: `Read a local image file and return its mime type + base64 data for visual inspection. Supported formats: png, jpg/jpeg, webp, gif (max 5MB). Path under workspace: ${workspace}`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the image file (relative to workspace root)." },
      },
      required: ["path"],
    },
    execute: async (input: unknown, _ctx?: ToolCtx) => {
      const { path } = (input ?? {}) as { path?: string }
      if (!path) return fail("path is required")
      const ext = (path.split(".").pop() ?? "").toLowerCase()
      const mime = EXT_MIME[ext]
      if (!mime) return fail(`unsupported image extension: .${ext} (supported: png, jpg, jpeg, webp, gif)`)
      try {
        const abs = await resolveInWorkspace(workspace, path)
        const buf = await readFile(abs)
        if (buf.byteLength > MAX_IMAGE_BYTES) {
          return fail(`image file too large: ${buf.byteLength} bytes (max ${MAX_IMAGE_BYTES} bytes)`)
        }
        const data = buf.toString("base64")
        return {
          path,
          mime,
          size: buf.byteLength,
          data,
        }
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    },
  }
}
