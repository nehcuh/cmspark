# Dual-review synthesis — Outbound MCP L4+ Grant Design

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Design | [outbound-mcp-l4-grant-design-2026-08-04.md](../../decisions/outbound-mcp-l4-grant-design-2026-08-04.md) |
| Order | MACHINE n/a (docs) → dual independent reviewers → synthesis |

## Verdicts

| Reviewer | Verdict | Notes |
|----------|---------|-------|
| Pi (`pi` CLI via `dual-external-review.sh`) | **APPROVE_WITH_NITS** | Spot-checked companion-http / stdio / disclosure |
| Independent Claude-class re-run | **APPROVE_WITH_NITS** | Official `claude` CLI **not logged in** (batch UNKNOWN); re-run is independent peer |
| Combined design direction | **LOCK** | both_ok for **direction**; not for M1 code |

**Script verdict JSON** (`outbound-mcp-l4-grant-verdict-20260804-215353.json`): `both_approve: false` only because Claude CLI infra failed — **do not treat as REJECT**. Post-synthesis both independent reviews APPROVE_WITH_NITS.

## Agreement (both)

1. Separating grant from `ws_secret` is **required** for ADR-022 L4+ (confirms S42 A-F2).  
2. Option **D/A** is the right Phase 1 scheme.  
3. Hashed high-entropy token store is adequate.  
4. Confirm-skip remains forbidden; Trust tightens, not loosens.  
5. **M1+ blocked until P0d T1 PASS**; design lock pre-T1 is OK.  
6. Free-form body `caller_id` today is the gap grants fix.

## Locked nits (folded into design §5–§9)

| ID | Lock |
|----|------|
| Dual-mode | `require_grant=true` → grant **only**; never fall back to `ws_secret` |
| Ambiguous dual bearer | Reject |
| Caller bind | `/invoke` **and** `/disclosure` |
| HTTP map | GRANT_REQUIRED→401; EXPIRED/REVOKED/MISMATCH→403 |
| TTL | 30d wall-clock default; overrides; not until-restart |
| Multi-grant | Yes + revoke-all; no machine-wide single grant |
| Disclosure P1 | Self-ack + visible audit/toast; grant ≠ consent; P2 HITL |
| Cutover | Hard reject ws_secret on outbound HTTP at P1 GA |
| Token | `cmg_` + ≥32 random bytes + sha256 store |
| Audit | `grant_id` on issue/use/revoke |
| Windows | 0o600 advisory; hash + profile dir |

## Not blocking

- Official Claude CLI login (optional re-run for process purity)  
- Full JWT Option B (Phase 1.1)  
- Human HITL disclosure in P1  

## Next

1. Land updated design on PR #119 / main.  
2. Complete human P0d T1–T3.  
3. If T1 PASS → implement M1–M7 with **implementation** dual-review.  
4. If T1 FAIL → park grant; pivot B/C.

## Final

**DIRECTION LOCKED: Option D / Phase 1 hashed client-secret grants.**  
**Implementation: NOT authorized until P0d L7 T1 PASS.**
