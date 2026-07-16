import * as path from "path"
import { promisify } from "util"
import { execFile } from "child_process"
import { randomBytes } from "crypto"
import type { HostReadParams, HostReadResult } from "../types"
import { isVaultApp, isReadAllowed } from "./blacklist"

const execFileAsync = promisify(execFile)

const DEFAULT_MAX_CHARS = 500
const HOST_READ_TIMEOUT_MS = 15000

// Phase 0: CMSPARK_HOST_BIN is dev-only (lets tests inject a mock binary).
// Phase 1 must replace this with SecStaticCodeCheckValidity before ship
// (Kimi phase0 review Critical #3): an attacker who can set env vars can
// already compromise the user, but we shouldn't make it easy.
function resolveHostBinary(): string {
  if (process.env.CMSPARK_HOST_BIN) {
    if (process.env.NODE_ENV !== "production") {
      return process.env.CMSPARK_HOST_BIN
    }
    throw new Error("host_read: CMSPARK_HOST_BIN override disabled in production")
  }
  const projectRoot = path.resolve(__dirname, "../../..")
  return path.join(projectRoot, "dist", "cmspark-host")
}

function parseHostJson(stdout: string): HostReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new Error(`host_read: invalid JSON from cmspark-host (${(err as Error).message})`)
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as any).sender !== "string" ||
    typeof (parsed as any).subject !== "string" ||
    typeof (parsed as any).date_received !== "string" ||
    typeof (parsed as any).body_preview !== "string"
  ) {
    throw new Error("host_read: malformed payload from cmspark-host")
  }
  return parsed as HostReadResult
}

export async function hostRead(params: HostReadParams): Promise<HostReadResult> {
  const application = params.application ?? "com.apple.mail"
  // Defense in depth: check vault first (blacklist), then whitelist.
  // Phase 0 only allows com.apple.mail; any other bundle id is rejected
  // even if not on the vault list (Kimi phase0 review Critical #4).
  if (isVaultApp(application)) {
    throw new Error(`host_read blocked: ${application} is on the vault blacklist`)
  }
  if (!isReadAllowed(application)) {
    throw new Error(
      `host_read blocked: ${application} not in Phase 0 read whitelist (only com.apple.mail)`,
    )
  }
  const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS
  const bin = resolveHostBinary()
  try {
    const result = await execFileAsync(bin, ["read-mail", "--max-chars", String(maxChars)], {
      encoding: "utf-8",
      timeout: HOST_READ_TIMEOUT_MS,
    })
    return parseHostJson(String(result.stdout))
  } catch (err: any) {
    if (err && typeof err === "object" && "stderr" in err && err.stderr) {
      throw new Error(`host_read: ${err.stderr}`)
    }
    throw err
  }
}

/**
 * Phase 1 W8 biometric verification (Touch ID per call).
 * Round 2 §4.2 + Kimi+Pi W8 advisor Option A: ALL writes go through biometric.
 *
 * Returns the nonce on success. Throws on cancel / lockout / failure.
 * Nonce is bound to tool_call_id by caller for audit trail (W7 Q8).
 */
export async function biometricVerify(toolCallId: string, reason: string): Promise<string> {
  const bin = resolveHostBinary()
  // Generate 16-char nonce for audit binding. Not a user-facing code
  // (that's the Linux manual nonce path; macOS uses Touch ID).
  const nonce = randomBytes(8).toString("hex")
  try {
    const result = await execFileAsync(
      bin,
      ["biometric-verify", "--nonce", nonce, "--reason", reason],
      { encoding: "utf-8", timeout: 60000 },  // 60s for user to find sensor
    )
    const parsed = parseJsonSafeRaw(String(result.stdout), "biometric-verify")
    if (parsed.verified !== true || parsed.nonce !== nonce) {
      throw new Error("biometric verification returned invalid payload")
    }
    return nonce
  } catch (err: any) {
    if (err && typeof err === "object" && "stderr" in err && err.stderr) {
      throw new Error(`biometric: ${err.stderr}`)
    }
    throw err
  }
}

function parseJsonSafeRaw(stdout: string, label: string): { verified?: boolean; nonce?: string } {
  try {
    return JSON.parse(stdout)
  } catch (err) {
    throw new Error(`${label}: invalid JSON (${(err as Error).message})`)
  }
}
