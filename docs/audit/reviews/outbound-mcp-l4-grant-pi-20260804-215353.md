I have everything needed. Verified implementation reality against the design claims, and applied the ADR-020 checklist.

---

# Independent review — Outbound MCP L4+ Grant Design (P1 ship gate)

**Scope check:** The patch file `outbound-mcp-l4-grant-diff-20260804-215353.patch` contains **no hunks** (empty diff). `git status` confirms: the design doc + P0d preflight are **already committed** in `4e01c1e`; the batch's untracked outputs are prompt/patch/review files only. The object under review is therefore the committed design document itself — and it is a pure-docs design draft: `grep` confirms zero code references to `CMSPARK_OUTBOUND_GRANT`, `outbound-grants`, or `outbound.require_grant` in `companion/src/`. "Implementation has NOT started" is factually correct.

## 1. Implementation reality vs design claims (spot-checked, not rubber-stamped)

| Design claim | Reality check | Result |
|---|---|---|
| §1 "invoke/disclosure use Bearer == ws_secret" | `companion-http.ts:66-71` `authorizeOutboundHttp` = `safeEqualStr(token, expectedSecret)`; dispatcher secret comes from `getOrCreateSharedSecret()` (`stdio-server.ts:92-103`) | **Confirmed** |
| §1 "any caller_id can be claimed" | `companion-http.ts:95` `caller_id` read from **request body**, free-form, not bound to the bearer | **Confirmed** — this is exactly the L4+ gap; the grant's caller-binding fixes it |
| §1 "L3+ disclosure self-ack" | `disclosure-session.ts` in-process map keyed by caller string; meta tool `cmspark__accept_data_disclosure` + `POST /disclosure` accept with no human HITL (`stdio-server.ts:130-190`) | **Confirmed** — and the design leaves this open in Q3 |
| §3 "ws_secret stays for WS pairing" | `ws-auth.ts` HMAC challenge–response for WS, separate purpose | **Confirmed** |
| P0d L7 | Preflight PASS for environment; **T1/T2/T3 NOT RUN** → L7 INCONCLUSIVE | **Confirmed** — grant is correctly gated on T1 PASS |

## 2. Claims confirm/refute

- **Separating grant from `ws_secret` is necessary for L4+ — CONFIRMED.** Today the same secret (a) authenticates Side Panel WS, (b) authorizes outbound invoke/disclosure for **any** body-supplied `caller_id`, (c) is inherited by the `mcp-outbound` stdio child (`stdio-server.ts:93`). Sharing it with IDE MCP config means any leak compromises both pairing and every caller identity. ADR-022 L4+ ("loopback/stdio/PID ≠ auth", grant = P1 ship gate) requires the split. Option D (loopback transport + separate grant factor) is the right hybrid; Option C alone would *violate* L4+ by making stdio/PID an auth factor, and the doc correctly demotes it to defense-in-depth. Option A (client secret) over B (JWT) for Phase 1 is defensible: no key-management/clock-skew, API-key UX, migratable to B in 1.1.

- **Hashed token store adequate for Phase 1 — CONFIRMED with nits.** High-entropy random token + sha256-hash-only store means a disk dump of `outbound-grants.json` yields unusable hashes (rainbow tables don't apply to ≥256-bit random). Adequate given TTL + revoke UI + OS user boundary. Nits below (entropy/format, Windows ACL, revocation freshness).

- **Fail-closed error codes — MOSTLY adequate; one real gap.** The 5 codes cover the grant lifecycle, but the design never maps them to HTTP statuses (current handler returns 401 for all auth failures, 422 for invoke, `companion-http.ts:204-215,227`). Coding agents branch on status+code; `GRANT_REQUIRED` (401) vs `GRANT_EXPIRED/REVOKED/MISMATCH` (403) matters for their retry logic. Also `GRANT_CALLER_MISMATCH` must be enforced on **both** `/invoke` and `/disclosure` (body `caller_id` vs grant binding) — the matrix implies it for disclosure but doesn't say so explicitly.

- **"No implement until T1 PASS" — CONFIRMED correct, one wording nit.** ADR-022 L7: T1 fail → pivot B/C, park grant. The grant is trust packaging of a *proven* surface, not a substitute for product value. Wording nit: §8/§10 say "T1 pass → open dual-review → implement", yet this review happens pre-T1 by design. The doc should state explicitly: *design direction may be locked pre-T1; M1–M7 implementation must not start until T1 PASS* — so §7's eval gate is unambiguous.

## 3. Design holes hunted (none REJECT-level)

- **Dual-auth bypass / dual-mode:** The flag semantics need pinning before M1: (a) when flag ON, `mcp-outbound` with missing `CMSPARK_OUTBOUND_GRANT` must **hard-fail GRANT_REQUIRED, never fall back to `ws_secret`** — §5.2 says "required" but the no-fallback rule must be explicit (the current `wireDefaultOutboundHttpDispatcher` unconditionally reads ws_secret); (b) the legacy window is a temporary audit-flagged state with a hard date (Q2), not an indefinite backdoor; (c) define behavior when both `ws_secret` and a grant are presented (reject as ambiguous).
- **Disclosure without human HITL (Q3):** Under grant, a caller can still self-ack exfil-class disclosure for its own bound `caller_id` — no human. This is pre-existing Phase-0 semantics, **not enabled by the grant**, and the product premise only forbids confirm-skip of L2/URL. Still, a P1 "ship" narrative for `get_page_text`/`screenshot` must not be "grant = consent". Recommend Q3 answer: P1 keeps caller-bound self-ack (bake-off parity) but adds human-visible disclosure events (tray/toast + audit) and instant revoke; P2 upgrades exfil disclosure to human HITL. Must be recorded in synthesis.
- **Revocation TOCTOU:** verify should read the store per request (or invalidate a cache on revoke) so `revoked_at`/`expires_at` take effect on the *next* request, not on restart. Specify.
- **Grant theft:** same-user file read of grants.json is harmless (hashes); token lives in IDE env/config — same class as IDE-config leak; acknowledge `/proc/*/environ`/env-block visibility and lean on short TTL + revoke. Fine for v1.
- **Confused deputy:** caller-binding + audit is the right answer; audit lines must carry `grant_id` — `audit.ts` has no such field today, so M1 must extend `OutboundAuditEvent`.
- **Windows path/permissions:** `0o600` is advisory on NTFS ACLs; hash-only storage + user-profile location is the real defense. Make the platform caveat explicit (repo precedent: ADR-018 platform honesty) and don't claim 0o600 as a strong control on Windows.
- **Multi-IDE (Q4):** Recommend multiple per-machine grants, each bound to a distinct `caller_id` + label, list/revoke UI, revoke-all kill-switch. Reject "one machine-wide grant" — violates G3.
- **TTL (Q1):** Default 30d wall-clock with per-grant override (1h/24h/7d/30d); not "until restart" (ambiguous for IDE agent spawn models).
- **Cutover (Q2):** Flag default ON at first P1 GA; `ws_secret` hard-rejected on `/outbound-mcp/*` from that build (Phase 0 never shipped, so no prod migration burden); deprecation window dev-only.

## 4. ADR-020 capability checklist

- **Declaration present** in the implementer prompt (Surface L1 export / L2 none / Compose mcp-server grant gate / Autonomy n/a / Trust separate grant / Channel community) — and the diff is pure docs, so even the "at minimum nit" bar is satisfied. Not blocking.
- **Axes fit:** Grant = auth packaging on the Composition (mcp-server outbound) axis; no new runtime, no "中层 Agent" language anywhere. ✓
- **Trust monotonicity:** Grant **tightens** trust (separate identity, caller-bound); no gate relaxed; confirm-skip explicitly forbidden; L2/URL confirm untouched. ✓
- **originWs / no new confirm dialect:** The design adds **no** confirm family — confirms are unchanged; `origin.ts` already binds a synthetic origin (`originWs: null` placeholder). Pre-existing P1-2 item (outbound confirms carry `originWs: null`) is out of scope for this auth-packaging design and is not regressed. ✓
- **Pack-first:** Settings sub-menu item, not new primary Side Panel chrome. ✓

## 5. Verdict reasoning

**Not REJECT:** implemented as written, the scheme satisfies L4+ (grant separate from pairing, caller-bound, TTL, fail-closed), forbids confirm-skip, keeps L2/URL/disclosure gates, and gates ship on T1 PASS. No fatally incomplete design direction — the open items are answerable in synthesis, and the design itself solicits exactly the right questions (Q1–Q4).

**Not APPROVE:** the doc is a *draft explicitly awaiting dual-review*; §9 open questions are genuinely open (self-ack disclosure posture under grant, dual-mode flag semantics, hard-cutover date), and a few Phase-1 specifics must be pinned before M1 (no-fallback rule, HTTP status mapping, revocation freshness, audit `grant_id`). Direction is lockable only with those resolved.

**Nits (non-blocking, to fold into synthesis before M1):**

1. **§5.3 flag semantics:** when `outbound.require_grant` is ON, `mcp-outbound` must hard-fail `GRANT_REQUIRED` on missing grant — never fall back to `ws_secret` (pin in M3; current `wireDefaultOutboundHttpDispatcher` unconditionally reads the secret).
2. **§5.6 status mapping:** add HTTP codes — `GRANT_REQUIRED`→401, `GRANT_EXPIRED/REVOKED/CALLER_MISMATCH`→403, keep `PROFILE_FORBIDDEN` (no new code needed for profile-scope denial).
3. **§5.2 disclosure binding:** enforce `GRANT_CALLER_MISMATCH` on `POST /disclosure` too (body caller must equal grant-bound caller), not only `/invoke`.
4. **§7 M1:** extend `OutboundAuditEvent` (`audit.ts`) with `grant_id`; audit issue/use/revoke (G7).
5. **§5.1 store:** pin token format/entropy (≥32 random bytes, prefixed `cmg_`, sha256-of-raw, unsalted OK for high-entropy); verify per-request or cache-invalidate so revoke/expiry bite immediately.
6. **§5.1 Windows:** state that `0o600` is advisory on NTFS; hash-only storage + user-profile dir is the defense (ADR-018-style platform honesty).
7. **§9 Q1:** default 30d wall-clock, per-grant override, not session-until-restart. **Q2:** flag ON + hard reject at first P1 GA (no prod Phase-0 burden). **Q3:** P1 = caller-bound self-ack **with human-visible audit/toast + instant revoke**; P2 = human HITL for exfil class — record this as the locked answer, not left open at ship. **Q4:** multiple per-caller grants, revoke-all kill-switch; no machine-wide grant.
8. **§8 wording:** state explicitly that this design-lock review precedes T1 but M1–M7 implementation waits for T1 PASS.
9. **§6 threat table:** one muddled line — "hash storage limits reuse of disk dump only if attacker has online token" should read: a disk dump yields unusable hashes; the plaintext token lives in IDE env/config, hence TTL/revoke/education. Also acknowledge process-env visibility.

VERDICT: APPROVE_WITH_NITS
