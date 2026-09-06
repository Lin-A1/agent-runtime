# AGENTS.md — newhorse (web shell host)

> This repo is the reference **web shell** for agent-runtime. The **engine's north star** (what the engine is, five differentiators, invariants, design records) lives in [`agent-runtime`](https://github.com/Lin-A1/agent-runtime) — its `AGENTS.md`, `specs/v2/`, and `docs/` are the authoritative engine contract. **Read those first** before touching anything engine-related.

## What this repo owns

- `apps/web` — the React/Vite/Tailwind chat UI (the only real product of this repo).
- `packages/*` — a **build convenience copy** of the runtime packages so `apps/web` (and the dev server) can run standalone. **Not a source of truth**: engine changes go to agent-runtime; this copy may drift and is refreshed from there.
- `docs/` — shell/UI research & design notes (`frontend-pre-review`, `shell-plan`, `workbench-design`, gap reports). Engine design notes live in agent-runtime's `docs/`.

## Invariants

- **The UI consumes the runtime only through its `/v1` HTTP/SSE API** (or `@newhorse/sdk`) — never import runtime internals. `apps/web/src/api/client.ts` is the single typed boundary.
- **No engine work in this repo.** If a change belongs to the runtime (schema/core/llm/plugin/memory/mcp/runtime/server/sdk), make it in agent-runtime, then refresh this repo's copy if the local dev server needs it.
- **Slim by design.** The shell is chat-focused: sessions, streaming turns, tool/thinking traces, markdown, images, model switch, rewind/rewrite/retry. No workbench pane, no approval panel, no workspace-config surface. When adding a feature, ask whether it belongs to the shell or the runtime — and prefer the runtime side.

## Dev

```bash
cd apps/web
bun install
bun run build            # dist/ served by the runtime server (NEWHORSE_UI_DIR)
bun run dev              # hot reload, /v1 proxied to 127.0.0.1:3927
bun typecheck            # tsc --noEmit
```

## Commits

Conventional commits: `type(scope): summary`. Scopes for this repo: `web`, `docs`, `host`.
