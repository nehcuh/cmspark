// L2 security admission gate for createToolExecutor.
// Extracted from server.ts (C10 Phase B mechanical split) — zero behavior change.
//
// FREEZE: L2 forceConfirm / three-flag / enterprise-skip / G1 algebra lives HERE.
// Do NOT re-inflate createToolExecutor with this block.
// Cookie + URL gates → tool/url-cookie-admission.ts (C10-C).

import { randomUUID } from "crypto"
import os from "os"
import { WebSocket } from "ws"
import { getConfig } from "../config"
import { securityPolicy, SecurityPolicy } from "../security-policy"
import { logger } from "../logger"
import {
  checkHighRiskExecution,
  highRiskExecutionDeniedError,
  isAutoApprovedDomain,
  detectCriticalApis,
} from "../security"
import {
  SecurityConfirmationManager,
  type SecurityConfirmationDecision,
  DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS,
} from "../security-confirmation"
import { getTrayInstance } from "../menu-bar-agent"
import type { TrayConfirmRequest } from "../tray/tray-adapter"
import {
  enterpriseSessionTrust,
  resolveEnterpriseTrustKey,
  familyOfTool,
  netsecScopeFingerprint,
  type EnterpriseToolFamily,
} from "../capability/enterprise-session-trust"
import { checkNetsecScope } from "../netsec/scope"
import { settingsRequiredResult } from "../capability/settings-pointer"
import { checkShellScope } from "../capability/shell"
import { getModule, isModuleEnabled } from "../capability/modules"
import { getThreadApprovals } from "../host-use/thread-approvals"
import { APP_TOKEN_PATTERN, type AppEntry, type AppPolicy } from "../apps/types"
import {
  OSASCRIPT_MACOS_ONLY_ERROR,
  shouldL2GateOsascript,
} from "../bridge/tool-definitions"
import {
  OSASCRIPT_TARGET_ERROR,
  canonicalizeOsascriptUrl,
  resolveOsascriptPageUrl,
} from "./osascript-bind"
import { getCachedTabUrl } from "../ws/tab-url-cache"
import { getComputerTaskAbortRegistry } from "../computer/task-abort-registry"
import { resolveAcpThreadId } from "../acp/thread-id"
import type { ThreadManager } from "../threads/thread-manager"
import type { InjectionRateLimiter } from "../computer/rate-limit"
import {
  resolveConfirmBinding,
  fanOutConfirmRequest,
  pickExtensionWsFromAuth,
  isSummonerSurface,
  type ConfirmPeerAuth,
} from "../mcp/confirm-fanout"
import { ensureExtensionPeerForOverlayConfirm } from "../ws/extension-peer"

/** Tools that require L2 security_token issuance (or evaluate token revalidate). */
export const L2_GATE_TOOLS: readonly string[] = [
  "evaluate",
  "osascript_eval",
  "host_read",
  "host_write",
  "shell_exec",
  "netsec_port_scan",
  // ADR-015: real HITL — LLM cannot self-approve spawn/ask via user_confirmed flag
  "spawn_worker",
  "ask_user",
  // ADR-016 G5/G6/G9: board_complete requires Confirm Center + canComplete
  "board_complete",
  // S41 multi-adv: durable skill-library write (content/path/zip) — L2 + forceConfirm
  "skill_install",
  // ADR-025 ACP coding handoff — spawn/start always HITL
  "acp_propose_session",
  "acp_start_session",
  "acp_apply_diff",
]

/** ADR-025: ACP tools always force L2 (never waived by cruise / god-mode). */
export function isAcpL2ForceTool(toolName: string): boolean {
  return (
    toolName === "acp_propose_session" ||
    toolName === "acp_start_session" ||
    toolName === "acp_apply_diff"
  )
}

/**
 * Pure forceConfirm algebra (extract for unit tests).
 * ACP tools always true; other capability/host gates waived only under full-autonomy cruise.
 */
export function resolveL2ForceConfirm(opts: {
  toolName: string
  capabilityForceConfirm: boolean
  hostComputerGated?: boolean
  userFullAutonomy: boolean
  /** Chrome/Safari one-shot pixel CU — never waived by 三旗巡航. */
  vaultBrowserOneShot?: boolean
}): boolean {
  if (isAcpL2ForceTool(opts.toolName)) return true
  if (opts.vaultBrowserOneShot && opts.hostComputerGated) return true
  return (
    (opts.capabilityForceConfirm || !!opts.hostComputerGated) && !opts.userFullAutonomy
  )
}

/** Three-flag full autonomy cruise (dangerous + enterprise + allow_all_schemes). */
export function isFullAutonomyCruise(security: {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}): boolean {
  return (
    security.auto_approve_dangerous === true &&
    security.auto_approve_enterprise_tools === true &&
    security.allow_all_schemes === true
  )
}

export function isHostComputerPlatformGated(platform: string): boolean {
  return platform === "win32" || platform === "darwin"
}

export function isHostAppPlatformGated(platform: string): boolean {
  return platform === "win32" || platform === "darwin"
}

export function isHostCliPlatformGated(platform: string): boolean {
  return platform === "win32" || platform === "darwin"
}

/**
 * G1 / unattended initial-skip algebra must not run for vault-browser one-shot.
 * Pin this rather than a set-then-wipe (Trust T-02 / runtime P1).
 */
export function hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot: boolean): boolean {
  return vaultBrowserOneShot !== true
}

/** G1 checkbox: never offer session-trust on a vault-browser one-shot L2. */
export function hostComputerConfirmRelevantApps(
  vaultBrowserOneShot: boolean,
  app: unknown,
): string[] {
  if (vaultBrowserOneShot) return []
  return typeof app === "string" && app.length > 0 ? [app] : []
}

// Phase 1 W7 — resolve app token from host_read/host_write params for
// thread-scoped trust + relevantApps in confirmation dialog.
// Phase 1 W8-windows: platform-aware defaults (win32 uses win.* tokens).
function resolveHostUseApp(toolName: string, params: any): string {
  const isWin = os.platform() === "win32"
  if (toolName === "host_read") {
    const app = typeof params?.application === "string" ? params.application : ""
    if (app) return app
    // Phase 0 default when application omitted.
    return isWin ? "win.outlook.classic" : "com.apple.mail"
  }
  if (toolName === "host_write") {
    const kind = typeof params?.kind === "string" ? params.kind : ""
    if (kind === "create") return isWin ? "win.onenote.desktop" : "com.apple.Notes"
    if (kind === "move") return isWin ? "win.fs" : "com.apple.finder"
    return ""
  }
  return ""
}

export type L2AdmissionContext = {
  toolName: string
  finalParams: Record<string, any>
  toolCallId: string
  startedAt: number
  ws: WebSocket
  sessionId: string
  actingThreadId?: string
  isOutboundMcpCall: boolean
  logToolFinish: (
    toolCallId: string,
    toolName: string,
    startedAt: number,
    result: any,
  ) => void
  securityConfirmations: SecurityConfirmationManager
  getThreadManager: () => ThreadManager
  getCachedTabUrl: (tabId: number | null | undefined) => string | undefined
  getDomainFromUrl: (url: string) => string
  computerRateLimiter: () => Promise<InjectionRateLimiter>
  /** C-P0-6: tray confirm ids per WS for disconnect cancel */
  activeTrayConfirmsByWs: WeakMap<WebSocket, Set<string>>
  /** Live WS peers for outbound MCP confirm fan-out */
  clients: Set<WebSocket>
  /** Auth lookup for fan-out (authenticated peers only). `surface` drives overlay bind. */
  wsAuthGet: (ws: WebSocket) => ConfirmPeerAuth | undefined
}

export type L2AdmissionResult =
  | {
      ok: true
      finalParams: Record<string, any>
      winL2NonceChallenge?: string
      hostAppTier?: string
    }
  | {
      ok: false
      result: { success: false; error: string; data?: any }
    }

/**
 * Run L2 gate for tools that require security_token (or evaluate token revalidate).
 * On ok:false, caller must return result immediately (already logToolFinish'd inside when appropriate — match current code).
 */
export async function runL2ToolAdmission(ctx: L2AdmissionContext): Promise<L2AdmissionResult> {
  let finalParams = ctx.finalParams
  const toolName = ctx.toolName
  const toolCallId = ctx.toolCallId
  const startedAt = ctx.startedAt
  const ws = ctx.ws
  const sessionId = ctx.sessionId
  const actingThreadId = ctx.actingThreadId
  const isOutboundMcpCall = ctx.isOutboundMcpCall
  const logToolFinish = ctx.logToolFinish
  const securityConfirmations = ctx.securityConfirmations
  const getCachedTabUrl = ctx.getCachedTabUrl
  const getDomainFromUrl = ctx.getDomainFromUrl
  const computerRateLimiter = ctx.computerRateLimiter
  const activeTrayConfirmsByWs = ctx.activeTrayConfirmsByWs
  const clients = ctx.clients
  // Match server.ts name `wsAuth.get(...)` in the extracted body
  const wsAuth = { get: ctx.wsAuthGet }
  const threadManager = ctx.getThreadManager()
  const computerTaskAbort = getComputerTaskAbortRegistry()

  // ADR-025: normalize mode + workspace into finalParams so L2 preview, token
  // binding, and dispatch validateTokenFor share one binding surface.
  if (toolName === "acp_propose_session") {
    const tid = resolveAcpThreadId(finalParams, actingThreadId)
    const thread = tid ? (threadManager.get(String(tid)) as { workspace_root?: string } | null) : null
    const mode = finalParams.mode === "propose_diff" ? "propose_diff" : "review_readonly"
    const workspace_root = String(
      thread?.workspace_root || finalParams.workspace_root || finalParams.workspace || "",
    )
    finalParams = { ...finalParams, mode, workspace_root }
  }
  if (toolName === "acp_apply_diff") {
    finalParams = {
      ...finalParams,
      allow_delete: finalParams.allow_delete === true,
    }
  }

  // Phase 1 W8-windows (adversary amendment A3): when a host_write L2
  // dialog will show on win32 and Windows Hello is unavailable, the
  // manual-nonce challenge rides INSIDE this same dialog. Declared here so
  // the executor can consume the prevalidated nonce after approval.
  let winL2NonceChallenge: string | undefined
  // App tab WP3: the tier this host_app call took through the gate
  // ("l2" | "app_whitelist" | "thread_trust" | "god_mode" | "global_toggle"),
  // forwarded to the executor for the apps.launch audit event.
  let hostAppTier: string | undefined

  // IIFE preserves original early-return shape ({ success:false, error, data? }).
  // Success falls through with null/undefined. Return type is any so inferred
  // `{ success: boolean }` literals from the original body typecheck (zero-diff).
  const earlyResult = await (async (): Promise<any> => {
  // L2_GATE_TOOLS: module-level export
  const hostAppGated = toolName === "host_app" && isHostAppPlatformGated(os.platform())
  const hostCliGated = toolName === "host_cli" && isHostCliPlatformGated(os.platform())
  // Coordinate computer-use (WP1): critical-class — the task-level L2 dialog
  // is originWs-bound, and input injection is NEVER thread-trusted. God-mode
  // alone / auto_approve alone still forceConfirm; only three-flag
  // userFullAutonomy waives forceConfirm (same algebra as other critical tools).
  // Session-trust / unattended grant may skip initial L2 via hostComputerTrustSkip
  // (designed carve-out, not god-mode). Off win32 or darwin the gate is skipped
  // so the executor returns the typed platform error.
  const hostComputerGated = toolName === "host_computer" &&
    isHostComputerPlatformGated(os.platform())
  // P0 platform filter: osascript_eval is macOS-only. Fail before L2 confirmation
  // so Windows/Linux never show a pointless confirm dialog (same idea as hostAppGated
  // skipping off-platform). Defense-in-depth still remains in executeCompanionTool.
  if (toolName === "osascript_eval" && !shouldL2GateOsascript(os.platform())) {
    const result = { success: false, error: OSASCRIPT_MACOS_ONLY_ERROR }
    logToolFinish(toolCallId, toolName, startedAt, result)
    return result
  }
  if (toolName === "osascript_eval") {
    if (finalParams.security_token) {
      const bound = canonicalizeOsascriptUrl(String(finalParams.url || ""))
      if (!bound) {
        const result = { success: false, error: OSASCRIPT_TARGET_ERROR }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      finalParams = { ...finalParams, url: bound }
    } else {
      const resolved = resolveOsascriptPageUrl(finalParams, getCachedTabUrl)
      if ("error" in resolved) {
        const result = { success: false, error: resolved.error }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      finalParams = { ...finalParams, url: resolved.url }
    }
  }
  if ((L2_GATE_TOOLS.includes(toolName) || hostAppGated || hostCliGated || hostComputerGated) && !finalParams.security_token) {
    // shell_exec / netsec use command|targets for L2 preview text (not code/expression).
    // spawn_worker / ask_user use role/question summaries for the Confirm Center.
    // C7/C8: shell preview includes cwd; netsec includes ports summary (post-normalize).
    const code = String(
      (toolName === "shell_exec"
        ? `command=${finalParams.command || ""} cwd=${finalParams.cwd || ""}`
        : null) ||
        (toolName === "netsec_port_scan"
          ? `targets=${Array.isArray(finalParams.targets) ? finalParams.targets.join(", ") : ""} ports=${Array.isArray(finalParams.ports) ? finalParams.ports.join(",") : ""}`
          : null) ||
        (toolName === "osascript_eval"
          ? `url=${finalParams.url || ""} tabId=${finalParams.tabId ?? ""} expr=${String(finalParams.expression || finalParams.code || "")}`
          : null) ||
      finalParams.code ||
        finalParams.expression ||
        finalParams.command ||
        (Array.isArray(finalParams.targets) ? finalParams.targets.join(", ") : "") ||
        (toolName === "spawn_worker"
          ? `Spawn worker role=${finalParams.role_label || finalParams.roleLabel || "worker"} alias=${finalParams.alias || ""} pack=${finalParams.pack_id || "none"} allow=${Array.isArray(finalParams.tool_allow) ? finalParams.tool_allow.join(",") : "default"} deny=${Array.isArray(finalParams.tool_deny) ? finalParams.tool_deny.join(",") : "default"} intent=${finalParams.intent_id || ""}`
          : "") ||
        (toolName === "ask_user" ? String(finalParams.question || finalParams.prompt || "") : "") ||
        (toolName === "host_cli"
          ? `host_cli app=${finalParams.app || ""} sub=${finalParams.subcommand || ""}`
          : "") ||
        (toolName === "board_complete"
          ? `board_complete empty_complete=${!!finalParams.empty_complete} supporting=${Array.isArray(finalParams.supporting_fact_ids) ? finalParams.supporting_fact_ids.join(",") : ""} residual=${Array.isArray(finalParams.residual_risks) ? finalParams.residual_risks.slice(0, 3).join(" | ") : ""} reason=${finalParams.empty_complete_reason || finalParams.goal_summary || ""}`
          : "") ||
        (toolName === "skill_install"
          ? (() => {
              try {
                // Lazy require keeps createToolExecutor load light; preview is best-effort.
                const {
                  skillInstallOverwritePreview,
                  classifySkillInstallSource,
                  expandUserPath,
                } = require("../skills/skill-install") as typeof import("../skills/skill-install")
                const prev = skillInstallOverwritePreview(finalParams)
                let tier = ""
                const srcRaw = finalParams.path || finalParams.zip_path
                if (srcRaw && typeof srcRaw === "string") {
                  try {
                    const fs = require("fs") as typeof import("fs")
                    const pathMod = require("path") as typeof import("path")
                    const resolved = fs.realpathSync(pathMod.resolve(expandUserPath(srcRaw)))
                    tier = classifySkillInstallSource(resolved)
                  } catch {
                    tier = "unresolved"
                  }
                } else if (finalParams.content) {
                  tier = "content"
                }
                const errPart = prev.error
                  ? ` preview_error=${String(prev.error).slice(0, 200)}`
                  : ""
                return `skill_install path=${finalParams.path || ""} zip=${finalParams.zip_path || ""} content_len=${typeof finalParams.content === "string" ? finalParams.content.length : 0} name=${prev.name || ""} overwrite=${prev.overwrite ? "true" : "false"} dest=${prev.dest_path || ""} source_tier=${tier}${errPart}`
              } catch {
                return `skill_install path=${finalParams.path || ""} zip=${finalParams.zip_path || ""} content_len=${typeof finalParams.content === "string" ? finalParams.content.length : 0}`
              }
            })()
          : "") ||
        (toolName === "acp_propose_session"
          ? `acp_propose agent=${finalParams.agent_id || finalParams.agent || ""} mode=${finalParams.mode === "propose_diff" ? "propose_diff" : "review_readonly"} workspace=${String(finalParams.workspace_root || finalParams.workspace || "").slice(0, 120)} goal=${String(finalParams.goal || finalParams.prompt || "").slice(0, 200)}`
          : "") ||
        (toolName === "acp_start_session"
          ? `acp_start session_id=${finalParams.session_id || ""}`
          : "") ||
        (toolName === "acp_apply_diff"
          ? `acp_apply session_id=${finalParams.session_id || ""} paths=${Array.isArray(finalParams.paths) ? finalParams.paths.join(",") : "all"} allow_delete=${finalParams.allow_delete === true ? "yes" : "no"}`
          : "") ||
        "",
    )
    // skill_install: hard-deny multi-SKILL.md / outside source zone BEFORE L2 dialog
    // (user home is allowed — L2 is the authorization; no pointless confirm then fail).
    if (toolName === "skill_install") {
      try {
        const {
          isSkillInstallSourceAllowed,
          expandUserPath,
          skillInstallSourceDeniedError,
          skillInstallOverwritePreview,
        } = require("../skills/skill-install") as typeof import("../skills/skill-install")
        // Surface multi-skill zip failure before confirm (R2 nit: empty name was awkward).
        if (
          typeof finalParams.zip_path === "string" &&
          finalParams.zip_path.trim()
        ) {
          const prev = skillInstallOverwritePreview(finalParams)
          if (prev.error) {
            const result = {
              success: false as const,
              error: prev.error,
              data: {
                error_code: "SKILL_INSTALL_PREVIEW_FAILED",
                candidates: prev.candidates || [],
                hint_zh:
                  "ZIP 含多个 SKILL.md 或无法解析安装目标。请解压后 skill_install({ path: 单个 skills/<name> 目录 })。",
              },
            }
            logToolFinish(toolCallId, toolName, startedAt, result)
            return result
          }
        }
        const fs = require("fs") as typeof import("fs")
        const pathMod = require("path") as typeof import("path")
        const srcField =
          typeof finalParams.path === "string" && finalParams.path.trim()
            ? ("path" as const)
            : typeof finalParams.zip_path === "string" && finalParams.zip_path.trim()
              ? ("zip_path" as const)
              : null
        if (srcField) {
          const raw = String(finalParams[srcField])
          try {
            const resolved = fs.realpathSync(pathMod.resolve(expandUserPath(raw)))
            if (!isSkillInstallSourceAllowed(resolved)) {
              const denied = skillInstallSourceDeniedError(srcField)
              const result = {
                success: false,
                error: denied.error,
                data: { hint_zh: denied.hint_zh },
              }
              logToolFinish(toolCallId, toolName, startedAt, result)
              return result
            }
          } catch {
            // Missing path: let executor return path-not-found after L2 or fail here without dialog
            const result = {
              success: false,
              error: `${srcField} not found: ${raw}`,
            }
            logToolFinish(toolCallId, toolName, startedAt, result)
            return result
          }
        }
      } catch {
        /* preview/precheck best-effort — executor still enforces */
      }
    }
    const lengthCheck = securityPolicy.checkLength(toolName, code)
    if (!lengthCheck.ok) {
      const result = { success: false, error: lengthCheck.error }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }

    // Resolve acting domain so we can skip the confirmation dialog when the
    // user has whitelisted the domain (or enabled the global auto-approve).
    // evaluate({tabId}) → resolve via tabUrlCache. osascript_eval is EXCLUDED
    // from domain-based auto-approval: it is a fixed AppleScript wrapper that
    // only executes the supplied JS expression inside a Chrome tab via
    // `execute t javascript` (see the osascript_eval template below + §6.2) —
    // NOT arbitrary host AppleScript (no `do shell script`/keychain/Finder).
    // Its `url` parameter only locates a Chrome tab, not a meaningful trust
    // anchor, so whitelisting it by URL would let an attacker hide a
    // destructive JS payload behind a whitelisted URL. osascript_eval still
    // respects the global auto_approve_dangerous toggle (explicit user opt-in
    // for unattended workflows).
    const relevantDomain = toolName === "evaluate"
      ? getDomainFromUrl(getCachedTabUrl(finalParams.tabId) || "")
      : ""
    // Phase 1 W7 — relevant app for host_read/host_write (bundle id).
    // Used to populate inline-checkbox trust option in confirmation dialog.
    const relevantApp = (toolName === "host_read" || toolName === "host_write")
      ? resolveHostUseApp(toolName, finalParams)
      : ""

    // App tab WP3 — host_app policy resolution. The tier decision is made
    // HERE (the gate), never by the LLM and never from a tool param:
    //   apps.enabled kill-switch → typed error (no dialog)
    //   unknown token / disabled entry / non-gui kind / bad action → typed error
    //   policy "auto"   → skip L2 (L0 no-arg launch only), audit app_whitelist
    //   policy "ai"     → first launch in thread: L2 WITH trust checkbox;
    //                     trusted thread: skip (kind "app-launch", owner decision 2)
    //   policy "manual" → always L2, NO trust checkbox offered
    let hostApp: { token: string; entry: AppEntry; policy: AppPolicy } | null = null
    if (hostAppGated) {
      const appToken = String(finalParams.app || "")
      const action = String(finalParams.action || "")
      const fail = (error: string) => {
        const result = { success: false, error }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      if (!APP_TOKEN_PATTERN.test(appToken)) {
        return fail(`host_app: invalid app token "${appToken}" (expected [win|mac].app.<slug> / [win|mac].cli.<slug>)`)
      }
      if (action !== "launch") {
        return fail(`host_app: unsupported action "${action}" — Phase 1 supports "launch" (plain no-arg start) only`)
      }
      const appsCfg = getConfig().apps
      if (!appsCfg || appsCfg.enabled === false) {
        return fail(`host_app: the Apps feature is disabled (apps.enabled=false in config.json)`)
      }
      const entry = appsCfg.entries?.[appToken]
      if (!entry) {
        return fail(`host_app: unknown app token "${appToken}" — not in the App-tab whitelist. Only launch apps from the system-prompt app index; NEVER guess tokens.`)
      }
      if (!entry.enabled) {
        return fail(`host_app: app "${entry.display_name}" (${appToken}) is disabled in the App tab`)
      }
      if (entry.kind !== "gui") {
        return fail(`host_app: "${appToken}" is a CLI app — the CLI track is Phase-2 and cannot be launched yet`)
      }
      hostApp = { token: appToken, entry, policy: entry.policy }
    }
    // Coordinate computer-use (WP1) — pre-dialog fail-fast checks + A3
    // dialog payload (task + target app + EVERY type.text literal + budget).
    // The tier decision is made HERE; the dialog is critical-class and never
    // thread-trusted. forceConfirm (below) holds under god-mode alone; only
    // three-flag userFullAutonomy clears it. hostComputerTrustSkip may still
    // mint a token without dialog when session trust / unattended grant applies.
    let computerPreview = ""
    // WP4: L2 标注截图 + 三段式 caption(best-effort;undefined = 无图降级)。
    let computerL2PreviewImage: string | undefined
    let computerL2PreviewCaption: string | undefined
    // P5 / Grok v4.1 §3.2 (Pi re-confirm PROCEED 2026-07-24): when the session
    // already has a live trust grant for this app AND every type.text literal
    // in the new task was in the previously-approved corpus AND no credential
    // latch is set AND the grant is not idle-expired, skip the initial L2
    // dialog and mint the security_token directly. The grant's lastTouchedAt
    // is refreshed by isTrusted(); corpus does not need re-accumulation (the
    // skip-eligible task's corpus is by definition a subset of the stored one).
    let hostComputerTrustSkip = false
    /** ADR-021 audit: "session_trust_corpus_subset" | "unattended_session_grant" */
    let hostComputerTrustSkipReason: "session_trust_corpus_subset" | "unattended_session_grant" | null =
      null
    let vaultBrowserOneShot = false
    if (hostComputerGated) {
      const { assertCoordinateAllowed, isVaultBrowserEntry } = await import("../computer/policy")
      // Y3 (WP2): the preview text comes from the PURE builder — task text
      // JSON-escaped against layout spoofing, every injectable action
      // enumerated verbatim; unit-tested in computer-preview.test.ts.
      const { buildComputerL2Preview } = await import("../computer/preview")
      const failC = (error: string) => {
        const result = { success: false, error }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      try {
        const entryC = assertCoordinateAllowed(getConfig(), String(finalParams.app || ""), {
          allowVaultBrowserOneShot: true,
        })
        vaultBrowserOneShot = isVaultBrowserEntry(entryC)
        const budgetN = Math.min(Math.max(1, Number(finalParams.budget) || 15), 30)
        // R1 (§E.6.2): global single-task invariant — a second computer
        // task is refused BEFORE the L2 dialog while one is executing (no
        // queue, no wait). This early check only spares a pointless dialog;
        // the AUTHORITATIVE check-and-set is in executeCompanionTool, which
        // closes the race where both tasks passed this gate before either
        // registered.
        if (computerTaskAbort.size > 0) {
          return failC(
            "host_computer refused: another computer task is already executing (global single-task invariant, plan §E.6.2) [COMPUTER_TASK_BUSY] — wait for it to finish or abort it from the panel.",
          )
        }
        // Y7: session rate gate — a saturated 60s window refuses the task
        // BEFORE the L2 dialog; a runaway agent must not burn human clicks.
        const limiter = await computerRateLimiter()
        if (limiter.saturated()) {
          return failC(
            `host_computer refused: session injection rate limit reached (${limiter.countInWindow()}/30 in the last 60s) [RATE_LIMITED] — wait for the window to drain before starting another computer task.`,
          )
        }
        // P5 / Grok v4.1 §3.2 (Pi re-confirm PROCEED 2026-07-24 + Pi final
        // review caveat 1 budget gate 2026-07-24): G1 trust skip gate.
        // Consult session trust for (sessionId, app); require the new task's
        // type corpus to be a subset of the prior approved corpus AND the
        // budget to not exceed the largest previously-approved budget.
        // isTrusted() already enforces idle expiry (30 min, anchored to last
        // interactive approve) and credential latch — those need no separate
        // check here.
        if (hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot) && sessionId && finalParams.app) {
          const {
            getComputerSessionTrust,
            resolveComputerTrustKey,
            trustKeyAllowsInitialSkip,
            g1InitialSkipEligible,
          } = await import("../computer/session-trust")
          const trust = getComputerSessionTrust()
          const appToken = String(finalParams.app)
          // Grill Q1=C: prefer chat thread for "本会话"; strip inject-only param.
          const chatThreadId =
            typeof (finalParams as any).__thread_id === "string"
              ? String((finalParams as any).__thread_id)
              : typeof (finalParams as any).thread_id === "string"
                ? String((finalParams as any).thread_id)
                : undefined
          const trustKey = resolveComputerTrustKey(chatThreadId, sessionId)
          const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
          const actionCount = actionsArr.length
          const typeCorpus: string[] = []
          let experimentalFlag = false
          for (const a of actionsArr) {
            if (a && typeof a === "object" && (a as any).action === "type" && typeof (a as any).text === "string") {
              typeCorpus.push(String((a as any).text))
            }
            if (a && typeof a === "object" && (a as any).experimental === true) experimentalFlag = true
          }
          // Grill Q2/Q3: single pure gate (g1InitialSkipEligible) — no drift vs tests.
          const maxBudget = trust.maxBudgetSeen(trustKey, appToken)
          const maxActions = trust.maxActionsSeen(trustKey, appToken)
          const modelEnabled = getConfig().computer?.modelEnabled === true
          if (
            g1InitialSkipEligible({
              trust,
              trustKey,
              app: appToken,
              typeCorpus,
              budget: budgetN,
              actionCount,
              experimental: experimentalFlag,
              // L-QW-2: config-level block — action.experimental alone is insufficient
              modelEnabled,
            })
          ) {
            hostComputerTrustSkip = true
            hostComputerTrustSkipReason = "session_trust_corpus_subset"
            logger.info("computer.session_trust.task_auto_approved", {
              tool_call_id: toolCallId,
              trust_key: trustKey,
              chat_thread_id: chatThreadId ?? null,
              app: appToken,
              type_corpus_size: typeCorpus.length,
              budget: budgetN,
              max_budget_seen: maxBudget,
              actions: actionCount,
              max_actions_seen: maxActions,
              explicit_opt_in: true,
            })
          } else {
            // ADR-021: process-memory unattended grant (sibling of G1, not god/auto_approve).
            // assertCoordinateAllowed already passed → coordinateAllowed true for this app.
            const {
              evaluateUnattendedHostComputerSkipDetail,
              isUnattendedArmed,
            } = await import("../computer/unattended-grant")
            const unattendedDetail = evaluateUnattendedHostComputerSkipDetail({
              coordinateAllowed: true,
              experimental: experimentalFlag,
              modelEnabled,
              credentialLatched: trust.hasCredentialLatch(trustKey, appToken),
              budget: budgetN,
              actionCount,
            })
            if (unattendedDetail.ok) {
              hostComputerTrustSkip = true
              hostComputerTrustSkipReason = "unattended_session_grant"
              logger.info("computer.unattended.task_auto_approved", {
                tool_call_id: toolCallId,
                trust_key: trustKey,
                chat_thread_id: chatThreadId ?? null,
                app: appToken,
                budget: budgetN,
                actions: actionCount,
                reason: "unattended_session_grant",
              })
            } else {
              // Loud when 值守中 but still prompting — product FAQ #1 is modelEnabled.
              const unattendedArmed = isUnattendedArmed()
              logger.warn("computer.session_trust.skip_missed", {
                tool_call_id: toolCallId,
                trust_key: trustKey,
                chat_thread_id: chatThreadId ?? null,
                app: appToken,
                trusted: trust.isTrusted(trustKey, appToken),
                explicit_opt_in: trust.hasExplicitOptIn(trustKey, appToken),
                key_allows_skip: trustKeyAllowsInitialSkip(trustKey),
                corpus_eligible: trust.corpusContains(trustKey, appToken, typeCorpus),
                budget_eligible: maxBudget > 0 && budgetN <= maxBudget,
                actions_eligible: maxActions > 0 && actionCount <= maxActions,
                experimental: experimentalFlag,
                model_enabled: modelEnabled,
                max_budget_seen: maxBudget,
                max_actions_seen: maxActions,
                unattended_armed: unattendedArmed,
                unattended_block_reason: unattendedDetail.block_reason || null,
              })
            }
          }
        } else if (hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot) && finalParams.app) {
          // No sessionId — G1 needs session; unattended is process-global (ADR-021).
          const {
            evaluateUnattendedHostComputerSkipDetail,
            isUnattendedArmed,
          } = await import("../computer/unattended-grant")
          const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
          let experimentalFlag = false
          for (const a of actionsArr) {
            if (a && typeof a === "object" && (a as any).experimental === true) experimentalFlag = true
          }
          const modelEn = getConfig().computer?.modelEnabled === true
          const unattendedDetail = evaluateUnattendedHostComputerSkipDetail({
            coordinateAllowed: true,
            experimental: experimentalFlag,
            modelEnabled: modelEn,
            credentialLatched: false,
            budget: budgetN,
            actionCount: actionsArr.length,
          })
          if (unattendedDetail.ok) {
            hostComputerTrustSkip = true
            hostComputerTrustSkipReason = "unattended_session_grant"
            logger.info("computer.unattended.task_auto_approved", {
              tool_call_id: toolCallId,
              app: String(finalParams.app || ""),
              budget: budgetN,
              actions: actionsArr.length,
              reason: "unattended_session_grant",
              no_session_id: true,
            })
          } else if (isUnattendedArmed()) {
            logger.warn("computer.unattended.skip_missed", {
              tool_call_id: toolCallId,
              experimental: experimentalFlag,
              model_enabled: modelEn,
              unattended_block_reason: unattendedDetail.block_reason || null,
            })
          }
        }
        if (vaultBrowserOneShot) {
          // Do not compute skip then wipe — never pass coordinateAllowed:true for
          // a one-shot browser (Trust REJECT + runtime P1).
          hostComputerTrustSkip = false
          hostComputerTrustSkipReason = null
        }
        computerPreview = buildComputerL2Preview({
          task: String(finalParams.task || ""),
          appDisplayName: entryC.display_name,
          appToken: entryC.token,
          budget: budgetN,
          actions: Array.isArray(finalParams.actions) ? finalParams.actions : [],
          leadLines: vaultBrowserOneShot
            ? [
                "⚠️ 浏览器像素点击：将绕过页面 CDP，直接操作浏览器窗口。必须你点「允许」。无人值守 / 三旗巡航 / 会话信任都不会跳过本次确认。本次授权不写入 Apps 坐标开关。",
              ]
            : undefined,
          extraLines: [limiter.statusLine()],
        })
        // WP4 (护栏 a,对抗裁决定案):L2 标注截图 helper 的调用点固定在这
        // 里——全部廉价前门(assertCoordinateAllowed / COMPUTER_TASK_BUSY /
        // rate-limit)通过之后、L2 对话框发出之前;后续重构不得挪前(每次
        // 确认 ≤5s 的代价只对真实候选任务支付)。best-effort:helper 失败/
        // 超时/非 win32|darwin/无 exe(AUMID 条目)一律降级无图,绝不影响确认门。
        if (os.platform() === "darwin" && (entryC.bundleId || entryC.exe?.path)) {
          try {
            const { buildComputerL2PreviewImage } = await import("../computer/l2-preview-image")
            const { MacScreenCapturer, MacLocator, MacWindowEnumerator, MacPreviewBuilder } = await import("../computer/darwin-adapters")
            const l2img = await buildComputerL2PreviewImage(
              {
                windows: new MacWindowEnumerator(),
                capturer: new MacScreenCapturer(),
                locator: new MacLocator(),
                previewBuilder: new MacPreviewBuilder(),
                log: (event, data) => logger.info(event, { tool_call_id: toolCallId, ...data }),
              },
              {
                exePath: entryC.bundleId ?? entryC.exe?.path ?? "",
                appDisplayName: entryC.display_name,
                actions: Array.isArray(finalParams.actions) ? finalParams.actions : [],
                timeoutMs: 5000,
              },
            )
            if (l2img) {
              computerL2PreviewImage = l2img.image
              computerL2PreviewCaption = l2img.caption
            }
          } catch (helperErr: any) {
            // best-effort:helper 异常绝不拒飞任务(降级无图)。
            logger.info("computer.l2preview.failed", { tool_call_id: toolCallId, error: helperErr?.message || String(helperErr) })
          }
        } else if (os.platform() === "win32" && entryC.exe?.path) {
          try {
            const { buildComputerL2PreviewImage } = await import("../computer/l2-preview-image")
            const { PsScreenCapturer, PsLocator, PsWindowEnumerator, PsPreviewBuilder } = await import("../computer/win-adapters")
            const l2img = await buildComputerL2PreviewImage(
              {
                windows: new PsWindowEnumerator(),
                capturer: new PsScreenCapturer(),
                locator: new PsLocator(),
                previewBuilder: new PsPreviewBuilder(),
                log: (event, data) => logger.info(event, { tool_call_id: toolCallId, ...data }),
              },
              {
                exePath: entryC.exe.path,
                appDisplayName: entryC.display_name,
                actions: Array.isArray(finalParams.actions) ? finalParams.actions : [],
                timeoutMs: 5000,
              },
            )
            if (l2img) {
              computerL2PreviewImage = l2img.image
              computerL2PreviewCaption = l2img.caption
            }
          } catch (helperErr: any) {
            // best-effort:helper 异常绝不拒飞任务(降级无图)。
            logger.info("computer.l2preview.failed", { tool_call_id: toolCallId, error: helperErr?.message || String(helperErr) })
          }
        }
      } catch (err: any) {
        return failC(err?.message || String(err))
      }
    }
    const securityConfig = getConfig().security
    // skipL2 = auto_approve_dangerous || allow_all_schemes || (domain whitelist)
    //         || (Phase 1 W7: thread-scoped host_read trust).
    // allow_all_schemes (GOD-MODE) bypasses Layer 2 too — see config.ts SecurityConfig.
    // Phase 1 W7 Q1 blocker: thread-scoped trust applies to READ only.
    // Writes always go through confirmation (biometric tier is preserved).
    let threadTrusted = false
    if (toolName === "host_read" && relevantApp && sessionId) {
      threadTrusted = getThreadApprovals().has(sessionId, relevantApp, "read")
      if (threadTrusted) {
        logger.info("security.thread_auto_approved", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          thread_id: sessionId,
          bundle_id: relevantApp,
          kind: "read",
        })
      }
    }
    // App tab WP3 (owner decision 2 — W7 Blocker-1 "app-launch" exception):
    // under policy "ai", a launch already trusted in this thread skips L2.
    // "manual" NEVER consults thread-trust (even if a stale entry existed).
    if (hostApp && hostApp.policy === "ai" && sessionId) {
      threadTrusted = getThreadApprovals().has(sessionId, hostApp.token, "app-launch")
      if (threadTrusted) {
        logger.info("security.thread_auto_approved", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          thread_id: sessionId,
          bundle_id: hostApp.token,
          kind: "app-launch",
        })
      }
    }
    // App tab WP3 (owner decision 1): auto = 仅启动免确认 — an L0 no-arg
    // launch of an auto-policy app skips L2. (P1 ships launch only; any
    // future with-args op must NOT inherit this skip — adversary D3.)
    const appWhitelisted = hostApp?.policy === "auto"
    let skipConfirmation = securityConfig.auto_approve_dangerous === true
      || securityConfig.allow_all_schemes === true
      || (relevantDomain !== "" && isAutoApprovedDomain(relevantDomain))
      || threadTrusted
      || appWhitelisted
    // Q5 (L-CLI-5): after host_cli output in this thread, force L2 for host_cli
    // and host_app until the next real user message.
    // ADR-025: same idea after ACP handback for a wider high-blast tool set.
    try {
      const { isCliOutputTainted } = require("../apps/cli-q5") as typeof import("../apps/cli-q5")
      const q5Thread =
        typeof (finalParams as any).__thread_id === "string"
          ? String((finalParams as any).__thread_id)
          : sessionId
      if (isCliOutputTainted(q5Thread) && (toolName === "host_cli" || toolName === "host_app")) {
        skipConfirmation = false
        logger.info("security.cli_q5_force_l2", { tool_name: toolName, thread: q5Thread })
      }
      try {
        const { isAcpHandbackTainted } = require("../acp/taint") as typeof import("../acp/taint")
        const acpBlast =
          toolName === "host_cli" ||
          toolName === "host_app" ||
          toolName === "shell_exec" ||
          toolName === "evaluate" ||
          toolName === "osascript_eval" ||
          toolName === "acp_propose_session" ||
          toolName === "acp_start_session" ||
          toolName === "acp_apply_diff"
        if (isAcpHandbackTainted(q5Thread) && acpBlast) {
          skipConfirmation = false
          logger.info("security.acp_q5_force_l2", { tool_name: toolName, thread: q5Thread })
        }
      } catch {
        /* acp module optional at boot */
      }
    } catch { /* ignore */ }
    // §6.2 CRITICAL_API_GATE: detectCriticalApis() is the never-auto-approved
    // subset of detectDangerousApis() (exfil + sandbox-escape + obfuscation
    // variants). Domain whitelist / god-mode alone / auto_approve_dangerous
    // alone still force interactive confirmation for a non-empty critical set
    // (domain trust ≠ page-content trust; M3' invariant). Only three-flag
    // full autonomy cruise (auto_approve_dangerous + enterprise + allow_all
    // schemes) waives forceConfirm — residual risk is explicit product choice.
    //
    // Coordinate computer-use: critical-class BY DESIGN (plan §E.3) — the
    // capability itself is the critical surface; waived only under full
    // autonomy cruise (same three-flag gate).
    // shell_exec / netsec_port_scan: force interactive confirm unless Plan A/B
    // enterprise skip (scope ∩ first) or full autonomy. God-mode /
    // auto_approve_dangerous alone still do NOT skip these (ADR-014 G1).
    // spawn_worker / ask_user / board_complete: real HITL (never LLM self-approve)
    // ADR-025: ACP spawn is real HITL — never waived by god-mode / auto_approve /
    // three-flag full autonomy cruise (product design: Never skip ACP).
    const acpForceConfirm = isAcpL2ForceTool(toolName)
    const capabilityForceConfirm =
      toolName === "shell_exec" ||
      toolName === "netsec_port_scan" ||
      toolName === "spawn_worker" ||
      toolName === "ask_user" ||
      toolName === "board_complete" ||
      toolName === "host_cli" || // L-CLI-9: god-mode never skips host_cli L2
      toolName === "skill_install" || // S41: durable skill write — god-mode never skips
      // evaluate / osascript: always L2 unless three-flag full autonomy (regex is risk preview only)
      toolName === "evaluate" ||
      toolName === "osascript_eval" ||
      acpForceConfirm
    const userFullAutonomy = isFullAutonomyCruise(securityConfig)
    const codeCriticalApis = detectCriticalApis(code)
    // Risk-preview list for the confirm UI: for evaluate/osascript prefer regex hits;
    // for other capability-forced tools use the tool name; host_computer stays special.
    const criticalApis = hostComputerGated
      ? ["computer.coordinate_injection"]
      : toolName === "evaluate" || toolName === "osascript_eval"
        ? (codeCriticalApis.length > 0 ? codeCriticalApis : [toolName])
        : capabilityForceConfirm
          ? [toolName]
          : codeCriticalApis
    // Waive forceConfirm only under three-flag full autonomy cruise.
    // evaluate/osascript always force L2 (domain whitelist / god-mode alone insufficient).
    // host_computer is critical-class BY DESIGN (ADR-017): god-mode / auto_approve alone
    // must NOT skip task L2 — only three-flag cruise, G1 session-trust, or ADR-021 unattended
    // (hostComputerTrustSkip) may skip. Restore forceConfirm for hostComputerGated after P0
    // when capabilityForceConfirm no longer implied criticalApis.length for this tool.
    // ACP: NEVER waive (acpForceConfirm overrides cruise) — pure algebra in resolveL2ForceConfirm.
    const forceConfirm = resolveL2ForceConfirm({
      toolName,
      capabilityForceConfirm,
      hostComputerGated,
      userFullAutonomy,
      vaultBrowserOneShot,
    })
    if ((capabilityForceConfirm || hostComputerGated) && userFullAutonomy && !acpForceConfirm && !vaultBrowserOneShot) {
      logger.info("security.critical_api_waived", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        critical_apis: criticalApis,
        reason: "full_autonomy_cruise",
        relevant_domain: relevantDomain || undefined,
      })
    }

    // Plan A/B: enterprise L2 skip for shell/netsec only (G1–G5)
    let enterpriseSkip = false
    let enterpriseSkipReason: "enterprise_global" | "enterprise_session" | null = null
    let enterpriseFamily: EnterpriseToolFamily | null = familyOfTool(toolName)
    let enterpriseScopeFingerprint: string | undefined
    if (enterpriseFamily) {
      if (enterpriseFamily === "netsec") {
        const mod = getModule("netsec")
        const thread = actingThreadId ? threadManager.get(actingThreadId) : null
        const scope = checkNetsecScope({
          targets: Array.isArray(finalParams.targets) ? finalParams.targets.map(String) : [],
          allowlist: mod?.target_allowlist || [],
          requireTaskAuth: mod?.require_task_auth !== false,
          taskAuth: (thread as any)?.netsec_task_auth || null,
          moduleEnabled: isModuleEnabled("netsec"),
        })
        if (!scope.ok) {
          // #322: install-level config gaps point the user (and the model) at the
          // exact settings location. Per-target/task-auth denials stay scope denials.
          if (scope.reason === "module_disabled" || scope.reason === "allowlist_empty") {
            const settingsRequired = settingsRequiredResult(
              "netsec_port_scan",
              scope.error,
              scope.reason,
            )
            if (settingsRequired) return settingsRequired
          }
          return {
            success: false,
            error: scope.error,
            data: { error_code: "NETSEC_SCOPE_DENIED" },
          }
        }
        enterpriseScopeFingerprint = netsecScopeFingerprint(
          scope.allowlist,
          (thread as any)?.netsec_task_auth?.targets,
        )
      } else {
        const scope = checkShellScope(String(finalParams.command || ""))
        if (!scope.ok) {
          return {
            success: false,
            error: scope.error,
            data: { error_code: "SHELL_SCOPE_DENIED" },
          }
        }
      }
      const sec = securityConfig
      const trustKey = resolveEnterpriseTrustKey(actingThreadId)
      if (sec?.auto_approve_enterprise_tools === true) {
        enterpriseSkip = true
        enterpriseSkipReason = "enterprise_global"
      } else if (
        trustKey &&
        enterpriseSessionTrust.isActive(
          trustKey,
          enterpriseFamily,
          Date.now(),
          enterpriseFamily === "netsec" ? enterpriseScopeFingerprint : null,
        )
      ) {
        enterpriseSkip = true
        enterpriseSkipReason = "enterprise_session"
      }
    }

    // G1: enterpriseSkip is sibling of hostComputerTrustSkip — do not only clear forceConfirm
    if (
      (L2_GATE_TOOLS as readonly string[]).includes(toolName) ||
      hostAppGated ||
      hostCliGated ||
      hostComputerGated
    ) {
      try {
        SecurityPolicy.bindingPayloadFor(toolName, finalParams)
      } catch (bindErr) {
        const msg = bindErr instanceof Error ? bindErr.message : String(bindErr)
        return { success: false, error: msg }
      }
    }
    if ((!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip) {
      // Audit item 2: default-deny. ALL evaluate/osascript_eval calls require
      // interactive confirmation unless whitelisted above. The regex match
      // (safety.dangerousApis) becomes a risk-preview escalation hint shown to
      // the user — it no longer gates WHETHER to confirm, only HOW SCARY the
      // preview looks.
      const safety = checkHighRiskExecution(toolName, code)
      if (ws.readyState !== WebSocket.OPEN) {
        const result = {
          success: false,
          error: highRiskExecutionDeniedError(toolName, safety.dangerousApis, "unavailable"),
          data: { dangerous_apis_found: safety.dangerousApis },
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      logger.warn("security.confirmation.requested", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        dangerous_apis: safety.dangerousApis,
        critical_apis: criticalApis,
        force_confirm: forceConfirm,
      })
      // Phase 1 W8-windows (adversary amendment A3 — single-dialog nonce
      // routing): for host_write on win32, probe Windows Hello availability
      // BEFORE showing this L2 dialog. When Hello is unavailable, the
      // manual-nonce challenge is attached to THIS SAME request (the
      // extension renders an inline paste-blocked nonce input,
      // App.tsx:299-377) — no second executor-internal prompt on the
      // normal path. The standalone executor prompt is retained only for
      // the skip-L2 path (god-mode / auto-approve).
      if (toolName === "host_write" && os.platform() === "win32") {
        const { probeWindowsHello } = await import("../host-use/win")
        if (!(await probeWindowsHello())) {
          const { generateManualNonce } = await import("../host-use/nonce")
          winL2NonceChallenge = generateManualNonce()
          // Adversary amendment 7a: dedicated downgrade audit event.
          logger.info("security.biometric.downgrade", {
            tool_call_id: toolCallId,
            reason: "windows_hello_unavailable",
          })
        }
      }
      // ADR-015 GATE1: order = (optional flight reserve) → L2 admission → SOFT → confirm.
      // SOFT after admission so softDeadline (= confirm timeout) cannot expire mid-queue.
      // Flight reserve for shell/netsec so approve is never followed by *_BUSY.
      const { TAB_L2_TOOLS } = await import("../orchestrator/constants")
      let tabL2SoftHeld = false
      let tabL2HardPromoted = false
      let flightReserved: "shell_exec" | "netsec_port_scan" | null = null
      const flightOwner = String(actingThreadId || "unknown")

      if (toolName === "shell_exec" || toolName === "netsec_port_scan") {
        const { tryAcquireFlight, releaseFlight } = await import("../orchestrator/single-flight")
        const flight = tryAcquireFlight(toolName, flightOwner)
        if (!flight.ok) {
          const result = {
            success: false,
            error: flight.error,
            data: {
              error_code: toolName === "shell_exec" ? "SHELL_BUSY" : "NETSEC_BUSY",
              holder: flight.holder,
            },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        flightReserved = toolName
        // releaseFlight referenced only for deny/timeout paths below
        void releaseFlight
      }

      let decision: Awaited<ReturnType<typeof securityConfirmations.request>> | undefined
      try {
      // L2 FIFO admission FIRST (≤1 per orchestrator_run, ≤2 process-wide)
      const maForL2 = actingThreadId && threadManager
        ? (threadManager.get(actingThreadId) as any)
        : null
      const { acquireL2Admission, releaseL2Admission } = await import("../orchestrator/l2-admission")
      const admit = await acquireL2Admission({
        orchestratorRunId: maForL2?.orchestrator_run_id,
        threadId: actingThreadId,
      })
      if (!admit.ok) {
        if (flightReserved) {
          const { releaseFlight } = await import("../orchestrator/single-flight")
          releaseFlight(flightReserved, flightOwner)
          flightReserved = null
        }
        const result = {
          success: false,
          error: admit.error,
          data: { error_code: "L2_ADMISSION_TIMEOUT" },
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      const l2AdmitKey = admit.key

      // Exclusive SOFT / HELD_PENDING_L2 after admission (TAB_L2_TOOLS) — multi-agent only.
      // Normal single-agent evaluate still goes through Confirm / L2 admission without
      // taking a tab lease (see early HARD gate above).
      {
        const {
          isMultiAgentThread: isMaThread,
          anyTabLeaseHeld: anyLeaseHeld,
          acquireOrRenewTabLease,
        } = await import("../orchestrator")
        const multiForSoft = isMaThread(maForL2) || anyLeaseHeld()
        if (
          multiForSoft &&
          TAB_L2_TOOLS.has(toolName) &&
          typeof finalParams.tabId === "number" &&
          actingThreadId
        ) {
          const soft = acquireOrRenewTabLease({
            tabId: finalParams.tabId,
            holderThreadId: actingThreadId,
            needsL2: true,
            confirmId: toolCallId,
          })
          if (!soft.ok) {
            releaseL2Admission(l2AdmitKey)
            if (flightReserved) {
              const { releaseFlight } = await import("../orchestrator/single-flight")
              releaseFlight(flightReserved, flightOwner)
              flightReserved = null
            }
            const result = {
              success: false,
              error: soft.error,
              data: {
                error_code: soft.error_code,
                tab_id: soft.tab_id,
                holder_thread_id: soft.holder_thread_id,
              },
            }
            logToolFinish(toolCallId, toolName, startedAt, result)
            return result
          }
          tabL2SoftHeld = true
        }
      }

      try {
      decision = await (async () => {
        // Overlay HITL without an extension peer: attachChromeOnly + wait.
        // Timeout is denied / not approved (never skip-confirm).
        const originatingSurface = wsAuth.get(ws)?.surface
        let extensionWs = pickExtensionWsFromAuth(clients, (w) => wsAuth.get(w))
        if (isSummonerSurface(originatingSurface) && !(extensionWs && extensionWs.readyState === WebSocket.OPEN)) {
          try {
            extensionWs = await ensureExtensionPeerForOverlayConfirm({ existing: extensionWs })
          } catch {
            return { confirmationId: "", approved: false, reason: "timeout" as const }
          }
        }

        // P0a — pre-generate confirmationId so WS + tray channels share it.
        // Whichever resolves first wins (manager.pending is keyed by id, first
        // responder claims it). See capability-token-round1-synthesis §P0a.
        const sharedConfirmId = randomUUID()

        // Build the same preview text for the tray dialog as the WS Side Panel
        // gets (computerPreview for host_computer; otherwise the tool's code).
        const traySummary = hostComputerGated && computerPreview
          ? computerPreview
          : hostApp
            ? `Launch app "${hostApp.entry.display_name}" (${hostApp.token}) — no arguments`
            : code
        const tray = getTrayInstance()
        // Tray dialog only when Swift backend can actually show a native
        // confirm (S42 P1 Compat-C5). systray2/readline return a never-resolving
        // Promise — marking them trayEligible lied on Windows/Linux and held
        // Promise.race with a dead contender. Win Hello nonce still needs Side Panel.
        let trayBackendIsSwift = false
        try {
          const { detectTrayBackend } = require("../tray/tray-adapter") as typeof import("../tray/tray-adapter")
          trayBackendIsSwift = detectTrayBackend() === "swift"
        } catch {
          trayBackendIsSwift = false
        }
        const trayEligible = !!tray && !winL2NonceChallenge && trayBackendIsSwift
        const trayReq: TrayConfirmRequest | null = trayEligible
          ? {
              id: sharedConfirmId,
              toolName: isOutboundMcpCall ? `[Outbound] ${toolName}` : toolName,
              riskLevel: forceConfirm
                ? "high"
                : safety.dangerousApis.length > 0 || isOutboundMcpCall ? "medium" : "low",
              // Truncate to keep NSWindow readable — full text goes to Side Panel.
              summary: traySummary.length > 800 ? traySummary.slice(0, 800) + "…" : traySummary,
              criticalApis,
              timeoutMs: DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS,
            }
          : null
        const trayPromise = trayReq && tray
          ? tray.showConfirmDialog(trayReq).then((r) => ({
              source: "tray" as const,
              approved: r.approved,
            }))
            // C-P0-7 (2026-07-24 diagnosis): swallow tray adapter rejects
            // (IPC error, Swift crash, adapter bug). Without this, the
            // rejection propagates through Promise.race and the wsPromise
            // lingers in securityConfirmations.pending until the 45s
            // timeout — meanwhile the user gets no UI and the tool call
            // hangs. Now: a rejected tray promise resolves to null, the
            // race picks wsPromise (the only remaining contender), and
            // the Side Panel dialog still works.
            .catch(() => null as null | { source: "tray"; approved: boolean })
          : null

        // Overlay/outbound: bind via resolveConfirmBinding so overlay is never
        // originWs and tray map is never keyed by the summoner socket.
        const confirmBinding = resolveConfirmBinding({
          originatingWs: ws,
          originatingSurface,
          isOutboundMcpCall,
          extensionWs,
        })
        const trayOwnerWs = confirmBinding.trayOwnerWs

        // C-P0-6: register this sharedConfirmId against trayOwnerWs (never
        // overlay) so ws.on("close") can cancel the tray dialog if that owner dies.
        if (trayPromise && trayOwnerWs) {
          let set = activeTrayConfirmsByWs.get(trayOwnerWs)
          if (!set) {
            set = new Set()
            activeTrayConfirmsByWs.set(trayOwnerWs, set)
          }
          set.add(sharedConfirmId)
        }

        // ADR-015 Confirm Center: stamp multi-agent identity when known
        const maThread = actingThreadId && threadManager
          ? (threadManager.get(actingThreadId) as any)
          : null
        const multiAgentFields =
          maThread && (maThread.agent_role === "worker" || maThread.agent_role === "orchestrator" || maThread.parent_thread_id)
            ? {
                workerId: actingThreadId,
                parentThreadId: maThread.parent_thread_id || undefined,
                orchestratorRunId: maThread.orchestrator_run_id || undefined,
                workerRoleLabel: maThread.worker_role_label || maThread.alias || undefined,
                tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
              }
            : actingThreadId
              ? {
                  workerId: actingThreadId,
                  tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
                }
              : {}

        // ADR-016 G6: board_complete Confirm digest (goal, trust hist, claims, residual, empty flag)
        let boardCompleteDigestForConfirm: any = undefined
        if (toolName === "board_complete" && threadManager && actingThreadId) {
          try {
            const { readBoard, buildBoardCompleteDigest, resolveBoardHostThreadId } =
              await import("../board")
            const hostId =
              resolveBoardHostThreadId(threadManager, String(actingThreadId)) ||
              String(actingThreadId)
            const b = readBoard(threadManager, hostId)
            if (b) {
              boardCompleteDigestForConfirm = buildBoardCompleteDigest(b, {
                supporting_fact_ids: Array.isArray(finalParams.supporting_fact_ids)
                  ? finalParams.supporting_fact_ids.map(String)
                  : [],
                residual_risks: Array.isArray(finalParams.residual_risks)
                  ? finalParams.residual_risks.map(String)
                  : [],
                empty_complete: finalParams.empty_complete === true,
                empty_complete_reason:
                  finalParams.empty_complete_reason != null
                    ? String(finalParams.empty_complete_reason)
                    : null,
              })
            }
          } catch {
            /* digest is best-effort for UI */
          }
        }

        // ADR-022 L8 + overlay L8: outbound / summoner fan-out Allow/Deny to
        // authenticated non-summoner peers (确认台 / tray). Overlay gets
        // mcp.confirm.pending only. Panel origin stays origin-bound (A1).
        const sendConfirm = (data: any) => {
          fanOutConfirmRequest({
            data,
            originatingWs: ws,
            originatingSurface,
            isOutboundMcpCall,
            overlayNotice: confirmBinding.overlayNotice,
            clients,
            wsAuthGet: (w) => wsAuth.get(w),
          })
        }
        if (isOutboundMcpCall || isSummonerSurface(originatingSurface)) {
          if (isOutboundMcpCall) {
            logger.info("outbound_mcp.confirm_fanout", {
              tool_call_id: toolCallId,
              tool_name: toolName,
              caller: String((finalParams as any).__outbound_caller_id || ""),
              tray: !!trayEligible,
            })
          }
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const notifier = require("node-notifier") as {
              notify: (o: { title?: string; message?: string; sound?: boolean }) => void
            }
            notifier.notify({
              title: "CMspark 需要确认",
              message: isOutboundMcpCall
                ? `Outbound MCP 请求: ${toolName} — 请在确认台或托盘里批准`
                : `请在确认台或托盘里批准`,
              sound: true,
            })
          } catch {
            /* optional — non-Swift platforms */
          }
        }

        // Overlay binds extension (or unbound); outbound stays unbound; panel
        // stays origin-bound. Never bind originWs to the summoner socket.
        const confirmOriginOpts = confirmBinding.originWs
          ? { originWs: confirmBinding.originWs }
          : {}

        const wsPromise = securityConfirmations.request(
          sendConfirm,
          {
            toolName,
            dangerousApis: safety.dangerousApis,
            // App tab WP3: no code to preview — show WHAT will be launched.
            // host_computer (A3): show the task + app + EVERY type.text literal.
            code: hostComputerGated
              ? computerPreview
              : hostApp
                ? `Launch app "${hostApp.entry.display_name}" (${hostApp.token}) — no arguments`
                : code,
            relevantDomains: relevantDomain ? [relevantDomain] : [],
            // App tab WP3: the thread-trust checkbox (relevantApps) is offered
            // ONLY under policy "ai". "manual" must never show it (owner
            // decision 2); "auto" never reaches this dialog.
            // host_computer (grill Q2 2026-07-26): offer app token so the
            // panel can show "本会话自动同意同类操作" (session trust opt-in,
            // NOT ThreadApprovals / not write-biometric skip).
            relevantApps: hostComputerGated
              ? hostComputerConfirmRelevantApps(vaultBrowserOneShot, finalParams.app)
              : hostApp
                ? (hostApp.policy === "ai" ? [hostApp.token] : [])
                : (relevantApp ? [relevantApp] : []),
            criticalApis,
            ...(forceConfirm ? { riskLevel: "high" as const, autoConfirmEligible: false } : {}),
            // Plan A: offer enterprise session trust when B is off and tool is shell/netsec
            ...(enterpriseFamily &&
            securityConfig.auto_approve_enterprise_tools !== true
              ? { offerEnterpriseSessionTrust: true }
              : {}),
            ...(winL2NonceChallenge ? { nonceChallenge: winL2NonceChallenge } : {}),
            // P1 (WP4): computer 类确认的完整预览文本走独立字段,绕过
            // code_preview 的 CODE_PREVIEW_LIMIT=1200 截断(30 动作 + 2000
            // 语料的逐条枚举对人完整可见);其余工具不设置,修复面收窄。
            ...(hostComputerGated && computerPreview ? { fullPreview: computerPreview } : {}),
            // WP4 (§F.1): L2 标注截图 + 三段式非绑定 caption(best-effort,
            // 仅存在时下发;绝不进入工具结果/LLM 上下文——P2 不变量)。
            ...(computerL2PreviewImage ? { previewImage: computerL2PreviewImage } : {}),
            ...(computerL2PreviewCaption ? { previewCaption: computerL2PreviewCaption } : {}),
            ...multiAgentFields,
            // ADR-016 G6: attach board_complete digest when available
            ...(toolName === "board_complete" && boardCompleteDigestForConfirm
              ? { boardCompleteDigest: boardCompleteDigestForConfirm }
              : {}),
          },
          confirmOriginOpts,
          // P0a: pre-generated id shared with tray.
          sharedConfirmId,
        )

        if (!trayPromise) {
          // No tray (or Windows-nonce path) — straight WS, original behavior.
          return wsPromise
        }

        // Race: first responder wins. Loser is silenced (manager.pending.delete
        // means the second response is a no-op; tray dialog is closed via cancel).
        // trayPromise may resolve to null if the tray adapter rejected (C-P0-7).
        const winner: { source: "ws"; decision: SecurityConfirmationDecision } | { source: "tray"; approved: boolean } | null =
          await Promise.race([
            wsPromise.then((d): { source: "ws"; decision: SecurityConfirmationDecision } => ({
              source: "ws", decision: d,
            })),
            trayPromise,
          ])
        // C-P0-6: confirmation resolved (one way or another) — drop from
        // activeTrayConfirmsByWs so owner close doesn't try to cancel a dialog
        // that's already gone. Key is trayOwnerWs (never overlay).
        if (trayOwnerWs) {
          activeTrayConfirmsByWs.get(trayOwnerWs)?.delete(sharedConfirmId)
        }

        if (winner === null) {
          // Tray rejected — fall back to WS-only path. wsPromise still races
          // in the rest of this async block; just bypass tray-cancellation.
          return await wsPromise
        }
        if (winner.source === "ws") {
          tray!.cancelConfirm(sharedConfirmId)
          return winner.decision
        }
        // Tray responded first — propagate to manager so the WS Side Panel also
        // gets its resolved message (extension closes its dialog). respond() is
        // the privileged path that bypasses originWs check; tray is a trusted
        // single-instance local channel, no rogue-peer risk.
        securityConfirmations.respond(sharedConfirmId, winner.approved)
        return await wsPromise
      })()
      } finally {
        releaseL2Admission(l2AdmitKey)
      }
      if (!decision || !decision.approved) {
        if (flightReserved) {
          const { releaseFlight } = await import("../orchestrator/single-flight")
          releaseFlight(flightReserved, flightOwner)
          flightReserved = null
        }
        const reason =
          !decision ? "unavailable" : decision.reason === "approved" ? "unavailable" : decision.reason
        const result = {
          success: false,
          error: highRiskExecutionDeniedError(toolName, safety.dangerousApis, reason),
          data: { dangerous_apis_found: safety.dangerousApis },
        }
        logger.warn("security.confirmation.denied", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          reason,
          dangerous_apis: safety.dangerousApis,
        })
        if (forceConfirm) {
          logger.warn("security.critical_capability_denied", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            critical_apis: criticalApis,
            god_mode_active: securityConfig.allow_all_schemes === true,
            auto_approve_active: securityConfig.auto_approve_dangerous === true,
            relevant_domain: relevantDomain,
            reason,
          })
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      if (tabL2SoftHeld && typeof finalParams.tabId === "number" && actingThreadId) {
        const { hardReacquireAfterConfirm } = await import("../orchestrator")
        const hard = hardReacquireAfterConfirm({
          tabId: finalParams.tabId,
          holderThreadId: actingThreadId,
          confirmId: toolCallId,
        })
        if (!hard.ok) {
          // SOFT/HELD_PENDING_L2 released in outer finally (!tabL2HardPromoted)
          if (flightReserved) {
            const { releaseFlight } = await import("../orchestrator/single-flight")
            releaseFlight(flightReserved, flightOwner)
            flightReserved = null
          }
          const result = {
            success: false,
            error: hard.error,
            data: {
              error_code: hard.error_code,
              tab_id: hard.tab_id,
              holder_thread_id: hard.holder_thread_id,
            },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        tabL2HardPromoted = true
      }
      // Transfer flight ownership to executeCompanionTool (re-entrant same owner).
      // Clear local flag without releaseFlight so finally does not free it.
      flightReserved = null
      logger.info("security.confirmation.approved", { tool_call_id: toolCallId, tool_name: toolName })
      // UX-spike 2026-07-23: record per-session re-L2 trust for computer-use.
      // The INITIAL task L2 just gated the whole task; subsequent mid-task
      // re-L2 pauses (FOREGROUND-YIELD that escaped self-UI recovery,
      // budget exhaustion, dialog-suspected) in THIS session for THIS app
      // will auto-approve. Only reL2() in the executor consults this — the
      // initial L2 above always asks. See computer/session-trust.ts.
      //
      // P5 / Grok v4.1 §3.2 (Pi re-confirm PROCEED 2026-07-24): on interactive
      // approve, ALSO clear the credential latch (user just re-consented with
      // a fresh preview) AND extend the type corpus with this task's type.text
      // literals — so a future task with the same-or-subset corpus is eligible
      // for the G1 trust skip above.
      if (hostComputerGated && finalParams.app) {
        const { getComputerSessionTrust, resolveComputerTrustKey } = await import("../computer/session-trust")
        const trust = getComputerSessionTrust()
        const appToken = String(finalParams.app)
        const chatThreadId =
          typeof (finalParams as any).__thread_id === "string"
            ? String((finalParams as any).__thread_id)
            : typeof (finalParams as any).thread_id === "string"
              ? String((finalParams as any).thread_id)
              : undefined
        const trustKey = resolveComputerTrustKey(chatThreadId, sessionId)
        // Grill Q2: always grant for task-local reL2 silence; explicitOptIn
        // only when user checked the session auto-approve box.
        const explicitOptIn = decision.addToSessionTrust === true
        trust.grant(trustKey, appToken, { explicitOptIn })
        trust.clearCredentialLatch(trustKey, appToken)
        const budgetRec = Number(finalParams.budget) || 15
        trust.recordBudget(trustKey, appToken, budgetRec)
        const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
        // User test 2026-07-26 (#wrsihk): LLM often task-splits into 1-action
        // host_computer calls. Recording only actions.length left
        // maxActionsSeen=1 so the next 2-click task failed actions_eligible
        // even after explicit opt-in. The L2 preview already gates on
        // budget — treat approved budget as the actions floor when larger.
        trust.recordActions(
          trustKey,
          appToken,
          Math.max(actionsArr.length, budgetRec),
        )
        const typeTexts: string[] = []
        for (const a of actionsArr) {
          if (a && typeof a === "object" && (a as any).action === "type" && typeof (a as any).text === "string") {
            typeTexts.push(String((a as any).text))
          }
        }
        if (typeTexts.length > 0) {
          trust.extendCorpus(trustKey, appToken, typeTexts)
        }
        logger.info("computer.session_trust.granted", {
          tool_call_id: toolCallId,
          trust_key: trustKey,
          chat_thread_id: chatThreadId ?? null,
          app: appToken,
          corpus_extended_by: typeTexts.length,
          budget_recorded: budgetRec,
          actions_recorded: actionsArr.length,
          explicit_opt_in: explicitOptIn,
        })
      }
      if (hostApp) hostAppTier = "l2"
      // Plan A: record enterprise session grant when user checked the box (per-family G3)
      if (
        decision?.approved &&
        decision.addToEnterpriseSessionTrust === true &&
        enterpriseFamily
      ) {
        const ek = resolveEnterpriseTrustKey(actingThreadId)
        if (ek) {
          enterpriseSessionTrust.grant(ek, [enterpriseFamily], {
            scopeFingerprint:
              enterpriseFamily === "netsec" ? enterpriseScopeFingerprint : undefined,
          })
          logger.info("security.enterprise_session_trust.granted", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            family: enterpriseFamily,
            trust_key: ek,
            thread_id: actingThreadId ?? null,
          })
        }
      }
      if (forceConfirm) {
        logger.info("security.critical_capability_confirmed", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          critical_apis: criticalApis,
          god_mode_active: securityConfig.allow_all_schemes === true,
          auto_approve_active: securityConfig.auto_approve_dangerous === true,
          enterprise_auto_approve: securityConfig.auto_approve_enterprise_tools === true,
          relevant_domain: relevantDomain,
        })
      }
      } finally {
        // Pair tabL2SoftHeld with finally: release SOFT/HELD_PENDING_L2 on any
        // non-success exit (throw / deny / timeout / hard re-acquire fail).
        // Successful hard promote sets tabL2HardPromoted and keeps HARD.
        if (
          tabL2SoftHeld &&
          !tabL2HardPromoted &&
          typeof finalParams.tabId === "number" &&
          actingThreadId
        ) {
          try {
            const { releaseSoftOrPendingL2 } = await import("../orchestrator")
            releaseSoftOrPendingL2({
              tabId: finalParams.tabId,
              holderThreadId: actingThreadId,
              confirmId: toolCallId,
            })
          } catch {
            /* best-effort */
          }
        }
        // Exception path: flight still reserved and not transferred to execute → free it.
        // Deny paths release+null explicitly; approve sets flightReserved=null without release.
        if (flightReserved) {
          try {
            const { releaseFlight } = await import("../orchestrator/single-flight")
            releaseFlight(flightReserved, flightOwner)
          } catch {
            /* best-effort */
          }
        }
      }
    } else if (enterpriseSkip) {
      logger.info("security.enterprise_auto_approved", {
        tool_call_id: toolCallId,
        tool: toolName,
        reason: enterpriseSkipReason,
        thread_id: actingThreadId ?? null,
        targets:
          enterpriseFamily === "netsec" && Array.isArray(finalParams.targets)
            ? finalParams.targets.map(String)
            : undefined,
        command_prefix:
          enterpriseFamily === "shell"
            ? String(finalParams.command || "").slice(0, 64)
            : undefined,
      })
    } else {
      // App tab WP3: app_whitelist / thread_trust reasons precede the
      // domain_whitelist fallback (host_app never carries a domain).
      // P5 (Pi final-review caveat 3 2026-07-24): hostComputerTrustSkip has
      // its own audit reason so silent-skip is distinguishable from god-mode
      // / whitelist in the audit log.
      const autoReason = hostComputerTrustSkip
        ? (hostComputerTrustSkipReason || "session_trust_corpus_subset")
        : securityConfig.allow_all_schemes ? "god_mode"
        : securityConfig.auto_approve_dangerous ? "global_toggle"
        : appWhitelisted ? "app_whitelist"
        : threadTrusted ? "thread_trust"
        : "domain_whitelist"
      if (hostApp) hostAppTier = autoReason
      logger.info("security.auto_approved", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        domain: relevantDomain || "unknown",
        ...(hostApp ? { app: hostApp.token, app_policy: hostApp.policy } : {}),
        reason: autoReason,
      })
    }
    // Issue a fresh token (post-approval or for auto-approved skip path).
    // Phase 1 W8 bugfix (Kimi+Pi advisor Fix C): use bindingPayloadFor via
    // issueTokenFor so issuance and validation CANNOT diverge per tool.
    let approvedToken
    try {
      approvedToken = securityPolicy.issueTokenFor(toolName, finalParams)
    } catch (bindErr) {
      const msg = bindErr instanceof Error ? bindErr.message : String(bindErr)
      const result = { success: false, error: msg }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }
    finalParams = { ...finalParams, security_token: approvedToken.token }
  } else if (toolName === "evaluate" && finalParams.security_token) {
    // P0-4 (audit H2): evaluate is forwarded to the extension — unlike osascript_eval
    // (validated companion-side in executeCompanionTool), the evaluate security_token was
    // previously never checked, so confirm/exec binding was unenforced. When a token is
    // already present (replay/stale path where the confirmation block above was skipped
    // because security_token was pre-set), validate it binds to the code being executed.
    const evalCode = String(finalParams.code || "")
    const tokenValid = securityPolicy.validateToken(
      String(finalParams.security_token), "evaluate", evalCode,
    )
    if (!tokenValid) {
      const result = { success: false, error: "Invalid or expired security token for evaluate" }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }
    // §6.2 token-replay audit: this branch is reached when a pre-existing
    // security_token skipped the confirmation block above (agent replayed a
    // prior approved token). The token binds to evalCode and is one-time, so a
    // stale replay is already rejected above — but if the bound code carries a
    // critical API, surface it as an audit event so critical-capability use on
    // the no-confirm path stays traceable under god-mode / auto-approve.
    const replayCritical = detectCriticalApis(evalCode)
    if (replayCritical.length > 0) {
      const replayCfg = getConfig().security
      logger.info("security.critical_capability_token_replay", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        critical_apis: replayCritical,
        god_mode_active: replayCfg.allow_all_schemes === true,
        auto_approve_active: replayCfg.auto_approve_dangerous === true,
      })
    }
  }

  })()

  if (earlyResult && earlyResult.success === false) {
    return {
      ok: false,
      result: earlyResult as { success: false; error: string; data?: any },
    }
  }
  return {
    ok: true,
    finalParams,
    winL2NonceChallenge,
    hostAppTier,
  }
}
