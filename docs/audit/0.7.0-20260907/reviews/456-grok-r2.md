I'll read the R2 delta index first, then every numbered part in full, and review only those files.# #456 R2 delta review

Scope is R2 only (session invalidation vs origin deny, revalidate-before-action, revoke/error/audit, HTTP regression, UI/CLI/docs clarity). R1, core, pilot, and release are out of scope.

## session-before-action

`companionInvokeOutbound` re-resolves the handle at the start of the try (after lease/HITL) and again immediately before `runner()` on the actuator path. `site_context` re-resolves via `scope()` after projection and before success audit/return.

The HTTP e2e jumps the clock inside `list_tabs` (metadata) on `wait_for`: `actions` stays 0, error is `SCOPE_DENIED`. That is the mid-wait expiry case.

`now` default is `() => Date.now()`, so the module singleton honors `Date.now` mocks. Needed for this harness; production-equivalent.

## explicit handle invalidation vs origin deny

`resolve()` splits:

- missing/expired → `ContextSessionUnavailable` (`message` still `SCOPE_DENIED`) → `session_invalid: true`
- grant/caller mismatch → plain `SCOPE_DENIED`, no flag

Origin deny is not in `resolve()`; it stays a normal `SCOPE_DENIED` from projection. Client clears the cached handle only on `j.session_invalid === true`, not on `error_code === "SCOPE_DENIED"`. No auto-retry; next **explicit** call may `ensureSession`.

E2E: wrong origin → `SCOPE_DENIED`, `sessions === 1`; next same-origin call succeeds; after expiry fail still `sessions === 1`; following call `sessions === 2`.

Grant/caller mismatch is treated as deny, not stale recovery. Conservative: a stolen handle does not trigger a fresh issue for the caller.

## revocation / error / audit

Session **issue**: `GRANT_DENIED` → **403** + `GRANT_DENIED`; `CAPACITY` stays 400; else 400 `BAD_BODY`. Previously revoke-on-issue was 400 `BAD_BODY`.

Invoke: `requireLiveGrant` still sits before action and after async read. Stale handle in the outer catch sets `session_invalid` while `error_code` remains `SCOPE_DENIED`.

`site_context` success audit runs **after** `scope()`. If the handle died during projection, `scope()` throws, catch audits failure, client does not get a success record plus experiences.

## real HTTP regression and tab lease

New test is real loopback HTTP + `createHttpOutboundDispatcher`, not a unit stub of `resolve()`. Clock mock + production `releaseTabLease(...)` (not `_resetTabLeasesForTests`) is documented: advancing time also kills the independent tab lease; this harness has no lifecycle worker. Resume then executes exactly one action and issues exactly one replacement session.

Packet claims 48/48 targeted, 4975 pass / 23 skip, settings 20, both production builds. Not re-executed here.

## UI / CLI / docs

Three surfaces state the same split: origin list **only** bounds context export; page export stays on existing tab grant + HITL. Docs also state handle rebuild only on server invalidation, not on unauthorized origin.

---

## BLOCK

None.

## MAJOR

None.

## NIT

1. Docs say “服务端明确标记句柄失效” but never name `session_invalid`. Custom HTTP clients can keep the old `SCOPE_DENIED` drop-session bug.
2. No shown test that grant/caller mismatch omits `session_invalid` (origin deny is the product case and is covered).
3. Issue-path 403 mapping is untested in this packet; correctness hangs on `requireLiveGrant` still throwing `Error("GRANT_DENIED")`.
4. Audit `error_code` is `SCOPE_DENIED` for both stale handle and origin deny; operators cannot tell them apart in logs.
5. If `projectOutboundContext` wraps `ContextSessionUnavailable` as `new Error("SCOPE_DENIED")`, `site_context` mid-projection expiry would omit `session_invalid`. Actuator path (the click/wait case) throws from invoke’s own `resolve()` and is e2e-covered.

---

## VERDICT

**APPROVE R2 delta only.** Session-before-action, origin-deny vs stale-handle, no auto-retry, revoke-on-issue 403, success-audit-after-scope, HTTP TTL regression, and UI/CLI/docs split all hold in this packet.

**Not approved:** R1 as a full gate, unrelated core, enterprise pilot, or release.
