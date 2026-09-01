/**
 * Skills — the agent skill directory (#10/插件 market equivalent): every
 * SkillInfo as a card with name, description and source path; clicking opens
 * the skill body. Data is hard-coded this pass; wiring day reads /v1/skills.
 */
import { useState } from "react"
import { ArrowLeft, FolderOpen, Sparkles, X } from "lucide-react"
import { api } from "../api/client"
import type { SkillInfo } from "../api/types"
import { EmptyState, Modal, PageHeader } from "../components/ui"

export function SkillsPage(): React.ReactElement {
  const skills = api.skills().skills
  const [open, setOpen] = useState<SkillInfo | null>(null)
  const body = open ? api.skillBody(open.name).body : ""

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="技能"
        backTo="/settings"
        sub="按需装载的能力包：模型在需要时通过 skill 工具加载正文，平时不占上下文。"
        actions={
          <span className="chip">
            <Sparkles size={11} /> {skills.length} 个已发现
          </span>
        }
      />
      {skills.length === 0 ? (
        <EmptyState className="!py-24" icon={<Sparkles size={18} />} title="没有发现技能" hint="在 agent-home 的 skills 目录或插件包里放置 SKILL.md。" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {skills.map((s) => (
              <button
                key={s.name}
                onClick={() => setOpen(s)}
                className="card group p-4 text-left transition-colors hover:border-linestrong hover:bg-cardhover"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-line bg-bg2 text-dim">
                    <Sparkles size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{s.name}</span>
                </div>
                <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-faint">{s.description ?? "（无描述）"}</p>
                <p className="mt-3 flex items-center gap-1 truncate border-t border-line pt-2 font-mono text-2xs text-ghost">
                  <FolderOpen size={10} className="flex-none" /> {s.path}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? "技能"} width={640}>
        <p className="mb-3 text-xs leading-relaxed text-faint">{open?.description}</p>
        <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-bg2 p-4 font-mono text-2xs leading-relaxed text-dim">{body}</pre>
        <div className="mt-3 flex items-center justify-between">
          <button className="btn" onClick={() => setOpen(null)}>
            <ArrowLeft size={13} /> 返回
          </button>
          <button className="btn btn-quiet text-faint" onClick={() => setOpen(null)}>
            <X size={13} /> 关闭
          </button>
        </div>
      </Modal>
    </div>
  )
}
