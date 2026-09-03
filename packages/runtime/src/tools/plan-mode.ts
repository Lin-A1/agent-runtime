import { fail } from "./common"
import type { Tool, ToolCtx } from "@newhorse/core"

/**
 * Enter plan mode (zcode EnterPlanMode analog): flips the session's durable
 * policy to `readonly` — file edits and commands then route through the
 * request_mode approval flow (the engine's existing exit path). The flip is
 * a durable Session.PolicyChanged event (by: "model"), so a restart keeps the
 * plan gate instead of silently widening.
 */
export function createEnterPlanModeTool(): Tool {
  return {
    name: "enter_plan_mode",
    sideEffects: true,
    description:
      "Switch this session into plan mode (read-only): file writes, edits and shell commands will require approval through request_mode. Use when the user asks for a plan before any changes, or when you want to explore safely before proposing edits. Exit by presenting the plan via request_mode.",
    inputSchema: { type: "object", properties: {} },
    execute: async (_input: unknown, ctx?: ToolCtx) => {
      if (!ctx?.setPolicy) return fail("plan mode is not available in this session (policy is host-managed)")
      await ctx.setPolicy("readonly")
      return {
        planMode: true,
        policy: "readonly",
        note: "已切换为只读规划模式：read/list/search 可直接用，write/edit/bash 需经 request_mode 审批。规划完成后用 request_mode 提交计划以退出。",
      }
    },
  }
}
