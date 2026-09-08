import type { Tool } from "@newhorse/core"
import type { Scheduler } from "../scheduler"

/**
 * Agent-managed scheduled prompts — the conversational twin of the settings
 * page's schedule list. "每天早上 8 点把新闻发给我" becomes a tool call, not a
 * form. Runs through the same Scheduler store the HTTP API uses, so entries
 * created here show up everywhere and survive restarts (schedules.json).
 *
 * The schedule attaches to the CALLING session (ToolCtx.sessionId) — the
 * fired prompt is admitted right back into the conversation the user asked
 * from. actions: list / add / remove / enable / disable / run.
 */
export interface ScheduleManageCtx {
  readonly scheduler: Scheduler
}

const KIND_HINT =
  "时间三选一：intervalMinutes（每 N 分钟）| dailyAt（每天 HH:MM，如 \"08:00\"）| cron（5 字段分 时 日 月 周）"

export function createScheduleManageTool(ctx: ScheduleManageCtx, label = "schedule_manage"): Tool {
  return {
    name: label,
    description:
      "管理定时任务（到点自动向当前会话发提示词）：list 列出、add 新建（intervalMinutes / dailyAt \"HH:MM\" / cron 三选一）、remove 删除、enable/disable 启停、run 立即执行一次。" +
      `用户说"每天/每小时/工作日 9 点…"这类重复请求时用本工具。${KIND_HINT}。`,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "remove", "enable", "disable", "run"], description: "操作" },
        id: { type: "string", description: "remove/enable/disable/run 的任务 id（先 list 拿到）" },
        prompt: { type: "string", description: "add：到点要执行/发送的提示词内容" },
        intervalMinutes: { type: "number", description: "add：每 N 分钟一次" },
        dailyAt: { type: "string", description: "add：每天 HH:MM（24 小时制）" },
        cron: { type: "string", description: "add：5 字段 cron（分 时 日 月 周）" },
      },
      required: ["action"],
    },
    sideEffects: true,
    execute: async (input: unknown, toolCtx) => {
      const sessionId = toolCtx?.sessionId
      if (!sessionId) return "schedule_manage 需要在会话内调用（拿不到 sessionId）"
      const { action, id, prompt, intervalMinutes, dailyAt, cron } = (input ?? {}) as {
        action?: string
        id?: string
        prompt?: string
        intervalMinutes?: number
        dailyAt?: string
        cron?: string
      }
      const brief = (s: Awaited<ReturnType<Scheduler["list"]>>[number]) => ({
        id: s.id,
        prompt: s.prompt.length > 60 ? `${s.prompt.slice(0, 60)}…` : s.prompt,
        enabled: s.enabled,
        when: s.cron ?? s.dailyAt ?? (s.intervalMinutes !== undefined ? `每 ${s.intervalMinutes} 分钟` : "?"),
        nextFireAt: s.nextFireAt ? new Date(s.nextFireAt).toLocaleString("zh-CN") : undefined,
        lastResult: s.lastResult,
      })

      if (action === "list") {
        const all = await ctx.scheduler.list()
        const mine = all.filter((s) => s.sessionId === sessionId)
        if (mine.length === 0) return "当前会话没有定时任务。用 add 新建（intervalMinutes / dailyAt / cron 三选一）。"
        return JSON.stringify(mine.map(brief), null, 2)
      }
      if (action === "add") {
        const text = prompt?.trim()
        if (!text) return "add 需要 prompt（到点要执行的内容）"
        if (!intervalMinutes && !dailyAt && !cron) return `add 需要一个时间：${KIND_HINT}`
        const created = await ctx.scheduler.add({
          sessionId,
          prompt: text,
          enabled: true,
          ...(intervalMinutes !== undefined && intervalMinutes > 0 ? { intervalMinutes } : {}),
          ...(dailyAt ? { dailyAt } : {}),
          ...(cron ? { cron } : {}),
        })
        return `已创建定时任务：\n${JSON.stringify(brief(created), null, 2)}`
      }
      if (!action || !["remove", "enable", "disable", "run"].includes(action)) {
        return `未知 action「${String(action)}」——支持 list / add / remove / enable / disable / run`
      }
      if (!id) return `${action} 需要任务 id——先 list 拿到`
      if (action === "remove") {
        const ok = await ctx.scheduler.remove(id)
        return ok ? `已删除定时任务 ${id}` : `未找到 ${id}`
      }
      if (action === "enable" || action === "disable") {
        const updated = await ctx.scheduler.update(id, { enabled: action === "enable" })
        return updated ? `已${action === "enable" ? "启用" : "停用"}：\n${JSON.stringify(brief(updated), null, 2)}` : `未找到 ${id}`
      }
      const ok = await ctx.scheduler.runNow(id)
      return ok ? `已立即执行 ${id}（结果会作为本会话的新消息出现）` : `未找到 ${id}`
    },
  }
}
