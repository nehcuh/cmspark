// 装配 drawer — full Composition section UI (UIUX v2 PR6 / §4.5).
// Opens Host panels; Board / Fleet / multi-worker are Autonomy — never listed.
// Shell via BottomSheet (focus trap + Escape from ui/Modal); landfill
// one-surface rule enforced by parent.
// G4: MD3-ish sheet (radiusSheet + soft scrim) + settings-list groups.

import {
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type RefObject,
} from "react"
import {
  COMPOSE_GROUP_LABELS,
  COMPOSE_SECTIONS,
  composeSectionGroups,
  composeSectionsInGroup,
  type ComposeSection,
  type ComposeSectionGroup,
  type ComposeSectionId,
} from "../composer/meta-slash"
import type { ContextPanelId } from "./ContextPanelHost"
import type { CapabilityLevel } from "../types"
import { tokens } from "../ui/tokens"
import { BottomSheet } from "./ui/BottomSheet"
import {
  IconApps,
  IconChevronRight,
  IconClose,
  IconHistory,
  IconKnowledge,
  IconMcp,
  IconPacks,
  IconSkills,
  type IconProps,
} from "../ui/icons"

const FIRST_SECTION_ID: ComposeSectionId = COMPOSE_SECTIONS[0]?.id ?? "skills"

const SECTION_SCOPE: Record<ComposeSectionId, string> = {
  skills: "管理全局技能；按需用于对话",
  knowledge: "管理知识库；选择本次对话使用的知识",
  packs: "管理场景与专家；选择本对话工作区",
  mcp: "管理全局 MCP 连接",
  apps: "管理全局应用连接",
  history: "查看当前对话的操作记录",
}

const SECTION_ICONS: Record<ComposeSection["id"], ComponentType<IconProps>> = {
  skills: IconSkills,
  knowledge: IconKnowledge,
  packs: IconPacks,
  mcp: IconMcp,
  apps: IconApps,
  history: IconHistory,
}

export type ComposeDrawerProps = {
  open: boolean
  onClose: () => void
  /** Open Host panel and close drawer. */
  onOpenSection: (panelId: ContextPanelId) => void
  /** Accepted for caller compatibility; resource configuration is not Surface-scoped. */
  capabilityLevel?: CapabilityLevel
}

export function ComposeDrawer({
  open,
  onClose,
  onOpenSection,
}: ComposeDrawerProps) {
  const firstBtnRef = useRef<HTMLButtonElement>(null)
  const groups = composeSectionGroups()

  const handleSection = (section: ComposeSection) => {
    // Defense: never open Autonomy surfaces from 装配
    if (section.panelId === "board") return
    onOpenSection(section.panelId)
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="装配"
      initialFocusRef={firstBtnRef as RefObject<HTMLElement>}
    >
      <div data-testid="compose-drawer">
        <div style={styles.header}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.title}>装配</div>
            <div style={styles.subtitle}>
              管理资源与连接，按需用于对话
            </div>
          </div>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭装配"
            data-testid="compose-drawer-close"
          >
            <IconClose size={14} />
          </button>
        </div>

        {groups.map((group) => (
          <SectionGroup
            key={group}
            group={group}
            firstSectionId={FIRST_SECTION_ID}
            firstBtnRef={firstBtnRef}
            onOpen={handleSection}
          />
        ))}

        <p style={styles.footNote} data-testid="compose-autonomy-note">
          任务板可从“资料与工具”或 /board 打开
        </p>
      </div>
    </BottomSheet>
  )
}

function SectionGroup({
  group,
  firstSectionId,
  firstBtnRef,
  onOpen,
}: {
  group: ComposeSectionGroup
  firstSectionId: ComposeSectionId
  firstBtnRef: RefObject<HTMLButtonElement>
  onOpen: (section: ComposeSection) => void
}) {
  const sections = composeSectionsInGroup(group)
  if (sections.length === 0) return null

  return (
    <section style={styles.group} aria-labelledby={`compose-group-${group}`}>
      <h3 id={`compose-group-${group}`} style={styles.groupLabel}>
        {COMPOSE_GROUP_LABELS[group]}
      </h3>
      <ul style={styles.list} role="list">
        {sections.map((section, index) => {
          const Icon = SECTION_ICONS[section.id]
          return (
            <li
              key={section.id}
              style={{
                ...styles.listItem,
                borderTop: index > 0 ? `1px solid ${tokens.border}` : undefined,
              }}
            >
              <SectionRowButton
                section={section}
                Icon={Icon}
                attachLine={SECTION_SCOPE[section.id]}
                buttonRef={section.id === firstSectionId ? firstBtnRef : undefined}
                onOpen={onOpen}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Settings-list row with hover (inline styles cannot use :hover). */
function SectionRowButton({
  section,
  Icon,
  attachLine,
  buttonRef,
  onOpen,
}: {
  section: ComposeSection
  Icon: ComponentType<IconProps>
  attachLine: string
  buttonRef?: RefObject<HTMLButtonElement>
  onOpen: (section: ComposeSection) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      ref={buttonRef}
      type="button"
      style={{
        ...styles.sectionBtn,
        background: hovered ? tokens.bgHover : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={() => onOpen(section)}
      data-testid={`compose-section-${section.id}`}
    >
      <span style={styles.iconWrap} aria-hidden>
        <Icon size={16} />
      </span>
      <span style={styles.sectionBody}>
        <span style={styles.sectionTitleRow}>
          <span style={styles.sectionTitleZh}>{section.titleZh}</span>
          <span style={styles.sectionLabelEn}>{section.label}</span>
        </span>
        <span style={styles.sectionHint}>{section.hint}</span>
        <span style={styles.attachLine}>{attachLine}</span>
      </span>
      <IconChevronRight size={14} style={{ color: tokens.textMuted, flexShrink: 0 }} />
    </button>
  )
}

// Re-export for tests that import section list from drawer path (if any).
export { COMPOSE_SECTIONS }

const styles: Record<string, CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 16px 10px",
  },
  title: {
    fontSize: 16,
    fontWeight: 650,
    color: tokens.text,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: 11,
    color: tokens.textSecondary,
    marginTop: 3,
    lineHeight: 1.4,
  },
  closeBtn: {
    width: 30,
    height: 30,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    cursor: "pointer",
    fontFamily: tokens.font,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  group: {
    margin: 0,
    padding: "0 0 10px",
  },
  groupLabel: {
    margin: "4px 16px 6px",
    fontSize: 10,
    fontWeight: 650,
    color: tokens.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  /** G4: one elevated settings card per group (not a grid of caged buttons) */
  list: {
    listStyle: "none",
    margin: "0 12px",
    padding: 4,
    background: tokens.bg,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusLg,
    boxShadow: tokens.shadowSm,
    overflow: "hidden",
  },
  listItem: {
    margin: 0,
  },
  sectionBtn: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    border: "none",
    borderRadius: tokens.radiusMd,
    background: "transparent",
    padding: "10px 10px",
    cursor: "pointer",
    fontFamily: tokens.font,
    transition: `background ${tokens.transitionFast} ease`,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: tokens.radiusMd,
    background: tokens.accentSoft,
    color: tokens.accentText,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sectionBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  sectionTitleRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
  },
  sectionTitleZh: {
    fontSize: 13,
    fontWeight: 600,
    color: tokens.text,
  },
  sectionLabelEn: {
    fontSize: 10,
    fontWeight: 500,
    color: tokens.textMuted,
  },
  sectionHint: {
    fontSize: 11,
    color: tokens.textSecondary,
    lineHeight: 1.35,
  },
  attachLine: {
    fontSize: 10,
    color: tokens.accentText,
    marginTop: 1,
    lineHeight: 1.3,
  },
  footNote: {
    margin: "4px 16px 0",
    fontSize: 10,
    color: tokens.textMuted,
    lineHeight: 1.4,
  },
}
