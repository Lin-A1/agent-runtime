# Workbench Design

> 宿主层设计记录，2026-09-04

The web shell has three coordinated layers: conversation content, an in-flow Workspace Pulse status row, and the operational Workbench pane. Pulse is compact by default; its detail popover is anchored to the row and does not obscure transcript content. The workbench remains a separate stable pane, with a scrim at z-index 50 and pane at z-index 60.

Approval requests render immediately above the single session composer inside the chat column. Current-session, other-session, and global requests remain in the queue and identify their scope in the header. On mobile the approval panel is bounded and scrollable so the composer remains reachable.

Conversation reading is capped at 880px and body text uses 15px. Sidebar rows use a 40px rhythm and 13px text. Cover and empty Transcript preserve the existing full EmotionBall engine with interactive gaze/spin and its planetary ring. Starter capability cards are not rendered. The session keeps a single docked Composer; Cover creates a real session before any prompt can be sent.

Desktop sidebar collapse is persisted and retains a visible Lucide panel-left reopen control. Mobile always exposes the full conversation drawer, independently of the desktop collapsed preference. Workspace groups can collapse; child agents remain workbench resources rather than nested sidebar navigation.

Workbench resources share neutral surfaces, compact chrome, readable file/context typography and unboxed icons. Context facts are separated by rules instead of nested cards. Resource readiness gates builtin and external rendering, so an unavailable provider does not expose enabled execution controls.

File navigation uses the actual `file-navigation.ts` reducer for directory back/forward history and branching. Root and parent controls and clickable breadcrumbs remain visible. Closing a preview returns its space to the list. Search uses AbortSignal plus a generation guard, including invalidation on query/workspace changes and unmount, with IME-safe Enter and explicit empty/error states. External file URLs include the workspace; server containment remains unchanged.

Providers continue to own resource tabs. Pulse supplies a resource request prop, including a fresh request identity so repeated requests to the same tab are applied after manual tab changes. Both mobile drawers support Escape, focus cycling and return focus; opening navigation closes the workbench and Pulse. The pane lifecycle does not interrupt session execution.

Existing host boundaries remain unchanged: builtin/plugin/MCP resources register in the web host, not core or runtime. Resource failures remain explicit; session-derived activity is not Git truth. Workspace containment, execution policy, HTTP(S)-only external links, and logged model visibility are unchanged. Browser, Git, PTY and review resources remain extension capabilities, not claims about the current builtins.

Approval UI is suppressed while a navigation or workbench drawer owns focus, without unmounting its queue/poller or losing a draft answer. Sidebar content has a single responsive tree; mobile search opens that drawer before focusing the shared input. Workbench drawer focus ownership subscribes to the 1279px breakpoint, including resize transitions. Resource requests are consumed on delivery so normal reopen restores the persisted tab rather than replaying a stale Pulse request.

Child agents belong in workbench resources, not nested sidebar navigation. The builtin `agents` tab lists children by the current parent session id, with recorded title, status and model. Selecting a child opens its read-only durable transcript inside the pane and preserves the parent conversation. Child events refresh that view; a generation guard rejects stale responses and responses after unmount. No child Composer or simulated control API is provided.

Validation: package-local typecheck, production build and focused media-subscription/integration contract checks accompany the URL tests. No browser verification was performed, as requested. Layout and focus behavior still need visual/interactive regression coverage.