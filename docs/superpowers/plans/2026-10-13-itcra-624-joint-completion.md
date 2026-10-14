# #624 / #626 joint completion plan

Existing design authority: #618 and #624; user selected REST/grant and authorized ITCra changes and merge only after all gates. Rebuilt 2026-10-13 after the local ultraqa taxonomy wording repair. Runtime scanner and rules are unchanged. The live router selects builtin/deep-diagnosis-optimization; both it and the CMspark eval gate pass runtime scanning.

2026-10-14 update: the user explicitly authorized merging reviewed code before real-system joint testing. The original premerge real-acceptance ordering below is historical and superseded by that instruction. Source machine/review/CI gates remain mandatory; real acceptance and its missing authenticated ITCra driver remain postmerge work in #618, without a passing enterprise-readiness claim or automatic issue closure.

## Batch 1: capacity recovery (#624)

- `companion/src/outbound-mcp/enterprise-state.ts`: exclusive lifetime writer lock, no stale-lock stealing; local admin rotation requiring explicit quiescence acknowledgement, strict revoked referenced-grant validation under the grant writer lock, unique private archive, atomic reset.
- `enterprise-service.ts`: acquire lock before recovery, irrevocable close fence before abort/release; no late save or dispatch after close.
- `enterprise-http.ts`, `ws/lifecycle.ts`: production graceful-shutdown admission fence and singleton close before awaited teardown, verified by actual loopback HTTP and lazy writer lifecycle.
- `outbound-grants.ts`: strict locked revoked-authority read for recovery; missing/malformed authority is not proof of revocation.
- `grant-cli.ts`: `rotate-enterprise-state --quiesced` only; no HTTP recovery endpoint.
- Service/state/CLI tests: both caps, active/pending preservation, unrevoked/expired/missing authority rejection, writer contention, late work after close, private archive and fresh-grant namespace, old-handle/proof rejection.
- Administrator documentation: stop Companion AND dedicated browser, revoke referenced grants, rotate, restart dedicated profile and issue fresh grant. Extension's 128-history cap requires closing old tabs/profile; JSON rotation alone is insufficient.

## Batch 2: ITCra human channel and continuation

Preserve selected ITCra source files in a private hash-manifest baseline (ITCra is not a Git checkout). Never copy private environment/data/secrets/references into CMspark.

- New `app/enterprise_browser.py`: bounded REST client; independent human authentication and server-side role/subject/change binding; human-only proof signer; default deny; durable session/operation ledger; cancelled/unknown outcomes never replay.
- `app/main.py`: mount BFF routes and owner-bound sessions/status/image/approve/deny/cancel; old deployment or agent tokens cannot mint proofs.
- `app/extensions.py`, `orchestration.py`, `worker.py`: enterprise tools with stable logical-operation keys; BrowserWaiting as a separate exception, persist/release worker, keep successful stages and operation results; collect parallel waits and fence cancellation/config changes before resume.
- `app/static/enterprise-browser.js`, `index.html`, `app.js`: human sign-in, automatically refreshed own login image, explicit one-operation approval UI, cleanup on close/logout/change switch/late response; no signer key or grant in browser.
- `pyproject.toml`/`uv.lock`, deployment example/docs: required signing dependency, separated API/worker credentials, restricted test-role files.
- Tests: anonymous/deployment/worker denial, cross-user/change denial, insufficient role, tamper/replay/expiry, stale image cleanup, waiting/parallel/restart/unknown-outcome/operation and stage replay protections.

## Required gates (no omitted or synthetic success)

For each batch: machine tests/build → independent adversary + Kimi full diff → fresh Linux ARM64 validation → Pi reads same full diff, complete reviews and machine card → verified commit. Source changes invalidate old gates.

Before #626 merge: fresh head CI green; locally deploy exact two-sided source; instrumented real acceptance A1–A11/A13–A24 with independently checkable receipts; human scans actual enterprise SSO and reviews dangerous test operation in ITCra; offline/restart/logout/expiry and isolation evidence. A12 remains P1 and workbook export remains false; P0 cannot be described as full workbook delivery. T4 requires human review, never automatic approval. Missing, mock or skipped real acceptance remains a blocker.

Known missing input: no existing test identity config; user can scan SSO. Create restricted local role config without putting credentials in chat; actual second enterprise principal and post-login readiness still need verification. Ask for scan when human UI is ready.
