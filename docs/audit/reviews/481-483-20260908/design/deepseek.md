## Design Review — #481

**Verdict: APPROVE_WITH_NITS**

The design package is unusually disciplined: it cleanly separates current-scope repair from future Project-entity work, names ownership for every surface involved, and candidly documents what is not delivered. The core decisions are sound:

- **Session/thread scoping as the root fix for code-controller staleness** is the right causal model, and the plan correctly demands event routing by `session_id`/`thread_id`, not selected view.
- **Manual tags/groups over existing metadata** with a narrow ACL expansion to `alias/user_tags/topic_folder` is the minimal, honest path. You explicitly flag it as a real ACL change, with whole-patch rejection and no silent field stripping — exactly right.
- **Project as a durable optional entity, not renamed `topic_folder`**, with directory binding explicitly excluded from authorization, is the correct trust boundary. The §5.2 separation of suggested directory from permission grant is the strongest part of the proposal.
- **Voice feedback as distinct states** (preparing/listening/processing/failure) with partial-vs-final recognition and cross-thread draft pinning addresses the reported symptom without over-promising latency.
- **Navigation order and terminology** (对话优先, 浏览器标签页 vs 标签, no “项目” until a real model) is coherent across both surfaces.
- **Acceptance criteria** are testable and correctly scoped: they measure owning behavior, not static strings; they separately list what machine checks, dual-model review, and real-device evidence can and cannot prove.

**Nits (non-blocking, require only wording or minor hardening):**

1. **§5.5 acceptance includes behavior beyond any implementation Issue** — “无 Codex/外部 Agent/浏览器时非网页工作仍可开展” is a product-level requirement dependent on #476 native work. As written under “项目验收（后续）,” it could be quoted as claimed later. Recommend trimming to project-aware acceptance or explicitly re-anchoring it to the #476 gate.

2. **Fork semantics in §5.3 are stated as a confirmed default today** — “Fork 默认保留来源项目并沿用既有目录复制语义” reads as accepted behavior even though Project itself is proposal-only. Mark it clearly as a proposal default that must be frozen in the implementation Issue, or it will leak as a commitment.

3. **Voice measurement lacks a defined failure threshold** — “区分固定等待窗与计算耗时” and “冷热启动” are listed, but no criterion says what result qualifies as “resolved” for the user’s complaint. A one-line acceptance statement (e.g., “cold start under Xms on reference device, recorded before/after”) would prevent circular closure.

4. **`thread.update` ACL expansion and `message-router.ts:2984` overlap should be confirmed not to confuse validators** — the design says the overlay shares the HTTP/WS metadata-patch validator, while the audit notes a broader generic update path already accepts `user_tags/topic_folder`. Reviewers will ask which code path the overlay actually reaches; a sentence in Implementation Constraints stating the overlay cannot bypass into the generic path would preempt the obvious question.

5. **Old `Settings → 听写` references** — the content-voice rule correctly bans them, but the audit still notes `MeetingPanel.tsx:1271` and `summoner-web.ts:1538` contain stale/hidden paths. Even though fixing them is future work, the design should list them as current-scope dead-path removals or explicitly defer them; otherwise the contract forbids something the audit says still exists.

None of these changes the ownership model, the trust boundary, or the scoping discipline. The design is ready for T3 review of the ACL change and implementation planning.