All required reading done and grounding code verified. Here's my independent review.

---

## Pi review — `settings-thread-compact`

### Code spot-checks (claims vs reality)

| Claim in SoT | Code check | Result |
|---|---|---|
| S2: 今天/昨天 not collapsible (chevron hardcoded) | `ThreadList.tsx` `renderTimeline`: today/yesterday headers have no `onClick`, chevron hardcoded `▼`; months/days have toggles | ✅ accurate |
| S3: silent head-drop `JSON.length > cw*3`, no UI | `adapter.ts:437` `while (JSON.stringify(messages).length > params.config.context_window * 3 && messages.length > 2)` — no notice, no audit | ✅ accurate |
| Default `context_window` = 1e6 | `config.ts:267` | ✅ accurate |
| Shared `estimateTokens` single module | `summary-export.ts` `estimateTokens` (CJK 1.5 / latin 4-char heuristic); `digest.ts` imports it; no duplicate | ✅ (SoT allows re-export from summary-export — no `token-estimate.ts` needed) |
| Armed set F-S3 complete | `autopilot-tier.ts`: all tiers derived **only** from the 3 flags + `unattended.armed`; no hidden armed state exists | ✅ set is exhaustive |
| R4 gap exists today | `SettingsSlideout.tsx` L122: "Auto-expand advanced gates… **(user can still collapse)**" — this is exactly what D-S3 force-open > LS fixes; header already has red "有开关已开" hint + `运行自主度` chip | ✅ gap correctly identified |
| Unified LS + migration | `thread-timeline.ts` already implements `cmspark.threadList.expand` `{months,today,yesterday}`, legacy `expandMonths` array migration, `DEFAULT today:true / yesterday:false`, search force-open | ✅ W0 is wiring, not invention |
| Secrets first-class | `UserEnvSection` already independent of bottom Save in current code | ✅ |

### Must-answer questions

1. **Floors F-UX1–7, F-S1–8, F-I1–6, F-C1–7 absorbed?** Yes — all 28 map 1:1 to SoT decisions (D-S1–8, D-T1–5, D-C1–12, §5 M1, §6 schema, §7 waves). No floor is only referenced; each has a concrete decision or contract. Verified armed set against real code (F-S3), single-estimate (F-I1/F-C7), schema-vs-W1 sequencing (D-S7), pre-loop only (F-I6 → D-C11).

2. **Yesterday-default-collapse + unified LS safe vs existing ThreadList?** Yes. The util already handles legacy `expandMonths` (bare `string[]`) → `months`; today/yesterday defaults are explicit; search force-open covers months too. W0 acceptance (fold persists on refresh, checkbox `stopPropagation`, search expand) is consistent with the existing month/day interaction pattern. Only note: the wired ThreadList must write the **new** key after migrating, and prefer new key over legacy if both exist — an implementation detail, not a spec gap.

3. **M1 closed enough?** Substantially yes — reserve formula, build-tools-before-compact ordering (F-I2), serializeMessage shape, drop loop invariant (never last user turn / never break tool pairs), omit placement after leading systems, sticky rule, modes, audit schema are all concrete. Three spec-hygiene gaps (nits, below): default mode unpinned, `canDrop` undefined, and the sticky clause is vacuous given insert-after-loop ordering.

4. **Dual-truth + omit wire: residual REJECT-level hole?** No. D-C5 pairs the durable chip with the behavior change in the same slice (F-UX5); mode `auto` requires the chip path; `off` removes the legacy silent loop entirely. R2/R3/R5 gates pass. One real wire risk (nit): the omit notice as a standalone `role:user` immediately before the original first user message creates **consecutive user turns**, and `anthropic-convert.ts` does **not** merge consecutive users today — Anthropic can 400. F-I4's dual-provider test mandate is the right call, but the recipe should say "merge omit text into the adjacent user turn on the Anthropic path" rather than leave it to discovery in tests.

5. **Can armed Trust still be hidden?** No — D-S3 force-expand beats LS, collapsed header keeps the armed badge (F-S2), and the StatusRail/SafetyStrip chips are an independent second line. Current code's "user can still collapse" behavior is precisely the R4 defect being closed.

6. **ADR-020 / three-summary smuggling?** None. Glossary §2 + D-C9 + the History IA B.1 diff's orthogonality line keep Digest / Export / Runtime budget separate; M2 `rolling_summary` lives under `runtime_context_budget` meta (not messages, default off). Capability declaration is complete and honest (Compose none, Autonomy n/a, no elevation).

### Rejection gates
All six pass (R1–R6). No silent ship (R2), no persisted omit (R3), no buried armed trust (R4), no merged summary systems (R5), no false 1e6 auto-compress claim (R6 — D-C10 honesty copy present).

### Nits (non-blocking)
1. **M1 default mode unpinned** — `llm.context_compaction` lists `auto|prompt|off` (D-C6) but no default. Synthesis said "default `prompt` pre-chip, or `auto` shipped with chip". W2 acceptance should pin this (else implementer choice re-opens R6/R2 tension).
2. **Omit wire consecutive-user turns** — specify Anthropic-path merge (see #4 above).
3. **"sticky: re-insert if loop would drop it" is vacuous** — omit is inserted *after* the drop loop (steps 5→6), so the loop can never drop it. Either insert before the loop with an exclusion, or drop the clause.
4. **`canDrop` undefined** — the loop-termination condition (system + omit + last-user-turn remain) should be stated formally to satisfy F-I2 "闭合".
5. **§4.1 tree omits two existing sections** — 安全技能 (SAFETY_SKILLS) and 安全审计日志 have no explicit node in the new accordion tree (信任域/自动批准域 are listed). W1 needs an unambiguous mapping so nothing gets stranded.
6. **F-UX7 deep-link mechanism unelaborated** — D-S6 references the contract but no trigger components / section-expansion protocol is specified. Binding floor exists, so acceptable, but W1 will have to invent the plumbing.

**Floors fully in SoT: yes.** W0 may proceed.

VERDICT: APPROVE_WITH_NITS
