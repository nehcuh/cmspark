## Verification Summary

### G1 — Downloads probe / local file detect ✅
- **G1.1**: Static import confirmed at `browser-bridge.ts:14` (not dynamic `import()`)
- **G1.2**: `browser-download-handler.ts` uses static imports from `downloads-find`
- **G1.3**: Structured `error_code` + `user_hint_zh` in both `browser-bridge.ts:1268-1274` and `downloads-find.ts:228-232`
- **G1.4**: Tests pass `[executed]` — chrome-extension tests all green, including ambiguous match assertions
- **G1.5**: skill_install not touched in diff

### G2 — ELEMENT_AMBIGUOUS UX ✅
- **G2.1**: `user_hint_zh` explains multi-match (`browser-download-handler.ts:174-177`)
- **G2.2**: `matches` array included in error payload (line 173)
- **G2.3**: ChatView already surfaces `user_hint_zh` (existing code, unchanged)
- **G2.4**: Unit tests updated with `user_hint_zh` and `matches` assertions
- **G2.5**: Fail-closed — no auto-click, explicitly states "防止点错" (line 175)

### G3 — Thread titles / history list ✅
- **G3.1**: `provisionalTitleFromUserText` (`adapter.ts:1119-1128`) + `ensureProvisionalThreadTitle` (`1134-1149`) called in `chatCreate:277`
- **G3.2**: `generateThreadTitle` upgrades provisional via `hasOnlyProvisional` logic (`1163-1173`)
- **G3.3**: ThreadList fallback `未命名 · {short id}` (`ThreadList.tsx:133-135`)
- **G3.4**: Failures logged with `logger.warn("thread.title_generate_failed")` (`1224-1227`)
- **G3.5**: Provisional title tests exist and pass (3/3 tests)

### ADR-020 Capability ✅
- Surface: L1 browser (no regression)
- Composition: none added
- Autonomy: none added
- Trust: No weaker semantics introduced; no confirm-skip
- Channel: community

### Nits (non-blocking)
- Code not yet committed — expected for final gate review

VERDICT: APPROVE
