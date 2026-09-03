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
      if (!question?.trim()) return fail("question is required")
      if (!ctx?.askUser) {
        return { question, answer: "（无交互通道——用户不可达。请基于当前信息自行决定，并在回答中注明你的假设。）", interactive: false }
      }
      const res = await ctx.askUser({ question: question.trim(), ...(options?.length ? { options } : {}) })
      if (!res.allow) {
        return { question, answer: "（用户未作答或已拒绝——按最保守的合理假设继续，并在回答中注明。）", interactive: true }
      }
      return { question, answer: res.reply?.trim() ? res.reply : "（用户同意）", interactive: true }
    },
  }
}
