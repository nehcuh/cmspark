import * as path from "path"
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
import { isVaultApp } from "./blacklist"

const execFileAsync = promisify(execFile)

const DEFAULT_LIMIT = 100
const HOST_TIMEOUT_MS = 15000

// TargetId format per docs/decisions/targetid-format-synthesis.md:
//   "macos:com.apple.<app>:<account-id>:<kind>-<stable-id>"
// Examples:
//   macos:com.apple.mail:iCloud:msg-1
//   macos:com.apple.Notes:Personal:note-42 (Phase 1 W6 — not yet implemented)
//   macos:com.apple.finder:Documents:file-12345 (Phase 1 W6 — not yet implemented)
//
// Validation: strict regex per Kimi Round 2 + Pi-sub structural finding.
// Rejects LLM-forged strings before they reach AppleScript.
const DARWIN_TARGET_RE =
  /^macos:com\.apple\.(mail|Notes|finder):[a-zA-Z0-9_\-]+:(msg|note|file)-[a-zA-Z0-9]+$/

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

interface ListMailResult {
  ids: string[]
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
 * `dist/cmspark-host` for each operation. The binary is the TCC attribution
 * anchor — see docs/decisions/phase0-macos-gate-evidence.md.
 *
 * Phase 1 W5 scope: only mail-inbox kind is implemented. note/file are
 * Phase 1 W6+ deliverables.
 */
export class DarwinHostAdapter implements HostAdapter {
  private readonly binPath: string

  constructor(binPath?: string) {
    this.binPath = binPath ?? resolveHostBinary()
  }

  async listReadTargets(kind: TargetKind, options?: ListOptions): Promise<TargetId[]> {
    if (kind !== "mail-inbox") {
      throw new Error(
        `DarwinHostAdapter.listReadTargets: kind "${kind}" not implemented in Phase 1 W5 (only mail-inbox)`,
      )
    }
    const limit = options?.limit ?? DEFAULT_LIMIT
    try {
      const result = await execFileAsync(
        this.binPath,
        ["list-mail", "--limit", String(limit)],
        { encoding: "utf-8", timeout: HOST_TIMEOUT_MS },
      )
      const parsed = parseJsonSafe<string[]>(String(result.stdout), "list-mail")
      // Validate every returned id before branding — defense in depth.
      return parsed.map((raw) => this.validateTargetId(raw))
    } catch (err: any) {
      if (err && typeof err === "object" && "stderr" in err && err.stderr) {
        throw new Error(`list-mail: ${err.stderr}`)
      }
      throw err
    }
  }

  async readOne(targetId: TargetId): Promise<ReadResult> {
    // Re-validate on consume side too — defends against TargetIds that
    // entered the system before validation was added.
    const raw = targetId as string
    if (!DARWIN_TARGET_RE.test(raw)) {
      throw new Error(`readOne: TargetId malformed (failed re-validation)`)
    }
    // Vault check: parse the app segment and reject vault apps even if the
    // id made it past the regex (e.g., regex over-matched).
    const appMatch = raw.match(/^macos:com\.apple\.([a-zA-Z]+):/)
    if (appMatch) {
      const bundle = `com.apple.${appMatch[1].toLowerCase()}`
      // Special-case: Mail is "mail" not "Mail" — regex captures case-sensitive.
      // bundle comparison uses canonical lowercase.
      const canonical = bundle === "com.apple.mail" ? "com.apple.mail"
        : bundle === "com.apple.notes" ? "com.apple.Notes"
        : bundle
      if (isVaultApp(canonical)) {
        throw new Error(`readOne: TargetId app "${canonical}" is on vault blacklist`)
      }
    }
    try {
      const result = await execFileAsync(
        this.binPath,
        ["read-message", "--target", raw],
        { encoding: "utf-8", timeout: HOST_TIMEOUT_MS },
      )
      const parsed = parseJsonSafe<Record<string, unknown>>(String(result.stdout), "read-message")
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
    const raw = targetId as string
    if (!DARWIN_TARGET_RE.test(raw)) {
      throw new Error(`writeOne: TargetId malformed (failed re-validation)`)
    }

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
          const result = await execFileAsync(
            this.binPath,
            ["create-note", "--name", name, "--body", body],
            { encoding: "utf-8", timeout: HOST_TIMEOUT_MS },
          )
          stdout = String(result.stdout)
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
          // Extract source path from TargetId. Format:
          //   macos:com.apple.finder:<folder>:file-<encoded-path>
          // For Phase 1 W6 simplicity, the source path is passed via payload
          // and TargetId is decorative. Phase 2 will encode properly.
          const sourcePath = (payload as any).source_path as string | undefined
          if (!sourcePath) {
            throw new Error("writeOne move: payload.source_path required (Phase 1 W6)")
          }
          const result = await execFileAsync(
            this.binPath,
            ["move-file", "--source", sourcePath, "--destination", payload.destination],
            { encoding: "utf-8", timeout: HOST_TIMEOUT_MS },
          )
          stdout = String(result.stdout)
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
        out.target_id = this.validateTargetId(parsed.target_id)
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
        `validateTargetId: malformed darwin TargetId (expected macos:com.apple.<app>:<account>:<kind>-<id>, got "${raw.slice(0, 80)}${raw.length > 80 ? "..." : ""}")`,
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
