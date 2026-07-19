// WP4 (WI-4): 坐标任务常驻任务条 —— 急停按钮 + 预算进度 + 步骤时间线。
//
// 纯渲染组件:状态折叠(P4 懒创建/迟到丢弃/时间线截断)全部在 store 的
// reduceComputerTaskEvent 纯函数;本组件只管视图与本地 UI 态(展开、计时器、
// 图片放大)。
//
// 急停语义(A1/E5 的面板端):
//  - 点击发送 computer.task.abort {task_id}(background 透传 → companion);
//  - ack(matched>0)经 COMPUTER_TASK_ABORT_ACK 置 abortAcked →
//    「已急停，等待任务退出…」;
//  - 3s 无 ack → 黄条提示「急停未确认——可用 Ctrl+Alt+End 热键」。
// 完结态(ok/fail + completed/total)保留 5s 后自动隐藏(组件计时;store
// 状态保留,下一任务 started 到达时由状态机重置)。

import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { isValidEvidenceTaskId, previewImageSafe } from "../utils/computer-utils"
import { Modal } from "./ui/Modal"
import type { ComputerLocateAttemptView, ComputerStepView } from "../types"

/** 急停 ack 等待上限——超过仍未确认则提示热键兜底。 */
const ABORT_ACK_TIMEOUT_MS = 3000
/** 完结态停留时长。 */
const FINISHED_LINGER_MS = 5000

function layerBadgeStyle(layer?: string): { color: string; bg: string } {
  if (layer === "uia") return { color: "#1d4ed8", bg: "#dbeafe" }
  if (layer === "ocr") return { color: "#4b5563", bg: "#e5e7eb" }
  return { color: "#6b7280", bg: "#f3f4f6" }
}

function statusLabel(task: { status: string; resyncing: boolean; ok?: boolean }): string {
  if (task.status === "running") return task.resyncing ? "进行中（恢复同步）" : "进行中"
  if (task.status === "paused") return "已暂停"
  return task.ok === false ? "已失败" : "已完成"
}

function AttemptRow({ a }: { a: ComputerLocateAttemptView }) {
  return (
    <div style={styles.attemptRow}>
      <span style={styles.attemptLayer}>{a.layer ?? "?"}</span>
      <span>{a.outcome ?? ""}</span>
      {a.reason && <span style={styles.attemptReason}>{a.reason}</span>}
      {typeof a.durationMs === "number" && <span style={styles.stepMeta}>{a.durationMs}ms</span>}
    </div>
  )
}

function StepRow({ step, onZoom }: { step: ComputerStepView; onZoom: (b64: string) => void }) {
  const [attemptsOpen, setAttemptsOpen] = useState(false)
  const badge = layerBadgeStyle(step.layer)
  const showImage = previewImageSafe(step.previewImage)
  return (
    <div style={styles.stepRow}>
      <div style={styles.stepMain}>
        <span style={styles.stepSeq}>#{step.seq}</span>
        <span style={styles.stepCaption}>{step.caption ?? step.action ?? ""}</span>
        {step.layer && (
          <span style={{ ...styles.layerBadge, color: badge.color, background: badge.bg }}>{step.layer}</span>
        )}
        {typeof step.confidence === "number" && (
          <span style={styles.stepMeta}>{Math.round(step.confidence * 100)}%</span>
        )}
        {typeof step.durationMs === "number" && <span style={styles.stepMeta}>{step.durationMs}ms</span>}
        {typeof step.x === "number" && typeof step.y === "number" && (
          <span style={styles.stepMeta}>({step.x}, {step.y})</span>
        )}
        {step.crossverified === false && (
          <span style={styles.uncrossBadge} title="本步未经像素交叉复核">未复核</span>
        )}
        {showImage && (
          <img
            src={`data:image/jpeg;base64,${step.previewImage}`}
            alt={`步骤 ${step.seq} 截图`}
            title="点击放大"
            style={styles.thumb}
            onClick={(e) => {
              e.stopPropagation()
              onZoom(step.previewImage as string)
            }}
            // 渲染失败静默隐藏——时间线永不被图片阻塞。
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = "none"
            }}
          />
        )}
        {Array.isArray(step.locateAttempts) && step.locateAttempts.length > 1 && (
          <button
            type="button"
            style={styles.attemptsToggle}
            onClick={(e) => {
              e.stopPropagation()
              setAttemptsOpen(!attemptsOpen)
            }}
          >
            降级详情（{step.locateAttempts.length}）{attemptsOpen ? "▲" : "▼"}
          </button>
        )}
      </div>
      {attemptsOpen && step.locateAttempts && (
        <div style={styles.attemptsBox}>
          {step.locateAttempts.map((a, i) => (
            <AttemptRow key={i} a={a} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ComputerTaskBar() {
  const { state } = useAgentStore()
  const task = state.computerTask
  const [expanded, setExpanded] = useState(false)
  const [abortSentAt, setAbortSentAt] = useState<number | null>(null)
  const [abortUnconfirmed, setAbortUnconfirmed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [zoomImage, setZoomImage] = useState<string | null>(null)

  // 任务切换(started 重置/新懒创建)时清空本地 UI 态。
  useEffect(() => {
    setExpanded(false)
    setAbortSentAt(null)
    setAbortUnconfirmed(false)
    setDismissed(false)
    setZoomImage(null)
  }, [task?.taskId])

  // 急停 3s 无 ack → 未确认提示;ack 到达(task.abortAcked)则撤掉计时。
  useEffect(() => {
    if (abortSentAt === null || !task || task.abortAcked) return
    const t = setTimeout(() => setAbortUnconfirmed(true), ABORT_ACK_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [abortSentAt, task, task?.abortAcked])

  // 完结态停留 5s 后自动隐藏。
  useEffect(() => {
    if (!task || task.status !== "finished") return
    const elapsed = Date.now() - (task.finishedAt ?? Date.now())
    const t = setTimeout(() => setDismissed(true), Math.max(0, FINISHED_LINGER_MS - elapsed))
    return () => clearTimeout(t)
  }, [task, task?.status, task?.finishedAt])

  if (!task || dismissed) return null

  const finished = task.status === "finished"
  const lastBudgetLeft = [...task.steps].reverse().find((s) => typeof s.budgetLeft === "number")?.budgetLeft
  const budgetText =
    typeof task.budget === "number" ? `预算 ${task.budget - (lastBudgetLeft ?? task.budget)}/${task.budget}` : null
  const progressText =
    typeof task.total === "number"
      ? `${finished ? `${task.completed ?? 0}/${task.total} 步` : `${task.steps.length}/${task.total} 步`}`
      : null

  const sendAbort = () => {
    chrome.runtime.sendMessage({ type: "computer.task.abort", task_id: task.taskId })
    setAbortSentAt(Date.now())
    setAbortUnconfirmed(false)
  }

  return (
    <div style={styles.wrap}>
      <div
        style={styles.bar}
        role="button"
        tabIndex={0}
        title={expanded ? "点击收起步骤时间线" : "点击展开步骤时间线"}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
      >
        <span
          style={{
            ...styles.statusDot,
            background: finished ? (task.ok === false ? "#F44336" : "#4CAF50") : task.status === "paused" ? "#FFC107" : "#2196F3",
          }}
        />
        <span style={styles.statusLabel}>{statusLabel(task)}</span>
        <span style={styles.taskText} title={task.task}>
          {task.task ?? "（同步中…）"}
          {task.app ? ` — ${task.app}` : ""}
        </span>
        {progressText && <span style={styles.stepMeta}>{progressText}</span>}
        {budgetText && <span style={styles.stepMeta}>{budgetText}</span>}
        {!finished && !task.abortAcked && (
          <button
            type="button"
            style={styles.abortBtn}
            title="立即中止任务（companion 侧急停通道）"
            onClick={(e) => {
              e.stopPropagation()
              sendAbort()
            }}
          >
            ⏹ 急停
          </button>
        )}
        {!finished && task.abortAcked && <span style={styles.abortAckedText}>已急停，等待任务退出…</span>}
        <span style={styles.caret}>{expanded ? "▲" : "▼"}</span>
      </div>

      {task.status === "paused" && task.pauseReason && (
        <div style={styles.pausedBar}>已暂停：{task.pauseReason}</div>
      )}
      {finished && (
        <div style={{ ...styles.finishedBar, background: task.ok === false ? "#FFEBEE" : "#E8F5E9" }}>
          <span>
            {task.ok === false
              ? `任务失败${task.errorCode ? `（${task.errorCode}）` : ""}，完成 ${task.completed ?? 0}/${task.total ?? "?"} 步`
              : `任务完成，共 ${task.completed ?? 0}/${task.total ?? "?"} 步`}
          </span>
          {task.evidenceDir && isValidEvidenceTaskId(task.taskId) && (
            <button
              type="button"
              title="在 companion 机器上打开该任务的证据目录（explorer）"
              style={styles.evidenceBtn}
              onClick={(e) => {
                e.stopPropagation()
                chrome.runtime.sendMessage({ type: "computer.evidence.open", task_id: task.taskId })
              }}
            >
              📂 打开证据目录
            </button>
          )}
        </div>
      )}
      {abortUnconfirmed && !task.abortAcked && !finished && (
        <div style={styles.abortWarnBar}>急停未确认——可用 Ctrl+Alt+End 热键</div>
      )}

      {expanded && (
        <div style={styles.timeline}>
          {task.steps.length === 0 ? (
            <div style={styles.emptySteps}>暂无步骤事件{task.resyncing ? "（面板恢复同步中，started 之前的步骤不可见）" : ""}</div>
          ) : (
            task.steps.map((s, i) => <StepRow key={`${s.seq}-${i}`} step={s} onZoom={setZoomImage} />)
          )}
        </div>
      )}

      <Modal
        open={zoomImage !== null}
        onClose={() => setZoomImage(null)}
        ariaLabel="步骤截图放大查看"
        overlayStyle={styles.zoomOverlay}
        panelStyle={styles.zoomPanel}
      >
        {zoomImage && (
          <img src={`data:image/jpeg;base64,${zoomImage}`} alt="步骤截图放大" style={styles.zoomImg} />
        )}
      </Modal>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    borderTop: "1px solid #e5e7eb",
    background: "#fff",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    cursor: "pointer",
    userSelect: "none",
    fontSize: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  statusLabel: {
    fontWeight: 600,
    color: "#374151",
    flexShrink: 0,
  },
  taskText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#111827",
  },
  stepMeta: {
    color: "#9ca3af",
    fontSize: 11,
    flexShrink: 0,
  },
  abortBtn: {
    background: "#D32F2F",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
  abortAckedText: {
    color: "#D32F2F",
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  caret: {
    color: "#9ca3af",
    fontSize: 10,
    flexShrink: 0,
  },
  pausedBar: {
    background: "#FFF8E1",
    color: "#8D6E00",
    fontSize: 12,
    padding: "6px 10px",
    borderTop: "1px solid #FFECB3",
  },
  finishedBar: {
    fontSize: 12,
    padding: "6px 10px",
    color: "#374151",
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  evidenceBtn: {
    marginLeft: "auto",
    fontSize: 11,
    color: "#1d4ed8",
    background: "#dbeafe",
    border: "none",
    borderRadius: 4,
    padding: "2px 8px",
    cursor: "pointer",
    flexShrink: 0,
  },
  abortWarnBar: {
    background: "#FFF3CD",
    color: "#8D6E00",
    fontSize: 12,
    padding: "6px 10px",
    borderTop: "1px solid #FFC107",
  },
  timeline: {
    maxHeight: 240,
    overflow: "auto",
    borderTop: "1px solid #f3f4f6",
    padding: "4px 10px 8px",
  },
  emptySteps: {
    color: "#9ca3af",
    fontSize: 12,
    padding: "8px 0",
  },
  stepRow: {
    padding: "3px 0",
    borderBottom: "1px solid #f9fafb",
  },
  stepMain: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    flexWrap: "wrap",
  },
  stepSeq: {
    color: "#9ca3af",
    fontSize: 11,
    minWidth: 26,
  },
  stepCaption: {
    color: "#111827",
  },
  layerBadge: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 999,
    fontWeight: 600,
  },
  uncrossBadge: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 999,
    fontWeight: 600,
    color: "#B26B00",
    background: "#FFF4E5",
  },
  thumb: {
    width: 56,
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    cursor: "zoom-in",
    display: "block",
  },
  attemptsToggle: {
    background: "none",
    border: "none",
    color: "#6b7280",
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  },
  attemptsBox: {
    margin: "2px 0 2px 32px",
    padding: "4px 8px",
    background: "#f9fafb",
    borderRadius: 4,
  },
  attemptRow: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    color: "#4b5563",
    padding: "1px 0",
  },
  attemptLayer: {
    fontWeight: 600,
    minWidth: 32,
  },
  attemptReason: {
    color: "#9ca3af",
  },
  zoomOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 110,
  },
  zoomPanel: {
    maxWidth: "92%",
    maxHeight: "88%",
    background: "transparent",
  },
  zoomImg: {
    maxWidth: "100%",
    maxHeight: "82vh",
    display: "block",
    borderRadius: 6,
  },
}
