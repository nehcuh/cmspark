All verification complete. Here's my independent re-review.

## Review: product-form-slices-123-impl (HEAD 151ca31 vs origin/main)

### Spot-checks (all six pass)

1. **grant-cli.ts** — consent copy is honest (`这把钥匙只出现一次。它不是扩展配对码。`; flag-absent → `未允许页文/截图外泄…会被拒绝（不会弹出确认台）`; flag-present → `首次外泄仍须在确认台批准`). Token prints once to stdout only; grep confirms no `acceptOutboundDisclosure`, `listen(`, `createServer(`, `fetch(` in the module. No `--profile`/`--require-grant`; profile hard-wired.
2. **summoner-web 打开确认台** — `SUMMONER_OPEN_CONFIRM` CTA wired in web (`openConfirm` button → attachChrome) and Swift (`summonerOpenConfirm`, `MCP_CONFIRM_PENDING` → `需要确认才能继续。` + 打开确认台). 展开对话/收起对话, footnote `我们不能替你打开侧栏`, mic copy `听写在侧栏` — no `去侧栏处理` remains.
3. **bridge.ts passHitlToHttp** — `DISCLOSURE_HITL_REQUIRED` with dispatcher → passed to HTTP; stdio child otherwise fail-closes. Defense-in-depth re-check `denyOutboundExfilIfNeeded` after gate.
4. **companion-http waitFirstExfilOperatorConfirm** — fan-out via `resolveConfirmBinding`/`fanOutConfirmRequest`, origin never overlay (`NOOP_ORIGIN_WS` closed stub), approve arms session Map only (`companion-http.ts:220`), grant JSON `allow_page_export_at` unchanged (pinned by executor test line 556). POST /disclosure → 403 `ACK_NOT_OPERATOR`; stdio META_ACCEPT → fail-closed `ACK_NOT_OPERATOR`.
5. **summoner-acl** — `security.confirmation.response` denied (`summoner-acl.ts` SUMMONER_ALLOW), pinned in `summoner-acl.test.ts`. `fanOutConfirmRequest` never sends Allow/Deny payload to `surface==="summoner"`; overlay gets `mcp.confirm.pending` only.
6. **rejectAll unbound survive** — `security-confirmation.ts` `rejectAll(ws)` rejects only `pending.originWs === ws`; unbound and extension-owned entries survive overlay close; tested.

### Gate algebra / trust monotonicity
`DISCLOSURE_NOT_GRANTED` (no flag) / `DISCLOSURE_HITL_REQUIRED` (flag, no operator session); zero `DISCLOSURE_REQUIRED` leftovers. `disclosure_accepted` ignored. Overlay close no longer cancels extension-owned tray confirms (lifecycle.ts). `waitForExtensionPeer` is event-driven (auth.ok), single fail-path timer, timeout → explicit error never `approved: true`. Overlay HITL fail-closed `MCP_OVERLAY_CONFIRM_UNAVAILABLE` without peer. ADR-020 declaration present in plan header; no new runtime / no 中层 Agent; originWs honored on all new `request()` sites (extension bind or fail-closed; outbound stays unbound by L8 design).

### Machine
- `tsc -p tsconfig.test.json`: **0 errors**.
- Slice tests: **193 + 176 pass** (grants, CLI, facade, companion-http, http-e2e, fanout, origin, l2-summoner, mcp-target, extension-peer, docs-grant, executor incl. "overlay socket cannot resolve exfil confirm" and "revoke after HITL still denies").
- **Full suite: 16 fail — 15 are pre-existing on origin/main** (verified via worktree: allow-dir-expand 1, computer-uia-watch 2, computer-executor 12). **1 new failure introduced by this batch.**

### The one finding (nit — test-only)
`companion/tests/summoner-thread-manage.test.ts:163` — `assert.doesNotMatch(overlay, /允许|拒绝|Allow|Deny|确认/)` on `SummonerOverlay.swift` now trips on this batch's own honest copy (`需要确认才能继续。`, `打开确认台`). The plan's Task 11 explicitly instructed narrowing Allow/Deny regexes to allow 确认台/需要确认/打开确认台; the implementer narrowed `summoner-workbench-compose.test.ts:150` (`/允许|拒绝|Allow|Deny/`) but missed the identical regex in `summoner-thread-manage.test.ts`. The code intent (overlay has no Allow/Deny chrome) is preserved — the strings are confirm-center CTAs, not actions — so the fix is a one-line regex narrowing, no behavior change. Non-blocking.

### Conclusion on the four-lane synthesis
Confirmed. Product r2 (`151ca31` = honest grant-cli copy + overlay 打开确认台) genuinely folds the Product REJECT; all four lanes AWN-equivalent. Trust monotonicity holds; overlay never Allow/Deny; grant ≠ ws_secret.

Nits:
1. `companion/tests/summoner-thread-manage.test.ts:163` regex `/允许|拒绝|Allow|Deny|确认/` must be narrowed to `/允许|拒绝|Allow|Deny/` (same as workbench-compose) — this is the only new full-suite red test from this batch.
2. `companion-http.ts` `outboundConfirmTrayHint()` on darwin says "approve via macOS tray dialog … and/or any open Side Panel", but `waitFirstExfilOperatorConfirm` wires no Swift tray race (WS fan-out only) — the tray hint is misleading on Mac for first-exfil; copy should say Side Panel/确认台 only.
3. `grant-cli.ts` `parseArgv` silently ignores unknown flags (e.g. `--profile x`) instead of erroring — harmless today (profile stays hard-wired) but worth an explicit reject for future flags.

VERDICT: APPROVE_WITH_NITS
