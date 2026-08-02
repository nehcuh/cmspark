// Mission Pack types — see docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md

export type PackChannel = "community" | "enterprise"
export type MinCapability = "L0" | "L1" | "L2"
export type ToolsMode = "allowlist" | "intersect" | "unchanged"
export type SelectionMode = "auto" | "all" | "manual"
/** Who authored the pack: builtin/installed are read-only in UI; user can edit/delete. */
export type PackOrigin = "builtin" | "installed" | "user"

export interface PackTools {
  mode: ToolsMode
  allow: string[]
  deny: string[]
}

export interface PackThreadDefaults {
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  mcp_selection_mode?: SelectionMode
}

export interface PackManifest {
  schema_version: number
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  min_capability: MinCapability
  requires_modules: string[]
  /**
   * Pack-local skill files (relative paths under pack dir).
   * Installed as namespaced `pack--{id}--{name}` skills on apply/install.
   */
  skills: string[]
  /**
   * References to already-installed global skill names (not pack-local paths).
   * When present (including empty array), apply uses these + pack-local skills
   * as thread.active_skill_ids instead of falling back to pre-pack skills.
   */
  skill_refs?: string[]
  knowledge: string[]
  mcp_servers: string[]
  tools: PackTools
  system_prompt_append: string
  /**
   * ADR-016: when true, pack apply enables thread.board_mode and structured
   * collect_handback is required (Fact/Intent JSON). Default undefined = off.
   */
  board_mode?: boolean
  thread_defaults?: PackThreadDefaults
  workspace?: { type: "none" | "local_path" }
  author?: string
  tags?: string[]
  /** Authorship channel for UI editability. Default treated as installed. */
  origin?: PackOrigin
  /** Optional UX copy for scene apply modal (product SoT). */
  ui?: {
    suitable_for?: string
    unsuitable_for?: string
    tools_summary_zh?: string
  }
}

export interface ThreadPackSnapshot {
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  mcp_selection_mode?: SelectionMode
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
}

export interface PackListItem {
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  min_capability: MinCapability
  requires_modules: string[]
  apply_blocked?: string | null
  installed_path: string
  suitable_for?: string
  unsuitable_for?: string
  tools_summary_zh?: string
  /** User-authored scenes are editable/deletable in Side Panel. */
  origin?: PackOrigin
  skill_refs?: string[]
  mcp_servers?: string[]
  /** True when pack can be edited via pack.save_user (origin=user). */
  editable?: boolean
}

/** Payload for creating/updating a user-authored scene template. */
export interface UserPackSaveInput {
  /** Omit or empty to create; must match an existing origin:user pack to update. */
  id?: string
  name: string
  description?: string
  system_prompt_append: string
  /** Global skill names to activate on apply (manual selection). */
  skill_ids?: string[]
  /** Configured MCP server ids to expose on apply (manual selection). */
  mcp_server_ids?: string[]
  suitable_for?: string
  unsuitable_for?: string
  tools_summary_zh?: string
}

/** Full detail returned by pack.get for the scene editor. */
export interface PackDetail {
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  origin: PackOrigin
  editable: boolean
  system_prompt_append: string
  skill_refs: string[]
  mcp_servers: string[]
  skills: string[]
  /**
   * Installed namespaced skill ids from this pack (`pack--{id}--*`), if present on disk.
   * Used by「另存为我的」to pre-check pack-local skills without waiting for skill.list race.
   */
  installed_skill_ids?: string[]
  requires_modules: string[]
  tools: PackTools
  suitable_for?: string
  unsuitable_for?: string
  tools_summary_zh?: string
}

export type ValidateResult =
  | {
      ok: true
      manifest: PackManifest
      skillAbsPaths: string[]
      knowledgeAbsPaths: string[]
    }
  | { ok: false; error: string }

export interface PackApplyPatch {
  mission_pack_id: string | null
  mission_pack_snapshot: ThreadPackSnapshot | null
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  mcp_selection_mode?: SelectionMode
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
  workspace_root?: string | null
  /** ADR-016: set when pack.manifest.board_mode is true. */
  board_mode?: boolean
}

export const FORBIDDEN_PACK_KEYS = new Set([
  "auto_approve_dangerous",
  "allow_all_schemes",
  "auto_approve_enterprise_tools",
  "auto_approved_domains",
  "trusted_domains",
  "god_mode",
  // ADR-021: unattended is process grant via security.unattended.arm — never pack config
  "unattended",
  "unattended_computer",
  "unattended_desktop",
])

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
export const MAX_SYSTEM_PROMPT_APPEND = 16 * 1024
export const MAX_PACK_FILE_BYTES = 1 * 1024 * 1024
export const MAX_PACK_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 1000
