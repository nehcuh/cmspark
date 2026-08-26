# overlay-post222-residual-fix — 四路独立对抗验证

**Batch:** `overlay-post222-residual-fix`
**Branch:** `fix/overlay-post222-residual` (uncommitted vs `origin/main` `a58b78f`)
**Base:** `a58b78f` Merge `fix/windows-tray-nodepath` into main
**Diff:** `docs/audit/reviews/overlay-post222-residual-fix-diff-20260826.patch`
**Prior REJECT:** `docs/audit/reviews/overlay-post222-residual-verdict-20260826-093708.json` (Claude+Pi both REJECT; R5 merge regression)

You are **one independent adversary lane**. Do **not** read other `overlay-post222-residual-fix-adversary-*.md` reports. Do **not** edit production code. Write **only** your assigned report file.

## Lane assignment

Your prompt names your lane. Write exactly one file:

| Lane | Report path |
|------|-------------|
| security | `docs/audit/reviews/overlay-post222-residual-fix-adversary-security-20260826.md` |
| product | `docs/audit/reviews/overlay-post222-residual-fix-adversary-product-20260826.md` |
| impl | `docs/audit/reviews/overlay-post222-residual-fix-adversary-impl-20260826.md` |
| external | `docs/audit/reviews/overlay-post222-residual-fix-adversary-external-20260826.md` |

## Capability (ADR-020)

- Surface: Darwin HUD = Swift NSPanel C-thin; Win/Linux = loopback HTML `--app` (not a Mac HUD clone)
- L2: tray `showConfirmDialog` on `security.confirmation.request`; overlay **must not** grow Allow/Deny / `summoner.confirm.*`
- Compose: overlay-safe `SUMMONER_ALLOW` + `applySummonerPayloadPolicy`
- Trust: monotonic; `knowledge.import` / `mcp.add` stay **off overlay WS** (stdin + tray `companionClient` only)
- Channel: CDP still needs Chrome; companion cannot open Side Panel

## What the implementer claims (do not trust — verify)

Merge `a58b78f` took `dfab3eb` dark HTML and dropped `03de168` paper HUD + I1/I2. This fold:

1. **I1 CLOSED** — C-thin skills `on:!on` (not `on:true`)
2. **I2 CLOSED** — C-thin knowledge `ids:next` (not `ids:[id]`)
3. **I3 CLOSED** — Swift `knowledgeImportClicked` fail-closes non-UTF-8 (`只支持文本知识（md/txt）`); no `base64EncodedString()` as body
4. **I4 stays CLOSED** — HTML mcp.toggle still rides tray `companionClient` (untouched)
5. **I5 CLOSED** — Mac list in `NSScrollView`; `prefix(64)` + `SUMMONER_RAIL_LIST_CAP=64` (was `prefix(12)` / `slice(0,8)`)
6. **I6 CLOSED** — `knowledge.set_active` still fail-closed filters unknown ids; response now includes `dropped`; unit test in `knowledge-active-ids.test.ts`
7. **I7 CLOSED** — dfab3eb flex (`html,body{height:100%;width:100%;overflow:hidden}`, `.rail{flex-shrink:0}`, `.main{min-height:0}`, `.log{min-height:0}`, `.composer{flex-shrink:0}`) layered **onto** restored `--paper` HUD (not by keeping dark HTML)
8. **I8 stays CLOSED** — F-I-5 / PEM END / F-S-1 files untouched
9. **Window** — `shell-open.ts` `--window-size=720,120` matches lock test
10. **R4** — `SWIFT_TRAY_SHA256 = 57e1fba2c5d7dd5bde0f462a85e92d8839ff7c9c8b7c8e9f5bd897d6285a6052` matches `companion/dist/cmspark-tray`

**Must not:** retarget lock tests to reverted dark HTML; put `knowledge.import` on overlay WS; add HUD Allow/Deny.

## Machine (implementer-claimed; re-run if you doubt)

```
cd companion && npx --offline tsx --test \
  tests/summoner-web.test.ts tests/summoner-shell-open.test.ts \
  tests/summoner-workbench-compose.test.ts tests/summoner-acl.test.ts \
  tests/knowledge-active-ids.test.ts tests/summoner-overlay.test.ts \
  tests/summoner-thread-manage.test.ts tests/swift-tray-integrity.test.ts
```

Claimed: **114 + 4 integrity = green**. Re-execute the subset you need. Tag `[executed]` vs `[inspected]`.

Also: `shasum -a 256 companion/dist/cmspark-tray` vs pin in `swift-tray-bridge.ts`.

## Gates (REJECT if any fire)

| ID | Fail closed |
|----|-------------|
| R1 | overlay WS can `mcp.add` / `knowledge.import` / `config.set` |
| R2 | overlay `thread.update` can write `tool_whitelist` / non-alias |
| R3 | HUD Allow/Deny / `summoner.confirm.*` |
| R4 | `SWIFT_TRAY_SHA256` ≠ `companion/dist/cmspark-tray` |
| R5 | claimed-CLOSED I1–I8 actually OPEN, or lock tests weakened to match reverted HTML |
| R6 | new fold breaks overlay-safe ACL |

## DoD (external observables)

- Live `summoner-web.ts` HTML contains `on:!on` and `ids:next`; forbids `on:true` / `ids:[id]`
- GET HTML still `--paper` / `.rail-btn` / `.list-scroll` / collapsed `placeWindow(false)` / no `#12141c`
- `planSummonerShellOpen` uses `--window-size=720,120`
- Swift knowledge import rejects non-UTF-8; no base64 body
- List stack is `listScroll.documentView`; no `prefix(12)`
- `knowledge.set_active` unknown id does not attach; `dropped` reported; test exists
- `SUMMONER_ALLOW` still denies `mcp.add` / `knowledge.import`
- No new confirm dialect

## Three layers

1. **Outcome** — DoD actually true on the working tree?
2. **Trajectory** — scope = 10 files above; no drive-by; did they paper over by editing lock tests?
3. **Component** — file:line for any remaining OPEN

## Output format

Markdown report with:

- Lane name + HEAD/base
- I1–I8 table: CLOSED / OPEN / NIT + file:line + evidence tag
- R1–R6 HOLD / FIRE
- Outcome / Trajectory / Component
- Nits (non-blocking) vs Blockers
- Final line **exactly**: `VERDICT: APPROVE` or `VERDICT: APPROVE_WITH_NITS` or `VERDICT: REJECT`

Do not APPROVE if I1/I2 still OPEN or if tests were retargeted to dark HTML.
Do not invent pixel-run of C-thin; CSS inspect is `[inspected]`.
Win/Linux systray2 never-promise L2 is a nit unless it re-broke Darwin tray ride.

Write the report file, then stop.
