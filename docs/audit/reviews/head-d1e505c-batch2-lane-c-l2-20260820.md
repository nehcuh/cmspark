# Lane C — L2 / osascript / gate copy (T3 Trust)

**Reviewer**: independent adversarial (did not implement this batch)  
**Date**: 2026-08-20  
**Base**: `d1e505c` (`d1e505cd725e6cf105e009476468e81af727a226`)  
**Frozen patch**: `docs/audit/reviews/head-d1e505c-batch2-diff-20260820.patch`  
**Live tree**: `git diff d1e505c` **byte-identical** to frozen patch (`/usr/bin/diff -q` exit 0, 1337 lines, 24 files).  
**Incident**: thread `fzbcro` — L2 `security.confirmation.approved` then `tool.finish success:false` `"Security Block: osascript_eval contains high-risk APIs (fetch). Execution requires user confirmation."` Chat wrapper added 「若你已拒绝弹窗」.

**Scope judged**: dispatch `osascript_eval` post-token path; message-router tokenless short-circuit removal; companion + extension gate copy; security-gates / security-thread / files.test / gate-error-copy tests; L2 admission still forceConfirm-all osascript.  
**Out of scope (present in the same frozen patch, not scored)**: LLM IMDS/DNS (`security.ts` `classifyLlmHostnameDns`), vision/multimodal, settings-web, voice tests, `ws/lifecycle.ts` unrelated hunks.

Evidence tags: `[executed]` ran on this Darwin host · `[inspected]` read the live path · `[assumed]` not directly exercised.

---

## Machine

```text
cd companion && npx tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/security-thread.test.js \
  .test-dist/tests/single/files.test.js \
  .test-dist/tests/integration/security-gates.test.js
→ 157 pass / 0 fail  [executed] Darwin, node v24.16.0

chrome-extension: tsc -p tsconfig.test.json && node --test .test-dist/tests/gate-error-copy.test.js
→ 4 pass / 0 fail  [executed]
```

Key rows:

| Test | Result | Notes |
|------|--------|--------|
| `item 2: osascript_eval with fetch APPROVE is not re-blocked by regex` | PASS **168ms** | Darwin path (not the linux early-return). Deny-style tests in the same file are ~1–2ms → this one actually reached `execFile` after approve. |
| `M3' §6.2.9: osascript_eval + critical under god-mode alone still forceConfirms` | PASS | Deny after confirm; god-mode does **not** skip. |
| `high-risk regex still flags fetch; tokenless osascript is not a fake confirm-block` | PASS | Darwin: `/No session available/` and **not** `Execution requires user confirmation`. |
| `message-router: osascript_eval tokenless fetch is not a fake confirm-block` | PASS | Same. |
| `integration: message-router osascript_eval without session does not spoof a denied confirm` | PASS | Darwin: no `Security Block`. |
| `formatChatErrorLine high-risk: deny mentions 弹窗; leftover after-approve does not` | PASS | Plus live probe of timeout/unavailable/disconnect. |
| `high-risk leftover after approve is not 拒绝弹窗` (extension) | PASS | Input still contains the old wrapper 「若你已拒绝弹窗」; output does not. |

---

## Claims

### 1. Valid L2 token → no post-token regex hard-block; token still required; invalid still fails

**HOLD.**

After a matching `security_token`, `executeCompanionTool("osascript_eval")` logs regex hits and continues. It does **not** return `checkHighRiskExecution().error`. `[inspected]` `companion/src/tool/companion-dispatch.ts:1087-1114`

```1087:1114:companion/src/tool/companion-dispatch.ts
      // P0 SEC-01: require L2 security_token (mirror shell_exec) — no tokenless path
      if (!params.security_token) {
        return {
          success: false,
          error: "osascript_eval requires L2 security_token confirmation",
        }
      }
      {
        const valid = securityPolicy.validateToken(params.security_token, "osascript_eval", jsExpr)
        if (!valid) {
          return { success: false, error: "Invalid or expired security token" }
        }
      }
      // L2 already confirmed. Regex hits (fetch, cookie, …) are preview-only —
      // never a second hard-block after a valid token (fzbcro: approved then
      // "Execution requires user confirmation").
      {
        const safety = checkHighRiskExecution("osascript_eval", jsExpr)
        if (safety.dangerousApis.length > 0) {
          logger.info("osascript_eval.high_risk_preview", {
            dangerous_apis: safety.dangerousApis,
          })
        }
      }
```

- No token → `"osascript_eval requires L2 security_token confirmation"` (not the fake confirm-block). `[inspected]`
- Invalid/stale/mismatched token → `"Invalid or expired security token"`. `[inspected]` Map miss / HMAC / toolName / threadId / 2m TTL / sha256(code) / one-time delete: `companion/src/security-policy.ts:199-240`. Pre-existing policy tests still cover mismatch / replay / unknown. `[inspected]` `companion/tests/security/security-policy.test.ts`
- After approve, fetch is not re-blocked. `[executed]` security-gates APPROVE test asserts `doesNotMatch(/Execution requires user confirmation/)` and `doesNotMatch(/contains high-risk APIs/)`.

`checkHighRiskExecution` still returns `blocked: true` for preview (`companion/src/security.ts:879-889`). Comment now says that flag must not hard-refuse after a valid token. Production callers no longer `return safety.error`. `[inspected]`

### 2. Tokenless `handleMessage({type:osascript_eval, expression: fetch…})` is not a fake confirm-block

**HOLD.**

The `else { checkHighRiskExecution; if (safety.blocked) return safety.error }` arm is gone. `[inspected]` `companion/src/message-router.ts:3374-3385`

- non-darwin: platform reject **before** token/session. `[executed]` `/macos-only/i`
- darwin, no session: `"No session available for osascript_eval"`. Does **not** contain `Execution requires user confirmation` / `Security Block`. `[executed]` `files.test.ts`, `security-thread.test.ts`

### 3. L2 still forceConfirms all `osascript_eval`; deny still denies; god-mode alone is not enough

**HOLD.** This is **not** a confirm skip.

- `osascript_eval` remains in `L2_GATE_TOOLS`. `[inspected]` `companion/src/tool/l2-admission.ts:49-51`
- Tokenless + darwin → confirmation block (`!finalParams.security_token`). `[inspected]` `:256`
- `capabilityForceConfirm` includes `osascript_eval`; `resolveL2ForceConfirm` is true unless three-flag cruise. `[inspected]` `:842-868`
- Regex is preview (`checkHighRiskExecution` at `:943`), not whether-to-confirm. Deny/timeout/unavailable still `highRiskExecutionDeniedError(...)` and `success: false`. `[inspected]` `:1346-1377`
- Enterprise skip is shell/netsec only (`familyOfTool`). `[inspected]` `enterprise-session-trust.ts:37-40`
- LLM-supplied tokens are stripped before L2. `[inspected]` `companion/src/server.ts:464-478`

`[executed]` god-mode + critical osascript still emits `security.confirmation.request` and deny fails. `[executed]` fetch APPROVE path **did** wait for `security.confirmation.request` with `dangerous_apis` including `fetch`.

### 4. Copy: 「若你已拒绝弹窗」 only on actual deny

**HOLD** for the incident string. Residual regex footgun is a nit (below).

Companion `formatChatErrorLine` wrap with 「若你已拒绝弹窗」 is gated on `/User denied|你拒绝了/`. Timeout / unavailable / leftover leftover-string do **not** get that line. `[executed]` live probe:

| Input suffix | 「若你已拒绝弹窗」 |
|---|---|
| `User denied execution.` | yes |
| `User confirmation timed out.` | no |
| `User confirmation is unavailable.` | no |
| `WebSocket disconnected before confirmation.` | no |
| `Execution requires user confirmation.` | no — leftover copy `这不是确认弹窗` / `批准后仍被后端误拦` |

Extension leftover test feeds the **old** wrapped string (raw Security Block + 「若你已拒绝弹窗」) and asserts the phrase is gone. `[executed]`

### 5. Trust monotonicity

**HOLD.** Approve is still required. After approve the script is handed to `execFile(OSASCRIPT_BIN, …)` (`companion-dispatch.ts:1118-1162`). Failures from here are `Tab matching URL not found in Chrome` / `osascript_eval error: …`, not `Security Block`. `[inspected]` APPROVE test duration 168ms vs ~1ms deny tests is consistent with actually invoking osascript. `[executed]` / `[assumed]` exact stdout not logged by the test.

---

## Hostile questions

### Q1. After removing the post-token regex block, can a forged/stale token still execute fetch-in-page JS?

**No** for forged/stale/wrong-expression. **Yes** only for a live, companion-issued, expression-bound, unused token — which is the intended post-approve path.

`validateToken(token, "osascript_eval", jsExpr)` (`companion-dispatch.ts:1095`):

- Unknown / tampered HMAC → Map miss or `sigOk` fail. `[inspected]`
- Wrong tool / thread / expired / already consumed → fail. One-time `issuedTokens.delete` on success. `[inspected]` `security-policy.ts:236-239`
- Wrong JS body → `codeHash` mismatch (`sha256` prefix, constant-time). `[inspected]`
- L2 issuance is `issueTokenFor(toolName, finalParams)` → `bindingPayloadFor("osascript_eval")` = `String(params.expression || "")`. `[inspected]` `security-policy.ts:50-51`
- LLM cannot inject a working token: `createToolExecutor` strips `security_token` before L2 (`server.ts:464-478`). Existing W8 tests still cover forged + cross-tool strip. `[inspected]` `security-gates.test.ts:1320-1358`

**Residual (pre-existing, not introduced here):** dispatch validates `jsExpr = expression || code`, but the token is issued on `expression` only, while L2 **preview** text is `finalParams.code || finalParams.expression` (`l2-admission.ts:267-268`). If a caller sets `code` and `expression` to different strings, the user can confirm a different body than the one bound/executed. Fail-closed when only `code` is set (token bound to `""`, dispatch validates the code → `Invalid or expired security token`). Message-router canonicalizes to `{expression: jsExpr}` before `executeTool`; the LLM/`createToolExecutor` path does **not**. See nit N3.

### Q2. Is there another post-approve hard-block for `evaluate` (extension path) that this missed?

**No missed re-block.** Extension `resolveEvaluateExecution` refuses missing/empty token and, with a token present, executes `String(code)` with `detectDangerousApis` **advisory only**. `[inspected]` `chrome-extension/src/background/evaluate-code-policy.ts:35-64`, `browser-bridge.ts:1245-1266`. Companion does not call `checkHighRiskExecution` on evaluate after token; evaluate is forwarded, with a separate replay-validate at `l2-admission.ts:1579-1593`. The fzbcro string was companion `osascript_eval` dispatch, not the extension evaluate path.

### Q3. Does message-router fallthrough to `session.executeTool` without token now invoke L2 when a session exists?

**Yes on the live WS path.** `session.executeTool` **is** `createToolExecutor(ws)` (`companion/src/ws/lifecycle.ts:796,1231-1240`). Tokenless → strip is a no-op → L2 tokenless branch → confirm. That is the fix vs the old short-circuit, which returned `safety.error` **before** `executeTool` and skipped L2 entirely for fetch.

Tokenless **unit** tests have no session, so they prove “no fake Security Block”, not “L2 dialog appears”. L2-on-osascript is covered by `createToolExecutor` integration tests (APPROVE + god-mode deny). `[executed]` / `[inspected]`

WS `osascript_eval` **with a garbage `security_token`** still fails at the router (`Invalid or expired security token`) and never reaches L2. LLM tool-calls are stripped first. Fail-closed; different UX, not a confirm skip.

### Q4. Could `checkHighRiskExecution.blocked` still abort the osascript path after token?

**No remaining production `return safety.error`.** `[inspected]` `rg checkHighRiskExecution` → definition, dispatch (log only), l2-admission (preview **before** confirm), tests. After approve, L2 issues a fresh token and dispatch only logs `osascript_eval.high_risk_preview`. Restoring `if (safety.blocked) return` in dispatch is exactly what the new darwin APPROVE test is for (Q6).

### Q5. Copy lock-step: can the panel still show 「若你已拒绝弹窗」 on leftover Security Block strings?

**Not for the incident leftover.** Extension leftover branch matches `contains high-risk APIs` without `User denied`, rewrites to 误拦 / 这不是确认弹窗, and the test asserts the deny-phrase is absent even when the **input** still has the old wrapper. `[executed]` `gate-error-copy.test.ts:28-33`

Chat path: `formatChatErrorLine` (`adapter.ts:1347-1351`) then `humanizeSidepanelGateError` (`useWebSocket.ts:454`). Leftover companion copy already contains `这不是确认弹窗` and short-circuits the deny wrap (`user-gate-copy.ts:161-165`). `[executed]` probe.

**Latent (nit N2):** `/你拒绝了/` also matches `不是你拒绝了`. Today companion unavailable copy includes both `这不是确认弹窗` (short-circuit) and `不是你拒绝了`. Panel unavailable companion copy uses `页面脚本（` not `页面脚本含`, so it never enters the high-risk arm. Order-dependent, not currently a false 「若你已拒绝弹窗」.

### Q6. Did the new security-gates test actually APPROVE and assert absence of `contains high-risk APIs`? Revert-sensitive?

**Yes on Darwin. Weak on non-Darwin CI.**

```1114:1150:companion/tests/integration/security-gates.test.ts
test("item 2: osascript_eval with fetch APPROVE is not re-blocked by regex", async () => {
  ...
  const confirmation = await confirmationPromise
  assert.equal(confirmation.tool_name, "osascript_eval")
  assert.ok(
    Array.isArray(confirmation.dangerous_apis) && confirmation.dangerous_apis.includes("fetch"),
    ...
  )
  clientSideWs.send(JSON.stringify({
    type: "security.confirmation.response",
    confirmation_id: confirmation.confirmation_id,
    approved: true,
  }))
  const result = await resultPromise
  assert.doesNotMatch(String(result.error || ""), /Execution requires user confirmation/)
  assert.doesNotMatch(String(result.error || ""), /contains high-risk APIs/)
})
```

- `[executed]` this host is Darwin; test ran 168ms and passed → **did** approve, **did** assert the two incident needles absent.
- If dispatch re-block is restored, darwin test goes **red** (those strings return). Revert-sensitive **here**.
- `shouldL2GateOsascript` false → early `OSASCRIPT_MACOS_ONLY_ERROR` and **return**. Linux CI would stay green if the re-block came back. Nit N1.
- Test does not assert `success === true` **or** `TAB_NOT_FOUND` / `osascript_eval error`. A renamed Security Block without those two phrases would still pass. Tight enough for fzbcro’s exact string.

---

## Findings

No P0 / confirm-skip / forged-token execute hole in this batch. Residual nits only.

### N1 — MED test — APPROVE regression is Darwin-only

`security-gates.test.ts:1119-1127` returns before approve on non-darwin. The fzbcro re-block lives in `executeCompanionTool` (runs on all platforms after a token). Linux CI will not catch restoring `if (safety.blocked) return { error: safety.error }`.

**Fix direction**: keep the integration test, **plus** a platform-free unit: `issueToken("osascript_eval", fetchExpr)` → `executeCompanionTool` (stub `execFile` if needed) → assert error is not `contains high-risk APIs`. Tokenless / invalid-token cases already fail closed without Chrome.

### N2 — LOW copy — `/你拒绝了/` matches `不是你拒绝了`

`user-gate-copy.ts:168` and `gate-error-copy.ts:96`. Mitigated today by `这不是确认弹窗` short-circuit and by companion timeout/unavailable using `页面脚本（` not `页面脚本含` (panel high-risk arm not entered). A copy tweak that drops the short-circuit could re-label unavailable as deny and resurrect 「若你已拒绝弹窗」.

**Fix direction**: deny-detect `User denied` / `(?<!不)你拒绝了` / `你拒绝了这次` / `你拒绝了在页面执行`; never match `不是你拒绝了`. Add a panel test that companion unavailable copy does not become the 🛑 deny bubble.

### N3 — LOW residual (pre-existing) — osascript `code` vs `expression` bind/preview split

Not introduced by this patch; called out because Q1 asked for expression binding.

- Preview: `code || expression` (`l2-admission.ts:267-268`)
- Token: `expression || ""` (`security-policy.ts:51`)
- Dispatch validate/run: `expression || code` (`companion-dispatch.ts:1043-1046`)

Divergent aliases → confirm/bind/run mismatch, or post-approve `Invalid or expired security token` when only `code` is set. Message-router already canonicalizes to `expression`.

**Fix direction**: `bindingPayloadFor("osascript_eval")` = same `expression || code` as dispatch, and L2 preview must use that same string. Out of scope to land in this batch unless you want it as a follow-up.

### N4 — LOW test — leftover copy over-claims “批准后仍被后端误拦”

Any leftover `contains high-risk APIs` that is not deny/timeout/unavailable is labeled after-approve misblock. Correct for fzbcro; wrong if a future path reuses `checkHighRiskExecution().error` **before** confirm. Acceptable as a tripwire while the production return is gone.

---

## Trajectory / blast

- Diff matches the claimed fix: remove second gate after token; stop tokenless router spoof; stop deny-copy on leftover. `[inspected]`
- Unrelated files in the same frozen patch (LLM DNS, vision, voice tests) were **not** re-reviewed here.
- Trust: still L2 HITL. Regex is not a second veto. Token still binds the expression (with N3 alias caveat). Surface of `osascript_eval` unchanged (macOS Chrome-tab JS only, argv-passed). `[inspected]`

---

## Verdict rationale

Incident root cause is real and local: L2 approved, then `checkHighRiskExecution.blocked` refused the same `fetch`. That return is gone; L2 still always asks (except existing three-flag cruise); copy no longer tells the user they refused a dialog they approved. Hostile token questions do not yield a forged/stale execute path. Nits are CI-gap + copy regex footgun + pre-existing alias bind, not a reopen of fzbcro.

VERDICT: APPROVE_WITH_NITS
