import { fail } from "./common"
import type { Tool, ToolCtx } from "@newhorse/core"

/**
 * Ask the operator a question mid-turn (opencode question / codex
 * request_user_input analog): the question rides the SAME interactive
 * approval surface as execpolicy prompts — the client renders options as
 * buttons, the answer text comes back to the tool as its result.
 *
 * Graceful degradation (seam discipline): no interactive channel (non-UI
 * session, DAG child) → a normal result telling the model to decide itself,
 * never a hang; unanswered after the hub timeout → the hub auto-denies and
 * the tool reports it, so the turn always continues.
 */
export function createAskUserTool(): Tool {
  return {
    name: "ask_user",
    sideEffects: true, // a request, not an execution — the operator decides
    description:
      "Ask the user a question when you genuinely cannot decide yourself (ambiguous requirement, destructive choice, missing preference). Args: { question, options?: string[] } — options render as clickable choices; the operator's answer is returned as the tool result. Use sparingly — prefer making a reasonable assumption and noting it.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user (one focused question)." },
        options: { type: "array", description: "Optional choices the user can pick from (2-4 short labels).", items: { type: "string" } },
      },
      required: ["question"],
    },
    execute: async (input: unknown, ctx?: ToolCtx) => {
      const { question, options } = (input ?? {}) as { question?: string; options?: string[] }
      const trimmed = question?.trim()
      if (!trimmed) return fail("question is required")
      // Sanitize choices: keep 2-4 non-empty, short (≤60 chars) labels; if fewer
      // than 2 survive, drop options entirely (the operator can still answer free-
      // form). A garbage options array must never surface raw whitespace/empties.
      const clean = Array.isArray(options)
        ? options.map((o) => (typeof o === "string" ? o.trim() : "")).filter((o) => o.length > 0 && o.length <= 60).slice(0, 4)
        : []
      if (!ctx?.askUser) {
        return { question: trimmed, answer: "（无交互通道——用户不可达。请基于当前信息自行决定，并在回答中注明你的假设。）", interactive: false }
      }
      const res = await ctx.askUser({
        question: trimmed,
        ...(clean.length >= 2 ? { options: clean } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...(ctx.promptId ? { promptId: ctx.promptId } : {}),
        ...(ctx.toolName ? { tool: ctx.toolName } : {}),
        ...(ctx.toolCallId ? { callId: ctx.toolCallId } : {}),
      })
      if (!res.allow) {
        return { question, answer: "（用户未作答或已拒绝——按最保守的合理假设继续，并在回答中注明。）", interactive: true }
      }
      return { question, answer: res.reply?.trim() ? res.reply : "（用户同意）", interactive: true }
    },
  }
}
