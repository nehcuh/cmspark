// Composer /slash and @thread tokens — cut out of App.tsx InputArea in #321 PR-7.
// Pure move: detect + select handlers + virtual slash entries.

import { useCallback, useState } from "react"
import type { SkillMeta } from "../types"
import { useAgentStore } from "../store/agentStore"
import { useContextPanelHost } from "../components/ContextPanelHost"
import {
  META_PANEL_SLASH,
  resolveMetaSlash,
} from "../composer/meta-slash"
import type { AtThreadChoice } from "../components/AtThreadPopover"
import { escapeRegExp } from "../components/ThreadRefChips"

export type UseComposerMentionsOpts = {
  text: string
  setText: (value: string | ((prev: string) => string)) => void
  textareaRef: { current: HTMLTextAreaElement | null }
  openCompose: () => void
  setComposeOpen: (open: boolean) => void
}

export function useComposerMentions({
  text,
  setText,
  textareaRef,
  openCompose,
  setComposeOpen,
}: UseComposerMentionsOpts) {
  const { state, dispatch } = useAgentStore()
  const { openPanelForce, closePanel } = useContextPanelHost()
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashQuery, setSlashQuery] = useState("")
  const [atVisible, setAtVisible] = useState(false)
  const [atQuery, setAtQuery] = useState("")
  const [threadRefs, setThreadRefs] = useState<AtThreadChoice[]>([])

  // Detect slash command: check if cursor is after a "/" at start or after space
  const detectSlash = useCallback((value: string, cursorPos: number) => {
    // Find the last "/" before cursor
    const beforeCursor = value.substring(0, cursorPos)
    const slashIdx = beforeCursor.lastIndexOf("/")

    if (slashIdx === -1) {
      setSlashVisible(false)
      return
    }

    // Check character before "/" — must be start of string or whitespace
    const charBefore = slashIdx === 0 ? null : value[slashIdx - 1]
    if (charBefore !== null && charBefore !== " " && charBefore !== "\n") {
      setSlashVisible(false)
      return
    }

    // Extract query: everything after "/" up to cursor position (no spaces → still typing)
    const query = beforeCursor.substring(slashIdx + 1)
    if (query.includes(" ") || query.includes("\n")) {
      setSlashVisible(false)
      return
    }
    setSlashQuery(query)
    setSlashVisible(true)
    setAtVisible(false)
  }, [])

  // Detect @ thread ref (P1.5)
  const detectAt = useCallback((value: string, cursorPos: number) => {
    const beforeCursor = value.substring(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf("@")
    if (atIdx === -1) {
      setAtVisible(false)
      return
    }
    const charBefore = atIdx === 0 ? null : value[atIdx - 1]
    if (charBefore !== null && charBefore !== " " && charBefore !== "\n") {
      setAtVisible(false)
      return
    }
    const query = beforeCursor.substring(atIdx + 1)
    // stop if user finished the token with space
    if (query.includes(" ") || query.includes("\n") || query.includes("」")) {
      setAtVisible(false)
      return
    }
    setAtQuery(query)
    setAtVisible(true)
    setSlashVisible(false)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setText(newValue)
    // Dual-review residual: drop chips whose @「title」 token was deleted from text
    setThreadRefs((prev) =>
      prev.filter((r) => newValue.includes(`@「${r.title}」`) || newValue.includes(`@${r.id}`)),
    )
    const pos = e.target.selectionStart || 0
    detectSlash(newValue, pos)
    detectAt(newValue, pos)
  }

  const clearSlashToken = (slashIdx: number, cursorPos: number) => {
    const afterCursor = text.substring(cursorPos)
    const newText = (text.substring(0, slashIdx) + afterCursor).replace(/\s+$/, " ").trimStart()
    setText(newText)
    setSlashVisible(false)
  }

  const handleAtSelect = (choice: AtThreadChoice) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursorPos = textarea.selectionStart || 0
    const beforeCursor = text.substring(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf("@")
    if (atIdx < 0) return
    const afterCursor = text.substring(cursorPos)
    const insert = `@「${choice.title}」 `
    const newText = text.substring(0, atIdx) + insert + afterCursor
    setText(newText)
    setAtVisible(false)
    setThreadRefs((prev) => {
      if (prev.some((r) => r.id === choice.id)) return prev
      return [...prev, choice].slice(0, 8)
    })
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      const pos = atIdx + insert.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const handleSlashSelect = (skill: SkillMeta) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart || 0
    const beforeCursor = text.substring(0, cursorPos)

    // Find the "/" that started this command
    const slashIdx = beforeCursor.lastIndexOf("/")
    if (slashIdx === -1) return

    // PR4 §4.8: meta slash parity (Host / 装配 / settings / 确认台)
    const meta = resolveMetaSlash(skill)
    if (meta) {
      clearSlashToken(slashIdx, cursorPos)
      if (meta.metaKind === "compose") {
        openCompose()
        return
      }
      if (meta.metaKind === "settings") {
        setComposeOpen(false)
        closePanel()
        dispatch({ type: "SET_SETTINGS_OPEN", open: true })
        return
      }
      if (meta.metaKind === "cockpit") {
        setComposeOpen(false)
        chrome.runtime.sendMessage({ type: "cockpit.open" }, () => {
          void chrome.runtime.lastError
        })
        return
      }
      if (meta.metaKind === "coding_handoff") {
        setComposeOpen(false)
        window.dispatchEvent(new CustomEvent("cmspark:open-coding-handoff", { detail: {} }))
        return
      }
      if (meta.metaKind === "panel" && meta.panelId) {
        setComposeOpen(false)
        dispatch({ type: "SET_SETTINGS_OPEN", open: false })
        openPanelForce(meta.panelId)
        return
      }
      // Legacy site-based open
      if (skill.site) {
        window.dispatchEvent(
          new CustomEvent("cmspark:open-context-panel", { detail: { panel: skill.site } }),
        )
      }
      return
    }

    // Replace from "/" to cursor with "/skill-name "
    const afterCursor = text.substring(cursorPos)
    const newText = text.substring(0, slashIdx) + "/" + skill.name + " " + afterCursor
    const newCursorPos = slashIdx + skill.name.length + 2 // after "/name "

    setText(newText)
    setSlashVisible(false)

    // Set cursor position after the inserted text
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  // §4.8 virtual slash entries + real skills
  const slashSkills: SkillMeta[] = [
    ...META_PANEL_SLASH,
    ...(Array.isArray(state.skills) ? state.skills : []),
  ]

  const dismissThreadRef = useCallback((id: string) => {
    const r = threadRefs.find((x) => x.id === id)
    setThreadRefs((prev) => prev.filter((x) => x.id !== id))
    if (!r) return
    setText((t) =>
      t
        .replace(new RegExp(`@「${escapeRegExp(r.title)}」\\s*`, "g"), "")
        .replace(new RegExp(`@${escapeRegExp(r.id)}\\s*`, "g"), ""),
    )
  }, [threadRefs, setText])

  return {
    slashVisible,
    setSlashVisible,
    slashQuery,
    atVisible,
    setAtVisible,
    atQuery,
    threadRefs,
    setThreadRefs,
    slashSkills,
    detectSlash,
    detectAt,
    handleChange,
    handleAtSelect,
    handleSlashSelect,
    dismissThreadRef,
  }
}
