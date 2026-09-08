## Independent DESIGN review — #481

Review of supplied `DESIGN.md`, `docs/superpowers/plans/2026-09-08-workspace-projects-ux.md`, and `docs/audit/2026-09-08-workspace-ux-audit.md`. Design approval only. No implementation, CI, or installed-app claim.

### Scope fence (current vs future)

The plan §1 table is the right contract: #482 voice feedback, #483 session/thread ownership, summoner manual `user_tags`/`topic_folder`, conversation-first nav. Project store, activity center, merged code/terminal, native #476 management, and audit leftovers are explicitly not this batch.

Do **not** treat root `DESIGN.md` as a license to ship `项目` chrome. It is labeled “source of truth” for current UI while still embedding the future Project → Conversation → Execution tree in the same IA section. That is the main implementer-confusion risk. The plan is stricter and should win: no empty Project entry, no `topic_folder` rename, no implicit directory inheritance, no auto-migration.

Project-as-optional durable context (not a renamed folder, not a permission, conversations may stay outside) is a sound answer to “is a Project level better?” Keep it as a subsequent Issue. Do not implement from this revision.

### Ownership

Coding ownership is specified well enough to implement: facts are start `session_id` + `thread_id`, not the visible thread; selectors must be shared; A must not occupy B’s FocusBand or auto-open B’s panel; stop/diff/continue must use the real session; late/sparse events must not borrow another session; hiding must not cancel the process; disconnect ≠ complete.

Voice ownership is almost there (freeze draft target; do not write into a new thread; late final ≠ new draft) but does not say what the visible mic does on switch/hide.

### ACL (metadata-only)

This is an ACL change. The write-up is honest and bounded:

- existing `thread.update` only
- overlay allowlist: `alias` / `user_tags` / `topic_folder`
- shared HTTP/WS validator
- unknown fields, including `alias`+`config`, reject the whole patch
- unsubmitted fields unchanged (especially alias)
- success = persisted identity + submitted fields, not transport ACK
- `workspace_root`, trust/config, MCP, terminal, install/import, approval stay denied

That is a T3 focus, not an unchanged-policy claim. Safe **if** those three fields remain labels and the gate rejects rather than strips.

### Navigation

Conversation-first order on both surfaces, “浏览器标签页” vs “标签 / 分组”, ThreadList remaining the management owner, summoner projecting the same store, AI grouping not rewriting manual grouping, and no fake edit on read-only resource lists are the right repairs for the audit P2 nav/term bugs.

---

### Findings

**N1. Fence future Project out of the current contract.**  
Move Project IA / §5 to an appendix or “not this delivery.” Root DESIGN.md currently reads as the live chrome spec and also describes `项目` and “代码与终端.” One conflict rule: visual/IA → root `DESIGN.md`; capability/trust → `docs/DESIGN.md`; current vs future → plan §1.

**N2. ACL must state label semantics, not only field names.**  
`topic_folder` / `user_tags` are grouping labels, never cwd, never `workspace_root`, never allow-dir. Overlay `thread.update` containing those plus any path/config/trust field is a whole-packet reject. Validator: NFC, controls, length/count, empty-vs-omit (submitted empty ungroups; omitted leaves unchanged). Do not last-write-win-wipe the other surface’s unsubmitted fields.

**N3. Voice on thread switch/hide.**  
Specify one behavior: cancel capture and keep the draft on the origin thread, or keep bound-to-origin and hidden. B’s mic must not show A’s listening/processing. Meeting mutex, privacy card, and resource cleanup stay.

**N4. Reconcile “stop remains reachable” with scoped FocusBand.**  
Until a global activity center exists, stop/continue/diff for a run exist only on the owning conversation. Switching away must not plant A’s controller on B, and must not drop A’s stop on return. Pending confirmation/FocusBand priority is unchanged; cockpit DOM/handlers stay out of this batch.

**N5. Summoner group picker source.**  
Existing `topic_folder` values come from the same thread store ThreadList uses, not a summoner-local list. New name allowed; blank removes. Do not claim AI extract / 整理 / 图谱 on summoner.

**N6. Two settings hosts this batch.**  
Extension named dialog vs companion settings window remain two hosts. Do not imply one settings chrome or close English leftover / category-copy work. Errors still point at current labels (“输入与语音”), not stale “听写” paths.

**N7. Acceptance must stay split.**  
#482/#483 owning tests (A→B→A, interleaved/sparse events, wrong-thread receipt, prepare/fail/cancel/late STT). Metadata negative cases on HTTP and WS. Synthetic 320/390/759/760/1040/1440 and 360×420. Not claimed: installed STT latency, Windows native visuals, #476 privileges, Project schema. Design pass ≠ implementation pass ≠ install pass.

---

No blocking hole: current delivery is not a Project launch, not a global task bar, and not a silent ACL widen. The nits are contract tightening so implementation cannot “helpfully” ship 项目, path-like folders, or A’s controller on B.

VERDICT: APPROVE_WITH_NITS
