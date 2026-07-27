// ADR-015 P1 — Side Panel FleetStrip (~320px): counts, worst status, pending badge, stop-all, expand fleet panel

import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import type { FleetWorkerView } from "../types"

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

export function FleetStrip() {
  const { state, dispatch } = useAgentStore()
  const [expanded, setExpanded] = useState(false)
  const fleet = state.fleet
  const pending = state.pendingSecurityConfirmations.length
  const workerCount = fleet?.worker_count ?? 0
  const lockCount = fleet?.lock_count ?? 0
  const openIntents = fleet?.open_intent_count ?? 0
  const worst = fleet?.worst_status

  useEffect(() => {
    const tick = () => chrome.runtime.sendMessage({ type: "fleet.status" })
    tick()
    const id = setInterval(tick, 4000)
    return () => clearInterval(id)
  }, [])

  // Always show thin strip when multi-agent activity, board intents, or pending confirms
  const visible = workerCount > 0 || lockCount > 0 || openIntents > 0 || pending > 0 || expanded
  if (!visible && !expanded) {
    // Compact always-available entry so user can open fleet even when empty
    return (
      <div style={styles.stripIdle}>
        <button type="button" style={styles.link} onClick={() => {
          setExpanded(true)
          chrome.runtime.sendMessage({ type: "fleet.status" })
        }}>
          舰队
        </button>
      </div>
    )
  }

  const stopAll = () => {
    if (!window.confirm("停止所有 worker？将 abort LLM、释放 tab 锁并暂停。")) return
    chrome.runtime.sendMessage({ type: "fleet.stop_all" })
  }

  const enterWorker = (w: FleetWorkerView) => {
    dispatch({ type: "SET_ACTIVE_THREAD", threadId: w.id })
    chrome.runtime.sendMessage({ type: "thread.select", threadId: w.id })
    setExpanded(false)
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.strip}>
        <button type="button" style={styles.mainBtn} onClick={() => setExpanded((e) => !e)}>
          <span style={{ ...styles.dot, background: worstColor(worst) }} />
          <strong style={{ fontSize: 11 }}>舰队</strong>
          <span style={styles.meta}>
            {workerCount} worker · {lockCount} 锁
            {openIntents > 0 ? ` · ${openIntents} intent` : ""} · {worstLabel(worst)}
          </span>
          {openIntents > 0 && (
            <span style={{ ...styles.badge, background: "#ca8a04" }} title="未关闭 Intent">
              {openIntents}
            </span>
          )}
          {pending > 0 && (
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
          title="Stop all workers"
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

      {expanded && (
        <div style={styles.panel}>
          <div style={styles.panelHead}>
            <span>Workers & Tab 锁</span>
            <button type="button" style={styles.link} onClick={() => chrome.runtime.sendMessage({ type: "fleet.status" })}>
              刷新
            </button>
          </div>
          {(!fleet || fleet.workers.length === 0) && (
            <div style={styles.empty}>暂无 orchestrator/worker。spawn_worker 后会出现在此。</div>
          )}
          <ul style={styles.list}>
            {(fleet?.workers || []).map((w) => (
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
                    切入
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
          {(fleet?.locks?.length || 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={styles.panelHead}>
                <span>Tab 锁</span>
              </div>
              <ul style={styles.list}>
                {fleet!.locks.map((l) => (
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
  stripIdle: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "2px 8px",
    borderTop: `1px solid ${tokens.border || "#eee"}`,
  },
  strip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    fontSize: 11,
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
  empty: { fontSize: 10, color: tokens.textMuted, padding: "4px 0" },
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
