# HostAdapter Interface — Phase 1 W4 Definition

> **Date**: 2026-07-16 (revised after Kimi Round 2 review)
> **Authority**: Round 2 synthesis §2.1 (Pi rule-of-three wins over Brief / Kimi "define first")
> **Source material**:
> - macOS implementation: `companion/src/host-use/darwin/` (Phase 0 spike)
> - Linux shape: `companion/src/host-use/linux/RUNBOOK-phase0.md`
> - Windows shape: `companion/src/host-use/win/RUNBOOK-phase0.md`
> **Status**: design doc (revised) — implementation will follow in Phase 1 W5-W6.

## Context

Round 2 synthesis §2.1 explicitly defers HostAdapter interface definition to W4 (end of Phase 0 spike), AFTER three real platform implementations exist. The rule-of-three rationale: abstracting from imagined platforms gets the abstraction wrong; abstracting from three real ones gets it right.

Phase 0 produced:
- **macOS real implementation** (Mail inbox top-1 read via Swift binary + precompiled .scpt)
- **Linux RUNBOOK** (concrete pyatspi/gdbus shape for Evolution)
- **Windows RUNBOOK** (concrete UIAutomation shape for Outlook — expected UIAccess-blocked)

All three converge on: **list targets → read one → write one**. That's the abstraction.

## The interface (revised post-Kimi-Round-2)

```typescript
// companion/src/host-use/host-adapter.ts

/**
 * Platform-agnostic host-use adapter. Each platform (darwin/linux/win) implements
 * this against its native accessibility stack:
 *   - darwin: AppleScript via precompiled .scpt + Swift binary (NSAppleScript)
 *   - linux:  AT-SPI via pyatspi/gdbus shell calls + Rust tray binary
 *   - win:    UIAutomation via PowerShell + C# WinForms tray (Phase 1.5)
 *
 * The interface is deliberately minimal (3 methods). Round 2 §2.1 explicitly
 * forbids 6- or 8-method "kitchen sink" abstractions — opaque TargetId + 3
 * methods is the rule-of-three output.
 */
export interface HostAdapter {
  /**
   * List readable targets of a given kind.
   * Returns [] for empty (e.g., inbox has no messages) — NOT for permission denied.
   * Permission / TCC / AT-SPI bus failures MUST throw.
   */
  listReadTargets(
    kind: TargetKind,
    options?: { limit?: number; cursor?: string },
  ): Promise<TargetId[]>

  /** Read one target's current content. Returns platform-agnostic strict shape. */
  readOne(targetId: TargetId): Promise<ReadResult>

  /**
   * Write to a target. Discriminated union payload — invalid states are
   * unrepresentable at the type level (Kimi Round 2 #10).
   */
  writeOne(targetId: TargetId, payload: WritePayload): Promise<WriteResult>
}

/**
 * Opaque platform-specific target identifier. Companion code never inspects
 * the internal structure — only passes it back to the same adapter that
 * produced it.
 *
 * Platform conventions:
 *   - darwin: `bundleId:accountId:itemId` (e.g. `com.apple.mail:INBOX:msg-12345`)
 *   - linux:  `atspi://path/to/object` (AT-SPI registry path)
 *   - win:    `hwnd:automationId` (UIAutomation cache key)
 *
 * Brand enforces: companion code cannot construct TargetId from raw strings
 * (e.g., LLM output) without going through validateTargetId(). Platform
 * adapters cast at the boundary internally.
 */
export type TargetId = string & { readonly __brand: unique symbol }

/**
 * Validate a raw string (e.g., from LLM input) is well-formed for the current
 * platform. Returns the branded TargetId or throws. Companion code MUST call
 * this before passing any LLM-supplied ID to writeOne(); the brand alone does
 * not provide runtime safety (Kimi Round 2 #14).
 */
export function validateTargetId(raw: string): TargetId {
  // Platform-specific format check (prefix + structure)
  // Implementation lives in host-use/{darwin,linux,win}/validate.ts
  throw new Error("not implemented — Phase 1 W5")
}

/**
 * Phase 1 kinds only. `mail-thread` and `calendar-event` removed (Kimi Round 2
 * #9: premature abstraction — not validated by any of the 3 spikes). Add new
 * kinds only AFTER at least 2 platforms have real implementations.
 */
export type TargetKind =
  | "mail-inbox"
  | "note"
  | "file"

/**
 * Strict field set. No index signature (Kimi Round 2 #11: index signature
 * lets platforms emit arbitrary fields, making LLM prompt contracts unstable).
 * Phase 2 adds fields via explicit union extension, not via `[key: string]: unknown`.
 *
 * All fields optional because not every TargetKind emits every field
 * (e.g., `file` has no `sender`; `note` has no `date_received`).
 */
export interface ReadResult {
  sender?: string
  subject?: string
  date_received?: string  // ISO 8601 (Phase 1 normalizes from AppleScript locale)
  body_preview?: string
  file_path?: string      // for TargetKind="file"
}

/**
 * Discriminated union. Invalid states (e.g., `delete` with body, `create`
 * without body) are unrepresentable at the type level (Kimi Round 2 #10).
 */
export type WritePayload =
  | { kind: "create"; body: string }
  | { kind: "move"; destination: string }
  | { kind: "update"; body: string }
  | { kind: "delete" }

export interface WriteResult {
  /** Opaque ID of the created/updated target, if applicable. */
  target_id?: TargetId
  /** Whether the write was undoable (Finder trash = yes; Mail send = no). */
  undoable: boolean
}
```

## Confirmation responsibility (Kimi Round 2 #13)

The 4-tier gradient (`silent / ask-once / double-confirm / biometric`) lives in **companion `security-confirmation.ts`**, NOT inside the adapter. The adapter is purely a data operation layer.

Decision matrix (Phase 1):

| Operation | Tier | Platform mechanism |
|---|---|---|
| `readOne(mail-inbox)` | ask-once | SecurityConfirmationManager 45s queue (existing) |
| `readOne(note)` / `readOne(file)` | ask-once | same |
| `writeOne(*, {kind:"create"})` Notes | biometric (macOS) / manual 6-char nonce (Linux) | Touch ID via `LAContext` / companion-side prompt |
| `writeOne(*, {kind:"move"})` Finder | ask-once | existing SecurityConfirmationManager |
| `writeOne(*, {kind:"delete"})` | double-confirm (Phase 1 likely forbids entirely) | TBD |

Adapter contract: never prompt internally. If an operation requires platform-level privilege escalation (TCC prompt, AT-SPI bus access), surface as thrown error and let companion decide whether to retry with escalated tier.

## Platform-specific implementation map

### `companion/src/host-use/darwin/adapter.ts` (refactor of existing `index.ts`)

| Method | Maps to |
|---|---|
| `listReadTargets("mail-inbox", {limit:1})` | AppleScript: `first message of inbox` → single-element array |
| `readOne(targetId)` | AppleScript: `message N of inbox` → strict 4 fields |
| `writeOne(targetId, {kind:"create", body})` for Notes | AppleScript: `make new note with properties {name:..., body:...}` |

Reuses existing `cmspark-host` Swift binary. **Phase 0's `hostRead(params)` function stays as-is** — Kimi Round 2 #12 warns that wrapping it as `readOne(listReadTargets("mail-inbox")[0])` introduces TOCTOU race (inbox changes between list and read) and perf regression (materialize all IDs to take first). Instead, the adapter's `readOne` for Mail top-1 calls the Swift binary directly; `listReadTargets` is for the future "list inbox, pick one" UX.

### `companion/src/host-use/linux/adapter.ts` (Phase 1 W5 new)

| Method | Maps to |
|---|---|
| `listReadTargets("mail-inbox")` | `pyatspi.Registry.getDesktop(0)` walk → Evolution message-list nodes |
| `readOne(targetId)` | AT-SPI text-cell query on the row |
| `writeOne(...)` | AT-SPI action invoke (limited; mostly create-via-keyboard) |

Linux tray = Rust binary via `ksni` crate (independent of Swift tray).

**Note**: previous Linux RUNBOOK mentioned `listReadTargets("mail")` returning `[{id: "..."}]` — that was an early sketch. The interface finalizes on `listReadTargets("mail-inbox"): TargetId[]` (string array, not object). RUNBOOK will be updated when implementing.

### `companion/src/host-use/win/adapter.ts` (Phase 1.5 — UIAccess-gated)

| Method | Maps to |
|---|---|
| `listReadTargets("mail-inbox")` | UIAutomation `FindAll` on Outlook window |
| `readOne(targetId)` | UIAutomation cache request (5-30ms per Round 2 §1.3) |
| `writeOne(...)` | UIAutomation `InvokePattern` / `ValuePattern` |

Blocked until EV cert + Authenticode + UIAccess manifest ready.

## Resolved design questions (post-Kimi-Round-2)

### Q1: TargetId branded or plain? → branded + runtime validator

**Resolved**: branded type PLUS `validateTargetId(raw: string): TargetId` runtime helper. Platform adapters cast internally; companion code MUST call validator for any TargetId sourced from LLM input. Brand alone is insufficient because TypeScript brands evaporate at `as` casts (Kimi Round 2 #14).

### Q2: Empty list semantics → valid empty, but error contract for failures

**Resolved**: `[]` = valid empty. Permission denied / TCC failure / AT-SPI bus unreachable = thrown error. Adapter contract documents this explicitly. Companion surfaces errors to LLM as `{success:false, error:"..."}` rather than letting LLM misreport "inbox empty" when actually blocked.

### Q3: Single writeOne vs multiple methods → single writeOne with discriminated union payload

**Resolved**: keep single `writeOne(targetId, payload)` but `payload` is discriminated union, not interface with optional fields. Invalid states (delete with body, create without body) are unrepresentable. `targetId` for `create` is the parent target (e.g., Notes app target), not null.

### Q4: ReadResult index signature vs strict fields → strict fields

**Resolved**: strict optional fields only. No `[key: string]: unknown`. Adding new fields in Phase 2 requires extending the interface explicitly. This makes LLM prompt contracts stable.

### Q5: Sync array vs async iterable → array + limit/cursor options

**Resolved**: `listReadTargets(kind, {limit?, cursor?})`. Phase 1 callers pass `{limit: 1}` for top-1 read. Phase 2+ can extend cursor for pagination without breaking the signature. Performance-sensitive callers (Mail with 1000+ msgs) use limit; UX flows that need full list omit it.

## Phase 1 W5 implementation plan

After this interface is approved:

1. Create `companion/src/host-use/host-adapter.ts` with the interface
2. Refactor `darwin/index.ts:hostRead` — keep as-is, add comment that it's the direct top-1 path (not `readOne(listReadTargets[0])`)
3. Create `darwin/adapter.ts` implementing `HostAdapter` (with `listReadTargets` returning top-N, `readOne` calling binary)
4. Add `darwin/list-targets.scpt` + extend `host.swift` with `list-mail` subcommand
5. Update `server.ts host_read` case — keep existing call (don't introduce TOCTOU race)
6. Add tests for adapter contract (mock platform adapter, verify companion uses it correctly)
7. Phase 1 W6-W7: implement Linux adapter against RUNBOOK (and update RUNBOOK to match final interface shape)
8. Phase 1 W8-W14: integrate with daemon mode + 4-tier confirmation per matrix above

## Migration impact (minimal)

- `host-use/darwin/index.ts:hostRead(params)` — UNCHANGED, stays as direct top-1 read
- `host-use/types.ts:HostReadResult` — UNCHANGED (compatible subset of new `ReadResult`)
- `host-use/types.ts:HostReadParams` — UNCHANGED
- Existing `host_read` tool surface in `tool-schemas.ts` / `tool-definitions.ts` / `server.ts` — UNCHANGED (LLM-facing API stays the same)
- New code: `host-use/host-adapter.ts` + `host-use/darwin/adapter.ts` + `host-use/darwin/list-targets.scpt` + `host.swift` `list-mail` subcommand
