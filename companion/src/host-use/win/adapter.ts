// Phase 1 W8-windows — Windows HostAdapter.
//
// Satisfies the HostAdapter DATA contract without any UI-driving (no
// UIAutomation / SetForegroundWindow / SendInput — those need UIAccess + EV
// cert and remain NON-goals, see RUNBOOK-phase0.md):
//   - mail-inbox: classic Outlook COM via PowerShell (read-only)
//   - note:       OneNote desktop COM via PowerShell (create-only)
//   - file:       Node fs, restricted to %USERPROFILE%\{Documents,Desktop,
//                 Downloads} (hardening W-1 — no TCC-equivalent on Windows,
//                 so blast radius is capped by construction)

import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import type {
  HostAdapter,
  TargetId,
  TargetKind,
  ListOptions,
  ReadResult,
  WritePayload,
  WriteResult,
} from "../host-adapter"
import { WinPathOutsideAllowlist } from "../types"
import { isVaultApp } from "./blacklist"
import {
  runPs,
  resolveWinScript,
  parsePsJson,
  rethrowPsError,
  type PsRunner,
} from "./powershell"

const DEFAULT_LIMIT = 100

// TargetId format per docs/decisions/windows-host-use-plan.md §B:
//   "win:<app>:<account-or-root>:<kind>-<stable-id>"
//   app ∈ {outlook, onenote, fs}; kind ∈ {msg, note, file}
// Examples:
//   win:outlook:user_example_com:msg-1A2B3C...  (MAPI EntryID hex)
//   win:onenote:unfiled:note-<sanitized-page-id>
//   win:fs:documents:file-<base64url(relative-path)>
//
// Regex tightened per adversary amendment A5: the stable-id charset is
// [A-Za-z0-9_-] — base64url has no "+"/"." and EntryID hex has no ".".
// Runtime rules 3/4 below backstop per-kind structure.
const WIN_TARGET_RE =
  /^win:(outlook|onenote|fs):[A-Za-z0-9_\-]+:(msg|note|file)-[A-Za-z0-9_\-]+$/

const WIN_FS_ROOT_TOKENS = ["documents", "desktop", "downloads"] as const
type WinFsRootToken = (typeof WIN_FS_ROOT_TOKENS)[number]

export interface FsStatLike {
  isFile(): boolean
  isDirectory(): boolean
  mtime: Date
  size: number
}

/**
 * Injectable fs surface — unit tests never touch the real filesystem.
 * Defaults bind node's sync fs functions.
 */
export interface FsOps {
  readdirSync(dir: string): string[]
  statSync(p: string): FsStatLike
  realpathSync(p: string): string
  renameSync(src: string, dest: string): void
  existsSync(p: string): boolean
}

const defaultFsOps: FsOps = {
  readdirSync: (dir) => fs.readdirSync(dir),
  statSync: (p) => fs.statSync(p),
  realpathSync: (p) => fs.realpathSync(p),
  renameSync: (src, dest) => fs.renameSync(src, dest),
  existsSync: (p) => fs.existsSync(p),
}

/**
 * Allowlist boundary check (adversary amendment A2 — MUST-FIX). A bare
 * startsWith(root) would admit sibling prefixes like "Documents2" /
 * "Documents-evil"; the boundary must be exact-match OR root + path.sep.
 * Case-insensitive: NTFS is case-preserving but case-insensitive.
 */
export function isWithinRoot(resolved: string, root: string): boolean {
  const resolvedLower = resolved.toLowerCase()
  const rootLower = root.toLowerCase()
  return resolvedLower === rootLower || resolvedLower.startsWith(rootLower + path.sep)
}

function encodeFileId(rootToken: string, relPath: string): string {
  return `win:fs:${rootToken}:file-${Buffer.from(relPath, "utf8").toString("base64url")}`
}

export class WinHostAdapter implements HostAdapter {
  private readonly runner: PsRunner
  private readonly fsOps: FsOps
  private readonly userProfile: string

  constructor(opts?: { runner?: PsRunner; fsOps?: FsOps; userProfile?: string }) {
    this.runner = opts?.runner ?? runPs
    this.fsOps = opts?.fsOps ?? defaultFsOps
    // %USERPROFILE% — homedir() fallback for exotic service contexts.
    this.userProfile = opts?.userProfile ?? process.env.USERPROFILE ?? os.homedir()
  }

  private rootPaths(): Array<{ token: WinFsRootToken; path: string }> {
    return [
      { token: "documents", path: path.join(this.userProfile, "Documents") },
      { token: "desktop", path: path.join(this.userProfile, "Desktop") },
      { token: "downloads", path: path.join(this.userProfile, "Downloads") },
    ]
  }

  private assertInsideRoots(resolved: string): void {
    if (!this.rootPaths().some((r) => isWithinRoot(resolved, r.path))) {
      throw new WinPathOutsideAllowlist(resolved)
    }
  }

  async listReadTargets(kind: TargetKind, options?: ListOptions): Promise<TargetId[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT
    switch (kind) {
      case "mail-inbox": {
        try {
          const stdout = await this.runner(
            resolveWinScript("outlook-list.ps1"),
            ["-Limit", String(limit)],
          )
          const parsed = parsePsJson<{ ids?: unknown }>(stdout, "outlook-list")
          const ids = Array.isArray(parsed.ids)
            ? parsed.ids.filter((x): x is string => typeof x === "string")
            : []
          // Validate every returned id before branding — defense in depth
          // against a compromised/buggy script injecting forged ids.
          return ids.map((raw) => this.validateTargetId(raw))
        } catch (err: any) {
          rethrowPsError(err, "outlook-list")
        }
      }
      case "file": {
        // Metadata listing of allowlisted roots (files only, mtime desc).
        const entries: Array<{ rootToken: WinFsRootToken; name: string; mtimeMs: number }> = []
        for (const root of this.rootPaths()) {
          let names: string[]
          try {
            names = this.fsOps.readdirSync(root.path)
          } catch {
            continue // missing root (e.g. no Desktop) is not an error
          }
          for (const name of names) {
            try {
              const st = this.fsOps.statSync(path.join(root.path, name))
              if (st.isFile()) {
                entries.push({ rootToken: root.token, name, mtimeMs: st.mtime.getTime() })
              }
            } catch {
              // unreadable entry — skip, never abort the listing
            }
          }
        }
        entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
        return entries
          .slice(0, limit)
          .map((e) => this.validateTargetId(encodeFileId(e.rootToken, e.name)))
      }
      case "note":
        throw new Error(
          "WinHostAdapter.listReadTargets: note listing not implemented in Phase 1 (OneNote is create-only, darwin parity)",
        )
      default:
        throw new Error(`WinHostAdapter.listReadTargets: kind "${kind}" not supported`)
    }
  }

  async readOne(targetId: TargetId): Promise<ReadResult> {
    // Re-validate on consume side too — defends against TargetIds that
    // entered the system before validation was added.
    const raw = this.validateTargetId(targetId as string) as string
    const seg = raw.split(":")
    const app = seg[1]
    // Adversary amendment A6: unlike darwin (which reconstructs a bundle id
    // from the TargetId app segment to re-check the vault blacklist), the win
    // TargetId grammar ALREADY restricts the app segment to outlook|onenote|fs
    // — the three read-allowed surfaces. This vault re-check is therefore a
    // defensive, vacuous-by-construction tripwire; do NOT replicate darwin's
    // app-segment string reconstruction here.
    if (isVaultApp(`win.${app}`)) {
      throw new Error(`readOne: TargetId app "win.${app}" is on vault blacklist`)
    }

    if (raw.startsWith("win:outlook:") && seg[3]?.startsWith("msg-")) {
      try {
        const stdout = await this.runner(
          resolveWinScript("outlook-read.ps1"),
          ["-TargetId", raw],
        )
        const parsed = parsePsJson<Record<string, unknown>>(stdout, "outlook-read")
        const out: ReadResult = {}
        if (typeof parsed.sender === "string") out.sender = parsed.sender
        if (typeof parsed.subject === "string") out.subject = parsed.subject
        if (typeof parsed.date_received === "string") out.date_received = parsed.date_received
        if (typeof parsed.body_preview === "string") out.body_preview = parsed.body_preview
        return out
      } catch (err: any) {
        rethrowPsError(err, "outlook-read")
      }
    }

    if (raw.startsWith("win:fs:") && seg[3]?.startsWith("file-")) {
      // Metadata-only read (plan §D.12): file_path + mtime. Content reads go
      // through MCP filesystem, never host_read.
      const rel = decodeFileRelPath(raw)
      const rootToken = seg[2] as WinFsRootToken
      const root = this.rootPaths().find((r) => r.token === rootToken)
      if (!root) {
        throw new Error(`readOne: unknown fs root "${rootToken}"`)
      }
      const full = path.resolve(root.path, rel)
      this.assertInsideRoots(full)
      // Junction mitigation: the parent dir must also resolve inside the root.
      this.assertInsideRoots(this.fsOps.realpathSync(path.dirname(full)))
      const st = this.fsOps.statSync(full)
      return {
        file_path: full,
        file_mtime: st.mtime.toISOString(),
      }
    }

    throw new Error(
      "readOne: TargetId app/kind not implemented in Phase 1 " +
        "(outlook msg read + fs metadata read only; OneNote is create-only, darwin parity)",
    )
  }

  async writeOne(targetId: TargetId, payload: WritePayload): Promise<WriteResult> {
    // Re-validate TargetId on consume side.
    const raw = this.validateTargetId(targetId as string) as string

    switch (payload.kind) {
      case "create": {
        if (!raw.startsWith("win:onenote:")) {
          throw new Error(
            `writeOne create: Phase 1 only supports OneNote (got "${raw.slice(0, 40)}...")`,
          )
        }
        // Same convention as darwin: first line (≤80 chars) becomes the title.
        const name = payload.body.split("\n")[0].slice(0, 80) || "Untitled"
        try {
          const stdout = await this.runner(
            resolveWinScript("onenote-create.ps1"),
            ["-Name", name, "-Body", payload.body],
          )
          const parsed = parsePsJson<Record<string, unknown>>(stdout, "onenote-create")
          const out: WriteResult = { undoable: parsed.undoable === true }
          if (typeof parsed.target_id === "string") {
            out.target_id = this.validateTargetId(parsed.target_id)
          }
          return out
        } catch (err: any) {
          rethrowPsError(err, "onenote-create")
        }
      }
      case "move": {
        if (!raw.startsWith("win:fs:")) {
          throw new Error(
            `writeOne move: Phase 1 only supports fs targets (got "${raw.slice(0, 40)}...")`,
          )
        }
        // Hardening W-1 + adversary amendment A2 (MUST-FIX): BOTH source and
        // destination must stay inside %USERPROFILE%\{Documents,Desktop,
        // Downloads}. The boundary check (exact match OR root + path.sep) is
        // applied TWICE per side: once to the path.resolve() result and once
        // to fs.realpathSync(parent) — defeats "Documents2"/"Documents-evil"
        // sibling-prefix escapes and junctioned parent dirs.
        const resolvedSource = path.resolve(payload.source_path)
        const resolvedDest = path.resolve(payload.destination)
        this.assertInsideRoots(resolvedSource)
        this.assertInsideRoots(resolvedDest)
        this.assertInsideRoots(this.fsOps.realpathSync(path.dirname(resolvedSource)))
        this.assertInsideRoots(this.fsOps.realpathSync(path.dirname(resolvedDest)))
        // Extra beyond the amendment: if the destination dir itself exists,
        // realpath it too — a junctioned destination dir would otherwise
        // redirect the move outside the allowlist.
        if (this.fsOps.existsSync(resolvedDest)) {
          this.assertInsideRoots(this.fsOps.realpathSync(resolvedDest))
        }
        try {
          this.fsOps.renameSync(
            resolvedSource,
            path.join(resolvedDest, path.basename(resolvedSource)),
          )
        } catch (err: any) {
          if (err && typeof err === "object" && err.code === "EXDEV") {
            throw new Error(
              "writeOne move: cross-device move not supported (EXDEV) — source and destination must be on the same volume",
            )
          }
          throw err
        }
        return { undoable: true }
      }
      case "update":
        throw new Error(
          "writeOne update: not implemented in Phase 1 W6 (deferred to W7+)",
        )
      case "delete":
        throw new Error(
          "writeOne delete: requires biometric confirmation — Phase 1 W7+ deliverable",
        )
      default:
        throw new Error(`writeOne: unknown payload kind "${(payload as any).kind}"`)
    }
  }

  validateTargetId(raw: string): TargetId {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error("validateTargetId: empty or non-string")
    }
    // Runtime rule 2: cross-platform forged ids rejected with a distinct error.
    if (raw.startsWith("macos:") || raw.startsWith("linux:")) {
      throw new Error(
        `validateTargetId: wrong-platform TargetId (expected win:..., got "${raw.slice(0, 40)}")`,
      )
    }
    if (!WIN_TARGET_RE.test(raw)) {
      throw new Error(
        `validateTargetId: malformed win TargetId (expected win:<app>:<account-or-root>:<kind>-<id>, got "${raw.slice(0, 80)}${raw.length > 80 ? "..." : ""}")`,
      )
    }
    const seg = raw.split(":")
    const app = seg[1]
    const account = seg[2]
    const kindAndId = seg[3]
    const dashIdx = kindAndId.indexOf("-")
    const kind = kindAndId.slice(0, dashIdx)
    const id = kindAndId.slice(dashIdx + 1)

    // Runtime rule 3: msg ids are MAPI EntryID hex, at least 8 chars.
    if (kind === "msg" && !/^[0-9A-Fa-f]{8,}$/.test(id)) {
      throw new Error("validateTargetId: msg id must be EntryID hex (>= 8 chars)")
    }
    if (app === "fs" && kind === "file") {
      // Runtime rule 4a: fs root segment must be one of the allowlisted roots.
      if (!(WIN_FS_ROOT_TOKENS as readonly string[]).includes(account)) {
        throw new Error(
          `validateTargetId: fs root "${account}" not in {documents, desktop, downloads}`,
        )
      }
      // Runtime rule 4b: base64url must decode to a RELATIVE path — reject
      // drive letters, leading \/ , UNC, and ".." segments.
      validateDecodedRelPath(id)
    }
    // Cast at adapter boundary — same branding contract as darwin: this is
    // the ONLY place the brand is applied.
    return raw as TargetId
  }
}

function decodeFileRelPath(raw: string): string {
  const seg = raw.split(":")
  const id = seg[3].slice("file-".length)
  return validateDecodedRelPath(id)
}

function validateDecodedRelPath(base64urlId: string): string {
  const decoded = Buffer.from(base64urlId, "base64url").toString("utf8")
  if (decoded.length === 0) {
    throw new Error("validateTargetId: file id decodes to empty path")
  }
  if (/^[A-Za-z]:/.test(decoded)) {
    throw new Error("validateTargetId: file id must decode to a relative path (drive letter rejected)")
  }
  if (decoded.startsWith("/") || decoded.startsWith("\\")) {
    throw new Error("validateTargetId: file id must decode to a relative path (absolute/UNC rejected)")
  }
  const segments = decoded.split(/[\\/]+/)
  if (segments.some((s) => s === "..")) {
    throw new Error("validateTargetId: file id must not contain '..' segments")
  }
  return decoded
}

// Singleton — companion process uses one adapter instance throughout its lifetime.
let _adapter: WinHostAdapter | undefined
export function getWinAdapter(): WinHostAdapter {
  if (!_adapter) _adapter = new WinHostAdapter()
  return _adapter
}
