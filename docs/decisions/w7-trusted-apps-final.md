# Phase 1 W7 Trusted Apps Config — Final Decision (Kimi+Pi 三方共识)

> **Date**: 2026-07-16
> **Process**: 4 parallel sub-agents → synthesis → Kimi + Pi-sub 3-way advisor → this final.
> **Outcome**: Phase 1 W7 ships inline-checkbox thread-scope trust. Two ship blockers identified.

## Final recommendation (Claude main synthesizes Kimi + Pi)

**Phase 1 W7 ships**: L2 confirmation dialog gains inline checkbox "信任此 app，本线程内不再询问 [ ]" for `host_read` / `host_write`. Thread-scoped auto-approval on subsequent calls in same thread.

**Phase 1 W7 does NOT ship**: dedicated SettingsSlideout section; persistent cross-thread whitelist; per-verb granularity.

## Q&A resolutions

| Q | Resolution | Source |
|---|---|---|
| Q1 biometric fatigue | **Option A — Touch ID per call**. Writes are biometric-gated per Round 2 §4.2; thread-scope bypass would silently downgrade the tier. If real fatigue emerges (>3 writes/60s), add **time-bounded session** (5min) in Phase 2, not unlimited thread grant. | Kimi + Pi consensus |
| Q2 reset notice | **Option A — silent reset**. Thread switch is itself a UI event; one-line notice double-charges attention. If users report confusion, revisit. | Pi (Kimi disagreed; weaker argument) |
| Q3 matching key | **Option B — `(kind, target_app)`**. TargetId encodes app segment; extraction is free. Matching by kind-only lets user-approved Notes-create pivot to Finder-create via later TargetId. | Kimi + Pi consensus |
| Q4 allowlist expansion | **Option A — expand `READ_ALLOWED_APPS` to {Mail, Notes, Finder}**. The writeOne side already supports Notes + Finder (W6); read asymmetry is a Phase 0 bug, not a feature decision. W7 PR must include this expansion or the checkbox is inert for non-Mail reads. | Pi (Kimi's scope-creep concern overruled by structural argument) |
| Q5 schema (Phase 2) | **Option A — `auto_approved_apps: string[]`**. Mirrors existing `auto_approved_domains` pattern; `string | null` is premature simplification that forces Phase 2 redesign. Defer to Phase 2. | Pi (Kimi's blast-radius concern acknowledged but deferred) |
| Q6 Shortcuts parity | **Option C — hybrid (proprietary thread-scope; defer persistent to OS TCC)**. Phase 1 thread scope has no OS equivalent; Phase 2 persistent trust should mirror System Settings → Automation. UI must label honestly: "cmSpark thread trust" not "system permission". | Pi (Kimi's Option A too narrow for Phase 2) |
| Q7 stale-verb drift | **Option C — silent in Phase 1**. Thread lifetime ≪ macOS version bump interval. Phase 2 persistent whitelist must persist `macos_version` and force re-confirmation on mismatch. | Kimi (Pi's "Phase 2 only" framing equivalent) |
| Q8 audit trail | **All 4 fields**: `original_confirmation_id` + `thread_id` + `bundle_id` + `kind` + `tool_call_id` (latter already in surrounding log context). `original_confirmation_id` is non-negotiable for non-repudiation. | Kimi + Pi consensus |

## Ship blockers (both must be satisfied)

### Blocker 1: Q1 — Touch ID per call (no thread-scope biometric bypass)

**Source**: Kimi.
**Reason**: Round 2 §4.2 locks `host_write` behind biometric tier. Thread-scope biometric bypass collapses the tier into ask-once, violating the 4-tier gradient that the whole security model rests on. Prompt injection surviving within a thread could chain destructive writes without ever touching the sensor.
**Resolution**: Phase 1 W7 inline checkbox applies to **read only**. Writes always require biometric per call. If user feedback shows fatigue, add time-bounded session (5min) in Phase 2.

> **AMENDMENT (2026-07-18, owner decision — App tab WP3)**: Blocker 1's
> read-only lock is formally amended with ONE exception. Per
> `app-tab-design-draft.md` «Owner 决策 2» (2026-07-18 10:56): thread-trust
> gains a second kind, `"app-launch"`, scoped to **L0 no-arg launches** of
> user-whitelisted App-tab entries (`host_app` tool, policy `"ai"` only —
> `"manual"` never offers the checkbox, `"auto"` skips L2 entirely).
> Rationale: the lock is a decision, not a mechanism, and the owner judged a
> plain app launch (no args, no templates, no output capture) read-class for
> trust purposes. Read semantics are unchanged; writes and dangerous
> operations NEVER use thread-trust. Safeguards implemented in WP3: the grant
> only happens via the L2 dialog's trust checkbox, and
> `apps.remove` / `apps.set_policy` / `apps.set_enabled(false)` clear the
> token's `"app-launch"` entries across all threads.

### Blocker 2: Q4 — Expand READ_ALLOWED_APPS alongside W7

**Source**: Pi.
**Reason**: Phase 0 hardcoded `READ_ALLOWED_APPS = {com.apple.mail}` (W5 deliverable). Phase 1 W6 implemented writeOne for Notes + Finder, but readOne still rejects non-Mail. If W7 ships the inline checkbox without expanding read allowlist, the checkbox is **inert for every non-Mail read** — user sees checkbox, approves, next call still hard-rejected. Worse UX than no checkbox.
**Resolution**: W7 PR includes:
```diff
- export const READ_ALLOWED_APPS = new Set(["com.apple.mail"])
+ export const READ_ALLOWED_APPS = new Set(["com.apple.mail", "com.apple.Notes", "com.apple.finder"])
```
Plus corresponding AppleScript for `list-notes` / `list-files` and Swift `list-notes` / `read-note` / `list-files` / `read-file-info` subcommands. (This expands W7 scope by ~2 days.)

## Phase 1 W7 final scope (locked)

### In scope
1. L2 dialog inline checkbox for `host_read` / `host_write` (read-only auto-approval; writes always biometric)
2. Thread-scoped trust map: `Map<threadId, Set<`${app}:${kind}`>>` with thread lifetime TTL
3. Expand `READ_ALLOWED_APPS` to {Mail, Notes, Finder} + corresponding list/read AppleScript + Swift subcommands
4. `security-confirmation.ts` gains `relevantApps: string[]` field + `getRelevantApps()` getter
5. `handleSecurityConfirmationResponse` accepts `add_to_thread_whitelist: boolean`, validates against `relevantApps[0]`
6. Audit log: `security.thread_auto_approved` with all 5 fields (confirmation_id, thread_id, bundle_id, kind, tool_call_id)
7. Tests: 5-7 new (thread-scope approval, reset on switch, vault precedence, write-side biometric enforcement, expanded allowlist)

### Out of scope (Phase 2+)
- Dedicated SettingsSlideout "信任的本地程序" section
- Persistent cross-thread whitelist (`auto_approved_apps: string[]`)
- Per-verb granularity
- Cross-platform schema discriminated union
- macOS version bump re-confirmation
- Apple Shortcuts / OS TCC state mirroring
- Time-bounded biometric session (5min) — only if Phase 1 fatigue data shows need

## Implementation estimate (revised)

- Original W7 estimate (synthesis doc): ~80 LOC companion + ~30 LOC extension + 3 tests, ~3-4 hours
- Q4 expansion adds: ~150 LOC (AppleScript + Swift subcommands for Notes + Finder read) + ~5 tests, ~2 days
- **Total W7: ~260 LOC + ~8 tests, ~2-3 days**

## Open follow-up (Phase 2 backlog, recorded)

- Persistent whitelist UI (SettingsSlideout section, mirrors auto_approved_domains)
- Schema field `auto_approved_apps: string[]` (Q5)
- Apple Shortcuts / OS TCC state mirroring (Q6 Option B/C)
- macOS version bump re-confirmation (Q7 Option A/B)
- Time-bounded biometric session if fatigue data warrants (Q1 Phase 2 variant)
- Per-verb whitelist if Phase 2 introduces destructive verbs (Mail send, Calendar create)

## Kimi+Pi review artifacts

- `docs/decisions/w7-trusted-apps-synthesis.md` — pre-review brief (4 sub-agent findings)
- Kimi CLI session `3b4f38cd-d48a-4d43-8f52-8867e03ae555` (saved to `/tmp/kimi-w7-output-v2.txt`)
- Pi-sub Agent subagent review (in conversation history 2026-07-16)
