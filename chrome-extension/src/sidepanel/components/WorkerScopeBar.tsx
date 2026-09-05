// Worker drill-down breadcrumb (SoT §5.2) — single line ≤28px at Chat top.

import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { resolveParentThreadId } from "../utils/thread-busy"

export function WorkerScopeBar() {
  const { state, dispatch } = useAgentStore()
  const active = state.threads.find((t) => t.id === state.activeThreadId)
  if (!active || active.agent_role !== "worker") return null

  const fleetRow = state.fleet?.workers?.find((w) => w.id === active.id)
  const orchestratorForRun =
    state.fleet?.workers?.find(
      (w) =>
        w.agent_role === "orchestrator" &&
        w.orchestrator_run_id &&
        w.orchestrator_run_id === active.orchestrator_run_id,
    )?.id ||
    state.threads.find(
      (t) =>
        t.agent_role === "orchestrator" &&
        t.orchestrator_run_id === active.orchestrator_run_id,
    )?.id ||
    null

  const parentId = resolveParentThreadId({
    activeParentId: active.parent_thread_id,
    fleetParentId: fleetRow?.parent_thread_id,
    orchestratorIdForRun: orchestratorForRun,
  })

  const role =
    active.worker_role_label || active.alias || active.id.slice(0, 8)
  const status = fleetRow?.status
  const statusLabel =
    status === "holding_tabs"
      ? "持锁中"
      : status === "paused"
        ? "已暂停"
        : fleetRow?.llm_active || state.threadBusyById[active.id]
          ? "处理中"
          : "空闲"
  const tabHint = fleetRow?.tab_locks?.length
    ? ` · tab ${fleetRow.tab_locks.map((t) => t.tab_id).join(",")}`
    : ""

  const goBack = () => {
    if (parentId) {
      dispatch({ type: "SET_ACTIVE_THREAD", threadId: parentId })
      chrome.runtime.sendMessage({ type: "thread.select", threadId: parentId })
    }
  }

  return (
    <div style={styles.bar} data-worker-scope-bar>
      <button
        type="button"
        style={styles.back}
        onClick={goBack}
        disabled={!parentId}
        title={parentId ? "返回编排" : "无父线程"}
      >
        ← 返回编排
      </button>
      <span style={styles.meta}>
        ⚙️ {role} · {statusLabel}
        {tabHint}
      </span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "2px 10px",
    minHeight: 24,
    maxHeight: 28,
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    fontFamily: tokens.font,
    fontSize: 11,
    boxSizing: "border-box",
  },
  back: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 11,
    padding: "0 2px",
    flexShrink: 0,
    fontWeight: 600,
  },
  meta: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.textMuted,
  },
}
