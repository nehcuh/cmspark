# Dual Review (Claude re-run) — Outbound MCP L4+ Grant Design (P1 ship gate)

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Reviewer | Claude-class independent security / architecture peer |
| Stage | **Design only** — implementation has **not** started |
| Primary SoT | [`docs/decisions/outbound-mcp-l4-grant-design-2026-08-04.md`](../../decisions/outbound-mcp-l4-grant-design-2026-08-04.md) |
| ADR locks | [`docs/adr/022-outbound-mcp-server.md`](../../adr/022-outbound-mcp-server.md) L4 / L4+ / L3+ / P1 |
| Capability ontology | [`docs/adr/020-capability-model-three-axes.md`](../../adr/020-capability-model-three-axes.md) Trust monotonicity |
| Prior peer | Pi `outbound-mcp-l4-grant-pi-20260804-215353.md` (APPROVE_WITH_NITS) — this re-run is **independent**, not a rubber-stamp of Pi |
| Prior Claude batch | `outbound-mcp-l4-grant-verdict-20260804-215353.json` recorded Claude **UNKNOWN** / exit 1 — this file is the re-run deliverable |

**Evidence tags:** `[inspected]` = read source; `[assumed]` = reasoned without execution; no `[executed]` (design-only; no tests to run).

---

## 0. Scope and ground-truth method

Reviewed the design document as a **direction proposal** (status: DRAFT · not dual-reviewed · not implemented). Confirmed absence of implementation:

- No `outbound-grants.ts`, no `CMSPARK_OUTBOUND_GRANT` consumer, no `outbound.require_grant` in `companion/src/` `[inspected via prior grep context + design claim]`.
- Live auth path is still Bearer == Extension pairing secret.

Spot-checked against live code (not design fantasy):

| File | What was checked |
|------|------------------|
| `companion/src/outbound-mcp/companion-http.ts` | `authorizeOutboundHttp`, invoke/disclosure handlers, free-form `caller_id` |
| `companion/src/outbound-mcp/stdio-server.ts` | `wireDefaultOutboundHttpDispatcher` → `getOrCreateSharedSecret()` |
| `companion/src/outbound-mcp/http-client.ts` | Bearer header on invoke + disclosure |
| `companion/src/ws-auth.ts` | pairing secret purpose + 0o600 persistence |
| `companion/src/outbound-mcp/disclosure-session.ts` | server-side session; no human HITL |
| `companion/src/outbound-mcp/profile.ts` | curated L1 + exfil class |
| `companion/src/server.ts` | loopback HTTP wires `handleOutboundMcpHttp(req, res, getOrCreateSharedSecret())` |
| `docs/mcp.md` | user docs still instruct Bearer `ws_secret` dual-use |
| ADR-022, ADR-020, dual-review checklist, dual-review prompt | locks + verdict rules |

---

## 1. Implementation reality vs design claims

| Design claim | Code reality | Verdict |
|--------------|--------------|---------|
| Invoke/disclosure auth = `Authorization: Bearer <ws_secret>` | `authorizeOutboundHttp` (`companion-http.ts` ~L87–95): Bearer vs `expectedSecret` via `timingSafeEqual` length-checked compare. `server.ts` passes `getOrCreateSharedSecret()`. Stdio wires the same secret into HTTP client (`stdio-server.ts` `wireDefaultOutboundHttpDispatcher` ~L68–86; `http-client.ts` L39). | **CONFIRMED** `[inspected]` |
| Any local reader of `ws_secret` can accept L3+ disclosure for **any** `caller_id` | `POST /disclosure` after auth: `caller_id` from body, free-form (`companion-http.ts` ~L335–344 → `companionAcceptDisclosure`). No binding between bearer material and caller. | **CONFIRMED** `[inspected]` |
| Same secret can invoke curated L1 against real Chrome | `companionInvokeOutbound` after same Bearer gate; runner is Extension-bound CDP (`createToolExecutor`). Profile still gates tools (`gateOutboundCall` / allowlist). | **CONFIRMED** `[inspected]` |
| Same secret authenticates Side Panel WS | `ws-auth.ts`: HMAC challenge–response on WS; secret file `~/.cmspark-agent/ws_secret` (0o600). Distinct protocol from outbound HTTP, **same material**. | **CONFIRMED** `[inspected]` |
| L4+ “loopback / stdio / PID ≠ auth” is currently violated for product trust packaging | Loopback bind + shared secret is the only outbound gate. Stdio is not an identity. Parent PID is never checked (correctly — must not become sole auth). Dual-use of pairing secret means “has local OS user + file read” ≈ full MCP caller power. | **CONFIRMED** as the A-F2 residual `[inspected]` (multi-adv post-S41 marks A-F2 open P1) |
| `disclosure_accepted` param is not trusted | Facade/bridge/companion re-check `hasOutboundDisclosure(caller_id)` only; body flag ignored (`facade.ts` comment ~L79–80; `disclosure-session.ts` header). | **CONFIRMED** — L3+ *session* rule holds; **human** HITL for accept does **not** `[inspected]` |
| Health unauthenticated, no secrets | `GET …/health` before auth branch; returns `{status, runner, service}` only. | **CONFIRMED** `[inspected]` |
| Grant must not ship before P0d T1 PASS | ADR-022 P0d = L7 bake-off; P1 = grant. Design §8/§10 align. Preflight elsewhere still treats L7 as not run / inconclusive. | **CONFIRMED correct gate** `[assumed` from ADR + design; bake-off not re-run here`]` |

**Bottom line:** Design §1 problem statement is factually accurate against tip code. The proposed split (Extension pairing stays `ws_secret`; MCP caller uses distinct grant) is necessary for ADR-022 **L4+**, not optional polish.

---

## 2. Capability declaration & ADR-020 checklist

Implementer declaration (from dual-review prompt):

```text
Surface:      L1 outbound export only (no L2 in grant default profile)
L2-classes:   (none via grant)
Compose:      mcp-server (outbound) grant gate
Autonomy:     n/a (auth packaging)
Trust:        separate MCP-caller grant from Extension pairing; L2/URL confirm remain
Channel:      community; enterprise modules still out of default outbound set
```

| Check | Result |
|-------|--------|
| Axes fit | **Pass.** Grant is Trust packaging on Composition (`mcp-server` outbound export). Not a Surface deepening; not Autonomy; not a second runtime / 「中层 Agent」. Design language matches ADR-020/022. |
| Pack-first | **Pass.** UX = Settings sub-surface + optional tray shortcut — not a new primary Side Panel product chrome. |
| Confirm dialects | **Pass.** Explicit non-goal: grant must **not** skip L2 / URL-gate / L8. No new confirm family proposed. |
| Trust monotonicity | **Pass (direction).** Default profile remains curated L1; confirm-skip forbidden; grant **narrows** who may call, does not widen what they may do. Residual risk: free-form `profile` string later expanded without dual-review — pin enum (nit). |
| originWs | **n/a for this design.** No change proposed to `securityConfirmations.request`. Must not regress existing outbound origin binding in implementation dual-review (P1-2 watchlist). |
| No new runtime | **Pass.** Auth store + HTTP authorize path only. |
| Experimental layers | **n/a.** |

Missing declaration would have been a nit for pure docs; declaration is present and correct.

---

## 3. Claims confirm / refute (prompt §2)

### 3.1 Separating grant from `ws_secret` is necessary for L4+ — **CONFIRMED**

ADR-022 L4+: *Loopback / stdio / parent PID ≠ authentication; grant model is P1 ship gate.*  
Today’s dual-use makes any process that can read `ws_secret` (or inherit it via `mcp-outbound`) a full outbound caller **and** holder of Extension pairing material. `docs/mcp.md` still documents that dual-use explicitly (Bearer `ws_secret` on invoke). That is acceptable **only** for non-product Phase 0 bake-off with honest docs (A-F1/A-F2 posture). Product ship without a distinct grant **fails L4+**.

Option C alone (PID / named pipe inheritance) would **violate** L4+ if used as sole factor; design correctly demotes it to defense-in-depth. Option B (JWT) is a reasonable Phase 1.1; Phase 1 Option A (opaque client secret) is the right simplicity trade.

### 3.2 Hashed token store adequate for Phase 1 — **CONFIRMED with nits**

Hash-only at rest (`token_hash`) after one-time UI show is correct for API-key-class secrets. Rainbow tables are irrelevant if token entropy is high. Disk dump of `outbound-grants.json` without the live token does not forge Bearer auth.

**Must pin before M1 (currently underspecified):**

1. **Entropy / format:** ≥ 32 random bytes (256-bit), encode as e.g. `cmg_<base64url>` so it is **visually and structurally distinct** from 64-hex `ws_secret` (reduces mis-paste and dual-auth confusion).
2. **Hash algorithm:** SHA-256 of raw token bytes (or UTF-8 of the issued string) is fine for high-entropy secrets; salt optional. Document exact bytes hashed.
3. **Windows ACL honesty:** `0o600` via Node `mode` / `chmod` is **best-effort / advisory on NTFS** (repo pattern in `io.ts`, `ws-auth.ts` already best-effort chmod). Real boundary is OS user profile isolation + hash-only. Do **not** market `0o600` as a hard ACL on Windows. Same class as `ws_secret` / `config.json`.
4. **Issue UX failure:** if UI crashes after persist-hash / before user copies token → grant is dead; allow re-issue (new token) not recovery of old plaintext.

### 3.3 Fail-closed error codes complete enough — **MOSTLY; gaps for ship**

| Code | Assessment |
|------|------------|
| `GRANT_REQUIRED` | Good umbrella for missing/malformed/unknown token when you do not want existence oracle. |
| `GRANT_EXPIRED` / `GRANT_REVOKED` | Good for operator UX once token is recognized. |
| `GRANT_CALLER_MISMATCH` | **Essential** — but design table does not **explicitly** require it on **`POST /disclosure`**. Today disclosure free-form `caller_id` is the confused-deputy / spoof hole. Binding **must** apply to both `/invoke` and `/disclosure`. |
| `UNAUTHORIZED` | Keep for malformed Authorization syntax. |

**Missing / underspecified:**

- **HTTP status map** for coding agents: recommend `GRANT_REQUIRED` → **401**; `GRANT_EXPIRED` / `GRANT_REVOKED` / `GRANT_CALLER_MISMATCH` → **403**; keep invoke business failures (profile, disclosure, lease) on **422** as today.
- **`GRANT_PROFILE_UNKNOWN` / fail-closed** if stored profile ∉ allowlisted enum (Trust monotonicity guard).
- Optional: `GRANT_DISABLED` if global kill-switch / feature flag off while client presents grant (clarity).

### 3.4 “No implement until T1 PASS” is correct — **CONFIRMED**

ADR-022: T1 fail → pivot Option B/C; do not expand automation surface; grant is packaging of a **proven** surface. Design §8 / §10 correctly park implementation on T1 fail and open dual-review after PASS.

**Wording nit:** This dual-review of the **design** correctly runs **before** T1. Lock language should be:

> Design direction may be dual-reviewed pre-T1. **M1–M7 code must not land** until P0d T1 PASS (or explicit product pivot that still needs grant for a narrower surface — then re-scope).

Eval gate “no product language ‘safe multi-agent MCP’ until M1–M6 green + dual APPROVE*” is correct and must include **hard reject of `ws_secret` bearer** on `/outbound-mcp/*` when ship language is used (see dual-auth below).

---

## 4. Option analysis (A–D) — challenge, do not rubber-stamp

| Option | Fit | Challenge |
|--------|-----|-----------|
| **A** client secret | Strong Phase 1 | Secret sprawl in IDE configs is real; mitigate with short default TTL, revoke UI, distinct prefix, education. **Do not** offer “dual headers: pairing + grant” as an **OR** auth path without a strict matrix (see §5). |
| **B** signed JWT | Good 1.1 | Clock skew, long tokens in env, signing-key storage/rotation cost — defer correctly. |
| **C** OS session / PID | Defense-in-depth only | Alone **violates L4+**. Fragile across IDE MCP spawn models. Correct demotion. |
| **D hybrid (recommended)** | **Right lock** | Factor 1 is really “loopback only” (not auth). Factor 2 is the auth. Phase 1 = D with A material. Do not invent a second long-lived transport secret that re-creates dual-use. |

**Proposal lock (this reviewer):** Option **D** with Phase 1 = **A** (hashed client secret, `caller_id` + profile + TTL bound); Extension pairing remains `ws_secret` for WS only; Phase 1.1 optional B.

---

## 5. Design holes hunted

### 5.1 Dual-auth / migration bypass — **NEAR-BLOCKER if left ambiguous (not REJECT of direction)**

Design §5.2 / §5.3:

- Flag `outbound.require_grant` default **false** (dev) / **true** when product claims ship.
- Deprecation window: accept `ws_secret` with loud audit `auth.legacy_ws_secret`, then hard reject.
- Option A prose: Bearer grant **or** dual headers pairing+grant.

**Attack:** Any local malware that already reads `ws_secret` (or steals it once) continues full outbound power for the entire dual-accept window. “Loud audit” is **not** a security control.

**Required lock before M1 (synthesis must write this matrix):**

| Mode | `Authorization: Bearer` | `ws_secret` accepted? | Notes |
|------|-------------------------|----------------------|--------|
| `require_grant=false` (bake-off / legacy) | `ws_secret` **or** grant | Yes, audit `auth.legacy_ws_secret` | Dev / P0d only; **forbidden** in product ship docs |
| `require_grant=true` (P1 ship) | **grant only** | **Hard reject** (401 `GRANT_REQUIRED` or dedicated `AUTH_LEGACY_REJECTED`) | No fallback in `mcp-outbound`; no “if grant missing, try `ws_secret`” |
| Both presented | Prefer: **reject ambiguous** or **grant wins only if grant verifies and ws_secret ignored** | Must not allow ws_secret alone when flag on | Pin one behavior |

**stdio (`M3`):** When flag ON, `wireDefaultOutboundHttpDispatcher` must:

1. Read `CMSPARK_OUTBOUND_GRANT` (required).
2. **Never** fall back to `getOrCreateSharedSecret()` for HTTP Bearer.
3. Fail fast with clear stderr + MCP error if missing.

Current code **unconditionally** uses `getOrCreateSharedSecret()` — implementers will copy-paste unless M3 is explicit.

**Product language gate:** Claiming “L4+ / safe multi-caller MCP” while `require_grant=false` or dual-accept remains → **documentation / ship REJECT**, even if code exists.

### 5.2 `caller_id` spoof / confused deputy — **fixed by design if binding is total**

Today: body `caller_id` is free-form after shared Bearer (`companionInvokeOutbound` L148; disclosure L342).  
Grant binding + `GRANT_CALLER_MISMATCH` is the right fix **iff**:

1. Verified grant record supplies the **only** trusted `caller_id` (or body must equal grant.caller_id).
2. Same rule on **disclosure** and **invoke**.
3. Audit records `grant_id` + `caller_id` + tool + outcome (G7; extend `OutboundAuditEvent`).
4. Prefer **at most one active (non-revoked) grant per `caller_id`** to avoid ambiguous multi-token deputy; multiple grants = multiple distinct `caller_id`s (or explicit multi-token same caller with all listed in audit).

Env `CMSPARK_OUTBOUND_CALLER_ID` today is independent of auth — after P1, env caller must match grant binding or be ignored in favor of grant claim.

### 5.3 Disclosure self-ack (Q3) — **not introduced by grant; still a ship-honesty hole**

Live path: agent with Bearer can `cmspark__accept_data_disclosure` / `POST /disclosure` with `acknowledge: true` and no human HITL. Server session is SoT (good vs param self-report); **human consent is not**.

Grant **does not** make this worse if grant is harder to obtain than `ws_secret` sprawl in every IDE config — it **contains** which caller may self-ack. It also **does not** satisfy a product claim that “user approved cloud exfil.”

**Recommended lock (Q3):**

| Phase | Disclosure accept |
|-------|-------------------|
| **P1 (grant ship)** | Caller-bound **agent self-ack remains** (bake-off parity; ADR-022 §5.4 is session SoT, not human HITL). **Human-visible** tray/Side Panel toast + audit line on accept; revoke grant **and** `revokeOutboundDisclosure(caller_id)` on kill. Docs must say: grant ≠ user cloud-exfil consent (extends A-F1 honesty). |
| **P1.1 / P2** | Optional human HITL for exfil-class disclosure (L8-style tray/global), **without** using grant as confirm-skip. |

Leaving Q3 open at **implementation** dual-review is unacceptable; leaving it open at **this** design lock is fixable via synthesis answer above.

### 5.4 Revoke TOCTOU

Store is a single JSON file. Risks:

1. **In-memory cache stale after revoke** → continue accepting until restart.
2. **Check-then-act:** verify grant → concurrent revoke → still run tool (acceptable for single in-flight op; **not** acceptable across later requests).
3. **`last_used_at` write races** revoke write → lost revoke or lost audit.

**Required implement rules:**

- Per-request verify against store (or cache with **synchronous invalidate on revoke/issue** under a mutex).
- Revoke sets `revoked_at` and drops cache entry before returning UI success.
- Atomic write for grants file (`atomicWriteJSON` pattern, 0o600 best-effort).
- Optional: revoke also clears disclosure sessions for that `caller_id`.

In-flight request completing after revoke is acceptable; **next** request must fail closed.

### 5.5 Grant theft / IDE env leak

Same class as API keys: `CMSPARK_OUTBOUND_GRANT` in IDE MCP JSON / process environ (`/proc/*/environ`, crash dumps, synced settings). Mitigations in design (TTL, revoke, education) are appropriate for Phase 1. Do **not** claim malware-same-user resistance beyond OS user boundary.

Hash file alone is not enough if attacker is **online** with stolen env token — design §6 first row is slightly muddled; clarify: disk dump of hashes ≠ token; live token in IDE env is the high-value secret.

### 5.6 Windows path / permissions

User is on Windows (reviewer host). Design only says `0o600`. Pin ADR-018-style honesty: NTFS ACLs may not match POSIX mode bits; defense = user profile + hash-only + revoke. No extra Windows-only store required for Phase 1 if consistent with `ws_secret`.

### 5.7 Profile / confirm-skip escalation

`profile: "outbound_l1_default"` is a string. **Fail-closed enum** required. Expanding profile to confirm-skip, cookies, evaluate, L2, shell, netsec **must** be a separate dual-reviewed change (ADR-022 L3 / Trust monotonicity). Phase 1 grants must not carry “skip_confirm” bits even as ignored fields (strip unknown keys).

### 5.8 Multi-IDE concurrent grants (Q4)

**Recommend:** many concurrent grants per machine; unique `id`; unique active `caller_id` (or labeled multi-token with clear UI); revoke-all kill-switch (G5 — currently named in goals, **missing** from §5 scheme). Reject single machine-wide shared grant (violates G3).

### 5.9 Health / info leak

Health remains unauthenticated — OK. Do not add grant counts, caller lists, or runner internal paths to health.

### 5.10 Dual-process disclosure stack (A-F3 residual)

Stdio still dual-writes local + companion disclosure. Grant auth does not fix multi-process session truth. Out of scope for L4+ grant, but ship docs should not claim single-process purity. Companion remains execute-time SoT (already coded).

---

## 6. Answers to open questions §9 (locked recommendations)

| # | Question | Recommendation |
|---|----------|----------------|
| **Q1** Default TTL | **30d wall-clock** default; UI presets 1h / 24h / 7d / 30d / custom. **Not** “until companion restart” as default (IDE agents outlive restarts; disk grants would resurrect ambiguously). Optional separate “session” grant type (memory-only, no disk) can be Phase 1.1. |
| **Q2** Hard cutover for rejecting `ws_secret` on `/outbound-mcp/*` | **At first P1 GA build:** `require_grant=true` **and** hard reject `ws_secret` on outbound HTTP. No production Phase-0 install base to migrate. Dual-accept only behind flag false for local bake-off. Calendar date optional; **build/config gate** is the real cutover. |
| **Q3** Disclosure: grant + human HITL vs grant-only self-ack | **P1: grant-bound self-ack + visible audit/toast + instant revoke.** P1.1+: optional human HITL for exfil. Never market grant as cloud-exfil consent. |
| **Q4** One grant vs many IDEs | **Many grants**, distinct `caller_id` (+ label), list/revoke UI, **revoke-all** kill-switch. |

---

## 7. Implementation sketch critique (M1–M7)

| Step | Assessment |
|------|------------|
| M1 store | Add entropy/format, atomic write, mutex, fail-closed profile enum, revoke-all. |
| M2 authorize | Replace `authorizeOutboundHttp(req, expectedSecret)` with grant-aware authorize returning `{ok, grant?, error_code}`; **flag matrix** from §5.1. |
| M3 stdio | **No ws_secret fallback** when flag on; env grant only. |
| M4 UI | One-time token display; last_used; revoke; do not re-show hash. |
| M5 tests | Happy / mismatch / expired / revoked / legacy path / **no fallback** / disclosure binding / concurrent revoke. |
| M6 dual-review + docs | Update `mcp.md` (remove recommend Bearer ws_secret); ADR-022 changelog. |
| M7 hard deprecation | Must be **ship-coupled** to require_grant=true, not an indefinite later chore. |

**Missing from sketch:** audit schema extension (`grant_id`); HTTP status map; kill-switch; env `CMSPARK_OUTBOUND_CALLER_ID` vs grant binding rule.

---

## 8. What would force REJECT (and why this is not REJECT)

Per dual-review prompt:

- Scheme as written would **violate L4+** when implemented → REJECT  
- Enables **confirm-skip** → REJECT  
- **Fatally incomplete** for P1 ship claim **as a design direction** → REJECT  

**None fire as direction failures:**

- Direction (distinct grant, caller-bound, no confirm-skip, L1 profile, T1 gate) **satisfies L4+ intent**.
- Confirm-skip is explicitly non-goal and consistent with Trust monotonicity.
- Open items are **answerable product forks**, not missing ontology. Fatal incompleteness would be e.g. “stdio parent PID is enough,” “grant skips L2,” or “keep accepting ws_secret forever while claiming L4+ ship” as the *chosen* end state — design does not choose that end state; it only under-specifies the dual-mode window.

**Implementation dual-review later must REJECT** if:

- `require_grant=true` still accepts `ws_secret`, or stdio falls back silently;
- Disclosure/invoke allow body `caller_id` ≠ grant binding;
- Grant profile enables confirm-skip / L2 / cookies / evaluate;
- Product docs claim human disclosure consent for self-ack-only.

---

## 9. Nits to fold into design synthesis before M1

Non-blocking for **direction lock**; **blocking for starting M1 code** until written into the design (or an Accepted ADR amendment).

1. **Auth matrix** (§5.1 of this review): flag on → grant only; no stdio `ws_secret` fallback; pin dual-presentation behavior.
2. **`GRANT_CALLER_MISMATCH` on `/disclosure` and `/invoke`** explicitly.
3. **HTTP status map** (401 vs 403 vs 422).
4. **Token format/entropy** (`cmg_` + ≥256-bit) and exact hash input.
5. **Revoke freshness** (per-request verify or sync cache invalidate) + atomic grants file.
6. **Windows 0o600 honesty** (advisory on NTFS).
7. **Profile enum fail-closed**; strip unknown grant fields.
8. **Kill-switch / revoke-all** (G5).
9. **Audit `grant_id`** on issue / use / revoke / legacy auth.
10. **Q1–Q4 answers** as in §6 of this review (close open questions).
11. **§8 wording:** design-lock pre-T1 OK; M1–M7 code after T1 PASS only.
12. **§6 threat row** reword: hash dump ≠ token; IDE env holds plaintext grant.
13. **Drop or strictly define “dual headers pairing + grant”** — Phase 1 should use **one** Bearer material (the grant). Pairing secret never on outbound HTTP when flag on.
14. **Caller uniqueness:** one active grant per `caller_id` (recommended default).

---

## 10. Agreement / dissent vs Pi peer (for synthesis)

Pi verdict: **APPROVE_WITH_NITS**.  

This re-run: **same verdict class**, independently reached. Material agreement on dual-mode no-fallback, disclosure binding, TTL 30d, multi-grant, T1 gate, hash store adequacy. Additional emphasis here:

- Dual-header / “OR pairing” prose as a **dual-auth footgun** (stricter pin: single Bearer = grant under ship mode).
- Profile enum + strip unknown fields (Trust monotonicity).
- Kill-switch gap vs G5.
- Distinct `cmg_` prefix vs 64-hex `ws_secret`.
- Explicit post-implementation REJECT criteria.

No dissent that upgrades this to REJECT or downgrades to bare APPROVE.

---

## 11. Verdict reasoning

- **Not REJECT:** L4+ direction is sound and necessary; confirm-skip forbidden; claims match code; open questions have recommended locks; dual-mode is a migration hazard that can be closed in synthesis without changing Option D/A.
- **Not APPROVE:** Draft still leaves dual-mode, disclosure posture, TTL, cutover, and caller uniqueness open; Option A dual-header wording is hazardous; kill-switch and status map missing. Not “tight enough to implement without further product forks.”
- **APPROVE_WITH_NITS:** Direction **lockable** once §9 answers + §9 nits of this review are folded into the design (or ADR-022 P1 changelog). Then M1 may start **only after** P0d T1 PASS.

---

VERDICT: APPROVE_WITH_NITS
