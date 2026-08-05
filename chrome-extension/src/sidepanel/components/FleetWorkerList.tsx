// Shared worker list + portal shell (SoT W1 — outside FocusBand overflow).

import { useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { useAgentStore } from "../store/agentStore"
import type { FleetWorkerView } from "../types"
import { tokens } from "../ui/tokens"
import {
  resolveFleetScope,
  workersInFleetScope,
} from "../utils/thread-busy"

function statusLabel(status: string | undefined, llmActive?: boolean, mapBusy?: boolean): string {
  if (status === "holding_tabs") return "持锁中"
  if (status === "paused") return "已暂停"
  if (llmActive || mapBusy) return "处理中"
  if (status === "idle") return "空闲"
  return status || "—"
}

function statusColor(status: string | undefined, busy?: boolean): string {
  if (status === "holding_tabs") return "#f59e0b"
  if (status === "paused") return "#60a5fa"
  if (busy) return "#f59e0b"
  if (status === "idle") return "#34d399"
  return tokens.textMuted || "#9ca3af"
}

export function FleetWorkerList({
  onClose,
}: {
  onClose?: () => void
}) {
  const { state, dispatch } = useAgentStore()
  const fleet = state.fleet
  const allWorkers = fleet?.workers || []
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)

  const { scope, workers, scopedLocks } = useMemo(() => {
    const scope = resolveFleetScope(
      activeThread
        ? {
            id: activeThread.id,
            agent_role: activeThread.agent_role,
            parent_thread_id: activeThread.parent_thread_id,
            orchestrator_run_id: activeThread.orchestrator_run_id,
          }
        : activeId
          ? { id: activeId }
          : null,
      allWorkers,
    )
    const workers = workersInFleetScope(allWorkers, scope) as FleetWorkerView[]
    const allowed = new Set(workers.map((w) => w.id))
    if (activeId) allowed.add(activeId)
    const scopedLocks = (fleet?.locks || []).filter((l) =>
      allowed.has(l.holder_thread_id),
    )
    return { scope, workers, scopedLocks }
  }, [activeThread, activeId, allWorkers, fleet?.locks])

  const enterWorker = (w: FleetWorkerView) => {
    dispatch({ type: "SET_ACTIVE_THREAD", threadId: w.id })
    chrome.runtime.sendMessage({ type: "thread.select", threadId: w.id })
    dispatch({ type: "SET_FLEET_LIST_OPEN", open: false })
    onClose?.()
  }

  const stopAll = () => {
    if (
      !window.confirm(
        "停止全部子任务？将中止全部 worker LLM、拒绝待确认，并释放相关 tab 锁。",
      )
    ) {
      return
    }
    chrome.runtime.sendMessage({ type: "fleet.stop_all" })
  }

  const emptyHint =
    scope.kind === "none"
      ? "当前会话没有子任务。其它会话残留的 worker 不会显示在此。"
      : "暂无 worker。spawn_worker 批准后会出现在此。"

  return (
    <div style={styles.panel} data-fleet-worker-list>
      <div style={styles.panelHead}>
        <span>子任务 / Workers</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={styles.link}
            onClick={() => chrome.runtime.sendMessage({ type: "fleet.status" })}
          >
            刷新
          </button>
          <button type="button" style={styles.link} onClick={() => onClose?.()}>
            关闭
          </button>
        </div>
      </div>
      {workers.length === 0 && <div style={styles.empty}>{emptyHint}</div>}
      <ul style={styles.list}>
        {workers.map((w) => {
          const busy = !!state.threadBusyById[w.id] || !!w.llm_active
          return (
            <li key={w.id} style={styles.item}>
              <div style={styles.row}>
                <span style={{ fontWeight: 600, fontSize: 11 }}>
                  {w.agent_role === "orchestrator" ? "🎯 " : "⚙️ "}
                  {w.alias || w.id.slice(0, 8)}
                  {w.worker_role_label ? ` · ${w.worker_role_label}` : ""}
                </span>
                <span style={{ fontSize: 10, color: statusColor(w.status, busy) }}>
                  {statusLabel(w.status, w.llm_active, state.threadBusyById[w.id])}
                </span>
              </div>
              <div style={styles.sub}>
                {w.id.slice(0, 12)}…
                {w.tab_locks?.length
                  ? ` · tabs: ${w.tab_locks.map((t) => t.tab_id).join(",")}`
                  : ""}
              </div>
              <div style={styles.actions}>
                <button type="button" style={styles.smallBtn} onClick={() => enterWorker(w)}>
                  进入子任务
                </button>
                {w.agent_role === "worker" &&
                  (w.paused ? (
                    <button
                      type="button"
                      style={styles.smallBtn}
                      onClick={() =>
                        chrome.runtime.sendMessage({ type: "worker.resume", worker_id: w.id })
                      }
                    >
                      恢复
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={styles.smallBtn}
                      onClick={() =>
                        chrome.runtime.sendMessage({ type: "worker.pause", worker_id: w.id })
                      }
                    >
                      暂停
                    </button>
                  ))}
                <button
                  type="button"
                  style={{ ...styles.smallBtn, color: "#b91c1c" }}
                  onClick={() => {
                    chrome.runtime.sendMessage({
                      type: "chat.abort",
                      threadId: w.id,
                      thread_id: w.id,
                    })
                    chrome.runtime.sendMessage({ type: "fleet.status" })
                  }}
                >
                  停止该子任务
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {scopedLocks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={styles.panelHead}>
            <span>Tab 锁（高级）</span>
          </div>
          <ul style={styles.list}>
            {scopedLocks.map((l) => (
              <li key={l.tab_id} style={styles.item}>
                <div style={styles.row}>
                  <code style={{ fontSize: 10 }}>tab {l.tab_id}</code>
                  <span style={{ fontSize: 10 }}>{l.state}</span>
                </div>
                <div style={styles.sub}>holder {l.holder_thread_id?.slice(0, 10)}…</div>
                <button
                  type="button"
                  style={{ ...styles.smallBtn, marginTop: 4 }}
                  title="强制释放锁（其它 agent 可占用该 tab）"
                  onClick={() =>
                    chrome.runtime.sendMessage({
                      type: "tab.force_release",
                      tab_id: l.tab_id,
                      by: "user",
                    })
                  }
                >
                  强制释放锁
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={styles.footer}>
        <button
          type="button"
          style={styles.dangerBtn}
          onClick={stopAll}
          disabled={workers.filter((w) => w.agent_role === "worker").length === 0}
          title={
            scope.kind === "none"
              ? "当前会话无子任务；全停会作用到进程内全部 worker（确认台清理残留时使用）"
              : "Stop all workers"
          }
        >
          全停
        </button>
        <button
          type="button"
          style={styles.link}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
        >
          确认台
        </button>
      </div>
    </div>
  )
}

/** Portal overlay when state.fleetListOpen — not nested under FocusBand overflow. */
export function FleetWorkerListPortal() {
  const { state, dispatch } = useAgentStore()
  const open = state.fleetListOpen
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "SET_FLEET_LIST_OPEN", open: false })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, dispatch])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={rootRef}
      style={styles.overlay}
      role="dialog"
      aria-label="子任务列表"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          dispatch({ type: "SET_FLEET_LIST_OPEN", open: false })
        }
      }}
    >
      <div style={styles.portalCard}>
        <FleetWorkerList
          onClose={() => dispatch({ type: "SET_FLEET_LIST_OPEN", open: false })}
        />
      </div>
    </div>,
    document.body,
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 10050,
    background: "rgba(0,0,0,0.25)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: 72,
  },
  portalCard: {
    width: "min(320px, 94vw)",
    maxHeight: "70vh",
    overflow: "auto",
    borderRadius: 10,
    boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
    background: tokens.bgElevated || "#fff",
  },
  panel: {
    padding: "8px 10px 10px",
    fontFamily: tokens.font,
  },
  panelHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 10,
    color: tokens.textMuted,
    margin: "4px 0 6px",
  },
  empty: { fontSize: 10, color: tokens.textMuted, padding: "6px 0" },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  item: {
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    borderRadius: 6,
    padding: 6,
    background: "#fff",
  },
  row: { display: "flex", justifyContent: "space-between", gap: 6 },
  sub: { fontSize: 9, color: tokens.textMuted, marginTop: 2 },
  actions: { display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" },
  smallBtn: {
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 4,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    background: "#f9fafb",
    cursor: "pointer",
    color: tokens.text,
  },
  link: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 10,
    padding: "2px 4px",
  },
  footer: {
    display: "flex",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
  },
  dangerBtn: {
    fontSize: 10,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
    cursor: "pointer",
  },
}
