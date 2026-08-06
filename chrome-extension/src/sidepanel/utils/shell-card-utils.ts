// shell_exec tool-card helpers — pure extractors for Side Panel display.
// Goal: show command + stdout/stderr as plain text, not buried JSON metadata.

/** Collapsed command line cap (single-line preview). */
export const SHELL_COMMAND_PREVIEW_CHARS = 140
/** Collapsed stdout/stderr body cap. */
export const SHELL_BODY_PREVIEW_CHARS = 900

export interface ShellCardData {
  /** Full command string (may be empty when unknown). */
  command: string
  /** Single-line command preview for the header strip. */
  commandPreview: string
  exitCode: number | null
  timedOut: boolean
  /** User/chat abort killed the process tree (distinct from wall-clock timeout). */
  aborted: boolean
  durationMs: number | null
  cwd: string | null
  stdout: string
  stderr: string
  /** Companion truncated stdout/stderr at MAX_OUTPUT. */
  outputTruncated: boolean
  /**
   * Failed for UI tone: result.success===false, non-zero exit, timed_out, or aborted.
   * Note: companion often returns success:true even when exit_code!==0 so the
   * agent can read stdout — we still flag non-zero as failed for the glyph.
   */
  failed: boolean
  /** Plain-text body for the card (stdout + optional stderr section). */
  body: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** Collapse whitespace and truncate for a one-line command chip. */
export function previewShellCommand(
  command: string,
  maxChars: number = SHELL_COMMAND_PREVIEW_CHARS,
): string {
  const one = command.replace(/\s+/g, " ").trim()
  if (!one) return ""
  if (one.length <= maxChars) return one
  return one.slice(0, Math.max(0, maxChars - 1)) + "…"
}

/** Build plain body: stdout first, then stderr if present. */
export function formatShellBody(stdout: string, stderr: string): string {
  const out = stdout.replace(/\r\n/g, "\n")
  const err = stderr.replace(/\r\n/g, "\n")
  if (out && err) return `${out}${out.endsWith("\n") ? "" : "\n"}\n[stderr]\n${err}`
  if (err) return `[stderr]\n${err}`
  return out
}

/**
 * Extract shell_exec card fields from tool params + result.
 * Returns null when this is not a shell_exec-shaped payload (caller gates on tool_name).
 */
export function extractShellCardData(
  params: unknown,
  result: unknown,
): ShellCardData {
  const p = asRecord(params)
  const command = asString(p?.command)

  const r = asRecord(result)
  const data = asRecord(r?.data)
  const successFlag = r?.success
  const topError = asString(r?.error)

  const stdout = asString(data?.stdout)
  const stderr = asString(data?.stderr) || (successFlag === false ? topError : "")
  const exitCode = asFiniteNumber(data?.exit_code)
  const timedOut = data?.timed_out === true
  const aborted = data?.aborted === true
  const durationMs = asFiniteNumber(data?.duration_ms)
  const cwd = asString(data?.cwd) || null
  const outputTruncated = data?.truncated === true

  const failed =
    successFlag === false ||
    timedOut ||
    aborted ||
    (exitCode !== null && exitCode !== 0)

  return {
    command,
    commandPreview: previewShellCommand(command),
    exitCode,
    timedOut,
    aborted,
    durationMs,
    cwd,
    stdout,
    stderr,
    outputTruncated,
    failed,
    body: formatShellBody(stdout, stderr),
  }
}

/** Meta line: exit · duration · cwd (omit empty parts). */
export function formatShellMetaLine(card: ShellCardData): string {
  const parts: string[] = []
  if (card.aborted) {
    parts.push("已停止")
  } else if (card.timedOut) {
    parts.push("超时")
  } else if (card.exitCode !== null) {
    parts.push(`exit ${card.exitCode}`)
  }
  if (card.durationMs !== null) {
    parts.push(
      card.durationMs >= 1000
        ? `${(card.durationMs / 1000).toFixed(1)}s`
        : `${card.durationMs}ms`,
    )
  }
  if (card.cwd) {
    // Show basename-ish tail for narrow side panel
    const tail = card.cwd.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/")
    if (tail) parts.push(tail)
  }
  if (card.outputTruncated) parts.push("输出已截断")
  return parts.join(" · ")
}
