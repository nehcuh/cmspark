// Lightweight stroke icons (16×16 default). currentColor for theming.
import type { CSSProperties, ReactNode } from "react"

export type IconProps = {
  size?: number
  style?: CSSProperties
  className?: string
  title?: string
}

function Svg({
  size = 16,
  style,
  className,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0, ...style }}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function IconTabs(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 9v11" />
    </Svg>
  )
}

export function IconHistory(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  )
}

export function IconSkills(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" />
    </Svg>
  )
}

export function IconKnowledge(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5h7a2 2 0 012 2v12a2 2 0 00-2-2H4V5z" />
      <path d="M20 5h-7a2 2 0 00-2 2v12a2 2 0 012-2h7V5z" />
    </Svg>
  )
}

export function IconMcp(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="12" r="3" />
      <circle cx="16" cy="12" r="3" />
      <path d="M11 12h2" />
    </Svg>
  )
}

export function IconApps(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </Svg>
  )
}

export function IconCraft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 4.5l5 5-11 11H3.5v-5l11-11z" />
      <path d="M12 7l5 5" />
    </Svg>
  )
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4v12" />
      <path d="M7 12l5 5 5-5" />
      <path d="M5 20h14" />
    </Svg>
  )
}

export function IconNotebook(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 4h11a2 2 0 012 2v14H8a2 2 0 01-2-2V4z" />
      <path d="M6 16h13" />
      <path d="M9 8h6" />
    </Svg>
  )
}

export function IconSave(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4h11l3 3v13H5V4z" />
      <path d="M8 4v5h8V4" />
      <path d="M8 20v-6h8v6" />
    </Svg>
  )
}

export function IconBrain(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 8a3 3 0 015.2-2 3 3 0 014.3 3.2A3 3 0 0117 15h-1" />
      <path d="M9 8a3 3 0 00-4.5 2.7A3 3 0 007 15h1" />
      <path d="M9 15v2a2 2 0 002 2h2a2 2 0 002-2v-2" />
      <path d="M10 11h4" />
    </Svg>
  )
}

export function IconLogs(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 6h12" />
      <path d="M7 12h12" />
      <path d="M7 18h8" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  )
}

export function IconSend(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12l15-7-4 15-3.5-5.5L4 12z" />
      <path d="M11.5 14.5L19 5" />
    </Svg>
  )
}

export function IconStop(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconAttach(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 7l-6.5 6.5a2.5 2.5 0 103.5 3.5L19 10a4 4 0 10-5.7-5.7L6 11.6a5.5 5.5 0 107.8 7.8L19 14" />
    </Svg>
  )
}

export function IconChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 6h14a2 2 0 012 2v7a2 2 0 01-2 2H10l-4 3v-3H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
    </Svg>
  )
}

export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 010 18" />
      <path d="M12 3a14 14 0 000 18" />
    </Svg>
  )
}

export function IconMonitor(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </Svg>
  )
}

export function IconExternal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <path d="M19 13v5a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1h5" />
    </Svg>
  )
}

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconSpinner(p: IconProps) {
  return (
    <Svg
      {...p}
      style={{
        animation: "cmspark-spin 0.8s linear infinite",
        ...(p.style || {}),
      }}
    >
      <path d="M12 4a8 8 0 018 8" />
      <path d="M12 4a8 8 0 00-8 8" opacity={0.25} />
    </Svg>
  )
}

export function IconMore(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Svg>
  )
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  )
}

/** Mission packs / workspace bundle. */
export function IconPacks(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8l8-4 8 4v9a1 1 0 01-1 1H5a1 1 0 01-1-1V8z" />
      <path d="M12 4v17" />
      <path d="M4 8l8 4 8-4" />
    </Svg>
  )
}

export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M6 15H5a1 1 0 01-1-1V5a1 1 0 011-1h9a1 1 0 011 1v1" />
    </Svg>
  )
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 12a8 8 0 10-2.3 5.5" />
      <path d="M20 6v6h-6" />
    </Svg>
  )
}

export function IconBranch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8" />
      <path d="M6 12h8a2 2 0 002-2V8" />
    </Svg>
  )
}

export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M13 7l4 4" />
    </Svg>
  )
}
