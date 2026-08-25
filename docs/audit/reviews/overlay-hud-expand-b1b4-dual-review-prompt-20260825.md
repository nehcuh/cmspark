# Dual external review: Overlay HUD Expand B1–B4 (compose workbench)

**Batch:** `overlay-hud-expand-b1b4`  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Also includes:** B0.5 thread rename/trash already in tree  
**Blast:** T2 UI compose + **T3** paths `mcp.add` / `knowledge.import` (stdin → **tray** `companionClient`, **not** summoner WS)

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel) + C-thin HTML reads/toggles
L2-classes:   none on HUD; mcp.add stdio spawn uses existing tray L2
Compose:      threads + packs.apply (overlay-eligible) + mcp.toggle + skill toggle
              + knowledge USE (set_active) + knowledge import HITL
Autonomy:     n/a
Trust:        summoner ACL: reads + overlay-safe writes (pack.apply, mcp.toggle_server,
              skill.activate/deactivate, knowledge.list/set_active).
              mcp.add + knowledge.import DENIED on summoner WS; launcher uses tray client.
              thread.update overlay still alias-only.
              no overlay Allow/Deny dialect; NSAlert 导入/添加/取消 (no 确认)
Channel:      community
```

## Machine

- summoner overlay/acl/protocol/web/thread-manage/workbench-compose + ws-router lockstep: 119 pass
- `tsc --noEmit` exit 0
- `SWIFT_TRAY_SHA256` == `companion/dist/cmspark-tray` == `ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda`

## DoD

1. Rail 场景 lists packs; click overlay-eligible → `summoner.pack.apply` (router still allowTrust=false + eligible).  
2. Rail MCP lists servers; click toggles; ＋ 添加 goes stdin `summoner.mcp.add` then **tray** `mcp.add`. Overlay WS `mcp.add` still ACL-denied.  
3. Rail 技能 lists; click toggles activate/deactivate on current thread.  
4. Rail 知识 lists; click `knowledge.set_active`; ＋ 导入 NSOpenPanel + NSAlert then tray `knowledge.import`. Overlay WS `knowledge.import` denied.  
5. `knowledge.set_active` overlay policy strips extra keys; ids must exist in knowledge list.  
6. No HUD Allow/Deny / `summoner.confirm.*`.  
7. Pin lockstep.  
8. C-thin HTML can list/toggle packs/mcp/skills/knowledge.set_active; cannot dispatch mcp.add/knowledge.import.

## REJECT if

R1 overlay WS can `mcp.add` / `knowledge.import` / `config.set`  
R2 overlay `thread.update` can write tool_whitelist / knowledge ids  
R3 overlay Allow/Deny chrome  
R4 pin ≠ binary  
R5 pack.apply from overlay skips overlay-eligible / allowTrust=false  
R6 knowledge.set_active accepts unknown ids or extra trust keys

Folded after dual REJECT (185345):
- skill/knowledge ● state reads `thread.list` (full Thread), not `thread.select.thread` (does not exist)
- tray `companionClient` answers `security.confirmation.request` via `showConfirmDialog` so stdio `mcp.add`/toggle-on can complete; mcp.add timeout 60s

Folded after r1 REJECT:
- knowledge.import sends UTF-8 `content` (not file.content base64)
- C-thin HTML has 对话/场景/知识/技能/MCP tabs + `/api/*` fetches

r2: security/impl AWN; product r2 REJECT over-scopes MCP **tool use** (CDP still needs Chrome per spec §0); external r2 remaining BLOCK is **git index hygiene** (restage compose + pin `ed4dbfa0`, do not commit Slice-B pin `367b3e29`). Dual: judge **worktree**, not stale index.

Adversary reports:
- overlay-hud-expand-b1b4-adversary-security-20260825.md
- overlay-hud-expand-b1b4-adversary-impl-20260825.md
- overlay-hud-expand-b1b4-adversary-product-20260825.md + product-r2
- overlay-hud-expand-b1b4-adversary-external-20260825.md + external-r2

SCOPE: overlay compose files (acl, lifecycle, protocol, menu-bar-agent, summoner-web, SummonerOverlay.swift, Tray.swift, swift-tray-bridge, message-router knowledge.set_active, validate, tests). Ignore unrelated MM only if not in this claim.

VERDICT line required.
