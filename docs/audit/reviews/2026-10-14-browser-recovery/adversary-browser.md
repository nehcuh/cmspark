# Independent Browser-only adversarial review

VERDICT: APPROVE (Browser component only; not release/merge approval)

Scope: the eight Browser paths for #568/#548, base e5b3511bc6e3ed36aca9c71314ec21ae1f3bf5a8. I authored the separate Windows owner diagnostics component and do NOT approve it in this report. No source edits, dependency install, commit/push, real page effects, credential reads or human-authorization mutation were performed for this review.

## Exact source and independent validation

Read the complete Browser diff, all new producer/caller tests, relevant actual callers and unchanged evaluate policy, token validation, model failure guard, outbound profile gate and worker denial controls. Independently SHA256-checked all eight files in both /tmp/cmspark-browser-wave-20261014/repo and /Users/huchen/.codex/worktrees/browser-recovery/cmspark: zero mismatches. Browser complete diff /tmp/cmspark-browser-recovery-full.diff SHA256 is 06ebab53da6478623e8c6e4132cccc9e4e3e354292ff8d61d7101abdfc4c354a, matching manifest.json.

Independent canonical isolated Node 22.23.2 run of browser-recovery-568-548, adapter-pivot-trusted-turn, same-tool-guard, site-op-memory, l2-admission-pure and classify-by-code: 84/84 tests PASS, zero failures/skips/cancellations, 3.393 seconds. Complete output /tmp/cmspark-browser-adversary-focused.log. This is a targeted review probe, not a repeated whole-repo run.

An additional independent actual-producer/caller denial probe used real gateOutboundCall for evaluate under the default outbound profile and real cookieTrustBlockedPayload through real chatCreate with a controlled provider stream. PROFILE_FORBIDDEN remained non_recoverable; actual COOKIE_TRUST_DENIED halted the adapter as security, no read alternative was dispatched, and no evaluate-auth recovery system note was injected. No gateway call occurred. Only test-owned data was used/deleted. Full log /tmp/cmspark-browser-adversary-deny-probe.log; all six recorded checks true.

Parent machine.json records combined host 5926 total /5874 PASS/52 existing platform skips and extension 1527/1527, both builds exit 0. Fresh ARM card records Companion 153 total /148 PASS/5 existing Windows skips and extension 50/50, both builds exit 0. Those are supplied machine receipts, not independently rerun by this reviewer. Exact-head native Windows CI and post-merge main CI are still pending. No native Chrome business accuracy is established by controlled Chrome/CDP/model seams.

## Findings

No confirmed P0/P1/P2 defect in this Browser delta.

### Exact authorization classification cannot substitute for authorization

- chrome-extension/src/background/browser-bridge.ts:1824–1837 returns the exact structured EVALUATE_AUTH_REQUIRED only for resolveEvaluateExecution.allowed=false. Read actual evaluate-code-policy.ts:35–75: those refusals are strictly missing/null/empty/whitespace token presence; code is not dispatched on that branch. The extension remains a token-presence endpoint under the unchanged architecture, while Companion is the authoritative validator; this patch does not pretend the extension verifies signatures.
- companion/src/tool/l2-admission.ts:1908–1921 changes only the existing invalid/expired pre-set-token refusal envelope. It still calls actual securityPolicy.validateToken with tool evaluate and original code, then returns before any effect. No issueToken call is added, and there is no automatic confirmation/replay branch. The earlier actual human/approved-auto policy path remains required for a fresh token.
- Actual SecurityPolicy validates issued-token map membership, tool/thread/code binding and expiry and deletes valid single-use tokens. Reproduced actual L2 positive approved binding through the real Bridge producer, original expression forwarded exactly once to the inert CDP seam; replay, mismatch and expired tokens remained rejected with no automatic human request or token export. This is protocol/producer correctness, not real human approval or native JS execution accuracy.
- companion/src/security.ts:1015 registers only the exact new code as recoverable. Unknown/uncoded heuristics are unchanged, not rewritten to match arbitrary authorization-looking messages. Registered COOKIE_TRUST_DENIED remains security, and PROFILE_FORBIDDEN/GRANT_DENIED/WORKER_DENIED remain non_recoverable. Existing user-denial behavior and actual worker HARD_DENY whitelist still hold. The independent real producer/caller cookie/profile probe strengthens these negative controls beyond inventory-only classification.
- companion/src/llm/adapter.ts:2318–2320 adds one fixed host note only for evaluate plus the exact classCode, requesting already allowed alternatives or fresh existing human confirmation, explicitly forbidding token construction/replay/reuse. A recoverable category permits planning an alternative; it grants no execution permission. Existing executeTool/L2/tool whitelist still authorizes every proposed alternative.

### Parameter refusal versus actual/unknown page health

- BrowserBridge.getTabId at line 468 changes only the missing-ID error prefix to the already registered TAB_ID_REQUIRED. Existing tab lookup/calls remain unchanged; the new prefix is translated by the same executeInner exception envelope at lines 222–228.
- site-op-memory.ts:67–71 adds only that missing-ID code to the nonaggregating set. EVALUATE_AUTH_REQUIRED was already excluded. Both adapter call-site and recordSiteOpFailure retain the exclusion predicate; UNKNOWN/uncoded actual health failure still accumulates. Four unknown failures still escalate and block the origin in the actual regression control.
- No retry threshold, valid-tab coercion, permission, CDP attach capability, locator count or route arming is altered. Constants stay locator=2 and origin=4; the existing same-tool real-failure threshold=3 and maximum-round bound remain. Missing tab errors can invoke existing list_tabs discovery under its normal execution path, but neither fabricated IDs nor new tab permissions are accepted.

### Same-locator refusal yields strategy guidance without weakening the ban

- site-op-memory.ts:718–724 changes only ordinary SITE_OP_BANNED suggested_action from stop_or_change_task to the already used switch_strategy. The original false result, exact error code and locator-ban message remain. TAB_ATTACH_FROZEN still advises list_tabs, origin escalation still declares blocked when unarmed/unsupported or uses its original armed lane under existing human confirmation. DOM-script budget stop_or_change_task is untouched.
- adapter.ts:1996–2004 creates a note on pre-execution ordinary locator ban. It does not run the banned operation, reset its state or count a rejected attempt as an executed failure. Actual two-miss controls produce two executed clicks, then third/fourth refused results and one note; a permitted read seam remains reachable. Origin fail count stays two.
- Locator-note dedup is a separate per-chatCreate set keyed by origin and locator (adapter.ts:1407–1412). It never marks the old toolName-keyed distinct-locator pivot as consumed. Actual further distinct-locator failure reaches the original three-executed-failure pivot and produces its separate note; no early halt or altered count is hidden by dedup.
- Auth-note dedup is a separate boolean. Actual repeated evaluate refusals still stop at three; a planned read after that bound is not dispatched. Dedup prevents redundant guidance, not the old finite failure stop.

### Trusted guidance cannot contain page/locator instructions

The two new notes are literal host text. Untrusted origin/locator values are used only as private map keys and remain outside the system-message body. Page title/text/error/selector strings are not interpolated into them. The unchanged post-tool-results delivery at adapter.ts:2555–2565 emits role=system guidance separately from role=tool content while retaining tool-call pairing.

Hostile locator containing a closing untrusted tag and a fake system directive remains absent from the actual system note in the caller regression. The retained ban envelope may identify the locator as untrusted tool data; it is not promoted to a system directive. New notes suggest supported existing read/selector/scroll/search/navigate paths with explicit existing-permission constraints, without adding an automatic tool call, unsupported native fallback, host-computer suggestion or new profile.

## Component DoD / outcome / trajectory

- #548 scoped DoD: ordinary same-locator pre-execution refusal now supplies one actionable strategy note and machine enum while retaining the ban and the old distinct-locator pivot. Actual producer/caller controls cover both. It does not promise success on a real website.
- #568 scoped DoD: actual returned auth refusal is typed consistently across Bridge/classifier/L2, missing tab identity is typed/nonaggregating, and adapter recovery preserves authority and finite failure limits. Broader positive-only CDP-health classification remains dependent on #563's typed producer coverage; unspecified/unknown failures are intentionally not erased. This report does not claim that remaining architecture complete.
- The complete implementer packet preserves initial five-case red and the intermediate old contract-inventory/enum failures; final changes update exact registry/enum expectations while retaining safety assertions. This review reproduced positive/negative actual producer contracts on frozen source rather than inferring correctness from names alone.
- Evidence does not fix an inaccessible original vw2ob1 trace, all site-memory contamination, debugger orphan cleanup or scoped-human-reset UI. Those unrelated/dependent requirements cannot be closed using this component approval.
- Conservative T3 review passes for Browser scope with the stated machine and synthetic-boundary evidence. Independent final synthesis, fresh exact-head native Windows CI, landing checks and post-merge main babysit remain root-owned. Windows owner diagnostics are excluded from this verdict, and no own-component approval or release authorization is supplied.
