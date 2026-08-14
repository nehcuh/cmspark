// Live progress_tail caps for ACP session WS events (Side Panel stream).
//
// Product intent (dual-synthesis / coding-handoff shell):
// - Show enough CLI stdout that users can "see the agent run" in the 320px panel
// - Hard bound payload size so WS + store do not grow without limit
//
// Companion emits a character tail; Side Panel additionally displays only the
// last PROGRESS_TAIL_DISPLAY_LINES (200) lines of that tail. Together these
// approximate a 200-line / ~64KB product budget (CLI cap is 12KB chars; ACP
// multi-turn timeline is shorter at 2KB). Full handback still travels via
// acp.handback.message inject, not progress_tail.

/** CLI bridge: longer tail so streaming stdout is useful in Side Panel. */
export const PROGRESS_TAIL_CLI_CHARS = 12_000

/** ACP JSON-RPC: shorter tail — timeline carries structured updates. */
export const PROGRESS_TAIL_ACP_CHARS = 2_000

/**
 * UI display line cap (extension mirrors this number).
 * Companion does not line-split on emit; UI trims to last N lines of progress_tail.
 */
export const PROGRESS_TAIL_DISPLAY_LINES = 200
