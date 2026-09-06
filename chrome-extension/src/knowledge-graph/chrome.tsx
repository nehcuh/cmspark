// #296 图谱视图可测 chrome（入口、三态、着色切换、LLM 开关、分组卡片）。
// 纯展示：不读 chrome.*，方便 renderToStaticMarkup。

import type { CSSProperties, MouseEventHandler } from "react"
import {
  KNOWLEDGE_GRAPH_AI_BADGE,
  KNOWLEDGE_GRAPH_COLOR_FOLDER,
  KNOWLEDGE_GRAPH_COLOR_GROUP,
  KNOWLEDGE_GRAPH_ENTRY_LABEL,
  KNOWLEDGE_GRAPH_ERROR_DETAIL_LABEL,
  KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED,
  KNOWLEDGE_GRAPH_LLM_TOGGLE,
  KNOWLEDGE_GRAPH_LOCK_DISSOLVED,
  KNOWLEDGE_GRAPH_LOCK_GROUP,
  KNOWLEDGE_GRAPH_NO_RELATIONS,
  KNOWLEDGE_GRAPH_ORGANIZE_RETRY,
  KNOWLEDGE_GRAPH_ORGANIZING,
  KNOWLEDGE_GRAPH_REBUILD_TIMEOUT_COPY,
  KNOWLEDGE_GRAPH_REGENERATE,
  KNOWLEDGE_GRAPH_REORGANIZE,
  KNOWLEDGE_GRAPH_STALE_BADGE,
  KNOWLEDGE_GRAPH_TF_SWITCH_BANNER,
  KNOWLEDGE_GRAPH_UNLOCK_GROUP,
  graphBannerCopy,
  knowledgeGraphOrganizeCta,
  type KnowledgeGraphStatus,
} from "./copy"
import { groupCardModel } from "./labels"
import type { ColorMode } from "./coloring"
import type { KnowledgeGraphLabel } from "./wire"

const btn: CSSProperties = {
  border: "1px solid rgba(148,163,184,0.35)",
  background: "transparent",
  color: "inherit",
  borderRadius: 8,
  padding: "4px 8px",
  fontSize: 11,
  cursor: "pointer",
}

export function KnowledgeGraphEntryButton(props: {
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={KNOWLEDGE_GRAPH_ENTRY_LABEL}
      title={KNOWLEDGE_GRAPH_ENTRY_LABEL}
      style={{
        ...btn,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginLeft: "auto",
        flexShrink: 0,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="3" cy="3" r="1.6" fill="currentColor" />
        <circle cx="9" cy="4" r="1.6" fill="currentColor" />
        <circle cx="5" cy="9" r="1.6" fill="currentColor" />
        <path d="M3.6 3.8 L8.4 4.4 M3.4 4.2 L4.6 8.2 M8.4 5 L5.6 8.2" stroke="currentColor" strokeWidth="0.8" fill="none" />
      </svg>
      {KNOWLEDGE_GRAPH_ENTRY_LABEL}
    </button>
  )
}

export function KnowledgeGraphStatusView(props: {
  status: KnowledgeGraphStatus
  truncated: boolean
  /** 轮询上限打满（复审 NIT-5）：重建不再自动重试，提示手动刷新。 */
  pollExhausted?: boolean
  /** #356: error 态的服务端错误说明（内部英文/路径不直接铺开，折叠进详情）。 */
  error?: string
}) {
  const copy =
    props.pollExhausted && props.status === "rebuilding"
      ? KNOWLEDGE_GRAPH_REBUILD_TIMEOUT_COPY
      : graphBannerCopy(props.status, props.truncated)
  if (!copy) return null
  return (
    <div role="status" style={{ fontSize: 13, lineHeight: 1.5, padding: "12px 16px" }}>
      {copy}
      {props.status === "error" && props.error ? (
        <details style={{ marginTop: 4, fontSize: 11, opacity: 0.8 }}>
          <summary style={{ cursor: "pointer" }}>{KNOWLEDGE_GRAPH_ERROR_DETAIL_LABEL}</summary>
          <div style={{ marginTop: 2, wordBreak: "break-all" }}>{props.error}</div>
        </details>
      ) : null}
    </div>
  )
}

export function KnowledgeGraphColorSwitch(props: {
  mode: ColorMode
  onChange: (mode: ColorMode) => void
}) {
  return (
    <div role="group" aria-label="着色" style={{ display: "inline-flex", gap: 4 }}>
      <button
        type="button"
        aria-pressed={props.mode === "group"}
        onClick={() => props.onChange("group")}
        style={btn}
      >
        {KNOWLEDGE_GRAPH_COLOR_GROUP}
      </button>
      <button
        type="button"
        aria-pressed={props.mode === "folder"}
        onClick={() => props.onChange("folder")}
        style={btn}
      >
        {KNOWLEDGE_GRAPH_COLOR_FOLDER}
      </button>
    </div>
  )
}

export function KnowledgeGraphLlmSwitch(props: {
  enabled: boolean
  onChange: (enabled: boolean) => void
  onRegenerate: () => void
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        role="switch"
        aria-checked={props.enabled}
        aria-pressed={props.enabled}
        onClick={() => props.onChange(!props.enabled)}
        style={btn}
      >
        {KNOWLEDGE_GRAPH_LLM_TOGGLE}
      </button>
      {props.enabled ? (
        <button type="button" onClick={props.onRegenerate} style={btn}>
          {KNOWLEDGE_GRAPH_REGENERATE}
        </button>
      ) : null}
    </div>
  )
}

export function KnowledgeGraphGroupCard(props: {
  groupKey: string
  label: KnowledgeGraphLabel | undefined
  llmEnabled: boolean
  /** #427：l: 整理分组，开关关也出 AI 标。 */
  llmLaneGroup?: boolean
  onLock?: () => void
  onUnlock?: () => void
}) {
  const model = groupCardModel(props.label, props.llmEnabled, {
    llmLaneGroup: props.llmLaneGroup === true,
  })
  const locked = props.label?.locked === true
  return (
    <div data-group-key={props.groupKey} style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>{model.name}</strong>
        {model.showAiBadge ? (
          <span title={KNOWLEDGE_GRAPH_AI_BADGE} style={{ fontSize: 10, opacity: 0.75 }}>
            {KNOWLEDGE_GRAPH_AI_BADGE}
          </span>
        ) : null}
      </div>
      {model.summary ? (
        <p style={{ fontSize: 11, margin: "4px 0 0", lineHeight: 1.4 }}>{model.summary}</p>
      ) : null}
      {props.llmLaneGroup && props.onLock && !locked ? (
        <button type="button" onClick={props.onLock} style={{ ...btn, marginTop: 6 }}>
          {KNOWLEDGE_GRAPH_LOCK_GROUP}
        </button>
      ) : null}
      {props.llmLaneGroup && props.onUnlock && locked ? (
        <button type="button" onClick={props.onUnlock} style={{ ...btn, marginTop: 6 }}>
          {KNOWLEDGE_GRAPH_UNLOCK_GROUP}
        </button>
      ) : null}
    </div>
  )
}

export function KnowledgeGraphOrganizeCta(props: {
  n: number
  disabled: boolean
  organizing: boolean
  onOrganize: () => void
}) {
  return (
    <div role="status" style={{ fontSize: 13, lineHeight: 1.5, padding: "12px 16px" }}>
      <button
        type="button"
        data-testid="kg-organize-cta"
        disabled={props.disabled || props.organizing}
        title={props.disabled ? KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED : undefined}
        onClick={props.onOrganize}
        style={{
          ...btn,
          opacity: props.disabled || props.organizing ? 0.5 : 1,
          cursor: props.disabled || props.organizing ? "not-allowed" : "pointer",
        }}
      >
        {props.organizing ? KNOWLEDGE_GRAPH_ORGANIZING : knowledgeGraphOrganizeCta(props.n)}
      </button>
    </div>
  )
}

export function KnowledgeGraphOrganizeErrorBar(props: {
  error: string
  onRetry: () => void
}) {
  return (
    <div role="alert" data-testid="kg-organize-error" style={{ fontSize: 13, lineHeight: 1.5, padding: "12px 16px" }}>
      <span>{props.error}</span>{" "}
      <button type="button" onClick={props.onRetry} style={btn}>
        {KNOWLEDGE_GRAPH_ORGANIZE_RETRY}
      </button>
    </div>
  )
}

export function KnowledgeGraphStaleBadge() {
  return (
    <span data-testid="kg-stale-badge" style={{ fontSize: 11, opacity: 0.85 }}>
      {KNOWLEDGE_GRAPH_STALE_BADGE}
    </span>
  )
}

export function KnowledgeGraphTfSwitchBanner() {
  return (
    <div role="status" data-testid="kg-tf-switch-banner" style={{ fontSize: 13, lineHeight: 1.5, padding: "12px 16px" }}>
      {KNOWLEDGE_GRAPH_TF_SWITCH_BANNER}
    </div>
  )
}

export function KnowledgeGraphLockDissolvedBanner() {
  return (
    <div role="status" data-testid="kg-lock-dissolved" style={{ fontSize: 13, lineHeight: 1.5, padding: "12px 16px" }}>
      {KNOWLEDGE_GRAPH_LOCK_DISSOLVED}
    </div>
  )
}

export function KnowledgeGraphNoRelationsNote() {
  return (
    <div data-testid="kg-no-relations" style={{ fontSize: 11, opacity: 0.8, padding: "4px 0" }}>
      {KNOWLEDGE_GRAPH_NO_RELATIONS}
    </div>
  )
}

export function KnowledgeGraphReorganizeButton(props: {
  organizing: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid="kg-reorganize"
      disabled={props.disabled || props.organizing}
      title={props.disabled ? KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED : undefined}
      onClick={props.onClick}
      style={{
        ...btn,
        opacity: props.disabled || props.organizing ? 0.5 : 1,
        cursor: props.disabled || props.organizing ? "not-allowed" : "pointer",
      }}
    >
      {props.organizing ? KNOWLEDGE_GRAPH_ORGANIZING : KNOWLEDGE_GRAPH_REORGANIZE}
    </button>
  )
}
