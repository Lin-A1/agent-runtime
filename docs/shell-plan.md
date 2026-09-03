# newhorse 壳·重建计划（阶段 0 交付）

> 决策记录：2026-09-03 用户拍板——技术栈沿用 React + Vite + Tailwind；基础组件（ui.tsx / Markdown / EmotionBall / fold）从 git 历史抢救复用；**页面从零搭**。CLI 保持官方门面地位，壳是薄消费方。
> 本文是阶段 0 交付物：①页面/交互完整清单（每个元素 → 端点）；②端点响应合同（字段级，已对照 packages/server/src/server.ts 核实）；③逐项验收记录模板。
> **规则：每个阶段结束必须跑完对应验收清单并记录，通过才进下一阶段。**
>
> **阶段 1 实施修订（2026-09-03，用户指示"这一版再简单一点，先打通对话即可"）**：
> Phase 1 落地裁剪为**最小对话环**——左栏会话列表（butler 置顶 + 扁平任务列表 + 新任务）、转录（事件折叠 + 流式直播回合 + 工具行 + panel 内联卡 + 停止/steer）、极简 composer（文本 + 发送/停止）。§2 中 P4 的斜杠/@/图片/模型芯片、P5 右栏（审批/编排/面板流/todo）、P6 命令面板**延后到 Phase 2**（清单不变，代码已从本版移除，需要时从 git 历史 dfe01d1b6 恢复 apps/web 全量版重接）。
>
> 阶段 1 验收已通过（真实 MiniMax-M3 回合 ×3）：新任务跳转 ✓、发送 → 流式渲染 → 落账折回 ✓、busy 停止按钮 → 中断注记折回 ✓、会话自命名标题 ✓、butler 固定名置顶 ✓、panel 内联卡（web_search 表格）✓。
>
> 阶段 1 顺手修的源头问题：①fold 的"回合中追加"注记改为按序判定（引擎 prompt() 一律经 inbox steer 通道准入，标签不可区分，真 steer 的 Prompted 落在运行中回合的终止 StepEnded 之前）；②butler 种子改为创建前重读 registry（陈旧空读导致每次加载多种一个 butler）；③agent-home 配置修复——providers[0] 的 kind 实为 anthropic 协议（baseUrl 是 /anthropic 路径），补上 activeProviderId 并清除遗留 model "gpt-4o-mini"。

---

## 0. 位置与抢救清单

- 新壳位置：`apps/web`（全新搭建，旧壳在 git 历史 a5e68ea4e^ 可查）。
- **抢救复用**（已验证可用的资产，直接从历史恢复）：
  - `api/client.ts` 的骨架（ClientError + 瞬态重试 + 共享 SSE 解析器）
  - `api/fold.ts`（foldTranscript / foldTodos / deriveSubagents / sessionDisplayName / relativeTime / imageUrl）
  - `components/ui.tsx`（Modal / Toggle / Segmented / PageHeader / AsyncRegion / EmptyState / Spinner / ProgressBar / Dropdown / StatusDot / Label）
  - `components/Markdown.tsx`、`components/EmotionBall.tsx`（视觉标识）
  - `index.css` 的主题 token（明暗双色、scrim/hover/panel/card 变量）
  - `lib/theme.ts`、`lib/workspace.ts`（工作区选择）
- **从零写**：AppShell 布局、会话树、panel 卡片流、composer、全部页面结构。

## 0.1 全局架构约定

1. **总线优先**：`GET /v1/events/stream`（全局 SSE，帧 = `{sessionId, event}`）应用启动即常连；一切实时刷新由总线驱动，**不做定时轮询**（审批例外：3s 兜底 + tool 帧触发）。
2. **事件折转录**：转录从 `GET /v1/session/:id/events` 折叠，不从消息快照——panel/thinking/tool 全在日志里。
3. **错误合同统一**：`{error: string}` + 状态码；client 层归一为 ClientError(status, body)，只对传输层瞬态错误重试（3 次 500ms 倍增），4xx/5xx 不重试。
4. **会话树**：`origin: "dag"|"spawn"` + `parentId` 把子会话归组到声明者名下；常驻会话（role=butler）固定显示名 "newhorse" 且置顶。
5. **panel 即右栏**：`kind: diff|markdown|table|image|url|form` 六种卡片 + actions（审批/应答/插入 composer）。

---

## 1. 端点响应合同（字段级，已核实）

> 通用：成功 = 裸 JSON（无信封）；失败 = `{error: string}` + 状态码；鉴权 = `Authorization: Bearer <token>`（无 token 仅回环）。无特殊说明均为 camelCase。

### 会话与转录
| 端点 | 请求 | 响应 |
|---|---|---|
| `POST /v1/session` | `{sessionId?, workspace?, asButler?, model?, contextWindowTokens?, maxOutputTokens?}` | `201 {sessionId, messageCount, headSeq}`；409 冲突 |
| `GET /v1/sessions?workspace=&status=` | — | `SessionRow[]`：`{sessionId, workspace, projectId?, title?, status: created|active|settled|interrupted, model?, parentId?, origin?: "dag"|"spawn", createdAt, updatedAt, archived?, role?: "butler", tokensUsed?}` |
| `GET /v1/session/:id/events` | — | `StoredEvent[]`：`{aggregate, aggregate_id, seq, type, data, ts?}`；`Session.PromptAdmitted` 注水 `data.images[{mime,data}]` |
| `GET /v1/session/:id/events/stream` | — | SSE，逐帧 LoopEvent（仅活态，无 [DONE]，15s keepalive） |
| `GET /v1/events/stream`（总线） | — | SSE，帧 `data: {sessionId, event: LoopEvent或{type:"result",...}}`；`: open` 起手 + 15s keepalive |
| `POST /v1/session/:id/prompt` | `{text, images?: [{mime,data}], replace?}` | SSE：`text{text}` / `reasoning{text}` / `tool{name,input}` / `tool-result{name,output,isError?}` / `step{step}` / `error{code,message}` / **`panel{panelId,kind,title,payload}`** / `done{step,needsContinuation,finish}` → `result{...}` → `data: [DONE]`；客户端断开 = interrupt |
| `POST /v1/session/:id/steer` | `{text}` | `{admitted: true}` |
| `POST /v1/session/:id/interrupt` | — | `{interrupted: true}` |
| `POST /v1/session/:id/compact` | — | `{boundarySeq, summary}`；409 busy |
| `GET /v1/session/:id/context` | — | `{chars, estTokens, windowTokens?, ratio?}` |
| `GET/POST /v1/session/:id/policy` | POST `{policy: strict|readonly|trusted}` | `{policy}` |
| `POST /v1/session/:id/fork` | `{atSeq?}` | `201 {sessionId, forkedFrom, atSeq}` |
| `POST /v1/session/:id/title` | `{title}` | `{title}` |
| `POST /v1/session/:id/archive` | `{archived}` | `{archived}` |
| `DELETE /v1/session/:id` | — | `{deleted: true}`（物理删，不可逆——UI 必须两步确认） |
| `GET /v1/session/:id/todos` | — | `{todos: [{content, status: pending|in_progress|completed|cancelled, activeForm?}]}` |
| `GET /v1/session/:id/goal` | — | `{goal: {objective, status, tokenBudget?, tokensUsed} | null, tokensUsed}` |
| `POST /v1/session/:id/command` | `{text}` | `{output}`（斜杠展开文本——调用方再作为 prompt 发送）；404 未知命令 |

### 能力目录与配置
| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /v1/commands` | — | `{commands: [{name, description?}]}` |
| `GET /v1/skills` / `?name=` | — | `{skills: [{name, description?, path}]}` / 完整 `{name, description?, body, path}` |
| `POST /v1/skills` | `{name, description?, body}` | `201 {name, path}` |
| `DELETE /v1/skills?name=` | — | `{removed: true, name}` |
| `GET /v1/agents` | — | `{agents: [{name, description?, allowedTools?, role?, model?}]}` |
| `GET /v1/models` | — | `{models: string[]}` |
| `GET /v1/models/catalog` | — | `{catalog: {schemaVersion, providers[]} | null}` |
| `GET /v1/settings` | — | 脱敏 SettingsView：`{agentHome, model, provider{kind,baseUrl,hasApiKey,apiKeyHint?}, contextWindowTokens?, maxOutputTokens?, host, port, workspace, allowBash, allowWeb, allowPluginCode, approvalPolicy, memory{on,extraction,vector{...}}, activeProviderId?, providers?[...含 hasApiKey], channels?[...含 hasSecret], mcpServers{...含 hasEnv/hasHeaders}, hasToken}` |
| `PUT /v1/settings` | AgentHomeConfig 深合并 patch（密钥留空=保持；mcpServers/channels 整表形状，缺条目=删除） | 同 GET 脱敏形状 |
| `GET /v1/mcp/resources` / `GET /v1/mcp/resource?server=&uri=` | — | `{byServer: {name: {resources[], error?}}}` / `{server, uri, text, mimeType?}` |

### 运行面
| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /v1/approvals` | — | `{approvals: [{id, kind: command|path|mode|question, target, decision, reason?, options?, createdAt, expiresAt}]}` |
| `POST /v1/approvals/:id` | `{allow, reply?}` | `{settled: true}`；404 已结算/未知 |
| `GET /v1/usage?days=` | — | `{days[{day,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens,cost,steps,byModel}], totals{...}, sessions, sessionRows[]}` |
| `GET/POST/PATCH/DELETE /v1/schedules[...]` `POST /:id/run` | ScheduleInput `{sessionId, prompt, enabled?, intervalMinutes?|dailyAt?|cron?}` | `{schedules: [...每行含 nextFireAt?]}` / 完整 Schedule 行 |
| `POST /v1/dag` | `{spec:{nodes{id→{agent{name,model?},input,dependsOn?}},entry?},todoSessionId?}` | `201 {dagId}`（立即返回，图后台跑） |
| `GET /v1/dags` / `GET /v1/dag/:id` | — | `{dags: DagStatus[]}` / `DagStatus{dagId, nodes[{node,state,model?,dependsOn?,childSessionId?}], done, startedAt?}` |
| `POST /v1/dag/:id/abort` | — | `{aborted, note?}` |
| `GET /v1/memory?q=&type=&sort=` `POST` `DELETE /:id` | `{content,type?,priority?}` | `{memories: MemoryRecord[]}` / MemoryRecord / `{removed}` |
| `GET /v1/fs?workspace=&path=` | — | `{path, entries:[{name, dir}]}`（单层、跳过点文件/node_modules） |
| `GET /v1/files/find?q=&workspace=` | — | `{results: string[]}`（递归文件名搜索，≤50） |
| `GET /v1/file?workspace=&path=` | — | `{path, size, encoding: utf8|base64, content, truncated?}`（≤2MB） |
| `GET /v1/live` | — | `{self, live[{sessionId, endpoint, pid, heartbeatAt}]}` |
| `GET /v1/audit?actorSessionId=` | — | 审计行数组 |
| `POST /v1/channel/:id/inbound` | `{text, userId?}` | `{channelId, sessionId, finish, reply}`（busy 显式报错） |

### LoopEvent 全集（prompt SSE + 总线 event）
`text / reasoning / tool / tool-result / step / error / panel{panelId,kind,title,payload} / done` + 终态 `result` + `[DONE]`。

---

## 2. 页面/交互完整清单（每个元素 → 端点）

### P1 布局壳（AppShell）
| 元素 | 行为 | 端点 |
|---|---|---|
| 启动 | 常连全局总线；主题 token 注入 | `GET /v1/events/stream` |
| 左栏 | 会话树（§P2） | `GET /v1/sessions` |
| 右栏（可折叠） | panel 卡流 + 审批卡（§P5） | 总线 + `GET /v1/approvals` |
| Ctrl+K | 命令面板（§P6） | `GET /v1/commands` |
| 工作区标识 | 当前 workspace + 切换菜单（Phase 2） | `GET /v1/settings` |

### P2 会话树（左栏）
| 元素 | 行为 | 端点 |
|---|---|---|
| 常驻会话行 | 固定名 "newhorse"、置顶、情绪球（busy=thinking） | `GET /v1/sessions`（role=butler） |
| 任务会话 | 按时间分组（今天/昨天/更早） | 同上 |
| DAG/spawn 子会话 | **嵌套在声明者名下**，origin 徽标（`dag`/`spawn`），不进顶层列表 | 同上（parentId 分组，客户端折叠） |
| 新任务按钮 | 新建会话并跳转 | `POST /v1/session {workspace}` |
| 行点击 | 跳转会话页 | 路由 |
| 行菜单 … | 重命名（内联输入）/ 归档 / **删除（两步确认）** / fork | `POST title` · `POST archive` · `DELETE` · `POST fork` |
| 状态点 | created/active/settled/interrupted 四色 | 行内 status |
| 实时刷新 | 总线 `result/done/error` 帧 → refetch；无定时轮询 | 总线 |

### P3 转录（主区）
| 元素 | 行为 | 端点 |
|---|---|---|
| 历史转录 | 事件折叠：user / assistant(text+reasoning) / tool 行 / **panel 卡** / compaction 标记 | `GET events` |
| 流式渲染 | text 追加、reasoning 灰字、tool 行、panel 卡实时 | `POST prompt` SSE |
| 停止按钮（busy 时） | 中断当前回合 | `POST interrupt` |
| busy 发送 | 语义切换为 steer | `POST steer` |
| 上下文条 | token 估算 + 窗口占比 | `GET context` |
| 策略段控 | 读 + 切换（持久） | `GET/POST policy` |
| 压缩按钮 | 手动折叠头部 | `POST compact` |
| fork 按钮 | 从选中用户轮回退分叉 | `POST fork {atSeq}` |
| 导出 | Markdown 下载 | `GET events`（本地折叠） |
| todo dock | 会话 checklist | `GET todos`（或事件折） |
| goal 卡 | 目标 + 预算 | `GET goal` |
| 模型芯片 | 切默认模型 | `GET models` + `PUT settings {model}` |
| 重载按钮 | 从日志重折 | `GET events` |

### P4 Composer
| 元素 | 行为 | 端点 |
|---|---|---|
| 文本输入 | Enter 发送 / Shift+Enter 换行 | — |
| 斜杠菜单 | `/` 触发、片段过滤；选中→ `POST command` → 展开文本**作为 prompt 发送** | `GET commands` + `POST command` |
| @ 菜单 | 文件（find 搜索）/ 技能 / agents / MCP 资源四段 | `GET files/find` `GET skills` `GET agents` `GET mcp/resources` |
| 图片附加 | 选择/粘贴/拖放，≤3MB×5 | 随 prompt `images[]` |
| 模型芯片 | 列出 + 切换 | `GET models` + `PUT settings` |
| 发送/停止 | 空闲=发送（prompt SSE）/ busy=红停止（interrupt） | `POST prompt` / `POST interrupt` |

### P5 右栏（panel 流 + 审批）
| 元素 | 行为 | 端点 |
|---|---|---|
| panel 卡流 | 按 kind 渲染：diff（红绿行）/ table（行）/ image（内联）/ url（链接+预览）/ markdown / form（只读 v1） | 总 bus + `GET events` 回填 |
| 审批卡 | 命令/路径/模式：允许/拒绝；**question 卡：选项按钮 + 自定义回答** | `GET approvals`（3s 兜底）+ `POST approvals/:id {allow, reply}` + 总线 tool 帧 |
| DAG 卡 | 声明者的图进度：节点状态条 + 中止（两步确认） | `GET dags` `GET dag/:id` `POST dag/:id/abort` |
| todo 面板 | 会话 checklist（随总线 todo 变化） | `GET todos` |

### P6 命令面板（Ctrl+K）
| 元素 | 行为 | 端点 |
|---|---|---|
| 命令列表 | 斜杠命令 + 会话跳转 | `GET commands` + `GET sessions` |
| 中断当前 | 快捷中断 | `POST interrupt` |

### Phase 2-4（清单后补，进阶段前先补合同）
- **Phase 2 会话管理完善**：工作区切换菜单、归档组、fork 模态。
- **Phase 3 配置面**：供应商预设（cc-switch 式一键切换）、行为开关、集成（MCP/channels 整表编辑）、系统（host/port/token）。
- **Phase 4 hub**：用量（日/周/累计真聚合）、定时任务（编辑+nextFireAt）、编排（车道+中止+childSessionId 跳转）、技能（导入/删除/复制）、记忆（过滤+排序）、运行状态（心跳+失联）。

---

## 3. 验收记录模板（每阶段复制一份填写）

```md
## 验收记录 — Phase N（日期）
### 环境
- 引擎: http://127.0.0.1:PORT（AGENT_RUNTIME_HOME=…）
- 供应商: <真实 key 跑通一轮>
### 逐项
- [ ] <交互元素> → <预期可见结果>（截图/记录）
- [ ] ...
### 发现的问题
1. <现象 → 根因 → 修复 commit>
### 结论
通过 / 带债通过（列出）
```

硬性规则：
1. **验收必须含至少一次真实 LLM 回合**（含工具调用 + panel 发射），不允许只点静态 UI。
2. **每个 button 都要被点击过一次**——发现无 handler 的按钮立即修，不带债进下一阶段。
3. 发现合同不符：先修引擎或先改本文件，不允许壳侧静默适配。

---

## 4. 已知引擎小缺口（进 Phase 1 时顺手补，≤半小时）

1. `GET /v1/sessions` 未透传 `parentId`/`excludeChildren` 过滤（registry 已支持）——壳先用客户端分组，端点透传顺手补上。
2. `ask_user` 的 form kind 面板（把问题卡泛化进 panel 词汇）——v2，现有审批问题卡够用。
3. `POST /v1/session/:id/prompt` 的 SSE 无 `cache-control` 头——顺手补。
