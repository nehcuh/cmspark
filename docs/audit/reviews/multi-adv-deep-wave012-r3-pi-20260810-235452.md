## Dual external review r3 — COMPLETE gate (final)

### Verification performed

**1. `resetUnattendedGrantForTests` order** — ✅ Verified at `companion/src/computer/unattended-grant.ts:124-130`: `clearCruiseSnapshotFile()` is now called **while** `cruiseSnapshotPathOverride` still points at the test path, and only then is the override nulled. This guarantees the real `DATA_DIR` snapshot can never be unlinked by a stale override. All test call sites (`tests/computer-unattended-grant.test.ts:20,204,281,312,340,357,386,406,431`) call reset before setting their own override — no ordering conflict.

**2. `shouldRestoreCruiseOnDisarm` pure gate** — ✅ Exported at `unattended-grant.ts:207-216`; used at `message-router.ts:3294-3303`; unit-tested at `computer-unattended-grant.test.ts:367-373`. Logic is byte-equivalent to the r2 inline gate (`had_grant || had_snapshot || clear_cruise`), and the `forceNull: clearCruise && !hadSnapshot && !status.had_grant` parameter is preserved exactly. Removed `void rest.clear_cruise` is safe (now consumed via `clearCruise`). Ran the suite: **30/30 pass**, including the new gate test and all C1 lifecycle tests.

**3. Boot reconcile comment** — ✅ Accurate. `persistCruiseSnapshotFile` does `fs.mkdirSync(path.dirname(p), { recursive: true })` (`unattended-grant.ts:69`), so file presence implies its dir existed; `loadCruiseSnapshotFile` is try/catch-safe on a nonexistent parent. `server.ts:6579` registers the handler before `reconcileUnattendedCruiseOnBoot()` at `server.ts:6590`, which runs before `initServices()` (`server.ts:6706`) — and `index.ts` calls `initDataDir()` before `startServer` anyway.

**4. No regression to C1 / boot / bare disarm** — ✅ Bare disarm (no grant, no snapshot, no clear_cruise): gate returns `false` → restore skipped → handler never invoked → intentionally-set cruise flags untouched. Durable-file boot reconcile and TTL-expire-once tests pass. This commit is a pure extraction (base `304d33d` already contained the gating logic); r3 changes no runtime semantics.

**5. Wave 0–2 COMPLETE** — ✅ r3 absorbs all three Pi r2 nits (reset path order, pure gate + unit test, doc comment). C10 god-file split deferred per plan. Patch verified **not stale**: `git diff 304d33d 470961f` is byte-identical to the review patch; HEAD is `470961f`; working tree clean apart from untracked review artifacts.

**ADR-020** — Diff is pure test/refactor of an existing gate: no new Surface (no tools/gates/UI entry points), no Composition/Autonomy/Channel changes, no `securityConfirmations.request`, no shell/browser-bridge/policy touch (P1 watchlist n/a). Missing capability declaration is non-blocking under the "pure docs/test/refactor" carve-out. Trust monotonicity preserved.

Trivial observations (below nit-worthiness): `=== true` on already-boolean args in the gate; disarm path re-registers the restore handler unconditionally even when the gate later returns false — pre-existing, and the handler is never invoked in that case.

VERDICT: APPROVE
