// Scene chips row — active Mission Pack (场景), tool surface, workspace.
// #321 PR-2: former standalone SceneStatusBar, now a single ≤24px row inside
// FocusBand (primary "scene" or secondary under a light primary). Light tone only —
// dark chrome belongs to Confirm/急停. Legacy data-testids preserved for stability:
// scene-status-bar (row) / tool-surface-chip (surface chip).

import type { CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { useContextPanelHostOptional } from "./ContextPanelHost"

const APPSEC_NAME = "应用安全审查"

function sceneDisplayName(packId: string | null | undefined): string {
  if (!packId) return ""
  if (packId === "appsec-prd-review") return APPSEC_NAME
  return packId
}

function workspaceBasename(root: string): string {
  const parts = root.replace(/\/+$/, "").split(/[/\\]/)
  return parts[parts.length - 1] || root
}

/** Short label for tool_whitelist patterns (null = full surface, no chip). */
export function toolSurfaceLabel(wl: string[] | null | undefined): string | null {
  if (wl == null) return null
  if (!Array.isArray(wl) || wl.length === 0) return "空白名单"
  if (wl.length === 1) return wl[0]!.length > 28 ? wl[0]!.slice(0, 26) + "…" : wl[0]!
  return `${wl.length} 项`
}

export interface SceneStatusInfo {
  packId: string | null
  workspaceRoot: string | null
  toolWhitelist: string[] | null | undefined
  surfaceLabel: string | null
}

/** Scene facts for FocusBand slot resolution (hasScene = any field present). */
export function readSceneStatus(state: {
  threads?: Array<{
    id: string
    mission_pack_id?: string | null
    workspace_root?: string | null
    tool_whitelist?: string[] | null
  }>
  activeThreadId: string | null
}): SceneStatusInfo {
  const thread = (state.threads || []).find((t) => t.id === state.activeThreadId)
  const packId = thread?.mission_pack_id || null
  const workspaceRoot = thread?.workspace_root || null
  const toolWhitelist = thread?.tool_whitelist
  return {
    packId,
    workspaceRoot,
    toolWhitelist,
    surfaceLabel: toolSurfaceLabel(toolWhitelist),
  }
}

export function SceneStatusRow({ secondary = false }: { secondary?: boolean } = {}) {
  const { state } = useAgentStore()
  const host = useContextPanelHostOptional()
  const info = readSceneStatus(state)

  const unapply = () => {
    if (!state.activeThreadId || !info.packId) return
    chrome.runtime.sendMessage({
      type: "pack.unapply",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const clearWorkspace = () => {
    if (!state.activeThreadId || !info.workspaceRoot) return
    chrome.runtime.sendMessage({
      type: "workspace.clear",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  /** Restore full tool surface on THIS conversation immediately (thread.update). */
  const restoreFullTools = () => {
    if (!state.activeThreadId) return
    chrome.runtime.sendMessage({
      type: "thread.update",
      thread_id: state.activeThreadId,
      updates: { tool_whitelist: null },
    })
  }

  const openScenes = () => {
    host?.openPanelForce("packs")
  }

  return (
    <div
      style={{ ...styles.row, ...(secondary ? styles.rowSecondary : styles.rowPrimary) }}
      data-testid="scene-status-bar"
      role="status"
    >
      {info.packId ? (
        <span
          style={styles.chip}
          title="本对话挂有场景配方（工具白名单等）。软删/恢复不会自动写回 Trust 巡航；抬升需在场景面板重新应用并确认。"
        >
          <button type="button" style={styles.linkish} onClick={openScenes}>
            场景：{sceneDisplayName(info.packId)}
          </button>
          <button type="button" style={styles.exitBtn} onClick={unapply} title="退出场景配方，回到通用助手">
            退出场景
          </button>
        </span>
      ) : null}
      {info.surfaceLabel != null ? (
        <span
          style={{ ...styles.chip, ...styles.surfaceChip }}
          title={
            Array.isArray(info.toolWhitelist)
              ? `本对话工具白名单：\n${info.toolWhitelist.join("\n")}\n\n三旗全自动巡航也会放开普通对话工具面；点「恢复全工具」立即对本对话生效。`
              : "工具面已收窄"
          }
          data-testid="tool-surface-chip"
        >
          <span style={styles.surfaceText}>工具面：{info.surfaceLabel}</span>
          <button
            type="button"
            style={styles.exitBtn}
            onClick={restoreFullTools}
            title="清除本对话工具白名单（立即生效，无需新建对话）"
          >
            恢复全工具
          </button>
        </span>
      ) : null}
      {info.workspaceRoot ? (
        <span style={styles.chip} title={info.workspaceRoot}>
          <span style={styles.ws}>工作区：{workspaceBasename(info.workspaceRoot)}</span>
          <button type="button" style={styles.exitBtn} onClick={clearWorkspace} title="解除本对话工作区绑定（不删文件）">
            清除
          </button>
        </span>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  /** One line, no wrap — the band's 80px budget has no room for stacked chips. */
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "nowrap",
    overflow: "hidden",
    fontSize: 11,
    fontFamily: tokens.font,
    color: tokens.textSecondary,
    boxSizing: "border-box",
  },
  rowPrimary: {
    padding: "5px 10px",
    minHeight: 28,
    maxHeight: 36,
  },
  rowSecondary: {
    padding: "3px 10px",
    maxHeight: 24,
    flexShrink: 0,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
  },
  surfaceChip: {
    background: tokens.warningSoft,
    borderRadius: tokens.radiusSm,
    padding: "1px 4px 1px 6px",
  },
  surfaceText: {
    fontSize: 10,
    fontWeight: 600,
    color: tokens.warning,
    maxWidth: 180,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  linkish: {
    border: "none",
    background: "transparent",
    color: tokens.accentText,
    fontWeight: 600,
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
    fontFamily: tokens.font,
    maxWidth: 160,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  exitBtn: {
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgMuted,
    color: tokens.text,
    borderRadius: tokens.radiusSm,
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    cursor: "pointer",
    fontFamily: tokens.font,
    flexShrink: 0,
  },
  ws: {
    fontSize: 10,
    color: tokens.textMuted,
    maxWidth: 140,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
}
