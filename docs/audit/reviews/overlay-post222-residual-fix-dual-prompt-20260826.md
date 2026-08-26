# Dual external review: overlay-post222-residual-fix

**Batch:** `overlay-post222-residual-fix`  
**Branch:** `fix/overlay-post222-residual` (uncommitted) vs `origin/main` `a58b78f`  
**Prior dual:** `overlay-post222-residual` Claude+Pi both **REJECT** (`overlay-post222-residual-verdict-20260826-093708.json`) — R5 merge clobber of `03de168` paper HUD + I1/I2  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`

```text
Surface:      Darwin HUD = Swift NSPanel C-thin; Win/Linux = loopback HTML --app (not a Mac HUD clone)
L2-classes:   none on HUD; tray showConfirmDialog on security.confirmation.request
Compose:      overlay-safe SUMMONER_ALLOW + applySummonerPayloadPolicy
Autonomy:     n/a
Trust:        monotonic; knowledge.import / mcp.add stay off overlay WS (stdin + tray companionClient)
Channel:      community; CDP still needs Chrome
```

**Blast:** T2 residual UX + T3 stdin import fail-close / SHA pin / `dropped` honesty.

## 刻意边界（已裁决，不要再挑战）

- 网页 CDP 仍要 Chrome 扩展。不要把「MCP 工具执行走 Side Panel」判成 BLOCK。
- Overlay 不做 Allow/Deny 方言。托盘 `showConfirmDialog` 是 L2。
- Win/Linux C-thin 不是 Mac HUD 视觉克隆。
- 不要要求 `knowledge.import` 上 overlay WS。
- **不要**把锁测试改去迁就 `a58b78f` 暗色 HTML。

## 任务

**确认或驳回**四路独立对抗的 APPROVE_WITH_NITS。漏检 → REJECT。过严 nits 可降级。读对抗全文，不要只看摘要。

- `docs/audit/reviews/overlay-post222-residual-fix-adversary-security-20260826.md`
- `docs/audit/reviews/overlay-post222-residual-fix-adversary-product-20260826.md`
- `docs/audit/reviews/overlay-post222-residual-fix-adversary-impl-20260826.md`
- `docs/audit/reviews/overlay-post222-residual-fix-adversary-external-20260826.md`
- synthesis: `docs/audit/reviews/overlay-post222-residual-fix-verdict-20260826.json`

对抗之后实现又折了两条他们点名的便宜 nit（须在 live tree 上核）：

1. C-thin `placeWindow` 收起 `500×140` → `720×120`（对齐 `shell-open.ts`）
2. Mac `listCol`/`railCol`/`logBox` `height = workbench.height`（AppKit 无 `NSStackView.alignment = .fill`）

然后 **重编** tray，pin 现为：

`SWIFT_TRAY_SHA256 = 34ed53a00eba5ca129f7803ca5c373bb146bba9a5078e8ba074b77024a777b7c`

## Machine this session `[executed]` by implementer — re-verify SHA + targeted tests if you doubt

```
cd companion && npx --offline tsx --test \
  tests/summoner-web.test.ts tests/summoner-shell-open.test.ts \
  tests/summoner-workbench-compose.test.ts tests/summoner-acl.test.ts \
  tests/knowledge-active-ids.test.ts tests/summoner-overlay.test.ts \
  tests/summoner-thread-manage.test.ts tests/swift-tray-integrity.test.ts
# → 118 pass / 0 fail
shasum -a 256 companion/dist/cmspark-tray
# → 34ed53a00eba5ca129f7803ca5c373bb146bba9a5078e8ba074b77024a777b7c
```

**禁止**跑 `npm test` / `scripts/run-tests.mjs` / 全量 companion suite（会挂死）。只跑上面的 tsx 子集、`git`、`shasum`、`rg`。

## 声称 CLOSED（须在 live 源码核，不要信实现者）

| ID | 声称 |
|----|------|
| I1 | C-thin skills `on:!on`（不是 `on:true`） |
| I2 | knowledge `ids:next`（不是 `ids:[id]`） |
| I3 | Swift 非 UTF-8 fail-close；`knowledgeImportClicked` 无 `base64EncodedString` 当正文 |
| I4 | HTML mcp.toggle 仍骑 tray `companionClient`（未改） |
| I5 | `listScroll.documentView = tStack`；`prefix(64)`；列高钉 workbench |
| I6 | `knowledge.set_active` 未知 id 不挂；响应 `dropped`；`handleMessage` 单测 |
| I7 | dfab3eb flex 叠在 `--paper` HUD 上，不是留 `#12141c` |
| I8 | F-I-5 / PEM END / F-S-1 文件未动 |

锁测试仍断言 paper HUD / `on:!on` / `ids:next` / `720,120`。GET HTML **加严**了 flex / `.list-scroll`。

## REJECT / BLOCK if

R1 overlay WS 能 `mcp.add` / `knowledge.import` / `config.set`  
R2 overlay `thread.update` 能写 `tool_whitelist`  
R3 HUD 出现 Allow/Deny / `summoner.confirm.*`  
R4 `SWIFT_TRAY_SHA256` ≠ `companion/dist/cmspark-tray`（二进制存在时必须 `shasum`）  
R5 声称已折的 I1–I8 实际未折却标 CLOSED，或锁测试被改去认暗色 HTML  
R6 新 fold 破坏 overlay-safe ACL  

对抗过松 APPROVE → 你也可以 REJECT。

## 三层

outcome / trajectory / component。file:line。机核优先。

最终一行必须是：

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
