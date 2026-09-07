I'll read only the specified review materials and follow those independent correction-review instructions.Independent correction review of the prior checkpoint report against this frozen packet only. Machine results in the packet are taken as stated, not re-executed.

**Prior verdict.** The earlier `PASS WITH NON-BLOCKING FINDINGS` over-weighted design honesty as defects. After the granted disposition and the code in this packet, none of those items remain a blocker/P1/MAJOR.

**Close / retain**

1. **Jobs do not freeze derived artefacts — CLOSE.** `create` still persists `input` + digests and `view`/`snapshot` re-read live observations/drafts. That is the granted contract: no cached source bypass; observations immutable; missing/corrupt sources fail closed (`CODE_DIFF_CITATION_INVALID` / draft read errors). `DraftRepository.update` always increments `revision` and there is no delete API, so the “same-revision field edit” premise is false. Unreadable jobs after a missing citation are intentional, not a freeze hole.

2. **Corrupt vs invalid — CLOSE.** `load` uses `safeParse`; shape/digest/id/schema failures are `CODE_REVIEW_CORRUPT` or `CODE_REVIEW_SCHEMA_UNSUPPORTED`, matching the disposition. Create-time Zod failures remain client-invalid, which is correct. `boundRequest` on input/receipt/assessment at create and reload enforces the 64KiB cap.

3. **Executor strip vs `.strict()` — CLOSE.** Strip is exactly Chat-injected `__thread_id`/`tabId`; extra model keys fail closed. Chat scope is constructor-enforced (`CODE_REVIEW_CHAT_SCOPE_REQUIRED`); outbound MCP cannot obtain it. Executor itself is out of packet and out of this material gate.

4. **Material commit split-brain — CLOSE as P1.** `MATERIAL_COMMIT_MISMATCH` now requires `typeof commit === "string" && commit !== review.head`. Missing/non-string raw commit is unverified only. `change_material.v1` still always adds `RELEASE_REPOSITORY_NOT_VERIFIED`: fail-closed honesty, not a false mismatch. Residual: an unsupported **empty string** can still dual-tag UNVERIFIED + MISMATCH (NIT).

5. **`receive`/`assess` vs Agent-only, confirmation, PTY/handback/MCP — CLOSE as findings against this checkpoint.** Packet scope is material/store. `receive`/`previewReport` are service-only and absent from `CODE_REVIEW_TOOL_DEFINITIONS`. `assess` is labeled `cmspark_assessment`; receipts are `user_confirmed_external_assessment`. `review_ready` is never true. Terminal/UI/PTY/handback remain other gates’ dependency claims, not open majors here.

6. **Capacity ordering — CLOSE as defect.** Capacity is checked after idempotent `request_id` replay and before `snapshot`. A full store cannot create anyway; a bad citation on a new 17th job is moot. Error priority, not a bypass.

**Remaining NITs (non-blocking).** Model JSON still omits some server caps (`materials.draft_id` min/max, `review_id` uuid, `base !== head` refine). Server still fail-closes. Empty-string commit can emit both unverified and mismatch.

No path in this packet sets `review_ready` true, conflates CMspark `assess` with an external receipt, exposes `receive` as a model tool, or writes a prompt to a PTY.

**VERDICT: APPROVE_WITH_NITS**
