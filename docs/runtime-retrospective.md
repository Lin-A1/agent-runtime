# Agent Runtime 复盘（2026-09-03）

> 范围：引擎本体（schema / core / llm / plugin / memory / mcp / runtime / server / sdk）从立项至今的全部设计决策、实现、审查与实机验证。
> 立场：诚实优先。站住的说明证据，没站住的说明根因。不复述愿景，只核对事实。
> 背景：本次复盘发生在外壳战略收缩之后——apps/web（自研 web 壳）与 packages/cli（宿主 CLI）已从仓库移除，仓库收敛为引擎本体。

---

## 1. 现状快照

| 维度 | 数字 |
|---|---|
| 包 | 9（schema / core / llm / plugin / memory / mcp / runtime / server / sdk） |
| 测试 | 481 项（runtime 259 · core 104 · server 36 · llm 35 · memory 28 · plugin 13 · mcp 4 · sdk 2 · schema 0） |
| HTTP 面 | ~50 条路由（server.ts 1459 行，无路由库，单文件线性链） |
| 工具面 | 内置 20+（fs/多编辑/图片/搜索/bash 三件套+stdin/web 双件/记忆/任务/自我感知/交互/plan-mode/lsp）+ butler 9 件套 |
| 对抗审查 | 两轮 45 项 findings，全部修复 |
| 真机验证 | MiniMax-M3（anthropic 协议）+ OpenAI 真机 E2E 全链路通过 |
| 镜像 | agent-runtime 同步零漂移（--check 常态化） |

---

## 2. 站住了的设计（每条都有证据）

**2.1 transport 零领域逻辑——最硬的一条。**
三个消费者（CLI、web 壳、E2E 脚本）接在同一 /v1 面上，引擎零改动。中途还评估过第四个（opencode 协议桥），评估结论是"可行"，佐证的是同一件事：/v1 面的形状是 transport 无关的。server.ts 1459 行没有一处 import runtime 内部状态以外的东西。

**2.2 事件溯源 + append-only。**
compaction、todo、goal、policy、title、settled——全部要么是投影要么是追加。整个开发周期里**没有一次**需要重写日志。post-hoc 看这是最贵的架构决定也是回报最高的：所有后来功能（自命名标题、DAG↔todo 投影、goal 预算=usage 聚合）都免费拿到了"重启可重建"。

**2.3 seam 纪律。**
五类插件（tools/agents/commands/skills/hooks）+ MCP 挂载 + ask_user 借审批缝——三次能力扩充，core 里没有新增一处 if/switch 类型分支。ask_user 直接骑在 execpolicy 的审批门上是缝泛化的直接证据：权限面与交互面同构。

**2.4 四轴 Route。**
MiniMax（anthropic 协议 + 非 anthropic 模型）、OpenAI、openai-responses 共用一套 LLMRequest/LLMEvent。baseUrl /v1 陷阱的修复（normalizeBaseUrl）落点在使用点而非配置点，改动局部。模型相对降级（跨模型续写推理降纯文本）在真机成立。

**2.5 fail-closed 权限面。**
execpolicy 危险地板 + 审批 hub + 120s 自动拒绝。对抗审查挖出的 SSRF 网段遗漏、/v1/fs 符号链接旁路、代理 token 外泄、路径穿越——全部是**修补**而不是重设计，说明地板的位置是对的。

**2.6 durable admission。**
steer/queue 语义、post-compact 停放唤醒、busy 拒绝——实机验证通过。回合中断点（ask_user 挂起→应答→续跑）在真机上无死锁。

---

## 3. 没站住的（打脸清单 + 根因）

**3.1 外壳三连败（策略错误，代价最大）。**
三轮：自研 SPA 多轮增量改造 → 决定克隆 zcode → 决定桥接 zcode 壳。全部废弃。根因不在工程执行（每轮都完成了既定范围），在于**把产品设计问题当工程迭代问题打**：壳的差距不是功能缺口而是产品完成度，完成度只能靠产品设计投入或直接借用，无法靠"再接几个按钮"逼近。教训已固化：**外壳是产品决策；引擎保持 HTTP 可附着，壳永远可以换。**

**3.2 合同测试缺位（测试策略错误，最重的四个 bug 同根因）。**
路由吞并（3 段 GET 不 pin parts[1]，连带 /v1/dag/:id 全程 404）、dag foldStatus 字段名错（编排页数据实为假空）、配置文件层 channels/mcpServers 不回读（设置页往返假成功）、双 prompt 并发竞态——四个都是"单测全绿但合同错"。单测验证的是函数，用户消费的是运行中的合同。**没有一套黑盒合同测试对着跑起来的 server 验证完整形状与路由顺序。** 这是复盘认定的第一债务（见 §7）。

**3.3 UI 跑在引擎前面（顺序错误）。**
多轮出现"按钮有、handler 无"或"本地状态假成功"（记忆页假写、策略段控假切换、hub 页头 CSS 藏掉动作行）。每轮的修法都是接线，但债务的模式从未被点破：**先画壳再补引擎 = 结构性制造假成功状态。** 引擎先行、UI 作为薄消费方才是对的顺序——这个顺序后来在 ask_user（引擎缝先立、UI 后接）上被验证是对的。

**3.4 环境税（Windows）。**
端口冲突（双引擎 3931/3940 并存造成 EADDRINUSE 迷惑）、GBK 终端中文乱码、esbuild/vite 文件锁阻止删目录、bun 下 tsserver stdin 是换行协议而非 Content-Length 帧。没有一条是引擎 bug，但每条都消耗了真实时间。教训：测试矩阵要先铺**进程隔离约定**（端口表、进程命名、测试后强制清理）。

**3.5 事实漂移。**
specs 里 m2/m3 文档标"已实现"但细节与实现漂移；docs 声称"已接线"的机制（memory extraction 触发）一度只有引擎没有触发。诚实清单机制（architecture-map §3）本身是对的，但没有执行"文档与代码冲突时立即修文档"的纪律——四个阶段文档最终被整体删除。**文档要么同步要么删，不养僵尸。**

---

## 4. 不变量审计（对照 architecture-map §2 逐条）

| 不变量 | 状态 | 证据/侵蚀点 |
|---|---|---|
| model-visible ⟺ logged | ✅ held | compaction 是投影、todo/goal/title/policy 全是追加事件 |
| append-only | ✅ held | 唯一删除路径是用户发起的物理删除会话 |
| fail-closed 权限 | ✅ held | execpolicy 地板 + 审批 hub；无策略 = deny-all |
| fail-soft 外围 | ✅ held | hooks/记忆嵌入/提取管线失败降级不崩 |
| seam-only | ✅ held | 三次能力扩充零 core 分支 |
| 可插拔降级 | ✅ held | LLM 摘要↔本地标记、向量↔FTS、ask_user 无通道时优雅应答 |
| 一个词汇 | ✅ held | LLMRequest/LLMEvent + (aggregate_id, seq, type, data) |
| transport 零领域 | ✅ held | 三个消费者零引擎改动 |

结论：八条不变量全部成立。这是整个项目最经得起复盘的部分。

---

## 5. 债务清单（当前真实状态，按痛排序）

1. **无合同测试套件**（§3.2 的对策，未做）——最高优先。
2. **goal 预算只有可见性没有强制**——overBudget 不自动暂停，引擎差异化（成本控制支柱）没有闭环。
3. ~~DAG emit 全量 refold O(n²)~~——**已修（2026-09-03）**：core 抽出 `applyDagEvent`/`DagFoldState`，runner 的 emit 增量应用单事件（O(1)），终局 models 读数也走增量 fold；foldDAG ≡ 逐事件 apply 有等价性测试锁定。剩余 DAG 边界：跨进程调度（图由创建进程驱动）——明确为设计边界而非债务。
4. **plan-mode 是持久档位切换**，不是 loop 级模式门（readonly 档下工具面收窄已生效，但无"计划批准后自动恢复"的闭环）。
5. **sdk 只有 2 个测试**——要么长成 /v1 面的类型化客户端（未来任何壳的接入口），要么砍掉。
6. **跨进程 spawn-drive 未做**（子会话由创建进程驱动；已注册可被兄弟进程 interrupt/steer/observe）。
7. **openai-responses 协议 mock 级**（未真机）。
8. 事实漂移残余：docs/ 里的 zcode 三篇（gap-report/detail/comparison）随外壳方向废弃，已成历史文档。

---

## 6. 如果重来（可迁移的决策规则）

1. **transport 先行是对的**——但任何第二个消费者出现之前，/v1 面必须先有黑盒合同测试。合同是产品，实现只是租约。
2. **UI 永远是薄消费方**。宁可 CLI 走到底，也不做引擎没就绪的按钮。假成功状态是产品信任的最大杀手。
3. **外壳是产品决策不是工程项目**：借用成熟壳、或极简到 CLI，绝不自研追平成熟产品。
4. **审查要打运行中的合同**，不是源码。源码审查找局部缺陷，合同审查找系统谎报。
5. **文档要么同步要么删**。僵尸文档比没有文档更贵。
6. **Windows 环境税**：端口表 + 进程命名 + 测试后强制清理，写进测试基建而不是临场救火。

---

## 7. 收敛后的优先级（下一步建议）

1. **合同测试套件**（server 起真实进程 → 全路由形状/顺序/状态码断言）——直接封堵 §3.2 类 bug 的再现。
2. **goal 预算强制**——overBudget 自动暂停 + 恢复，闭合"成本控制"支柱。
3. **DAG emit 增量化**——fold 增量应用事件而非全量重读。
4. **sdk 长出类型化客户端**——作为 /v1 面的官方消费样例，兼作合同测试的载体。
5. **外壳**：暂停。等产品方向明确后按 §6.3 的规则决策（借用或极简）。

---

*本复盘基于：481 项测试、两轮 45 项对抗审查、MiniMax-M3/OpenAI 真机 E2E、三次外壳尝试的完整记录。仓库当前状态 = 引擎本体 + docs + scripts（smoke/sync），无宿主代码。*
