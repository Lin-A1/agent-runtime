# Adapter Roadmap

## Current

- The four-axis Route and protocol adapters provide the canonical `LLMRequest`/`LLMEvent` seam.
- Provider registration validates IDs and supports stack-safe reversible replacement.
- Model discovery is metadata-only: it lists provider model IDs using protocol-aware headers and fail-soft parsing. It is not a full gateway, model router, or executable catalog.
- Anthropic discovery uses `GET /v1/models`, `x-api-key`, `anthropic-version`, and compatible `data`/`models` response shapes.

## Transport Integrity Invariants

This bounded transport consolidation serves pillars 2 (long-horizon correctness) and 5 (usability), using the existing HTTP/SSE boundary, not a new runtime mechanism. Domain admission and durable outcomes remain owned by runtime; client interruption is not a fabricated durable settlement.

- Every local JSON request reader counts actual streamed bytes before decoding/parsing, including absent or inaccurate Content-Length. The existing 40,000,000-byte prompt ceiling becomes the shared JSON ceiling; equality is allowed. Oversize cancels the reader and returns HTTP 413 with `{ "error": "request body too large" }`; malformed JSON retains HTTP 400 and its existing error body; empty bodies remain `{}`.
- Prompt SSE completes only after a framed `done` (with finish), `result` (with finish), or `[DONE]`. EOF without a terminal marker is interrupted transport, not `stop`. Abort is distinct. Readers are cancelled/released on early termination. Malformed frames cannot manufacture completion.
- A successful HTTP response or uncertain transport failure must not cause automatic prompt replay or restoration of potentially admitted text/images. Only explicit HTTP client rejection restores the draft. Interruption remains visible; persisted history is the reconciliation source.
- Each locally initiated stream owns a unique prompt identity and controller. Event application and settlement updates check that identity; stopped controllers reject late frames. Cleanup may remove only its own controller. Busy ownership is synchronous so consecutive sends cannot race React rendering into duplicate prompt POSTs.
- Degradation is explicit interruption with preserved transcript, not inferred successful completion. No model calls or new core/provider behavior are introduced.

## Browser-verified round (shared terminal / model switch / image fix)

- **Shared terminal rebuilt for real (all sessions).** The one-shot exec hack was reverted. `runtime/terminal.ts` gives EVERY session ONE persistent workspace shell (Git Bash probe on Windows per dsh-workbench, ComSpec fallback; `$SHELL`/bash elsewhere). The human (web terminal: command line + raw `^C`) and the agent (`terminal_send` with the same exec-policy floor as bash, `terminal_read` incremental) drive the SAME stdin; output is one shared stream with sentinel boundary lines stripped (protocol borrowed from dsh-workbench's pipe mode); an activity ledger tags each input `human|agent`. Server: `POST/GET /v1/session/:id/terminal`; teardown kills the shell.
- **Per-session model switch.** `Session.ModelSet` (durable, survives re-attach) + `app.setModel` (next prompt uses it; child/summarizer/memory resolve `activeModel` live) + `POST /v1/session/:id/model` + registry fold (label updates immediately). The sidebar picker now switches the global default AND the open session; profiles list their `model` even without a catalog; provider config (baseUrl/apiKey/model/budgets, add/remove) writes through the settings upsert (empty apiKey keeps the stored secret — verified in config.json).
- **Image fix — real root cause found and proven.** `projectCompacted` rebuilt user messages from `Prompted` WITHOUT the PromptAdmitted attachments/images, so the request literally contained no image (API simulation captured the outgoing body before/after). Now grafted back in both branches; the e2e test asserts an `image_url` block with the base64 reaches the provider request. Browser: paste → preview chip → send → attachment ref logged.
- **Context capacity panel (image-1 style).** `app.contextBreakdown` buckets chars (system prompt / conversation / builtin tools / MCP tools); `/context` returns token shares + `avgCacheHitRate` + a window-size fallback from the model catalog. UI renders the segmented capacity bar (`92 / 100万（0%）` shape), per-bucket legend, and a real spinning refresh with 更新于 stamp.
- **Hook freeze fix (found by browser testing).** `useSessionContext` re-ran (and aborted) all four requests on every transcript bus refresh — a burst left the panel on "刷新中…" with the refresh button disabled forever. events is now a ref (fallback only) + auto-reload on turn settle.
- **Composer residue fix (found by browser testing).** `onSelect` wrote the STALE closure `text` back into state after send-cleared, resurrecting the draft. It now reads the DOM value.
- **Rewind/Edit buttons.** Rewind confirmation is inline (window.confirm is suppressed in embedded webviews — clicking looked dead); verified end-to-end in browser: confirm strip → truncate (34→4 events) → transcript folds to 1 turn. Edit fills the composer.
- **Butler cleanup verified.** 清理 (eraser) on the resident row → confirm strip → `truncate atSeq 0` → log is `[Created, Truncated]`, identity kept.
- **Archived subagents verified in UI.** `close_agent`-equivalent archive → workbench agents tab count drops, list shows 暂无子智能体 (with the full-chain runtime test proving `archived:true` in list_sessions).

## Active toolset + rewind + interject (user-facing)

- **`/` slash command executes.** `Composer` sends a single-line `/name args` through `POST /v1/session/:id/command` and forwards the command's expansion (the model sees the result, not the raw `/name`). A multi-line body, an image, or a non-command falls through to a normal prompt.
- **`@` references inline real content.** New `POST /v1/session/:id/references/resolve` parses `@agent:name` / `@skill:name` / `@mcp:server/uri` and injects the referenced material (agent body / SKILL.md body / MCP resource text) into the prompt, so the model sees actual content rather than a bare `@token`. Unresolvable refs stay literal.
- **In-place rewind ("回退").** `EventStore.truncate(id, atSeq)` deletes events past `atSeq` synchronously (SQLite `DELETE ... WHERE seq > ?` + rewind the per-aggregate allocator so the next append allocates `atSeq + 1`); a `Session.Truncated` boundary is appended. `POST /v1/session/:id/truncate` exposes it; the Transcript card gains a "回退到此" button (confirm-guarded, destructive by design).
- **Interject + question queue.** Busy-session sends already route to `steer` (mid-turn insert); the Composer now labels that state explicitly ("插话中 · 发送即插入当前回合"). The ApprovalDock question queue renders its source session by title and distinguishes current/other sessions.

## User-issue sweep (workbench / projects / models / rendering)

- **`---` now renders as a horizontal rule.** `Markdown.tsx` had no `<hr>` handling, so a model's `---` section divider rendered as a literal text line ("looks like a broken render"). Added the divider branch (also handles `***`/`___`).
- **Image upload: mime sniffing fallback.** When the browser reports an empty/generic `file.type` (common on Windows), `Composer` now sniffs magic bytes (PNG/JPEG/GIF/WebP) so the preview chip always appears for real images.
- **Provider/model picker fallback.** With no named provider profiles configured (single-provider setups), `ProviderPicker` now shows the ACTIVE provider + its catalog models instead of an empty "没有已配置的提供方".
- **Sidebar project scope.** "项目" now groups ALL top-level sessions by workspace (every newProject appears under its own project group), "全部" flattens them by recency. Previously "项目" hardcoded only the global workspace, hiding sessions created in other workspaces.
- **New-project workspace now exists.** `POST /v1/session` mkdir -p's the workspace so the files tab + terminal have a real cwd (a nonexistent cwd made `spawn` fail with `ENOENT ... uv_spawn 'cmd'`). Windows bash now resolves `cmd` through `ComSpec` instead of PATH lookup.
- **Context panel refresh feedback.** The refresh button now spins while stale, shows "刷新中…" and an "更新于 hh:mm:ss" stamp, and the token facts include a cache-hit-rate percentage.
- **Archived subagents leave the workbench.** `WorkbenchPane` children now filter `archived` rows, so an agent-archived subagent disappears from the tab + count.
- **Resident-session cleanup.** The butler row gains a "清理会话" (eraser) action that truncates to `atSeq 0` (keeps Session.Created + identity; system context re-injects on next prompt).
- **Shared terminal (first half).** The workbench terminal tab now also shows the AGENT's bash tool executions (from the session log) as read-only `[agent]` entries, so each side can see what the other ran. A full shared PTY (persistent shell + agent open/send/read tools + xterm streaming, cf. dsh-workbench) remains a larger follow-up.

## Subagent / Butler seam fixes (engine correctness)

These close the gaps surfaced by the user + adversarial audit, without inventing cross-process delivery that is still Phase 5-partial:

- **`close_agent` now really archives.** A new `archiveTarget` seam on `ToolCtx` appends `Session.Archived` so `list_sessions` / the registry fold reflect a close. Without the seam (non-app host), the tool reports `closed:false` + `implemented:false` instead of a fake success. (Previously it only `interrupt`ed and returned `closed:true` while the registry stayed `archived:false`.)
- **`resume_agent` prefers a true re-drive.** A settled child is unregistered in the live hub, so the old `sendToTarget` path reported `implemented:false` and never re-drove it. A new `resumeTarget` seam (hub `resume` + shared child driver) re-admits and re-drives to settlement; when no seam is bound it returns `resumed:false` + a reason rather than pretending. This is in-process (M4), not cross-process.
- **`followup_task` / `wait_agent` are read-guarded.** A non-user/non-butler caller may only observe its OWN direct child's task state (a child transcript is privileged). Unknown tasks still return an honest `unknown`, not a hard deny. Denies are audited.
- **`declare_dag` + `POST /v1/dag` preflight the graph.** A cycle / unknown-dep / self-dep / dangling entry now throws synchronously before the fire-and-forget runner fires, so the model never sees a phantom `dagId` from a graph that can only fail later.

## Known boundary: butler DAG store isolation (not yet fixed)

`createDagRunner` opens its **own** `events.db` under `dataDir` (dag-api.ts:115), separate from a butler session's event store. When a host builds a runner that way and injects it as `AppConfig.dagRunner` (CLI does this), butler-declared DAG nodes are driven correctly (a node child IS a real, registered child via `Session.Spawned {parentId, via:"dag"}` and is live-registered to the declarer's hub — see `dag-runner.test.ts`), but they land in the runner's store, so `list_sessions` / `followup_task` (reading the session's store) do not see them. Node instantiation, topological ready/wakeup, per-node model, interruption and durable `Session.Settled` are all correct *within* the runner's store. The fix is to have `createApp` build the butler's DAG runner over the SAME `events` store (or let the runner accept an injected store), so DAG children are visible/queryable from the declaring session. This is a host-wiring change with a wide blast radius, so it is recorded here as a known boundary rather than half-fixed.
- **Butler tools now expose `inputSchema`** (spawn/send/interrupt/followup/wait/resume/close/declare) so the protocol layer surfaces the real shape instead of an empty-object schema; `ask_user` trims the question and sanitizes choice options to 2-4 non-empty short labels.

## Next

1. ~~Real adapter consumer~~ DONE: `ProviderDefinition.createClient` is executable (builtins delegate to `makeLlmClient`), `AppConfig.adapterRegistry` lets a host inject a registry into `createApp`, and `resolveProviderSelection` maps a runtime profile to a registry id with a typed error for missing profiles (never silent fallback). `Session.ModelCalled` traces now carry `providerId` for honest attribution.
2. ~~Bounded request bodies~~ DONE: `readJsonOr400` counts actual streamed bytes even without Content-Length, cancels on overflow, and returns 413.
3. ~~Stream EOF and generation accounting~~ DONE: web `consumePromptStream` requires a framed terminal (`done`/`result`/`[DONE]`), and stream ownership guards reject late frames from replaced controllers.
4. Catalog and model selection UI. Server `GET /v1/providers` (redacted profiles + hasApiKey), `/v1/models/catalog`, and SDK `providers()/catalog()/models()` are live; remaining work is the capability-aware model picker in the web UI using the corrected catalog types (modalities object, provider endpoints/defaultKind). Dependency: real adapter consumer (done).
5. Audited `@` semantics. Acceptance: model/provider references are parsed, authorized, and resolved deterministically with audit events. Dependency: catalog selection and scope rules.
6. Attachment image steering. Acceptance: supported image inputs are capability-checked and lowered per protocol, with an explicit unsupported path. Dependency: model capability metadata.

Failover remains later work: enable it only after durable actual-model attribution exists for every attempt. OAuth credentials are also later, after the basic credential seam is audited.

These priorities are informed by local reviews of cc-switch and opencode: keep discovery/catalog data separate from execution, and make routing/account selection explicit before adding failover.
