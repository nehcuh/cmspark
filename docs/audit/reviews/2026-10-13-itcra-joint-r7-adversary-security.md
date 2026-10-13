# Independent security/UI component review — r7

Component verdict: **REQUEST_CHANGES**. One confirmed P2 regression remains. No new P0/P1 found. This is not T4 acceptance or merge approval.

Reviewer: Codex subagent `/root/itcra_ui_diagnosis`, independent, read-only, not implementer.
Frozen FULL two-project diff/context packet: `/tmp/itcra-joint-review-r7/kimi-context.md`
Packet SHA256: `0ad870898b6f3876c0eec425f0f018088cce073237225b8aebfb88ca205defe0`
ITCra diff SHA256: `a6160a001bd40ee3aeb0b4d19f950aad221cb571201e49a16f0c0a41bb43a6b8`
CMspark diff SHA256: `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`

Reviewed r7 FULL diffs/context against the previously read FULL r6 packet, all changed lines and their sibling invalidation/continuation/auth/UI paths. No source modifications, live configuration/secrets, private pages, QR or Cookie inspection. Only synthetic temporary Store/router reproductions with zero network requests were performed. Synthetic sign-in used automatic HTTP client Cookie handling; no browser Cookie was extracted or printed.

## P2 S3 — dispatch failure rolls back durable human approval/audit after an accepted effect

Location: ITCra `app/enterprise_browser.py`, `decision_sync`, the `with store.transaction()` block covering both `decision_claim`/actor/time writes and `EnterpriseClient(...).post(.../execute...)` (r7 lines approximately 521–543; identify by the exact function/block).

The new job/config CAS correctly fences stale original jobs. However, it now encloses the remote execute request in the same SQLite transaction as the human decision audit. A POST may have been accepted by Companion, consumed its one-use proof and begun/completed a business effect before the connection drops or times out. `EnterpriseClient` raises; Store.transaction rolls back the entire local claim/audit write. ITCra consequently returns an error while its durable record still says waiting_human with no decision_claim, decision_actor or decision_at. Companion's own exactly-once proof still prevents repeating the same action; this finding is **not** a demonstrated duplicate-effect exploit. It is loss of the required durable human approval/audit plus an incorrect local pending state after dispatch uncertainty.

Reproduction: actual mounted r7 enterprise decision router, real Store.transaction, synthetic human auth/profile/session/operation, synthetic proof producer, synchronous execute stub records one accepted effect then raises HTTPException(503, ENTERPRISE_UNAVAILABLE). No network requests or real credentials. Output:

```json
{"synthetic_only":true,"network_calls":0,"response":503,"accepted_effect_count":1,"decision_claim_retained":false,"decision_actor_retained":false,"state":"waiting_human"}
```

This directly exercises the rollback, rather than inferring it from test scores. r6 committed decision_claim before the external call; the r7 CAS change introduced this regression.

Minimal fix: retain the original-job/config/association fence. Once final human checks pass and dispatch admission is claimed, prevent an external execute exception from rolling back that durable claim and audit. For example, catch the dispatch exception inside the transaction, persist the claim/actor/time and an explicit unconfirmed-dispatch state/error, exit with commit, and only then propagate the original error. Pre-dispatch human/config rejection may still roll back. Never clear/reuse the claim or mint a fresh request key to recover an uncertain effect. Preserve actual completed/cancelled/outcome_unknown authority; cancellation or abort does not prove rollback of a dispatched effect.

Necessary regression: execute accepted then response lost (503/timeout) leaves one durable decision claim and human actor/time, explicit uncertain state, no automatic replay; subsequent status/cancel/recovery neither loses audit nor dispatches another effect. Also preserve existing before-dispatch job/config/cancel denial tests and successful decision/replay tests.

## r6 findings and sibling checks

- **S1 repaired:** bounded async body read delegates entire synchronous opening/preparing/decision helper through run_in_threadpool. Helpers recheck human auth before work and after response as relevant. A new slow prepare vs concurrent logout test exercises event-loop responsiveness. Whole workflow offloading preserves Store transaction ownership.
- **S2 repaired:** diagram BrowserWaiting is rethrown independently of normal optional diagram failures. New diagram-stage test covers waiting release, original-job resume and reuse of prior completed stages plus one browser effect.
- Model/capability invalidators and duplicate/resume admission now account for waiting_browser; original job/input/model/capability and pending-operation association are checked before human signing/admission. Focused endpoint tests change these without calling wake and reject stale decisions before effect.
- Human authority remains outside Worker-shared SQLite, in API process memory; deployment/Worker Bearers and forged SQLite human_session records cannot sign in. Version-2 credentials and signer mounts stay API-only; Worker has execution grants and shared reread ACL, not private key bytes/password hashes. ACL effective digest invalidates API cookies and Worker rights; role prerequisites fail closed.
- Owner/change/profile and exact Companion challenge checks remain intact; no model tool offers sign/approve/login image. Single-use Companion proof validation and actual target/site review remain authoritative.
- UI decisions preserve decisionInFlight and identity/change/epoch fences. Close/logout/change clears DOM/images before awaits, requests pending cancellation, and ignores old login/open/image/decision responses. Poll failures now clear stale image. Abort is correctly not claimed to undo dispatched actions.
- Cancellation fresh-load/state merge preserves concurrent audit/results; final-state fencing remains. The new S3 addresses the distinct dispatch-error rollback path, which existing cancellation tests do not cover.

## Machine evidence and completion boundary

`machine.json` reports host ITCra **111 passed**, Linux ARM64 Python3.12.13 **111 passed**, Companion targeted Linux **23 passed** and build0; host Companion **5864 passed +52 existing skips**, extension **1521 passed**, builds0; 16 actual-renderer isolated checks remain explicitly simulated Chrome API adapter. Checked host/Linux log tails independently: both show 111 passed (existing warnings disclosed). Packet inline Linux card was earlier pending; adjacent final machine.json supplies the final PASS and source manifest hash `adceee486a63bb2e9ebd5cd7768da12cf45666160f2c3632ba9d36c68269b3cf`.

Actual enterprise SSO scan/completion, qualified business URL/readiness, a second enterprise principal and real case receipts remain missing. Component tests and this review do not replace those T4 prerequisites. Fix S3, add its regression, refresh frozen diff/tests/review; no overall merge approval is granted here.
