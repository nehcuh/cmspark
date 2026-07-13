// Process-global fatal handlers — crash logging + fail-fast exit.
//
// Extracted from index.ts so the behavior is unit-testable via a spawned
// child (mirrors daemon.ts exporting setupGracefulShutdown). index.ts calls
// installFatalHandlers() at startup; see crash-handlers.test.ts.

import * as fs from "fs"
import * as path from "path"

/**
 * Append a crash diagnostic to ~/.cmspark-agent/logs/crash.log before the
 * process exits, so headless/daemon processes leave diagnostics even without a
 * console window. Best-effort: never throws (we are already in a fatal path).
 */
export function writeCrashLog(label: string, err: unknown): void {
  try {
    const logDir = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".cmspark-agent", "logs")
    fs.mkdirSync(logDir, { recursive: true })
    const logFile = path.join(logDir, "crash.log")
    const ts = new Date().toISOString()
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    fs.appendFileSync(logFile, `[${ts}] ${label}: ${msg}\n`)
  } catch {
    /* nothing we can do at this point */
  }
  console.error(`[${label}]`, err)
}

/**
 * Install process-global fatal handlers for uncaughtException and
 * unhandledRejection. Both write a crash log then exit(1).
 *
 * Why unhandledRejection is fatal (P2-2 M6): an unhandled rejection means the
 * `.catch` that should have run did not — some side effect (DB write, lock
 * release, state update) is now missing and the process is in an undefined
 * state. For a single-process agent holding history.db + in-flight tool loops,
 * continuing risks silent corruption (worse than the audit's C2 class). Fail
 * fast so the next start is clean; crash.log captures diagnostics. This aligns
 * with Node >= v15's default `--unhandled-rejections=throw` semantics.
 *
 * Availability note: no supervisor auto-restart on any platform (launchd
 * KeepAlive=false / systemd Restart=no default / schtasks onlogon), but that
 * gap already applies to uncaughtException — cross-platform restart strategy
 * is tracked as a separate follow-up, not coupled here.
 */
export function installFatalHandlers(): void {
  process.on("uncaughtException", (err) => {
    writeCrashLog("uncaughtException", err)
    process.exit(1)
  })

  process.on("unhandledRejection", (reason) => {
    writeCrashLog("unhandledRejection", reason)
    process.exit(1)
  })
}
