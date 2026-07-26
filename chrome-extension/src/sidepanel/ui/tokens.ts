// Shared visual tokens for Side Panel + Cockpit chrome (UI polish 2026-07-26).
// Quiet-professional: soft neutrals, one accent, clear hierarchy — no emoji chrome.

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

  // Mode chips
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

  radiusSm: 6,
  radiusMd: 8,
  radiusLg: 10,
  radiusPill: 999,

  shadowSm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  shadowMd: "0 4px 12px rgba(15, 23, 42, 0.08)",
} as const

export type Tokens = typeof tokens
