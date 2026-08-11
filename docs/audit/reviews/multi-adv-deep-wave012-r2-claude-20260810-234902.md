I have completed my independent review. Here is my assessment:

## r2 nit fix verification

**C1 restart residual — durable file lifecycle (CORRECT):**
- `unattended-grant.ts:28,68-120` — atomic `tmp+rename`, `mode:0o600`, best-effort `chmod`, safe JSON parse, `v:1` schema
- `captureCruiseSnapshot` (line 154) persists file BEFORE dual-write
- `discardCruiseSnapshot` (line 170) and `restoreCruiseFromSnapshot` (line 187) both clear the file
- `reconcileUnattendedCruiseOnBoot` (line 208-221) short-circuits when `grant` non-null, loads file, restores via handler, deletes file
- `server.ts:6572-6602` invokes reconcile AFTER `initDataDir()` (line 563) and `getConfig()` (line 6571), so `DATA_DIR` is materialized — ordering safe
- Test `durable file + boot reconcile restores cruise after process restart` exercises capture→restart-sim→reconcile→file-cleared [executed pass]

**Bare disarm no longer clobbers (CORRECT):**
- `restoreCruiseFromSnapshot` (line 179-201): no-ops (no handler call, returns null) when neither memory snap nor file exists, unless `opts.forceNull=true`
- `message-router.ts:3289-3296` gates restore on `status.had_grant || hadSnapshot || rest.clear_cruise===true`; `forceNull` only when user explicitly asked AND no prior grant/snap
- Public status response strips `had_grant` internal field (line 3308)
- Tests `no snapshot → restore without forceNull is no-op` + `forceNull clears flags when user requests clear_cruise wipe` cover both branches [executed pass]

## r1 regression spot-check (no regressions)

- **C5**: `pack-engine.ts:1617-1628` still calls `isValidSecurityArmPhrase` before applying Trust cruise flags; returns `trust_phrase_required`
- **C6**: `thread-manager.ts:854-875` still re-applies `WORKER_HARD_DENY` for `agent_role==="worker"` at runtime; fail-closed fallback list intact
- **C7**: `server.ts:749-754` (pre-L2) + `3858-3867` (execute) both call `normalizeShellCwd`; preview at `1087+` shows `cwd=`
- **C8**: `server.ts:755-761` (pre-L2) + `3920-3925` (execute) both call `normalizeNetsecPorts`

## Tests `[executed]`

```
computer-unattended-grant:           29 pass / 0 fail  (incl. 2 new + 1 modified)
worker-hard-deny-runtime:             3 pass / 0 fail
capability-shell-netsec:              15 pass / 0 fail  (C7/C8 binding equality)
ws-router-validator-lockstep:          3 pass / 0 fail
packs-engine:                         28 pass / 0 fail  (C5 phrase gate)
integration/security-gates:           63 pass / 0 fail  (C12 no false-green)
```

## ADR-020 capability check

Declaration present and accurate: Surface (L2 honesty + bind + isolation; no new L2 tools), Composition (Pack phrase), Autonomy (unattended lifecycle), Trust (restore + boot reconcile), Channel (Side Panel + Companion). No "中层 Agent" framing, no new gate family (reuses Settings phrase), trust monotonicity preserved (bare-disarm no-op is stricter, not looser; snapshot is symmetric capture/restore), no new `securityConfirmations.request` calls so `originWs` not regressed, no new runtime.

## Minor observations (non-blocking)

1. The boot-time handler registered in `startServer.ts:6579` is functionally identical to the one re-registered on each `arm`/`disarm` call in `message-router.ts`; overwriting is harmless since both call `getConfig`/`saveConfig` with the same algebra.
2. Snapshot file's `at` timestamp is logged but never TTL-checked; defensive freshness window would harden against a stale file surviving a mid-disarm crash. Not exploitable — flags are user-gestured.

## Verdict

All r2 nit fixes are correct, complete, and tested. No r1 regressions. C10 god-file split remains DEFERRED with FREEZE comments (acceptable per task scope). Wave 0–2 optimization of multi-adversarial findings is COMPLETE.

VERDICT: APPROVE
