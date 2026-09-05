/**
 * SURFACE_BY_TOOL — single table for UI mode elevation (C11 multi-adv).
 *
 * L0 = chat-only (no browser/desktop elevation from this tool alone)
 * L1 = browser CDP / extension surface
 * L2 = host / CU / enterprise shell-netsec class (confirm desk / computer mode)
 *
 * mode-controller imports COMPUTER_CLASS_TOOLS / BROWSER_TOOL_NAMES derived from this table.
 * Keep in mind: this is UI mode elevation, not companion L2 forceConfirm algebra.
 */

export type SurfaceLevel = "L0" | "L1" | "L2"

/** Tool → surface level. Missing tools default to L0 for mode derivation. */
export const SURFACE_BY_TOOL: Readonly<Record<string, SurfaceLevel>> = {
  // --- L1 browser CDP ---
  list_tabs: "L1",
  create_tab: "L1",
  close_tab: "L1",
  navigate: "L1",
  screenshot: "L1",
  get_page_text: "L1",
  get_page_html: "L1",
  get_element_info: "L1",
  click: "L1",
  dblclick: "L1",
  type: "L1",
  fill_form: "L1",
  scroll: "L1",
  scroll_to: "L1",
  press_key: "L1",
  hover: "L1",
  select_option: "L1",
  drag_and_drop: "L1",
  wait_for: "L1",
  evaluate: "L1",
  get_cookies: "L1",
  set_cookie: "L1",
  delete_cookie: "L1",
  list_all_cookies: "L1",
  set_tab_url: "L1",
  browser_download: "L1",
  downloads_find: "L1",
  upload_file: "L1",
  analyze_image: "L1",
  analyze_image_url: "L1",

  // --- L2 host / CU / enterprise ---
  host_computer: "L2",
  host_app: "L2",
  host_read: "L2",
  host_write: "L2",
  host_cli: "L2",
  shell_exec: "L2",
  netsec_port_scan: "L2",
  osascript_eval: "L2",
  spawn_worker: "L2",
  spawn_expert_team: "L2",
  ask_user: "L2",
  board_complete: "L2",
  skill_install: "L2",
}

export function surfaceLevelForTool(name: string): SurfaceLevel {
  return SURFACE_BY_TOOL[name] || "L0"
}

export function toolsAtSurface(level: SurfaceLevel): ReadonlySet<string> {
  const out = new Set<string>()
  for (const [tool, lvl] of Object.entries(SURFACE_BY_TOOL)) {
    if (lvl === level) out.add(tool)
  }
  return out
}
