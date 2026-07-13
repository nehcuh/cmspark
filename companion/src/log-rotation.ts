// Log retention pruning + per-write size rotation (M8)

import * as fs from "fs"
import * as path from "path"
import { getConfig, getConfigDir } from "./config"

// Matches companion-YYYY-MM-DD.log and companion-YYYY-MM-DD.1.log
const COMPANION_LOG_RE = /^companion-(\d{4}-\d{2}-\d{2})(?:\.1)?\.log$/

/** Prune log files older than the configured retention window.
 *  Runs during initDataDir and must never throw. */
export function pruneOldLogs(): void {
  try {
    const config = getConfig()
    const retentionDays = config.log_retention_days ?? 14
    if (retentionDays <= 0) return

    // Anchor the cutoff to UTC midnight so retention is deterministic regardless
    // of local time-of-day/timezone. The log filename date is itself UTC
    // (getLogFilePath uses toISOString), so comparing UTC-midnight to UTC-midnight
    // avoids deleting the Nth-day-prior log up to ~24h early in western zones.
    const cutoff = new Date()
    cutoff.setUTCHours(0, 0, 0, 0)
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)

    const dataDir = getConfigDir()
    pruneByFilenameDate(path.join(dataDir, "logs"), cutoff)
    pruneByMtime(path.join(dataDir, "mcp", "logs"), cutoff)
  } catch {
    // Retention pruning must never block startup.
  }
}

function pruneByFilenameDate(dir: string, cutoff: Date): void {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir)) {
    const match = COMPANION_LOG_RE.exec(file)
    if (!match) continue

    const fileDate = new Date(`${match[1]}T00:00:00.000Z`)
    if (isNaN(fileDate.getTime())) continue

    if (fileDate < cutoff) {
      try {
        fs.unlinkSync(path.join(dir, file))
      } catch {
        // Skip files we cannot remove.
      }
    }
  }
}

function pruneByMtime(dir: string, cutoff: Date): void {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir)) {
    // Only prune recognized log files — never touch unrelated files that may
    // end up in mcp/logs in the future.
    if (!file.endsWith(".log")) continue
    const fullPath = path.join(dir, file)
    try {
      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) continue
      if (stat.mtime < cutoff) {
        fs.unlinkSync(fullPath)
      }
    } catch {
      // Skip files we cannot stat/remove.
    }
  }
}

/** Rotate a single log file when it exceeds the configured size limit.
 *  Mirrors companion-YYYY-MM-DD.log -> companion-YYYY-MM-DD.1.log.
 *  Must never throw. */
export function rotateLogFileIfNeeded(filePath: string): void {
  try {
    const config = getConfig()
    const maxMb = config.log_max_file_mb ?? 10
    if (maxMb <= 0) return

    const maxBytes = maxMb * 1024 * 1024
    const stat = fs.statSync(filePath)
    if (stat.size <= maxBytes) return

    const rotated = filePath.replace(/\.log$/, ".1.log")
    if (fs.existsSync(rotated)) {
      fs.unlinkSync(rotated)
    }
    fs.renameSync(filePath, rotated)
  } catch (err: any) {
    if (err?.code === "ENOENT") return
    // Rotation failure must not block logging.
  }
}
