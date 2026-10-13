# #618 source machine/eval card — round 2

Base e44af42f0f3999f23306e41159edb8b12e3dbdff. Full frozen source diff `/tmp/cmspark-itcra-618-r2.diff`, SHA256 `3b777c9ff4abba3dbc9f5209e8970bab2c34b98dab46be1e507b57766682c477`. Same30 source files; audit reports/cards excluded from hash. Source remains opt-in T4; no merge/release approval.

## Repairs after both independent r1 REJECT reports

- S1: ISOLATED-world private WeakMap element identity bound into snapshot/digest and atomic effect. Identical replacement node cannot inherit approval. Native Chrome and signed-old-target service regression.
- S2: trusted readiness/login markers and finite deadline rechecked synchronously in the actual effect tick. Serialized guard deadline ≤30sec/session/proof expiry. Native marker transition between final snapshot/effect and delayed-actor expiry negatives. Known pre-effect READINESS_CHANGED normal operation returns to login waiting without effect replay; dangerous proof remains consumed/terminal.
- S3/C4: navigation independent of export. Authorized navigation/login source may navigate to preauthorized target even with unsupported readiness or no evidence scope; text/screenshot still require evidence. Service/actual bridge/native tests.
- C3: ordinary Bridge startup persists profile UUID before administrator registration; cold module restart retains it; storage rejection allows retry. Actual startup producer test.
- C1: every required observation must be backed collectively by retrieved receipts of appropriate trace/UI/effect/offline/workbook kinds; measurements retained in report. Actual runner main with superficially passed assertions but incomplete receipts returns failure.
- C2: discovered workbook_export=false/absent hard-fails required A12 without driver dispatch. Actual main otherwise-valid p0 passes its simulated validator test; phase=all fails A12. Test fixtures are not real acceptance.
- Related trajectory: SSO restores the original requested business target at most once, using explicit navigate authority, instead of returning another document. Private per-operation destination is not persisted. Monitor/duplicate execute scheduling coalesced;20 extra slow-tick/execute calls cannot build duplicate work queues.

## Fresh exact-source machine gates

Host Node22.23.2, nvm use22, correct local compiler. All exit0:

1. Companion canonical npm test: **5898 tests,5846 pass,52 existing skips,0 fail**, groups4249/1629/20. `/tmp/cmspark-itcra-companion-r2-tests.log`.
2. Companion npm run build: tsc/assets exit0. `/tmp/cmspark-itcra-companion-r2-build.log`.
3. Extension npm test: **1520/1520 pass**; production tsc/Plasmo build exit0. `/tmp/cmspark-itcra-front-r2-{tests,build}.log`.
4. Fresh Linux ARM64 image cmspark-office-val:node22.23.2, source-only copies/no host node_modules: **67/67 enterprise+grant+CLI+real WS integration tests pass**, tsc/build exit0; acceptance validator **4/4 pass**. `/tmp/cmspark-itcra-arm64-r2.log`.
5. Native dedicated Chrome renderer/CDP rehearsal: **11 checks pass**, including identical replacement, late login, extension-time deadline, navigation without export, attribute change, same-URL reload, credential denial, incomplete text coverage, correct owned-tab capture and same-origin login separation. Fresh isolated profile cleaned; images not saved. `scripts/itcra-browser-isolated-check.mjs` exit0. Extension API adapter simulated, never real SSO/installed-extension evidence.
6. Host actual acceptance entry/validator **4/4 pass**; fully recorded Bridge→JSON fixture compared unchanged (explicitly simulated). SDK fixed subject/actual403 decoding previously verified unchanged. git diff --check exit0.

## Real deployment limits and latest user steering

User supplied SSO entry https://sso.cmschina.com.cn/login.aspx, documented as configuration input. Fresh unauthenticated isolated Playwright/Chrome visit did not load successfully (Error class); no QR/image/text/token copied, no login pass claimed. Precise login/ready markers, dedicated enterprise identity/profile mapping, ITCra authenticated UI/RBAC/checkpoint signer/driver and matching offline-installed build still need joint integration. Existing deployment new-protocol preflight report is passed=false/exit1 with all23 p0 cases missing; no business action dispatch.

Known original-workbook export P1 remains explicitly false, so phase=all cannot pass. v1 iframe/popup login explicitly unsupported. Personal grants/HITL and general profile tool arrays unchanged. No production issuance/config changes, ITCra-source edits or installed application replacement.

New steering's routing diagnostic6104dbb7-b37 was blocked and not executed. Required deep-diagnosis source was present/read and restored into a refined single matching route; correct repair plan rebuilt with all machine/independent/Pi/Kimi/CI/T4 human+real-bakeoff gates retained. No deployment step inferred from the quoted clarification.

## Four-line process case

1. r1 tests passed while target descriptors lacked actual node identity/readiness-in-effect checks and receipts omitted required observations.
2. Independent native Chrome/adversarial runner counterexamples showed wrong-target effects and false acceptance; both reviewers REJECTed.
3. Implementer omissions; repaired exact boundaries and added producer/native/entry-point regressions rather than weakening gates.
4. Protect target-bound human authority, normal SSO continuation and acceptance honesty; machine pass cannot replace independent review.

MACHINE: PASS for source/code gates. Independent r2/Pi/Kimi pending. MERGE: NO — T4 human approval and real joint bake-off mandatory; R1–R5 joint completion not claimed.

Round 2 completed: BOTH independent reviewers REJECT. Security S4 callback target ordering / S5 immutable instance subject binding and contract C5 stale destination / C6 callback target ordering require round 3 repairs; P2 stale completed error also accepted. Machine PASS is not source approval. No source commit/PR/merge occurred on r2.
