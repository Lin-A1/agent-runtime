# 前端预审 — 设计前的功能分析（2026-09-01）

> 回答三个问题：**对齐 ZCode 页面上要有啥功能**（§3，以 §1 的实测 IA 为基准）、**我们比 ZCode 多出来的东西及其想法**（§1.5，主模型调度权/常驻管理会话/目标预算/成本分层/非 captive 接入等，前端必须给表达空间）、**动工前要先解决什么**（§6）。方法：① 把引擎当前真实接口面（含 handoff 落笔后新落的六个集成波）与 handoff §1.5 清单对齐；② 对 ZCode 解包产物做第二轮发现——这次不止 CJK 字符串，而是把 renderer 的 i18n 目录整体提取（5000 键 / 80 命名空间，入库副本 `docs/refs/zcode-i18n-keys.txt`，重建脚本见文末），按命名空间重建它的信息架构。handoff §1.5 的 32 项全部成立；本文件在其上增补、纠偏、排期。

---

## 0. 预审结论（TL;DR）

1. **handoff §1.5 的 32 项清单方向全部成立**，且 ZCode 实测 IA 与清单高度吻合（任务列表/会话页三栏/右侧多标签面板/Ctrl+K 命令中心/大设置页——见 §1）。
2. **引擎侧比 handoff 记载的更强**：四个"暂缓"项已部分或全部解除（文件内容读取、model-io 轨迹元数据、代码/图片预览面板、附件预算闸门），并新增 MCP/渠道/模型目录/审计四个有端点支撑的 UI 面（§2）。清单应增补 #33–#39。
3. **ZCode 有三块会话页功能 our 清单没覆盖、引擎端点足以支撑**，必须进清单：**每轮文件活动树（treemapping 语义）**、**每轮改动汇总卡（N 个文件已更改 + 审查）**、**@提及三类统一搜索（文件/技能/子智能体）**（§3.2）。
4. **一个必须先修的引擎坑**：`PUT /v1/settings` 对 `mcpServers`/`channels` 是整体替换且无密钥保留语义（providers 有 apiKey 保留，这两块没有）——设置页一旦做"读→改→写"就会**静默擦掉已存的 env/headers/secret**。UI 开工前先提引擎修复（§6.1）。
5. **移动端（同源 LAN 访问）可行但有两个硬约束**：默认 host 是 `127.0.0.1`（config.ts:410）必须改绑；**SSE abort = 引擎 interrupt**，手机锁屏/切后台会中断正在跑的回合（§4.3）。
6. **ZCode 的移动端形态是"扫码远程控制当前工作区"**（webRemoteControl，六态状态机）——我们用同源方案更简单，但其"桌面显示 URL+二维码、手机扫码进入"的引导 UX 直接可抄（§4.4）。

---

## 1. ZCode 实测信息架构（发现轮证据）

从 i18n 目录重建（键数为该命名空间条目量）：

```
ZCode 主壳 = 左侧栏 + 会话页（转录 + composer）+ 右侧 sidePane（多标签）+ Ctrl+K 命令中心 + 大设置页

左侧栏                       会话页                          右侧 sidePane（可换标签）
├ workspaceSidebar(44)      ├ 转录: message(38)             ├ 多标签: openTab/searchTabs/
│  多工作区/按工作区视图      │  toolCall(292 卡片体系)        │  recentlyClosed/tabOverview
│  时间线分组(今天/昨天/本周   │  statusPanel/summaryPanel     ├ subagent 辅助对话
│  /上周/本月/更早)          ├ changeSummary(29)             ├ subagentDirectory(13)
│  归档切换/排序/搜索         │  每轮"N 个文件已更改"+审查      │  七态子代理目录+提问
├ taskList(57)              ├ treemapping(16)               ├ review（Diff 审查）
│  六态: 生成中/恢复中/       │  每轮文件活动树(Live/快照)      ├ openFile 文件选择器
│  已就绪/已完成/失败/未就绪   ├ composer:                     ├ planTool(15) 计划面板
├ taskGroup(24) 分组+颜色     │  mention(29) @文件/@技能/      ├ git（暂缓：占位）
├ 定时任务组                  │    @子智能体三类               ├ browser 内置浏览器（桌面专属）
├ sidebar.usage(41)         │  attachments(30) 拖放          ├ wikiReference / whiteboard
│  30 天额度卡               │  queue(20) 待发送队列           └ codeViewer 查看器（65+）
└ sidebar.settings          │  elicitation(19) 选项卡
   主题/locale/界面缩放       └ toolbar: 模型选择器+模式三档
Ctrl+K commandCenter(20): 全部/操作/任务/文件 四 scope + 历史
设置页 settings(1674): modelProvider(499) > plugins(226) > usage(143) > skills(125) >
  mcp(100) > subagents(85) > commands(66) > hooks(60) > memory(38) > migration > browser >
  computerUse > themeMode/locale/uiFontSize/wrapLongLines/taskAutoArchiveDays/indexing
automations(167): 表单/自定义重复(12 种节奏文案)/运行历史(runs)/生命周期
bots(252): IM 机器人全家桶（微信/飞书/钉钉/企微/Telegram/Discord/Webhook，绑定码流）
modelTrajectory(51): 调用轨迹（来源七类/finish 四类/重试/搜索/分区展开）
git+gitGraph(181): 暂存/提交/推送/分支/图谱泳道 —— 字符串表自证"前端占位，service 未接"
```

**对我们最有价值的可抄交互**（全部有 i18n 证据）：

| ZCode 机制 | 证据键 | 抄什么 |
|---|---|---|
| 任务时间线分组 | `taskTimeline.today/yesterday/thisWeek/lastWeek/thisMonth/older` | 会话列表按时间分组，不是纯平铺 |
| 任务六态 | `taskList.status.*` | 映射我们四态：active=生成中、settled=已完成、interrupted=失败、created=已就绪 |
| 子代理七态 | `subagentDirectory.status.running/waiting/blocked/success/failed/cancelled/lost` | handoff §1.5 #16 的细化状态有了可抄的措辞与语义；`blocked`=待审批（从 /v1/approvals 推导）、`lost`=进程重启后 active 残留 |
| 每轮文件活动树 | `treemapping.*`（Live/Snapshot 徽标、写入/修改/删除/仅查看四类） | 会话页右面板 Tab：从 events 折叠当前轮 read/write/edit/glob/grep 的文件路径树；新轮开始转"快照" |
| 改动汇总卡 | `chat.changeSummary.filesChanged/expand/review` | 每轮 assistant 产出的 write/edit 折成" N 个文件已更改"卡，点开审查 diff（#7 的落点比逐行 diff 卡更贴 ZCode） |
| @提及三类 | `chat.mention.category.files/skills/subagents` | 我们的 `/v1/fs` + `/v1/skills` + `/v1/agents`（或子会话）三类统一搜索——引擎端点全齐 |
| 待发送队列 | `chat.queue.title/sendNow/sendConfirm/paused.stopped/resume` | 引擎 admission（queue/steer）原生支持；"编辑/移除/拖拽排序"无引擎端点 → 只读展示+立即发送可用，排序编辑暂缓 |
| 命令中心四 scope | `commandCenter.scope.all/commands/conversations/files` | Ctrl+K 面板的分节结构 |
| 热力图三档 | `settings.usage.heatmap.range.daily/weekly/cumulative` + 摘要句"最活跃日期是 X，约 N Tokens" | 用量页热力图的正确密度 |
| 定时任务节奏文案 | `automations.schedule.hourly/daily/weekdays/weekly/monthly/custom*/once` + `runs` 历史页签 | 我们 Schedule 的 intervalMinutes/dailyAt/cron 三种字段直接对应；runs 历史=按 lastRunAt/lastResult 渲染 |
| 模型切换分段提示 | `chat.toolbar.modelSwitch.stage.*` + `lockedByRunningTask` | 模型切换是异步动作，分段进度提示 + "运行中锁定"告警直接可抄（我们是全局 settings 切换，告警更必要） |
| 文件树过滤 | `workspaceFileTree.showChangedFiles/仅显示变更文件` | 文件树默认可切"仅变更"视图 |
| 代码查看上限 | 文本 256KB / Office 25MB / 演示 64MB / 记忆文件 5MiB | 我们 /v1/file 是 2MB，查看器要有截断横幅 |
| 选项卡（elicitation） | `chat.elicitation.*` | 工具卡里 AskUserQuestion 类调用渲染为选项卡，点选回填 composer（客户端拼文本，无魔法） |
| 两级错误边界文案 | `appError.*`（"不会直接白屏/错误已经限制在当前区域"） | #29 的文案基准 |
| 移动端引导 | `webRemoteControl.*`（扫码/链接/六态） | 桌面端显示"手机访问"入口：URL+二维码+token 导入说明（§4.4） |

**ZCode 有、我们明确不跟的**：账号登录/编程套餐/manualClaimPlan（token 制）；IM 机器人绑定码全家桶（引擎只有 webhook-first 渠道 seam，UI 先做 webhook 渠道管理，IM 原生协议留暂缓）；git 面板（ZCode 自证占位）；offPeak 闲时任务（引擎无对应）；ssh/remote/docker 远程工作区；内置浏览器/画板/Wiki（已在暂缓桶）；桌面窗口菜单/进程监视器。

---

## 1.5 超出 ZCode 的增量（想法与 UI 表达）

§3 的页面地图回答"对齐 ZCode 要做什么"；本节回答**我们比 ZCode 多出来的东西**——这些不是 ZCode 功能的搬运，是产品自己的主张，前端必须给它们表达空间，否则引擎的差异化在 UI 里不可见。逐项：想法（为什么做）→ ZCode 对照 → UI 表达（前端要呈现什么）。实据全部核过引擎源码。

### ① 主模型是调度器：动态编排与声明式 DAG 同一个基座（北极星 #1）

- **想法**：ZCode 的 Task 是单轮驱动里的一次性子代理派生，"图"只是事后记录。我们把**真子会话基座**（继承 workspace、被回合循环真驱动、结果回填、task_id 可续）做成底座，调度权交给两个互补的形态：**动态形态**——主模型在回合边界用 butler 工具集调度（spawn_agent / send_to_session / followup_task / wait_agent / interrupt / list_sessions 六件套，引擎保证子会话被真驱动，never a dead row）；**声明式形态**——把同样这批子会话画成**提前声明的**前驱后继图（`POST /v1/dag`，spec.nodes 带 `agent{name, role?, model?}` / `input` / `dependsOn?`），运行时做拓扑排序 + 就绪队列 + 事件唤醒，无 join 阻塞。图是事件聚合（`DAG.Declared` / `DAG.Aborted`，aggregate "dag"，可重放可续跑 `resumeDag`），不是转录的事后投影。**两条通道一个底座：一个 DAG 节点就是一次 spawn**。
- **ZCode 对照**：只有 Task 单发 + 子代理目录；无依赖声明、无拓扑调度、无图续跑。
- **UI 表达**：编排页（§3.8）是**差异化页**，不是锦上添花；会话页子代理树要区分动态 spawn 与 DAG 节点两种来源；DAG 的 `todoSessionId` 投影会把节点进度写进会话的 todo dock（dag-runner 直接 append `Session.TodoUpdated`）——todo dock 要标注"来自编排"；节点卡带 per-node model 与 6 态。
- **接线记录（2026-09-01 已完成）**：模型侧声明工具 **`declare_dag` 已落地**——butler 第 7 个工具（`butler.ts`），经 `ToolCtx.declareDag`（core/agent/runner.ts）由 app 注入 `dagRunner.run(spec, { workspace, todoSessionId: 声明会话 })`，进度照旧投影进声明会话的 todo dock，成功声明过 `Session.ButlerAction` 审计；main.ts 的 sessionConfig 穿线 runner（与 HTTP /v1/dag 同一 runner）。BUTLER_BODY 已告知模型使用时机（结构明确的并行批次 → declare_dag；零散派工 → spawn_agent）。回归测试：butler 单元 2 例 + app 接线 1 例（spec 原样达 runner、todoSessionId/workspace 绑定、审计落 audit 聚合）。剩余小项：DagStatus 无 author 字段（不区分提交者）——UI 结构无需因此改变。

### ② 常驻管理会话（newhorse 角色，引擎键 butler）

- **想法**：ZCode 的任务列表里每条对话平等且一次性；我们给**每个工作区一个永不错乱的常驻 newhorse 会话**（`stableSessionId(workspace)` 幂等，`role: "butler"` 落 `Session.Created`），它默认带调度工具集，是"读文件、跑工具、把大任务拆给子代理并行推进、汇总结果"的主入口。编排操作的授权全部过审计（`Session.ButlerAction`：actorKind user/butler/parent、allowed/denied、目标会话）——管理权有边界（父只管直子；interrupt 同规则），不是特权后门。
- **ZCode 对照**：无常驻协调会话概念；子代理由临时任务派生，没有"管家位"。
- **UI 表达**：侧栏常驻置顶 + 迷你球头像 + 封面 composer 直达（§3.3）；普通新建会话也可 `asButler` 带调度集（"普通模式"是显式关闭调度后的轻量形态——product-voice 已拍板）；ButlerAction 审计行放进会话调试信息（#30 的落点之一）。

### ③ 目标预算体系：goal × DAG × todo × task 四层一个语义

- **想法**：ZCode 有 todo 没有目标。我们把 objective + tokenBudget 做成**可执行的约束**而非便签：goal 状态机（active/paused/blocked/complete，`Session.GoalUpdated`）、预算由 usage 聚合强制、DAG 节点统一 Settled 语义、DAG 进度投影进 todo——长任务的"花钱买到了什么"有账本。
- **ZCode 对照**：TodoWrite 清单 + 无预算约束。
- **UI 表达**：goal 预算条（已用/预算/状态四态，§3.2）；预算吃紧的告警呈现；编排页 DAG 概览可挂 goal。

### ④ 成本分层的子代理模型（costDown / per-node model）

- **想法**：贵模型只花在决策点。DAG 节点级 `model` 字段（DagNodeStatus 记录实际解析值）、spawn_agent 的 `model` 覆盖、以及 `costDown` 策略（dag-runner 折叠 costDown + inherit，把未指定的子代理降档到便宜模型）——扇出便宜、收敛昂贵。
- **ZCode 对照**：任务级模型切换有，子代理/节点级成本分层无。
- **UI 表达**：子代理卡与 DAG 节点**显示所用模型**；用量页按模型分列（`Session.ModelCalled` 带 model 字段，客户端可折——引擎 usage 聚合只有天粒度，per-model 列是前端折叠的活）。

### ⑤ 非 captive 的模型接入（四轴 Route + 预设 + 目录）

- **想法**：ZCode 绑定账号与套餐（login/codingPlan/额度卡是它的侧栏主视觉之一）。我们 BYO key：四轴 Route（协议/端点/鉴权/帧型解耦，openai / openai-responses / anthropic 复用一个词汇表）、供应商预设卡原子切换（`activeProviderId`）、模型能力目录、**model-relative lowering**（消息带 model/provider 标注，换模型续跑时推理内容降级为纯文本——不把 A 家的思考格式喂给 B 家）。
- **ZCode 对照**：单供应商 + 账号额度体系。
- **UI 表达**：设置页模型区 = cc-switch 基准（§3.4）；侧栏底部放**用量摘要**而不是额度卡；模型选择器带目录增强（#37）。

### ⑥ 事件溯源的会话骨架（fork / durable admission / 内容寻址附件）

- **想法**：转录=事件折叠，"模型可见 ⟺ 已落日志"。fork 从任意用户事件 seq 分叉且**继承 workspace + role**；steer/queue 是持久收件箱（重启不丢、幂等 admit）；图像走内容寻址库 + 预算闸门（字节级稳定保 prefix cache）。
- **ZCode 对照**：JSONL 日志 + 文件级 checkpoint rewind（其撤销比我们细）；但无会话级 fork 语义、队列非持久语义。
- **UI 表达**：回退 fork（用户事件行上的分叉点）、排队只读卡、图片发送纪律（§5.5）；不做假的重做/撤销交互。

### ⑦ 语义记忆 seam（可插拔检索）

- **想法**：ZCode 的 memory 是工作区 MEMORY.md 文件树查看器（文件形态）。我们是事件溯源的条目库 + FTS5×cosine RRF 混合检索 + **EmbeddingProvider 可插拔**（模型 tag 防混、延迟向量化）——记忆是 runtime 能力，向量索引是可替换 provider。
- **ZCode 对照**：文件形态、绑定其桌面端查看。
- **UI 表达**：记忆页条目卡 + 搜索（§3.6）；设置页 memory 区暴露 provider/embedding 配置（settings.memory.* 已在配置面）。

### ⑧ 克制的渠道 seam 与跨进程目录

- **想法**：渠道（webhook 入站）与人工消息走**同一条 admission 通道**，一渠道一会话，出站 HMAC 签名——是 ZCode IM 全家桶的克制底座，不是第二特权路径。`/v1/live` 跨进程目录视图回答"这个会话被哪个运行时拥有"。
- **ZCode 对照**：bots 全家桶（我们暂缓其原生协议层）。
- **UI 表达**：设置渠道卡（#34）+ 测试按钮；/live 弱需求最后做。

### ⑨ 产品身份：情绪球

- **想法**：ZCode 无"脸"。球是会话状态的唯一表情化载体（boot/idle/thinking/done/error…），只出现在封面主视觉、侧栏品牌位、会话头像——克制但不可替代，是产品记忆点。
- **UI 表达**：§4 状态映射照旧（product-voice 钉死）。

### 对位表（借来的，不算增量）

按仓库纪律"不把借来的行为说成自建"，以下是与 ZCode **对齐**而非差异的能力：MCP 服务器管理（ZCode settings.mcp 100 键在先）、审批/权限分级、定时任务（automations→schedules）、模型调用轨迹（modelTrajectory→Session.ModelCalled）、待发送队列、@提及、命令中心、代码/文件查看器、用量热力图、通知、双主题、i18n。§3 的矩阵负责把它们做齐；§1.5 的增量负责让 newhorse 成为 newhorse。

---

## 2. 引擎接口面勘误（对 handoff §5.1 的增补）

handoff 落笔后，六个集成波（`49cac5083` + 工作区未提交改动）新增了能力。以下全部核实过源码：

**新增端点**
| 端点 | 形状 | 出处 |
|---|---|---|
| `GET /v1/models/catalog` | `{catalog: {schemaVersion, providers:[{id, models:[{id, kinds?, modalities?, contextWindowTokens?, maxOutputTokens?, reasoning?}]}]} \| null}`；缺失=`{catalog:null}`（UI 降级手填） | `docs/agent-runtime-integrations.md` §2 |
| `GET /v1/file?workspace=&path=` | `{path, size, encoding:"utf8"\|"base64", content, truncated?}`；≤2MB 截断、前 8KB NUL 探测二进制、symlink realpath 复检防逃逸 | `packages/server/src/server.ts:882` |
| `GET /v1/audit?actorSessionId=` | 审计行数组（**进程内存活期，重启即空**） | server.ts:641 |
| `POST /v1/channel/:id/inbound` | `{text, userId?}` → `{sessionId, finish, text}`；会话 busy 显式报错；出站 webhook HMAC 签名 | server.ts:566；docs §6 |

**事件与附件**
- 新事件 `Session.ModelCalled {source:"turn"|"compaction"|"extraction", model, durationMs, finish?, usage?, promptChars, outputChars, error?}`（`packages/schema/src/event.ts:55`）——出现在 `/events`，用量与调试页直接可消费。
- 附件内容寻址库：事件携带 `attachments:[{sha256, mime, bytes}]`；**服务端 `/events` 注水回 `images` 形状（客户端契约不变）**，且只对 `Session.PromptAdmitted` 注水（server.ts:649）。预算闸门在 admit 时：单图 ≤20MiB、≤5 张、总 ≤25MiB，超限按位置从最老整张剔除并以 `[image N omitted: over budget]` 占位（docs §5）。**handoff §5.5 客户端降采样纪律全部照旧**（引擎不做转码）。

**数据形状要点（UI 直连）**
- `SessionRow` 增 `projectId?`；`/v1/sessions` 支持 `?workspace=&status=`。
- `DagStatus {dagId, nodes:[{node, state:"pending"|"running"|"succeeded"|"failed"|"skipped"|"aborted", model?}], done, startedAt?}`（`runtime/src/dag-api.ts:27`）。
- `Schedule {id, sessionId, prompt, enabled, intervalMinutes?|dailyAt?|cron?, lastRunAt?, lastResult?:"ok"|"error", lastError?}`（`runtime/src/scheduler.ts:16`）。
- `ApprovalRequest {id, kind:"command"|"path"|"mode", target, decision, reason?}`（`schema/src/execpolicy.ts:32`）——审批卡可显示命令/路径与原因。
- `/v1/models` → `{models: string[]}`（远端拉取失败=空数组）；富元数据走 catalog。
- 设置回显新增 `channels[]`（secret→`hasSecret`）与 `mcpServers`（env/headers→`hasEnv`/`hasHeaders`）。

---

## 3. newhorse 页面地图与功能矩阵

IA 总纲沿用 ZCode 实测结构，本地化为：**左侧栏（工作区+会话）+ 会话页三栏 + 独立功能页 + 大设置页 + Ctrl+K**。差异点：ZCode 把子代理/审查/文件做成 sidePane 标签，我们照抄；ZCode 的用量在侧栏+设置两处，我们是独立页（引擎有专门端点）。

### 3.1 顶级页面

| 页面 | 路由 | ZCode 对应 | 引擎落点 | 期 |
|---|---|---|---|---|
| 封面 | `/` | welcome + composer | `POST /v1/session`（不带 id=常驻会话幂等）+ sessions | P0 |
| 会话 | `/session/:id` | chat + sidePane 全套 | §3.2 | P0 |
| 设置 | `/settings` | settings 单页带 nav | `/v1/settings` 系列 | P1 |
| 用量 | `/usage` | settings.usage + sidebar.usage | `/v1/usage` + ModelCalled 事件 | P1 |
| 记忆 | `/memory` | settings.memory.viewer | `/v1/memory` 三端点 | P1 |
| 定时 | `/schedules` | automations | `/v1/schedules` 全套 | P1 |
| 编排 | `/dags` | （ZCode 无对应——我们的差异化） | `/v1/dag`、`/v1/dags`、`/v1/dag/:id` | P2 |
| 运行时目录 | `/live` | — | `/v1/live` | P2 |

### 3.2 会话页（核心页，逐面板拆）

**中栏转录 + composer**
- 转录折叠（handoff §5.3 规则照旧）：角色竖标五色、thinking 折叠、工具行 chip 按类别着色（§3.1 工具盘点）、错误态行。
- **每轮改动汇总卡**（新增，抄 changeSummary）：一轮内 write/edit 折成"N 个文件已更改"卡 → 点开逐文件 diff（+N/−N、行级着色）。#7 的具体落点。
- **每轮文件活动树**（新增，抄 treemapping）：右面板 Tab，折叠当前轮 tool 事件里的文件路径（read/glob/grep=仅查看，write/edit=写入），新一轮开始后上一轮转快照。数据全来自 events，零新端点。
- composer：流式、中断、**进行中发送自动转 steer/queue**（admission 语义）、图片附件（降采样纪律 §5.5）、**@提及三类**（文件 `/v1/fs`、技能 `/v1/skills`、子代理 `/v1/agents`）、斜杠命令 `/v1/commands`、消息引用（≤8 条/单条 ≤8000/总计 ≤16000 字符——抄 ZCode 上限）、elicitation 选项卡（点选回填，客户端拼文本）。
- **待发送队列面板**（抄 queue）：显示排队条数与内容（只读）+ "立即发送"（走 prompt）；编辑/移除/拖拽排序引擎无端点 → 暂缓，不做假交互。
- 审批托盘：`ApprovalRequest{kind,target,reason}` 渲染 + 允许/拒绝；进行中轮询 `/v1/approvals`。
- todo dock（composer 上方）+ goal 预算条（`/v1/todos`、`/v1/goal`）。
- 上下文占比（`/v1/session/:id/context` 的 ratio）常驻状态条。
- 会话调试：复制会话 ID/重载会话（抄 debugInfo）；fork 回退（用户事件 seq 上分叉，继承 workspace+role）。
- 模式三档切换（policy strict/readonly/trusted ↔ ZCode default/plan/acceptEdits 的档位语义）。

**右 sidePane 标签**（可收起；宽版式规则 §1.8 由此承载）
1. 子代理树（parentId 缩进 + 七态 + 追问入口：followup/wait）—— #16 落点。
2. 文件树 + **文件查看器**（新增）：懒加载树（浅后深）+ `/v1/file` 查看（utf8 高亮、base64 图片直接预览、2MB 截断横幅、"仅显示变更文件"过滤）。
3. 上下文/目标（context 统计 + goal）。
4. 每轮文件活动树（treemapping，见上）。
5. 审批（历史 + 待审）。

### 3.3 左侧栏
- 工作区身份块（当前标记 + 切换）+ 常驻 newhorse 会话置顶（迷你球头像）。
- 会话列表：**时间线分组**（今天/昨天/本周/上周/本月/更早）+ 搜索 + 状态点（active 脉动/settled 灰/interrupted 红）+ 归档组 + 双步删除。
- 侧栏底部：用量摘要卡（30 天 totals，点击进 /usage）+ 设置入口 + 主题/语言快捷切换。

### 3.4 设置页（单页 + 左 nav，抄 opencode 组织 + cc-switch 卡片）
分区：
1. **模型与供应商**（最大区，cc-switch 基准）：预设卡列表（`providers[]`：name/kind/baseUrl/model/hasApiKey/apiKeyHint）+ 一键 `activeProviderId` 原子切换 + 预设表单（apiKey 留空=保持；CLEARABLE 字段语义）+ 当前 provider 可用模型列表（`/v1/models`）+ **目录增强**（`/v1/models/catalog` 有数据时显示 kinds/modalities/contextWindow；无则降级手填）+ 预算（contextWindowTokens/maxOutputTokens）。
2. **集成**：MCP 服务器管理（列表/新建/启停 `enabled`/`allowedTools`/搜索；env/headers 走"已配置 N 项，留空保持"模式——引擎保留语义已修复，见 §6.1）；入站渠道（列表/绑定会话/secret presence/出站 webhook/启停 + "发送测试消息"按钮走 inbound）。
3. **行为**：审批策略默认、`allowBash`、`allowPluginCode`、todo/task 相关。
4. **系统**：token（hasToken+重设）、host/port（含 §4.4 的 LAN 开关）、数据目录展示、外观（主题三态/字号）、i18n、通知开关、任务自动归档天数（可选）。

### 3.5 用量页
统计卡（totals/sessions）+ 热力图三档（每日/每周/累计，摘要句"最活跃日期是 X"）+ 会话排行（点击跳会话）+ **调用轨迹区**（ModelCalled：按 source 分类的调用列表、次数/总 token/时长/错误；比 ZCode 的 modelTrajectory 轻——无正文落盘，只有元数据，UI 呈现为表格+会话内调试入口）。

### 3.6 记忆页
搜索框（`?q=`）+ 条目卡（content/type/priority/时间）+ 删除（双步）+ 手动写入。ZCode 的"按工作区文件树查看器"形态不适用（我们引擎是条目库不是文件），但搜索防抖/时间相对化文案可抄。

### 3.7 定时页
列表卡（节奏文案自动生成：intervalMinutes→"每 N 分钟"、dailyAt→"每天 HH:MM"、cron→表达式摘要）+ 启停开关 + 立即执行 + runs 历史（lastRunAt/lastResult/lastError）+ 编辑表单 + 两步删除。目标会话显示（`sessionId` → 跳会话）。

### 3.8 编排页（差异化，ZCode 无对应物——想法见 §1.5①③④）
DAG 列表（done/startedAt）+ 节点状态视图（六态：pending/running/succeeded/failed/skipped/aborted；拓扑布局 + 每节点 model 标注）+ 节点跳转子会话转录 + spec 提交（JSON 编辑器起步，模板后补）+ DAG 进度在 todo dock 的来源标注。回答北极星支柱 #1 的"可视化"部分；模型侧声明工具接线后，这里同时呈现用户提交与模型自建的图。

### 3.9 全局
- Ctrl+K 命令中心：四 scope（操作=commands/任务=会话/文件=/v1/fs 浅搜索/全部）+ 最近。
- 通知：回合完成/需审批（Notification API 可用时；降级见 §4.3）。
- 两级错误边界 + 全局兜底页（抄 appError 文案语气）。
- 深浅主题 + 跟随系统（index.html 内联预置防闪烁）。
- i18n 中/英（文案表集中，默认中文）。

---

## 4. 三端策略（desktop / web / 移动 web）

### 4.1 同步语义
状态全在引擎：sessions/events/settings/usage 全服务端持久；客户端 localStorage 只放**设备本地偏好**（token、主题、i18n、工作区历史、通知开关）。多端看同一会话天然一致（转录 = /events 全量重折）；SSE 只覆盖发起 prompt 的连接，**观察端靠轮询**（列表 4s、活跃会话 1.5s——handoff §6.7 节奏照旧）。

### 4.2 web（主基准）
桌面宽度全功能，§3 全量。

### 4.3 移动 web（同源 LAN/手机浏览器）
- **host 前置**：默认 `127.0.0.1` 手机连不上 → 设置页"手机访问"开关写 `host: "0.0.0.0"` + 提示重启；**必须同时配置 token**（0.0.0.0 + 无 token = 局域网裸奔一个能跑 bash 的 agent）。
- 响应式降级：≤768px 单列；侧栏→抽屉；sidePane→底部 sheet/Tab；触控目标 ≥40px；悬停交互全部改点按；Ctrl+K→浮动按钮。
- **SSE abort = interrupt 是移动端最大约束**：手机锁屏/切后台会掐断 SSE → 回合被中断。缓解：回合进行中请求 Wake Lock（屏幕常亮）+ 明确提示"离开页面会中断"；中断后走 steer/重发续跑（admission 不丢内容）。
- 通知降级：移动浏览器 Notification 受限（iOS 需 PWA+16.4+）→ 应用内角标 + `document.title` 未读计数兜底。
- 图片：`<input type=file accept=image/*>`（相册/相机）+ 粘贴；降采样管线同一套。
- 版式验收口径：§1.8 宽幅规则是桌面规则；移动单列不算违反。

### 4.4 desktop（Tauri 2 + sidecar + 同 dist）
- 系统能力：文件夹选择器（工作区引导）、原生通知、窗口菜单（可选）、updater 全流程（#32，抄 updateDialog 状态机：发现/下载进度/重启安装/跳过此版本/强制最低版本）。
- **手机访问引导**（抄 webRemoteControl UX）：桌面端显示 URL+token 二维码，手机扫码在浏览器打开同源 UI——桌面客户端持有 token，客户端自行生成二维码，零引擎端点。
- 打包在 web 验收后执行（handoff §7.8 顺序不变）。

---

## 5. 分期

- **P0 可用闭环**：封面、会话页中栏全量（转录/流式/中断/steer/队列显示/审批/策略/图片/todo/上下文条/fork/调试）、左侧栏全量、鉴权与空态引导、主题、错误边界、typecheck/build/冒烟。
- **P1 功能对齐 ZCode（§1.5 #1–#31 逐项）**：sidePane 五标签（子代理/文件树+查看器/上下文/文件活动/审批历史）、设置四区、用量、记忆、定时、@提及、消息引用、导出 Markdown、通知、i18n、快捷键、命令中心。
- **P1 末期建议提前**：编排页（DAG）的只读视图先行（列表 + 节点 6 态 + 子会话跳转）——它是差异化页（§1.5①），todo dock 的"来自编排"标注与子代理卡的 model 显示（§1.5③④）随手做进 P1；spec 提交表单与模型侧声明工具接线后补全交互。
- **P2 差异化与桌面**：MCP/渠道管理区（引擎保留语义已修，§6.1）、DAG spec 提交表单、audit 视图（若保留）、live 目录、LAN 开关+二维码配对、桌面打包+updater。

---

## 6. 风险与动工前待办

1. **【已修 2026-09-01】settings 往返擦除**：~~PUT 对 `mcpServers`/`channels` 整体替换、无 env/headers/secret 保留语义~~ → 已在 `packages/runtime/src/config.ts` 落地（`mergeMcpServers`/`mergeChannels`/`mergeRedactedEntry`，回归测试钉在 `config.test.ts`）。修复后语义：patch 仍是整表形状（缺条目=删除，与修复前的删除语义一致），但条目内密钥字段走 providers 的 apiKey 同款保留规则——`""`/缺省=保留、显式 `null`=清除、`{}`=清空 map；`hasEnv`/`hasHeaders`/`hasSecret` 展示键永不落盘。设置页集成区可以安全做读改写了。
2. **子代理七态推导规则**要写在一处（api 层）：registry 四态 + `/v1/approvals`（blocked）+ 进程重启后的 active 残留（lost）+ settled finish（success/failed）+ followup 等待（waiting）。别让每个组件各猜一套。
3. **队列编辑/移除、文件级 checkpoint 撤销（rewind/reapply）、目录 diff、全局事件流推送（ws/SSE feed）、IM 原生协议、offPeak**：引擎无端点，全部进暂缓桶，不造后端。
4. `/v1/file` 2MB 上限对手机照片偏小（查看器限制，不影响发图 20MiB）→ 查看器对超大图显示降级提示。
5. audit 是进程内存活数据，重启清空——若做 UI 必须标注"仅本次运行"。
6. 渠道测试按钮（inbound）在会话 busy 时显式报错——UI 要呈现该错误。
7. `SessionRow.projectId` 引擎新字段：UI 暂无概念，透传展示即可，不造功能。

## 7. 清单与文档修订动作

- handoff §1.5 增补 **#33 MCP 服务器管理、#34 入站渠道管理、#35 DAG 编排视图、#36 文件查看器、#37 模型能力目录、#38 模型调用轨迹（元数据）、#39 每轮文件活动树与改动汇总卡、#40 @提及三类、#41 移动端访问引导（LAN 开关+二维码）**（§3 已给出各自引擎落点）。
- handoff 暂缓桶修正：内容预览面板**部分解除**（文本/代码/图片可做，PDF/Office 仍缓）；model-io 轨迹**部分解除**（元数据已落盘，正文不做）；新增暂缓：全局事件流、队列消息编辑/移除、文件级 checkpoint 撤销、offPeak。
- handoff §5.1 端点表补四行（§2 表格）。

---

### 附：i18n 目录提取脚本（复核用）

```bash
node -e "
const fs=require('fs')
const s=fs.readFileSync('G:/temp/zcode-research/zcode-src/out/renderer/assets/IntlProvider-CyTmJHD8.js','utf8')
const re=/\"([A-Za-z0-9_.\-]{2,70})\":\`([^\`]+)\`/g
const map=new Map(); let m
while((m=re.exec(s))!==null) if(!map.has(m[1])) map.set(m[1],m[2])
fs.writeFileSync('G:/temp/zcode-research/zcode-i18n-keys.txt',[...map].map(([k,v])=>k+'\t'+v).join('\n'))
console.log(map.size)"
```
