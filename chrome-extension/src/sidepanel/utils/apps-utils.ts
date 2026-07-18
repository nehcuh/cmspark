// App tab (WP4) — pure UI-logic helpers, extracted so the node:test harness
// can exercise them without mounting React components (sidepanel-state.test.ts
// precedent: reducer + hook helpers are tested as pure functions).

import type { AppEntry, AppPolicy } from "../types"

/**
 * Apps error routing (WP6a, WP4+WP5 review Finding 1). The companion tags
 * every apps.* handler error with family:"apps" — route by family so add-flow
 * validation codes (lowercase: duplicate_app, not_an_exe, …) land in the
 * panel's error area instead of the chat stream. APPS_ERROR_CODES remains as
 * the backward-compat fallback for pre-WP6a companions that emitted only the
 * uppercase handler codes without a family tag.
 */
const APPS_ERROR_CODES: ReadonlySet<string> = new Set([
  "INVALID_TOKEN",
  "NOT_FOUND",
  "INVALID_POLICY",
  "INVALID_ENABLED",
  "POLICY_CAP_EXCEEDED",
  "BIOMETRIC_DENIED",
  "NO_CONFIRMATION_CHANNEL",
  "CLI_PHASE2",
  "PRESET_NOT_REMOVABLE",
  "PLATFORM_UNSUPPORTED",
])

export function isAppsErrorMessage(msg: { family?: unknown; code?: unknown; error?: unknown }): boolean {
  if (!msg || typeof msg !== "object") return false
  if (msg.family === "apps") return true
  return typeof msg.code === "string" && APPS_ERROR_CODES.has(msg.code)
}

/**
 * Platform gating (WP6a, Finding 2). The panel learns the companion's
 * platform from the apps.list response. Unknown (pre-WP6a companion) → treat
 * as supported so the UI is never needlessly disabled; anything non-win32 →
 * the add/enumerate flow is hidden behind an honest「仅 Windows 可用」state.
 */
export function appsPlatformSupported(platform: string | null | undefined): boolean {
  if (platform === null || platform === undefined) return true
  return platform === "win32"
}

/**
 * W1 (WP4 follow-up): the inline thread-trust checkbox is offered for
 * host_read (W7 read-only lock) AND host_app launches (owner decision 2,
 * W7 Blocker-1 "app-launch" exception). host_write is NEVER eligible —
 * writes require biometric per call (Q1 ship blocker), even though
 * relevant_apps may be set for it.
 */
export function canOfferThreadTrust(toolName: string | undefined, relevantApp: string | undefined): boolean {
  if (!relevantApp) return false
  return toolName === "host_read" || toolName === "host_app"
}

/**
 * Kind-aware sub-copy for the thread-trust checkbox. The old read-specific
 * 「不影响写操作」 is kept verbatim for host_read; host_app gets launch-scoped
 * wording (the grant covers ONLY L0 no-arg launches of that token).
 */
export function threadTrustHint(toolName: string | undefined): string {
  if (toolName === "host_app") {
    return "（切换会话后失效；仅对启动此应用生效）"
  }
  return "（切换会话后失效；不影响写操作）"
}

export interface PolicyBadge {
  label: string
  color: string
  bg: string
  title: string
}

/**
 * Policy badge — three-color scheme from design §1, with the D3 honesty
 * amendment: "auto" is NEVER labeled as fully automatic; it only skips the
 * confirmation for plain no-arg launches (with-args ops still confirm, and
 * dangerous ops still require Hello).
 */
export function policyBadge(policy: AppPolicy): PolicyBadge {
  switch (policy) {
    case "auto":
      return {
        label: "全自动(仅启动免确认)",
        color: "#b91c1c",
        bg: "#fee2e2",
        title: "仅「无参数启动」免确认；带参数操作仍需确认，危险操作仍需 Hello 验证",
      }
    case "ai":
      return {
        label: "AI 判断",
        color: "#92400e",
        bg: "#fef3c7",
        title: "由 AI 按风险分级决定：只读静默、改状态需确认",
      }
    case "manual":
    default:
      return {
        label: "每次确认",
        color: "#166534",
        bg: "#dcfce7",
        title: "所有操作（含启动）都需人工确认",
      }
  }
}

/**
 * Yellow warning reasons for a card (Owner decision 3 + WP2 review W4):
 * user-writable dir / unsigned / UNC network path. Derived from the exe block
 * — these are also exactly the conditions that cap max_policy at "ai".
 * AUMID entries carry no exe block and get the UWP badge instead.
 */
export function appWarnReasons(entry: Pick<AppEntry, "exe">): string[] {
  const reasons: string[] = []
  const exe = entry.exe
  if (!exe) return reasons
  if (exe.user_writable_dir) reasons.push("同用户进程可替换此文件")
  if (!exe.signer) reasons.push("未签名")
  if (exe.path.startsWith("\\\\") || exe.path.startsWith("//")) reasons.push("网络共享路径")
  return reasons
}

/** Whether the entry may be upgraded to policy "auto" (ceiling from backend). */
export function autoEligible(entry: Pick<AppEntry, "max_policy">): boolean {
  return entry.max_policy === "auto"
}

/** Middle-ellipsis for long exe paths: keep head + tail, drop the middle. */
export function ellipsizePath(p: string, max = 42): string {
  if (p.length <= max) return p
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${p.slice(0, head)}…${p.slice(p.length - tail)}`
}
