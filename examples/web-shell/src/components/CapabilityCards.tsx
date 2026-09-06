import type { ReactElement } from "react"
import { Code2, GitPullRequest, Globe, Workflow } from "lucide-react"

export interface CapabilityItem {
  id: string
  title: string
  desc: string
  prompt: string
  icon: ReactElement
  tag: string
}

export const CAPABILITY_ITEMS: CapabilityItem[] = [
  {
    id: "arch",
    title: "代码工程架构分析",
    desc: "读取当前仓库结构，深度梳理各模块职责与调用关系",
    prompt: "请读取当前仓库的工程结构，梳理并详细总结核心模块的架构设计与实现分工。",
    icon: <Code2 size={15} className="text-ok" />,
    tag: "代码工程",
  },
  {
    id: "research",
    title: "前沿技术调研与检索",
    desc: "使用网络检索探索业界最新的 LLM Agent 与调度技术",
    prompt: "请使用 web_search 检索 2025-2026 年最新前沿的 Agent 调度与上下文管理趋势，并提炼核心要点。",
    icon: <Globe size={15} className="text-interactive" />,
    tag: "网络检索",
  },
  {
    id: "diagram",
    title: "绘制多代理协作拓扑",
    desc: "用规范的 Mermaid 语法实时渲染可视化的多代理交互图",
    prompt: "请用规范的 Mermaid flowchart TD 语法绘制一个多代理（主调度 + 代码专家 + 审查官）的协作拓扑图并渲染。",
    icon: <Workflow size={15} className="text-trajreasoning" />,
    tag: "图表渲染",
  },
  {
    id: "diff",
    title: "变更审查与提交规划",
    desc: "检查 Git 工作区未提交状态，提供重构建议与改动清单",
    prompt: "请使用 bash 运行 git status 并检查最近的改动，帮我规划一份规范的 Conventional Commits 提交摘要。",
    icon: <GitPullRequest size={15} className="text-warn" />,
    tag: "Git 工作流",
  },
]

/**
 * CapabilityCards — OpenCode / Linear style workspace capability tiles:
 * Replaces generic floating starter pills with high-craft structured cards.
 */
export function CapabilityCards({
  onSelect,
  className = "",
}: {
  onSelect: (prompt: string) => void
  className?: string
}): ReactElement {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl ${className}`}>
      {CAPABILITY_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.prompt)}
          className="group flex min-h-11 items-center gap-3 rounded-md border border-line bg-transparent px-3 py-2 text-left text-[13px] text-dim transition-colors hover:border-line-strong hover:bg-card-hover hover:text-fg"
        >
          {item.icon}
          <span className="min-w-0 break-words">{item.title}</span>
        </button>
      ))}
    </div>
  )
}
