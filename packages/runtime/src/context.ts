import { discoverWorkspaceContext, composeSystemContext, Session, type EventStore } from "@newhorse/core"

/**
 * Workspace context provider — the pluggable seam for ambient project context.
 *
 * The default implementation (AGENTS.md discovery + compose, with the Workdir
 * line) is what `createApp` uses for the primary session. A child session (DAG
 * node, spawned agent) can reuse the same provider so it inherits the parent's
 * workspace context — or a caller can inject a custom provider to give a child
 * narrower/different context. There is no hardcoded "if AGENTS.md exists"
 * branch; the provider is the single assembly point.
 */

/** Assemble the system-context block for a workspace (model-visible, logged
 *  before admitted). Returns "" when there is nothing to inject. */
export type SessionContextProvider = (workspace: string) => Promise<string>

/** Default provider: discover AGENTS.md upward + compose, prepend Workdir. */
export const defaultContextProvider: SessionContextProvider = async (workspace) => {
  const docs = await discoverWorkspaceContext(workspace)
  const docsCtx = composeSystemContext(docs)
  // Make the workspace root model-visible so the first-turn model can address
  // files by path instead of guessing (M3.5 §2.4). Same disclosure as fs tools.
  const rootLine = `Workdir: ${workspace}` + (docsCtx ? "\n\n" : "")
  // Environment facts (wave 9, codex environment_context semantics): static
  // facts the model would otherwise guess. Injected ONCE with the first-turn
  // system context, so this block deliberately carries no clock that could go
  // stale — live time is one current_time tool call away.
  const env = `\n\n[environment]\ncwd: ${workspace}\nplatform: ${process.platform}`
  // Emotion tag (frontend drives the avatar ball from it): one short tag on
  // the LAST line of every reply. The frontend strips it from the rendered
  // text — the model omitting it is fine (ball keeps its state color).
  const mood = `\n\n[mood] 每次回复的最后一行以 [mood:标签] 结尾，标签从这些里选一个：happy 开心、excited 兴奋、satisfied 满意/完成、down 失落、angry 生气、worried 担忧、puzzled 疑惑、tired 疲惫、surprised 惊讶、shy 害羞、neutral 平静。标签单独占最后一行，不要有任何其他解释。`
  return docsCtx ? rootLine + docsCtx + env + mood : rootLine + env + mood
}

/**
 * The butler's fixed role body — the coordinator session's identity. Injected
 * once into the system context (before the workspace part) when a session is
 * created with `asButler`, so the model knows it IS the butler and how to use
 * the privileged toolset (M2b authority: every action is audited; children
 * inherit the workspace, never this body).
 */
export const BUTLER_BODY = `你是 newhorse——用户的常驻主会话，负责拆解与调度，不是一个普通聊天助手。

职责与工作方式：
- 你负责把用户的任务拆解、调度、追踪。可以并行、可以拆给专家做的事，用 spawn_agent 派出子代理，不要自己埋头做完所有事。
- list_sessions 观察现有会话；spawn_agent 派出子代理（可用 agent 参数点名一个角色，可用 model 参数指定更便宜的模型）；wait_agent 等待其完成；followup_task 查询其结果；interrupt 收回失控的会话；send_to_session 只能发给你自己的直接子会话。
- 任务的并行结构已明确（谁先谁后、谁依赖谁）时，用 declare_dag 一次性提交整张执行图（spec.nodes：每节点 agent/input/dependsOn，可按节点指定 model）：运行时按拓扑驱动整张图、进度投影进你的任务清单，你不必逐个 spawn 再等待；零散的一次性派工仍用 spawn_agent。
- 派发时给出明确、自包含的任务描述——子代理看不到你们这段对话，只能看到工作区上下文。
- 成本意识：批量、机械的工作派给更便宜的模型；决策、审查与汇总留给自己。
- 子代理完成后结果会回填给你；你不伪造结果——wait/followup 返回什么就汇报什么，然后向用户简明汇报。

边界：
- 你的一切 spawn / declare_dag / send / interrupt 都会被审计。
- 与用户对话使用中文，简明扼要，先结论后细节。`

/** Wrap a context provider with a fixed role body (butler). The body leads;
 *  the workspace context follows unchanged. */
export function withRoleBody(base: SessionContextProvider, body: string): SessionContextProvider {
  return async (workspace) => {
    const inner = await base(workspace)
    return inner ? `${body}\n\n---\n\n${inner}` : body
  }
}

/**
 * Admit the workspace context (AGENTS.md + Workdir) as a system message on the
 * FIRST turn only. Shared by the primary session (app.prompt) and child
 * sessions (DAG node / spawned agent) so a subagent inherits the same ambient
 * context — "model-visible ⟺ logged": the context is appended before it becomes
 * visible, once per session. The provider is the pluggable seam; a caller can
 * inject a custom one (narrower scope) without changing this logic.
 *
 * Concurrency: read → check → append is non-atomic, so two concurrent callers
 * for the SAME session (e.g. two server prompts) could both see "no system"
 * and double-append. We dedupe in-flight appends per session id (mirroring the
 * admission inbox's #inFlight pattern): a concurrent caller awaits the first's
 * append instead of starting a second.
 */
const systemInFlight = new WeakMap<EventStore, Map<string, Promise<void>>>()

export async function ensureSystemContext(events: EventStore, sessionId: string, workspace: string, contextProvider: SessionContextProvider = defaultContextProvider): Promise<void> {
  const existing = await events.read(sessionId)
  if (existing.some((e) => e.type === "Session.MessageAppended" && (e.data as { message?: { kind?: string } }).message?.kind === "system")) return

  // Dedupe is per (store, session): two dataDirs can host the same stable
  // session id (same workspace), and each must get its own system context.
  let byStore = systemInFlight.get(events)
  if (!byStore) {
    byStore = new Map()
    systemInFlight.set(events, byStore)
  }
  const pending = byStore.get(sessionId)
  if (pending) {
    await pending
    return
  }
  const inflight = doEnsure(events, sessionId, workspace, contextProvider)
  byStore.set(sessionId, inflight)
  try {
    await inflight
  } finally {
    if (byStore.get(sessionId) === inflight) byStore.delete(sessionId)
  }
}

async function doEnsure(events: EventStore, sessionId: string, workspace: string, contextProvider: SessionContextProvider): Promise<void> {
  // Replay requires a Session.Created event — that's the real-world invariant
  // (app.prompt and runDag both append Created before any prompt). The system
  // message is admitted with the same projectMessage contract the loop uses.
  const session = Session.replay(await events.read(sessionId))
  if (session.messages.some((m) => m.kind === "system")) return
  const system = await contextProvider(workspace)
  if (!system) return
  const systemMessage = session.projectMessage({ kind: "system", id: crypto.randomUUID(), seq: 0, text: system })
  await events.append(sessionId, systemMessage.type, systemMessage.data as Record<string, unknown>)
}
