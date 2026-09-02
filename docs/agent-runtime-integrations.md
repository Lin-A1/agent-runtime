# agent-runtime 接入波:六个机制的设计决策

> 2026-09-01。回答"agent-runtime 还能接入什么"的落地波:六个机制,全部顺着现有 seam 走,不改骨架契约(seam 三段式 / LLM 词汇 / 事件溯源形态 / 依赖方向)。每节:决策、不变量、显式不做。

> **第七波(2026-09-01,上下文管理对标落地,见 docs/runtime-comparison.md §6 处置清单)**:四个小件——①**单条工具输出截断**(`toolOutputMaxChars`,默认 20k 字符,超限存头尾摘录+标记,codex truncation_policy 语义);②**compaction 熔断**(隔 2 轮冷却 + exhausted 旗标:折叠后仍在限上=尾巴无法再缩,本 drain 不再重试,ZCode rapid-refill 语义的软化版);③**工具结果清存投影**(`clearStaleToolResults`,ZCode LocalToolResultClear 的投影式实现:超触发线时最近 N=12 条之外的工具结果投影为占位符——纯投影、日志不动、确定性,`/v1/session/:id/context` 已同步该视图);④**反应式压缩**(provider 报 context-overflow → 折叠重试一次,第二次溢出诚实抛错,MAX_STEPS 边界直接重抛防吞错)。顺路:goal 预算 80% 带内预警(去重键含预算值,提额后可再警)、steer 唤醒空闲会话(fire-and-forget;prompt 的 inFlight 改为同步置位,关闭 prompt-vs-prompt/steer-vs-prompt 竞态窗)。测试 core 97 / runtime 226 全绿;独立评审 1 must-fix(undefined 工具返回值截断崩溃)+5 should-fix 全部修复。

> **第八至十二波(2026-09-01 夜间批量,自感知/压缩对齐/缓存/web)**:九件新机制,全部顺着 seam 落地。**自感知工具组**(wave 9):self_status(身份/模型/供应商/工作区/agentHome/策略/工具面——策略与工具数为活闭包)、get_context_remaining(与 loop 投影同口径,charsPerToken 同源)、current_time、sleep(0.05-60s 钳制,abort 联动);environment_context 随首轮系统上下文注入(cwd/platform,不带时钟)。**压缩对齐**(wave 10):usage 驱动触发(provider 真实 inputTokens,anthropic 计入 cacheRead/Write——缓存会话正是字符估计失真处)、charsPerToken 配置层(1..10)、清存参数化(toolResultClearable 白名单/clearErrors 默认保留)、pre/post-compact hooks(pre-compact block 跳过自动折叠且冷却记账,反应式无视 block——保护性操作不可选)、POST /v1/session/:id/compact(busy 409,remote 代理)。**缓存审计**(wave 11):anthropic cache_control 断点与 cache 记账早已存在——此前判断不成立;prompt_cache_key 评估后不做(第三方兼容性优先)。**web_fetch**(wave 12):allowWeb 开关链(镜像 allowBash)、https-only、逐跳重定向校验、SSRF 拒绝(含 IP 编码变体)、2MiB 流式上限、HTML 剥离;**事件订阅推送** GET /v1/session/:id/events/stream(SSE over app.onEvent,预中止释放 + 背压关闭,多端实时观察解锁)。独立评审两轮:第一轮 2 must-fix(HOOK_EVENTS 白名单未扩/token 高水位不重置)+5 should-fix;第二轮 2 must-fix + 5 should-fix,全部修复。测试:core 101 / runtime 264 / server 32 全绿,冒烟 9/9。

> **第八波(2026-09-01 续,遗留中件)**:四件全部落地。**hooks 事件面扩展**:post-tool-use / user-prompt-submit / interrupt / subagent-start / subagent-stop 接入(claude-code 语义:user-prompt-submit block = 准入前拒绝,系统上下文已落为设计去重;subagent-* 目前仅 spawn_agent 路径,DAG 节点为文档化排除);HOOK_EVENTS 白名单同步。**ApprovedForSession**:交互审批过的命令会话内精确串记忆,再执行免复批——基础 decide 先行,只升级 prompt→allow,forbid 不动,危险命令一次人工决策后可重放(codex 同语义),会话级重启即失。**bash 后台三件套**:bash 增 runInBackground(同一 execpolicy 闸——后台是调度选择不是授权旁路)、bash_output(尾 20k 流缓冲)、bash_kill(Windows taskkill /T、POSIX detached 进程组击杀);会话级注册表,settled 条目上限 20。**任务替换**:prompt 增 replace:true——abort 活跃 drain + 有界等待接管,等待耗尽诚实拒绝(并发回退会造成同日志双晋升);admission 失败只释放自己持有的 busy 旗标。独立评审一轮 6 findings(F1 并发回退门禁/F1b 旗标持有/F2 唤醒拒绝留痕/F3 注释与事实相反×2/F4 DAG 排除文档化/F5 注册表上限与 POSIX 进程组/F6 测试空白)全部修复。测试:core 102 / runtime 268 / server 32 全绿,冒烟 9/9。

## 1. MCP client seam(工具生态的标准接入口)

**决策**:`packages/mcp` 新包,零框架依赖(手写 JSON-RPC 2.0 客户端,~250 行)。`createMcpTools(configs): Promise<{ tools: Tool[]; dispose(): Promise<void> }>`——对每个配置的 server 建立连接,`tools/list` 映射为 `Tool[]`(命名 `mcp__<server>__<tool>`,沿用 CC 约定),`execute` 走 `tools/call`,content 数组拼 text,isError → throw。传输两种:`stdio`(子进程,行分隔 JSON-RPC)与 `http`(streamable:POST JSON-RPC,Accept 同时带 json 与 text/event-stream,两种响应都会解析)。

**接线**:配置在 AgentHomeConfig `mcpServers: Record<name, {command?, args?, env?, url?, headers?, enabled?, allowedTools?}>`;main.ts 启动时解析为工具,经 `AppConfig.tools` 传入(explicit 工具与本内/插件工具是**相加**关系,首个同名占位——与现有优先级规则一致)。`sideEffects: true`(保守;工具真实副作用未知)。`allowedTools` 过滤在适配层做,不进 execpolicy。

**不变量**:连接失败 = 该 server 的工具整体缺席 + stderr 告警,**绝不阻塞会话创建**(外部依赖 fail-soft)。dispose 在宿主停机时调用。

**显式不做**:resources/list、prompts、sampling;SSE 长连接回退(streamable POST 足够);OAuth 授权流。

## 2. 模型能力目录(capability catalog)

**决策**:`packages/runtime/src/catalog.ts`。目录文件 `<agentHome>/model-catalog.json`,`{ schemaVersion: 1, providers: [{ id, name?, endpoints?: { baseURL, paths?: Record<kind, string> }, defaultKind?, models: [{ id, name?, kinds?: string[], modalities?, contextWindowTokens?, maxOutputTokens?, reasoning? }] }]}`——字段语义对齐 ZCode 目录(schemaVersion 24 的简化),reasoning 保持 opaque(原样透传给设置页)。加载器最小校验(id 非空、models 数组),坏文件 = null + stderr 告警(fail-soft)。端点 `GET /v1/models/catalog` 返回 `{ catalog }`。示例文件 `examples/model-catalog.json` 入库。

**不变量**:目录是**参考数据**,不参与路由决策——provider/model 仍以 AgentHomeConfig 为准;目录缺失时端点返回 `{ catalog: null }`,UI 降级为手填。

**显式不做**:目录热更新/远端拉取;目录驱动的自动建预设。

## 3. `/v1/file` 文件内容读取端点

**决策**:`GET /v1/file?workspace=&path=`,复用 `/v1/fs` 的沙盒判定(resolve 后必须落在 workspace 根内)。响应 `{ path, size, encoding: "utf8" | "base64", content, truncated? }`:≤2MB 且前 8KB 无 NUL 字节 → utf8 全文;否则 base64;超 2MB → 截断前 2MB 并标 `truncated: true`。目录/不存在 → 403/404。

**不变量**:只读;词法逃逸与符号链接都挡(`resolve` 前缀判 + `realpath` 复判)。`workspace` 参数沿用 `/v1/fs` 语义(调用方指定根;token/回环门是外层防护)——不做注册工作区白名单。
**快照 vs 事件**:`/v1/session/:id` 快照里新流程的用户消息带 refs(不注水字节);需要图像形状的渲染走 `/events`(已注水回 `images`)。

## 4. model-io 调用轨迹(`Session.ModelCalled`)

**决策**:`RunOptions.onModelCall?: (info: ModelCallInfo) => Promise<void> | void`,`runTurn` 在流结束后调用(含 `model、source、durationMs、finish、usage、promptChars、outputChars、toolCalls、error?`)。runtime app 接线为追加 `Session.ModelCalled` 事件(source: "turn");compaction 摘要以 source "compaction" 追加。memory 提取是管线内部调用,v1 不落轨迹(source "extraction" 预留)。轨迹进事件日志 → `/v1/session/:id/events` 与 usage 聚合自然可见,零新端点。

**不变量**:轨迹 append 失败**不吞回合**——与 StepEnded 同层传播(store 坏则整体坏,不假装成功;compaction 轨迹同此);不落请求/响应正文(体积与隐私),只落计数与元数据;`promptChars` 只累计文本字段长度,绝不序列化图像 base64。

**显式不做**:per-call 正文落盘(ZCode 的 model-io 是调试器级需求,放产品层)。

## 5. 图像附件管线 wave 1(内容寻址 + 预算闸门)

**决策**:核心新增 `packages/core/src/attachments.ts`:`createAttachmentStore(rootDir)`——`put(bytes, mime) → { sha256, bytes }`(内容寻址 `<root>/ab/<sha256...>`,已存在即跳过写入=天然去重)、`get(sha) → bytes|null`。`TurnRuntime` 增加可选 `attachments`。admit 路径:prompt 图像先入 store,**新事件携带 `attachments: [{ sha256, mime, bytes }]`(引用+字节数)而非内联 base64**;`Prompted` 重放同形。lowering(messages.ts)遇到引用 → 从 store 取字节 → 现有 image part(老事件的内联 `images` 原样兼容)。服务端 `/events` 对带引用的事件**注水回 `images` 形状**返回(客户端契约不变,日志与字节解耦)。

**预算闸门(admit 时,确定性)**:单图 ≤ 20MiB 原始字节;单请求图数沿用 ≤5;总原始字节 ≤ 25MiB。注意两套闸门的层级:HTTP 传输闸门更紧(单图 4M base64 字符 ≈ 3MB、≤5 张、40MB body)会先触发——走 HTTP 的客户端永远先撞传输闸门;**引擎闸门的确定性剔除是 embedder/SDK 直连面的行为**。超总预算时**按位置从最老开始整张剔除**(同样输入永远剔同样几张)——与 dsh 的 quantum 剔除同思路;被剔的图以 `[image N omitted: over budget]` 占位进 prompt 文本。

**不变量**:store 写入不可变(同 sha 覆盖写是幂等 no-op);v1 不做 GC(对象库只增——审计优先);不做转码/降采样(无图像编解码器,编码器是未来插件 seam;客户端纪律在 handoff §5.5 已钉)。

**显式不做**:投影缓存与 pixelBudget(等编码器 seam);store GC;跨会话上传索引。

## 6. 入站渠道 seam(webhook 先行)

**决策**:`packages/runtime/src/channel.ts` + 服务端路由。配置 `channels: [{ id, sessionId?, webhookUrl?, secret?, enabled? }]`(AgentHomeConfig)。入站:`POST /v1/channel/:id/inbound {text, userId?}` → 解析渠道绑定的会话(显式 sessionId 或 `stableSessionId("channel:"+id)` 的常驻会话),以 principal "user" **走既有 prompt 全链路**(durable admission → SSE 语义同源),同步等待回合结束,返回 `{ sessionId, finish, text }`。出站:回合结算后,若配 `webhookUrl`,POST `{ channelId, sessionId, prompt, reply, finish }`,头 `X-Newhorse-Signature: sha256=<hmac(secret, body)>`,5s 超时、失败仅 stderr(渠道是旁路,绝不倒灌主链路)。

**不变量**:渠道消息与人工消息走**同一条 admission 通道**(幂等、可重放)——渠道不是第二条特权路径;secret 缺失 = 不签名但不拒绝出站(入站无鉴权字段,绑定是操作者信任决策)。v1 入站是**同步等待**:回合超过 idleTimeout(默认 120s)时入站连接会断,但回合与 webhook 仍完成——渠道调用方必须容忍;同一会话重入(如 webhook 重投)返回错误,调用方重试。

**显式不做**:IM 平台原生协议(飞书/Telegram 的 WebSocket/长轮询)、绑定码流、多用户会话隔离(v1 一个渠道一个会话)。

## 落地顺序与验收

3 → 4 → 2 → 1 → 5 → 6(小→大)。每个机制:实现 + 包内测试 + `bun typecheck` 通过;全量后独立评审 must-fix 清零。镜像同步(`scripts/sync-agent-runtime.ts`)在合入后执行。


## 接线日记录(apps/web,2026-09-01)

UI 外壳换桩接真引擎,模拟环境:fake-llm(4141,openai 兼容)+ 引擎(3931,免 token 回环,UI dist 同源,NEWHORSE_ALLOW_BASH=on,workspace=临时目录)。已接:全部 GET 读路径、prompt SSE 流式(含中断联动)、steer、policy、fork/title/archive/delete/compact、settings PUT(预设切换/行为策略/记忆开关;allowBash/allowPluginCode 改为只读展示——宿主层启动开关,引擎 PUT 不收)、approvals、memory 三操作、schedules 五操作、DAG spec 提交、命令面板中断指向当前路由会话、封面提交=常驻会话引导+草稿交接(sessionStorage)、图片附件真实文件选择(base64,3MB 前置校验)、会话 4s 轮询。端到端验证:真实回合全链路(admission→fake-llm 流式→search/read/todo_write/write 工具真实执行→SQLite→转录重折:markdown/代码块/diff 着色/变更卡/任务清单/标题自动生成)、设置 PUT 持久化双向验证。

**模拟测试发现的引擎问题(单独记录,待修)**:
1. 只读重挂路径间歇 404:drain 写 SQLite 期间,findSession 的 readonly 重挂连接可能撞锁 → try/catch 吞掉 → findSession 误报 missing(404)。建议 busy_timeout 或短重试。波及所有 /v1/session/:id* GET。
2. 进程重启后未结算回合状态粘滞 active:drain 被杀无 Settled/Interrupted 落盘,registry 永远 active。建议启动时对 active 且无后续事件的行落 Interrupted(或视为 interrupted 展示)。
3. provider baseUrl 陷阱:适配器自动补 /v1/chat/completions 等路径,baseUrl 必须不带版本段——文档应显式写明(fake-llm 对接时踩过)。
