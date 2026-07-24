# Phase 1 W7 Trusted Apps Config — 4-Agent Synthesis (pre Kimi+Pi)

> **Date**: 2026-07-16
> **Process**: 4 parallel sub-agents (UX / Security / Implementation / Product) → this synthesis → Kimi+Pi 3-way advisor → final decision.
> **Source brief**: User question "should Phase 1 W7 add trusted-apps whitelist config UI?"

## Convergent recommendation (all 4 agents independent agreement)

**Phase 1 W7 = inline "信任此 app，本线程内不再询问" checkbox on L2 confirmation dialog.**

**Phase 2 = dedicated SettingsSlideout "信任的本地程序" section (deferred).**

Rationale:
- A1 (UX): thread-scope matches "能力跃迁确认" boundary; read-fatigues-fast/write-fatigues-slow asymmetry
- A2 (Security): reuses ADR-007 `add_to_whitelist` server-side validation pattern; doesn't create new WS injection surface
- A3 (Impl): inline checkbox ~50 LOC + 2 tests vs dedicated UI ~240 LOC + 6 tests
- A4 (Product): doesn't expand Phase 1 scope; preserves KPI baseline (rejection-rate signal stays clean); defers power-user chrome

## What Phase 1 W7 delivers

### Scope (in)
1. **L2 dialog gains inline checkbox**: "信任此 app，本线程内不再询问 [ ]"
   - Only shown for `host_read` / `host_write` (not evaluate / osascript_eval / navigate)
   - Default unchecked
   - When checked + Approve clicked: companion records `(thread_id, bundle_id, kind)` tuple
2. **Thread-scoped auto-approval**: subsequent `host_read`/`host_write` calls in same thread with matching `(bundle_id, kind)` skip L2 dialog
3. **Audit log**: `security.thread_auto_approved` event with thread_id + bundle_id + kind + original_confirmation_id
4. **Reset semantics**: thread switch → silent reset (no notice); user mental model preserved via thread switch UI

### Scope (out — Phase 2+)
1. ❌ Dedicated SettingsSlideout section
2. ❌ Persistent (cross-thread) whitelist
3. ❌ Per-verb granularity (only per kind: read vs write)
4. ❌ Cross-platform schema discriminated union (Phase 1 macOS flat string)
5. ❌ macOS version bump re-confirmation

## Open questions for Kimi+Pi 3-way advisor

### Q1 — Write-side biometric fatigue (A1 raised)
Phase 1 writes are biometric-gated (Touch ID). If user creates 5 Notes in one thread:
- Option A: Touch ID per call (5 prompts, fatigue after ~3 in 60s)
- Option B: First Touch ID pre-approves subsequent Notes writes in same thread
- Option C: First Touch ID pre-approves + user can re-prompt via "确认每一次" toggle

Which? Biometric fatigue is real but biometric-per-call is the strongest security proof.

### Q2 — Thread-scope reset notice (A1 raised)
When user switches threads, should pre-approval:
- Option A: Silent reset (less noise)
- Option B: One-line notice on next call ("本线程需重新确认 Mail 读取")

Which? Trade-off: noise vs mental model preservation.

### Q3 — `host_write` matching key (A3 raised)
`host_write` schema binds token to `params.kind` ("create"/"move"/...), not `application`. For thread-scoped auto-approval:
- Option A: Match by `kind` only — "trust create-note in this thread" covers all Notes creates
- Option B: Match by `(kind, target_app)` — finer-grained but requires extracting app from TargetId

Which?

### Q4 — Phase 0 allowlist interaction (A2 + A3 raised)
Phase 0 has `READ_ALLOWED_APPS = {com.apple.mail}` hardcoded (W5). If W7 introduces thread-scoped whitelist for `com.apple.Notes`, the hard allowlist still rejects it. Two paths:
- Option A: W7 expands `READ_ALLOWED_APPS` to include Notes/Finder (capability expansion)
- Option B: W7 stays read-only Mail; thread whitelist is moot for other apps

Which? (Note: writeOne already supports Notes + Finder via `host.swift create-note/move-file` — the read restriction is asymmetric.)

### Q5 — Single-app config vs array (A2 raised)
If we eventually do persistent whitelist (Phase 2), should schema be:
- Option A: `auto_approved_apps: string[]` (mirror domains)
- Option B: `auto_approved_read_app: string | null` (single, simpler)

A2 argues B is more honest per Kimi Round 2 §5.3 ("don't make new words"). A3 impl prefers A for symmetry.

### Q6 — Apple Shortcuts parity (A4 raised)
Apple already exposes per-app Automation toggles in System Settings → Privacy & Security → Automation. Should cmSpark:
- Option A: Maintain proprietary whitelist (full control, duplicates OS surface)
- Option B: Read OS TCC state, display "enabled via System Settings", don't duplicate
- Option C: Hybrid — proprietary list for thread-scope, defer to OS for persistent

Which?

### Q7 — Stale-verb drift labeling (A2 raised)
Mail/Notes AppleScript sdef can change across macOS versions. Per-app whitelist implicitly trusts "current macOS version's Mail verbs". Should the UI:
- Option A: Label as "信任此 app（当前 macOS 版本）" with manual review hint
- Option B: Auto-detect macOS version change, force re-confirmation
- Option C: Silent — accept drift risk

Which? (Phase 2 question if W7 is thread-scoped only.)

### Q8 — Audit trail granularity (A2 raised)
Current `security.auto_approved` logs `reason: "god_mode" | "global_toggle" | "domain_whitelist"`. W7 adds `"thread_auto_approve"`. Should the log also include:
- `original_confirmation_id` (trace to the user's explicit approval)
- `thread_id` (scope)
- `bundle_id` + `kind` (what was approved)

All three? Subset?

## Implementation sketch (if approved after Kimi+Pi)

**Companion** (~80 LOC):
- `companion/src/security-confirmation.ts`: add `relevantApps: string[]` to PendingConfirmation + `getRelevantApps(id)` getter
- `companion/src/server.ts:317-440`: extend L2 gate — if `toolName in [host_read, host_write]`, populate `relevantApp` from params, check thread-scoped whitelist (`threadAutoApprovals.has(threadId+app+kind)`)
- `companion/src/server.ts:890-980`: extend `handleSecurityConfirmationResponse` — accept `add_to_thread_whitelist: boolean`, validate against `relevantApps[0]`
- New: `companion/src/thread-approvals.ts` — Map<threadId, Set<`${app}:${kind}`>> with TTL = thread lifetime

**Extension** (~30 LOC):
- `chrome-extension/src/sidepanel/App.tsx` SecurityConfirmationDialog — when `request.relevant_apps?.[0]` is set, show checkbox "信任此 app，本线程内不再询问"
- Send `add_to_thread_whitelist: true` in response when checked + approved

**Tests** (~3 new):
- Thread-scoped approval: first call confirms, second call in same thread skips with audit log
- Thread switch resets: new thread → confirmation requested again
- Vault app never auto-approved even if somehow in thread whitelist (defense in depth)

## Deferred to Phase 2 (recorded for backlog)

- Dedicated SettingsSlideout "信任的本地程序" section (Phase 2 when usage data shows need)
- Persistent cross-thread whitelist (`auto_approved_apps` schema field)
- Per-verb granularity (read-inbox vs read-thread vs send)
- Cross-platform discriminated union schema
- macOS version bump re-confirmation
- Apple Shortcuts / OS TCC state mirroring
