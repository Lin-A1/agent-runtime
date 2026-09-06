import { expect, test } from "bun:test"
import { observeMediaQuery } from "./useMediaQuery"
import { createBuiltinProviders } from "../workbench/providers"

test("child agents are registered resources and do not navigate the parent conversation", async () => {
  expect(createBuiltinProviders().find((provider) => provider.resource.id === "agents")?.resource.state).toBe("ready")
  const view = await Bun.file(new URL("../components/AgentsView.tsx", import.meta.url)).text()
  const pane = await Bun.file(new URL("../components/WorkbenchPane.tsx", import.meta.url)).text()
  const sidebar = await Bun.file(new URL("../components/Sidebar.tsx", import.meta.url)).text()
  expect(pane).toContain("row.parentId === sessionId")
  expect(view).toContain("onClick={() => setSelected(row.sessionId)}")
  expect(view).not.toContain("useNavigate")
  expect(view).not.toContain("<Composer")
  expect(view).toContain("current !== generation.current")
  expect(view).toContain("frame.sessionId === child.sessionId")
  expect(sidebar).not.toContain("subagents={sessions.filter")
})

test("media subscription follows both breakpoint transitions and cleans up", () => {
  const events = new EventTarget()
  const media = {
    matches: false,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }
  const values: boolean[] = []
  const dispose = observeMediaQuery(media, (value) => values.push(value))
  media.matches = true
  events.dispatchEvent(new Event("change"))
  media.matches = false
  events.dispatchEvent(new Event("change"))
  dispose()
  media.matches = true
  events.dispatchEvent(new Event("change"))
  expect(values).toEqual([false, true, false])
})

test("drawer integration retains approvals and renders one sidebar content tree", async () => {
  const sidebar = await Bun.file(new URL("../components/Sidebar.tsx", import.meta.url)).text()
  const transcript = await Bun.file(new URL("../components/Transcript.tsx", import.meta.url)).text()
  const approval = await Bun.file(new URL("../components/ApprovalDock.tsx", import.meta.url)).text()
  expect(sidebar.match(/\{sidebarContent\}/g)).toHaveLength(1)
  expect(sidebar).toContain("if (isMobile) onOpenMobile?.()")
  expect(transcript).toContain("<ApprovalDock hidden={navDrawerOpen || (workbenchOpen && drawerMode)} onPendingCount={setPendingApprovals} focusRequest={approvalFocusRequest} />")
  expect(transcript.match(/<ApprovalDock\b/g)).toHaveLength(1)
  expect(approval).toContain("onPendingCount?.(pending.length)")
  expect(approval).toContain("requestAnimationFrame(() => panelRef.current?.focus())")
  expect(sidebar).not.toContain("childrenMap")
  const pane = await Bun.file(new URL("../components/WorkbenchPane.tsx", import.meta.url)).text()
  expect(pane).toContain("drawerMode && pendingApprovals > 0")
  expect(pane).toContain("onClick={onOpenApprovals}")
  expect(pane).not.toContain("api.approvals")
  expect(approval).toContain("if (!current || hidden) return null")
  expect(approval).toContain("if (!isQuestion || hidden) return")
})

test("resource delivery clears request and drawer trap follows responsive state", async () => {
  const pane = await Bun.file(new URL("../components/WorkbenchPane.tsx", import.meta.url)).text()
  const transcript = await Bun.file(new URL("../components/Transcript.tsx", import.meta.url)).text()
  expect(pane).toContain("if (!drawerMode) return")
  expect(pane).toContain("}, [drawerMode])")
  expect(pane).toContain("onRequestedTabConsumed?.()")
  expect(transcript).toContain("useCallback(() => setResourceRequest(undefined), [])")
  expect(transcript).toContain("onRequestedTabConsumed={consumeResourceRequest}")
})
