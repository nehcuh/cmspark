# #618 source machine/eval card — round 3

Base e44af42f0f3999f23306e41159edb8b12e3dbdff. Full frozen 30-file source diff `/tmp/cmspark-itcra-618-r3.diff`, SHA256 `7c45896c7ff08b1879e6ba499b803e68ff055a44277cdbb4bbe3a71d7047f9d9`. Audit reports/cards excluded. T4 opt-in source, no production grant/configuration/app installation.

## Repairs from both independent r2 REJECT reports

- S5: immutable instance registration now requires fixed business subject, compares it at issuance/live use and rejects old unbound records. Multiple human grants for same business subject remain valid; conflicting subjects rejected. CLI requires --subject. Tests mutate actual persisted grants and registration; no implicit migration. Actual site's SSO principal still needs joint verification.
- S4/C6: waiting-login first inspects readiness without pending action rule, restores retained target at most once using explicit navigate authority, then inspects the rule on that document. Fresh dangerous action challenge requires new proof; callback without target cannot trigger premature business effects. Click/type/write callback trajectory tests.
- C5: verified ready preparation freezes actual business URL B after completed click A→B; private owned-tab extension event history retains B through pre-SSO navigation before a ready inspection. Internal last_business_url is bounded/scoped; not public evidence/durable. Actual Bridge→JSON event producer negative tests and actual Chrome renderer with declared API event adapter.
- N1: successful rebind/completion removes stale retry error_code. Normal late pre-effect READINESS_CHANGED resumes without replay; dangerous old consumed proof remains terminal.

## Machine gates (Node22.23.2, nvm use22; all exit0)

1. Host Companion npm test: 5901 total,5849 pass,52 existing skips,0fail (4252/1629/20 groups). Build tsc/assets exit0. Logs `/tmp/cmspark-itcra-companion-r3-tests.log`, `...-build.log`. Subsequent test-only descriptor refinement matches the actual producer's six attributes/input tag; fresh canonical targeted recompilation/rerun19/19 and fresh ARM rerun below cover this final fixture. Production source unchanged after full test.
2. Extension npm test1520/1520, tsc/Plasmo build exit0. `/tmp/cmspark-itcra-front-r3-{tests,build}.log`.
3. Fresh Linux ARM64 image cmspark-office-val:node22.23.2, source-only copies/no host node_modules:70/70 enterprise/grant/CLI/actual WS integration, tsc/build exit0, acceptance4/4. `/tmp/cmspark-itcra-arm64-r3.log`. Final source/fixture rerun.
4. Native isolated Chrome rehearsal13 checks pass: actual renderer/ISOLATED scripts/loader documentIDs/CDP; extension API event adapter simulated. Added pre-SSO business navigation retention and normal search-input effect. Existing target replacement, late login, expiry, reload, scope, owned tab and credential-denial checks pass. `/tmp/cmspark-itcra-native-r3.log`. No real human login/installed-extension claim; images not saved.
5. Actual acceptance runner main/validator4/4, host+ARM; simulated validator fixtures never real bake-off. False/absent workbook capability remains hard A12 failure. `/tmp/cmspark-itcra-acceptance-r3.log`. SDK unchanged, prior actual403/fixedsubject checks apply. git diff --check exit0.

## Live authorized site entry observation

Initial local headed/headless probes failed ERR_EMPTY_RESPONSE. After user network steering “现在试试呢”, fresh headed Chrome HTTP and HTTPS home.cmschina.com.cn reached main-frame https://sso.cmschina.com.cn/login.aspx, status200. Separate headless structural probe: visible unique #loginBody/#qrcode/#btnLogin, one known exact “扫码登录” label,0visibleiframe; no QR/image pixels/sources/page body/credentials/tickets/query URLs captured. This qualifies reachable entry/candidate login markers only, never authenticated principal/ready marker/post-login continuation or full A-case pass.

Existing deployment preflight passed=false/all23p0 cases missing. ITCra authenticated UI/RBAC/human signer/driver, matching offline-installed artifacts, real dedicated test identity/ready marker and full joint bake-off remain pending. Workbook export explicitly false; phase=all cannot pass. No ITCra-source edits, live policy installation or application replacement.

## Four-line case

1. r2 restore used stale explicit-navigation destination and inspected original targets on callback; instance registration omitted subject.
2. Independent reviewers reproduced wrong-document completion, failed target continuation and conflicting subject topology.
3. Implementer omissions; repaired producer/navigation/order/registration invariants with concrete trajectory negatives and positive replay counts.
4. Protect correct requested-document evidence, fresh human authority and business identity isolation; machine PASS is not independent approval.

MACHINE: PASS for source gates. Independent r3/Pi/Kimi pending. MERGE: NO — T4 human + real joint bake-off mandatory.

R3 independent security and contract reports both REJECT, confirmed S6 revocation/policy rollback and S7/C7 ambiguous same-path destination. Earlier R2 exact counterexamples closed. Review-service initial failed turn recorded as unavailable, then read-only local review succeeded; no failed turn counted as approval. No commit/PR/merge on r3.
