import { expect, test } from "bun:test"
import { observeMediaQuery } from "./useMediaQuery"

// NOTE: the old workbench-era assertions (WorkbenchPane / AgentsView /
// providers) went away with the workbench direction. What remains are the
// invariants that still matter: one sidebar content tree, a single approval
// dock mounted in the transcript, and clean mobile drawer wiring.

test("child agents are registered resources and do not navigate the parent conversation", async () => {
  const sidebar = await Bun.file(new URL("../components/Sidebar.tsx", import.meta.url)).text()
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

test("approval dock mounts exactly once and gates hide with it", async () => {
  const transcript = await Bun.file(new URL("../components/Transcript.tsx", import.meta.url)).text()
  const approval = await Bun.file(new URL("../components/ApprovalDock.tsx", import.meta.url)).text()
  expect(transcript.match(/<ApprovalDock\b/g)).toHaveLength(1)
  expect(transcript).toContain("<ApprovalDock sessionId={sessionId} onPendingCount={setPendingApprovals} />")
  // Polling + settle wiring exists.
  expect(approval).toContain(".approvals()")
  expect(approval).toContain(".approve(")
  // Questions render option buttons; deny path exists (graceful degradation).
  expect(approval).toContain("current.options.map")
  expect(approval).toContain("settle(false)")
  // Hidden/absent states render nothing (never a floating empty dock).
  expect(approval).toContain("if (hidden || !current || minimized)")
})
