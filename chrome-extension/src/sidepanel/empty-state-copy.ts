import type { CapabilityLevel } from "./types"

export type EmptyInvite =
  | { label: string; fill: string; kind: "fill" }
  | { label: string; action: "compose" | "packs" | "cockpit"; kind: "action" }

export function emptyStateCopy(level: CapabilityLevel): {
  title: string
  hint: string
  items: EmptyInvite[]
} {
  if (level === "computer") {
    return {
      title: "从这里跟进，确认在确认台",
      hint: "步骤与确认在确认台。此处可排队跟进。",
      items: [
        { kind: "action", label: "打开确认台", action: "cockpit" },
        { kind: "action", label: "打开装配（技能、场景、知识）", action: "compose" },
      ],
    }
  }
  if (level === "browser") {
    return {
      title: "要对这页做什么？",
      hint: "总结、提问，或让我操作当前标签。",
      items: [
        { kind: "fill", label: "总结当前打开的页面", fill: "请总结当前页面的要点" },
        { kind: "fill", label: "提取这页里我能执行的操作", fill: "列出当前页我可以替你执行的操作" },
        { kind: "action", label: "打开装配（技能、场景、知识）", action: "compose" },
      ],
    }
  }
  return {
    title: "要我帮你做什么？",
    hint: "问问题、写文案，或描述任务。",
    items: [
      { kind: "fill", label: "帮我起草一段说明", fill: "帮我起草一段说明" },
      { kind: "action", label: "打开装配（技能、场景、知识）", action: "compose" },
    ],
  }
}
