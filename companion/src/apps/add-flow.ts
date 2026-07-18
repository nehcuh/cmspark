// App tab (WP2) — add-flow: turn an enumeration pick or a manual path paste
// into a validated AppEntry + D8 warning set.
//
// Pipeline (path entries):
//   expand %ENV% → require absolute + .exe → path.resolve → fs.realpathSync
//   (junction + 8.3 canonicalization — review note ②: user_writable_dir is
//   stamped from the REALPATH-canonicalized path, never from the raw input)
//   → D1 guards (lolbin hard deny / vault-cli deny / vault-gui no-templates)
//   → signer probe (Get-AuthenticodeSignature via apps-signer.ps1, argv-only)
//   → AppEntry { source: "user", policy: "manual" (caller may upgrade-gate) }
//
// D8 warnings are returned as {code, message} pairs so the add dialog can
// render signer state, blocklist proximity, user-writable and origin markers
// (manual paste is explicitly named a social bridge).

import * as fs from "fs"
import * as path from "path"
import {
  runPs,
  resolveWinScript,
  parsePsJson,
  type PsRunner,
} from "../host-use/win/powershell"
import {
  AppEntry,
  AppKind,
  isUserWritablePath,
  validateAppEntry,
} from "./types"
import { checkAddAllowed } from "./guards"

export interface AddFlowWarning {
  code:
    | "unsigned_binary"
    | "user_writable_dir"
    | "manual_paste_origin"
    | "vault_app_no_templates"
    | "aumid_no_signer"
    | "signer_probe_failed"
  message: string
}

export type AddFlowOrigin = "enumerate" | "manual-paste"

export interface AddFlowInput {
  kind: AppKind
  /** win32 exe path (paste or enumeration pick). Exactly one of path/aumid. */
  path?: string
  /** UWP AUMID from an enumeration pick. */
  aumid?: string
  /** Display name (enumeration name or user-supplied); falls back to exe basename. */
  displayName?: string
  origin: AddFlowOrigin
  /** Existing entries — used for duplicate detection and token-slug uniqueness. */
  existingEntries: Record<string, AppEntry>
  /** Requested policy; persisted only after the caller's gates. Default "manual". */
  policy?: AppEntry["policy"]
}

export interface AddFlowDeps {
  realpath?: (p: string) => string
  exists?: (p: string) => boolean
  /** Returns the Authenticode signer Subject, or undefined when unsigned/probe failed. */
  signerProbe?: (exePath: string) => Promise<string | undefined>
  /** Token generator override for tests. Default: crypto.randomUUID-based suffixes. */
  now?: () => Date
}

/** Typed error the WS layer can map to a stable code for the UI. */
export class AddFlowError extends Error {
  constructor(
    public code:
      | "path_and_aumid_exclusive"
      | "absolute_path_required"
      | "not_an_exe"
      | "not_found"
      | "lolbin_denied"
      | "vault_cli_denied"
      | "duplicate_app",
    message: string,
  ) {
    super(message)
    this.name = "AddFlowError"
  }
}

/** Expand %VAR% sequences (manual pastes often carry them) against process.env. */
export function expandEnvVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (m, name) => {
    const v = process.env[String(name)]
    return typeof v === "string" && v ? v : m
  })
}

const AUMID_PATTERN = /^[\w.\-]+![\w.\-]+$/

/** Slug must satisfy the slug part of APP_TOKEN_PATTERN: ^[a-z0-9][a-z0-9_\-]{1,31}$ */
function slugify(raw: string): string {
  let s = String(raw || "").toLowerCase()
  s = s.replace(/\.exe$/i, "")
  s = s.replace(/[^a-z0-9_\-]+/g, "_").replace(/^_+|_+$/g, "")
  if (!/^[a-z0-9]/.test(s)) s = `app${s ? "_" + s : ""}`
  if (s.length < 2) s = "app"
  if (s.length > 32) s = s.slice(0, 32)
  return s
}

function uniqueToken(baseSlug: string, kind: AppKind, existing: Record<string, AppEntry>): string {
  const ns = kind === "cli" ? "win.cli" : "win.app"
  for (let i = 0; i < 100; i++) {
    const slug = i === 0 ? baseSlug : `${baseSlug.slice(0, 29)}_${i + 1}`
    const token = `${ns}.${slug}`
    if (!existing[token]) return token
  }
  // Practically unreachable; still deterministic.
  return `${ns}.${baseSlug.slice(0, 20)}_${Date.now().toString(36)}`.slice(0, 41)
}

/** Default signer probe — apps-signer.ps1 via the argv-only runPs infra. */
export async function probeSigner(
  exePath: string,
  runner: PsRunner = runPs,
): Promise<string | undefined> {
  const stdout = await runner(
    resolveWinScript("apps-signer.ps1"),
    ["-TargetPath", exePath],
    { timeoutMs: 15000 },
  )
  const parsed = parsePsJson<{ signer?: unknown }>(stdout, "apps-signer")
  return typeof parsed.signer === "string" && parsed.signer ? parsed.signer : undefined
}

/**
 * Build a validated AppEntry from an add request. Throws AddFlowError (typed)
 * on denial/invalid input; validateAppEntry is re-run on the result as a belt
 * (the persisted entry must always satisfy the WP1 schema).
 */
export async function buildAppEntry(
  input: AddFlowInput,
  deps: AddFlowDeps = {},
): Promise<{ entry: AppEntry; warnings: AddFlowWarning[] }> {
  const realpath = deps.realpath ?? ((p: string) => fs.realpathSync(p))
  const exists = deps.exists ?? ((p: string) => fs.existsSync(p))
  const signerProbe = deps.signerProbe ?? ((p: string) => probeSigner(p))
  const now = deps.now ?? (() => new Date())
  const warnings: AddFlowWarning[] = []

  const hasPath = typeof input.path === "string" && input.path.length > 0
  const hasAumid = typeof input.aumid === "string" && input.aumid.length > 0
  if (hasPath === hasAumid) {
    throw new AddFlowError("path_and_aumid_exclusive", "apps.add requires exactly one of path / aumid")
  }

  // ---- AUMID branch (UWP enumeration pick) --------------------------------
  if (hasAumid) {
    const aumid = input.aumid!.trim()
    if (!AUMID_PATTERN.test(aumid)) {
      throw new AddFlowError("not_an_exe", `invalid aumid "${aumid}" (must match PackageFamilyName!AppId)`)
    }
    for (const e of Object.values(input.existingEntries)) {
      if (e.aumid && e.aumid.toLowerCase() === aumid.toLowerCase()) {
        throw new AddFlowError("duplicate_app", `aumid "${aumid}" is already registered as "${e.token}"`)
      }
    }
    const display = input.displayName?.trim() || aumid.split("!")[0].split(".")[0] || aumid
    const token = uniqueToken(slugify(display), "gui", input.existingEntries)
    // Review note ⑤: AUMID entries always cap "ai" (no signer on record).
    warnings.push({
      code: "aumid_no_signer",
      message: "UWP 应用无签名记录，最高可设策略为「AI 判断」（不可全自动）",
    })
    if (input.origin === "manual-paste") {
      warnings.push({
        code: "manual_paste_origin",
        message: "来源为手动粘贴（非系统枚举）——请确认这是你自己要添加的应用",
      })
    }
    const entry: AppEntry = {
      token,
      kind: "gui",
      display_name: display,
      source: "user",
      policy: input.policy ?? "manual",
      enabled: true,
      added_at: now().toISOString(),
      aumid,
    }
    const schemaErr = validateAppEntry(entry)
    if (schemaErr) throw new AddFlowError("not_an_exe", `internal: built entry failed schema: ${schemaErr}`)
    return { entry, warnings }
  }

  // ---- exe path branch -----------------------------------------------------
  const expanded = expandEnvVars(input.path!.trim().replace(/^"|"$/g, ""))
  if (!path.isAbsolute(expanded)) {
    throw new AddFlowError("absolute_path_required", `apps.add requires an absolute path (got "${expanded}")`)
  }
  if (!/\.exe$/i.test(expanded)) {
    throw new AddFlowError("not_an_exe", `apps.add only accepts .exe targets or AUMIDs (got "${expanded}")`)
  }
  const resolved = path.resolve(expanded)
  if (!exists(resolved)) {
    throw new AddFlowError("not_found", `file not found: ${resolved}`)
  }
  // REALPATH canonicalization: resolves junctions/symlinks AND 8.3 short-name
  // aliases — isUserWritablePath on the raw input would miss both (review ②).
  let canonical: string
  try {
    canonical = realpath(resolved)
  } catch (e: any) {
    throw new AddFlowError("not_found", `cannot canonicalize path: ${e?.message || String(e)}`)
  }

  const verdict = checkAddAllowed(canonical, input.kind)
  if (!verdict.allowed) {
    throw new AddFlowError(
      verdict.reason === "lolbin" ? "lolbin_denied" : "vault_cli_denied",
      verdict.detail,
    )
  }

  // Duplicate detection on the canonical path (8.3/junction aliases collapse).
  const canonicalLower = canonical.toLowerCase()
  for (const e of Object.values(input.existingEntries)) {
    if (e.exe?.path && e.exe.path.toLowerCase() === canonicalLower) {
      throw new AddFlowError("duplicate_app", `"${canonical}" is already registered as "${e.token}"`)
    }
  }

  const userWritable = isUserWritablePath(canonical)
  if (userWritable) {
    warnings.push({
      code: "user_writable_dir",
      message: "位于用户可写目录——同用户进程可替换此文件；最高可设策略为「AI 判断」",
    })
  }

  let signer: string | undefined
  try {
    signer = await signerProbe(canonical)
  } catch {
    signer = undefined
    warnings.push({
      code: "signer_probe_failed",
      message: "签名检测失败，按未签名处理（最高可设策略为「AI 判断」）",
    })
  }
  if (!signer && !warnings.some((w) => w.code === "signer_probe_failed")) {
    warnings.push({
      code: "unsigned_binary",
      message: "未签名二进制——最高可设策略为「AI 判断」（不可全自动）",
    })
  }

  if (verdict.vaultToken && !verdict.templatesAllowed) {
    warnings.push({
      code: "vault_app_no_templates",
      message: `映射到保险柜应用 ${verdict.vaultToken}——仅允许无参启动，永不支持参数模板`,
    })
  }
  if (input.origin === "manual-paste") {
    warnings.push({
      code: "manual_paste_origin",
      message: "来源为手动粘贴（非系统枚举）——这是社会工程桥梁，请确认路径是你自己输入的",
    })
  }

  const display = input.displayName?.trim() || path.basename(canonical).replace(/\.exe$/i, "")
  // Slug source: exe basename first (stable, usually latin) — a CJK display
  // name would sanitize to the useless "app".
  const token = uniqueToken(slugify(path.basename(canonical)), input.kind, input.existingEntries)
  const entry: AppEntry = {
    token,
    kind: input.kind,
    display_name: display,
    source: "user",
    policy: input.policy ?? "manual",
    enabled: true,
    added_at: now().toISOString(),
    exe: {
      path: canonical,
      ...(signer ? { signer } : {}),
      user_writable_dir: userWritable,
    },
  }
  const schemaErr = validateAppEntry(entry)
  if (schemaErr) throw new AddFlowError("not_an_exe", `internal: built entry failed schema: ${schemaErr}`)
  return { entry, warnings }
}
