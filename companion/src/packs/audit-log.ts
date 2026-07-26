import * as fs from "fs"
import * as path from "path"
import { getConfigDir } from "../config"
import { logger } from "../logger"

const MAX_LINE_BYTES = 256 * 1024
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ROTATED = 3

export type CapabilityAuditEvent = {
  type: string
  at: string
  [key: string]: unknown
}

export function getAuditLogPath(override?: string): string {
  if (override) return override
  return path.join(getConfigDir(), "logs", "capability-audit.jsonl")
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return
    const st = fs.statSync(filePath)
    if (st.size <= MAX_FILE_BYTES) return
    // shift .N -> .N+1
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`
      const dst = `${filePath}.${i + 1}`
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dst)
        } catch {
          /* ignore */
        }
      }
    }
    try {
      fs.renameSync(filePath, `${filePath}.1`)
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

/**
 * Append a single JSON line to capability-audit.jsonl.
 * Contract: 0o600 file, append-only, skip oversized lines, rotate at 10MB.
 */
export function appendCapabilityAudit(event: CapabilityAuditEvent, filePath?: string): void {
  const p = getAuditLogPath(filePath)
  const dir = path.dirname(p)
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {
    /* ignore */
  }

  let line: string
  try {
    line = JSON.stringify(event)
  } catch (e: any) {
    logger.warn("capability_audit_serialize_failed", { error: e?.message || String(e) })
    return
  }
  if (Buffer.byteLength(line, "utf-8") > MAX_LINE_BYTES) {
    logger.warn("capability_audit_line_too_large", {
      type: event.type,
      bytes: Buffer.byteLength(line, "utf-8"),
    })
    return
  }

  rotateIfNeeded(p)

  try {
    fs.appendFileSync(p, line + "\n", { encoding: "utf-8" })
    try {
      fs.chmodSync(p, 0o600)
    } catch {
      /* best-effort on some FS */
    }
  } catch (e: any) {
    logger.warn("capability_audit_write_failed", { error: e?.message || String(e) })
  }
}
