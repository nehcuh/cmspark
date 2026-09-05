// Shared visual tokens — consumer assistant canon (看山 quality bar, Comp A).
// White companion surface, indigo spark only on character + armed send.
// Chrome stays 11 / 12 / 13 / 15. Empty greeting is the one 22px exemption.

export const tokens = {
  font:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Helvetica Neue', sans-serif",
  fontMono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",

  // Light companion canvas
  bg: "#ffffff",
  bgElevated: "#ffffff",
  bgMuted: "#f4f4f5",
  bgHover: "#f4f4f5",
  bgActive: "#eef2ff",
  border: "rgba(23, 23, 23, 0.10)",
  borderStrong: "rgba(23, 23, 23, 0.14)",
  text: "#171717",
  textSecondary: "#737373",
  textMuted: "#a3a3a3",
  /** Empty-state hero only — not chrome. */
  emptyTitle: 22,

  // Indigo accent — spark for CTA / focus / user bubble only
  accent: "#4f46e5",
  accentSoft: "#eef2ff",
  accentText: "#3730a3",
  accentHover: "#4338ca",

  /**
   * Brand red (terracotta / brick) — empty-state calf mark ONLY.
   * Independent of the danger family: hue 18° vs danger 0°, lighter,
   * lower-chroma; distinguishable for protanopia/deuteranopia. NEVER reuse
   * danger / dangerSoft / dangerSurface as brand red.
   */
  brandRed: "#c96033",

  success: "#059669",
  successSoft: "#ecfdf5",
  warning: "#d97706",
  warningSoft: "#fffbeb",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",
  /** Soft confirm / FocusBand tint (G3; defined early for one SoT) */
  dangerSurface: "rgba(220, 38, 38, 0.08)",

  // Mode chips (badge only — no full-rail fill on L0/L1)
  modeChatBg: "#f1f5f9",
  modeChatText: "#334155",
  modeBrowserBg: "#eef2ff",
  modeBrowserText: "#3730a3",
  modeComputerBg: "#052e16",
  modeComputerText: "#6ee7b7",
  /** 3–4px accent line under StatusRail when L1/L2 (not full tint fill) */
  modeBrowserLine: "rgba(79, 70, 229, 0.35)",
  modeComputerLine: "rgba(52, 211, 153, 0.45)",

  // Dark surface (L2 / Cockpit)
  darkBg: "#0b0d12",
  darkElevated: "#141820",
  darkBorder: "rgba(255, 255, 255, 0.08)",
  darkText: "#f1f5f9",
  darkMuted: "#94a3b8",
  darkAccent: "#818cf8",
  darkLive: "#34d399",
  darkDanger: "#f87171",
  darkDangerBg: "#3b1f1f",
  darkWarning: "#fbbf24",
  darkWarningBg: "#422006",
  darkSuccess: "#34d399",

  // Chat bubbles
  userBubbleBg: "#4f46e5",
  userBubbleText: "#ffffff",
  assistantBubbleBg: "#ffffff",
  assistantBubbleText: "#0f172a",

  // Motion (Phase 3 — tightened from 150/220)
  transitionFast: "120ms",
  transition: "180ms",

  // Shape: controls 6/8/12; composer matches 看山 invitation (16)
  radiusSm: 6,
  radiusMd: 8,
  radiusLg: 12,
  radiusComposer: 16,
  radiusBubble: 14,
  /** Bottom sheet / 装配 drawer top corners */
  radiusSheet: 16,
  /** Popup menus (StatusRail ⋯ / panel ⋮) */
  radiusMenu: 10,
  radiusPill: 999,

  // One soft elevation ladder — hairline borders do most of the work
  shadowSm: "0 1px 2px rgba(15, 23, 42, 0.04)",
  shadowMd: "0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04)",
  shadowLg: "0 4px 16px rgba(15, 23, 42, 0.08), 0 12px 28px rgba(15, 23, 42, 0.05)",
  shadowFocus: "0 0 0 3px rgba(79, 70, 229, 0.16)",

  /** Modal / drawer scrim */
  scrim: "rgba(15, 23, 42, 0.28)",
} as const

export type Tokens = typeof tokens

/** Risk level → light-surface color (never color-only; pair with text label). */
export function riskColor(level?: string): string {
  if (level === "low") return tokens.warning
  if (level === "medium") return tokens.warning
  return tokens.danger
}

/** Risk level → dark-surface color (SafetyStrip / MinimalConfirm). */
export function riskColorDark(level?: string): string {
  if (level === "low") return tokens.darkWarning
  if (level === "medium") return "#fb923c"
  return tokens.darkDanger
}

export function riskLabel(level?: string): string {
  if (level === "low") return "低风险"
  if (level === "medium") return "中风险"
  return "高风险"
}

/** Tool / task status → semantic color. */
export function statusColor(status?: string): string {
  if (status === "error" || status === "failed") return tokens.danger
  if (status === "success" || status === "ok" || status === "finished") return tokens.success
  if (status === "running" || status === "paused") return tokens.warning
  return tokens.textMuted
}

/** WS connection state — StatusRail / popup dots. Never Material #4CAF50/#FF9800/#F44336. */
export type ConnectionStatus = "connected" | "connecting" | "disconnected"

export function connectionColor(state: ConnectionStatus): string {
  if (state === "connected") return tokens.success
  if (state === "connecting") return tokens.warning
  return tokens.danger
}

export function connectionLabel(state: ConnectionStatus): string {
  if (state === "connected") return "已连接"
  if (state === "connecting") return "连接中"
  return "未连接"
}

/** Soft glow under connected dot (rgba of tokens.success #059669). */
export function connectionDotShadow(state: ConnectionStatus): string {
  if (state === "connected") return "0 0 0 3px rgba(5, 150, 105, 0.18)"
  return "none"
}

/**
 * Connection colors for dark surfaces (Cockpit title bar / L2 chrome).
 */
export function connectionColorDark(state: ConnectionStatus): string {
  if (state === "connected") return tokens.darkLive
  if (state === "connecting") return tokens.darkWarning
  return tokens.darkDanger
}

/** Soft glow under connected dot on dark (rgba of tokens.darkLive #34d399). */
export function connectionDotShadowDark(state: ConnectionStatus): string {
  if (state === "connected") return "0 0 0 3px rgba(52, 211, 153, 0.22)"
  return "none"
}
