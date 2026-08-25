# Independent adversary — Overlay HUD Expand B0.5 (Security / Trust)

> **Lane**: Security / Trust (ADR-020)  
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.  
> **Date**: 2026-08-25  
> **Repo**: `/Users/huchen/Projects/cmspark`  
> **HEAD**: `feat/knowledge-honesty-wave0` (`2dee37a`)  
> **Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 item 1 / 实现波次 B0.5  
> **Prompt**: `docs/audit/reviews/overlay-hud-expand-b05-dual-review-prompt-20260825.md`  
> **Blast**: **T2 L0 Surface.** ACL grows `thread.delete` / `thread.update`, overlay-safe (trash-only + alias-only). **Not** T3 knowledge / `mcp.add` / overlay confirm dialect.

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

Capability declaration: **present** in the dual-review prompt (matches spec §0 axes). Axes fit: this is **Surface L0** workbench chrome + a **narrow Trust gate** on two already-existing router methods. It is **not** a new runtime, not Pack/Knowledge/MCP composition (those stay T3 / later waves), not a new confirm family.

Trust monotonicity: overlay is **stricter** than tray on the same methods (tray `thread.delete` remains default **hard**; overlay must name `mode:"trash"` or is denied). L0 does not inherit a looser delete semantic.

---

## MACHINE

Commands (cwd `companion/` unless noted):

```text
npx tsc --noEmit                                 # exit 0
npx tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/summoner-thread-manage.test.js \
  .test-dist/tests/summoner-acl.test.js \
  .test-dist/tests/summoner-protocol.test.js \
  .test-dist/tests/summoner-web.test.js \
  .test-dist/tests/thread-cleanup-context.test.js \
  .test-dist/tests/swift-tray-integrity.test.js \
  .test-dist/tests/ws-router-validator-lockstep.test.js
                                                 # 87 pass / 0 fail
shasum -a 256 dist/cmspark-tray
  == SWIFT_TRAY_SHA256
  == e068754969612ff74341cbd12719d7358e1301960396caf610252869e1bd0a3e
```

Adversarial probes (not in the suite) against `applySummonerPayloadPolicy` / `assertSummonerAllowed` and a live loopback `summoner-web` HTTP server. Cited below as `[executed]`.

| Check | Result |
|-------|--------|
| `tsc --noEmit` | PASS `[executed]` |
| slice tests (acl/protocol/thread-manage/web/cleanup/pin/lockstep) | **87 pass / 0 fail** `[executed]` |
| pin lockstep (constant == `dist/cmspark-tray`) | PASS `[executed]` |
| R1 overlay hard / omitted `thread.delete` | **denied**, not coerced `[executed]` |
| R2 overlay `thread.update` writes whitelist / knowledge ids / `config_override` | **cannot** `[executed]` |
| R3 overlay Allow/Deny / `summoner.confirm.*` | **absent** on overlay path `[inspected]` + protocol tests `[executed]` |
| R4 pin ≠ binary | PASS `[executed]` |
| R5 Swift/HTML rename+trash without Side Panel | PASS `[inspected]` + HTML HTTP `[executed]` |
| R6 ACL opened restore / batch_delete / knowledge.* / `mcp.add` | **no** `[executed]` |
| Policy theater (tests only, not lifecycle) | **not theater** — live call before `handleMessage` `[inspected]` |
| Tray default hard still works | PASS (`thread.delete default hard; explicit trash soft`) `[executed]` |

---

## 三层

### Outcome (what a summoner-surface peer can actually do)

| Attack | Outcome |
|--------|---------|
| summoner WS `thread.delete` `mode:"hard"` | `SUMMONER_ACL`, never reaches router |
| summoner WS `thread.delete` omitted `mode` | `SUMMONER_ACL` (router would have hard-deleted; policy fails closed) |
| summoner WS `thread.update` extra keys + valid alias | extra keys **stripped** to `{ alias }`; cannot persist composition |
| summoner WS `thread.update` only `tool_whitelist` / `config_override` / empty alias | `SUMMONER_ACL` |
| HTML `DELETE` with `?mode=hard` or JSON body `mode:hard` | still dispatches `mode:"trash"` |
| HTML `PATCH` nested `updates.tool_whitelist` / top-level extras | only `{ alias }` forwarded; empty/missing alias → 403 |
| `thread.restore` / `thread.batch_delete` / `knowledge.*` / `mcp.add` | method ACL deny |
| Overlay confirm dialect | stdin decoder returns null; Swift overlay uses `NSAlert`; HTML uses `window.confirm` |

### Trajectory (order of gates)

1. WS: `validateWsMessage` → handshake `authState.surface` (server-stamped, not client field) → `assertSummonerAllowed` → **`applySummonerPayloadPolicy`** → `stampCmsparkSurface` overwrite → `handleMessage`. Fail closed with `error_code: SUMMONER_ACL` **before** the router default-hard.  
2. HTML: endpoint constructs a **narrow** payload → `dispatchAllowed` re-applies the same policy with `surface="summoner"` → `dispatchSummonerWeb` on the **summoner** `CompanionClient` (second WS, `surface: "summoner"`) → lifecycle gates again. No tray fallback (unlike `companion.ui.rect`).  
3. Mac HUD: Swift stdin `summoner.thread.trash` / `rename` → `decodeSummonerInbound` (rejects `summoner.thread.delete` and `summoner.confirm.*`) → `handleSummonerThreadTrash/Rename` hard-codes `mode:"trash"` / `{ alias }` on `summonerClient` only.

### Component (where the trust lives)

Load-bearing: `applySummonerPayloadPolicy` in `companion/src/ws/summoner-acl.ts`, invoked from `companion/src/ws/lifecycle.ts` **and** `companion/src/summoner-web.ts` `dispatchAllowed`. Method allowlist alone is **not** sufficient (tray delete defaults hard; `thread.update` can write composition keys) — the slice’s own comment states this, and the payload gate is on the hot path.

Not load-bearing for overlay safety: native `NSAlert` / `window.confirm` (UX only). A token-bearing HTTP client can trash without clicking confirm; it still cannot hard-delete.

---

## Attack results

### 1. Can summoner WS hard-delete? omitted mode?

**No.** `[executed]` on the policy function; `[inspected]` on the WS hot path.

Router still defaults omitted mode to **hard** (tray/legacy contract — must not change):

```1605:1608:companion/src/message-router.ts
    case "thread.delete": {
      // Dual-review B1: keep single-delete default HARD for tray/legacy callers.
      // Soft-delete only when UI explicitly passes mode:"trash".
      const mode = rest.mode === "trash" ? "trash" : "hard"
```

That is why method ACL opening `thread.delete` is unsafe by itself. Overlay payload gate:

```65:79:companion/src/ws/summoner-acl.ts
export function applySummonerPayloadPolicy(
  surface: string | undefined,
  msg: Record<string, unknown>,
): { ok: true } | { ok: false; error_code: "SUMMONER_ACL"; error: string } {
  if (surface !== "summoner") return { ok: true }
  const type = msg.type
  if (type === "thread.delete") {
    if (msg.mode !== "trash") {
      return {
        ok: false,
        error_code: "SUMMONER_ACL",
        error: "SUMMONER_ACL: thread.delete on overlay must use mode=trash",
      }
    }
```

Strict `!== "trash"`: omitted, `""`, `"hard"`, `"Trash"`, `["trash"]` all deny. **No silent coerce to trash.** `[executed]`

Lifecycle applies this **after** method ACL and **returns** (does not call `handleMessage`):

```1038:1051:companion/src/ws/lifecycle.ts
        const gate = assertSummonerAllowed(authState.surface, msg.type)
        if (!gate.ok) {
          ...
          return
        }
        const payloadGate = applySummonerPayloadPolicy(authState.surface, msg)
        if (!payloadGate.ok) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", error: payloadGate.error, error_code: payloadGate.error_code }))
          }
          return
        }
```

Surface is handshake state, not a client-supplied `msg.surface`. Spoof `{ surface: "tray", mode: "hard" }` on a summoner socket still denies. `[executed]`

`stampCmsparkSurface` runs **after** the policy and overwrites `__cmspark_surface` (S20). Client cannot skip the gate by forging the stamp.

Tray omitted mode still passes the policy (no-op when `surface !== "summoner"`). Cleanup test `thread.delete default hard; explicit trash soft` still passes. `[executed]`

Mac HUD / menu-bar never send hard:

```1198:1205:companion/src/menu-bar-agent.ts
async function handleSummonerThreadTrash(threadId: string): Promise<void> {
  const client = summonerClient
  if (!client || !threadId) return
  try {
    const resp = await client.sendAppRequest("thread.delete", {
      thread_id: threadId,
      mode: "trash",
    })
```

Uses `summonerClient` only (no tray-socket fallback). If overlay WS is down, trash is a no-op — fail closed, not tray-hard.

HTML DELETE always constructs `mode: "trash"` and ignores query/body. Live probe `[executed]`:

| Probe | HTTP | Dispatched |
|-------|------|------------|
| `DELETE /api/thread?id=t1&mode=hard` | 200 | `{ type: "thread.delete", mode: "trash" }` |
| `DELETE` + JSON body `{ mode: "hard" }` | 400 empty (body not drained — nit) | still `{ type: "thread.delete", mode: "trash" }` |

`decodeSummonerInbound({ type: "summoner.thread.delete", ... })` is `null`. Swift emits `summoner.thread.trash` only.

**R1 does not fire.**

### 2. Can overlay `thread.update` write `tool_whitelist` / `active_knowledge_ids` / `config_override`?

**No.** Spec says extra keys are **stripped**; empty alias is **denied**. Both hold.

Router **will** persist those keys if they reach it:

```2186:2206:companion/src/message-router.ts
    case "thread.update": {
      ...
      for (const key of [
        "alias",
        "config_override",
        "tool_whitelist",
        ...
        "active_knowledge_ids",
        ...
      ]) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          allowedUpdates[key] = updates[key]
        }
      }
```

Overlay policy replaces the whole `updates` object:

```81:99:companion/src/ws/summoner-acl.ts
  if (type === "thread.update") {
    const updates = msg.updates
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return { ok: false, error_code: "SUMMONER_ACL", error: "..." }
    }
    const alias = overlayAlias((updates as { alias?: unknown }).alias)
    if (!alias) {
      return { ok: false, error_code: "SUMMONER_ACL", error: "..." }
    }
    msg.updates = { alias }
    return { ok: true }
  }
```

`[executed]`:

- `{ alias: "ok", tool_whitelist: null, active_knowledge_ids: ["k"], config_override: {x:1}, pinned_tabs: [1] }` → `updates` becomes `{ alias: "ok" }`
- `{ config_override: {} }` only → deny
- `{ alias: "  ", tool_whitelist: [] }` → deny (empty after trim)

HTML PATCH does **not** forward extra body keys (constructs `{ updates: { alias } }` from `body.alias` only):

```418:427:companion/src/summoner-web.ts
    if (pathOnly === "/api/thread" && req.method === "PATCH") {
      ...
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const alias = typeof body.alias === "string" ? body.alias : ""
      jsonResponse(res, await dispatchAllowed("thread.update", { thread_id: id, updates: { alias } }))
```

Live HTTP `[executed]`:

- `PATCH` body `{ alias: "ok", updates: { tool_whitelist: null, config_override: {} }, tool_whitelist: null, active_knowledge_ids: ["k"] }` → dispatched `{ updates: { alias: "ok" } }`
- empty alias / whitelist-only → **403** `SUMMONER_ACL: thread.update overlay may only set alias`

Top-level extras on a WS `thread.update` (beside `updates`) are ignored by the router (it only reads `rest.updates`). Policy + router are aligned.

Mac HUD rename sends only `alias` via stdin; decoder reconstructs `{ thread_id, alias }`; menu-bar sends `{ updates: { alias: trimmed } }` with no whitelist keys.

**R2 does not fire.**

Residual (not R2, not this slice’s DoD): overlay method ACL already allowed `thread.create`, and `applySummonerPayloadPolicy` does **not** strip `config_override` on create. HTML `POST /api/threads` sends `{}`. A crafted summoner WS `thread.create` could still plant override at birth. Pre-existing S21 hole; recorded as nit.

### 3. Confirm dialect / Allow/Deny in overlay Swift/HTML?

**No overlay confirm dialect.** `[inspected]` + protocol tests `[executed]`.

| Surface | Confirm UX | Allow/Deny / `summoner.confirm.*` |
|---------|------------|-----------------------------------|
| Mac overlay (`SummonerOverlay.swift`) | native `NSAlert` (“重命名” / “移到回收站” / “取消”) | **none** in this file (`rg` 允许\|拒绝\|Allow\|Deny\|确认 → no matches) |
| C-thin HTML | `window.prompt` / `window.confirm` (spec-allowed) | no Allow/Deny buttons; no `summoner.confirm.*` |
| stdin protocol | `isSummonerConfirmDialect` → decode returns null | tests: `{ cmd: "summoner.confirm.allow" }` invalid |

Pinned binary `[executed]`: contains `summoner.thread.rename` / `summoner.thread.trash` and NSAlert informative UTF-8 (`给这条对话一个名字`, `」会离开当前列表。`). Does **not** contain `summoner.confirm`. `mode:"hard"` absent.

`允许` / `拒绝` / `确认` / `confirmAllowButton` **do** appear in `companion/dist/cmspark-tray` because **Tray.swift 确认台 (spike)** still has Allow/Deny — a **different window**, pre-existing L2/HUD confirm, not overlay workbench. R3 is overlay HUD / `summoner.confirm.*`. Do not conflate.

SSE allowlist still fans out `mcp.confirm.pending` as a **status line** (“去侧栏批准”), and explicitly drops other `confirm` types (`/confirm/i` except that one). Not an overlay Allow/Deny dialect.

`security.confirmation.response` is **denied** on summoner ACL. Overlay cannot answer a tray/panel confirm.

**R3 does not fire.**

### 4. HTML PATCH forwarding extra body keys?

**Does not forward them.** Endpoint allowlists `body.alias` only; `dispatchAllowed` re-runs payload policy. Live probe above. `[executed]`

There is **no** generic `/api/dispatch` that would let a client pick `type` + raw body.

### 5. ACL accidentally opened restore / batch_delete / knowledge / `mcp.add`?

**No.** `[executed]` `assertSummonerAllowed("summoner", …)`:

| method | overlay |
|--------|---------|
| `thread.delete` / `thread.update` | allow (then payload-gated) |
| `thread.restore` | **deny** |
| `thread.batch_delete` | **deny** |
| `knowledge.list` / `import` / `use` | **deny** |
| `mcp.add` / `mcp.toggle_enabled` | **deny** |
| `config.set` / `security.confirmation.response` | **deny** |

`SUMMONER_WEB_DISPATCH_ALLOW` is a **second** set. It includes `thread.delete`/`update`, not restore / knowledge / `mcp.add`. Existing `summoner-web.test.ts` already asserts `mcp.add` and `knowledge.*` are absent; `summoner-thread-manage.test.ts` asserts web set lacks `thread.restore`. `thread.batch_delete` is absent from the set (no explicit test — nit).

**R6 does not fire.**

### 6. Policy only in tests, not lifecycle (theater)?

**Not theater.** The unit file source-locks `/applySummonerPayloadPolicy/` in `lifecycle.ts` (weak as a *test*), but the production call at `lifecycle.ts:1045–1050` is on every authenticated post-handshake message, **before** `handleMessage` (`:1280`). HTML has an independent copy at `summoner-web.ts:166–169`.

Production `handleMessage` callers outside tests: `lifecycle.ts` and nextRun drain (`chat.create` follow-up only). Overlay delete/update cannot skip lifecycle via drain.

A summoner-surface client that omits handshake `surface` would be classified **tray** (`rawSurface === "summoner" ? "summoner" : "tray"`). Overlay `CompanionClient` is constructed with `surface: "summoner"` and always sends it (`companion-client.ts:606`). HTML never opens companion WS (Origin stays `chrome-extension://` + `cmspark-tray://local`; loopback page is `http://127.0.0.1`). A local attacker with `ws_secret` + tray Origin can still open a **tray** socket and hard-delete — that is existing tray privilege, not overlay ACL.

---

## ADR-020

- **Surface**: L0 overlay workbench. No L2 classes. No CDP.  
- **Composition**: rename/trash only. Does **not** attach knowledge / MCP add / pack trust. `pack.apply` remains overlay-eligible from earlier S21 (out of B0.5).  
- **Autonomy**: n/a.  
- **Trust**: new gate is payload policy on summoner surface; confirm dialect **reuses** native OS/HTML dialogs; no third confirm family. Trust is **monotonic** vs tray (stricter).  
- **Channel**: community.  
- **No new runtime.** Pack-first N/A (not a new scenario). `originWs` / god-mode / CU L2 untouched.

---

## DoD / REJECT matrix

| ID | Claim | Verdict |
|----|--------|---------|
| DoD 1 | Overlay rename `Thread.alias` without Chrome | PASS |
| DoD 2 | Overlay trash only; omitted/hard → `SUMMONER_ACL` | PASS |
| DoD 3 | `thread.update` alias-only | PASS |
| DoD 4 | Mac ⋯ / right-click + `NSAlert`; no 确认/允许/拒绝/Allow/Deny in overlay Swift | PASS |
| DoD 5 | C-thin `PATCH`/`DELETE` overlay-safe | PASS |
| DoD 6 | Trash current → next or new | PASS `[inspected]` `handleSummonerThreadTrash` + HTML `refresh`/`newThread` |
| DoD 7 | Pin lockstep | PASS |
| DoD 8 | No `knowledge.*` / `mcp.add` / overlay confirm dialect | PASS |
| R1 | overlay hard-delete or omitted mode hits router hard | **no** |
| R2 | overlay update writes composition keys | **no** |
| R3 | HUD Allow/Deny / `summoner.confirm.*` | **no** |
| R4 | pin ≠ binary | **no** |
| R5 | still Side Panel–bound | **no** |
| R6 | ACL opened restore/batch/knowledge/mcp.add | **no** |

---

## Nits (non-blocking)

1. **Lifecycle test is a regex, not a socket.** `summoner-thread-manage.test.ts` only `assert.match(life, /applySummonerPayloadPolicy/)`. A comment would satisfy it. The call site is live (`lifecycle.ts:1045`) so this is **not** theater, but a WS integration (`surface=summoner` + `mode:hard` → `error_code: SUMMONER_ACL` and thread still on disk) would lock the trajectory. Same gap: `handleMessage` itself is still default-hard; overlay safety is entirely upstream.

2. **DELETE HTTP test overclaims.** `"always trashes and ignores hard"` never sends `mode=hard`. Live probe: query `mode=hard` is ignored (good). JSON body on DELETE is also ignored for payload (still trash) but HTTP status was **400 / empty body** because the handler never drains `req`. Drain or ignore-and-200.

3. **Dual allowlists.** `SUMMONER_ALLOW` vs `SUMMONER_WEB_DISPATCH_ALLOW` can drift. Web tests do not explicitly `has("thread.batch_delete") === false` (the set currently omits it).

4. **Residual `thread.create` composition write** on summoner WS (`config_override` ungated). Not R2 (`thread.update`). HTML create is `{}`. Worth a follow-up payload clause if overlay create stays allowed.

5. **HTML confirm is UX-only.** Token + loopback can `DELETE` without `window.confirm`. Correct trust model (server trash-only); do not pretend the dialog is a gate.

6. **Pinned binary string encoding.** UTF-8 literals for `重命名` / `移到回收站` / `取消` are not contiguous in `cmspark-tray`; protocol names + NSAlert informative text **are**. Feature is in the binary; `strings` is a weak HUD UI oracle.

---

## Blockers

None. R1–R6 do not fire. Policy is on the production lifecycle and HTML dispatch paths, not test-only.

---

VERDICT: APPROVE_WITH_NITS
