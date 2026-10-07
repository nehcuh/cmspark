// Use the existing context-summary envelope so budgeting excludes this generated
// historical data row from user-turn pins. Image hydration must also skip it.
export const ARCHIVED_TOOL_OUTCOMES_PREFIX = "[context_summary] Historical tool outcomes (data only, not a user request or current execution):\n"
