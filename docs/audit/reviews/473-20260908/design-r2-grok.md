I'll read the review packet first and follow only the instructions in that file.Independent design review for #473 (对话管理可发现性). Review of the written design only.

## Fit to intent
The design matches the asked product: narrow-only persistent `+` → `createBlankThread`; one ThreadList; management/AI extract/规则整理/关系图/回收站 as first-class panel actions; manual `user_tags` + 1:1 `topic_folder`; AI grouping as a named derived view from existing digest extract; no new clusterer; no `topic_folder` writes from AI; no new default background jobs; no live-data tests; no pack/换装.

## P0
None. No security-field write path, no dual thread cache, no ACK-as-save, no AI→manual folder confusion if implemented as written.

## P1 / MAJOR (must pin before code)
1. **Save success correlation.** “收到已持久化的 `thread.updated`” can be read as any broadcast update (e.g. in-flight AI extract). Transport already echoes envelope id on response and errors. Success must be the **matching reply** to that save’s envelope whose payload is persisted `thread.updated`. Transport ACK is not success. Unmatched `thread.updated` is not success. Timeout/error keeps the draft. Concurrent extract must not flip the editor to success or wipe unsaved `user_tags`/`topic_folder`.

2. **AI group key.** “`digest.tags` 的首个主题标签” is order-dependent unless `digest.tags` is already a stable, topic-only list. Pin: grouping key = first remaining AI tag after existing digest normalization; empty →「待 AI 整理」; one thread → one AI group; human `user_tags` never contribute; re-extract may move the AI group; never writes `topic_folder`.

3. **320 / short header.** `+`, shrinkable title, visible「对话管理」, and 风险/停止 share one bar. State flex priority: 停止/风险 never shrink or cover; `+` stays hittable; title ellipsizes first;「对话管理」may go icon+text→icon but must remain the narrow-screen management entry (left「管理」is wide-only). Visible name and accessible name must include「对话管理」(WCAG Label in Name). Keep a **second** old history name as test alias, not as the only accessible name.

## Nits (not blocking)
- Inherit existing `topic_folder` length/charset/empty rules for the new form; `user_tags` 20×40, strip controls, collapse whitespace, dedupe is enough.
- Form whitelist `user_tags` + `topic_folder` only; digest replace must preserve `user_tags` (stated).
- 「整理助手」copy must stay 规则扫描, never “AI 智能分组”.
- Tag search/filter unions both tag sets and dedupes; row chips should still show source so AI vs 人工 is not indistinguishable in the time/tag views.
- Batch move / global tag rename / deleting AI tags correctly out of v1; re-extract is the escape hatch.
- Illegal-input tests on companion; UI widths 320/390/759/760/1440 + 320 short on fixtures, not `~/.cmspark-agent` user threads.

## What is already right
Single panel via dedicated UI event; 更多 keeps 起名/清理; AI extract cap 20 + existing progress; background extract stays behind current config/quota; Grok+DeepSeek review and CI-green merge, no 换装.

VERDICT: APPROVE_WITH_NITS
