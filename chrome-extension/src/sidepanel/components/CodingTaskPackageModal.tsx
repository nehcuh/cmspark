// Phase A — 编程接力 task package modal (§5.7.7).
// Copy primary; optional terminal open is best-effort (no free exec).

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { codingHandoffCopy } from "../coding-handoff/copy"
import {
  buildCodingTaskPackage,
  copyTextToClipboard,
  summarizeDialogMessages,
} from "../coding-handoff/task-package"

export type CodingHandoffOpenDetail = {
  seedGoal?: string
  pageUrl?: string | null
  pageTitle?: string | null
  pageExcerpt?: string | null
}

type AcpAgent = {
  id: string
  display_name: string
  enabled: boolean
  command: string
  source?: "config" | "discovered"
}

type Props = {
  open: boolean
  onClose: () => void
  workspaceRoot?: string | null
  messages: Array<{ role?: string; content?: string }>
  pageUrl?: string | null
  pageTitle?: string | null
  pageExcerpt?: string | null
  seedGoal?: string
  threadId?: string | null
  acpEnabled?: boolean
  acpAgents?: AcpAgent[]
  onRequestWorkspace?: () => void
  onPasteBack?: (note: string) => void
}

export function CodingTaskPackageModal({
  open,
  onClose,
  workspaceRoot,
  messages,
  pageUrl,
  pageTitle,
  pageExcerpt,
  seedGoal,
  threadId,
  acpEnabled = false,
  acpAgents = [],
  onRequestWorkspace,
  onPasteBack,
}: Props) {
  const dialogDefault = useMemo(
    () => summarizeDialogMessages(messages, 6),
    [messages],
  )
  const [goal, setGoal] = useState(seedGoal || "")
  const [includeDialog, setIncludeDialog] = useState(true)
  const [includeUrl, setIncludeUrl] = useState(true)
  const [includePage, setIncludePage] = useState(false)
  const [status, setStatus] = useState("")
  const [pasteBack, setPasteBack] = useState("")
  const [showRaw, setShowRaw] = useState(false)
  const [agentId, setAgentId] = useState("")
  const [mode, setMode] = useState<"review_readonly" | "propose_diff">("review_readonly")
  const [cloudDisclosure, setCloudDisclosure] = useState(false)
  const readyAgents = useMemo(
    () => acpAgents.filter((a) => a.enabled && a.command),
    [acpAgents],
  )

  useEffect(() => {
    if (!open) return
    setGoal(
      seedGoal?.trim() ||
        messages
          .filter((m) => m.role === "user" && m.content)
          .slice(-1)[0]
          ?.content?.slice(0, 500) ||
        "",
    )
    setStatus("")
    setPasteBack("")
    setShowRaw(false)
    setCloudDisclosure(false)
    chrome.runtime.sendMessage({ type: "acp.list" }, () => {
      void chrome.runtime.lastError
    })
  }, [open, seedGoal, messages])

  useEffect(() => {
    if (readyAgents.length && !readyAgents.some((a) => a.id === agentId)) {
      setAgentId(readyAgents[0].id)
    }
  }, [readyAgents, agentId])

  const pkg = useMemo(
    () =>
      buildCodingTaskPackage({
        goal,
        workspaceRoot,
        pageUrl: includeUrl ? pageUrl : null,
        pageTitle: includeUrl ? pageTitle : null,
        dialogSummary: includeDialog ? dialogDefault : null,
        pageExcerpt: includePage ? pageExcerpt : null,
        includeDialog,
        includeUrl,
        includePageExcerpt: includePage,
      }),
    [
      goal,
      workspaceRoot,
      pageUrl,
      pageTitle,
      dialogDefault,
      pageExcerpt,
      includeDialog,
      includeUrl,
      includePage,
    ],
  )

  const flash = (msg: string, ms = 4000) => {
    setStatus(msg)
    window.setTimeout(() => setStatus(""), ms)
  }

  const doCopy = useCallback(async () => {
    if (!pkg.hasWorkspace) {
      flash(codingHandoffCopy.workspaceMissingBody, 5000)
      onRequestWorkspace?.()
      return
    }
    const ok = await copyTextToClipboard(pkg.markdown)
    if (ok) flash(codingHandoffCopy.copiedOk)
    else {
      setShowRaw(true)
      flash(codingHandoffCopy.clipboardFailed, 6000)
    }
  }, [pkg, onRequestWorkspace])

  const doOpenTerminal = useCallback(async () => {
    // Design §4 L0: copy-first only — no free-exec / no dead chrome message (Claude nit).
    // User opens their own terminal and pastes.
    const ok = await copyTextToClipboard(pkg.markdown)
    if (!ok) {
      setShowRaw(true)
      flash(codingHandoffCopy.clipboardFailed, 6000)
      return
    }
    flash(codingHandoffCopy.copiedOk + " — 请打开终端粘贴", 5000)
  }, [pkg.markdown])

  const doAcpStart = useCallback(() => {
    if (!threadId) {
      flash("需要先有对话线程", 4000)
      return
    }
    if (!pkg.hasWorkspace) {
      flash(codingHandoffCopy.workspaceMissingBody, 5000)
      onRequestWorkspace?.()
      return
    }
    if (!agentId) {
      flash(codingHandoffCopy.agentNotFoundBody, 5000)
      return
    }
    if (!cloudDisclosure) {
      flash(codingHandoffCopy.disclosureBlocked, 4000)
      return
    }
    flash("请求确认启动…", 3000)
    chrome.runtime.sendMessage(
      {
        type: "acp.ui_start",
        thread_id: threadId,
        agent_id: agentId,
        goal: goal.trim() || pkg.markdown.slice(0, 2000),
        workspace_root: workspaceRoot,
        mode,
        cloud_disclosure_accepted: true,
      },
      () => {
        void chrome.runtime.lastError
      },
    )
    onClose()
  }, [
    threadId,
    pkg,
    agentId,
    goal,
    workspaceRoot,
    mode,
    cloudDisclosure,
    onRequestWorkspace,
    onClose,
  ])

  if (!open) return null

  const workspaceLabel = workspaceRoot
    ? workspaceRoot.split(/[/\\]/).filter(Boolean).slice(-1)[0] || workspaceRoot
    : "（未绑定）"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={codingHandoffCopy.packageTitle}
      style={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
      }}
    >
      <div style={styles.panel}>
        <div style={styles.header}>
          <div style={styles.title}>{codingHandoffCopy.packageTitle}</div>
          <button type="button" style={styles.linkBtn} onClick={onClose}>
            {codingHandoffCopy.ctaClose}
          </button>
        </div>

        <p style={styles.blurb}>{codingHandoffCopy.productBlurb}</p>
        <p style={styles.contrast}>{codingHandoffCopy.outboundContrast}</p>

        <div style={styles.metaRow}>
          <span title={workspaceRoot || undefined}>📁 {workspaceLabel}</span>
          {workspaceRoot ? null : (
            <button type="button" style={styles.linkBtn} onClick={() => onRequestWorkspace?.()}>
              {codingHandoffCopy.ctaBindWorkspace}
            </button>
          )}
        </div>

        {(pageTitle || pageUrl) && (
          <div style={styles.metaMuted}>
            {pageTitle ? <div>{pageTitle}</div> : null}
            {pageUrl ? <div style={styles.mono}>{pageUrl}</div> : null}
          </div>
        )}

        <label style={styles.label}>{codingHandoffCopy.summaryLabel}</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={5}
          style={styles.textarea}
        />

        <div style={styles.checks}>
          <label style={styles.check}>
            <input
              type="checkbox"
              checked={includeDialog}
              onChange={(e) => setIncludeDialog(e.target.checked)}
            />{" "}
            {codingHandoffCopy.includeDialog}
          </label>
          <label style={styles.check}>
            <input
              type="checkbox"
              checked={includeUrl}
              onChange={(e) => setIncludeUrl(e.target.checked)}
            />{" "}
            {codingHandoffCopy.includeUrl}
          </label>
          <label style={styles.check}>
            <input
              type="checkbox"
              checked={includePage}
              onChange={(e) => setIncludePage(e.target.checked)}
            />{" "}
            {codingHandoffCopy.includePageExcerpt}
          </label>
        </div>

        <p style={styles.hint}>{codingHandoffCopy.packageHint}</p>
        <p style={styles.privacy}>{codingHandoffCopy.privacyLine}</p>
        <p style={styles.privacy}>{codingHandoffCopy.modeFootnote}</p>

        {status ? (
          <div role="status" style={styles.status}>
            {status}
          </div>
        ) : null}

        {showRaw ? (
          <textarea readOnly value={pkg.markdown} rows={8} style={styles.raw} />
        ) : null}

        {acpEnabled && readyAgents.length > 0 ? (
          <div style={styles.acpBlock}>
            <div style={styles.label}>{codingHandoffCopy.spawnTitle}（本机 · 确认后运行）</div>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              style={styles.select}
            >
              {readyAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name}
                  {a.source === "discovered" ? "（已检测）" : ""}
                </option>
              ))}
            </select>
            <select
              value={mode}
              onChange={(e) =>
                setMode(e.target.value === "propose_diff" ? "propose_diff" : "review_readonly")
              }
              style={styles.select}
            >
              <option value="review_readonly">{codingHandoffCopy.modeReviewOption}</option>
              <option value="propose_diff">{codingHandoffCopy.modeDraftOption}</option>
            </select>
            <p style={styles.privacy}>{codingHandoffCopy.modeFootnote}</p>
            <label style={styles.check}>
              <input
                type="checkbox"
                checked={cloudDisclosure}
                onChange={(e) => setCloudDisclosure(e.target.checked)}
              />
              {codingHandoffCopy.disclosureCheckbox}
            </label>
            <button
              type="button"
              style={styles.primary}
              onClick={doAcpStart}
              disabled={!goal.trim() || !agentId || !cloudDisclosure}
            >
              {mode === "propose_diff"
                ? codingHandoffCopy.ctaStartDraft
                : codingHandoffCopy.ctaStartReview}
            </button>
          </div>
        ) : acpEnabled ? (
          <p style={styles.hint}>{codingHandoffCopy.agentNotFoundBody}</p>
        ) : (
          <p style={styles.hint}>{codingHandoffCopy.settingsAcpHint}</p>
        )}

        <div style={styles.actions}>
          <button type="button" style={styles.secondary} onClick={onClose}>
            {codingHandoffCopy.ctaCancel}
          </button>
          <button type="button" style={styles.secondary} onClick={doOpenTerminal}>
            {codingHandoffCopy.ctaOpenTerminal}
          </button>
          <button
            type="button"
            style={styles.primary}
            onClick={() => void doCopy()}
            disabled={!goal.trim()}
          >
            {pkg.hasWorkspace
              ? codingHandoffCopy.ctaCopy
              : codingHandoffCopy.ctaBindWorkspace}
          </button>
        </div>

        <div style={styles.pasteBlock}>
          <div style={styles.label}>{codingHandoffCopy.pasteBackHint}</div>
          <textarea
            value={pasteBack}
            onChange={(e) => setPasteBack(e.target.value)}
            rows={3}
            style={styles.textarea}
            placeholder="PR link or summary…"
          />
          <button
            type="button"
            style={styles.secondary}
            disabled={!pasteBack.trim() || !onPasteBack}
            onClick={() => {
              onPasteBack?.(pasteBack.trim())
              setPasteBack("")
              flash(codingHandoffCopy.pasteBackOk)
            }}
          >
            {codingHandoffCopy.pasteBackCta}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.35)",
    zIndex: 10050,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: 8,
  },
  panel: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "92vh",
    overflow: "auto",
    background: tokens.bgElevated || "#fff",
    borderRadius: tokens.radiusLg || 12,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    padding: 12,
    boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: tokens.text || "#111",
  },
  blurb: {
    fontSize: 12,
    color: tokens.textSecondary || "#555",
    lineHeight: 1.45,
    margin: "0 0 6px",
  },
  contrast: {
    fontSize: 11,
    color: tokens.textMuted || "#888",
    lineHeight: 1.4,
    margin: "0 0 10px",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    marginBottom: 6,
    color: tokens.text || "#111",
  },
  metaMuted: {
    fontSize: 11,
    color: tokens.textSecondary || "#666",
    marginBottom: 8,
  },
  mono: {
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
    wordBreak: "break-all",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    marginBottom: 4,
    color: tokens.text || "#111",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 12,
    lineHeight: 1.4,
    padding: 8,
    borderRadius: tokens.radiusMd || 8,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    resize: "vertical",
    fontFamily: tokens.font || "inherit",
    marginBottom: 8,
  },
  checks: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 8,
  },
  check: {
    fontSize: 12,
    color: tokens.textSecondary || "#444",
  },
  hint: {
    fontSize: 11,
    color: tokens.textSecondary || "#666",
    margin: "0 0 4px",
  },
  privacy: {
    fontSize: 11,
    color: tokens.textMuted || "#888",
    margin: "0 0 6px",
    lineHeight: 1.4,
  },
  status: {
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    background: tokens.accentSoft || "#eef2ff",
    color: tokens.text || "#111",
    marginBottom: 8,
  },
  raw: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 11,
    fontFamily: tokens.fontMono || "monospace",
    marginBottom: 8,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
    marginBottom: 12,
  },
  primary: {
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: tokens.radiusSm || 6,
    border: "none",
    background: tokens.accent || "#4f46e5",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 500,
  },
  secondary: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: tokens.radiusSm || 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bg || "#fff",
    color: tokens.text || "#111",
    cursor: "pointer",
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: tokens.accent || "#4f46e5",
    fontSize: 12,
    cursor: "pointer",
    padding: 0,
  },
  pasteBlock: {
    borderTop: `1px solid ${tokens.border || "#eee"}`,
    paddingTop: 10,
  },
  acpBlock: {
    borderTop: `1px solid ${tokens.border || "#eee"}`,
    paddingTop: 10,
    marginBottom: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  select: {
    fontSize: 12,
    padding: 6,
    borderRadius: tokens.radiusSm || 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
  },
}
