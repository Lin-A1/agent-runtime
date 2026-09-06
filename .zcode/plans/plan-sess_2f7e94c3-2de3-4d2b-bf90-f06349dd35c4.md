# newhorse 运行时鲁棒性、子代理层级与工具渲染深度重塑方案

针对您提出的四项关键问题，结合对引擎核心、`apps/web`、以及 **OpenCode / ZCode Remote v4** 真实架构的深度调查，规划实施以下全套解决方案：

---

## 一、彻底解决“切换会话中断”与“网络断连崩溃”（问题 1 & 2）

### 1. 切换会话后会停的根本原因与修复
- **服务端排查（根因）**：
  在 `packages/server/src/server.ts`（第 514–517 行 `promptStream`）中，当前实现存在硬伤：
  ```typescript
  // Client went away -> cancel the run.
  const onAbort = (): void => app.interrupt()
  signal?.addEventListener("abort", onAbort, { once: true })
  ```
  服务端把 HTTP SSE 长连接的断开（无论是用户在前端切到其他页面、关闭标签页、还是 TCP 波动）**直接等同于调用 `app.interrupt()`**，立刻在 SQLite 里打下中断事件强杀回合！
- **修复方案**：
  - 彻底移除 `req.signal` 对 `app.interrupt()` 的直接绑定。用户切到别的会话时，**当前会话的 Agent 回合在服务端后台继续独立执行**，绝不中断；
  - 只有当用户在界面上显式点击“停止方块按钮”（触发 `POST /v1/session/:id/interrupt`）时，才由用户指令触发合法中断。

### 2. 遭遇网络错误后直接断连的修复
- **前端排查**：
  - `apps/web/src/api/client.ts` 中的 `streamPrompt` 没有断连恢复与重连感知，一旦长连接异常抛错，前端直接落入 `catch` 并置 `busy = false`，将网络波动误报为回合失败。
- **修复方案**：
  - 在前端检测到长连接异常中断时，不立即强杀回合，而是首先调用 `api.snapshot(sessionId)` 校验当前会话状态；
  - 若服务端仍处于 `active` 执行中，前端自动切换至全局事件总线（`GET /v1/events/stream`）监听模式等待回合结算，并自动重载最新事件日志，实现真正的断连平滑续载。

---

## 二、侧边栏派生 Subagent 树状层级重构（问题 3）

### 现状与数据支持
- 引擎 `SessionRow` 早已具备 `parentId` 与 `origin: "spawn" | "dag"` 亲缘字段，但在 `Sidebar.tsx` 中被粗暴地以单层平铺数组全部倾倒在任务列表里，导致主会话和它生出的子代理毫无层级，混乱不堪。

### 重构方案（对齐 ZCode / OpenCode 层级树）
1. **数据解耦与亲缘映射**：
   - 将会话列表拆分为 `topLevelTasks`（`!parentId` 的顶级用户会话）与 `childrenMap`（以 `parentId` 为键的子代理映射表）。
2. **树状层级折叠呈现**：
   - 顶级会话行增加子代理展开指示（如 `2 个子任务` 徽章 + 轻量折叠箭头）；
   - 展开后，在其下方以 `border-l border-line/40 ml-4 pl-3` 纵向导轨缩进呈现所属的子会话；
   - 子会话条目左侧带有微型身份标识：
     - `origin === "dag"` 显示分支微标（`GitBranch`）；
     - `origin === "spawn"` 显示智能体徽标（`Sparkles` 或 `Bot`）；
     - 右侧显示独立的相对时间与状态点。
   - 点击子代理可直接无缝穿透至该子会话工作区。

---

## 三、工具显示全面重塑（对标 ZCode / OpenCode 真实规范，问题 4）

彻底重做工具调用呈现，对齐 ZCode Remote v4 实测特征：

1. **回合顶部执行目标绿标（ZCode 签名样式）**：
   - 在有工具执行的回合右上角，渲染轻量紧凑的绿色微标：
     `(✓) 目标任务或首个核心工具摘要`（`border-green/35 bg-green-tint text-green`）。
2. **执行过程克制收拢（ZCode `已工作 X 秒 >` 规范）**：
   - 历史回合中，长达数屏的工具调用默认全部收起，仅显示一行极简优雅的：
     `已工作 28 秒 (5 个步骤) >`（点击箭头平滑展开详情）；
   - 生成中动态显示：`工作中 1 分 12 秒` + 动态微光加载。
3. **展开后的单工具排版（对齐 OpenCode BasicToolV2）**：
   - 图标（Terminal/Code/Search）+ 工具名（`Bash`/`Edit`）+ 分隔点 `·` + 参数芯片（`rounded-chip bg-field px-1.5 shadow-hairline`）+ 增删行数（`+12 -3`）；
   - 展开后的终端代码高亮框带粘性复制按钮与执行状态绿勾。

---

## 四、执行排期与验证

1. **服务端修补**：修改 `packages/server/src/server.ts`，彻底解绑长连接断连对 `app.interrupt()` 的误杀；
2. **前端切会话与网络容灾**：完善 `client.ts` 与 `store.tsx`，后台继续运行 + 重回会话自动对齐；
3. **重写侧边栏层级**：在 `Sidebar.tsx` 实现父子会话折叠树与亲缘微标；
4. **重塑工具执行器**：对齐 ZCode 目标绿标、已工作耗时折叠行与 OpenCode 工具排版；
5. **全量构建与自动化测试回归**。
