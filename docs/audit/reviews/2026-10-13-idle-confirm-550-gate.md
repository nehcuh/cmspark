# Idle confirmation lease gate — #550

Base e44af42f0f3999f23306e41159edb8b12e3dbdff. Frozen two-file diff SHA256 6cb049b0491f1cf03ff0e58a5c1bcb2fb5ffb4a8336ec9ec5eea946aa4c35c5e.

Conservative T3: existing Fleet read/lease safety. No new tool, authority, dispatch, confirmation exemption or retry. Idle SOFT_RESERVED/HELD_PENDING_L2 uses the existing owner-bound live-confirm hook before release. Hook exceptions preserve exclusivity; existing CDP/mutation/create holds, explicit cancellation and hard-cap semantics remain.

Three newly added production-state regressions failed on baseline (40pass/3fail), then full canonical Node22.23.2 Companion5885tests/5833pass/52existing platform skips/0fail, buildexit0. Fresh LinuxARM64 snapshot:79 targeted lease/L2/Fleet cases pass,0skip/0fail, buildexit0. Independent adversary APPROVE with separate61case+4timing probes. Kimi and Pi APPROVE_WITH_NITS, full reports retained. Pi corrects Kimi context-offset citations and stale pending-Linux wording; original reports are preserved. Optional style/missing-optional-hook observations do not change production's complete bootstrap registration or cold-start fail-closed CDP guard. This patch does not redesign SOFT's existing confirmation TTL.

Case: worker exits while confirmation remains live; an idle Fleet read previously removed its exclusive lease. Original three regressions reproduced the failure. Root cause is a missing live-confirm check on the idle read path, distinct from dispatch/cancel. The new cases protect ownership while preserving genuine-idle release after confirmation ends.

Fresh commit CI and exact merged main SHA CI are still required before reporting landed/green. This component does not validate #626 or real enterprise acceptance.
