## Gate #477 (UI slice only)

Reviewed `summoner-web.ts` + `shell-open.ts` + the #477 test diff. No #476 host/ACL expansion demanded. Evidence: static source (`[inspected]`); claimed `71` owning tests + Playwright matrix taken as `[assumed]` machine result, not re-run.

### Contract

| Item | Evidence |
|---|---|
| Sidebar fill full height | ≥760: `.hud{background:var(--rail-bg)}`, `.list` 220px `var(--rail-bg)`, composer/capture `margin-left:220px` so the left column paint continues through the input band |
| Log/composer shared axis | Both use `padding-left/right: max(24px, calc((100vw - 1000px)/2))` after the 220px offset |
| Esc/关闭 → visible control | `closeNavigation()`: `min-width:760px` → `#newChat` (`#historyOpen` is `display:none`); narrow → `#historyOpen`. `#historyClose` and Escape share that path |
| Browser-status errors | Client: `d.error \|\| d.type==="error" \|\| typeof d.connected!=="boolean"` → throw / `无法读取浏览器连接状态`. Server always `{connected: boolean}` behind token; no extra fields |
| MCP DTO | `projectSummonerMcpList` rebuilds `{name, connection:{status}}` only; error path drops extras |
| MCP writes | `/api/mcp/toggle` → 404; allow-list has `mcp.list` only; HTML has no toggle |
| Skills/knowledge | Thread `skill.activate/deactivate` and `knowledge.set_active` only; no import/create chrome |
| Stop | `#stopGo` → `#stop` → `POST /api/abort` → `chat.abort` |
| ACL | No new dispatch/event types in this slice |

Security hold: loopback bind, Host/Origin, HttpOnly cookie, query `token` rejected, CSP nonce, MCP projection, confirm frames still off SSE except `mcp.confirm.pending`.

### Findings

**NIT — sidebar chrome vs fill.** Full-height treatment is background only. `.list{border-right}` lives in `.body`; the 220px gutter beside `.composer`/`.capture-row` is fill without the divider.

**NIT — status/CTA not on the chat axis.** ≥760 `.cta-box,.status{width:calc(100% - 244px)}` vs composer `width:calc(100% - 220px)` plus leftover `margin-right:12px` from `.status{margin:0 12px 8px}`. Log/composer match; banners sit ~24px inward.

**NIT — Esc coverage.** Product focuses a visible control; Playwright only asserts `.history` removed, not `document.activeElement`. Meeting/privacy sheets are not in this Esc path (out of stated scope).

**NIT — browser-status unit test vs query-token ban.** New test hits `/api/browser-status?token=`. `handleRequest` 403s any `token` query before the cookie/header gate. If `request()` forwards that query, the 200 loop is wrong; cookie-stripping harness would hide it. Production GET (cookie/header only) is correct.

No XSS on MCP/thread names (`esc`), no overlay MCP config/env/headers/tools, no Stop-by-new-RPC.

**VERDICT: APPROVE_WITH_NITS**
