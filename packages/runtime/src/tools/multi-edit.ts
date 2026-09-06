import { readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolveInWorkspace } from "./path"
import { approve, denied, fail, isLikelyBinary } from "./common"
import type { Tool, ToolCtx } from "@newhorse/core"

export interface MultiEditItem {
  readonly old: string
  readonly new: string
  readonly replaceAll?: boolean
}

/**
 * Atomic multi-edit tool (ZCode MultiEdit / Claude Code multi-replacement):
 * applies N sequential string replacements against an in-memory buffer,
 * verifies EVERY edit succeeds (unique hit unless replaceAll), and writes to
 * disk only once at the end. An error at index i leaves the file UNTOUCHED.
 */
export function createMultiEditTool(workspace: string): Tool {
  return {
    name: "multi_edit",
    sideEffects: true,
    description: `Perform multiple exact string replacements in one file atomically. All edits are validated sequentially in memory before writing — any failure leaves the file completely untouched. Path under workspace root: ${workspace}`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit (relative to workspace root)." },
        edits: {
          type: "array",
          description: "Ordered array of { old, new, replaceAll? } replacements to apply in sequence.",
          items: {
            type: "object",
            properties: {
              old: { type: "string", description: "Exact substring to find." },
              new: { type: "string", description: "Replacement string." },
              replaceAll: { type: "boolean", description: "Replace all occurrences instead of requiring unique match." },
            },
            required: ["old", "new"],
          },
        },
      },
      required: ["path", "edits"],
    },
    execute: async (input: unknown, ctx?: ToolCtx) => {
      const { path, edits } = (input ?? {}) as { path?: string; edits?: MultiEditItem[] }
      if (!path) return fail("path is required")
      if (!Array.isArray(edits) || edits.length === 0) return fail("`edits` must be a non-empty array")

      const policy = ctx?.execPolicy
      if (!policy) return denied("denied by execpolicy: no policy available")
      try {
        const abs = await resolveInWorkspace(workspace, path)
        const decision = policy.decidePath(abs)
        if (decision === "forbid") return denied(`denied by execpolicy: ${abs}`)
        if (decision === "prompt") {
          const ok = await approve(policy, { id: randomUUID(), kind: "path", target: abs, decision: "prompt", reason: `multi_edit (${edits.length} edits)` }, ctx)
          if (!ok) return denied(`denied by execpolicy (prompt not approved): ${abs}`)
        }
        if (isLikelyBinary(abs)) return fail("refusing to edit a binary file")

        const raw = await readFile(abs, "utf8")
        const eol = raw.includes("\r\n") ? "\r\n" : "\n"
        let current = raw.split("\r\n").join("\n")
        const applied: Array<{ index: number; replaced: number }> = []

        for (let i = 0; i < edits.length; i++) {
          const item = edits[i]
          if (!item || typeof item.old !== "string" || item.old.length === 0) {
            return fail(`edit[${i}]: \`old\` must be a non-empty string`)
          }
          if (typeof item.new !== "string") {
            return fail(`edit[${i}]: \`new\` must be a string`)
          }
          if (item.old === item.new) {
            return fail(`edit[${i}]: \`old\` and \`new\` are identical`)
          }
          const matches = countMatches(current, item.old)
          if (matches === 0) {
            return fail(`edit[${i}]: \`old\` not found in content (after prior ${i} edits applied)`)
          }
          if (matches > 1 && !item.replaceAll) {
            return fail(`edit[${i}]: \`old\` matched ${matches} times — widen \`old\` or set replaceAll:true`)
          }
          current = item.replaceAll ? current.split(item.old).join(item.new) : current.replace(item.old, item.new)
          applied.push({ index: i, replaced: matches })
        }

        await writeFile(abs, eol === "\r\n" ? current.split("\n").join("\r\n") : current, "utf8")
        return { edited: abs, totalEdits: edits.length, applied }
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    },
  }
}

function countMatches(text: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let i = 0
  while (true) {
    const idx = text.indexOf(needle, i)
    if (idx === -1) break
    count += 1
    i = idx + needle.length
  }
  return count
}
