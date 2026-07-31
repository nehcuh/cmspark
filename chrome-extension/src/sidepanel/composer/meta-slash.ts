// UIUX v2 PR4 — slash / chip / 装配 parity (§4.8) + ComposerDock chips (§4.4).
// Pure data + resolvers (no React) so unit tests can lock the matrix.

import type { CapabilityLevel, SkillMeta } from "../types"
import type { ContextPanelId } from "../components/ContextPanelHost"

/** Meta slash action kinds beyond Host panels. */
export type MetaSlashKind =
  | "panel" // open ContextPanelHost by id
  | "compose" // open 装配 section list
  | "settings" // settings slideout
  | "cockpit" // confirm-center window

export type MetaSlashEntry = SkillMeta & {
  /** Discriminator for handleSlashSelect. */
  metaKind: MetaSlashKind
  /** Host panel id when metaKind === "panel". */
  panelId?: ContextPanelId
}

/** §4.8 slash matrix — discoverability for demoted / composition surfaces. */
export const META_PANEL_SLASH: MetaSlashEntry[] = [
  {
    name: "skills",
    description: "打开技能面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "skills",
    metaKind: "panel",
    panelId: "skills",
  },
  {
    name: "knowledge",
    description: "打开知识面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "knowledge",
    metaKind: "panel",
    panelId: "knowledge",
  },
  {
    name: "history",
    description: "打开历史面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "history",
    metaKind: "panel",
    panelId: "history",
  },
  {
    name: "tabs",
    description: "打开标签面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "tabs",
    metaKind: "panel",
    panelId: "tabs",
  },
  {
    name: "packs",
    description: "打开任务包面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "packs",
    metaKind: "panel",
    panelId: "packs",
  },
  {
    name: "mcp",
    description: "打开 MCP 面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "mcp",
    metaKind: "panel",
    panelId: "mcp",
  },
  {
    name: "apps",
    description: "打开应用面板",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash"],
    site: "apps",
    metaKind: "panel",
    panelId: "apps",
  },
  {
    name: "board",
    description: "打开任务板（编排 · 非装配）",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-panel", "meta-slash", "autonomy"],
    site: "board",
    metaKind: "panel",
    panelId: "board",
  },
  {
    name: "settings",
    description: "打开设置",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-settings", "meta-slash"],
    metaKind: "settings",
  },
  {
    name: "cockpit",
    description: "打开确认台",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-cockpit", "meta-slash"],
    metaKind: "cockpit",
  },
  {
    name: "装配",
    description: "打开装配（组合能力入口）",
    type: "prompt_template",
    builtin: true,
    tags: ["meta-compose", "meta-slash"],
    metaKind: "compose",
  },
]

/** Slash command names that open Host panels (excludes settings/cockpit/装配). */
export const SLASH_PANEL_COMMANDS: ReadonlyArray<{
  command: string
  panelId: ContextPanelId
}> = META_PANEL_SLASH.filter((e) => e.metaKind === "panel" && e.panelId).map((e) => ({
  command: e.name,
  panelId: e.panelId!,
}))

/**
 * Composition sections for 装配 drawer (ADR-020 Axis B).
 * Board is Autonomy — never listed here (PR6 / K3).
 */
export type ComposeSectionId =
  | "skills"
  | "knowledge"
  | "packs"
  | "mcp"
  | "apps"
  | "history"

/** Visual group in full 装配 drawer (PR6). */
export type ComposeSectionGroup = "capability" | "connect" | "record"

export type ComposeSection = {
  id: ComposeSectionId
  /** Host panel opened on tap. */
  panelId: ContextPanelId
  /** Short English id label (chip-style). */
  label: string
  /** Product title (ZH) for dense section cards. */
  titleZh: string
  hint: string
  group: ComposeSectionGroup
}

export const COMPOSE_GROUP_LABELS: Record<ComposeSectionGroup, string> = {
  capability: "能力",
  connect: "连接与任务",
  record: "记录",
}

export const COMPOSE_SECTIONS: ComposeSection[] = [
  {
    id: "skills",
    panelId: "skills",
    label: "Skills",
    titleZh: "技能",
    hint: "激活 / 导入 / Craft",
    group: "capability",
  },
  {
    id: "knowledge",
    panelId: "knowledge",
    label: "Knowledge",
    titleZh: "知识",
    hint: "站点 / 全局知识",
    group: "capability",
  },
  {
    id: "packs",
    panelId: "packs",
    label: "Packs",
    titleZh: "任务包",
    hint: "任务包与工作区",
    group: "connect",
  },
  {
    id: "mcp",
    panelId: "mcp",
    label: "MCP",
    titleZh: "MCP",
    hint: "外部工具服务器",
    group: "connect",
  },
  {
    id: "apps",
    panelId: "apps",
    label: "Apps",
    titleZh: "应用",
    hint: "宿主应用白名单（密钥见设置）",
    group: "connect",
  },
  {
    id: "history",
    panelId: "history",
    label: "History",
    titleZh: "历史",
    hint: "本线程操作历史",
    group: "record",
  },
]

/** Surface axis label for §4.5 attach-target copy. */
export function surfaceLxLabel(level: CapabilityLevel): string {
  switch (level) {
    case "chat":
      return "L0 聊"
    case "browser":
      return "L1 网页"
    case "computer":
      return "L2 计算机"
  }
}

/**
 * Per-section attach target (§4.5): Composition attaches to current thread + Surface.
 * Shown on every 装配 section so Composition ≠ deeper agent / Autonomy.
 */
export function composeAttachLine(level: CapabilityLevel): string {
  return `挂到当前线程 · Surface ${surfaceLxLabel(level)}`
}

/** Ordered groups present in COMPOSE_SECTIONS (stable UI order). */
export function composeSectionGroups(): ComposeSectionGroup[] {
  const seen = new Set<ComposeSectionGroup>()
  const order: ComposeSectionGroup[] = []
  for (const s of COMPOSE_SECTIONS) {
    if (!seen.has(s.group)) {
      seen.add(s.group)
      order.push(s.group)
    }
  }
  return order
}

export function composeSectionsInGroup(group: ComposeSectionGroup): ComposeSection[] {
  return COMPOSE_SECTIONS.filter((s) => s.group === group)
}

/** ComposerDock chip action. */
export type ComposerChipAction =
  | { kind: "compose" }
  | { kind: "panel"; panelId: ContextPanelId }
  | { kind: "cockpit" }

export type ComposerChip = {
  id: string
  label: string
  action: ComposerChipAction
  /** Subtle emphasis for 装配 / 确认台 entry chips. */
  primary?: boolean
}

/**
 * Mode-aware chips under composer (§4.4). Max 3; 装配 always present except
 * when 确认台 claims a slot on L2 (装配 still included — total 2).
 * Abort never appears here.
 */
export function composerChipsForLevel(level: CapabilityLevel): ComposerChip[] {
  switch (level) {
    case "chat":
      return [
        { id: "compose", label: "装配", action: { kind: "compose" }, primary: true },
        { id: "skills", label: "Skills", action: { kind: "panel", panelId: "skills" } },
        { id: "knowledge", label: "Know", action: { kind: "panel", panelId: "knowledge" } },
      ]
    case "browser":
      return [
        { id: "compose", label: "装配", action: { kind: "compose" }, primary: true },
        { id: "tabs", label: "Tabs", action: { kind: "panel", panelId: "tabs" } },
        {
          id: "workspace",
          label: "工作区",
          action: { kind: "panel", panelId: "packs" },
        },
      ]
    case "computer":
      return [
        { id: "cockpit", label: "确认台", action: { kind: "cockpit" }, primary: true },
        { id: "compose", label: "装配", action: { kind: "compose" } },
      ]
  }
}

/** Mode-aware composer placeholder (§4.4). */
export function composerPlaceholder(level: CapabilityLevel): string {
  switch (level) {
    case "chat":
      return "问点什么，或 / 装配"
    case "browser":
      return "描述网页任务…"
    case "computer":
      return "排队跟进…（conductor 在确认台）"
  }
}

/** Resolve meta slash skill → action (null if not a meta entry). */
export function resolveMetaSlash(skill: SkillMeta): MetaSlashEntry | null {
  const tags = skill.tags ?? []
  if (!tags.some((t) => t.startsWith("meta-"))) return null

  const byName = META_PANEL_SLASH.find(
    (e) => e.name.toLowerCase() === skill.name.toLowerCase(),
  )
  if (byName) return byName

  // Fallback from tags + site (legacy openers)
  if (tags.includes("meta-compose")) {
    return META_PANEL_SLASH.find((e) => e.metaKind === "compose") ?? null
  }
  if (tags.includes("meta-settings")) {
    return META_PANEL_SLASH.find((e) => e.metaKind === "settings") ?? null
  }
  if (tags.includes("meta-cockpit")) {
    return META_PANEL_SLASH.find((e) => e.metaKind === "cockpit") ?? null
  }
  if (tags.includes("meta-panel") && skill.site) {
    const panelId = skill.site as ContextPanelId
    return (
      META_PANEL_SLASH.find((e) => e.panelId === panelId) ?? {
        ...skill,
        metaKind: "panel" as const,
        panelId,
        tags: [...tags],
      }
    )
  }
  return null
}

/** True if section list never includes board (ontology guard). */
export function composeSectionsExcludeBoard(): boolean {
  return COMPOSE_SECTIONS.every((s) => s.panelId !== "board" && s.id !== ("board" as ComposeSectionId))
}
