# #758 independent adversarial review — cycle 3

Reviewer: independent non-author Codex agent `/root/platform_adversary_758`; 2026-10-22. Final bounded incremental review of the existing CI workflow consumer repair. Full cycle-1 source review and cycle-2 packaging approval remain applicable. Base `57b808651dccede3555ac64ebbd45aead393ab73`; frozen full staged delta `/tmp/cmspark-758-review-r3.diff`, independently verified SHA-256 `d83e4ed54962359eccea7005b0728b55c662a03713ec96a3a40dc8440b75179f`.

## Reviewed scope and preservation

Independently compared the per-file sections of the frozen R2 and R3 diffs. Only the machine report/JSON and these three test-contract files differ: `scripts/tests/activity-platform-758-workflow.json`, `scripts/tests/windows-ci-feedback-750-contract.mjs`, and `scripts/tests/windows-ci-feedback-750.test.mjs`. Production and CI workflow bytes are unchanged. The previous Pi invocation was stopped before any verdict; this report does not reuse it.

The new fixture records the actual parsed workflow's Linux native job, Windows activity step and augmented package-check build step. Its canonical object digest is pinned. The contract deeply compares each complete new object before normalization. In particular, it checks the single Windows step's exact lane, command, environment and failure attributes, requires it immediately after shared compilation, and removes only that checked object from the legacy view. The new Linux job is admitted as an exact full object, not a name-only wildcard. The build step is fully checked, then only its one exact newly added command is removed before comparison to the historical baseline.

Original baseline files/digests, old step cardinality/order, failure and cancellation conditions, native/census isolation, permissions, artifact attributes and existing mutation controls remain intact. Unknown job/step/body changes still fail full comparisons. Eight new mutation controls cover omitted/misplaced/waived activity native execution, wrong desktop lane, missing/modified/waived Linux job, and removal of the actual bundle resource test. This updates a real consumer for the reviewed addition; it does not weaken a historical gate or reclassify its initial RED as an environment failure.

## Independent checks

Node22.23.2, clean environment, actual complete affected command:

```bash
node --test scripts/tests/nsis-ci-setup.test.mjs scripts/tests/windows-ci-feedback-750.test.mjs
git diff --cached --check
```

Result: **87 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0; diff check exit 0. Retained independent log: `/tmp/cmspark-758-adversary-r3-consumers.log`. LF and CRLF genuine-source positives and the complete original-plus-new mutation families execute through the actual parsed-YAML contract. No workflow command, desktop capture, notification or model was executed by this test family.

## Outcome / trajectory / component

- **Outcome:** the unchanged reviewed workflow now satisfies its real existing preflight consumer while retaining rejection of unreviewed changes. No source blocker or actionable nit remains in this bounded increment.
- **Trajectory:** the author preserved and attributed the previously missed consumer's RED, stopped incomplete Pi, and repaired only the fixture/contract plus eight relevant negatives. This is cycle 3 of the maximum 3; no further model or unrelated review requirement is introduced.
- **Component:** complete workflow objects are validated before precise normalization, and historical pins remain unchanged. Previous capture/import/resource-closure findings and approvals are reused for byte-identical source.

T3 capability and the earlier platform limitations are unchanged. Proceed to a fresh Pi review reading all three full adversary reports and this same frozen source, then exact-head CI. **Windows native DoD remains pending hosted execution**, and this preflight pass does not prove runtime Windows capture/WinRT/SEA, actual compositor locks, real chat accuracy or visible notification delivery. No merge-ready claim is authorized by this report alone.

VERDICT: APPROVE
