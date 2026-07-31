// Shared visual tokens for Side Panel + Cockpit chrome (P2 polish 2026-07-27).
// Quiet-professional: soft neutrals, one accent, clear hierarchy — no emoji chrome.
// Acceptance: no new Material Design hexes (#4A90D9 / #F44336 / …); use these tokens.

export const tokens = {
  font:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  fontMono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",

  // Light surface (Side Panel)
  bg: "#fafbfc",
  bgElevated: "#ffffff",
  bgMuted: "#f3f4f6",
  bgHover: "#eef2f7",
  bgActive: "#e8f0fe",
  border: "#e5e7eb",
  borderStrong: "#d1d5db",
  text: "#111827",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",

  accent: "#2563eb",
  accentSoft: "#dbeafe",
  accentText: "#1e40af",

  success: "#16a34a",
  successSoft: "#dcfce7",
  warning: "#d97706",
  warningSoft: "#fef3c7",
  danger: "#dc2626",
  dangerSoft: "#fee2e2",

  // Mode chips / header tints
  modeChatBg: "#f3f4f6",
  modeChatText: "#374151",
  modeBrowserBg: "#dbeafe",
  modeBrowserText: "#1e40af",
  modeComputerBg: "#052e16",
  modeComputerText: "#4ade80",

  // Dark surface (L2 SafetyStrip / Cockpit)
  darkBg: "#0f1115",
  darkElevated: "#161a22",
  darkBorder: "#2a2f3a",
  darkText: "#e8eaed",
  darkMuted: "#9aa0a6",
  darkAccent: "#5b8def",
  darkLive: "#4ade80",
  darkDanger: "#f87171",
  darkDangerBg: "#3b1f1f",
  darkWarning: "#fbbf24",
  darkWarningBg: "#422006",
  darkSuccess: "#4ade80",

  // Chat bubbles
  userBubbleBg: "#2563eb",
  userBubbleText: "#ffffff",
  assistantBubbleBg: "#f3f4f6",
  assistantBubbleText: "#111827",

  // Motion
  transitionFast: "150ms",
  transition: "200ms",

  radiusSm: 6,
  radiusMd: 8,
  radiusLg: 12,
  radiusPill: 999,

  shadowSm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  shadowMd: "0 4px 12px rgba(15, 23, 42, 0.08)",
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

/** Soft glow under connected dot (rgba of tokens.success #16a34a). */
export function connectionDotShadow(state: ConnectionStatus): string {
  if (state === "connected") return "0 0 0 3px rgba(22, 163, 74, 0.15)"
  return "none"
}
