# web-shell — reference UI for agent-runtime

A complete web client for the agent-runtime HTTP/SSE API. It is a **consumer**
of the runtime, not a package of it: every interaction goes through the
`/v1` endpoints (or the SSE `/v1/events/stream` bus) — no runtime internals are
imported.

## Run

```bash
# 1. Build the shell
cd examples/web-shell
bun install
bun run build        # -> dist/

# 2. Start the runtime server with uiDir pointing at the built shell
NEWHORSE_UI_DIR="$(pwd)/dist" bun packages/server/src/main.ts
# open http://127.0.0.1:3927
```

The runtime server serves the built shell on the same origin — API + UI
together is what makes desktop and LAN mobile access a single artifact.

Dev mode (hot reload + proxy to an already-running runtime server on 3927):

```bash
bun run dev          # http://127.0.0.1:5199, /v1 proxied to 127.0.0.1:3927
```

## What it demonstrates

- **Session lifecycle** — create / list / open / delete / archive, fork & truncate (rewind)
- **Streaming turns** — POST /v1/session/:id/prompt (SSE), interrupt, steer (interject mid-turn)
- **Approvals** — GET /v1/approvals queue + settle (ask_user questions & command/path gates)
- **Context & cost** — /v1/session/:id/context capacity bar + cache-hit rate, /v1/usage
- **Model switching** — per-session ModelSet via /v1/session/:id/model; provider picker via /v1/providers
- **Slash commands & mentions** — /v1/commands + /v1/session/:id/command, @agent/@skill/@mcp resolution
- **Workbench resources** — shared terminal (POST/GET /v1/session/:id/terminal), files (/v1/fs), file activity, subagents, memory, context

## Layout

```
src/
  api/        client.ts (typed HTTP), bus.ts (SSE), fold.ts (event log → turns)
  components/ Transcript, Composer, Sidebar, ApprovalDock, WorkbenchPane, Markdown(→mermaid) ...
  state/      store.tsx (AppProvider/StreamProvider), stream-ownership.ts
  lib/        completion, url, useMediaQuery
  workbench/  resource registry, file navigation, terminal controller
```

No runtime package is imported; `api/client.ts` is the single typed boundary.
