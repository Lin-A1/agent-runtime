/**
 * Orchestration (DAG) — the differentiation page (no ZCode counterpart). The
 * declarative schedule and the model's dynamic spawns share one driven-child
 * foundation; here we present declared graphs: a list of DAGs and a node board
 * with the six states, per-node model (cost-down visibility, §1.5④), a jump
 * into each node's child session, and a spec JSON submission box.
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  GitBranch,
  Loader2,
  Play,
  SkipForward,
  TerminalSquare,
  XCircle,
  FileCode2,
} from "lucide-react"
import { api } from "../api/client"
import type { DagNodeState, DagStatus } from "../api/types"
import { relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { AsyncRegion, EmptyState, Modal, PageHeader } from "../components/ui"

const NODE_STATE: Record<DagNodeState, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "待就绪", color: "var(--txt-ghost)", icon: <Circle size={13} /> },
  running: { label: "运行中", color: "var(--warn)", icon: <Loader2 size={13} className="spin" /> },
  succeeded: { label: "已成功", color: "var(--ok)", icon: <CheckCircle2 size={13} /> },
  failed: { label: "失败", color: "var(--bad)", icon: <XCircle size={13} /> },
  skipped: { label: "已跳过", color: "var(--txt-faint)", icon: <SkipForward size={13} /> },
  aborted: { label: "已中止", color: "var(--txt-ghost)", icon: <CircleDashed size={13} /> },
}

export function DagsPage(): React.ReactElement {
  const navigate = useNavigate()
  const dags = useApi<DagStatus[]>(() => api.dags(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [specOpen, setSpecOpen] = useState(false)
  const selected = dags.data?.find((d) => d.dagId === selectedId) ?? dags.data?.[0] ?? null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="编排（DAG）" backTo="/settings"
        sub="提前声明的前驱后继图：运行时拓扑排序 + 就绪队列 + 事件唤醒，无 join 阻塞；每个节点是一次被真驱动的子代理派单。"
        actions={
          <button className="btn btn-primary" onClick={() => setSpecOpen(true)}>
            <Play size={13} /> 提交 DAG spec
          </button>
        }
      />
      <AsyncRegion
        state={dags}
        emptyIf={(l) => l.length === 0}
        empty={<EmptyState className="!py-24" icon={<GitBranch size={18} />} title="还没有声明式编排" hint="提交一个 DAG spec（nodes + dependsOn），或让模型在回合中用 declare_dag 自行声明。" />}
      >
        {(list) => (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[320px_1fr] lg:overflow-hidden">
            {/* list */}
            <div className="overflow-y-auto border-b border-line p-3 lg:border-b-0 lg:border-r">
              {list.map((d) => {
                const done = d.nodes.filter((n) => n.state === "succeeded").length
                const active = d.nodes.some((n) => n.state === "running")
                const isSel = selected?.dagId === d.dagId
                return (
                  <button
                    key={d.dagId}
                    onClick={() => setSelectedId(d.dagId)}
                    className="mb-2 w-full rounded-lg border p-3 text-left transition-colors"
                    style={{
                      borderColor: isSel ? "var(--line-strong)" : "var(--line)",
                      background: isSel ? "var(--hover)" : "var(--card)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`dot flex-none ${active ? "dot-active" : d.done ? "dot-settled" : "dot-error"}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{d.dagId}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-faint">
                      <span>{done}/{d.nodes.length} 节点完成</span>
                      <span className="hidden sm:inline">·</span>
                      <span>{d.done ? "已完成" : "运行中"}</span>
                      {d.startedAt && (
                        <>
                          <span className="hidden sm:inline">·</span>
                          <span className="hidden sm:inline">{relativeTime(d.startedAt)}</span>
                        </>
                      )}
                    </div>
                    <StateBar nodes={d.nodes} />
                  </button>
                )
              })}
            </div>

            {/* board */}
            <div className="min-h-0 overflow-y-auto p-6">
              {selected && <DagBoard dag={selected} onOpenNode={() => navigate("/session/sess-nh-child-run")} />}
            </div>
          </div>
        )}
      </AsyncRegion>

      <Modal open={specOpen} onClose={() => setSpecOpen(false)} title="提交 DAG spec" width={620}>
        <p className="mb-2 text-2xs text-faint">nodes 为 id → {`{ agent{name,model?}, input, dependsOn? }`}；运行时拓扑排序，便宜模型扇出、贵模型收敛。</p>
        <textarea
          className="input min-h-[260px] resize-y font-mono text-2xs leading-relaxed"
          spellCheck={false}
          defaultValue={JSON.stringify(
            {
              nodes: {
                audit: { id: "audit", agent: { name: "code-reviewer", model: "glm-4.6-flash" }, input: "审查 packages/runtime 改动" },
                fix: { id: "fix", agent: { name: "test-writer", model: "glm-4.6-flash" }, input: "修复审查发现", dependsOn: ["audit"] },
                report: { id: "report", agent: { name: "newhorse", model: "claude-sonnet-4-5" }, input: "汇总结果", dependsOn: ["fix"] },
              },
            },
            null,
            2,
          )}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setSpecOpen(false)}>取消</button>
          <button className="btn btn-primary" onClick={() => setSpecOpen(false)}>
            <Play size={12} /> 运行
          </button>
        </div>
      </Modal>
    </div>
  )
}

function StateBar({ nodes }: { nodes: DagStatus["nodes"] }): React.ReactElement {
  return (
    <div className="mt-2 flex gap-0.5">
      {nodes.map((n) => (
        <span key={n.node} className="h-1 flex-1 rounded-full" style={{ background: NODE_STATE[n.state].color }} title={`${n.node} · ${NODE_STATE[n.state].label}`} />
      ))}
    </div>
  )
}

function DagBoard({ dag, onOpenNode }: { dag: DagStatus; onOpenNode: () => void }): React.ReactElement {
  // Lay nodes into flowing lanes by their order in the fold (the durable event
  // order mirrors declaration order); a connector between cards reads as the
  // readiness hand-off. True edges live in the submitted spec.
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-fg">{dag.dagId}</span>
        <span className="chip !py-0 !text-[10px]">{dag.done ? "已完成" : "运行中"}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {(Object.keys(NODE_STATE) as DagNodeState[]).map((st) => (
            <span key={st} className="flex items-center gap-1 text-2xs text-faint">
              <span style={{ color: NODE_STATE[st].color }}>{NODE_STATE[st].icon}</span>
              {NODE_STATE[st].label}
            </span>
          ))}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dag.nodes.map((n, i) => {
          const st = NODE_STATE[n.state]
          return (
            <div key={n.node} className="card relative p-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex-none" style={{ color: st.color }}>
                  {st.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-fg">{n.node}</span>
                    <span className="chip !py-0 !text-[10px]" style={{ color: st.color, borderColor: `${st.color}55` }}>
                      {st.label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-faint">
                    <TerminalSquare size={11} />
                    <span className="truncate font-mono">{n.model ?? "继承父模型"}</span>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    <button className="btn !py-1 text-2xs" onClick={onOpenNode}>
                      子会话转录 <ChevronRight size={11} />
                    </button>
                  </div>
                </div>
              </div>
              {i < dag.nodes.length - 1 && <FileCode2 size={0} className="hidden" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
