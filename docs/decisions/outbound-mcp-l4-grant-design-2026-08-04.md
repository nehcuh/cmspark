# Outbound MCP L4+ Grant Design (P1 ship gate)

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Status | **DRAFT · DIRECTION PROPOSAL** (not dual-reviewed; not implemented) |
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

### 5.2 HTTP auth matrix

| Request | Today (P0) | P1 |
|---------|------------|-----|
| `GET …/health` | unauthenticated | unauthenticated (no secrets) |
| `POST …/disclosure` | Bearer `ws_secret` | Bearer **grant** (or `X-CMspark-Grant`) |
| `POST …/invoke` | Bearer `ws_secret` | Bearer **grant** |
| Extension WS | `ws_secret` pairing | **unchanged** |
| `mcp-outbound` stdio | reads `ws_secret` for HTTP | reads `CMSPARK_OUTBOUND_GRANT` (required); may still discover companion port from config |

### 5.3 Migration

1. P1 feature flag `outbound.require_grant` default **false** in dev / true when product claims ship  
2. Deprecation window: accept `ws_secret` **with loud audit** `auth.legacy_ws_secret` then hard reject  
3. Docs: never recommend pasting `ws_secret` into IDE MCP config after grant GA  

### 5.4 Scope

| Field | Phase 1 |
|-------|---------|
| Profile | Fixed default L1 allowlist only |
| Confirm-skip | **Forbidden** |
| Multi-caller | Multiple grants; each `caller_id` unique or labeled |
| Revoke | UI list + `revoke` + delete file entry |
| TTL | Default 30d or session-until-restart (pick in dual-review) |

### 5.5 UX (minimal)

1. Side Panel **设置 → Outbound MCP → 创建调用方授权**  
2. Fields: label, caller_id (prefill), TTL  
3. Actions: copy token · revoke · show last used  
4. Tray: optional “show grants” shortcut  

### 5.6 Errors

| Code | When |
|------|------|
| `GRANT_REQUIRED` | No/invalid grant on invoke/disclosure |
| `GRANT_EXPIRED` | Past `expires_at` |
| `GRANT_REVOKED` | User revoked |
| `GRANT_CALLER_MISMATCH` | Body `caller_id` ≠ grant binding |
| `UNAUTHORIZED` | Malformed bearer (keep) |

---

## 6. Threat notes

| Threat | Mitigation |
|--------|------------|
| Malware reads grant file | Same class as reading config; hash storage limits reuse of disk dump only if attacker has online token — still protect with 0o600 + OS user boundary |
| IDE config leak of grant | User education; short TTL; revoke UI |
| Grant + prompt-injection | L4: still gate by op risk; L2/URL confirm remain |
| Confused deputy (agent A uses grant for B) | Bind `caller_id` on grant; audit both |
| ws_secret still on disk | Extension needs it; do not put in MCP env post-P1 |

---

## 7. Implementation sketch (not started)

| Step | Work |
|------|------|
| M1 | `outbound-grants.ts` store + hash issue/verify/revoke |
| M2 | `authorizeOutboundHttp` accept grant; dual-mode flag |
| M3 | stdio wire `CMSPARK_OUTBOUND_GRANT`; stop defaulting to `ws_secret` when flag on |
| M4 | Settings UI + optional tray |
| M5 | Tests: grant happy / mismatch / expired / legacy path |
| M6 | dual-review + docs (`mcp.md`, ADR-022 changelog) |
| M7 | Deprecate ws_secret bearer for outbound HTTP |

**Eval gate**: no product language “safe multi-agent MCP” until M1–M6 green and dual APPROVE*.

---

## 8. Relation to P0d bake-off

| ADR rule | Implication |
|----------|-------------|
| **T1 fail → pivot** | Do **not** implement grant as ship if L7 fails — grant is for **trust packaging of a proven surface**, not a substitute for product value |
| **T1 pass** | Open dual-review on **this** design; then implement M1+ |

---

## 9. Open questions (for dual-review)

1. Default TTL: 7d / 30d / until companion restart?  
2. Hard cutover date for rejecting `ws_secret` on `/outbound-mcp/*`?  
3. Should disclosure accept require grant **and** human HITL (upgrade L3+), or grant-only still agent-self-ack?  
4. One grant per machine vs many concurrent IDEs?

---

## 10. Recommendation

| Phase | Action |
|-------|--------|
| **Now** | Keep P0 dual-use `ws_secret` for bake-off only; document risk (done in S42 docs) |
| **After P0d PASS** | Dual-review this grant design → implement Option D/A |
| **If P0d FAIL** | Pivot Option B/C per ADR-022; **park grant** |

**Provisional scheme**: **Option D (hybrid) with Phase 1 = hashed client secret grants bound to `caller_id` + profile + TTL; Extension pairing remains `ws_secret`.**

---

*Draft only — not an Accepted ADR until dual-review.*
