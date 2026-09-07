I'll read only the specified materials file and follow its independent-review instructions.The materials file is long; I'll continue from where it left off so the review covers every checkpoint.Independent gate review of the #466/#467 checkpoint against the stated contracts. Source-only; tests and builds were not re-run.

**Outcome.** Chat-scoped jobs persist an immutable create payload (canonical HTTP(S) repo, SHA pair, optional NFC/LF `get_page_text` citation, locked material revisions, business refs). The adapter always returns `review_ready: false`, `untrusted: true`, coverage `unknown`/`partial`, plus host/web gaps. CMspark `assess` and confirmed `receive` are separate origins. Render is inert Markdown/JSON, not approval.

**Trajectory.** `boundRequest` → strict Zod → `snapshot` (live observations/drafts) → atomic `code-review-v1/<scopeHash>.json` (16 jobs / 2MiB / 0o600). Idempotent `request_id`. Model tools: create/read/assess/render. `receive`/`previewReport` are service-only.

**Components.** `contract`, `service`, `material`, `executor`, tool JSON, tests. Line/identity/`canonicalRequest`/parser/PTY/WS/handback/MCP/Chat injection are imported or out of packet; judged only at this boundary.

**Defects**

1. **Jobs do not freeze derived artefacts.** `create` stores input + digests only; `view`/`snapshot` re-slice observations and re-read drafts. Missing observation makes `read` throw `CODE_DIFF_CITATION_INVALID` rather than return stored lines. Same-revision field edits would change material context. Relies entirely on EvidenceStore/draft immutability, not this store.

2. **Corrupt vs invalid.** Digest/id/schema checks throw `CODE_REVIEW_CORRUPT` / `SCHEMA_UNSUPPORTED`. Zod `fileSchema.parse` failures become `INVALID_CODE_REVIEW_REQUEST_OR_STORE`. Fail-closed, but a truncated/hand-edited file can look like a bad client request. Transform `INVALID_REPOSITORY_URL` is similarly swallowed if Zod wraps it.

3. **Executor strip vs `.strict()`.** Only `__thread_id` and `tabId` are peeled. Any other Chat-injected key fails the tool. Safe if those two are the only injections; brittle otherwise. MCP is denied only via `scope.kind === "chat"` at this entry.

4. **Material commit check is split-brained.** `draft.fields[commitKey].state` vs raw `draft.draft.fields[commitKey].value !== review.head`. Empty raw value always adds `MATERIAL_COMMIT_MISMATCH` even when the evaluated field is merely unsupported. `change_material.v1` always gets `RELEASE_REPOSITORY_NOT_VERIFIED`.

5. **`receive`/`assess` vs Agent-only and confirmation are under-proved here.** Web receive retries, line/hash/context mismatches, plan-mode create/assess denial, and XSS escape are tested. Not in this packet: Agent-only findings against `files: []`, reverse check that receive is absent from `COMPANION_TOOLS`, live owner/thread confirmation, `originWs.readyState`, disconnect-kills-PTY, handback `messageid` + `ADD_MESSAGE` dedup, prompt never written to PTY. Those remain dependency claims.

6. **Capacity ordering.** Full 16 jobs + a bad citation throws `CODE_REVIEW_CAPACITY`, not the citation error.

No path in this source sets `review_ready` true, conflates CMspark assessment with an external receipt, sends a prompt into a PTY, or exposes `receive` as a model tool.

**VERDICT: PASS WITH NON-BLOCKING FINDINGS** — web/Chat slice matches the honesty and origin contracts; do not treat PTY/handback/MCP caller or `checkReport` internals as verified by this packet.
