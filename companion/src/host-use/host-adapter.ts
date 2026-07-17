// Phase 1 W4 HostAdapter interface — see docs/decisions/host-adapter-interface.md
// 3 methods per Round 2 §2.1 rule-of-three (Pi wins over Brief / Kimi "define first").
// Kimi Round 2 hardening:
//   - TargetId branded + runtime validator (brand alone insufficient against `as` casts)
//   - TargetKind trimmed to mail-inbox | note | file (no mail-thread / calendar-event)
//   - WritePayload discriminated union (invalid states unrepresentable)
//   - ReadResult strict fields, no index signature
//   - listReadTargets options { limit, cursor } to avoid materialize-all + TOCTOU

/**
 * Opaque platform-specific target identifier. Companion code never inspects
 * the internal structure — only passes it back to the same adapter that
 * produced it. Use validateTargetId() to construct from raw LLM input.
 */
export type TargetId = string & { readonly __brand: unique symbol }

/**
 * Phase 1 kinds only. `mail-thread` and `calendar-event` removed per Kimi
 * Round 2 — premature abstraction (not validated by any of the 3 spikes).
 */
export type TargetKind =
  | "mail-inbox"
  | "note"
  | "file"

/**
 * Options for listReadTargets. `limit` avoids materializing large lists just
 * to take the first N; `cursor` enables future pagination without signature
 * change.
 */
export interface ListOptions {
  limit?: number
  cursor?: string
}

/**
 * Strict field set per Kimi Round 2. No index signature — adding new fields
 * requires explicit interface extension (keeps LLM prompt contracts stable).
 * All fields optional because not every TargetKind emits every field.
 */
export interface ReadResult {
  sender?: string
  subject?: string
  date_received?: string
  body_preview?: string
  file_path?: string
  /**
   * Phase 1 W8-windows — fs metadata read surface (mtime, ISO-8601). Win file
   * reads are metadata-only (path + mtime); content stays with MCP filesystem
   * (plan §D.12). Explicit field addition per the strict-field contract above.
   */
  file_mtime?: string
}

/**
 * Discriminated union per Kimi Round 2. `kind` discriminates the payload
 * shape — invalid combinations (e.g., `delete` with body, `create` without
 * body) are unrepresentable at the type level.
 *
 * Phase 1 W6: `move` carries `source_path` because Finder move needs both
 * source (POSIX path) and destination. The TargetId in writeOne's signature
 * is the source for move operations; `source_path` is the canonical path
 * string. Phase 2 may encode source_path into TargetId directly.
 */
export type WritePayload =
  | { kind: "create"; body: string }
  | { kind: "move"; destination: string; source_path: string }
  | { kind: "update"; body: string }
  | { kind: "delete" }

export interface WriteResult {
  target_id?: TargetId
  undoable: boolean
}

/**
 * Platform-agnostic host-use adapter. Each platform (darwin/linux/win)
 * implements this against its native accessibility stack.
 *
 * Confirmation responsibility: 4-tier gradient (silent / ask-once /
 * double-confirm / biometric) lives in companion `security-confirmation.ts`,
 * NOT inside the adapter. Adapter contract: never prompt internally; surface
 * failures as thrown errors.
 *
 * TargetId format contract per docs/decisions/targetid-format-synthesis.md
 * (3-way advisor: Kimi + Pi-sub + brief author, 2026-07-16):
 *   - darwin: "macos:com.apple.<app>:<account-id>:<kind>-<stable-id>"
 *   - linux:  "linux:..." (Phase 1.5 — format TBD against RUNBOOK)
 *   - win:    "win:<app>:<account-or-root>:<kind>-<stable-id>" — defined and
 *             implemented on computer-use-w8-windows via COM automation +
 *             Node fs (data contract only, no UI-driving; app ∈ {outlook,
 *             onenote, fs}). See docs/decisions/windows-host-use-plan.md §B.
 */
export interface HostAdapter {
  /**
   * List readable targets of a given kind. Returns [] for valid empty (e.g.,
   * inbox has no messages) — NOT for permission denied / TCC / AT-SPI bus
   * failures (those MUST throw).
   */
  listReadTargets(kind: TargetKind, options?: ListOptions): Promise<TargetId[]>

  /** Read one target's current content. Returns platform-agnostic strict shape. */
  readOne(targetId: TargetId): Promise<ReadResult>

  /**
   * Write to a target. Discriminated union payload — invalid states
   * unrepresentable at the type level.
   */
  writeOne(targetId: TargetId, payload: WritePayload): Promise<WriteResult>

  /**
   * Validate a raw string is well-formed for THIS adapter's platform.
   * Returns branded TargetId or throws. Use for any TargetId sourced from
   * LLM input before passing to readOne/writeOne.
   *
   * Pi-sub structural finding (2026-07-16): making this an interface method
   * (not a free function) avoids a god-dispatcher that knows all 3 platform
   * formats. Each adapter co-locates its own validator with the format it
   * produces.
   */
  validateTargetId(raw: string): TargetId
}
