// Mission Pack types — see docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md

export type PackChannel = "community" | "enterprise"
export type MinCapability = "L0" | "L1" | "L2"
export type ToolsMode = "allowlist" | "intersect" | "unchanged"
export type SelectionMode = "auto" | "all" | "manual"
/** Who authored the pack: builtin/installed are read-only in UI; user can edit/delete. */
export type PackOrigin = "builtin" | "installed" | "user"
/**
 * #367: mission = 场景任务包 (ADR-014 default); expert = 可调度的角色视图
 * (schedulable role view, still NOT a runtime). Pure schema addition —
 * apply/spawn engines run identical logic for both kinds; kind only feeds
 * list filtering/matching/UI copy. Absent field = mission (legacy packs).
 */
export type PackKind = "mission" | "expert"

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
  /** #367: mission|expert; absent = mission (legacy compat). */
  kind?: PackKind
  /**
   * #369: operator off-switch stored IN pack.yaml (travels with the pack — no
   * separate registry to drift out of sync, and the id stays resolvable so no
   * ghost ids). Disabled packs: pack.apply (propose/套用) and spawn_worker(pack_id)
   * both refuse; the editor still opens read-only. Absent = enabled.
   */
  disabled?: boolean
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
  /**
   * Wave A: references to already-installed global knowledge doc names (not pack-local paths).
   * User scenes store selections here; apply unions with pack-local installed knowledge ids.
   */
  knowledge_refs?: string[]
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
  /**
   * User-scene only (product B): global Trust applied on pack.apply.
   * Builtin/installed must not set this (validator rejects).
   */
  trust?: UserPackTrustPolicy
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
  active_knowledge_ids?: string[]
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  /** #273 Wave A: knowledge smart-match toggle (undefined = true). */
  knowledge_smart_match?: boolean
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
  /** #367: always present in list output; absent-on-disk = "mission". */
  kind: PackKind
  /** #369: true when the pack is operator-disabled (apply/spawn refuse). */
  disabled?: boolean
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
  /**
   * True when this pack has a trust block that writes global security on apply.
   * List UI must disclose before apply (S46 multi-lane P0).
   */
  has_trust?: boolean
  /** Trust shorthand: full three-flag cruise on apply. */
  trust_skip_l2?: boolean
  /** Server SoT: overlay may one-click apply (allowTrust still forced false). */
  overlay_eligible?: boolean
}

/** Payload for creating/updating a user-authored scene template. */
export interface UserPackSaveInput {
  /** Omit or empty to create; must match an existing origin:user pack to update. */
  id?: string
  name: string
  description?: string
  system_prompt_append: string
  /** #369: create defaults to mission; update omit preserves existing kind. */
  kind?: PackKind
  /** #369: operator off-switch; update omit preserves existing value. */
  disabled?: boolean
  /** Global skill names to activate on apply (manual selection). */
  skill_ids?: string[]
  /** Global knowledge doc names to activate on apply (manual selection). Wave A. */
  knowledge_ids?: string[]
  /** Configured MCP server ids to expose on apply (manual selection). */
  mcp_server_ids?: string[]
  /**
   * Tool surface recipe. Create omit → unchanged.
   * Update omit → preserve existing pack tools (do not wipe).
   */
  tools?: {
    mode: ToolsMode
    allow?: string[]
    deny?: string[]
  }
  /**
   * Product B (2026-08-06): user scenes may declare global Trust on apply.
   * Omit on update → preserve existing trust block.
   */
  trust?: UserPackTrustPolicy | null
  suitable_for?: string
  unsuitable_for?: string
  tools_summary_zh?: string
}

/**
 * User-scene Trust recipe — applied to Companion config on pack.apply (global).
 * Not for builtin packs. Requires user_gesture on save/apply.
 */
export interface UserPackTrustPolicy {
  /** Set capability_profile=enterprise when enabling shell/netsec */
  set_enterprise_profile?: boolean
  /** Modules to enable (shell, netsec, appsec, devsec-workspace, …) */
  enable_modules?: string[]
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
  /**
   * Shorthand: on apply set all three auto_approve/god flags (full-autonomy cruise)
   * so shell/skill_install/MCP critical forceConfirm is waived.
   */
  skip_l2?: boolean
}

/** Snapshot of global Trust before a trust-writing pack apply (restored on unapply). */
export interface PackTrustSnapshot {
  capability_profile: string
  auto_approve_dangerous: boolean
  auto_approve_enterprise_tools: boolean
  allow_all_schemes: boolean
  modules: Record<string, { enabled: boolean }>
}

/** Native tools that imply enterprise modules when present in pack allow lists. */
export const TOOL_IMPLIED_MODULES: Record<string, string> = {
  shell_exec: "shell",
  netsec_port_scan: "netsec",
  workspace_list_dir: "devsec-workspace",
  workspace_read_file: "devsec-workspace",
  workspace_write_file: "devsec-workspace",
  workspace_glob: "devsec-workspace",
}

/** High-risk native tools shown in a separate UI group (L2 still required at runtime). */
export const HIGH_RISK_NATIVE_TOOLS = [
  "shell_exec",
  "evaluate",
  "osascript_eval",
  "host_computer",
  "host_cli",
  "host_app",
  "netsec_port_scan",
] as const

/** Full detail returned by pack.get for the scene editor. */
export interface PackDetail {
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  /** #367: mission|expert; always present; absent-on-disk = "mission". */
  kind: PackKind
  /** #369: true when the pack is operator-disabled. */
  disabled?: boolean
  origin: PackOrigin
  editable: boolean
  system_prompt_append: string
  skill_refs: string[]
  knowledge_refs?: string[]
  mcp_servers: string[]
  skills: string[]
  /**
   * Installed namespaced skill ids from this pack (`pack--{id}--*`), if present on disk.
   * Used by「另存为我的」to pre-check pack-local skills without waiting for skill.list race.
   */
  installed_skill_ids?: string[]
  /** Installed namespaced knowledge ids from this pack under knowledge/global. */
  installed_knowledge_ids?: string[]
  requires_modules: string[]
  tools: PackTools
  /** User-scene only: global Trust recipe applied on pack.apply */
  trust?: UserPackTrustPolicy | null
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
  active_knowledge_ids?: string[]
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

/**
 * ADR-023 L15 / Path B M0: Pack apply/install/save must never carry voice engine,
 * model, privacy-ack, or auto-send keys. Case-insensitive prefix match.
 * Unlike FORBIDDEN_PACK_KEYS (some allowed under user `trust`), these are **always**
 * rejected/stripped — no trust-block exception.
 */
export const VOICE_FORBIDDEN_KEY_RE =
  /^(voice|sttEngine|localModelId|voiceStt|voice_privacy|voiceAutoSend|asr_refiner|refiner_prompt|dictation_polish|rewrite_mode|audio_retain|autoStart|hotkey|dictationHotkey|dictation_hotkey)/i

/** True when a pack.yaml object key must never appear (voice risk). */
export function isVoiceForbiddenPackKey(key: string): boolean {
  return VOICE_FORBIDDEN_KEY_RE.test(key)
}

/**
 * Recursively delete voice risk keys from a plain object / array tree (in place).
 * Used on install sanitize + as belt before free-form trust merge.
 * @returns true if any key was removed
 */
export function stripVoiceForbiddenKeys(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) {
    let stripped = false
    for (const item of value) {
      if (stripVoiceForbiddenKeys(item)) stripped = true
    }
    return stripped
  }
  if (typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  let stripped = false
  for (const k of Object.keys(obj)) {
    if (isVoiceForbiddenPackKey(k)) {
      delete obj[k]
      stripped = true
      continue
    }
    if (stripVoiceForbiddenKeys(obj[k])) stripped = true
  }
  return stripped
}

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
export const MAX_SYSTEM_PROMPT_APPEND = 16 * 1024
export const MAX_PACK_FILE_BYTES = 1 * 1024 * 1024
export const MAX_PACK_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 1000
