// 知识导入确认 sheet — cut out of ChatView.tsx 1:1 (#321 PR-5 Sheet 家族统一).
// Shell migrated from a bare role="dialog" div to the shared BottomSheet
// primitive (ui/Modal underneath): focus trap + Escape + focus restore now
// come from the audited useModalDialog path. Escape/backdrop semantics:
// Escape closes (= 取消: abort extract + clear preview); backdrop click stays
// non-dismissing (backdropDismiss=false) so a mis-click can't drop edited
// title/description/tags. All import semantics are untouched — the confirm
// still sends knowledge.import with user_gesture: true, and force only rides
// along on an explicit 仍导入 click for a flagged duplicate (#293).

import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { fillKnowledgeDraftFromSuggestion, formatKnowledgeTagsInput } from "../utils/knowledge-preview"
import {
  KNOWLEDGE_IMPORT_CONFIRM_LABEL,
  KNOWLEDGE_IMPORT_FORCE_LABEL,
} from "../utils/knowledge-distribution"
import { tokens } from "../ui/tokens"
import { BottomSheet } from "./ui/BottomSheet"

export function KnowledgeImportModal() {
  const { state, dispatch } = useAgentStore()
  const p = state.knowledgePreview
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [pin, setPin] = useState(false)
  // #272 user-dirty (spec §4.3): fields the user edited are never overwritten
  // by late server data (Phase-1 parse reply, Phase-2 LLM suggestion).
  const dirtyRef = useRef<{ title: boolean; description: boolean; tags: boolean }>({
    title: false,
    description: false,
    tags: false,
  })
  // N5/F1: the 「AI 建议」 badge lights only for fields the LLM suggestion
  // actually wrote — a dirty field the suggestion skipped shows no badge.
  const [aiFilled, setAiFilled] = useState<{ description: boolean; tags: boolean }>({
    description: false,
    tags: false,
  })
  const payloadRef = useRef<unknown>(null)
  useEffect(() => {
    if (!p) return
    if (payloadRef.current !== p.payload) {
      // New import request — reset the form from the sentinel.
      payloadRef.current = p.payload
      dirtyRef.current = { title: false, description: false, tags: false }
      setAiFilled({ description: false, tags: false })
      setTitle(p.title || "")
      setDescription(p.description || "")
      // #272: prefill the source file's own frontmatter tags (was setTags("")
      // unconditionally, silently dropping them).
      setTags(formatKnowledgeTagsInput(p.tags))
      setPin(false)
      return
    }
    // Same request, fresh server data (Phase-1 reply): fill untouched fields only.
    if (!dirtyRef.current.title) setTitle(p.title || "")
    if (!dirtyRef.current.description) setDescription(p.description || "")
    if (!dirtyRef.current.tags) setTags(formatKnowledgeTagsInput(p.tags))
  }, [p])
  // #272 Phase 2: the LLM suggestion fills only fields the user hasn't edited.
  const suggested = p?.suggested
  useEffect(() => {
    if (!suggested) return
    const isLlm = suggested.source === "llm"
    const next = fillKnowledgeDraftFromSuggestion({ description, tags }, dirtyRef.current, suggested)
    const filledDescription = isLlm && !dirtyRef.current.description && !!suggested.description
    const filledTags = isLlm && !dirtyRef.current.tags && Array.isArray(suggested.tags) && suggested.tags.length > 0
    setDescription(next.description)
    setTags(next.tags)
    if (filledDescription || filledTags) {
      setAiFilled((cur) => ({
        description: cur.description || filledDescription,
        tags: cur.tags || filledTags,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirtyRef is the guard; re-running on keystrokes would fight the user
  }, [suggested])
  // M4/N2 watchdog: extract_pending armed but the Phase-2 frame never arrives
  // (companion died mid-extract) → local timeout, heuristic draft stays, the
  // confirm button is unaffected.
  const extractId = state.knowledgePreviewExtractId
  useEffect(() => {
    if (!p?.extractPending || !extractId) return
    const timer = setTimeout(() => {
      dispatch({
        type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
        replyId: extractId,
        extractError: "解读超时，已保留草稿",
      })
    }, 17000) // companion's extraction timeout is 15s; +2s RTT margin so a late suggested frame isn't preempted
    return () => clearTimeout(timer)
  }, [p?.extractPending, extractId, dispatch])
  const abortExtract = () => {
    // Abort any in-flight companion extraction (跳过解读/取消/确认) so the
    // 15s LLM call doesn't run to completion for a modal that's gone.
    const id = state.knowledgePreviewExtractId || state.knowledgePreviewPendingId
    if (id) chrome.runtime.sendMessage({ type: "knowledge.preview_cancel", id })
  }
  // Escape → same path as 取消 (abort in-flight extract, drop the preview).
  const cancelImport = () => {
    abortExtract()
    dispatch({ type: "CLEAR_KNOWLEDGE_PREVIEW" })
  }
  const confirmDisabled =
    !p ||
    p.preview === "正在解析…" ||
    p.preview === "正在抓取…" ||
    (p.preview || "").startsWith("预览失败") ||
    !(p.payload && (p.payload.file || p.payload.url || p.payload.content))
  return (
    <BottomSheet
      open={!!p}
      onClose={cancelImport}
      ariaLabel="确认导入知识"
      backdropDismiss={false}
      overlayStyle={{ zIndex: 11000, background: tokens.scrimStrong }}
      sheetStyle={{ padding: 12, maxHeight: "80%" }}
    >
      {p && (
        <>
          <strong style={{ fontSize: 13 }}>确认导入知识库</strong>
          {p.duplicate_of?.title ? (
            <div style={{ fontSize: 11, color: tokens.textSecondary, marginTop: 6 }}>
              内容与已有文档《{p.duplicate_of.title}》完全相同
            </div>
          ) : null}
          {p.extractPending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: tokens.textSecondary, marginTop: 6 }}>
              <span>正在解读…</span>
              <button
                type="button"
                style={styles.btnSecondary}
                onClick={() => {
                  abortExtract()
                  dispatch({ type: "SKIP_KNOWLEDGE_PREVIEW_EXTRACT" })
                }}
              >
                跳过解读
              </button>
            </div>
          )}
          {!p.extractPending && p.extractError && (
            <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 6 }}>AI 解读不可用，已保留草稿，可手动修改后导入</div>
          )}
          <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>标题</label>
          <input value={title} onChange={(e) => { dirtyRef.current.title = true; setTitle(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
          <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
            说明
            {aiFilled.description && <span style={{ marginLeft: 6, fontSize: 10, color: tokens.accent }}>AI 建议</span>}
          </label>
          <input value={description} onChange={(e) => { dirtyRef.current.description = true; setAiFilled((cur) => ({ ...cur, description: false })); setDescription(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
          <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
            标签（逗号分隔）
            {aiFilled.tags && <span style={{ marginLeft: 6, fontSize: 10, color: tokens.accent }}>AI 建议</span>}
          </label>
          <input value={tags} onChange={(e) => { dirtyRef.current.tags = true; setAiFilled((cur) => ({ ...cur, tags: false })); setTags(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 8 }}>
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
            钉到本对话
          </label>
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", background: tokens.bgElevated, padding: 8, marginTop: 8 }}>
            {p.preview || "（无预览）"}
            {p.char_count > (p.preview || "").length ? "\n…" : ""}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
            {(p.preview === "正在解析…" || p.preview === "正在抓取…") && (
              <button
                type="button"
                style={styles.btnSecondary}
                onClick={() => {
                  abortExtract()
                  dispatch({ type: "SKIP_KNOWLEDGE_PREVIEW_PARSE" })
                }}
              >
                跳过解析，手动填写
              </button>
            )}
            <button
              type="button"
              style={styles.btnSecondary}
              onClick={cancelImport}
            >
              取消
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              style={{
                ...styles.btnPrimary,
                ...(confirmDisabled ? { opacity: 0.5, cursor: "default" } : null),
              }}
              onClick={() => {
                abortExtract()
                chrome.runtime.sendMessage({
                  ...p.payload,
                  type: "knowledge.import",
                  user_gesture: true,
                  // #293: preview flagged an exact duplicate — only an explicit
                  // 仍导入 click carries force past the server-side gate.
                  force: p.duplicate_of ? true : undefined,
                  title,
                  description,
                  tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
                  pin_thread_id: pin ? state.activeThreadId : undefined,
                })
                dispatch({ type: "CLEAR_KNOWLEDGE_PREVIEW" })
              }}
            >
              {p.duplicate_of ? KNOWLEDGE_IMPORT_FORCE_LABEL : KNOWLEDGE_IMPORT_CONFIRM_LABEL}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}

const styles: Record<string, CSSProperties> = {
  btnSecondary: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    background: tokens.bgElevated,
    color: tokens.text,
    fontSize: 12,
    padding: "4px 12px",
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  btnPrimary: {
    border: "none",
    borderRadius: tokens.radiusMd,
    background: tokens.accent,
    color: tokens.userBubbleText,
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 14px",
    cursor: "pointer",
    fontFamily: tokens.font,
  },
}
