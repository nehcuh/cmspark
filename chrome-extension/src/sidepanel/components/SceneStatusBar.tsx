// Scene status strip — active Mission Pack (场景) and/or workspace.
// Product SoT: docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md §6.1

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

export function SceneStatusBar() {
  const { state } = useAgentStore()
  const host = useContextPanelHostOptional()
  const thread = (state.threads || []).find((t) => t.id === state.activeThreadId)
  const packId = (thread as { mission_pack_id?: string | null } | undefined)?.mission_pack_id || null
  const workspaceRoot =
    (thread as { workspace_root?: string | null } | undefined)?.workspace_root || null

  if (!packId && !workspaceRoot) return null

  const unapply = () => {
    if (!state.activeThreadId || !packId) return
    chrome.runtime.sendMessage({
      type: "pack.unapply",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const openScenes = () => {
    host?.openPanelForce("packs")
  }

  return (
    <div style={styles.bar} data-testid="scene-status-bar" role="status">
      {packId ? (
        <span style={styles.chip} title="本对话正在使用场景模板（会限制可用工具）">
          <button type="button" style={styles.linkish} onClick={openScenes}>
            场景：{sceneDisplayName(packId)}
          </button>
          <button type="button" style={styles.exitBtn} onClick={unapply} title="退出场景，回到通用助手">
            退出
          </button>
        </span>
      ) : null}
      {workspaceRoot ? (
        <span style={styles.ws} title={workspaceRoot}>
          工作区：{workspaceBasename(workspaceRoot)}
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
    maxHeight: 28,
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
