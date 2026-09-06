import type { WorkbenchProvider, WorkbenchResource } from "./types"

const RESERVED: WorkbenchResource[] = [
  { id: "browser", label: "浏览器", shortLabel: "浏览", description: "由宿主插件提供的可控浏览器资源", source: "plugin", state: "unavailable", icon: "browser", reserved: true },
  { id: "git", label: "Git review", shortLabel: "Git", description: "由宿主插件提供的仓库状态与审阅资源", source: "plugin", state: "unavailable", icon: "git", reserved: true },
  { id: "pty-terminal", label: "交互终端", shortLabel: "PTY", description: "由宿主插件提供的可恢复交互式终端", source: "plugin", state: "unavailable", icon: "terminal", reserved: true },
  { id: "review", label: "审阅", shortLabel: "审阅", description: "由宿主插件提供的评论与交接资源", source: "plugin", state: "unavailable", icon: "review", reserved: true },
]

export function createBuiltinProviders(): WorkbenchProvider[] {
  return [
    { resource: { id: "agents", label: "子智能体", shortLabel: "子智能体", description: "当前会话的子智能体与只读执行记录", source: "builtin", state: "ready", icon: "activity" }, actions: ["open", "refresh"] },
    { resource: { id: "terminal", label: "终端", shortLabel: "终端", description: "通过当前 session policy 执行一次性命令", source: "builtin", state: "ready", icon: "terminal" }, actions: ["run", "cancel", "copy"] },
    { resource: { id: "files", label: "文件", shortLabel: "文件", description: "浏览工作区并查看只读文件预览", source: "builtin", state: "ready", icon: "file" }, actions: ["open", "copy-path", "quote"] },
    { resource: { id: "activity", label: "文件活动", shortLabel: "活动", description: "会话日志中的 Agent 文件活动，不代表 Git 真值", source: "builtin", state: "ready", icon: "activity" }, actions: ["open-file", "open-turn"] },
    { resource: { id: "preview", label: "产物", shortLabel: "产物", description: "工具生成的 diff、Markdown、表格、图片和链接", source: "builtin", state: "ready", icon: "preview" }, actions: ["copy", "open-external", "quote"] },
    { resource: { id: "context", label: "上下文", shortLabel: "上下文", description: "当前 session 的上下文、目标、计划和策略", source: "builtin", state: "ready", icon: "context" }, actions: ["refresh", "compact"] },
  ]
}

export function reservedProviders(): WorkbenchProvider[] {
  return RESERVED.map((resource) => ({ resource }))
}

export function mergeProviders(extra: readonly WorkbenchProvider[] = []): WorkbenchProvider[] {
  const byId = new Map<string, WorkbenchProvider>()
  for (const provider of [...createBuiltinProviders(), ...extra]) byId.set(provider.resource.id, provider)
  return [...byId.values()]
}
