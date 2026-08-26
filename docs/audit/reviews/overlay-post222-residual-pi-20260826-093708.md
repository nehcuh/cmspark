I have everything I need. All machine checks are done and cross-confirmed against the four adversary lanes.

## Machine verification (this session, on `a58b78f`)

| Check | Result |
|-------|--------|
| `HEAD:companion/src/summoner-web.ts` blob | `16149a8e` = **`dfab3eb`** (old #222 dark shell) |
| `03de168:companion/src/summoner-web.ts` blob | `e10d8728` (paper HUD + `on:!on` / `ids:next` folds) — **not in HEAD** |
| Merge msg `a58b78f` | claims "accept main branch version (new HUD design)" — **false vs tree** |
| `npx tsx --test tests/summoner-web.test.ts` | **FAIL** at `summoner-web.test.ts:541` — `/skill_name:s\.name,on:!on/` vs live `on:true` (`summoner-web.ts:924`), `ids:[id]` (`:939`) |
| `npx tsx --test tests/summoner-shell-open.test.ts` | **FAIL 1** — expects `--window-size=720,120` (`:71`); code is `800,720` (`shell-open.ts:55`) |
| `shasum -a 256 companion/dist/cmspark-tray` | `ed4dbfa0…5fda` == `SWIFT_TRAY_SHA256` (swift-tray-bridge.ts:59) — **R4 holds** |
| ACL | `mcp.add`/`knowledge.import`/`config.set` denied on summoner surface; `thread.update` alias-only (`summoner-acl.ts`) — **R1/R2 hold** |
| I4 tray ride | `menu-bar-agent.ts:1628-1630` reroutes `mcp.toggle_server` to tray `companionClient` — **CLOSED** |
| I5 | `prefix(12)` `SummonerOverlay.swift:369,562,577,595,615`; `slice(0,8)` `menu-bar-agent.ts:791` — present |
| I3 | `SummonerOverlay.swift:719` `String(data:…) ?? data.base64EncodedString()` as `content` — present |

## Per-issue verdicts (I1–I8)

- **I1** — **OPEN (blocking, R5).** `summoner-web.ts:924` hard-codes `on:true`; server `:476` treats anything non-`false` as on → C-thin skill can never be deactivated. `03de168` folded `on:!on` + reload; merge silently reverted it.
- **I2** — **OPEN (blocking, R5).** `summoner-web.ts:939` sends `ids:[id]`, which `message-router.ts:2616-2629` writes as the full `active_knowledge_ids` → clicking one doc unpins all others. `03de168`'s `ids:next` fold absent.
- **I3** — **OPEN (non-blocking residual).** Non-UTF-8 import mangles binary into a base64 *document body*.
- **I4** — **CLOSED.** Tray ride verified at `menu-bar-agent.ts:1628-1630`; lock test passes.
- **I5** — **OPEN (non-blocking residual).** List caps + no `NSScrollView` on Mac rail.
- **I6** — **OPEN (non-blocking residual).** Unknown ids silently filtered (`message-router.ts:2624`), no unit test.
- **I7** — **CLOSED** (flex recipe present at `summoner-web.ts:621-641`), but note: it sits on the *old dark shell* — the HUD restyle itself was lost.
- **I8** — **CLOSED.** F-I-5/PEM-through-END/F-S-1 survive on the `03de168` side; green per executed tests.

## Blocking issues

1. **`a58b78f` is a corrupted merge of `summoner-web.ts`.** HEAD blob == `dfab3eb` (#222 dark HTML), not `03de168`'s HUD HTML that folded I1/I2 — yet the merge resolution note claims "accept main branch version (new HUD design)". The `03de168` folds never entered the tree (`companion/src/summoner-web.ts:924,939`).
2. **R5 fires: I1/I2 claimed folded but OPEN at HEAD** — skill deactivate and knowledge un-pin are broken on the C-thin surface; the lock tests that assert the folds fail.
3. **Main HEAD is red (machine-confirmed):** `companion/tests/summoner-web.test.ts:541-543` (`on:!on`/`ids:next` vs live `on:true`/`ids:[id]`), `summoner-web.test.ts:118-122` (`--paper:#fff` HUD vs `#12141c` dark), `companion/tests/summoner-shell-open.test.ts:71` (`720,120` vs `800,720` at `shell-open.ts:55`).

Security posture (R1/R2/R3/R4/R6) is intact — this is a merge-hygiene/regression reject, not an ACL break. Fix: re-merge `03de168`'s HTML (or port `on:!on`/`ids:next` + HUD onto the `dfab3eb` flex shell), then retarget `summoner-shell-open.test.ts` to the chosen window size and reconcile the HUD-content test with the design actually shipped.

VERDICT: REJECT
