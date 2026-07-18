import { promisify } from "util"
import { execFile } from "child_process"
import type {
  HostAdapter,
  TargetId,
  TargetKind,
  ListOptions,
  ReadResult,
  WritePayload,
  WriteResult,
} from "../host-adapter"
import { NotImplementedForApp, DarwinPathNotAbsolute } from "../types"
import { isVaultApp } from "./blacklist"
import { resolveHostBinary } from "./host-bin"

const execFileAsync = promisify(execFile)

const DEFAULT_LIMIT = 100
const HOST_TIMEOUT_MS = 15000

/**
 * Audit M6 — cheap win rule-4 alignment: Finder move requires BOTH paths to
 * be absolute POSIX. A relative path would resolve against the spawned
 * cmspark-host process's inherited cwd (unpredictable for a packaged app).
 */
function assertAbsolutePosix(p: unknown, field: string): asserts p is string {
  if (typeof p !== "string" || !p.startsWith("/")) {
    throw new DarwinPathNotAbsolute(`${field}=${String(p)}`)
  }
}

// TargetId format per docs/decisions/targetid-format-synthesis.md:
//   "macos:com.apple.<app>:<account-id>:<kind>-<stable-id>"
// Examples (VALIDATED form — volatile segments are base64url, see M2 below):
//   macos:com.apple.mail:aUNsb3Vk:msg-MTIzNDU          (account "iCloud", id 12345)
//   macos:com.apple.Notes:ZGVmYXVsdA:note-<b64url>     (Phase 1 W7 list-notes)
//   macos:com.apple.finder:RG9jdW1lbnRz:file-<b64url>  (Phase 1 W7 list-files)
//
// Validation: strict regex per Kimi Round 2 + Pi-sub structural finding.
// Rejects LLM-forged strings before they reach AppleScript. The validator is
// AUTHORITATIVE (win parity): both volatile segments are restricted to the
// base64url charset [A-Za-z0-9_-].
const DARWIN_TARGET_RE =
  /^macos:com\.apple\.(mail|Notes|finder):[A-Za-z0-9_\-]+:(msg|note|file)-[A-Za-z0-9_\-]+$/

// Raw producer prefix (list-*.scpt / create-note emit this form directly).
const RAW_TARGET_PREFIX_RE = /^macos:com\.apple\.(mail|Notes|finder):/

/**
 * Audit M2 — producer↔validator charset reconciliation (win base64url parity).
 *
 * The .scpt producers emit RAW TargetIds whose volatile segments (Mail/Notes
 * account names, Notes CoreData ids, URL-encoded file names) routinely
 * contain characters outside the validator charset — spaces, ".", "%", ":",
 * "/" (e.g. account "John's Gmail", note id "x-coredata://…/Note/p42", file
 * "John%27s%20report.pdf"). The pre-M2 validator rejected virtually every
 * real note/file id at the list boundary — W7 listing was broken on real
 * data.
 *
 * Following the win adapter's convention, BOTH volatile segments (account +
 * stable-id) are re-encoded base64url at the adapter's list boundary, keeping
 * the validator authoritative and strict. readOne decodes back to the exact
 * raw string the scripts/Swift binary expect (decodeTargetIdToRaw) — Buffer's
 * base64url is a bijection on UTF-8, so the list→validate→readOne round-trip
 * is lossless. The raw forms never leave the adapter boundary in validated
 * TargetIds; LLM-visible ids are always the encoded form.
 *
 * Split rule: the raw remainder after the fixed "macos:com.apple.<app>:"
 * prefix is split at the FIRST ":<kind>-" marker. Producer contract: raw
 * stable-ids never contain ":msg-"/":note-"/":file-" (mail ids are integers;
 * Notes CoreData ids contain no such substring; file names are URL-encoded by
 * the script, so a literal ":" arrives as "%3A"). An account name containing
 * the literal marker is a pathological edge — accepted and documented; the
 * producers are first-party scripts, not adversary input.
 */
export function encodeRawTargetId(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("encodeRawTargetId: empty or non-string raw TargetId from producer")
  }
  const prefixMatch = RAW_TARGET_PREFIX_RE.exec(raw)
  if (!prefixMatch) {
    throw new Error(
      `encodeRawTargetId: raw TargetId missing macos:com.apple.<app>: prefix ` +
        `(got "${raw.slice(0, 60)}${raw.length > 60 ? "..." : ""}")`,
    )
  }
  const app = prefixMatch[1]
  const rest = raw.slice(prefixMatch[0].length)
  const kindMatch = /:(msg|note|file)-/.exec(rest)
  if (!kindMatch) {
    throw new Error(
      `encodeRawTargetId: raw TargetId missing :<kind>- marker ` +
        `(got "${raw.slice(0, 60)}${raw.length > 60 ? "..." : ""}")`,
    )
  }
  const account = rest.slice(0, kindMatch.index)
  const stableId = rest.slice(kindMatch.index + kindMatch[0].length)
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url")
  return `macos:com.apple.${app}:${b64(account)}:${kindMatch[1]}-${b64(stableId)}`
}

/**
 * Inverse of encodeRawTargetId (M2): decode a VALIDATED TargetId back to the
 * exact raw string the producer emitted. Only call with ids that passed
 * validateTargetId (throws otherwise). readOne uses this to hand the Swift
 * binary the raw form its parser expects (account name in clear, raw
 * stable-id).
 */
export function decodeTargetIdToRaw(validated: string): string {
  const m = DARWIN_TARGET_RE.exec(validated)
  if (!m) {
    throw new Error("decodeTargetIdToRaw: not a validated darwin TargetId")
  }
  const seg = validated.split(":")
  // seg: ["macos", "com.apple.<app>", <account-b64url>, "<kind>-<id-b64url>"]
  const account = Buffer.from(seg[2], "base64url").toString("utf8")
  const kindAndId = seg[3]
  const dashIdx = kindAndId.indexOf("-")
  const kind = kindAndId.slice(0, dashIdx)
  const stableId = Buffer.from(kindAndId.slice(dashIdx + 1), "base64url").toString("utf8")
  return `macos:com.apple.${m[1]}:${account}:${kind}-${stableId}`
}

/**
 * Injectable spawn surface (audit M11 — aligns with win's PsRunner DI).
 * Production default spawns the real cmspark-host binary via execFile argv;
 * LLM-controlled values travel exclusively as argv elements (no shell, no
 * string interpolation). Resolves with stdout on exit 0; rejects with the
 * execFile error (carries .code and .stderr) otherwise. Unit tests inject
 * fakes and never spawn.
 */
export type DarwinRunner = (
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<string>

export const defaultDarwinRunner: DarwinRunner = async (bin, args, opts) => {
  const result = await execFileAsync(bin, args, {
    encoding: "utf-8",
    timeout: opts?.timeoutMs ?? HOST_TIMEOUT_MS,
  })
  return String(result.stdout)
}

export interface DarwinAdapterOpts {
  binPath?: string
  runner?: DarwinRunner
}

function parseJsonSafe<T>(stdout: string, label: string): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new Error(`${label}: invalid JSON from cmspark-host (${(err as Error).message})`)
  }
  return parsed as T
}

/**
 * Darwin HostAdapter implementation. Spawns the ad-hoc signed Swift binary
 * `dist/cmspark-host` for each operation (via the injectable DarwinRunner).
 * The binary is the TCC attribution anchor — see
 * docs/decisions/phase0-macos-gate-evidence.md.
 *
 * Phase 1 scope: list-mail / list-notes / list-files (W7, W5), read-message
 * (Mail only — Notes/Finder reads throw NotImplementedForApp, audit M1),
 * Notes create + Finder move (W6), Touch ID biometric (W8, via index.ts).
 */
export class DarwinHostAdapter implements HostAdapter {
  private readonly binPath: string
  private readonly runner: DarwinRunner

  // Accepts the legacy positional binPath string or an opts object (M11).
  constructor(opts?: string | DarwinAdapterOpts) {
    const o: DarwinAdapterOpts = typeof opts === "string" ? { binPath: opts } : opts ?? {}
    this.binPath = o.binPath ?? resolveHostBinary()
    this.runner = o.runner ?? defaultDarwinRunner
  }

  async listReadTargets(kind: TargetKind, options?: ListOptions): Promise<TargetId[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT
    const subcommand = (() => {
      switch (kind) {
        case "mail-inbox": return "list-mail"
        case "note": return "list-notes"
        case "file": return "list-files"
        default:
          throw new Error(
            `DarwinHostAdapter.listReadTargets: kind "${kind}" not supported`,
          )
      }
    })()
    try {
      // Audit M8: the list-*.scpt scripts enforce a FIXED top-100 cap
      // script-side — the binary cannot pass argv into a precompiled .scpt
      // without NSAppleEventDescriptor handler invocation (Phase 2). --limit
      // is intentionally NOT sent (don't pretend it's honored); the requested
      // limit is applied TS-side via slice. limit > 100 returns at most what
      // the script produced (≤100).
      const stdout = await this.runner(this.binPath, [subcommand])
      const parsed = parseJsonSafe<unknown[]>(stdout, subcommand)
      const raws = Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : []
      // Defense in depth: re-encode (M2) then validate every returned id
      // before branding — a compromised/buggy script injecting forged ids is
      // caught here (encode rejects non-producer shapes; validate enforces
      // the strict charset).
      return raws
        .slice(0, limit)
        .map((raw) => this.validateTargetId(encodeRawTargetId(raw)))
    } catch (err: any) {
      if (err && typeof err === "object" && "stderr" in err && err.stderr) {
        throw new Error(`${subcommand}: ${err.stderr}`)
      }
      throw err
    }
  }

  async readOne(targetId: TargetId): Promise<ReadResult> {
    // Re-validate on consume side too — defends against TargetIds that
    // entered the system before validation was added.
    const raw = this.validateTargetId(targetId as string) as string
    const appMatch = /^macos:com\.apple\.(mail|Notes|finder):/.exec(raw)!
    const app = appMatch[1]
    const canonical =
      app === "mail" ? "com.apple.mail"
      : app === "Notes" ? "com.apple.Notes"
      : "com.apple.finder"
    // Audit M10 — vacuous-by-construction tripwire (same shape as win's A6
    // note): DARWIN_TARGET_RE ALREADY restricts the app segment to
    // mail|Notes|finder — the three read-allowed surfaces, none of which is
    // on VAULT_BUNDLE_IDS. This vault re-check can therefore never fire; it
    // is kept as a defensive tripwire in case the regex is ever loosened.
    // (The pre-M2 regex admitted arbitrary [a-zA-Z]+ app segments, where this
    // check was load-bearing; after tightening it is provably vacuous.)
    if (isVaultApp(canonical)) {
      throw new Error(`readOne: TargetId app "${canonical}" is on vault blacklist`)
    }
    // Audit M1 (adapter level): read-message is Mail-only. Notes/Finder ids
    // fail honestly here instead of hitting the Swift binary's mail-prefix
    // parser with a confusing exit-6 error.
    if (app !== "mail") {
      throw new NotImplementedForApp(
        canonical,
        "readOne currently implements Mail messages only; Notes/Finder reads are pending",
      )
    }
    // M2: decode the base64url volatile segments back to the exact raw
    // TargetId the list script produced — the Swift binary's parseTargetId
    // expects the raw form (account name in clear, integer message id).
    const rawForBinary = decodeTargetIdToRaw(raw)
    try {
      const stdout = await this.runner(
        this.binPath,
        ["read-message", "--target", rawForBinary],
      )
      const parsed = parseJsonSafe<Record<string, unknown>>(stdout, "read-message")
      const out: ReadResult = {}
      if (typeof parsed.sender === "string") out.sender = parsed.sender
      if (typeof parsed.subject === "string") out.subject = parsed.subject
      if (typeof parsed.date_received === "string") out.date_received = parsed.date_received
      if (typeof parsed.body_preview === "string") out.body_preview = parsed.body_preview
      return out
    } catch (err: any) {
      if (err && typeof err === "object" && "stderr" in err && err.stderr) {
        throw new Error(`read-message: ${err.stderr}`)
      }
      throw err
    }
  }

  async writeOne(targetId: TargetId, payload: WritePayload): Promise<WriteResult> {
    // Re-validate TargetId on consume side.
    const raw = this.validateTargetId(targetId as string) as string

    try {
      let stdout = ""
      switch (payload.kind) {
        case "create": {
          // Phase 1 W6: only Notes create is implemented. The TargetId's app
          // segment must be "Notes"; we parse + enforce here.
          if (!raw.startsWith("macos:com.apple.Notes:")) {
            throw new Error(
              `writeOne create: Phase 1 W6 only supports Notes (got "${raw.slice(0, 40)}...")`,
            )
          }
          // payload.body is the note body. The "name" is derived from the
          // first line for now — Phase 2 can split into separate fields.
          const body = payload.body
          const name = body.split("\n")[0].slice(0, 80) || "Untitled"
          stdout = await this.runner(
            this.binPath,
            ["create-note", "--name", name, "--body", body],
          )
          break
        }
        case "move": {
          // Phase 1 W6: Finder move. TargetId encodes the source file; payload.destination
          // is the destination folder POSIX path.
          if (!raw.startsWith("macos:com.apple.finder:")) {
            throw new Error(
              `writeOne move: Phase 1 W6 only supports Finder (got "${raw.slice(0, 40)}...")`,
            )
          }
          // For Phase 1 W6 simplicity, the source path is passed via payload
          // and TargetId is decorative. Phase 2 will encode properly.
          //
          // Audit M6: BOTH paths must be absolute POSIX (enforced above via
          // assertAbsolutePosix — relative paths would resolve against the
          // spawned binary's inherited cwd).
          // Symlink semantics: the Swift side moves `POSIX file <src> as alias`
          // — `as alias` RESOLVES symlinks/Finder aliases, so moving a link
          // moves its TARGET (the original), leaving the link itself in
          // place. Callers must not assume link-preserving behavior.
          assertAbsolutePosix(payload.source_path, "source_path")
          assertAbsolutePosix(payload.destination, "destination")
          stdout = await this.runner(
            this.binPath,
            ["move-file", "--source", payload.source_path, "--destination", payload.destination],
          )
          break
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
      const parsed = parseJsonSafe<Record<string, unknown>>(stdout, "write")
      const out: WriteResult = {
        undoable: parsed.undoable === true,
      }
      if (typeof parsed.target_id === "string") {
        // M2: producers return RAW ids — re-encode before validating.
        out.target_id = this.validateTargetId(encodeRawTargetId(parsed.target_id))
      }
      return out
    } catch (err: any) {
      if (err && typeof err === "object" && "stderr" in err && err.stderr) {
        throw new Error(`write: ${err.stderr}`)
      }
      throw err
    }
  }

  validateTargetId(raw: string): TargetId {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error("validateTargetId: empty or non-string")
    }
    if (!DARWIN_TARGET_RE.test(raw)) {
      throw new Error(
        `validateTargetId: malformed darwin TargetId (expected macos:com.apple.<app>:<account>:<kind>-<id> with base64url volatile segments, got "${raw.slice(0, 80)}${raw.length > 80 ? "..." : ""}")`,
      )
    }
    // Cast at adapter boundary — Pi-sub structural fix: this is the ONLY place
    // the brand is applied, ensuring all TargetIds leaving listReadTargets are
    // validated and all TargetIds entering readOne/writeOne were either
    // produced by us or passed through this validator by companion code.
    return raw as TargetId
  }
}

// Singleton — companion process uses one adapter instance throughout its lifetime.
let _adapter: DarwinHostAdapter | undefined
export function getDarwinAdapter(): DarwinHostAdapter {
  if (!_adapter) _adapter = new DarwinHostAdapter()
  return _adapter
}
