// ADR-015 P1 — Side Panel FleetStrip (~320px): counts, worst status, stop-all, expand fleet panel
// UIUX v2 §4.3: pending confirms do NOT force visibility (owned by FocusBand MinimalConfirm).

import { useEffect, useMemo, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import type { FleetWorkerView } from "../types"
import { fleetStripShouldShow } from "./focus-band-priority"
import { buildFleetStopAllMessage, buildScopedRunBusyInput } from "../utils/thread-busy"

function worstColor(status: string | undefined): string {
  if (status === "holding_tabs") return "#f59e0b"
  if (status === "paused") return "#60a5fa"
  if (status === "idle") return "#34d399"
  return tokens.textMuted
}

function worstLabel(status: string | undefined): string {
  if (status === "holding_tabs") return "持锁中"
  if (status === "paused") return "已暂停"
  if (status === "idle") return "空闲"
  return "无舰队"
}

export function FleetStrip({
  focusBand = false,
}: {
  /** When true: 1-line summary only; expand → Cockpit (FocusBand ≤80px hard cap). */
  focusBand?: boolean
} = {}) {
  const { state, dispatch } = useAgentStore()
  const [expanded, setExpanded] = useState(false)
  const fleet = state.fleet
  const pending = state.pendingSecurityConfirmations.length
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)

  const scoped = useMemo(() => {
    const built = buildScopedRunBusyInput({
      active: activeThread
        ? {
            id: activeThread.id,
            agent_role: activeThread.agent_role,
            parent_thread_id: activeThread.parent_thread_id,
            orchestrator_run_id: activeThread.orchestrator_run_id,
          }
        : activeId
          ? { id: activeId }
          : null,
      workers: fleet?.workers || [],
      locks: fleet?.locks,
      openIntentCount: fleet?.open_intent_count,
      openIntentsByRun: fleet?.open_intents_by_run,
      llmActiveThreadIds: fleet?.llm_active_thread_ids,
    })
    const worst = built.scopedWorkers.some((w) => w.status === "holding_tabs")
      ? "holding_tabs"
      : built.scopedWorkers.some((w) => w.status === "paused")
        ? "paused"
        : built.scopedWorkers.length > 0
          ? "idle"
          : "none"
    return {
      workerCount: built.workerCount,
      lockCount: built.runBusyInput.lockCount,
      openIntents: built.runBusyInput.openIntents,
      worst,
      workers: built.scopedWorkers as FleetWorkerView[],
      scope: built.scope,
      scopeKind: built.scope.kind,
      stopAll: buildFleetStopAllMessage(built.scope),
    }
  }, [activeThread, activeId, fleet])

  const { workerCount, lockCount, openIntents, worst } = scoped

  // Must stay above early-return (hooks order). Scope locks to visible workers.
  const scopedLocks = useMemo(() => {
    const workers = scoped.workers || []
    const allowed = new Set(workers.map((w) => w.id))
    if (activeId) allowed.add(activeId)
    return (fleet?.locks || []).filter((l) => allowed.has(l.holder_thread_id))
  }, [scoped.workers, activeId, fleet?.locks])

  useEffect(() => {
    const tick = () => chrome.runtime.sendMessage({ type: "fleet.status" })
    tick()
    const id = setInterval(tick, 4000)
    return () => clearInterval(id)
  }, [])

  // §4.3 rule 2: pending confirms do NOT force Fleet chrome (MinimalConfirm owns them).
  // Show only multi-agent activity / locks / board intents / user-expanded (standalone).
  // Scoped to active thread — foreign residual workers must not light strip.
  const visible = fleetStripShouldShow({
    workerCount,
    lockCount,
    openIntents,
    worstStatus: worst,
    // Standalone expanded strip can still list paused zombies for 全停.
    // FocusBand never expands in-band — paused-only stays hidden there.
    expanded: focusBand ? false : expanded,
    showPausedOnly: !focusBand && expanded,
  })
  if (!visible) {
    return null
  }

  const stopAll = () => {
    const built = scoped.stopAll
    if (!window.confirm(built.confirmText)) {
      return
    }
    const payload: {
      type: "fleet.stop_all"
      orchestrator_run_id?: string
      parent_thread_id?: string
    } = { type: "fleet.stop_all" }
    if (built.orchestrator_run_id) {
      payload.orchestrator_run_id = built.orchestrator_run_id
    }
    if (built.parent_thread_id) {
      payload.parent_thread_id = built.parent_thread_id
    }
    chrome.runtime.sendMessage(payload)
  }

  const enterWorker = (w: FleetWorkerView) => {
    dispatch({ type: "SET_ACTIVE_THREAD", threadId: w.id })
    chrome.runtime.sendMessage({ type: "thread.select", threadId: w.id })
    setExpanded(false)
    dispatch({ type: "SET_FLEET_LIST_OPEN", open: false })
  }

  const onMainClick = () => {
    if (focusBand) {
      // SoT Q2: primary → worker list portal (not nested under FocusBand overflow).
      dispatch({ type: "SET_FLEET_LIST_OPEN", open: true })
      return
    }
    setExpanded((e) => !e)
  }

  return (
    <div style={focusBand ? styles.wrapFocus : styles.wrap}>
      <div style={focusBand ? styles.stripFocus : styles.strip}>
        <button type="button" style={styles.mainBtn} onClick={onMainClick}>
          <span style={{ ...styles.dot, background: worstColor(worst) }} />
          <strong style={{ fontSize: 11 }}>舰队</strong>
          <span style={styles.meta}>
            {workerCount} worker · {lockCount} 锁
            {openIntents > 0 ? ` · ${openIntents} intent` : ""} · {worstLabel(worst)}
            {worst === "paused" && lockCount === 0 && openIntents === 0
              ? "（可点全停清理）"
              : ""}
          </span>
          {openIntents > 0 && (
            <span style={{ ...styles.badge, background: "#ca8a04" }} title="未关闭 Intent">
              {openIntents}
            </span>
          )}
          {/* Pending badge is informational only — does not gate strip visibility. */}
          {!focusBand && pending > 0 && (
            <span style={styles.badge} title="待确认操作">
              {pending}
            </span>
          )}
        </button>
        <button
          type="button"
          style={styles.dangerBtn}
          onClick={stopAll}
          disabled={workerCount === 0}
          title={workerCount === 0 ? "当前作用域无 worker 可停" : scoped.stopAll.stopTitle}
        >
          全停
        </button>
        <button
          type="button"
          style={styles.link}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
          title="打开确认台：高危操作审批 + Computer Use（空窗表示当前无待确认）"
        >
          确认台
        </button>
      </div>

      {!focusBand && expanded && (
        <div style={styles.panel}>
          <div style={styles.panelHead}>
            <span>Workers & Tab 锁</span>
            <button type="button" style={styles.link} onClick={() => chrome.runtime.sendMessage({ type: "fleet.status" })}>
              刷新
            </button>
          </div>
          {scoped.workers.length === 0 && (
            <div style={styles.empty}>
              {scoped.scopeKind === "none"
                ? "当前会话没有子任务。其它会话残留的 worker 不会显示在此。"
                : "暂无 orchestrator/worker。spawn_worker 后会出现在此。"}
            </div>
          )}
          <ul style={styles.list}>
            {scoped.workers.map((w) => (
              <li key={w.id} style={styles.item}>
                <div style={styles.row}>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>
                    {w.agent_role === "orchestrator" ? "🎯 " : "⚙️ "}
                    {w.alias || w.id.slice(0, 8)}
                    {w.worker_role_label ? ` · ${w.worker_role_label}` : ""}
                  </span>
                  <span style={{ fontSize: 10, color: worstColor(w.status) }}>{worstLabel(w.status)}</span>
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
                  {w.paused ? (
                    <button
                      type="button"
                      style={styles.smallBtn}
                      onClick={() => chrome.runtime.sendMessage({ type: "worker.resume", worker_id: w.id })}
                    >
                      恢复
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={styles.smallBtn}
                      onClick={() => chrome.runtime.sendMessage({ type: "worker.pause", worker_id: w.id })}
                    >
                      暂停
                    </button>
                  )}
                  <button
                    type="button"
                    style={{ ...styles.smallBtn, color: "#fca5a5" }}
                    onClick={() => {
                      chrome.runtime.sendMessage({
                        type: "chat.abort",
                        threadId: w.id,
                        thread_id: w.id,
                      })
                      chrome.runtime.sendMessage({ type: "fleet.status" })
                    }}
                  >
                    取消
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {scopedLocks.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={styles.panelHead}>
                <span>Tab 锁</span>
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
                      onClick={() =>
                        chrome.runtime.sendMessage({
                          type: "tab.force_release",
                          tab_id: l.tab_id,
                          by: "user",
                        })
                      }
                    >
                      强制释放
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { borderTop: `1px solid ${tokens.border || "#e5e7eb"}`, background: tokens.bgElevated || "#fafafa" },
  wrapFocus: {
    background: tokens.bgElevated || "#fafafa",
    maxHeight: 40,
    overflow: "hidden",
  },
  strip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    fontSize: 11,
  },
  stripFocus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    fontSize: 11,
    minHeight: 28,
    maxHeight: 40,
  },
  mainBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: tokens.text,
    textAlign: "left",
    padding: "2px 0",
  },
  dot: { width: 8, height: 8, borderRadius: 99, flexShrink: 0 },
  meta: { fontSize: 10, color: tokens.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: {
    minWidth: 16,
    height: 16,
    borderRadius: 99,
    background: "#dc2626",
    color: "#fff",
    fontSize: 10,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 4px",
  },
  dangerBtn: {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 6,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
    cursor: "pointer",
  },
  link: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 10,
    padding: "2px 4px",
  },
  panel: {
    maxHeight: 220,
    overflow: "auto",
    padding: "0 8px 8px",
    borderTop: `1px solid ${tokens.border || "#eee"}`,
  },
  panelHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 10,
    color: tokens.textMuted,
    margin: "6px 0 4px",
  },
  empty: { fontSize: 10, color: tokens.textSecondary, padding: "4px 0" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 },
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
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    cursor: "pointer",
    color: tokens.text,
  },
}
