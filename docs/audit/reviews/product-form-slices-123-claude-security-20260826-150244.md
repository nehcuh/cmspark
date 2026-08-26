All must-hold invariants verified against the codebase. Writing up the review.

---

# Security Review — slices 1–3 implementation PLAN (Product-form 租手/Confirm L8/honesty)

**Scope:** `docs/superpowers/plans/2026-08-26-product-form-slices-123.md`, plan-level security review per `dual-review-capability-checklist.md`. All claims below are `[inspected]` against current source (no edits made).

## Must-hold invariants — all verified

**1. Overlay never grant-issue / confirmation.response — HOLDS.**
`SUMMONER_ALLOW` (`companion/src/ws/summoner-acl.ts:14-45`) contains neither `outbound_mcp.grants.issue` nor `security.confirmation.response`, and the ACL gate runs at `companion/src/ws/lifecycle.ts:1038` **before** the confirmation-response handler at `:1064` — a summoner socket can never reach `respondFrom`. The plan keeps the ACL unchanged ("Capture overlay unchanged ACL"), Task 10 pins `assertSummonerAllowed("summoner","security.confirmation.response").ok === false` with a test, Task 12 adds nothing to `SUMMONER_ALLOW`, and both are in the BLOCK list. Task 4's WS `grants.issue` pass-through runs on the extension surface only (overlay blocked by ACL).

**2. CLI no listen/POST disclosure — HOLDS.** Task 2 forbids `listen()`/`createServer`/`fetch`/POST and forbids importing `acceptOutboundDisclosure` (grep test). No HTTP grants routes (Task 3 keeps `/outbound-mcp/v1/grants` at 404). Verified there is no CLI-side need: `verifyOutboundGrantToken` reloads `outbound-grants.json` per request (`outbound-grants.ts:185-209`), so CLI file-writes take effect on the daemon without any channel between them.

**3. `allow_page_export` on file, not Map — HOLDS.** Task 1 puts the flag on `OutboundGrantRecord` (0o600 atomic-write file, token stored sha256-only — verified current shape), exports `grantAllowsPageExport` that reloads JSON and ignores revoked/expired (no staleness/TOCTOU). Test asserts `hasOutboundDisclosure === false` after issue with the flag.

**4. First-exfil HITL does not persist 30d flag — HOLDS.** Verified the real hole the plan closes: today `POST /disclosure` (`companion-http.ts:458-501`) → `acceptOutboundDisclosure` → session Map, and the exfil branch (`:284`) reads **only** the Map — caller self-ack arms exfil. Task 3's gate algebra (`flag on file ∧ operator HITL`, HTTP/stdio ack MUST NOT set the Map) fixes exactly this, and the conjunction is monotonic: flag-without-session → `DISCLOSURE_HITL_REQUIRED`; session (8h in-process, `disclosure-session.ts:15`) without flag → `DISCLOSURE_NOT_GRANTED`; Confirm Center approve writes only the session, never the grant JSON; revoke kills exfil at the bearer layer regardless of Map state.

**5. Win/Linux never skip-confirm — HOLDS.** Task 8: `waitForExtensionPeer` timeout → explicit error, **never** `approved: true`, with a machine test ("timeout rejects; never approved"); BLOCK covers skip-confirm; UAT step 5 exercises it.

**6. HUD stdin no grant this slice — HOLDS.** Task 12 is hide-not-delete; no grant-issue stdin command added; BLOCK names it.

**7. `require_grant` stays true — HOLDS.** Plan never touches it; CLI forbids `--require-grant` (the pre-existing WS toggle `outbound_mcp.set_require_grant` at `message-router.ts:3359` is untouched and not on `SUMMONER_ALLOW`).

## BLOCK optionality check

No BLOCK item is stated as optional anywhere in the plan. Task 12's "Optional new test" concerns an extra hide assertion, not a BLOCK item. Every BLOCK item has either a machine test or an explicit MUST NOT + the T3 dual-review gate before merge. Not optional → no rejection trigger.

## Checklist (ADR-020)

- **Axes declared** ✓ (Surface/L2/Compose/Autonomy/Trust/Channel block present). Grant-flag persistence hangs on Composition; confirm retarget on Surface/Trust — correct axes, no "middle agent" framing.
- **Trust monotonicity** ✓ — gates only tighten (removes a loosening ack path, adds a conjunction).
- **originWs (P1-2)** ✓ improved: Task 5 binds overlay-origin confirms to the extension socket; overlay never becomes `originWs`; `trayOwnerWs` never summoner. Verified the plan's footnote is grounded: extension handshake surface normalizes to `"tray"` (`lifecycle.ts:991`), so filtering `surface !== "summoner"` (not `=== "tray"`) is the correct predicate.
- **Confirm dialects** ✓ — reuses `SecurityConfirmationManager` + Confirm Center fan-out; no new confirmation family.
- **rejectAll (Task 6)** — verified current code (`security-confirmation.ts:515-545`) does kill unbound confirms on any peer close; the strict-`originWs===ws` fix keeps the 45s timeout as reaper and no-arg drain for shutdown — fail-closed preserved.
- **P1-1/3/4** untouched. Experimental labeling machine-checked (`尚未跑`, §8.1 verbatim-first).

## Nits (non-blocking)

1. **Task 1 test masks its own regression:** `issueOutboundGrant(allow_page_export:true)` → `clearAllOutboundDisclosureSessions()` → assert `hasOutboundDisclosure === false`. If `issueOutboundGrant` wrongly called `acceptOutboundDisclosure`, the clear erases the evidence and the test false-greens. Move the clear **before** the issue call or drop it. (Task 2's variant asserts without clearing — partially mitigates.)
2. **Task 10 vs Task 5 seam ambiguity:** "overlay socket respondFrom cannot resolve exfil confirm" vs "outbound stays unbound". At the `respondFrom` seam, unbound pending accepts any socket (`security-confirmation.ts:411`) — the invariant actually holds one layer up (ACL at `lifecycle.ts:1038`). Pin the seam in the test (exercise the ACL/lifecycle path), or the test is false-green or nudges binding outbound confirms to the extension (which would break tray-confirm for outbound callers).
3. **Task 2 no-server constraint lacks a machine check:** only the `acceptOutboundDisclosure` import is grep-tested; extend the same grep to forbid `listen(`/`createServer(`/`fetch(` in `grant-cli.ts`. BLOCK + T3 review backstop it today.
4. **Task 4 grep-forbids** (`无缝对接`, `CMspark for Codex`, `Bearer $SECRET`, user-facing `Handoff`) are prose-level; ensure they land inside `outbound-mcp-docs-grant.test.ts` so they're machine-enforced like the snippet rule.

The plan closes a real, verified vulnerability (caller self-ack arming exfil), tightens every gate it touches, and keeps the overlay read-only. Nits are test-seam precision, not security regressions.

VERDICT: APPROVE_WITH_NITS
