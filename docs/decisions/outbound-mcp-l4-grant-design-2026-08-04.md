# Outbound MCP L4+ Grant Design (P1 ship gate)

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Status | **DIRECTION LOCKED · APPROVE_WITH_NITS** (dual-review 2026-08-04) · **not implemented** |
| Dual-review | Pi **APPROVE_WITH_NITS** · Independent re-run **APPROVE_WITH_NITS** · official `claude` CLI not logged-in (infra); synthesis below |
| Artifacts | [pi](../audit/reviews/outbound-mcp-l4-grant-pi-20260804-215353.md) · [independent](../audit/reviews/outbound-mcp-l4-grant-claude-rerun-20260804.md) · [synthesis](../audit/reviews/outbound-mcp-l4-grant-dual-synthesis-20260804.md) · [verdict](../audit/reviews/outbound-mcp-l4-grant-verdict-20260804-215353.json) |
| SoT | [ADR-022](../adr/022-outbound-mcp-server.md) L4 / L4+ · P1 roadmap |
| Related | S42 multi-adv (ws_secret dual-use A-F2) · [mcp.md Outbound](../mcp.md#outbound-mcp) · P0d bake-off |
| Non-goals (this doc) | Confirm-skip · multi-tenant cloud · product ship · expand allowlist |

---

## 1. Problem

Today Outbound invoke/disclosure HTTP uses:

```text
Authorization: Bearer <ws_secret>
```

`ws_secret` is the **Extension ↔ Companion pairing secret**. Any local process that can read `~/.cmspark-agent/ws_secret` (or inherit it via `mcp-outbound` / stdio child) can:

1. Accept L3+ disclosure for any `caller_id`
2. Invoke curated L1 tools against the user’s real Chrome session
3. Share the same secret that authenticates the Side Panel

ADR-022 **L4+**: loopback / stdio / parent PID ≠ authentication.  
**P1 ship gate** requires a **MCP-caller grant** distinct from pairing.

---

## 2. Goals

| ID | Goal |
|----|------|
| G1 | **Separate identities**: Extension pairing ≠ MCP caller auth |
| G2 | **User-visible grant**: human must issue / revoke grants (tray or Side Panel) |
| G3 | **Per-caller**: `caller_id` bound to grant material (not free-form only) |
| G4 | **Least privilege**: grant scopes profile (default L1 only); no Phase-0 confirm-skip |
| G5 | **Revocable / TTL**: session or wall-clock expiry; kill-switch |
| G6 | **Fail-closed**: missing/expired grant → clear `GRANT_REQUIRED` / `UNAUTHORIZED` |
| G7 | **Audit**: grant issue / use / revoke lines (0o600 logs) |

---

## 3. Non-goals

- Using grant to skip L2 / URL-gate / L8 confirm
- Per-tool OAuth to every SaaS
- Network-exposed grant server (stay loopback)
- Replacing Extension pairing (`ws_secret` stays for WS auth)

---

## 4. Options

### Option A — User-pasted client secret (per coding agent)

| | |
|--|--|
| **Flow** | Settings / tray: “Create Outbound grant” → shows one-time secret + optional TTL → user pastes into Grok/Claude `env` as `CMSPARK_OUTBOUND_GRANT` |
| **HTTP** | `Authorization: Bearer <grant_token>` **or** dual headers: pairing for transport + grant for authorization |
| **Pros** | Simple mental model; matches API key UX; no OS keychain required for v1 |
| **Cons** | Secret sprawl if user pastes into many configs; rotation is manual |
| **Fit** | Strong for Phase 1 |

### Option B — Signed grant JWT (Companion-issued)

| | |
|--|--|
| **Flow** | User clicks Allow for caller label → Companion signs JWT `{caller_id, profile, exp, jti}` with grant signing key; stdio/MCP process presents JWT |
| **Pros** | Expiry/jti revoke natural; scope in claims |
| **Cons** | Key management + clock skew; coding agents must pass long tokens |
| **Fit** | Good mid-term |

### Option C — Loopback + OS session token (parent PID / named pipe)

| | |
|--|--|
| **Flow** | Only process started by CMspark launcher inherits ephemeral FD/token |
| **Pros** | Harder for random malware to steal file secret |
| **Cons** | Fragile across IDE MCP spawn models; violates “stdio not auth” if used alone |
| **Fit** | Defense-in-depth **only**, not sole factor |

### Option D — Dual factor (recommended hybrid)

| | |
|--|--|
| **Factor 1** | **Transport**: loopback + optional short-lived companion-to-mcp channel (not long-lived `ws_secret` in MCP env) |
| **Factor 2** | **Grant**: Option A or B bound to `caller_id` + profile + TTL |
| **Pros** | Meets L4+; migratable from Phase 0 |
| **Cons** | Two secrets to document carefully |

**Proposal lock (pending dual-review): Option D with Phase 1 = Option A client secret grant; Phase 1.1 optional JWT (B).**

---

## 5. Proposed Phase 1 scheme (Option D / A)

### 5.1 Storage

```text
~/.cmspark-agent/outbound-grants.json   # mode 0o600
```

```json
{
  "grants": [
    {
      "id": "gr_…",
      "label": "grok-build",
      "caller_id": "grok-build",
      "token_hash": "sha256:…",
      "profile": "outbound_l1_default",
      "created_at": "…",
      "expires_at": "…" | null,
      "revoked_at": null,
      "last_used_at": null
    }
  ]
}
```

- Store **hash only** (never raw token after issue UI).
- Issue UI shows token **once**.
- **Token format (locked dual-review):** ≥32 random bytes, prefix `cmg_`, store `sha256` of raw (unsalted OK for high-entropy).
- **Verify freshness:** per-request store read or cache invalidate on revoke/expiry (no restart-only TOCTOU).
- **Windows:** `0o600` is advisory on NTFS; real defense = user-profile dir + hash-only + OS user boundary (platform-honest).

### 5.2 HTTP auth matrix

| Request | Today (P0) | P1 (`outbound.require_grant=true`) |
|---------|------------|-----|
| `GET …/health` | unauthenticated | unauthenticated (no secrets) |
| `POST …/disclosure` | Bearer `ws_secret` | Bearer **grant only**; body `caller_id` must match grant → else `GRANT_CALLER_MISMATCH` |
| `POST …/invoke` | Bearer `ws_secret` | Bearer **grant only**; same caller bind |
| Extension WS | `ws_secret` pairing | **unchanged** |
| `mcp-outbound` stdio | reads `ws_secret` for HTTP | **`CMSPARK_OUTBOUND_GRANT` required**; **never** fall back to `getOrCreateSharedSecret()` when flag ON |

**Both presented:** if request carries both `ws_secret` and a grant under require_grant, **reject as ambiguous** (fail-closed).

### 5.3 Migration

1. Flag `outbound.require_grant`: **ON at first P1 GA** (hard reject `ws_secret` on `/outbound-mcp/*` from that build). Dev-only optional dual-window with `auth.legacy_ws_secret` audit before GA.  
2. Phase 0 never product-shipped → no long prod migration burden.  
3. Docs: never recommend pasting `ws_secret` into IDE MCP config after grant GA.

### 5.4 Scope

| Field | Phase 1 (**locked**) |
|-------|---------|
| Profile | Fixed default L1 allowlist only; unknown profile enum → fail-closed |
| Confirm-skip | **Forbidden** |
| Multi-caller | **Multiple** grants per machine; each bound to `caller_id` + label; revoke-all kill-switch |
| Revoke | UI list + `revoke` + delete entry; next request must fail |
| TTL | **Default 30d wall-clock**; per-grant override (1h/24h/7d/30d); not “until restart” |

### 5.5 UX (minimal)

1. Side Panel **设置 → Outbound MCP → 创建调用方授权**  
2. Fields: label, caller_id (prefill), TTL  
3. Actions: copy token · revoke · show last used  
4. Tray: optional “show grants” shortcut  

### 5.6 Errors + HTTP mapping (**locked**)

| Code | HTTP | When |
|------|------|------|
| `GRANT_REQUIRED` | **401** | No/invalid grant on invoke/disclosure |
| `GRANT_EXPIRED` | **403** | Past `expires_at` |
| `GRANT_REVOKED` | **403** | User revoked |
| `GRANT_CALLER_MISMATCH` | **403** | Body `caller_id` ≠ grant binding (invoke **and** disclosure) |
| `UNAUTHORIZED` | **401** | Malformed bearer |

Profile denials stay existing `PROFILE_FORBIDDEN` / 422 — not grant codes.

---

## 6. Threat notes

| Threat | Mitigation |
|--------|------------|
| Disk dump of grants.json | Yields **unusable hashes** (high-entropy token); plaintext token lives in IDE env/config → TTL + revoke + education |
| Process env / `/proc` environ visibility | Same class as any API key in IDE MCP config; short TTL + revoke-all |
| IDE config leak of grant | User education; TTL; revoke UI |
| Grant + prompt-injection | L4: still gate by op risk; L2/URL confirm remain; **grant ≠ user cloud-exfil consent** |
| Confused deputy | Bind `caller_id`; audit `grant_id` + caller on every invoke/disclosure |
| ws_secret still on disk | Extension needs it; **never** put in MCP env post-P1 |

---

## 7. Implementation sketch (**blocked until T1 PASS**)

| Step | Work |
|------|------|
| M1 | `outbound-grants.ts` store + issue/verify/revoke; extend audit with `grant_id` |
| M2 | `authorizeOutboundHttp` grant-only when flag ON; caller bind on invoke+disclosure |
| M3 | stdio: `CMSPARK_OUTBOUND_GRANT` required; **hard-fail**, never fall back to `ws_secret` |
| M4 | Settings UI + optional tray + revoke-all |
| M5 | Tests: happy / mismatch / expired / no-fallback / dual-presented reject |
| M6 | Docs (`mcp.md`, ADR-022 changelog) + implementation dual-review |
| M7 | GA: hard reject `ws_secret` on `/outbound-mcp/*` |

**Gates:**

1. **Design dual-review** (this doc): **DONE** APPROVE_WITH_NITS · direction locked.  
2. **P0d T1 PASS (L7)** before **any M1 code**.  
3. **Implementation dual-review** after M1–M5 before product language.

---

## 8. Relation to P0d bake-off

| ADR rule | Implication |
|----------|-------------|
| **T1 fail → pivot** | Do **not** implement grant as ship if L7 fails — grant packages a *proven* surface |
| **Design lock pre-T1** | **Allowed** (this dual-review). M1–M7 still wait for T1 PASS |
| **T1 pass** | Start M1+ with this locked scheme |

---

## 9. Open questions — **LOCKED by dual-review**

| # | Question | **Locked answer** |
|---|----------|-------------------|
| Q1 | Default TTL | **30d wall-clock**; per-grant override 1h/24h/7d/30d; not until-restart |
| Q2 | Hard cutover | **At first P1 GA**: `require_grant=true` + hard reject `ws_secret` on outbound HTTP; dev-only legacy window before GA |
| Q3 | Disclosure HITL | **P1:** grant-bound agent self-ack **with** human-visible audit/toast + instant revoke; **grant ≠ consent marketing**. **P2:** upgrade exfil class to human HITL |
| Q4 | Multi-IDE | **Multiple grants** per machine (per caller_id/label); revoke-all; no single machine-wide grant |

---

## 10. Recommendation (locked)

| Phase | Action |
|-------|--------|
| **Now** | P0 dual-use `ws_secret` for bake-off only; risk documented |
| **Design** | **Option D / Phase 1 = A** — **DIRECTION LOCKED** (dual APPROVE_WITH_NITS) |
| **After P0d T1 PASS** | Implement M1–M7 per this doc |
| **If P0d FAIL** | Pivot Option B/C per ADR-022; **park grant implementation** |

**Locked scheme:** Option D (hybrid) with Phase 1 = hashed client-secret grants bound to `caller_id` + L1 profile + 30d TTL; Extension pairing remains `ws_secret`; no confirm-skip; no ws_secret fallback when require_grant is ON.

---

## 11. Dual-review record

| Reviewer | Verdict | Artifact |
|----------|---------|----------|
| Pi Agent (`pi` CLI) | **APPROVE_WITH_NITS** | `outbound-mcp-l4-grant-pi-20260804-215353.md` |
| Independent Claude-class re-run | **APPROVE_WITH_NITS** | `outbound-mcp-l4-grant-claude-rerun-20260804.md` |
| Official `claude` CLI (batch script) | **UNKNOWN** (not logged in) | infra — re-run after `/login` optional |
| Combined | **both_ok for design direction** (two independent APPROVE_WITH_NITS) | synthesis |

*Design direction locked. Implementation not authorized until P0d T1 PASS + M-path dual-review.*
