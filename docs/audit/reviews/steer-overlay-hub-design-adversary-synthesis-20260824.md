# Design adversary synthesis — steer/overlay hub

**Date**: 2026-08-24  
**Lanes**: security REJECT · product REJECT · correctness REJECT  
**Author action**: fold BLOCKs into spec r2; do **not** reverse user-locked busy-Enter=steer.

## Absorbed (now in spec r2)

| Lane | BLOCK | Fold |
|------|-------|------|
| S1 | allowTrust from user_gesture | `allowTrust = surface !== "summoner"` |
| S2 | S46 cookie orphan | refuse overlay apply if trust snapshot present |
| S3 | eligible only UI gray | server `isOverlayEligiblePack` |
| S4 | workspace_path passthrough | strip + deny extras |
| C1 | occupied create supersedes | `run_active` reject, no abort |
| C2 | three busy SoTs | abortControllers + run_status on summoner select + no idle before drain |
| C3 | overlay always sendChatCreate | router mapping + submit.enqueue |
| C4 | submit claimLease | no steal; OVERLAY_STANDBY |
| C5 | panel composer disabled | unlock textarea when busy |
| C6 | pack whitelist live | no whitelist mutate while loop running |
| P-layout | 200pt kills 420pt window | default width ≥ 640 |
| P-copy | MCP「管理」、会议工作台 | 已连接 / composition-only copy |

## Not absorbed

Product: busy send-chord should be enqueue or keep field locked. **User grill locked steer.** Dissent on file. Mitigation: labeled 纠偏 button + unlock field + server reject supersede.

## Residual nits

- file.upload/regenerate still supersede (explicit out of PR1)
- Windows overlay hub absent (honest)
- meeting workbench not opened by apply

VERDICT of synthesis: spec r2 ready for Pi/Kimi/Claude; implement only after APPROVE*.
