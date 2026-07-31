I have enough code-grounded evidence to write the review. All key claims from both critics verified against the repo: `BottomBar.tsx` is 1162 lines and owns `activePanel`/`loadPanelData`/`cmspark:open-context-panel` listener; `META_PANEL_SLASH` only contains packs/board/mcp; `FleetStrip.tsx:41` visibility includes `pending > 0`; `MinimalConfirm.tsx:67-69` Esc→deny; pin currently lives on `ModeBadge` (not ⋯); many `alert()`/`window.confirm()` remain across BottomBar/ThreadList/NotebooklmImporterPanel/PacksPanel/FleetStrip.

---

## Summary

Revised v2 is **implementable**. Both critics' three blocking issues each (Board placement, FocusBand priority, BottomBar host migration, P0 装配 entry, Abort-by-Send, slash parity, Esc stack) are addressed in spec text, and the PR plan now sequences host-extract before strip-removal with a real gate. ADR-020 fidelity is clean: Composition plane is 装配-only, Board stays under Autonomy, no new runtime, no new confirm dialect, no new Side Panel primary entry beyond what Pack-first allows (K9 装配 entry is an IA drawer opener, not a new tool/surface). Residual issues are non-blocking nits: two unfilled state-matrix cells, two missing doc-delta checklist items, one discoverability regression (pin → ⋯), one undefined chip target (工作区), and one Esc-stack entry that ignores an existing code path (MinimalConfirm Esc→deny). None of these will cause an engineer to guess at architecture; they are PR-time fill-ins.

## ADR-020 / three-mode fit

| Axis | Spec | Verdict |
|------|------|---------|
| Surface L0/L1/L2 | §2.1 unchanged mapping | ✅ preserved |
| Composition = Skill·Know·MCP·Pack·user-env | §4.5 exactly this set; Board removed (§4.5 "Not in 装配") | ✅ clean |
| Autonomy = single → multi-worker → Board | §4.5 Board routed to FocusBand/Cockpit/`/board`/「编排」 | ✅ clean |
| No bare「中层 Agent」 | §2.1 + §13 forbid; K3 labels「装配」| ✅ enforced |
| Trust monotonicity | D10′ content-split preserved; Pack cannot relax globals referenced (§2.1) | ✅ |
| Pack-first | New scenario IA = 装配 drawer over Pack/MCP/Skill, not a new primary chrome | ✅ |
| No new confirm dialect | Cockpit stays 确认台; MinimalConfirm stays in FocusBand | ✅ |
| Capability declaration | Present in prompt (Surface/Compose/Autonomy/Trust/Channel); diff is docs/spec only | ✅ more than sufficient |

Capability checklist (P1-1 originWs / P1-2 god-mode / P1-3 evaluate / P1-4 shell): **none apply** — this batch touches no companion security code, no `securityConfirmations.request`, no `browser-bridge`, no shell policy. No regression risk on the P1 watchlist.

## Adversarial closure check

| Issue | Closed? | Evidence |
|-------|---------|----------|
| A-B1 / B-§4 Board is Autonomy not Composition | ✅ | spec §4.5 L194-213; "Not in 装配" block lists Board → FocusBand/StatusRail/Cockpit/`/board`/「编排」; K3 |
| A-B2 FocusBand vs ≥55% (gamed metric) | ✅ | §4.3 L156 hard cap ≤80px, single primary ≤56px + one secondary ≤24px; §8 L384 worst-case L1+confirm / L2+confirm ≥40%; §14 L508 mirrors |
| A-B3 / B-B1 BottomBar host migration | ✅ | §4.7 L221-234 names `ContextPanelHost`, owns `activePanel`/`loadPanelData`/listener, M1-M4 replace-before-remove; §4.7 L234 "PR2 must not delete BottomBar without M1 in the same or prior PR"; §12 PR2 = "ContextPanelHost extract (no strip delete)" |
| A-M1 / D5′ explicit | ✅ | §2.2 L86-94 calls out D5′/K2′ as intentional IA delta; K2/D5′ row in §9 |
| A-M2 / B-M1 Abort by Send | ✅ | §4.4 L188-190 L2 chips = `确认台 · 装配 · (no Abort here)`; K8 codifies |
| A-M3 / B-m1 alert scope honesty | ✅ | §6.1 L342 + §8 L388 + §14 L511 all scope P0 to reconnect path; "other alerts tracked separately" — no zero-global overclaim |
| A-M4 Modal/overlay hierarchy | ✅* | §4.9 L253-260 ordered Esc stack table; §4.5 L213 "only one secondary surface at a time" gives pairwise exclusivity. No full z-index table — see nit 6 |
| A-M5 Drawer over-stuffed (6 → fewer) | ✅ | §4.5 reduces to 5 Composition sections; Board removed; Apps+user-env kept lumped as deliberate product call with "enterprise-aware copy" |
| A-M6 States matrix empty | ⚠️ partial | §5.3 lists 8 priority components + 7 state names; **no filled cells**. See nit 1 |
| A-M7 / B-m2 DESIGN.md sync | ✅ | §12 PR1 L457 includes DESIGN.md; §8 v2-P0 L389 touches tokens; m2's "header already migrated" verified (App.tsx:373-375 uses tokens.success/warning) |
| A-M8 / B-M3 PR resequence + flag | ✅ | §12 PR1→PR7 with host extract (PR2) before strip remove (PR5); §4.7 M3 names `ui.bottomBarStrip=false`; ship gate L488 |
| B-B2 P0 装配 entry | ✅ | §4.1 L144; §4.5 L197 "(P0) same entry opens thin section list"; §8 L379 deliver + L385 accept "≤2 clicks **or** 1 visible 装配 entry + 1 section tap"; K9 |
| B-B3 FocusBand hard priority + 急停 | ✅ | §4.3 priority table P0-P4 with hard rule 1: "Confirm does not bury 急停 … Violating D10′ is a bug" |
| B-M2 Slash parity | ✅ | §4.8 L236-251 full matrix (skills/knowledge/history/tabs/packs/mcp/apps/board/settings/cockpit) |
| B-M4 Metrics honesty | ✅ | §14 scoped table; L0 ≥55% gate + L1+confirm/L2+confirm ≥40% + FocusBand ≤80px + scoped alert + safety 急停 |
| B-M5 FleetStrip `pending>0` | ⚠️ partial | §4.3 priority P2 row = "Multi-worker / locks / intents" (pending not listed) implies removal, but spec doesn't explicitly instruct "drop `pending > 0` from FleetStrip.tsx:41". See nit 2 |
| B-M6 Docs delta | ⚠️ partial | §12 doesn't list `mission-pack-usage.md` / `confirm-center-user-guide.md` / "底栏「更多」" copy edits as PR deliverables. See nit 3 |
| B-M7 Drawer landfill guards | ✅ | §4.5 L213 one-secondary-surface rule |
| B-m5 Pin discoverability | ❌ | spec §4.2 L154 still puts pin in ⋯; `ModeBadge.tsx:72` confirms current pin is on the badge (clickable). Not addressed. See nit 4 |
| B-m6 L1 工作区 chip target | ❌ | §4.4 L187 + §4.8 matrix — 工作区 not in matrix. See nit 5 |

## Residual risks

1. **Pin in ⋯** — power-user regression; L1-locked browser workers will lose one-tap re-pin. Either keep on badge (current) or accept the regression explicitly.
2. **FleetStrip visibility rewrite** — the spec's §4.3 intent can only land if `FleetStrip.tsx:41` is edited; spec doesn't name the file. Risk of partial implementation that keeps `pending > 0` and re-stacks.
3. **Drawer Q1 default = bottom sheet in 320px** — no height cap stated (A-M5 asked for ~45-50%). §4.5 landfill guard covers exclusivity but not max height when open. ChatStream ≥55% implicitly waived when drawer open — not stated.
4. **States matrix is a P0 deliverable in name only** — engineer must invent state cells for 8 components mid-PR; risk of inconsistency.

These are nits, not blockers — the architecture is locked, the migration sequence is sound, and the spec is dense enough that two PRs (host extract + FocusBand) can land without architecture re-litigation.

## Blocking

None. All three Critic-A blocking issues and all three Critic-B blocking issues are addressed in revised spec text, with the BottomBar migration explicitly named as `ContextPanelHost` replace-before-remove in §4.7 and §12 PR2. The capability declaration is present and correct; ADR-020 axes are respected; D10′ content-split, D12′ Cockpit-conductor, and the abort guarantee are all preserved in §4.3 hard rule 1.

## Nits

1. **§5.3 states matrix unfilled.** Spec names 8 components and 7 states but provides zero cells. A-M6 asked for filled matrix on StatusRail / FocusBand / ComposerDock / MinimalConfirm at minimum. Engineer will fill ad-hoc. Recommend landing a completed matrix for those 4 in v2-P0 scope, rest in P2.
2. **§4.3 priority table implies but doesn't instruct** the `FleetStrip.tsx:41` visibility rewrite. Add an explicit implementation note: "remove `pending > 0` from FleetStrip visibility; pending is owned by MinimalConfirm / 确认台." Otherwise the `pending`-driven second bar survives.
3. **§12 PR plan omits docs delta.** `docs/mission-pack-usage.md §1` (底栏 任务包), `META_PANEL_SLASH` descriptions (App.tsx:41/49 still say "底栏「更多」"), and `docs/confirm-center-user-guide.md` reference the BottomBar IA. Add a doc-edit line item to PR2 or PR4.
4. **§4.2 pin → ⋯ is an unaddressed discoverability regression.** `ModeBadge.tsx:72` currently toggles pin via click; spec §4.2 L154 buries it in ⋯. Either keep pin on badge or note the regression as intentional.
5. **§4.4 L1「工作区」chip has no open target in §4.8 parity matrix.** Today `workspace.pick` lives in `PacksPanel` (`PacksPanel.tsx:201-268`). Define whether 工作区 chip opens Packs section, a stub, or Settings — otherwise four engineers will ship four panels.
6. **§4.9 Esc stack omits the existing MinimalConfirm Esc→deny path** (`MinimalConfirm.tsx:67-69`). Spec says "Confirm is not dismissed by Esc" — technically true (deny ≠ dismiss) but engineer reading §4.9 alone will not know Esc already denies. Add: "MinimalConfirm Esc → deny (safe default); higher overlays peel first."
7. **§4.5 Apps + user-env lumped.** A-M5 wanted split (Host apps vs ADR-019 secrets, different trust stories). Spec makes a deliberate call — acceptable — but should add one line on why the lumping is safe (both attach-to-thread, neither relaxes globals).
8. **§6.4 / z-index exclusivity table** — A-M4 asked for layer → triggers → exclusivity → focus return. §4.9 gives Esc order only; §4.5 L213 gives pairwise exclusivity. Sufficient for implementation; full table would prevent PR-time z-index wars with SettingsSlideout / SkillCraft / NotebooklmImporterPanel.

VERDICT: APPROVE_WITH_NITS
