I have all the verification I need. Time to deliver the verdict.

## Independent Review — C10 Phase B (L2 admission extract)

**Scope inspected**
- `companion/src/tool/l2-admission.ts` (new, 1515 LOC)
- `companion/src/server.ts` (5004 → 3640 LOC, −1364)
- `companion/src/tool/companion-dispatch.ts` (FREEZE comment update)
- `companion/tests/l2-admission-pure.test.ts` (new, 98 LOC)
- `docs/audit/reviews/c10-godfile-split-phase-b-20260811.md`

**Verification performed (executed, not inspected-only)**
- `git show HEAD~1:server.ts` vs `HEAD:tool/l2-admission.ts` body diff confirms the L2 algebra body is byte-identical apart from: (a) `L2_GATE_TOOLS` lifted to module-level export; (b) `(os.platform() === "win32" || os.platform() === "darwin")` replaced with three pure `isHost*PlatformGated()` helpers; (c) the body is wrapped in an IIFE whose return value the outer function maps to `L2AdmissionResult`. No algebra edits.
- `security_token` strip happens **before** L2 admission (`server.ts:648-662`); `issueTokenFor` runs **after** approve (`l2-admission.ts:1465`, only inside the success / auto-approved branches). ✓
- `winL2NonceChallenge` + `hostAppTier` flow back from `runL2ToolAdmission` → `createToolExecutor` and reach `executeCompanionTool` (`server.ts:1021-1022` → `1380, 1382`). ✓
- No circular import: `tool/l2-admission.ts` does not import from `server.ts`; runtime dependencies are injected via `L2AdmissionContext` (`securityConfirmations`, `getThreadManager`, `getCachedTabUrl`, `getDomainFromUrl`, `computerRateLimiter`, `activeTrayConfirmsByWs`, `clients`, `wsAuthGet`). ✓
- `computerTaskAbort = getComputerTaskAbortRegistry()` returns the same module-level singleton `server.ts:399` uses. ✓
- `flightReserved` ownership-transfer semantics preserved: bound by `(toolName, owner)` in `orchestrator/single-flight`; `flightReserved = null` after approval still signals "transferred"; finally still releases on exception/deny/timeout paths (`l2-admission.ts:1393-1424`). ✓
- `node --test .test-dist/tests/l2-admission-pure.test.js` → **5 pass**. ✓
- `node --test .test-dist/tests/integration/security-gates.test.js` → **63 pass**. ✓
- `node --test .test-dist/tests/ws-router-validator-lockstep.test.js .test-dist/tests/worker-hard-deny-runtime.test.js .test-dist/tests/computer-unattended-grant.test.js` → **36 pass**. ✓
- `forceConfirm` / three-flag (`auto_approve_dangerous && auto_approve_enterprise_tools && allow_all_schemes`) / `hostComputerTrustSkip` (G1 + ADR-021 unattended) / `enterpriseSkip` (global + session) / Q5 taint / `appWhitelisted` algebra — all preserved verbatim (verified by side-by-side diff of `l2-before.txt` and `l2-after-renorm.txt`). ✓
- `confirmOriginOpts` still binds `{ originWs: ws }` for `winL2NonceChallenge || hostComputerGated` and leaves `undefined` for outbound MCP fan-out (ADR-022 L8). No `originWs` regression. ✓

**ADR-020 capability checklist**
- Implementer prompt lacks the `Surface/Compose/Autonomy/Trust/Channel` block. Per the checklist this is **nit at most** for a pure-refactor diff (no new tools, gates, primary UI, or runtime); the change is a mechanical extract that re-exports the same public surface and preserves every existing gate.

**Nits (non-blocking)**
- `l2-admission.ts:772` — `enterpriseFamily` is declared with `let` but never reassigned; could be `const`. Pre-existing; carry-over from the source block, not introduced by this PR.
- `l2-admission.ts:186-1501` — the `earlyResult = await (async (): Promise<any>) => {…}()` IIFE is well-documented but slightly indirect. A future cleanup could split the IIFE into a dedicated `runL2Body()` helper returning a discriminated union directly, but doing so now would expand the diff surface and risk the zero-behavior-change contract. Reasonable to defer.
- `tests/l2-admission-pure.test.ts` only exercises the three pure helpers; deeper algebra coverage (forceConfirm waivers, `hostComputerTrustSkip` paths) is provided by the integration suite. Adequate for a mechanical extract.
- `docs/audit/reviews/c10-godfile-split-phase-b-20260811.md:14` — claim "Before (post Phase A) 5004" matches `git show HEAD~1:companion/src/server.ts | wc -l` = 5004. ✓ No over-claiming.

**Conclusion**
Pure mechanical extract. Behavior, ordering, audit events, and origin-binding semantics are preserved. Test suites green. No security regression. Approving.

VERDICT: APPROVE
