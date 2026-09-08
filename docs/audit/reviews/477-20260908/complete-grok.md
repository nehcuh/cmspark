## Gate #477 (UI slice of #476) — independent review

Scope held: visible workspace chrome, read-only MCP, thread-scoped skills/knowledge, no dispatch/ACL growth, Stop → existing `chat.abort`. Not a #476 workbench.

### What is solid
- `/api/browser-status` sits after the shared session-token + Host gate; mutating verbs still need Origin. Predicate is `hasExtensionPeer?.() === true` only.
- MCP: rail visible; `/api/mcp/toggle` still 404; UI is `resource-readonly` (no `mcp.toggle_server`).
- `#stopGo` → `#stop` → `POST /api/abort` → `chat.abort`. Same owner.
- Narrow history: later CSS wins (`position:static`, `max-height:36vh/28vh`). List stays in `.body`; composer is a sibling with `flex-shrink:0` / `z-index:2`. Overlay `inset:0` is superseded.
- Default shell `1040×760` (`OVERLAY_WINDOW_SIZE` + `placeWindow`); compact `360×420` only on toggle. `flex-direction:column` on `.rail` is preserved from the earlier rule; the 759px query correctly switches to wrapping tabs.

---

### P2 — `companion/src/summoner-web.ts` (HTML/CSS)

**Sidebar column does not include composer.** At `min-width:760px` the list is 220px inside `.body`, while `.composer`/`.capture-row` live below with `margin-left:220px`. The rail/list `--rail-bg` stops above the input; the gutter is `--paper`. Readable, but the workspace column is visually truncated.

**Log vs composer axis.** Older `@media(min-width:760px)` still centers `.log` at `max-width:780px`. #477 composer uses `width:calc(100% - 220px)` plus `padding: max(24px, (100vw - 1000px)/2)`. Chat column and field will not share an edge at 760–1440.

**Escape → hidden control.** `keydown` focuses `#historyOpen` after closing history. That node is `display:none` at ≥760px (sidebar always on). Harmless on the Playwright 320 path; a focus dead-end if history class is set on a wide viewport.

### P2 — `loadCompose("browser")` / `api()`

A non-OK JSON body (e.g. 403) is not thrown. `d.connected===true` fails closed as “尚未连接” instead of “无法读取浏览器连接状态”. Loopback cookie makes this rare; the catch path is incomplete.

### NIT
- Two visible “新对话” controls on wide (brand + list). Intentional, still noisy.
- Visible MCP tab now always `GET /api/mcp`. Allowlist already had `mcp.list`; UI only paints name/status, but a full `McpServerMeta` (config/env) can now sit in the page JS. Strip on this surface if that payload is rich.
- `#historyOpen` hidden at 760px is correct; compact `resizeTo(360,420)` re-enables it via viewport CSS.

No P0/P1 on auth, ACL, abort ownership, history covering the field, or window sizes. Tests described (narrow Stop + nav, Escape, MCP empty, peer-status auth) match this source.

**VERDICT: APPROVE_WITH_NITS**
