# Dual external review: Knowledge Honesty Wave 2

**Batch:** `knowledge-honesty-wave2`  
**Stage:** implementation on `feat/knowledge-honesty-wave0` after Wave 0b+1 r3 both AWN `114735`  
**Blast:** T2 Compose / L0 Surface

```text
Surface:      L0 knowledge related chips (≤3) + distill confirm-import + 话题夹 grouping + overlay copy
L2-classes:   (none)
Compose:      knowledge (query-time related) ; thread.topic_folder string ; distill → existing import modal
Autonomy:     n/a
Trust:        distill never auto-writes; overlay ACL must not grow (no knowledge.* / thread.distill_preview)
Channel:      unchanged
```

## Read (Wave 2 SoT)

- Spec §5 Wave 2: `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md`
- `companion/src/skills/knowledge-related.ts` — query-time co-tag + TF, hard cap 3, no persist
- `companion/src/threads/distill.ts` — `redactSecrets` / `distillThreadMarkdown` / `sanitizeTopicFolder`
- `companion/src/message-router.ts` — `knowledge.related`, `thread.distill_preview`, `thread.update` allowlist `topic_folder`
- `companion/src/ws/validate.ts` — new types registered
- `companion/src/threads/thread-manager.ts` — `topic_folder` sanitize on update
- `companion/src/summoner-web.ts` — copy slim; ACL must still have **no** `knowledge.*` / `thread.distill_preview`
- `docs/summoner-launcher-plugins.md` — Raycast/uTools as hotkey distribution, not a remake
- UI: `KnowledgeSubPanel.tsx` 相关; `ThreadList.tsx` 知识/夹/话题 view; `ChatView.tsx` confirm modal; `useWebSocket.ts` distill → `SET_KNOWLEDGE_PREVIEW`; `background/index.ts` relays

## Machine (this session)

- `cd companion && npm test` → **3539 pass + 20 settings-web, 0 fail** (exit 0)

## DoD

1. Related ≤3, query-time only, no graph DB / no persisted edges.  
2. Distill preview redacts body secrets (`ghp_`, PEM, `sk-`…); knowledge dir unchanged until confirm-import `user_gesture`.  
3. 话题夹 = `Thread.topic_folder` string (sanitized, path chars stripped); UI nouns 话题/夹 — **not** Project.  
4. Overlay still C-thin: 「召唤器（实验）」「去侧栏处理」; no Allow/Deny; summoner allowlist does **not** add `knowledge.related` / `thread.distill_preview` / `knowledge.import`.  
5. Raycast/uTools doc is distribution only; no plugin that stores `ws_secret`.

## REJECT if

R1 false tests / tests that cannot fail  
R2 overlay ACL growth (`knowledge.*` or `thread.distill_preview` on summoner dispatch/WS ACL)  
R3 distill auto-writes knowledge without confirm  
R4 Project / graph DB / taxonomy / 1-hop persisted edges smuggled  
R5 Trust elevation or companion pretending to `sidePanel.open`  
R6 UI uses banned nouns: Project/项目(容器义)、图谱/双链、Raycast/uTools/启动器 as product name

Inspect real code/diff. VERDICT line required:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
