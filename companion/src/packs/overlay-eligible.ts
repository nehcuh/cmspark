import type { PackManifest } from "./types"

const DENY_ID = /^(appsec|netsec|shell|coding-handoff)([.-]|$)/i
const DANGEROUS_TOOL =
  /^(navigate|evaluate|osascript_eval|spawn_worker|create_tab|screenshot|get_page_|list_tabs|click|dblclick|type|fill_form|host_|computer|shell_exec|netsec_|acp_|workspace_)/i

/** Overlay may apply composition-only L0 packs. Server SoT — not UI gray. */
export function isOverlayEligiblePack(m: PackManifest | null | undefined): boolean {
  if (!m) return false
  if (m.trust) return false
  if (m.min_capability && m.min_capability !== "L0") return false
  if (Array.isArray(m.mcp_servers) && m.mcp_servers.length > 0) return false
  if (m.board_mode === true) return false
  if (DENY_ID.test(String(m.id || ""))) return false
  const allow = m.tools?.allow || []
  if (allow.some((t) => DANGEROUS_TOOL.test(String(t)))) return false
  return true
}
