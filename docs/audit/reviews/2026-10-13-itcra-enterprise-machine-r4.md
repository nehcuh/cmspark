# #618 source machine/eval card — round 4

Base e44af42f0f3999f23306e41159edb8b12e3dbdff. Complete frozen31-file diff `/tmp/cmspark-itcra-618-r4.diff`, SHA256 `ccbf20fb4c1e8a6c0045c675d7f40db225fb7214f09d062ef01f00b6ee4f50db`. Audit reports/cards excluded. T4 opt-in source; no production issuance/configuration/app replacement or ITCra-source edits.

## Confirmed r3 blockers repaired

S6: verification never rewrites authority JSON. Usage timestamps are private per-grant sidecars; public grant listing overlays them for compatibility. All supported issue/revoke/revoke-all writers take cross-process exclusive lock before fresh load through atomic commit. Contention explicit GRANT_STORE_BUSY; no successful revoke on contention; no automatic stale-lock stealing. Manual policy edits require quiesced/offline migration; revoke/new issuance is supported. Actual child-process regressions cover legacy/enterprise auth vs revoke/revoke-all/newer policy and a held actual issuer vs all three contending writers, unchanged authority bytes, preserved issued sibling and final successful revoke. Scheduling hooks choose interleavings but do not replace authority logic. Child cleanup awaited.

S7/C7: changed overlapping navigation/login URL invalidates stale prior target when there is no explicit requested intent. Internal business_target_unavailable clears service cache; prepare fails RETURN_TARGET_NOT_RETAINED before recording operation/args, with no A evidence. Actual producer→JSON→actual service regression covers readyA→clickB/login before qualification: explicit failure, zero restore; later verified readyB/same-URL login/callback resumes B once, no click replay. Explicit open/navigate intent is retained privately through ambiguous login redirect until a verified ready document; native positive. New unknown cross-route case declared unsupported; no scope-overlap inference of authentication.

## Fresh final source machine gates (all exit0)

Host Node22.23.2 via nvm use22, local compiler, canonical isolated runner.

- Companion npm test5904 total/5852 pass/52existing skips/0fail (4232/1652/20 groups); npm run build tsc/assets exit0. `/tmp/cmspark-itcra-companion-r4-{tests,build}.log`.
- Extension npm test1520/1520, tsc/Plasmo build exit0. `/tmp/cmspark-itcra-front-r4-{tests,build}.log`.
- Canonical six enterprise/concurrency suites22/22 after fresh compilation. `/tmp/cmspark-itcra-targeted-r4.log`.
- Fresh Linux ARM64 image cmspark-office-val:node22.23.2, source-only copies/no host node_modules:73/73 enterprise/concurrency/grant/CLI/actualWS integration, tsc/build exit0; acceptance4/4. `/tmp/cmspark-itcra-arm64-r4.log`.
- Native dedicated Chrome16 checks pass, actual renderer/ISOLATED DOM/document-loader IDs/CDP with declared simulated extension API event adapter. `/tmp/cmspark-itcra-native-r4.log`. Added overlap-ambiguity denial, verified same-URL target and explicit requested target retention. Prior13 actuator/evidence checks retained. Final rehearsal script separately rerun after fixture corrections; final production source matches broad tests. Images not saved, profile cleaned.
- Actual acceptance runner/validator4/4 host and ARM; mock fixtures are never real enterprise bake-off. `/tmp/cmspark-itcra-acceptance-r4.log`. SDK unchanged, prior fixed subject/actual403 checks retained. git diff --check exit0; origin/main readback still exact base.

Native fixture corrections are documented rather than hidden: its disjoint case previously used broad navigation / plus login /login, which overlaps; narrowed business fixture scope to /app for a genuinely disjoint case, then added explicit overlap negatives/positives. Empty main markers had zero height, and repeated global declarations prevented the ready fixture from updating. Made markers visible, isolated fixture declarations and rejected CDP exceptionDetails. These are rehearsal fixture defects, not authority guard waivers. Final16 pass.

## Live/site and delivery limits

Authorized fresh headed HTTP/HTTPS home.cmschina.com.cn retry reached main-frame https://sso.cmschina.com.cn/login.aspx/status200. Separate headless structural probe observed visible unique #qrcode/#btnLogin/#loginBody and known “扫码登录” label;0visibleiframe. Initial ERR_EMPTY_RESPONSE superseded for entry connectivity. No QR/image/body/credentials/tickets/query URLs captured. This is reachable live entry/candidate marker evidence only, not actual authenticated readiness/principal, correct-user human presentation, remote popup or post-login continuation.

Existing installed deployment protocol preflight remains failed/all23p0 cases missing. ITCra authenticated UI/RBAC/human signer/checkpoint driver, dedicated actual test identity/ready markers, matching offline-installed artifacts and all required joint cases remain pending. Original workbook export explicitly unsupported, so phase=all A12 cannot pass. No production keys or policies changed.

## Four-line case

1. r3 live rechecks trusted grant file while auth metadata could replace it; overlap history selected stale A.
2. Independent separate processes reproduced completed revoke/policy rollback, actual producer/service completed wrong A evidence.
3. Implementer/inherited persistence omissions; separate telemetry from authority, serialize writers, reject unverified target ambiguity, preserve qualified positives.
4. Protect monotonic revocation and faithful business-document evidence; neither machine nor a reachable login page replaces independent/T4 joint review.

MACHINE: PASS. Independent r4/Pi/Kimi pending. MERGE: NO — T4 human + real joint bake-off mandatory.

## Review orchestration availability note

Security agent r4 turn returned a service content-filter error and no valid final report. No APPROVE is inferred from that failure. Independent contract agent remains the first source lane; Kimi2.1.1 full-context read-only review will additionally serve as the independent security/source lane, then Pi0.85.1/deepseek-v4-flash reads BOTH complete reports plus this card and the identical full diff. This preserves non-implementer independent authority review → Pi confirmation and the mandatory Kimi gate, rather than dropping the failed lane or retrying it indefinitely. T4 human/real joint gate remains unchanged. Frozen source SHA unchanged.

## Final source review result

Independent contract/product r4 APPROVE (canonical22/acceptance4 independently rerun); independent Kimi2.1.1/kimi-code/kimi-for-coding full-context security/source APPROVE_WITH_NITS, CLI exit0; Pi0.85.1/deepseek-v4-flash reads both complete reports/diff/source bodies, APPROVE_WITH_NITS, CLI exit0. Source SHA checked unchanged afterwards. Pi added nonblocking P2 durable history/capacity recovery; tracked #624, owner nehcuh/CMspark maintainers, required before sustained production. P3 diagnostics/doc precision/registration/profile suggestions tracked #625 with owner; false dead-code premise rejected, purpose nonce consumption remains intentional and changes require tests. No P0/P1 residual source finding.

Source implementation committed988955b7; logical complete trust boundary kept atomic. MACHINE PASS / independent source APPROVE* / Pi APPROVE* / Kimi APPROVE*. CI pending. MERGE NO: T4 human+real joint bake-off still closed, draft only; real identity/UI/driver/offline/workbook limitations remain unwaived. Failed service turn and initial incompatible Kimi --plan flag never counted as approval; corrected invocation reviewed complete materials.
