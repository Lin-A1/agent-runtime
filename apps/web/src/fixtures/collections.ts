/**
 * Fixture collections for the remaining surfaces: approvals, schedules,
 * dags, usage, memory, live directory, fs tree / file content, skills,
 * agents, commands, and per-session todos/goal/context. Every shape mirrors
 * its §5.1 endpoint response field-for-field.
 */
import type {
  AgentInfo,
  ApprovalRequest,
  CommandInfo,
  ContextView,
  DagStatus,
  FileContent,
  FsEntry,
  GoalView,
  LiveView,
  MemoryRecord,
  Schedule,
  SkillInfo,
  TodoItem,
  UsageSummary,
} from "../api/types"
import { ago, hoursAgo, daysAgo } from "./util"
import { BUTLER_NH } from "./sessions"

// --- approvals (PendingApproval: ApprovalRequest + createdAt/expiresAt) ---

export function buildApprovals(): ApprovalRequest[] {
  const created = ago(4)
  return [
    {
      id: "apr-001",
      kind: "command",
      target: "git mv packages/runtime/src/events.db packages/runtime/src/store/events.db",
      decision: "ask",
      reason: "该命令会移动受版本控制的文件，strict 策略下需要确认。",
      createdAt: created,
      expiresAt: created + 120_000,
    },
    {
      id: "apr-002",
      kind: "path",
      target: "packages/server/src/main.ts",
      decision: "ask",
      reason: "子代理请求写入工作区外已登记的敏感文件。",
      createdAt: ago(2),
      expiresAt: ago(2) + 120_000,
    },
  ]
}

// --- schedules (Schedule) ---

export function buildSchedules(): Schedule[] {
  return [
    {
      id: "sch-morning-report",
      sessionId: BUTLER_NH,
      prompt: "汇总昨天的 git 提交与未完成 todo，生成早报。",
      enabled: true,
      dailyAt: "09:00",
      createdAt: daysAgo(18),
      lastRunAt: hoursAgo(26),
      lastResult: "ok",
    },
    {
      id: "sch-flaky-watch",
      sessionId: "sess-nh-s4",
      prompt: "重跑 usage 聚合测试，如果失败把失败摘要记进 memory。",
      enabled: true,
      intervalMinutes: 30,
      createdAt: daysAgo(6),
      lastRunAt: ago(12),
      lastResult: "error",
      lastError: "目标会话正忙（busy），入站被拒绝。",
    },
    {
      id: "sch-weekly-dag",
      sessionId: BUTLER_NH,
      prompt: "用 DAG 并行检查五个包的 typecheck，汇总失败项。",
      enabled: false,
      cron: "0 9 * * 1",
      createdAt: daysAgo(30),
      lastRunAt: daysAgo(7),
      lastResult: "ok",
    },
  ]
}

// --- dags (DagStatus; all six node states represented) ---

export function buildDags(): DagStatus[] {
  return [
    {
      dagId: "dag-frontend-wiring",
      done: false,
      startedAt: ago(18),
      nodes: [
        { node: "spec-audit", state: "succeeded", model: "glm-4.6-flash" },
        { node: "api-stubs", state: "succeeded", model: "glm-4.6-flash" },
        { node: "transcript-fold", state: "running", model: "claude-sonnet-4-5" },
        { node: "sidepanes", state: "running", model: "glm-4.6-flash" },
        { node: "settings-page", state: "pending" },
        { node: "screenshots", state: "pending" },
        { node: "mobile-fallback", state: "skipped" },
        { node: "tauri-package", state: "aborted" },
      ],
    },
    {
      dagId: "dag-review-sweep",
      done: true,
      startedAt: daysAgo(2),
      nodes: [
        { node: "collect-changes", state: "succeeded", model: "glm-4.6-flash" },
        { node: "review-core", state: "succeeded", model: "claude-sonnet-4-5" },
        { node: "review-runtime", state: "failed", model: "claude-sonnet-4-5" },
        { node: "review-server", state: "succeeded", model: "glm-4.6-flash" },
        { node: "summarize", state: "succeeded", model: "claude-sonnet-4-5" },
      ],
    },
    {
      dagId: "dag-docs-sync",
      done: true,
      startedAt: daysAgo(9),
      nodes: [
        { node: "scan", state: "succeeded", model: "glm-4.6-flash" },
        { node: "rewrite", state: "succeeded", model: "glm-4.6-flash" },
        { node: "linkcheck", state: "succeeded", model: "glm-4.6-flash" },
      ],
    },
  ]
}

// --- usage (UsageSummary) ---

export function buildUsage(): UsageSummary {
  const days: UsageSummary["days"] = []
  for (let i = 29; i >= 0; i--) {
    const date = new Date(daysAgo(i))
    const weekday = date.getDay()
    const active = weekday !== 0 && weekday !== 6 || i < 6
    const wave = Math.sin(i / 3.2) * 0.5 + 0.5
    const scale = active ? 0.35 + wave * 0.65 : 0.08
    const input = Math.round(180_000 * scale * (0.7 + ((i * 37) % 10) / 22))
    const output = Math.round(input * 0.12)
    days.push({
      day: date.toISOString().slice(0, 10),
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: Math.round(input * 0.4),
      cacheWriteTokens: Math.round(input * 0.08),
      reasoningTokens: Math.round(output * 0.5),
      cost: Math.round((input * 0.000003 + output * 0.000015) * 1000) / 1000,
      steps: Math.round(14 + scale * 60),
      byModel: {
        "claude-sonnet-4-5": { inputTokens: Math.round(input * 0.72), outputTokens: Math.round(output * 0.8) },
        "glm-4.6-flash": { inputTokens: Math.round(input * 0.28), outputTokens: Math.round(output * 0.2) },
      },
    })
  }
  const totals = days.reduce(
    (acc, d) => ({
      inputTokens: acc.inputTokens + d.inputTokens,
      outputTokens: acc.outputTokens + d.outputTokens,
      cacheReadTokens: (acc.cacheReadTokens ?? 0) + d.cacheReadTokens,
      cacheWriteTokens: (acc.cacheWriteTokens ?? 0) + d.cacheWriteTokens,
      reasoningTokens: (acc.reasoningTokens ?? 0) + d.reasoningTokens,
      cost: Math.round((acc.cost + d.cost) * 1000) / 1000,
      steps: acc.steps + d.steps,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 0, steps: 0 },
  )
  return {
    days,
    totals,
    sessions: 12,
    sessionRows: [
      { sessionId: BUTLER_NH, model: "claude-sonnet-4-5", inputTokens: 1_240_000, outputTokens: 148_000, cacheReadTokens: 490_000, reasoningTokens: 72_000, cost: 5.96, steps: 412, lastActivity: ago(12) },
      { sessionId: "sess-nh-s6", model: "claude-sonnet-4-5", inputTokens: 620_000, outputTokens: 58_000, cacheReadTokens: 210_000, reasoningTokens: 29_000, cost: 2.71, steps: 188, lastActivity: daysAgo(12) },
      { sessionId: "sess-dsh-s1", model: "deepseek-chat", inputTokens: 480_000, outputTokens: 41_000, cacheReadTokens: 80_000, reasoningTokens: 0, cost: 0.34, steps: 96, lastActivity: daysAgo(4) },
      { sessionId: "sess-nh-s2", model: "claude-sonnet-4-5", inputTokens: 212_000, outputTokens: 26_000, cacheReadTokens: 60_000, reasoningTokens: 12_000, cost: 1.02, steps: 64, lastActivity: hoursAgo(6) },
      { sessionId: "sess-nh-s5", model: "claude-sonnet-4-5", inputTokens: 158_000, outputTokens: 19_000, cacheReadTokens: 44_000, reasoningTokens: 9_000, cost: 0.76, steps: 51, lastActivity: daysAgo(6) },
    ],
  }
}

// --- memory (MemoryRecord) ---

export function buildMemories(): MemoryRecord[] {
  return [
    {
      id: "mem-001",
      content: "用户偏好：文档示例必须给可复制的完整命令，不要伪代码或省略参数。",
      type: "instruction",
      priority: 88,
      sessionId: BUTLER_NH,
      createdAt: daysAgo(1, 14),
    },
    {
      id: "mem-002",
      content: "newhorse 仓库的类型检查必须在包目录内运行（bun typecheck），仓库根目录不接受 tsc。",
      type: "fact",
      priority: 80,
      sessionId: "sess-nh-s2",
      createdAt: daysAgo(3),
    },
    {
      id: "mem-003",
      content: "用户在视觉评审中否决过天蓝/紫罗兰/蜜桃色相与紫色粒子；配色只从 ZCode/oc-2 提取表取。",
      type: "persona",
      priority: 92,
      sessionId: BUTLER_NH,
      createdAt: daysAgo(8),
    },
    {
      id: "mem-004",
      content: "镜像同步只覆盖 packages/*；apps/web 纯前端改动不需要跑 sync-agent-runtime。",
      type: "fact",
      priority: 70,
      sessionId: "sess-nh-s4",
      createdAt: daysAgo(5),
    },
    {
      id: "mem-005",
      content: "封面 composer 的任务直达当前工作区常驻 newhorse 会话（stableSessionId 幂等）。",
      type: "episodic",
      priority: 64,
      sessionId: BUTLER_NH,
      createdAt: daysAgo(12),
    },
    {
      id: "mem-006",
      content: "Bun 1.3.14 存在 SSE 空闲断连 panic，server 侧以 : open / : keepalive 注释帧规避，升级后需重开测试。",
      type: "fact",
      priority: 76,
      sessionId: "sess-nh-child-fail",
      createdAt: daysAgo(2),
    },
  ]
}

// --- live (LiveView) ---

export function buildLive(): LiveView {
  return {
    self: "http://127.0.0.1:3927",
    live: [
      { sessionId: BUTLER_NH, endpoint: "http://127.0.0.1:3927", pid: 38212, heartbeatAt: ago(0.2) },
      { sessionId: "sess-nh-child-run", endpoint: "http://127.0.0.1:3927", pid: 38212, heartbeatAt: ago(0.4) },
      { sessionId: "sess-nh-child-block", endpoint: "http://127.0.0.1:3927", pid: 38212, heartbeatAt: ago(0.6) },
      { sessionId: "sess-dsh-s2", endpoint: "http://127.0.0.1:3931", pid: 41008, heartbeatAt: ago(1.5) },
    ],
  }
}

// --- fs tree + file content ---

export function buildFsRoot(): FsEntry[] {
  return [
    { name: "apps", dir: true },
    { name: "docs", dir: true },
    { name: "packages", dir: true },
    { name: "scripts", dir: true },
    { name: "specs", dir: true },
    { name: "AGENTS.md", dir: false },
    { name: "handoff.md", dir: false },
    { name: "package.json", dir: false },
    { name: "bun.lock", dir: false },
    { name: "README.md", dir: false },
  ]
}

export function buildFsPackages(): FsEntry[] {
  return [
    { name: "schema", dir: true },
    { name: "core", dir: true },
    { name: "llm", dir: true },
    { name: "plugin", dir: true },
    { name: "memory", dir: true },
    { name: "mcp", dir: true },
    { name: "runtime", dir: true },
    { name: "server", dir: true },
    { name: "sdk", dir: true },
    { name: "cli", dir: true },
  ]
}

export function buildFile(path: string): FileContent {
  if (path.endsWith("config.ts") || path.includes("dag-api")) {
    return {
      path,
      size: 18_420,
      encoding: "utf8",
      truncated: false,
      content: [
        "import { Database } from 'bun:sqlite'",
        "import { join } from 'node:path'",
        "",
        "export interface DagNodeStatus {",
        "  readonly node: string",
        "  readonly state: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted'",
        "  readonly model?: string",
        "}",
        "",
        "export interface DagStatus {",
        "  readonly dagId: string",
        "  readonly nodes: DagNodeStatus[]",
        "  readonly done: boolean",
        "  readonly startedAt?: number",
        "}",
        "",
        "/** Fold DAG events for one aggregate into node statuses. */",
        "function foldStatus(dagId: string, rows: StoredEventRow[]): DagStatus | undefined {",
        "  if (rows.length === 0) return undefined",
        "  const nodes = new Map<string, DagNodeStatus>()",
        "  let done = true",
        "  for (const r of rows) {",
        "    const d = r.data as { node?: string; model?: string }",
        "    if (!d.node) continue",
        "    let state: DagNodeStatus['state'] = 'pending'",
        "    if (r.type === 'DAG.NodeStarted') state = 'running'",
        "    nodes.set(d.node, { node: d.node, state, ...(d.model ? { model: d.model } : {}) })",
        "  }",
        "  return { dagId, nodes: [...nodes.values()], done }",
        "}",
      ].join("\n"),
    }
  }
  return {
    path,
    size: 2_048_576 + 1,
    encoding: "utf8",
    truncated: true,
    content: ["# newhorse", "", "model-agnostic, non-captive agent engine.", "", "## 开发", "", "默认端口 3927……", "（文件超过 2MB，已截断显示）"].join("\n"),
  }
}

// --- capabilities ---

export function buildSkills(): SkillInfo[] {
  return [
    { name: "browser-use:control-browser", description: "主代理浏览器自动化：导航、点击、输入、截图验证。", path: "plugins/browser-use/skills/control-browser/SKILL.md" },
    { name: "document-skills:pdf", description: "PDF 报告/海报/论文工作流与处理。", path: "plugins/document-skills/skills/pdf/SKILL.md" },
    { name: "document-skills:docx", description: "DOCX 创建、修订、评论与文本提取。", path: "plugins/document-skills/skills/docx/SKILL.md" },
    { name: "gsap-timeline", description: "GSAP 时间线编排与关键帧 choreography。", path: "skills/gsap-timeline/SKILL.md" },
    { name: "skill-creator", description: "创建与迭代 SKILL.md。", path: "plugins/skill-creator/skills/skill-creator/SKILL.md" },
  ]
}

export function buildAgents(): AgentInfo[] {
  return [
    { name: "newhorse", description: "常驻主会话：读文件、跑工具、拆分子代理并行推进、汇总结果。", model: "claude-sonnet-4-5", role: "butler", allowedTools: ["spawn_agent", "send_to_session", "followup_task", "wait_agent", "declare_dag", "Read", "Bash", "Edit"] },
    { name: "code-reviewer", description: "只读审查：diff 读、测试跑、不改文件。", model: "glm-4.6-flash", allowedTools: ["Read", "Grep", "Glob", "Bash"] },
    { name: "test-writer", description: "为改动补测试并运行。", model: "glm-4.6-flash", allowedTools: ["Read", "Write", "Edit", "Bash"] },
  ]
}

export function buildCommands(): CommandInfo[] {
  return [
    { name: "compact", description: "立即压缩当前会话上下文" },
    { name: "review", description: "对本轮文件改动做一次审查" },
    { name: "export", description: "把转录导出为 Markdown" },
    { name: "usage", description: "显示本会话用量" },
    { name: "fork", description: "从当前位置分叉会话" },
  ]
}

// --- per-session surfaces ---

export function buildTodos(): TodoItem[] {
  return [
    { content: "读 README 现状与截图要求", status: "completed" },
    { content: "编写开发指引段落", status: "completed" },
    { content: "修正端口号的过期描述", status: "completed" },
    { content: "跑 typecheck 验证", status: "in_progress" },
    { content: "统一 docs 标题层级（被中断）", status: "pending" },
  ]
}

export function buildGoal(): GoalView {
  return { objective: "前端外壳八页四态交付", status: "active", tokenBudget: 500_000, tokensUsed: 182_400 }
}

export function buildContext(): ContextView {
  return { chars: 68_400, estTokens: 24_100, windowTokens: 200_000, ratio: 0.12 }
}
