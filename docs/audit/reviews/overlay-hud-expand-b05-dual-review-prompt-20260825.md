# Dual external review: Overlay HUD Expand B0.5 — thread manage

**Batch:** `overlay-hud-expand-b05`  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 item 1 / 实现波次 B0.5  
**Blast:** T2 L0 Surface（ACL 增长 `thread.delete`/`thread.update`，但 overlay-safe：trash-only + alias-only；**不是** T3 knowledge/mcp.add/confirm）

```text
Surface:      L0 overlay HUD workbench thread management (Mac NSPanel + C-thin HTML)
L2-classes:   (none)
Compose:      thread rename + trash; Companion-owned; no Chrome Side Panel required
Autonomy:     n/a
Trust:        SUMMONER_ALLOW grows thread.delete + thread.update;
              applySummonerPayloadPolicy forces mode=trash and alias-only;
              omitted/hard delete on summoner → SUMMONER_ACL (no silent coerce);
              confirm stays native NSAlert / HTML confirm(), no overlay Allow/Deny dialect
Channel:      community
```

## Machine (this session)

- `companion/tests/summoner-thread-manage.test.ts` + protocol/acl/overlay/talk/web: 131 pass
- thread-cleanup + files.test + swift-tray-integrity + ws-router lockstep: 91 pass
- `thread.delete` default remains **hard** for tray (`thread.delete default hard; explicit trash soft`)
- `npx tsc --noEmit` companion: exit 0
- `SWIFT_TRAY_SHA256` == `shasum -a 256 companion/dist/cmspark-tray` == `e068754969612ff74341cbd12719d7358e1301960396caf610252869e1bd0a3e`

## B0.5 DoD (external observables)

1. Overlay 能 **重命名** 对话（写 `Thread.alias`），不经 Chrome Side Panel。  
2. Overlay 能 **移到回收站**（`thread.delete` `mode:"trash"`），不能硬删。省略 mode / `hard` 在 summoner surface 被 `SUMMONER_ACL` 拒绝。  
3. Overlay `thread.update` 只许 `alias`；`tool_whitelist` / knowledge ids 被剥掉或拒绝。  
4. Mac HUD：线程行 ⋯ / 右键菜单「重命名」「移到回收站」+ 原生 `NSAlert`；源码无「确认/允许/拒绝/Allow/Deny」。  
5. C-thin HTML：`PATCH/DELETE /api/thread` + 页面按钮，同样 overlay-safe。  
6. 删当前对话后切到最近一条，没有则新建。  
7. Pin lockstep（上）。  
8. 无 `knowledge.*` / `mcp.add` / overlay confirm dialect。

## REJECT if

R1 overlay 能 hard-delete，或 `thread.delete` 无 mode 时仍走 router 默认 hard  
R2 overlay `thread.update` 能写 `tool_whitelist` / `active_knowledge_ids` / config_override  
R3 HUD 内 Allow/Deny / `summoner.confirm.*`  
R4 pin ≠ binary  
R5 对话管理仍绑定 Side Panel（Swift/HTML 路径缺 rename/trash）  
R6 ACL 同时放开 `knowledge.*` / `mcp.add` / `thread.restore` / `thread.batch_delete`

**SCOPE — review only these files.** Ignore leftover MM (ChatView, PacksPanel, markdown-breaks, Slice A/B docs):

- `companion/src/ws/summoner-acl.ts`
- `companion/src/ws/lifecycle.ts`
- `companion/src/summoner/protocol.ts`
- `companion/src/menu-bar-agent.ts`
- `companion/src/summoner-web.ts`
- `companion/src/tray/SummonerOverlay.swift`
- `companion/src/tray/swift-tray-bridge.ts`
- `companion/tests/summoner-thread-manage.test.ts`
- `companion/tests/summoner-web.test.ts`
- `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`
- `docs/audit/reviews/overlay-hud-expand-b05-*`

Four-lane adversary (all APPROVE_WITH_NITS):
- `docs/audit/reviews/overlay-hud-expand-b05-adversary-security-20260825.md`
- `docs/audit/reviews/overlay-hud-expand-b05-adversary-product-20260825.md`
- `docs/audit/reviews/overlay-hud-expand-b05-adversary-impl-20260825.md`
- `docs/audit/reviews/overlay-hud-expand-b05-adversary-external-20260825.md`

Folded after adversary, before this dual: HTML `refresh()` sorts by `updated_at` so post-trash handover matches Mac recency; DELETE HTTP test now sends `mode=hard` in query+body and still dispatches `trash`.

Read adversary reports under `docs/audit/reviews/overlay-hud-expand-b05-adversary-*` if present.

三层：outcome / trajectory / component。file:line。  
最终一行必须是：`VERDICT: APPROVE` | `APPROVE_WITH_NITS` | `REJECT`
