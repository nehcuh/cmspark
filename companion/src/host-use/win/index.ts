// Phase 1 W8-windows — host_read entry point + Windows Hello wrapper.
//
// hostRead: classic-Outlook top-1 inbox message via PowerShell COM (data
// contract, no UI-driving). tryWindowsHello/probeWindowsHello: WinRT
// UserConsentVerifier via hello-verify.ps1 — genuine biometric tier,
// OS-hosted dialog, callable unsigned (no EV cert / UIAccess required).

import { randomBytes } from "crypto"
import type { HostReadParams, HostReadResult } from "../types"
import { WinAppNotAvailable } from "../types"
import { isVaultApp, isReadAllowed } from "./blacklist"
import {
  runPs,
  resolveWinScript,
  parsePsJson,
  rethrowPsError,
  PS_HELLO_TIMEOUT_MS,
  type PsRunner,
} from "./powershell"

const DEFAULT_MAX_CHARS = 500
const HOST_READ_TIMEOUT_MS = 15000

export async function hostRead(params: HostReadParams): Promise<HostReadResult> {
  const application = params.application ?? "win.outlook.classic"
  // Defense in depth: check vault first (blacklist), then whitelist —
  // same order as darwin (Kimi phase0 review Critical #4).
  if (isVaultApp(application)) {
    throw new Error(`host_read blocked: ${application} is on the vault blacklist`)
  }
  if (!isReadAllowed(application)) {
    throw new Error(
      `host_read blocked: ${application} not in read whitelist ` +
        `(win.outlook.classic / win.onenote.desktop / win.fs)`,
    )
  }
  // Phase 1 scope: only classic Outlook inbox reads (OneNote is create-only;
  // fs metadata goes through the adapter, not this top-1 convenience path).
  if (application !== "win.outlook.classic") {
    throw new Error(
      `host_read: ${application} read not implemented in Phase 1 (only win.outlook.classic inbox)`,
    )
  }
  const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS
  try {
    const listStdout = await runPs(
      resolveWinScript("outlook-list.ps1"),
      ["-Limit", "1"],
      { timeoutMs: HOST_READ_TIMEOUT_MS },
    )
    const list = parsePsJson<{ ids?: unknown }>(listStdout, "outlook-list")
    const ids = Array.isArray(list.ids)
      ? list.ids.filter((x): x is string => typeof x === "string")
      : []
    if (ids.length === 0) {
      throw new Error("host_read: inbox is empty (no messages)")
    }
    const readStdout = await runPs(
      resolveWinScript("outlook-read.ps1"),
      ["-TargetId", ids[0], "-MaxChars", String(maxChars)],
      { timeoutMs: HOST_READ_TIMEOUT_MS },
    )
    const parsed = parsePsJson<Record<string, unknown>>(readStdout, "outlook-read")
    if (
      typeof parsed.sender !== "string" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.date_received !== "string" ||
      typeof parsed.body_preview !== "string"
    ) {
      throw new Error("host_read: malformed payload from outlook-read.ps1")
    }
    return {
      sender: parsed.sender,
      subject: parsed.subject,
      date_received: parsed.date_received,
      body_preview: parsed.body_preview,
    }
  } catch (err: any) {
    // Typed WinAppNotAvailable (New Outlook / no COM) passes through with its
    // browser-fallback hint; raw stderr is surfaced verbatim otherwise.
    if (err instanceof WinAppNotAvailable) throw err
    rethrowPsError(err, "host_read")
  }
}

/**
 * Windows Hello result — mirrors the biometric contract:
 *   ok          → verified; nonce echoes the TS-generated challenge
 *   unavailable → no Hello hardware/policy/config (VMs, missing cameras):
 *                 NOT an error — caller downgrades to manual-nonce and logs
 *                 security.biometric.downgrade
 *   cancelled   → user dismissed the OS dialog: caller DENIES, never falls
 *                 back (adversary H1 — cancel→denied semantics preserved)
 */
export type WindowsHelloResult =
  | { ok: true; nonce: string }
  | { unavailable: true }
  | { cancelled: true }

/**
 * Availability-only probe (no dialog). Used by the L2 gate to decide whether
 * the manual-nonce challenge must ride inside the confirmation request
 * (adversary amendment A3 single-dialog routing).
 */
export async function probeWindowsHello(runner: PsRunner = runPs): Promise<boolean> {
  try {
    await runner(resolveWinScript("hello-verify.ps1"), ["-ProbeOnly"], {
      timeoutMs: HOST_READ_TIMEOUT_MS,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Interactive Windows Hello verification. Generates a 16-char hex nonce for
 * audit binding (same shape as darwin biometricVerify; NOT the user-facing
 * 6-char manual code), passes it to hello-verify.ps1, and requires an exact
 * echo in the JSON payload — a compromised script cannot fabricate success.
 *
 * `toolCallId` is accepted for contract symmetry with darwin biometricVerify;
 * the caller binds it to the nonce in the security.biometric.verified audit
 * event (W7 Q8).
 */
export async function tryWindowsHello(
  toolCallId: string,
  reason: string,
  runner: PsRunner = runPs,
): Promise<WindowsHelloResult> {
  void toolCallId // bound by caller in the audit log, not by this subprocess
  const nonce = randomBytes(8).toString("hex")
  try {
    const stdout = await runner(
      resolveWinScript("hello-verify.ps1"),
      ["-Nonce", nonce, "-Reason", reason],
      { timeoutMs: PS_HELLO_TIMEOUT_MS },
    )
    const parsed = parsePsJson<{ verified?: boolean; nonce?: string }>(
      stdout,
      "hello-verify",
    )
    if (parsed.verified !== true || parsed.nonce !== nonce) {
      throw new Error(
        "windows hello: verification returned invalid payload (nonce echo mismatch)",
      )
    }
    return { ok: true, nonce }
  } catch (err: any) {
    // Exit-code contract from hello-verify.ps1 (see script header):
    //   3 → unavailable (downgrade to manual-nonce; NOT an error)
    //   4 → user cancelled (deny; never fall back)
    //   ENOENT → powershell.exe / script missing → treat as unavailable
    if (err && typeof err === "object") {
      const code = (err as { code?: unknown }).code
      if (code === "ENOENT" || code === 3) return { unavailable: true }
      if (code === 4) return { cancelled: true }
    }
    if (err && typeof err === "object" && "stderr" in err && err.stderr) {
      throw new Error(`windows hello: ${String(err.stderr).trim()}`)
    }
    throw err
  }
}
