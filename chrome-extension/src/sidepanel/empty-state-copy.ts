import type { CapabilityLevel } from "./types"
import { chatShellEmpty, CHAT_SHELL_TITLE_NONE } from "./chat-shell-copy"

export type EmptyInvite =
  | { label: string; fill: string; kind: "fill" }
  | { label: string; action: "compose" | "packs" | "cockpit"; kind: "action" }

export function emptyStateCopy(
  level: CapabilityLevel,
  pageTitle?: string | null,
): {
  title: string
  hint: string
  items: EmptyInvite[]
  pageChip: string | null
} {
  if (level === "computer") {
    return {
      title: CHAT_SHELL_TITLE_NONE,
      hint: "步骤与确认在确认台。",
      items: [],
      pageChip: null,
    }
  }
  const shell = chatShellEmpty(pageTitle ?? null)
  return {
    title: shell.title,
    hint: "",
    items: shell.chips.map((c) => ({ kind: "fill" as const, label: c.label, fill: c.fill })),
    pageChip: shell.pageChip,
  }
}
