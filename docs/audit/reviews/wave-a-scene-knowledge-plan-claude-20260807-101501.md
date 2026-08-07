I have enough evidence to render a verdict. Let me synthesize.

## Verification summary

I confirmed the plan's grounding claims against the codebase:

| Claim | Status |
|-------|--------|
| `getActiveKnowledgeForThread` / `resolveKnowledgeIdsForThread` exist in skill-engine | ✓ (`skill-engine.ts:496`, `:505`) |
| `KnowledgeSubPanel.tsx` sends `active_knowledge_ids` via `thread.update` | ✓ (`KnowledgeSubPanel.tsx:484`) |
| Thread has no `active_knowledge_ids` field today | ✓ (`thread-manager.ts:25-99`) |
| `applyPackPatch` validates `active_skill_ids` only, no knowledge equivalent | ✓ (`thread-manager.ts:605-695`) |
| `saveUserPack` writes `knowledge: []`, no `knowledge_refs` | ✓ (`pack-engine.ts:951-952`) |
| `installAssetsFromValidated` returns skill ids only, drops knowledge names | ✓ (`pack-engine.ts:642-666`) |
| `snapshotFromThread` / `restoreSnapshot` carry no `active_knowledge_ids` | ✓ (`pack-engine.ts:1229-1261`) |
| `PacksPanel.tsx` has no knowledge selector | ✓ |
| `listKnowledge()` exists on skillEngine | ✓ (`skill-engine.ts:1092`) |

Capability declaration (Surface L0 / Compose knowledge+pack / Trust no elevation / Channel unchanged) matches the change. ADR-020 axes are honored: knowledge is composed via Thread field + Pack refs, no new runtime, no Trust touch.

## Blocking issue (R2 triggered)

**B1 — Plan does NOT add `active_knowledge_ids` to the `thread.update` WS allowlist at `companion/src/message-router.ts:1617-1628`.**

The allowlist today is:
```typescript
for (const key of [
  "alias", "config_override", "tool_whitelist", "pinned_tabs",
  "active_skill_ids", "skill_selection_mode", "knowledge_selection_mode",
  "mcp_selection_mode", "active_mcp_server_ids", "digest",
]) { ... }
```

`active_knowledge_ids` is **absent**. `KnowledgeSubPanel.tsx:484` fires `chrome.runtime.sendMessage({type:"thread.update", updates:{active_knowledge_ids}})` — the WS handler drops the key at the allowlist before it ever reaches `threadManager.update`. The orphan stays open.

Plan Task 4 says only: *"Confirm thread.update already Object.assign's active_knowledge_ids once field validated."* That Confirm, when executed against `threadManager.update` in isolation, **passes** (Object.assign at `thread-manager.ts:596` will accept any validated key once Task 1 Step 2 lands). It does not surface the WS-layer strip. The plan's Task 1 Step 1 unit test seeds `thread.active_knowledge_ids` directly, bypassing the WS layer, so it will go green while production stays broken.

Result: success criterion #1 ("Manual toggle in KnowledgeSubPanel persists and injects on next chat") fails; rejection gate R2 ("Plan leaves manual KnowledgeSubPanel still non-functional") triggers. The plan needs an explicit Modify step: *"Add `active_knowledge_ids` to the `thread.update` allowlist in `message-router.ts`."*

## Nits (non-blocking)

- **N1**: `installAssetsFromValidated` has three call sites — `pack-engine.ts:1106` (installPack v4), `:1117` (installPack v3), `:1424` (applyPack). Plan says "Update all call sites (installPack, applyPack)" — correct, but the two installPack paths discard the return value today and only call `skillEngine.refresh()`. Plan should note that the return-shape change is load-bearing only for the applyPack site; install paths can keep ignoring the new `{skillIds, knowledgeIds}` shape.
- **N2**: D2 back-compat union is "for one release" with no migration marker, removal test, or follow-up issue. Add a TODO + grep-for-it lint or assert in a deprecation test.
- **N3**: Task 1 Step 1 test sketch only covers `manual` mode. Add cases for `auto` (site-union still works through `getBySite`) and the D2 legacy path (knowledge names still riding in `active_skill_ids` continue to resolve until removal).
- **N4**: Parent spec §4.4 says "preset ∪ 用户线程已选" (union with pre-apply user selection). Plan Task 2 Step 3 replaces the user's pre-existing selection when the pack has `knowledge_refs` (only preserves `baseSnap.active_knowledge_ids` when the pack brings no knowledge at all). This is symmetric with current `skill_refs` behavior at `pack-engine.ts:1457-1464` so acceptable, but it is a deviation from the spec's "union" wording — flag in the plan or fix the spec text.
- **N5**: Plan Task 3 Step 5 hydrates `activeKnowledgeIds: activeThread?.active_knowledge_ids || []`. `agentStore.tsx:41`/`:275` already declares/defaults this field — good. Plan also asks to "Ensure Thread type includes `active_knowledge_ids?: string[]`" but doesn't pin the file; confirm whether Thread type lives in `chrome-extension/src/sidepanel/types.ts` or a sibling before coding.

Plan architecture (D1–D7) is sound and the TDD scaffolding is correct. The single blocking miss is the WS-allowlist wiring step; with B1 added to Task 4 as an explicit Modify, the plan is implementable without invention.

VERDICT: REJECT
