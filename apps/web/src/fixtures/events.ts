/**
 * Fixture event log for the demo resident session. Covers every fold case
 * (handoff §1.6): 纯文本轮 / 多工具轮 / 工具出错 / 带图消息 / 被中断轮,
 * plus thinking blocks, todo/goal/memory/compaction notes and ModelCalled
 * trace rows. Shape = StoredEventRow[] exactly; foldTranscript() does the
 * rest — there is no hand-written message array anywhere.
 */
import type { StoredEventRow } from "../api/types"
import { ev, resetSeq, placeholderImage } from "./util"

export function buildDemoEvents(): StoredEventRow[] {
  resetSeq(0)
  const out: StoredEventRow[] = []

  // --- turn 0: PAIRED admission + promotion (dedup regression): the same
  // prompt id lands twice in a real log — the fold must render ONE turn. ---
  out.push(ev("Session.PromptAdmitted", { id: "pair-0", prompt: "先给我一个仓库速览。", delivery: "queue" }, 96))
  out.push(ev("Session.Prompted", { id: "pair-0", prompt: "先给我一个仓库速览。", delivery: "queue" }, 95))

  // --- turn 1: plain-text exploration (multi-tool, all success) ---
  out.push(ev("Session.Prompted", { prompt: "帮我看看这个仓库的结构，给一个上手摘要。" }, 92))

  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        model: "claude-sonnet-4-5",
        content: [
          { type: "thinking", text: "用户想快速了解 monorepo 结构。先用 glob 看包目录，再读根 package.json 和 AGENTS.md 定位引擎边界。" },
          { type: "tool-call", id: "call_1", name: "Glob", input: { pattern: "packages/*/package.json" } },
          { type: "tool-call", id: "call_2", name: "Read", input: { path: "package.json" } },
          { type: "tool-call", id: "call_3", name: "Read", input: { path: "AGENTS.md" } },
        ],
      },
    }, 91),
  )
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Glob", output: "packages/schema/package.json\npackages/core/package.json\npackages/llm/package.json\npackages/plugin/package.json\npackages/memory/package.json\npackages/mcp/package.json\npackages/runtime/package.json\npackages/server/package.json\npackages/sdk/package.json\npackages/cli/package.json" } }, 90))
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Read", output: '{\n  "name": "newhorse",\n  "private": true,\n  "workspaces": ["packages/*", "apps/*"]\n}' } }, 90))
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Read", output: "# AGENTS.md\n\nnewhorse is a model-agnostic, non-captive agent engine…\n(schema → core → llm → plugin → memory → mcp → runtime → server)" } }, 89))
  out.push(
    ev("Session.ModelCalled", {
      source: "turn",
      model: "claude-sonnet-4-5",
      durationMs: 8420,
      finish: "stop",
      promptChars: 9120,
      outputChars: 640,
      usage: { inputTokens: 9120, outputTokens: 640 },
    }, 89),
  )
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [
          {
            type: "text",
            text: "这是一个 Bun + TypeScript 的 monorepo，分 10 个包，依赖方向自下而上：\n\n- **schema / core**：事件溯源存储与会话骨架（`StoredEventRow`、turn loop、DAG 调度）\n- **llm**：四轴 Route（协议/端点/鉴权/帧型）与统一 `LLMRequest` 词表\n- **runtime / server**：应用服务与 HTTP/SSE 面，SDK/CLI 是纯传输层\n\n| 包 | 职责 |\n| --- | --- |\n| schema | 事件与词表 |\n| core | 会话循环 |\n| runtime / server | 编排与 HTTP/SSE |\n\n上手建议从 `AGENTS.md` 的北极星开始，再对照 `docs/architecture-map.md` 的机制地图。",
          },
        ],
      },
    }, 88),
  )

  // --- turn 2: image attachments + file edit (change card) + todos ---
  out.push(
    ev("Session.PromptAdmitted", {
      prompt: "这是设计稿截图，按它给 README 加一段开发指引，顺便把过期的端口号改掉。",
      delivery: "queue",
      attachments: [{ sha256: "fixture-sha-1", mime: "image/png", bytes: 48230 }],
      images: [placeholderImage("design-shot")],
    }, 60),
  )
  out.push(
    ev("Session.TodoUpdated", {
      todos: [
        { content: "读 README 现状与截图要求", status: "completed" },
        { content: "编写开发指引段落", status: "in_progress" },
        { content: "修正端口号 3927 → 3931 的过期描述", status: "pending" },
        { content: "跑 typecheck 验证", status: "pending" },
      ],
    }, 58),
  )
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [
          { type: "tool-call", id: "call_4", name: "Read", input: { path: "README.md" } },
          {
            type: "tool-call",
            id: "call_5",
            name: "Edit",
            input: {
              path: "README.md",
              old: "## 开发\n\n默认端口 3927，启动：\n\n```bash\nbun packages/server/src/main.ts\n```",
              new: "## 开发\n\n默认端口 3927（隔离测试用 NEWHORSE_PORT=3931 + AGENT_RUNTIME_HOME 指向临时目录）：\n\n```bash\n# 起服务\nbun packages/server/src/main.ts\n# 类型检查在包目录内跑\ncd packages/core && bun typecheck\n```",
            },
          },
        ],
      },
    }, 57),
  )
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Read", output: "# newhorse\n\nmodel-agnostic, non-captive agent engine.\n\n## 开发\n\n默认端口 3927，启动：\n\n```bash\nbun packages/server/src/main.ts\n```" } }, 56))
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Edit", output: "applied 1 edit to README.md (+4 -2)" } }, 56))
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [{ type: "text", text: "README 已更新：开发指引补了隔离测试的环境变量写法，端口示例保留默认值并标注了 3931 的测试用途。" }],
      },
    }, 55),
  )
  out.push(
    ev("Session.ModelCalled", {
      source: "turn",
      model: "claude-sonnet-4-5",
      durationMs: 12_300,
      finish: "stop",
      promptChars: 14_200,
      outputChars: 380,
      usage: { inputTokens: 14_200, outputTokens: 380, cacheReadTokens: 9120 },
    }, 55),
  )
  out.push(ev("Session.MemoryStored", { content: "用户偏好：文档示例必须带可复制的完整命令，不要伪代码。" }, 54))

  // --- turn 3: tool error (bash exits non-zero) ---
  out.push(ev("Session.Prompted", { prompt: "跑一下类型检查，看看刚才的改动有没有问题。" }, 40))
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [{ type: "tool-call", id: "call_6", name: "Bash", input: { command: "cd packages/runtime && bun typecheck" } }],
      },
    }, 39),
  )
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "tool",
        name: "Bash",
        output: { error: "exit code 2", stderr: "src/config.ts(312,7): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/dag-api.ts(88,3): error TS2304: Cannot find name 'dagRunner'." },
      },
    }, 38),
  )
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [
          { type: "thinking", text: "两个类型错误：config.ts 的端口字段被写成了字符串，dag-api.ts 漏了导入。直接修。" },
          { type: "tool-call", id: "call_7", name: "Edit", input: { path: "packages/runtime/src/config.ts", old: "port: \"3931\"", new: "port: 3931" } },
        ],
      },
    }, 37),
  )
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Edit", output: "applied 1 edit (+1 -1)" } }, 37))
  out.push(
    ev("Session.MessageAppended", {
      message: { kind: "assistant", content: [{ type: "text", text: "两个错误都修了：`port` 恢复为数字字面量，`dagRunner` 补了导入。可以重跑 typecheck。" }] },
    }, 36),
  )

  // --- turn 4: interrupted mid-run ---
  out.push(ev("Session.Prompted", { prompt: "顺手把 docs/ 下所有设计笔记的标题层级统一一下。" }, 20))
  out.push(
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [
          { type: "thinking", text: "标题层级统一涉及十几个文件，先 glob 出所有 md，再逐个检查一级/二级标题。" },
          { type: "tool-call", id: "call_8", name: "Glob", input: { pattern: "docs/**/*.md" } },
        ],
      },
    }, 19),
  )
  out.push(ev("Session.MessageAppended", { message: { kind: "tool", name: "Glob", output: "docs/architecture-map.md\ndocs/core-technology-notes.md\ndocs/product-voice.md\ndocs/frontend-pre-review.md\ndocs/agent-runtime-integrations.md" } }, 18))
  out.push(ev("Session.Interrupted", { reason: "user interrupt" }, 17))

  // --- turn 5: steer (追加) during a later run + goal + compaction notes ---
  out.push(ev("Session.GoalUpdated", { objective: "前端外壳八页四态交付", status: "active", tokenBudget: 500_000, tokensUsed: 182_400 }, 15))
  out.push(
    ev("Session.PromptAdmitted", { prompt: "补充：标题统一只动二级以下，一级标题保留。", delivery: "steer" }, 14),
  )
  out.push(ev("Session.Compacted", { reason: "auto", foldedSeq: 42, charsBefore: 78200, charsAfter: 21000 }, 12))
  out.push(
    ev("Session.ModelCalled", {
      source: "compaction",
      model: "glm-4.6-flash",
      durationMs: 4100,
      finish: "stop",
      promptChars: 78_200,
      outputChars: 6_100,
      usage: { inputTokens: 22_000, outputTokens: 1_800 },
    }, 12),
  )

  return out
}

/** Events for a child subagent session (short, settled). */
export function buildChildEvents(title: string): StoredEventRow[] {
  resetSeq(100)
  return [
    ev("Session.Prompted", { prompt: title }, 30),
    ev("Session.MessageAppended", {
      message: {
        kind: "assistant",
        content: [
          { type: "tool-call", id: "c1", name: "Grep", input: { pattern: "resumeDag", path: "packages" } },
        ],
      },
    }, 29),
    ev("Session.MessageAppended", { message: { kind: "tool", name: "Grep", output: "packages/runtime/src/dag-api.ts:120: resumeDag" } }, 28),
    ev("Session.MessageAppended", {
      message: { kind: "assistant", content: [{ type: "text", text: "已定位 `resumeDag` 在 dag-api.ts:120，重放逻辑从 DAG 聚合事件重建节点状态。" }] },
    }, 27),
  ]
}
