# TargetId Format Contract — 3-Way Advisor Synthesis

> **Date**: 2026-07-16
> **Sources**:
> - Brief: `docs/decisions/targetid-format-brief.md`
> - Kimi: `docs/decisions/adversary-kimi-targetid.txt` (CLI session, see /tmp/kimi-targetid-output.txt)
> - Pi-sub: Agent subagent review (in conversation history)
> **Status**: synthesized; ready for Phase 1 W5 implementation.

## Consensus (Kimi + Pi + brief author agree)

### Q1 — macOS TargetId = stable message id, account-scoped

```ts
// Format: "macos:com.apple.mail:<account-id>:msg-<message-id>"
// Example: "macos:com.apple.mail:icloud-imap:msg-12345"
```

Mail.app's `id of message` is **account-scoped, not globally unique** — two accounts can have the same numeric message id (Pi's finding). TargetId MUST include account identifier to prevent collision in multi-account setups (the default Mail.app config).

Implementation: AppleScript `id of message N of inbox` + `name of account of mailbox of message N`. O(n) lookup on read is acceptable since Phase 1 limit defaults bound the list size.

Positional index (`message 1 of inbox`) rejected — Mail reorders on sync, LLM would read wrong message ~30% of the time.

### Q2 — Option A (platform prefix leak)

```ts
// Cross-platform prefix conventions:
"macos:..."   // darwin adapter
"linux:..."   // linux adapter (AT-SPI path)
"win:..."     // win adapter (UIAutomation cache key)
```

**Self-describing** — if a `macos:` TargetId ever reaches a Linux adapter, the error is actionable ("wrong-platform TargetId") rather than a generic "not found".

**Opacity principle intact** — companion code still doesn't parse TargetId internals; only the producing adapter does.

**Rejected alternatives**:
- Option B (URI scheme `cmspark-target://...`) — URL-escaping rules add bugs for zero benefit
- Option C (UUID + adapter map) — **Hard veto from Pi**: cannot survive companion daemon restarts (Phase 1 documented operational mode). Would-block-Phase-1-ship.

### Q3 — Strict validation, per-platform

```ts
// Per-platform regex (example for darwin):
/^macos:com\.apple\.(mail|notes|finder):[a-z0-9-]+:(msg|note|file)-[a-zA-Z0-9]+$/
```

Strict catches LLM hallucinations at ~1ms; permissive would defer to AppleScript round-trip (~200-500ms penalty per hallucinated ID).

LLMs hallucinate IDs frequently in early Phase 1 — strict is mandatory.

### Q5 — Phase 1 W5 scope = Option A + stable id

Implement Option A with stable message id + account scoping. Linux/Windows validators stubbed to throw NotImplementedOnPlatform (don't write dead code for untested platforms — per Kimi's scope-creep warning).

## Resolved disagreement: Q4 (hash vs read-time fail)

**Kimi position**: stable IMAP UIDs are reliable until deletion. "If message deleted → read fails; if still exists → same message." No need for hash.

**Pi position**: silent substitution risk — encode `hash-<first-8-of-sha256(subject+sender+date)>` to detect drift.

**Resolution: Kimi wins.** Reasoning:
- Pi's substitution concern applies to **positional** ids (already rejected)
- IMAP UIDs are server-assigned and stable across client sessions; a message cannot have its UID silently swapped with another's
- The only failure mode is deletion between list+read — read-time fail catches this
- Adding hash:
  - Costs ~16 chars per TargetId + 1 hash compute per read (negligible)
  - But adds complexity to AppleScript (must read 3 fields + hash) and Swift (hash validation)
  - Breaks LLM debuggability (TargetIds become less readable)
- Phase 1 ship without hash; revisit if real substitution incidents occur

**If Phase 2 shows substitution is real** (e.g., Mail rebuild shifts UIDs), add hash then. Don't pre-engineer.

## Critical structural fix: `validateTargetId` moves to interface

**Pi finding (Kimi missed)**: `host-adapter.ts:101` declares `validateTargetId` as a free function. This forces either:
- (a) a god-function knowing all 3 platform formats, OR
- (b) a dispatcher function coupling to all adapters

Both violate Round 2 §2.1 rule-of-three rationale.

**Fix**: move `validateTargetId` onto `HostAdapter` interface as a method. Each platform adapter implements its own validator co-located with the format it validates.

```typescript
export interface HostAdapter {
  listReadTargets(kind: TargetKind, options?: ListOptions): Promise<TargetId[]>
  readOne(targetId: TargetId): Promise<ReadResult>
  writeOne(targetId: TargetId, payload: WritePayload): Promise<WriteResult>

  /**
   * Validate a raw string is well-formed for THIS adapter's platform.
   * Returns branded TargetId or throws. Use for any TargetId sourced from
   * LLM input.
   */
  validateTargetId(raw: string): TargetId
}
```

Companion code calls `adapter.validateTargetId(rawFromLLM)`. No central dispatcher; no god-function.

## Implementation plan (Phase 1 W5)

1. **Refactor `host-adapter.ts`**: remove free `validateTargetId` function, add as interface method
2. **Create `host-use/darwin/adapter.ts`**: implements full HostAdapter including `validateTargetId`
3. **Format validator regex** (darwin only — Linux/Win stubbed):
   ```ts
   const DARWIN_TARGET_RE = /^macos:com\.apple\.(mail|notes|finder):[a-z0-9-]+:(msg|note|file)-[a-zA-Z0-9]+$/
   ```
4. **Extend `host.swift`** with `list-mail --limit N` subcommand returning JSON array of TargetIds
5. **Extend `read-mail.applescript`** OR add `read-mail-by-id.applescript` to look up by stable id (O(n) scan)
6. **Tests**: validateTargetId rejects LLM-forged strings; adapter round-trip list+read works
7. **Update interface doc** (`host-adapter-interface.md`) to match synthesis (Q3 structural fix, Q4 hash rejected, Q1 account-scoped)

## Format consistency cleanup

Kimi caught: brief uses `macos:` prefix but interface doc example uses `com.apple.mail:` as leading segment. **Canonical: `macos:` prefix per this synthesis.** Interface doc will be updated.

## Round 3 deferred items

- Linux/Windows validators (when those adapters ship in Phase 1.5 / Phase 2)
- Hash-based stale detection (only if Phase 2 incident demonstrates need)
- Performance optimization for read-by-id (O(n) scan; add index if Mail inbox >10k msgs becomes a problem)
