import type { Tool, EventStore } from "@newhorse/core"
import type { MemoryStore } from "@newhorse/memory"
import { discoverSkills } from "@newhorse/plugin"
import { createReadTool } from "./read"
import { createWriteTool } from "./write"
import { createEditTool } from "./edit"
import { createMultiEditTool } from "./multi-edit"
import { createViewImageTool } from "./view-image"
import { createAskUserTool } from "./ask-user"
import { createEnterPlanModeTool } from "./plan-mode"
import { createLspTool } from "./lsp"
import { createListTool } from "./list"
import { createSearchTool } from "./search"
import { createBashTools } from "./bash"
import { createMemorySearchTool, createMemoryWriteTool } from "./memory"
import { createSkillTool } from "./skill"
import { createTodoWriteTool } from "./todo"
import { createGoalTools } from "./goal"
import { createWebFetchTool } from "./webfetch"
import { createWebSearchTool } from "./web-search"
import { createSelfTools, type SelfAwarenessOptions } from "./self"

export { createExecPolicy, createBuiltinExecPolicy, rulesFilePath, simpleHash } from "./execpolicy"

/**
 * Build the builtin toolset (M3.5). These are the agent's "hands": read / write
 * / edit / list / search are always available and sandboxed to the workspace;
 * bash is an explicit opt-in because it is not constrained by the fs sandbox
 * (M3.5 §2.2). `enableBash` must be set by the caller (typically via AppConfig)
 * to expose the shell tool.
 *
 * When a `memoryStore` is supplied, the memory tools (memory_search /
 * memory_write) are appended — the seam's consumer side. No store = no memory
 * tools (a clean default; the engine is not memory-captive).
 */
export interface BuiltinToolsOptions {
  readonly workspace: string
  /** Opt-in shell tool; off by default because it escapes the fs sandbox. */
  readonly enableBash?: boolean
  /** Optional memory seam; when present, memory tools are exposed. */
  readonly memoryStore?: MemoryStore
  /** Optional plugin/skills directory — a `skill` loader tool is exposed that
   *  discovers skills/{name}/SKILL.md (or flat {name}.md) lazily. */
  readonly skillsDir?: string
  /** Event store for the todo tool (durable task list). Optional — no events,
   *  no todo tool. */
  readonly events?: EventStore
  /** Self-awareness seam (wave 9): identity/config/context facts for the
   *  self_status + get_context_remaining + current_time + sleep tools.
   *  Absent = the toolset is not exposed. */
  readonly self?: SelfAwarenessOptions
  /** Opt-in web tools (wave 12: web_fetch + web_search): escape the fs sandbox like bash. */
  readonly enableWeb?: boolean
}

export function createBuiltinTools(opts: BuiltinToolsOptions): Tool[] {
  const tools: Tool[] = [
    createReadTool(opts.workspace),
    createWriteTool(opts.workspace),
    createEditTool(opts.workspace),
    createMultiEditTool(opts.workspace),
    createViewImageTool(opts.workspace),
    createListTool(opts.workspace),
    createSearchTool(opts.workspace),
    createAskUserTool(),
    createEnterPlanModeTool(),
    createLspTool(opts.workspace),
  ]
  if (opts.enableBash) tools.push(...createBashTools(opts.workspace))
  if (opts.enableWeb) tools.push(createWebFetchTool(), createWebSearchTool())
  if (opts.memoryStore) {
    tools.push(createMemorySearchTool(opts.memoryStore))
    tools.push(createMemoryWriteTool(opts.memoryStore))
  }
  if (opts.skillsDir) {
    tools.push(createSkillTool(() => discoverSkills(opts.skillsDir!)))
  }
  if (opts.events) {
    tools.push(createTodoWriteTool(opts.events))
    tools.push(...createGoalTools(opts.events))
  }
  if (opts.self) {
    tools.push(...createSelfTools(opts.self))
  }
  return tools
}
