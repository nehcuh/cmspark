## Verification summary

Verified against current repo state (HEAD `5a401f1`, plan untracked as expected for pre-code gate):

| Claim | Status |
|-------|--------|
| `thread.update` WS allowlist `message-router.ts:1617-1628` still lacks `active_knowledge_ids` | ✓ confirmed (keys: alias/config_override/tool_whitelist/pinned_tabs/active_skill_ids/skill_selection_mode/knowledge_selection_mode/mcp_selection_mode/active_mcp_server_ids/digest) |
| `KnowledgeSubPanel.tsx:484` sends `thread.update` with `active_knowledge_ids` | ✓ confirmed — orphan root cause real |
| `installAssetsFromValidated` at `pack-engine.ts:642`, call sites `:1106`/`:1117`/`:1424` (only applyPack consumes return) | ✓ matches plan N1 note |
| `getActiveKnowledgeForThread`/`resolveKnowledgeIdsForThread`/`listKnowledge` exist on skillEngine | ✓ `skill-engine.ts:496`/`:505`/`:1092` |
| `saveUserPack` signature (`pack-engine.ts:833`) currently takes `skill_ids`/`mcp_server_ids` only | ✓ plan Task 2 Step 5 + Task 4 Step 2 wire `knowledge_ids` |
| `pack.save_user` RPC handler at `message-router.ts:2480`, saveUserPack call at `:2516` | ✓ matches plan wiring intent |
| skill_refs replace-vs-preserve shape at `pack-engine.ts:1458-1464` | ✓ D8 symmetry claim grounded |

## B1 fix assessment (rejection gate R1/R2)

Plan Task 4 now explicitly:
- Step 1: Adds `"active_knowledge_ids"` to the `thread.update` allowlist (line 265 quotes the exact addition)
- Step 2: Wires `knowledge_ids` from client body into `saveUserPack({ ..., knowledge_ids })`
- Step 3: Adds a router allowlist test (the gap that let B1 hide last round)
- Step 4: Manual end-to-end criterion (KnowledgeSubPanel toggle → reload → resolve includes id)

Workflow log (G1) correctly records both prior REJECTs and disposition table at lines 319-329 maps each prior nit to its absorption site. The earlier false claim ("Object.assign's already") is gone; root-cause is now correctly identified as the WS-layer strip.

## ADR-020 capability check

Declaration present and complete (Surface L0 / Compose knowledge+pack / Autonomy n/a / Trust no elevation / Channel unchanged). Axes honored:
- Pack-first ✓ (knowledge selection inside existing PacksPanel; no new primary chrome)
- No "中层 Agent" ✓ (Thread field + Pack refs; no second runtime)
- Trust monotonicity ✓ (D7 explicitly no Trust/auto_approve touch; no `request()`/originWs surface added)
- R3 (Trust elevation) not triggered ✓

## D8 (replace vs preserve) coherence

Pseudo-code at lines 175-194 matches skill_refs shape at `pack-engine.ts:1458-1464` for the non-empty case; empty case intentionally preserves `baseSnap.active_knowledge_ids` with explicit code-comment commitment (line 38 + 179-180). The asymmetry ("packs cannot clear knowledge via empty refs") is documented and intentional — implementer won't "fix" it to match skills. Coherent.

## Nits (non-blocking)

- **N1**: File map row for `message-router.ts` (line 53) only lists `thread.update` allowlist; doesn't mention the `pack.save_user`/saveUserPack `knowledge_ids` wire that Task 4 Step 2 introduces. Task 4 title does say "save_user wire" so it's discoverable, but adding to the file-map cell would make the change footprint obvious.
- **N2**: Task 3 Step 6 (PacksPanel zone text copy update) is a minor scope addition unrelated to the orphan fix; fine to keep, just flag it as UI-polish bundled with the bug fix.
- **N3**: D2 one-release back-compat window still has no scheduled removal issue/lint beyond the `TODO(wave-a-d2)` marker — acceptable for a plan gate, but worth filing a follow-up ticket when implementation lands.

Plan is implementable without invention, both prior blocking issues are concretely resolved, no Trust elevation, capability declaration clean.

VERDICT: APPROVE_WITH_NITS
