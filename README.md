# newhorse

**The reference web shell for agent-runtime.** A minimal, good-looking chat UI that drives the [**agent-runtime**](https://github.com/Lin-A1/agent-runtime) engine over its HTTP/SSE API — sessions, streaming turns, approvals, model switching, rewind / rewrite / retry. The engine itself (sessions, tool loops, declarative DAG, durable memory) lives in the agent-runtime repo.

> **Repository topology**: this repo is the **host shell (web UI)** — `apps/web` consumes the runtime's `/v1` endpoints only. The **engine** is developed directly in [**Lin-A1/agent-runtime**](https://github.com/Lin-A1/agent-runtime); see `AGENTS.md` → "Repository topology". No upstream/mirror relationship remains — the two repos are independent.
>
> The runtime packages under `packages/*` are kept in this repo only so the dev server can run standalone against a local copy — they are a build convenience, not a source of truth. For the engine's design notes, see **agent-runtime** `docs/`.

## The shell

- **Minimal chat** — session list, streaming turns, tool/thinking traces, markdown (incl. mermaid), image attachments, model switch, rewind / rewrite / retry.
- **Slim by design** — no workbench pane, no approval panel UI (the runtime keeps the approval API; this shell stays chat-focused), no workspace configuration surface.
- **Consumes, never imports** — `apps/web/src/api/client.ts` is the single typed boundary over `/v1`; no runtime internals are touched.

## Run

```bash
# 1. Build the UI
cd apps/web && bun install && bun run build       # → apps/web/dist

# 2. Run the engine (agent-runtime) with this UI served on the same origin
NEWHORSE_UI_DIR="$(pwd)/apps/web/dist" bun run agent-runtime/packages/server/src/main.ts
# open http://127.0.0.1:3927

# Dev mode (hot reload, /v1 proxied to the runtime server on 3927)
bun run dev                                        # http://127.0.0.1:4173
```

## Layout

```
apps/web/
  src/api/       client.ts (typed /v1 boundary), bus.ts (SSE), fold.ts (event log → turns)
  src/components/ Transcript, Composer, Sidebar, Markdown(→mermaid), ThinkingTrace, ToolTrace …
  src/state/     store.tsx (AppProvider/StreamProvider), stream-ownership.ts
  src/lib/       completion, url, useMediaQuery
```

For the engine's architecture / capability list / design records, head to **agent-runtime**: `README.md`, `docs/architecture-map.md`, `docs/core-technology-notes.md`.
