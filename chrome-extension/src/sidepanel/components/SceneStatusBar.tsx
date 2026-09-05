// Scene status strip — active Mission Pack (场景), tool surface, and/or workspace.
// Product SoT: mission-pack UX + 2026-08 tool-surface chip (adversarial P0).

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
function toolSurfaceLabel(wl: string[] | null | undefined): string | null {
  if (wl == null) return null
  if (!Array.isArray(wl) || wl.length === 0) return "空白名单"
  if (wl.length === 1) return wl[0]!.length > 28 ? wl[0]!.slice(0, 26) + "…" : wl[0]!
  return `${wl.length} 项`
}

export function SceneStatusBar() {
  const { state } = useAgentStore()
  const host = useContextPanelHostOptional()
  const thread = (state.threads || []).find((t) => t.id === state.activeThreadId)
  const packId = (thread as { mission_pack_id?: string | null } | undefined)?.mission_pack_id || null
  const workspaceRoot =
    (thread as { workspace_root?: string | null } | undefined)?.workspace_root || null
  const toolWhitelist = (thread as { tool_whitelist?: string[] | null } | undefined)?.tool_whitelist
  const surfaceLabel = toolSurfaceLabel(toolWhitelist)

  if (!packId && !workspaceRoot && surfaceLabel == null) return null

  const unapply = () => {
    if (!state.activeThreadId || !packId) return
    chrome.runtime.sendMessage({
      type: "pack.unapply",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const clearWorkspace = () => {
    if (!state.activeThreadId || !workspaceRoot) return
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
    <div style={styles.bar} data-testid="scene-status-bar" role="status">
      {packId ? (
        <span
          style={styles.chip}
          title="本对话挂有场景配方（工具白名单等）。软删/恢复不会自动写回 Trust 巡航；抬升需在场景面板重新应用并确认。"
        >
          <button type="button" style={styles.linkish} onClick={openScenes}>
            场景：{sceneDisplayName(packId)}
          </button>
          <button type="button" style={styles.exitBtn} onClick={unapply} title="退出场景配方，回到通用助手">
            退出场景
          </button>
        </span>
      ) : null}
      {surfaceLabel != null ? (
        <span
          style={{ ...styles.chip, ...styles.surfaceChip }}
          title={
            Array.isArray(toolWhitelist)
              ? `本对话工具白名单：\n${toolWhitelist.join("\n")}\n\n三旗全自动巡航也会放开普通对话工具面；点「恢复全工具」立即对本对话生效。`
              : "工具面已收窄"
          }
          data-testid="tool-surface-chip"
        >
          <span style={styles.surfaceText}>工具面：{surfaceLabel}</span>
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
      {workspaceRoot ? (
        <span style={styles.chip} title={workspaceRoot}>
          <span style={styles.ws}>工作区：{workspaceBasename(workspaceRoot)}</span>
          <button type="button" style={styles.exitBtn} onClick={clearWorkspace} title="解除本对话工作区绑定（不删文件）">
            清除
          </button>
        </span>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  bar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "4px 10px",
    maxHeight: 36,
    overflow: "hidden",
    fontSize: 11,
    fontFamily: tokens.font,
    background: tokens.bgElevated,
    borderBottom: `1px solid ${tokens.border}`,
    color: tokens.textSecondary,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
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
