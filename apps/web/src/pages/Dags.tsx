/**
 * Orchestration (DAG) — the differentiation page (no ZCode counterpart). The
 * declarative schedule and the model's dynamic spawns share one driven-child
 * foundation; here we present declared graphs: a list of DAGs (auto-selects
 * the running one) and a node board with the six states, per-node model
 * (cost-down visibility, §1.5④), click-to-expand node detail (refetches
 * /v1/dag/:id on expand), copyable dagId, and a spec JSON submission box.
 */
import { useEffect, useState } from "react"
import {
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  Copy,
  GitBranch,
  Loader2,
  Play,
  SkipForward,
  Square,
  TerminalSquare,
  XCircle,
} from "lucide-react"
import { api } from "../api/client"
import type { DagNodeState, DagNodeStatus, DagSpec, DagStatus } from "../api/types"
import { relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { AsyncRegion, Chevron, EmptyState, Modal, PageHeader } from "../components/ui"

const NODE_STATE: Record<DagNodeState, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "待就绪", color: "var(--txt-ghost)", icon: <Circle size={13} /> },
  running: { label: "运行中", color: "var(--warn)", icon: <Loader2 size={13} className="spin" /> },
  succeeded: { label: "已成功", color: "var(--ok)", icon: <CheckCircle2 size={13} /> },
  failed: { label: "失败", color: "var(--bad)", icon: <XCircle size={13} /> },
  skipped: { label: "已跳过", color: "var(--txt-faint)", icon: <SkipForward size={13} /> },
  aborted: { label: "已中止", color: "var(--txt-ghost)", icon: <CircleDashed size={13} /> },
}

export function DagsPage(): React.ReactElement {
  const dags = useApi<DagStatus[]>(() => api.dags(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [specOpen, setSpecOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // 默认选中：显式选择优先，否则自动跟随正在运行的 DAG，再次是第一个。
  const selected = dags.data?.find((d) => d.dagId === selectedId) ?? dags.data?.find((d) => !d.done) ?? dags.data?.[0] ?? null
  const anyRunning = (dags.data ?? []).some((d) => !d.done)
  // Live progress without a bus feed for DAG state: poll while anything runs.
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => dags.retry(), 2_000)
    return () => clearInterval(t)
  }, [anyRunning])
  const [specText, setSpecText] = useState(JSON.stringify(
    {
      nodes: {
        audit: { id: "audit", agent: { name: "code-reviewer", model: "glm-4.6-flash" }, input: "审查 packages/runtime 改动" },
        fix: { id: "fix", agent: { name: "test-writer", model: "glm-4.6-flash" }, input: "修复审查发现", dependsOn: ["audit"] },
        report: { id: "report", agent: { name: "newhorse", model: "claude-sonnet-4-5" }, input: "汇总结果", dependsOn: ["fix"] },
      },
    },
    null,
    2,
  ))
  const [specErr, setSpecErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const copyId = (id: string): void => {
    void navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopiedId(id)
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1_500)
      })
      .catch(() => {})
  }

  const submitSpec = (): void => {
    let spec: DagSpec
    try {
      spec = JSON.parse(specText) as DagSpec
    } catch (e) {
      setSpecErr("JSON 解析失败：" + (e instanceof Error ? e.message : String(e)))
      return
    }
    if (!spec?.nodes || Object.keys(spec.nodes).length === 0) {
      setSpecErr("spec.nodes 必须至少包含一个节点")
      return
    }
    setSubmitting(true)
    setSpecErr(null)
    void api.createDag(spec)
      .then((r) => {
        setSpecOpen(false)
        setSelectedId(r.dagId)
        dags.retry()
      })
      .catch((e) => setSpecErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setSubmitting(false))
  }

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
        empty={
          <EmptyState
            className="!py-24"
            icon={<GitBranch size={18} />}
            title="还没有声明式编排"
            hint="点击右上角提交一个 DAG spec（nodes + dependsOn），或让模型在回合中用 declare_dag 自行声明；声明后这里会实时展示每个节点的六种状态。"
          />
        }
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
                  <div
                    key={d.dagId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(d.dagId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedId(d.dagId)
                    }}
                    className="mb-2 w-full cursor-pointer rounded-lg border p-3 text-left transition-colors"
                    style={{
                      borderColor: isSel ? "var(--line-strong)" : "var(--line)",
                      background: isSel ? "var(--hover)" : "var(--card)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`dot flex-none ${active ? "dot-active" : d.done ? "dot-settled" : "dot-error"}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{d.dagId}</span>
                      <button
                        className="icon-btn !h-6 !w-6 flex-none"
                        title="复制 dagId"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyId(d.dagId)
                        }}
                      >
                        {copiedId === d.dagId ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                      </button>
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
                  </div>
                )
              })}
            </div>

            {/* board */}
            <div className="min-h-0 overflow-y-auto p-6">
              {selected && <DagBoard dag={selected} onChanged={() => dags.retry()} />}
            </div>
          </div>
        )}
      </AsyncRegion>

      <Modal open={specOpen} onClose={() => setSpecOpen(false)} title="提交 DAG spec" width={620}>
        <p className="mb-2 text-2xs text-faint">nodes 为 id → {`{ agent{name,model?}, input, dependsOn? }`}；运行时拓扑排序，便宜模型扇出、贵模型收敛。</p>
        <textarea
          className="input min-h-[260px] resize-y font-mono text-2xs leading-relaxed"
          spellCheck={false}
          value={specText}
          onChange={(e) => setSpecText(e.target.value)}
        />
        {specErr && <p className="mt-2 text-2xs text-bad">{specErr}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setSpecOpen(false)}>取消</button>
          <button className="btn btn-primary" onClick={submitSpec} disabled={submitting}>
            <Play size={12} /> {submitting ? "提交中…" : "运行"}
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

/**
 * Group nodes into topo-depth lanes (Kahn over the declared edges): depth 0 =
 * no dependsOn, else 1 + max(dep depths). Guards: an unknown dep is dropped
 * (depth 0 contribution); a cycle never drains in Kahn, so cycle members stay
 * at depth 0 instead of looping forever. Each lane entry keeps the node's
 * original board index for the #n marker.
 */
function laneNodes(nodes: DagNodeStatus[]): Array<Array<{ n: DagNodeStatus; i: number }>> {
  const known = new Set(nodes.map((n) => n.node))
  const deps = new Map(nodes.map((n) => [n.node, (n.dependsOn ?? []).filter((d) => d !== n.node && known.has(d))]))
  const dependents = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const [id, ds] of deps) {
    inDegree.set(id, ds.length)
    for (const d of ds) dependents.set(d, [...(dependents.get(d) ?? []), id])
  }
  const depth = new Map<string, number>()
  const queue = nodes.map((n) => n.node).filter((id) => (inDegree.get(id) ?? 0) === 0)
  for (const id of queue) depth.set(id, 0)
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const next of dependents.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1))
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }
  const lanes: Array<Array<{ n: DagNodeStatus; i: number }>> = []
  nodes.forEach((n, i) => {
    const d = depth.get(n.node) ?? 0
    while (lanes.length <= d) lanes.push([])
    lanes[d]!.push({ n, i })
  })
  return lanes
}

function DagBoard({ dag, onChanged }: { dag: DagStatus; onChanged: () => void }): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null)
  // 展开时拉一次 /v1/dag/:id 拿最新节点状态（节点详情 API 只有这些字段）。
  const [fresh, setFresh] = useState<DagStatus | null>(null)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [aborting, setAborting] = useState(false)
  useEffect(() => {
    setExpanded(null)
    setFresh(null)
    setConfirmAbort(false)
  }, [dag.dagId])
  useEffect(() => {
    if (!expanded) return
    let alive = true
    void api
      .dag(dag.dagId)
      .then((d) => {
        if (alive) setFresh(d)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [expanded, dag.dagId])

  const nodeOf = (n: DagNodeStatus): DagNodeStatus => fresh?.nodes.find((x) => x.node === n.node) ?? n

  const abort = (): void => {
    setAborting(true)
    void api
      .abortDag(dag.dagId)
      .then(() => {
        setConfirmAbort(false)
        onChanged()
      })
      .catch(() => {})
      .finally(() => setAborting(false))
  }

  const lanes = laneNodes(dag.nodes)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-fg">{dag.dagId}</span>
        <span className="chip !py-0 !text-[10px]">{dag.done ? "已完成" : "运行中"}</span>
        {!dag.done &&
          (confirmAbort ? (
            <>
              <button className="btn btn-danger !py-1 text-2xs" disabled={aborting} onClick={abort}>
                <Square size={11} /> {aborting ? "中止中…" : "确认中止"}
              </button>
              <button className="btn !py-1 text-2xs" onClick={() => setConfirmAbort(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="btn !py-1 text-2xs" title="中止整张图：pending→skipped，running→aborted（持久化 DAG.Aborted）" onClick={() => setConfirmAbort(true)}>
              <Square size={11} /> 中止
            </button>
          ))}
        <span className="ml-auto flex flex-wrap gap-2">
          {(Object.keys(NODE_STATE) as DagNodeState[]).map((st) => (
            <span key={st} className="flex items-center gap-1 text-2xs text-faint">
              <span style={{ color: NODE_STATE[st].color }}>{NODE_STATE[st].icon}</span>
              {NODE_STATE[st].label}
            </span>
          ))}
        </span>
      </div>

      {lanes.map((lane, li) => (
        <div key={li} className={li > 0 ? "mt-6" : undefined}>
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-2xs font-medium text-dim">第 {li + 1} 层</span>
            <span className="text-2xs text-ghost">{lane.length} 个节点</span>
            <span className="h-px flex-1" style={{ background: "var(--line)" }} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lane.map(({ n: raw, i }) => {
              const n = nodeOf(raw)
              const st = NODE_STATE[n.state]
              const open = expanded === n.node
              return (
                <div
                  key={n.node}
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded(open ? null : n.node)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setExpanded(open ? null : n.node)
                  }}
                  className="card relative cursor-pointer p-4 transition-colors hover:border-linestrong"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex-none" style={{ color: st.color }}>
                      {st.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-2xs text-ghost">#{i + 1}</span>
                        <span className="font-mono text-xs font-medium text-fg">{n.node}</span>
                        <span className="chip !py-0 !text-[10px]" style={{ color: st.color, borderColor: `${st.color}55` }}>
                          {st.label}
                        </span>
                        <span className="ml-auto flex-none">
                          <Chevron open={open} />
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-faint">
                        <TerminalSquare size={11} />
                        <span className="truncate font-mono">{n.model ?? "继承父模型"}</span>
                      </div>
                      {open && (
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-2.5 text-2xs">
                          <span className="text-faint">序号</span>
                          <span className="text-right font-mono text-dim">#{i + 1} / {dag.nodes.length}</span>
                          <span className="text-faint">状态</span>
                          <span className="text-right font-mono" style={{ color: st.color }}>{st.label}</span>
                          <span className="text-faint">模型</span>
                          <span className="truncate text-right font-mono text-dim">{n.model ?? "继承父模型"}</span>
                          <span className="text-faint">依赖</span>
                          <span className="truncate text-right font-mono text-dim">{n.dependsOn?.length ? n.dependsOn.join(", ") : "无（根节点）"}</span>
                          <span className="text-faint">DAG</span>
                          <span className="truncate text-right font-mono text-ghost">{dag.dagId}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
