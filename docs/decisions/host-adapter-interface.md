# HostAdapter Interface — Phase 1 W4 Definition

> **Date**: 2026-07-16
> **Authority**: Round 2 synthesis §2.1 (Pi rule-of-three wins over Brief / Kimi "define first")
> **Source material**:
> - macOS implementation: `companion/src/host-use/darwin/` (Phase 0 spike)
> - Linux shape: `companion/src/host-use/linux/RUNBOOK-phase0.md`
> - Windows shape: `companion/src/host-use/win/RUNBOOK-phase0.md`
> **Status**: design doc — implementation will follow in Phase 1 W5-W6.

## Context

Round 2 synthesis §2.1 explicitly defers HostAdapter interface definition to W4 (end of Phase 0 spike), AFTER three real platform implementations exist. The rule-of-three rationale: abstracting from imagined platforms gets the abstraction wrong; abstracting from three real ones gets it right.

Phase 0 produced:
- **macOS real implementation** (Mail inbox top-1 read via Swift binary + precompiled .scpt)
- **Linux RUNBOOK** (concrete pyatspi/gdbus shape for Evolution)
- **Windows RUNBOOK** (concrete UIAutomation shape for Outlook — expected UIAccess-blocked)

All three converge on: **list targets → read one → write one**. That's the abstraction.

## The interface

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
  /** List readable targets of a given kind (inbox / calendar / notes / files). */
  listReadTargets(kind: TargetKind): Promise<TargetId[]>

  /** Read one target's current content. Returns platform-agnostic shape. */
  readOne(targetId: TargetId): Promise<ReadResult>

  /** Write to a target (create / move / update). Phase 1 limited to Notes create + Finder move. */
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
 */
export type TargetId = string & { readonly __brand: unique symbol }

export type TargetKind =
  | "mail-inbox"
  | "mail-thread"
  | "calendar-event"
  | "note"
  | "file"

export interface ReadResult {
  /** Platform-agnostic field set. Phase 0 Mail spike emits all 4. */
  sender?: string
  subject?: string
  date_received?: string  // ISO 8601 (Phase 1 normalizes from AppleScript locale)
  body_preview?: string
  /** Future-proofing: platforms may emit additional fields. */
  [key: string]: unknown
}

export interface WritePayload {
  /** Kind of write — controls what `target` and `body` mean. */
  kind: "create" | "move" | "update" | "delete"
  /** Body content for create/update. Format depends on TargetKind. */
  body?: string
  /** Destination for move operations (e.g. Finder folder path). */
  destination?: string
}

export interface WriteResult {
  /** Opaque ID of the created/updated target, if applicable. */
  target_id?: TargetId
  /** Whether the write was undoable (Finder trash = yes; Mail send = no). */
  undoable: boolean
}
```

## Platform-specific implementation map

### `companion/src/host-use/darwin/adapter.ts` (refactor of existing `index.ts`)

| Method | Maps to |
|---|---|
| `listReadTargets("mail-inbox")` | AppleScript: `messages of inbox` → array of `com.apple.mail:INBOX:msg-N` |
| `readOne(targetId)` | AppleScript: `message N of inbox` → 4 fields |
| `writeOne(targetId, {kind:"create"})` for Notes | AppleScript: `make new note with properties {name:..., body:...}` |

Reuses existing `cmspark-host` Swift binary. Phase 0's `hostRead(params)` function becomes a thin wrapper: `listReadTargets("mail-inbox")[0]` + `readOne(first)`.

### `companion/src/host-use/linux/adapter.ts` (Phase 1 W5 new)

| Method | Maps to |
|---|---|
| `listReadTargets("mail-inbox")` | `pyatspi.Registry.getDesktop(0)` walk → Evolution message-list nodes |
| `readOne(targetId)` | AT-SPI text-cell query on the row |
| `writeOne(...)` | AT-SPI action invoke (limited; mostly create-via-keyboard) |

Linux tray = Rust binary via `ksni` crate (independent of Swift tray).

### `companion/src/host-use/win/adapter.ts` (Phase 1.5 — UIAccess-gated)

| Method | Maps to |
|---|---|
| `listReadTargets("mail-inbox")` | UIAutomation `FindAll` on Outlook window |
| `readOne(targetId)` | UIAutomation cache request (5-30ms per Round 2 §1.3) |
| `writeOne(...)` | UIAutomation `InvokePattern` / `ValuePattern` |

Blocked until EV cert + Authenticode + UIAccess manifest ready.

## Open design questions for review

### Q1: Should `TargetId` be branded or plain string?

**Current proposal**: branded for type safety (`string & { __brand }`).

**Alternative**: plain `string`. Simpler, no casting needed at platform boundaries.

**Recommendation**: branded. The brand is zero-runtime-cost and prevents companion code from accidentally constructing fake target ids (e.g., from LLM output without validation). Platform adapters cast at the boundary; companion code only consumes.

### Q2: Is `listReadTargets` returning `[]` an error or "empty inbox"?

**Current proposal**: empty array is valid (empty inbox is normal).

**Implication**: companion must handle empty list gracefully — LLM should be told "no messages" rather than retry / error.

**Recommendation**: keep as valid empty. Add to LLM system prompt: "if listReadTargets returns [], report 'inbox empty' to user".

### Q3: Should `writeOne` accept `targetId: null` for create operations?

**Current proposal**: `writeOne(targetId, payload)` where targetId may be a "parent" (e.g., Notes app for create).

**Alternative**: separate `createOne(parentId, payload)` method.

**Recommendation**: keep single `writeOne`. Phase 1 only does Notes create + Finder move; both can be modeled as `writeOne(parentTargetId, {kind:"create", body})`. If Phase 2 adds more write scenarios and the model strains, refactor then.

### Q4: `ReadResult` extension — `[key: string]: unknown` index signature vs explicit union?

**Current proposal**: index signature for forward compatibility.

**Alternative**: discriminated union per TargetKind (`MailReadResult | CalendarReadResult | ...`).

**Recommendation**: index signature for Phase 1 (less ceremony, platforms emit what they have). Refactor to union in Phase 2 if LLM gets confused by inconsistent shapes.

### Q5: Async iterator for `listReadTargets`?

When inbox has 1000+ messages, returning `TargetId[]` materializes all. Should we use `AsyncIterable<TargetId>` instead?

**Recommendation**: Phase 1 keeps array. Mail inbox top-1 read is the only Phase 1 use case; large mailboxes are Phase 2+. If performance becomes an issue, add `listReadTargets(kind, {limit, cursor})` later.

## Phase 1 W5 implementation plan

After this interface is approved (Kimi Round 2 / user sign-off):

1. Create `companion/src/host-use/host-adapter.ts` with the interface
2. Refactor `darwin/index.ts` → `darwin/adapter.ts` implementing `HostAdapter`
3. Add `darwin/list-targets.scpt` + extend `host.swift` with `list-mail` subcommand
4. Update `server.ts host_read` case to use the adapter (compose `listReadTargets` + `readOne`)
5. Add tests for adapter interface contract (mock platform adapter, verify companion uses it correctly)
6. Phase 1 W6-W7: implement Linux adapter against RUNBOOK
7. Phase 1 W8-W14: integrate with daemon mode + 4-tier confirmation (ask-once + Touch ID)

## Migration impact

- `host-use/darwin/index.ts:hostRead(params)` → deprecated, becomes thin wrapper around `HostAdapter.readOne(listReadTargets("mail-inbox")[0])`
- `host-use/types.ts:HostReadResult` → replaced by `ReadResult`
- `host-use/types.ts:HostReadParams` → replaced by `TargetKind` argument to `listReadTargets`
- Existing `host_read` tool surface in `tool-schemas.ts` / `tool-definitions.ts` / `server.ts` unchanged (LLM-facing API stays the same; internal dispatch only)
