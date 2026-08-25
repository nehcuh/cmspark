All verification complete. `ChatView` (and thus `KnowledgeImportModal`) is always mounted in the App shell, so the distill/import flow works from any panel.

---

# Wave 2 review — knowledge-related / distill confirm-import / 话题夹 / overlay slim

**Scope note**: the review-artifact patch (`knowledge-honesty-wave2-diff-20260825-132009.patch`) is **stale** relative to the live working tree — `companion/src/threads/distill.ts` now carries the full `-----BEGIN …-----END` PEM-block regex, `distill.test.ts` asserts PEM **body** removal + redact-before-clip, `message-router.ts` clamps `limit`, `agentStore.tsx` payload-merge uses `hasOwnProperty`, ThreadList uses 「列表内相关」+ empty-state hint, and summoner CSS dropped `.chip`. All drift is *improvements* folding the adversary's residuals. I reviewed the **live tree**.

**Machine (live)**: `companion npm test` → **3541 pass + 20 settings-web, 0 fail** (claim 3539 was slightly low, exit 0). `chrome-extension tsc --noEmit` (forced full, non-incremental, cache cleared) → **clean**. Targeted suites (distill / knowledge-related / doc-identity, 15 tests) pass.

## DoD — all met
1. **Related ≤3 query-time**: `knowledge-related.ts:78-80` hard-caps at `KNOWLEDGE_RELATED_LIMIT=3`; router clamps; test "caps at 3 even when limit is huge" (limit 99 → 3) is non-vacuous. No edge store, no persist.
2. **Distill redacts, never auto-writes**: live `SENSITIVE_BODY_RE` eats full PEM blocks (verified: `-----BEGIN RSA PRIVATE KEY-----` + base64 body → single `[REDACTED]`, hits 1, body gone); `thread.distill_preview` handler (`message-router.ts:2056`) only returns markdown; test locks knowledge-dir file count unchanged.
3. **话题夹 = string, not Project**: `thread-manager.ts:792` `sanitizeTopicFolder` strips control chars + `\` + `/`, caps 40; router allowlist includes `topic_folder`; UI nouns 夹/话题/未分组.
4. **Overlay C-thin**: `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:18-33`) and `summoner-acl.ts` `SUMMONER_ALLOW` have zero `knowledge.*` / `thread.distill_preview` / `knowledge.import` — live-verified + test-locked; copy = 召唤器（实验）/去侧栏处理/快捷提问 · 批准在侧栏, no Allow/Deny.
5. **Launcher-plugins doc**: `docs/summoner-launcher-plugins.md` is distribution-only; explicitly forbids storing `ws_secret`, forbids confirm/Allow/Deny and knowledge/Skill/MCP forms in plugins.

## R-gates — all clear
- **R1**: tests are real and non-vacuous (verified the PEM assertion genuinely fails against body, related cap with limit 99, knowledge-dir unchanged).
- **R2**: overlay ACL not grown (both dispatch + WS ACLs).
- **R3**: distill has no write path; import only fires from the confirm modal click (`ChatView.tsx:631` spread-payload-first + `user_gesture: true`).
- **R4**: no Project/graph DB/taxonomy/1-hop edges — `topic_folder` is a plain string.
- **R5**: no Trust elevation; no companion `sidePanel.open`.
- **R6**: 图谱/双链 purged (ThreadGraphApp + ThreadList → 相关会话/会话关系图/列表内相关); Raycast/uTools only as distribution doc; summoner body test asserts absence of all banned nouns.

## ADR-020 checklist
Declaration present in the implementer prompt (Surface L0 / Compose knowledge + `thread.topic_folder` / Trust no-elevation / Channel unchanged / Autonomy n/a / L2 none). Axes fit — hangs on Compose (knowledge) + L0 Surface (chips/modal), no "中层 Agent"; no new runtime; no new confirm family (reuses the Wave 0b confirm-import modal); trust monotonicity preserved; no `securityConfirmations.request` → no originWs concern; no new primary panel chrome.

## Nits (non-blocking)
1. **Stale review artifact**: `knowledge-honesty-wave2-diff-20260825-132009.patch` predates live fixes (PEM regex, tests, limit clamp, payload merge, noun refinements) — regenerate before archiving.
2. **`user_gesture` is UI-only**: `knowledge.import` handler (`message-router.ts:2646`) never checks it; any authenticated local WS caller can import without a gesture. Spec §5 explicitly parks server-side enforcement ("本 Wave 不强制 400") — documented, not a regression.
3. **PEM tail edge**: `[\s\S]{0,4000}?` between BEGIN/END — a PEM body longer than ~4 KB falls back to BEGIN-line-only redaction, leaving the tail visible. Typical RSA/OpenSSH/EC keys (~1.7 KB) are covered; only pathological cases leak.
4. Pre-existing (flagged at Wave 0b+1 r3): chip click dispatches `cmspark:open-knowledge` with **no listener** anywhere (dead interaction).
5. `loadKnowledgePayload` file branch has no server-side size cap (UI caps 6 MB pre-base64; direct WS callers unbounded) — same shape as pre-existing `knowledge.import`.
6. Error heuristic `/knowledge|预览|parseFile|fetch knowledge/i` (`useWebSocket.ts:1851`) can surface unrelated errors into the preview modal.
7. File import parses twice (preview + confirm) — shared parser, minor inefficiency.

VERDICT: APPROVE_WITH_NITS
