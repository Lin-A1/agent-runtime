# Runtime 对标：newhorse × ZCode × codex — 上下文管理 / Loop 工程 / 工具 / Harness 工程

> 2026-09-01。方法与证据等级：**newhorse** = 本仓库源码逐文件核实（包路径+行号）；**ZCode** = D:\ZCode 安装包 `resources/glm/zcode.cjs`（12.6MB 单文件，claude-code 同构；minified 但符号名可读，本文引用的函数名/常量均从 bundle 解出）；**codex** = G:/temp/codex（codex-rs 源码，path+symbol 级证据，由探索轮产出）。三家都是「外层会话循环 + 内层 turn（采样→工具→再采样）」的同构体，差异在细节哲学——这正是本文的题材。

## 0. 一页总览

| 维度 | newhorse | codex | ZCode |
|---|---|---|---|
| 状态权威 | SQLite 事件日志（append-only, seq 单调），投影出一切 | rollout JSONL + sqlite state DB + thread-store | claude-code 式会话日志 + 事件流 |
| 输入模型 | **durable admission inbox**（steer/queue，幂等、重启不丢） | 内存 submission 队列（cap 512）+ turn-scoped pending_input | 内存队列 |
| 步数预算 | **有**（MAX_STEPS + 带内提醒） | 无（仅 token 预算提醒） | 无 |
| 压缩 | 触发式（60% 窗口字符近似）+ 宿主注入 LLM 摘要器，投影式（摘要标记，日志不动） | 90% 窗口 token 级，预采样+mid-turn 双触发，**CompactedItem 替换历史**；本地 LLM 摘要 + 可选 remote V2 | 双层：**microcompact**（清旧工具结果，时间/压力双触发）+ autoCompact（95% 窗口）；rapid-refill 熔断 |
| 单条工具输出截断 | **无（已知缺口）** | truncation_policy 默认 bytes(10k)，exec 硬顶 1MiB | Bash 30k 字符（env 可调 15 万）、Task 截尾 |
| 子代理 | butler spawn 真驱动 + 结果 promote 回父收件箱；**declare_dag 声明式图调度** | spawn_agent V1/V2 多线程会话 + 跨代理邮箱 + Guardian 评审子代理 | Task 子代理分型 |
| 审批/沙箱 | execpolicy fail-closed（危险命令地板不可放宽）+ 三档 policy + 审批托盘 | AskForApproval 四模式 + **OS 级沙箱**（Seatbelt/Landlock+seccomp/Windows）+ Starlark execpolicy（可持久化修正） | claude-code 权限档 + 桌面审批 |
| hooks | stop / pre-tool-use（插件注册，错误隔离=allow） | **12 事件** × Command/McpTool/Prompt/Agent × Sync/Async，hooks.toml + 信任哈希 | PreToolUse / PostToolUse（claude-code 面） |
| 模型接入 | 四轴 Route：openai / openai-responses / anthropic 一个词汇表 + 预设原子切换 | **Responses API only**（chat 已移除）+ WS 传输降级 + Bedrock/Ollama/LMStudio | 绑定其账号/套餐体系 |
| 多壳 | server(HTTP/SSE) / CLI | tui / exec / app-server / mcp-server / exec-server | 桌面(Electron) / CLI |

---

## 1. Loop 工程

### newhorse（core/agent/loop.ts）
外层 `runSession`（loop.ts:110）按圈驱动到结算：**晋升收件箱（steer 全部、queue 一条）→ 结算残留工具（防畸形历史）→ goal 预算闸门（超限注入 steer + blocked + 停）→ compaction 触发检查 → 投影构建请求 → runTurn → stop hook（可 block 注入 steer 强制续步）**。内层 `runTurn`（loop.ts:257）：流式采样（事件实时外发；取消时已缓冲部分先落日志）→ assistant 消息落日志（带 model 标注）→ `ModelCalled` 轨迹 → 工具并发执行（`Promise.allSettled`，按调用序配对落日志）→ `StepEnded`。退出条件：`needsContinuation = toolCalls.length > 0`——**最后说话的永远是模型**。步数预算 MAX_STEPS + 剩 5 步带内提醒（故意不走 system 前缀，保缓存锚点）。

### codex（core/src/session/turn.rs）
`Session` = 有界提交队列（cap 512）+ 无界事件通道 + `submission_loop` 消费 `Op` 枚举（Interrupt/TurnInput/Compact/ThreadRollback/InterAgentCommunication/Review/...）。任务抽象 `SessionTask` trait（Regular/Compact/Review/UserShellCommand），**新任务替换旧任务**（`TurnAbortReason::Replaced`）。`run_turn`（turn.rs:155）：预采样压缩 → 注入技能/插件 → `loop { drain pending input(steering) → 时间/预算提醒 → 全量历史构建 → 采样 → 工具 → stop hooks → 压缩 rollover }`。中断：100ms 优雅期 → 强杀 → 中断 hooks → **历史里写 "turn aborted" 标记**。steering 三模式（StartOrSteer / Steer{expected_turn_id} / StartIfIdle）。**无步数预算**（全库搜索确认），只有 token 预算提醒片段。重试：指数退避 + WS→HTTPS 传输降级；`ContextWindowExceeded`/`UsageLimitReached` 不重试直接终止。

### ZCode（glm/zcode.cjs，解码自 bundle）
claude-code 同构主循环 + 显式事件枚举（`createSessionEvent`：CompactStarted/Completed/Failed、CompactBoundary、**MicrocompactBoundary**、RewindTriggered、CheckpointCreated、TargetChanged、**TargetCompletionVerification**、SubagentSpawned/Message/Stopped、Interrupt/Resume...）。每步带 `microcompactIfNeeded`（**PreRequest 与 MidTurn 两个相位**）+ `autoCompactIfNeeded`；有 `reactiveCompactAfterContextExceeded`（API 报窗口超限后的反应式压缩）与 **rapid-refill 熔断**（连续 3 次"压缩后立刻又满"→ 抛硬错误）。中断同样走"优雅期 + 历史标记"模式。子系统：TargetCompletionVerification（目标验证时间线，goalIteration 迭代）——一个"验收官"循环。

### 判读
- **同构点**：三家的中断语义都是"优雅取消 + 历史标记"（我们的等价物：未结算工具标 `Tool execution interrupted`）；steering 都是"进队 → 下一采样边界晋升"。
- **newhorse 独有**：durable admission（admit 幂等、重启重建——codex/zcode 的队列是内存态，靠 rollout 重建但那是恢复不是常驻语义）；步数预算；**声明式 DAG**（codex 的多代理是 spawn+邮箱，图是运行中长出来的；我们支持提前画图 + `resumeDag`）。
- **codex 独有可借**：任务替换语义（新输入 abort 旧任务而非排队——我们现在是 queue）；turn 挂起跨 worker 恢复（suspend_turn_and_shutdown）；重试的传输降级。
- **AGENTS.md 旧断言修正**："codex shells out to remote compaction" 已过时——当前 main 本地内联压缩（`run_inline_auto_compact_task`）是主路径，remote V2 是可选。

## 2. 上下文管理

### newhorse
日志全量（SQLite 事件）+ `projectCompacted` 投影。触发：可见历史 > `compactLimit`（窗口 tokens × 2.5 字符/token × **60%**，未配置窗口兜底 80k 字符；loop.ts:415-421）。折叠：保留尾巴 ≤12 条 **且** ≤窗口 30%（兜底 30k 字符），至少留最新一轮（compaction.ts:56-86）；头部交宿主注入的 `compactSummarize`（app.ts:620：≤200 词 LLM 摘要，source:"compaction" 记账）。投影丢弃边界前的一切、摘要标记顶上——**日志不动，请求窗口被界定**；可重复触发只折新头部。图片老化：只随最后一条用户消息注入。已知缺口：**无单条工具输出截断**；预算是字符近似。

### codex
每轮 `clone_history().for_prompt()` 全量重建 + `store:false` + **加密 reasoning 回放**（`reasoning.encrypted_content` 随 rollout 重放——本地权威，不靠服务端存对话）；per-thread `prompt_cache_key` 做 provider 侧缓存亲和（app.ts 同款考量：我们靠稳定 system 前缀）。持久化 rollout JSONL + sqlite + thread-store。压缩：阈值 = 窗口 **90%**（per-model 可覆盖，scope 可选 Total / BodyAfterPrefix）；**预采样 + mid-turn 双触发** + 手工 Compact（作为 Task 运行）；LLM 摘要（"handoff summary for another LLM"，输入截 20k tokens），产出 `CompactedItem` **替换**历史（带 window_id 链）；mid-turn 压缩会把初始上下文重注入到最后一条 user 消息前。**单条截断是模型驱动策略**（`ModelInfo.truncation_policy` 默认 bytes(10_000)），exec 硬顶 1MiB / 10s 超时，MCP 结果另有 cap。远程压缩 V2（provider 侧 `compaction_trigger`）可选。

### ZCode
双层体系（claude-code 的 2025 形态）：
- **microcompact**（策略名 `LocalToolResultClear`）：把**旧工具结果的内容替换成占位符**（结构保留）——触发双通道：`TimeBased`（距上次 assistant 完成 > idleThresholdMinutes）或 `TokenPressure`（估算 ≥ thresholdTokens，阈值从有效窗口推导并减输出预留）；参数化 `compactableToolNames` / `clearErrorResults` / `keepRecentToolResults`（保最近 N 条）/ `minTokenSavings`（省不够就不动）；`preMicrocompactTokenCount` / `tokensSaved` 记账，事件 `MicrocompactBoundary` 落流。
- **autoCompact**：阈值 = 有效窗口 × 95%（`getAutoCompactThresholdPercent`）减输出预留；ContextLimit 触发；**reactiveCompactAfterContextExceeded** 兜 API 报错的底；**rapid-refill 熔断**（连续 3 次压缩后立刻又满 → 硬错误防死循环）。
- 另有：文件级 checkpoint/rewind；system-reminder 是一等注入通道（嵌套转义、lifecycle、isMeta、provider_visible 元数据）；系统提示 per-model 文件 + provenance 随 rollout 持久化（resume 不丢原始指令）。

### 判读与可借清单（按性价比）
1. **单条工具输出截断**（codex bytes(10k) 默认 + bash 硬顶 + 截尾保尾模式）——我们最实际的缺口，立刻可做；
2. **rapid-refill 熔断**——我们 compaction 触发是字符近似，极端情况下会连续触发；加"距上次压缩 N 轮内不再触发"的熔断；
3. **microcompact（工具结果清存）**——长工具会话性价比极高：工具结果占上下文大头，清旧结果比整段摘要便宜得多，且 TimeBased 触发很优雅；
4. 投影式 vs 替换式：我们日志不可变（fork/审计友好），codex 替换式（省空间）——**保持投影式**，这是架构选择不是缺陷；
5. （远）加密 reasoning 回放 / remote compaction——依赖 provider 能力，协议层演进再说。

## 3. 工具

### newhorse（~20 个）
内置 12：bash / edit / write / read / list / search / skill / todo_write / goal_write / goal_read / memory_search / memory_write；butler 7：list_sessions / spawn_agent / followup_task / wait_agent / interrupt / send_to_session / **declare_dag**；+ request_mode（readonly 唯一出口）。执行：并发 allSettled、按调用序配对落日志；execpolicy **fail-closed**——危险命令启发式是永远的地板，用户规则只能加严（argv[0] 伪装有专门防护）；审批 strict/readonly/trusted 三档，readonly 即 plan 语义。MCP：stdio + streamable-HTTP，fail-soft（单 server 死不阻塞会话创建）。

### codex
面大且分层：`exec_command`+`write_stdin` **统一 PTY exec（持久可续 shell 会话）**；`apply_patch` **freeform 工具（lark 语法替代 JSON 参数）**；update_plan / view_image / web_search（hosted）/ tool_search（**延迟工具发现**）；实用件（request_user_input / sleep / current_time / new_context_window / request_permissions...）；协作件 spawn_agent 等六件套（V2 namespaced）。路由 `ToolRouter` + 暴露类（Direct/Deferred/DirectModelOnly）+ namespace 合并 + **code-mode**（在 JS 环境里程序化调工具）。审批四模式（untrusted/on-request/granular/never），决策可**持久化为 execpolicy 修正**（ApprovedForSession）。沙箱三层 OS 级（Seatbelt SBPL / Landlock+seccomp 独立 launcher / Windows sandbox）。MCP 完整（工具+资源+elicitation，按提及懒加载 server，自身可作 MCP server）。

### ZCode
claude-code 17 核心工具 + 桌面扩展（`get_dir_structure` 先浅后深懒加载——我们文件树的交互范本；`view_file_in_detail` 行号片段控上下文）；Bash 输出 30k 字符截断（env 可调至 15 万）、Task 输出截尾保尾部 + `[Truncated. Full output: path]` 指路；插件 = 能力装载层（browser-use / cua / document-skills / skill-creator...）。

### 判读
我们的"内核最小 + seam 注册"方向与三者一致，工具面已够用。缺口按价值排：①**持久 shell 会话**（codex unified exec / zcode 的 Bash cwd 持久 + BashOutput/KillShell——我们 bash 是一次性 spawn，长命令和交互式命令是短板）；②单条输出截断（见上）；③审批的会话级记忆（codex ApprovedForSession——我们 allow 一次一判）；④OS 级沙箱（我们主平台是 Windows，codex 恰好有 windows-sandbox 可参考）；⑤tool_search 延迟发现（等 MCP 工具多了再做）。

## 4. Harness 工程

### 状态、恢复与迁移
- newhorse：事件溯源 = 唯一权威；fork 从用户 seq 且继承 workspace+role；审计独立聚合（ButlerAction/ExecDecision）；admission 收件箱重启重建。
- codex：rollout 三件套（JSONL+sqlite+thread-store）；resume / fork（Copied|Referenced 两种持久策略）/ ThreadRollback / **turn 挂起跨 worker 恢复**；系统提示 provenance 随 rollout 持久化。
- ZCode：claude-code 会话文件 + 事件流 + checkpoint/rewind（文件级，比我们会话级 fork 细——但其 git 面板自证未接完）。

### 扩展面
- hooks：我们 2 事件（stop/pre-tool-use，插件注册、错误隔离=allow）；**codex 12 事件 × 4 种 handler（Command/McpTool/Prompt/Agent）× Sync/Async**，hooks.toml 声明 + 匹配组 + 信任哈希，Stop/SubagentStop 可 block 回注续跑（与我们 stop hook 同语义但面宽得多）；ZCode 是 claude-code 的 PreToolUse/PostToolUse。
- 配置：四轴 Route + 供应商预设 + 模型目录（我们）；codex ConfigLayerStack（默认→MDM→用户 profile→项目 `.codex/config.toml`）+ feature flags；ZCode 绑账号。
- 多壳：我们 server(HTTP/SSE)+CLI；codex tui/exec/app-server/mcp-server/exec-server 五壳同核（值得学的是 **mcp-server 壳**——runtime 即 MCP 服务对外输出）；ZCode 桌面+CLI。
- 事件给 UI：codex/zcode 都是常驻事件通道订阅制；我们是 **SSE-per-prompt + 轮询**（多端实时观察的短板，预审已记暂缓桶）。

## 5. 结论

**架构判断被验证**：三家在 loop 骨架、中断语义、压缩哲学、审批闸门上高度同构——我们的骨架选择（事件溯源、投影式压缩、durable admission、seam 注册）没有跑偏，且有两个真差异化：**声明式 DAG 调度**与 **goal 预算强制**（三家都没有"预算到线引擎强制停机"的机制）。**短板集中在工程成熟度**而非架构：单条工具输出截断、持久 shell 会话、microcompact、事件订阅推送、hooks 事件面。这些全部可沿现有 seam 落地，不需要动骨架契约——与 docs/agent-runtime-integrations.md 的六波模式一致，下一波集成 wave 的候选清单就是 §2/§3 的可借清单。

## 6. 逐行处置清单（§0 表格的每一行给明确结论）

**保持不换（已占优或是架构选择）**：
- 状态权威：SQLite 不可变事件日志——三家同构，我们最严格（fork/审计免费获得）。
- 输入模型：durable admission inbox——幂等 + 重启重建，优于内存队列。
- 步数预算 + goal 强制停机：独有。
- 投影式压缩 vs 替换式：架构选择，不换（清存能力用投影实现，见下）。
- 模型接入开放性：四轴 Route vs Responses-only——非 captive 是北极星，不换。

**第七波（小件，天级，照六波模式走）——✅ 已落地（2026-09-01，记录见 docs/agent-runtime-integrations.md 第七波）**：
1. ✅ 单条工具输出截断（codex `truncation_policy` bytes 思路；截尾保头 + 指路提示，`toolOutputMaxChars` 默认 20k）。
2. ✅ rapid-refill 熔断（隔 2 轮冷却 + exhausted 旗标：折叠后仍在限上 = 尾巴无法再缩，本 drain 不再重试）。
3. ✅ **工具结果清存投影**（ZCode microcompact 的投影式实现，`clearStaleToolResults`，最近 12 条之外清存，日志不动）。
4. ✅ **反应式压缩**（provider 报 context-overflow → 折叠重试一次，二次溢出诚实抛错，MAX_STEPS 边界重抛防吞错）。
5. ✅ 顺路小件：steer 踢醒空闲会话（fire-and-forget）；goal 预算 80% 带内预警（去重键含预算值）；prompt 的 inFlight 同步置位（关闭两个竞态窗）。

**第八波（中件，周级）**：
6. 持久 shell 会话（codex `exec_command`/`write_stdin` 统一 PTY 或 ZCode BashOutput 三件套；Windows 主平台过 conpty）。
7. hooks 事件面向 codex 12 事件清单靠（PostToolUse/UserPromptSubmit/PreCompact/SessionStart...）+ hooks 声明式配置 + 信任哈希。
8. 审批细化：granular 细粒度开关、会话级记忆（ApprovedForSession）、决策持久化为 execRules 修正。
9. 任务替换语义：新 prompt 到来时可选 abort-and-replace（codex `TurnAbortReason::Replaced`；现在只有 queue）。
10. 事件订阅推送（SSE/WS feed）——多端实时观察，前端预审暂缓桶的第一顺位。

**第九波：自感知——让模型"知道自己是什么、在哪里"——✅ 已落地（2026-09-01）**

模型目前对自身一无所知（不知道自己跑在哪个模型上、配置目录在哪、上下文还剩多少、当前时间）——codex 用 `environment_context` 注入 + `get_context_remaining`/`current_time` 等工具解决了这件事，我们没有。全部数据都在 AppConfig/闭包里，零新端点：

11. ✅ **`self_status` 工具**：一次调用返回身份画像——产品角色（newhorse 常驻会话 / 普通代理 / 具名 agent 角色）、当前 model + provider kind、session id、workspace 路径、agentHome 配置目录、dataDir、审批策略、可用工具数、goal 概要。实现 = butler/builtin 工具闭包读 config，只读、sideEffects:false。
12. ✅ **`get_context_remaining`**（codex 同名语义）：返回本轮可见历史估算 tokens / 窗口余量 / compaction 边界位置——模型可以自己决定"该收尾了还是先压缩"。与 `/v1/session/:id/context` 同一测量口径。
13. ✅ **`current_time` / `sleep`**（codex 实用件）：时间感知 + 定时等待（sleep 是长任务编排的常见刚需，等价物今天只能靠空转工具凑）。
14. ✅ **environment_context 结构化注入**（codex `context/environment_context.rs` 语义）：cwd / platform / 当前时间 / 工作区名，随首轮系统上下文一次性注入（走 ensureSystemContext 既有 seam），替代模型靠猜。

**第十波：压缩工程对齐——✅ 核心四件已落地（2026-09-01），剩余为远期**

我们已有的：触发式折叠 + LLM 摘要器 + 清存投影 + 熔断 + 反应式。对标后仍缺的：

15. ✅ **usage 驱动触发 + charsPerToken 配置**：provider 上报的真实 inputTokens（anthropic 计入 cacheRead/Write——缓存会话正是字符估计失真的场景）≥ 窗口 90% 即触发；`charsPerToken` 进配置层（1..10 校验，默认 2.5），loop/self 工具//context 三处同口径。真 tokenizer 与 per-model 目录字段仍开放。
16. ✅ **mid-turn/多信号触发**：圈首检查现在吃双信号（字符估算 + provider 真实 usage），反应式压缩兜 overflow 底——与 codex 的预采样 + token_limit_reached 双触发等价。
17. ✅ **清存投影参数化（部分）**：`toolResultClearable` 白名单 + `toolResultClearErrors`（错误默认保留）已落；minTokenSavings 与时间触发（确定性投影下的轮数近似）仍开放。
18. ✅ **compact hooks**（codex PreCompact/PostCompact）：pre-compact block 跳过自动折叠（冷却仍记账）；反应式折叠无视 block（保护性操作）；post-compact 记账。HOOK_EVENTS 白名单已扩展。
19. ✅ **手工压缩入口**：`POST /v1/session/:id/compact`（busy 时 409，remote 代理，与 loop 同一摘要器）。
20. **remote compaction V2 + 加密 reasoning 回放**（codex；远期，跟随 provider 能力——前者等 provider 侧摘要 API，后者等加密 reasoning 的开放等价物）。

**第十一波：缓存命中优化——✅ 审计结论（2026-09-01）：大头早已存在**

21. ✅ **审计结论**：anthropic 协议**已有** `cache_control: ephemeral` 断点在 system 块（llm/protocol/anthropic.ts:69-73，含 cacheRead/Write token 记账与 `cacheControl:false` 逃生门）；openai 走自动前缀缓存。此前"没有主动断点管理"的判断不成立——上一轮已做好。
22. （可选深化）历史增量断点：system 断点已覆盖最大稳定前缀；历史边界断点收益随会话长度递减，暂不做。
23. **不做（评估后）**：`prompt_cache_key` 对 openai 自家是路由优化（收益边际），对第三方 openai 兼容端点有未知字段 400 风险——非 captive 定位下兼容性优先。
24. ✅ **reminder 注入位置纪律**：预算/步数提醒走历史尾部 user 消息、环境静态事实走首轮 system（不带时钟）——已有实践，代码注释已钉。

**第十二波：内置工具补齐——web_fetch 已落地（2026-09-01），其余按序**

**第十二波：内置工具补齐（新增）**

25. ✅ **`web_fetch`**：`allowWeb` 开关链（ENV NEWHORSE_ALLOW_WEB/settings/CLI）、https-only、逐跳重定向校验（302 绕过 SSRF 守卫的洞已堵）、私有/回环地址拒绝（十进制/十六进制 IP 变体含）、10s 超时 + 会话中断联动、2MiB 流式下载上限、HTML 剥离、输出截断接 loop 层。DNS rebinding 为文档化残余风险（bash 开启时本就更强）。web_search 需要搜索 API key 或 hosted 透传，待 provider 支持。
26. **`view_image`**（codex）：模型主动查看工作区图片——内容寻址附件库已有读取侧，补一个工具入口（image_preparation 的 detail 预算参考 codex）。
27. **`request_user_input`**（codex）——AskUserQuestion 类交互卡：引擎侧以审批类闸门呈现，前端渲染选项卡（前端预审 elicitation 条目的引擎半边）。
28. **`get_dir_structure`**（ZCode 桌面扩展）：先浅后深的目录懒加载（默认深 3 最大 8）——我们 `list` 是单层，文件树 UI 的正确后端。
29. **`apply_patch` freeform 工具**（codex，lark 语法）：可选——patch 编辑的专用语法比 JSON edit 更省 token 也更少格式错，等 edit 工具的错误率数据说话。

**Harness 查漏补缺（原"远期/按需"收编为正式条目，全部保持"有触发条件就做"）**：

30. **mcp-server 壳**：runtime 即 MCP 服务对外输出——契合非 captive 定位（codex `mcp-server` crate 同构）；任何 MCP 客户端都能把 newhorse 当一个工具用。
31. **Guardian 式评审子代理**（codex guardian / ZCode TargetCompletionVerification 的"验收官"循环）：代价高的操作前由独立子代理评审——与 goal 闭环天然契合，goal 生态成熟后做。
32. **turn 跨 worker 挂起恢复**（codex `suspend_turn_and_shutdown`）：与 M4 未完成的跨进程投递合流。
33. **OS 级沙箱**：execpolicy+审批之上加 OS 层（codex windows-sandbox-rs 可参考，我们主平台是 Windows）。
34. **tool_search 延迟工具发现**（codex ToolSpec::ToolSearch）：MCP 工具多了才有意义。
35. **fork Referenced 策略**（codex ForkPersistence）：大会话 fork 的空间优化（现在整段复制前缀）。
36. **per-model 系统提示 + provenance 持久化**（codex BaseInstructions）：系统提示随 model 切换、来源随日志走（resume 不丢原始指令）。
37. **传输层 WS 降级 + 退避细化**（codex Responses-over-WebSocket → HTTPS fallback）：低优先，我们已有 429/5xx×3 重试。
38. **配置分层**（codex ConfigLayerStack）：项目级配置层（`.newhorse/config` 之类）——现在 env+config+CLI 已够，目录注册成熟后做。
39. **notify 宿主回调**（codex `notify`）：turn 完成时宿主可注册回调——渠道 seam 已覆盖 webhook 出站，这里补"无渠道也想要回调"的宿主场景。


## 7. UI 按钮对齐（接线前，2026-09-01 对 apps/web 外壳的按钮级审计）

分类口径：**可接线** = 引擎端点已存在，接线日换桩即可；**外壳本地** = 客户端自足（主题/本地回显）；**引擎缺口** = UI 有按钮但引擎无对应能力 → 撤下或禁用 + 记入后续计划。

**引擎缺口 → 已禁用（保留 UI 设计，列入后续计划）**：
- 附加文件按钮（Paperclip，已禁用 + 诚实 tooltip）：需要**非图片附件 API**——内容寻址附件库已就绪，缺 mime 白名单扩展与 prompt 字段（plan：附件 API wave）。

**引擎有但 UI 此前未露 → 已补（接线即可用）**：
- 手动压缩按钮（会话页头部，POST /v1/session/:id/compact，busy 禁用）。
- 会话操作菜单（侧栏每行 ⋯）：重命名（POST title）/ 归档·取消归档（POST archive）/ 删除（双步确认，DELETE；常驻会话无归档/删除——工作区永居设计）。按钮级会话管理就此补全（§1.5 #1 的最后一角）。
- 命令面板"中断当前回合"改为**当前路由会话**（此前固定 butler id）。

**已核对为引擎对齐（无需改动）**：发送/steer/停止（admission 语义）、策略三档（POST policy）、fork（POST fork）、重载（events 重折）、审批托盘（POST approvals）、todo dock 只读（todos 模型维护，引擎无宿主写口——正确）、Schedules 表单字段（prompt+三节奏+目标会话=ScheduleInput）、DAG spec 提交（POST /v1/dag）、Memory 搜索/写入/删除、Settings 全部表单（PUT 深合并语义含密钥留空保持）、Usage 三档（days 数据客户端派生）、@提及三类（/fs /skills /agents）、Ctrl+K、远程访问二维码（客户端持有 token）。

**UI 比引擎先行、计划后续加上（保持 UI，排进 wave 计划）**：
1. 非图片文件附件 API（见上）。
2. 会话行"运行中"状态的实时性：接线后走 /events/stream（端点已建）。
3. 其余见 §6 第八/十二波剩余条目（通知、i18n、导出、granular 审批）。
