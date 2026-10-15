import type { TestContext } from "node:test"
import { logger } from "../../src/logger"

const signals = new Set(["SIGKILL", "SIGTERM", "SIGABRT", "SIGINT", "SIGSEGV", "SIGBUS", "SIGPIPE", "SIGQUIT", "SIGHUP", "unknown"])
const codes = new Set(["ABORT_ERR", "ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "EINVAL", "ENOMEM", "EIO", "EPIPE", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "ERR_OUT_OF_RANGE", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "unknown"])

/** Preserve one minimal production failure receipt before test-data cleanup. */
export function observeWindowsOwnerFailures(t: TestContext): void {
  const warn = logger.warn
  let emitted = false
  t.mock.method(logger, "warn", (event: string, data?: Record<string, unknown>, source?: string) => {
    warn(event, data, source)
    if (event !== "process.windows_owner_probe.failed" || emitted || !data) return
    try {
      const facts: Record<string, unknown> = {
        phase: typeof data.phase === "string" && ["exec", "launch", "probe"].includes(data.phase) ? data.phase : null,
        timeout_ms: data.timeout_ms === 10000 ? 10000 : null,
      }
      for (const key of ["spawn_elapsed_ms", "callback_elapsed_ms", "close_elapsed_ms", "returned_elapsed_ms",
        "stdout_first_data_elapsed_ms", "stdout_filetime_line_elapsed_ms", "stdout_end_elapsed_ms", "stderr_first_data_elapsed_ms"])
        facts[key] = typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0 ? data[key] : null
      for (const key of ["close_exit_status", "error_code"]) {
        const value = data[key]
        facts[key] = typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 4294967295
          ? value : key === "error_code" && typeof value === "string" && codes.has(value) ? value : null
      }
      for (const key of ["close_signal", "error_signal"])
        facts[key] = typeof data[key] === "string" && signals.has(data[key]) ? data[key] : null
      for (const key of ["error_killed", "child_killed", "aborted"])
        facts[key] = typeof data[key] === "boolean" ? data[key] : null
      emitted = true
      t.diagnostic(JSON.stringify({ event, data: facts }))
    } catch { /* Diagnostic collection cannot replace the original failure. */ }
  })
}
