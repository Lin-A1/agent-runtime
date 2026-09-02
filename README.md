# agent-runtime

**A reusable, model-agnostic agent runtime server.** Embed a full agent engine — sessions, tool loops, declarative DAG orchestration, durable memory, a permission layer — into any AI-native product via one HTTP/SSE boundary and a typed SDK.

> The stable that houses the horses. Developed in the [`newhorse`](https://github.com/Lin-A1/newhorse) monorepo; this repository is its standalone storage for reuse.

## Quick start (zero code)

```bash
NEWHORSE_PROVIDER=anthropic \
NEWHORSE_BASE_URL=https://api.anthropic.com \
NEWHORSE_API_KEY=sk-... \
NEWHORSE_MODEL=claude-sonnet-4 \
NEWHORSE_MEMORY=on \
bun run packages/server/src/main.ts
# → listening : http://127.0.0.1:3927  (token: loopback-only)
```

The whole runtime is env-configured — provider, model, persistence, memory, semantic search, tool trust. See the full env table in `packages/server/src/main.ts`.

## Embed it (SDK, three lines)

```ts
import { createSdkClient } from "./packages/sdk/src/index.ts"

const client = createSdkClient({ baseUrl: "http://127.0.0.1:3927", token: process.env.TOKEN })
const sessionId = await client.createSession({ workspace: "/your/project" })
const result = await client.prompt(sessionId, "Fix the failing test", (e) => {
  if (e.type === "text") process.stdout.write(e.text)
})
```

## What the runtime gives you

| Capability | How |
|---|---|
| **Agent sessions** — durable, restart-safe, event-sourced (`(aggregate_id, seq, type, data)`) | admission inbox → turn loop → tool settlement; interrupted tools settle durably, never replayed |
| **Orchestration** — `spawn_agent` children + declarative DAG graphs, ONE task semantics (`wait_agent`/`followup_task` track both) | per-node models (cost-down), agent roles (restrictive overlay), crash-resume (`resumeDag`) |
| **Task hierarchy** — goal (objective + token budget, enforced) → DAG → todo (model-maintained list) → delegated tasks | `goal_write/goal_read`, `todo_write` |
| **Memory** — durable + switchable semantic search (FTS5 × cosine RRF), post-turn extraction | `memory_write/search` + `EmbeddingProvider` seam (MiniMax / OpenAI-compatible) |
| **Tools** — read/write/edit/list/search/bash + todo/goal/memory/skill, all behind a permission floor | execpolicy: fail-closed, user-approved rules persist |
| **Extensibility** — five-kind plugin seam, directory-as-registration (`tools/ agents/ commands/ hooks/ skills/`), `.ts` tools behind a trust switch | hooks (stop / pre-tool-use), commands (`/name`), providers |
| **MCP ecosystem** — external MCP servers mount into the tool seam (`mcp__<server>__<tool>`) | stdio + streamable-HTTP transports; config `mcpServers` (secrets presence-redacted in settings round-trips); fail-soft: a dead server removes only its tools, never blocks session creation |
| **Model-agnostic** — four-axis Route; openai / openai-responses / anthropic protocols | one canonical `LLMRequest`/`LLMEvent` vocabulary; provider quirks never leak |

## Reuse contract

- **HTTP/SSE** (see `specs/v2/server.md`): `POST /v1/session`, `POST /v1/session/:id/prompt` (SSE), `/steer`, `/interrupt`, `GET /v1/session/:id`, `/v1/sessions`, `/v1/audit`, `/v1/session/:id/events`. Token auth or loopback-only.
- **SDK**: `packages/sdk` — typed client, no domain logic crosses the boundary.
- **Config**: everything via env (see the table in `packages/server/src/main.ts`).

## Repository topology

```
newhorse (monorepo, upstream)  ──develop──▶  agent-runtime (this repo, standalone storage/reuse)
```

The engine packages (`schema → core / llm → plugin → memory → mcp → runtime → server / sdk`) live here; `packages/cli` is a reference shell. Runtime changes are developed upstream and synced here (`git pull upstream dev`).

## Development

```bash
bun install
cd packages/core && bun test        # per-package tests (299 total, all green)
bunx tsc --noEmit                   # strict, clean in every package
```

Design record: `docs/core-technology-notes.md` (24 sections) + `docs/architecture-map.md` (drift sentinel). Plans: `specs/v2/`.
