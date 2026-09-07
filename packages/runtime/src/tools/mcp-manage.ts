import type { Tool } from "@newhorse/core"

/**
 * Agent-managed MCP configuration — a builtin tool that reads/writes the
 * mcpServers section of the agent-home config (never touches the filesystem
 * tools, so an exec policy that chroots fs/bash to the session workspace
 * cannot block it).
 *
 * list   : every configured server + enabled/credential presence
 * set    : flip a server's enabled (or rewrite its command/url)
 * get    : one server's detail
 *
 * The tool can only persist config — the running server still loads MCP tools
 * at startup (a note at the end of a `set` tells the agent to restart).
 */
export interface McpManageCtx {
  /** Read the current mcpServers block from config. */
  read: () => Promise<Record<string, unknown>>
  /** Write a full replacement mcpServers block (omitted = removed). */
  write: (mcpServers: Record<string, unknown>) => Promise<void>
  /** Current working directory (for the tool's own logging). */
  cwd?: string
}

export function createMcpManageTool(ctx: McpManageCtx, label = "mcp_manage"): Tool {
  return {
    name: label,
    description:
      "管理 MCP 服务器配置（工具接入）：list 列出全部 MCP 是否启用，set 启用/禁用/修改命令或 URL。" +
      "修改只持久化到 config.json，服务重启后新会话可见新增的 MCP 工具。若用户想接一个已配置但未启用的工具，先用 set 启用，再提醒重启服务。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "set"], description: "list=全部列表 get=单个 set=设置" },
        name: { type: "string", description: "get/set 的服务器名，如 amap / luckin" },
        enabled: { type: "boolean", description: "set 时启用( true )/禁用( false )" },
        command: { type: "string", description: "set 时替换启动命令（只写 command，不重复 args 时保留原 args）" },
      },
      required: ["action"],
    },
    sideEffects: true,
    execute: async (input: unknown) => {
      const { action, name, enabled, command } = (input ?? {}) as { action?: string; name?: string; enabled?: boolean; command?: string }
      const servers = (await ctx.read()) ?? {}
      const names = Object.keys(servers)
      if (action === "list") {
        return JSON.stringify(
          names.map((n) => ({
            name: n,
            enabled: (servers[n] as Record<string, unknown> | undefined)?.enabled !== false,
            command: (servers[n] as Record<string, unknown> | undefined)?.command ?? "",
            url: (servers[n] as Record<string, unknown> | undefined)?.url ?? "",
          })),
          null,
          2,
        )
      }
      if (action === "get") {
        if (!name || !(name in servers)) return `未找到 MCP「${name ?? ""}」——可用: ${names.join(", ")}`
        return JSON.stringify(servers[name], null, 2)
      }
      if (action === "set") {
        if (!name || !(name in servers)) return `未找到 MCP「${name ?? ""}」——可用: ${names.join(", ")}`
        const current = { ...((servers[name] as Record<string, unknown>) ?? {}) }
        if (enabled !== undefined) current.enabled = enabled
        if (typeof command === "string" && command.trim()) current.command = command.trim()
        const next = { ...servers, [name]: current }
        await ctx.write(next)
        return `已更新 MCP「${name}」: ${JSON.stringify(current)}\n注意：需要重启服务（或让用户稍后重启）新会话才会加载该工具的 MCP 工具。`
      }
      return `未知 action「${String(action)}」——支持 list / get / set`
    },
  }
}
