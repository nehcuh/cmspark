# Dual external review: Overlay HUD Expand B0

**Batch:** `overlay-hud-expand-b0`  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Hi-fi:** `docs/design/overlay-hud-expand-hifi.html`  
**Blast:** T2 L0 Surface

```text
Surface:      L0 overlay HUD collapse + expand workbench (B0 threads only)
L2-classes:   (none)
Compose:      thread list/select only this slice
Autonomy:     n/a
Trust:        ACL unchanged; no knowledge.*; no mcp.add; no confirm dialect
Channel:      community
```

## B0 DoD

1. Chevron ⌄/⌃ expands/collapses a workbench **above** the composer (composer stays at bottom).  
2. Icon rail + **one** thread list (not stacked 对话/MCP/场景 labels). `func makeRail` absent. No `summoner.pack.apply`.  
3. `applyThreads` actually fills `threadListStack`.  
4. `SummonerPanel.canBecomeKey == true`; 📎 still non-empty MIME + `runModal`.  
5. Pin `SWIFT_TRAY_SHA256` == `companion/dist/cmspark-tray` == `d0164b70ee0d7946e1e93c5921ede1c2f60f805800be5788802f290cebbc93ac`  
6. No overlay Allow/Deny; no `knowledge.*` on `SUMMONER_ALLOW`.

## REJECT if

R1 ACL growth knowledge/mcp.add/confirm  
R2 old 200pt stacked rail / pack.apply chrome  
R3 composer not below workbench  
R4 pin ≠ binary  
R5 canBecomeKey missing  

Read adversary reports under `docs/audit/reviews/overlay-hud-expand-b0-adversary-*` if present.

VERDICT line required.
