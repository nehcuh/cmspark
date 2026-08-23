# OS Agent Shell P0 Spike — Ship Note

| Field | Value |
|-------|--------|
| Date | 2026-08-22 |
| Status | **Code spike landed** · machine checklist green · **user falsification (8+5) not run** |
| Plan | `docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md` |
| Brief | [os-agent-shell-brief-2026-08-22.md](./os-agent-shell-brief-2026-08-22.md) (S1–S24) |
| Worktree | `/Users/huchen/.grok/worktrees/projects-cmspark/subagent-01a02969-31cc-7bf0-8eb0-0aa555160e9b` |
| Branch | `feat/site-op-memory` |
| HEAD at checklist | `56248cdad4cd894176d515b7a59ebc66d0280daa` |
| Binary pin | `SWIFT_TRAY_SHA256` = `267e24b256459ad0386a2054f710f672fd65994d81b0441437094dbbe310f483` |

---

## 1. Goal of spike

Prove, on macOS, that **Chrome can be fully quit** and a hashed Swift overlay can still:

1. Hydrate the current thread (≤20 plaintext lines).
2. Send `chat.create` and stream tokens on the **same** `thread_id`.
3. Search thread **titles** (not body / files / apps).
4. When the model calls an L1 tool with no extension peer: return typed `BROWSER_UNAVAILABLE`, **zero auto-retry**, **zero** `tool.execute` on the summoner/tray socket.

Companion remains the only tool-loop. Overlay window/hotkey travel the existing tray stdin pipe. Chat uses a second WS (`Origin: cmspark-tray://local`, handshake `surface: "summoner"`). L1 dispatch is split: conversation origin ≠ actuator. Overlay never renders Allow/Deny.

This is **Axis A L0 capture**, not a fourth axis, not a native chat home, not a confirm dialect. Identity lock: 召唤器不是「主界面」；完整工作面在 Chrome 在场时仍是 Side Panel.

**Explicit non-goals (still true):** Electron / Raycast plugin / marketplace; overlay Pack install / message-body search; five-state Chrome probes; window-rect self-ui; Windows/Linux overlay; auto-replay of the failed L1 tool_call; **GOAL.md / ADR-020 one-liner rewrite**. Overlay local STT (v2 press-hold mic) is a narrow summoner-surface exception, not a Side Panel dictation+ replacement.

---

## 2. UI lock (wireframes + 看山 two-phase)

User lock 2026-08-22: **两段式捕获结构 × Side Panel 看山白底 token**.

| Artifact | Role |
|----------|------|
| [docs/design/os-summoner-p0-chosen.html](../design/os-summoner-p0-chosen.html) | Selected mix: two-phase capture × 看山 tokens |
| [docs/design/os-summoner-p0-wireframes.html](../design/os-summoner-p0-wireframes.html) | Four P0 states |
| [docs/design/os-summoner-p0-wireframes.png](../design/os-summoner-p0-wireframes.png) | Raster of the four states |
| [docs/design/os-summoner-p0-options.html](../design/os-summoner-p0-options.html) | Option set (not the chosen mix) |

**Four wireframe states (P0 must paint):**

1. **检索** — title hits only; hint `P0 不搜正文`.
2. **续聊** — ≤20 plaintext lines (`你` / `助手`), no chat bubbles.
3. **未连接** — badge `浏览器未连接`; honest CTA (must contain **不能替你打开侧栏**); button 激活 Google Chrome (user-gesture `openChrome()` only).
4. **空场** — single 16px-radius composer; no instrument chrome.

**Copy lock:** window title `CMspark 召唤器（实验）`; tray item `召唤器（实验）…`; never 「主界面」. Zero Allow/Deny/确认 on the overlay.

### v2 empty-state (user lock, same day)

Empty overlay **talks**, it does not search:

- Placeholder `说点什么，或按住说话…`. Hint `回车发送到当前线程 · 输入 # 搜标题 · 不搜文件`. Last-thread label `继续 · {title}` when known.
- Send is always visible in talk mode, including **browser detached** (L0 `chat.create` still runs; L1 still `BROWSER_UNAVAILABLE`).
- Title search **only** when composer text (trimmed) starts with `#`. Selecting a hit clears `#…`, stays in talk, focuses composer.
- Empty `thread_id` on submit → newest thread, or `thread.create` then `chat.create`. Overlay claims `composer.lease` (holder overlay) first.

**STT origin (ADR-023 §7.2 narrow amend):** `voice.stt.*` remains extension-only **except** `Origin: cmspark-tray://local` **and** handshake `surface: "summoner"`. Tray menus (`surface: "tray"`) still get `origin_denied`. `privacy_ack_v2` unchanged (mic press = gesture). `voice.model.*` is not on `SUMMONER_ALLOW`. Press-hold 🎙 captures 16 kHz mono WAV (or PCM chunks) and fills the composer via `summoner.dictate` — user hits send. Residual: mic TCC permission; Whisper weights may be absent (`engine_not_local` / model not downloaded).

Wait-for WIP is still out of this note. **GOAL.md / ADR-020 one-liner untouched.**

---

## 3. Commits / worktree path

Worktree: `/Users/huchen/.grok/worktrees/projects-cmspark/subagent-01a02969-31cc-7bf0-8eb0-0aa555160e9b`

Spike range `622fe6c..56248cd` (14 commits, Tasks 1–12):

```text
622fe6c feat(summoner): classify BROWSER_UNAVAILABLE as non-retryable
36b53b7 test(summoner): lock BROWSER_UNAVAILABLE over recoverable substrings
6015d08 feat(summoner): resolve L1 actuator independently of chat origin
ab31194 fix(summoner): never tool.execute on tray/summoner sockets
f4105e6 test(summoner): seed chrome-extension origin for L1 executor tests
bd3f090 feat(summoner): per-connection ACL via handshake surface
4616583 feat(summoner): composer.lease CAS with overlay/panel holders
24ee461 feat(summoner): truncate thread hydrate to plaintext
ea00f85 feat(summoner): stdin protocol without confirm dialect
740836f feat(summoner): tray-side streaming client with surface=summoner
8091043 feat(summoner): macOS overlay window without confirm chrome
3aa9e9a feat(summoner): opt-in hotkey picker, no stolen defaults
9d6ce27 feat(summoner): Side Panel composer standby when overlay holds lease
56248cd fix(computer): treat Swift tray binary as companion UI
```

This ship note is Task 13. **Wait-for WIP** (catalog `wait_for`, `wait-for-mode.ts`, related tests) is **not** in this commit.

---

## 4. Machine checklist results [executed]

Host: macOS arm64 · cwd `companion/` · 2026-08-22.

### 4.1 `npx tsc -p tsconfig.test.json --pretty false`

```text
npm warn Unknown user config "//registry.npmmirror.com" (registry https://registry.npmmirror.com). This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
```

**tsc_exit: 0** — no TypeScript errors.

### 4.2 `node --test` (nine files)

```text
✔ BROWSER_UNAVAILABLE is non_recoverable even if copy mentions not connected (0.458959ms)
✔ substring timeout without code stays recoverable (0.07875ms)
✔ error_code BROWSER_UNAVAILABLE wins over recoverable substrings (0.04675ms)
✔ claim overlay bumps rev; stale rev fails (0.355542ms)
✔ absent lease defaults holder panel (0.053708ms)
✔ assertComposerLease denies non-holder incoming (0.058792ms)
✔ chat.create gate OVERLAY_STANDBY when overlay holds and panel incoming (0.06425ms)
✔ chat.create gate allows panel when lease absent; overlay needs claim (0.081166ms)
✔ matching rev can steal overlay back to panel; release sets panel (0.143584ms)
✔ stampCmsparkSurface overwrites client spoof always (0.07775ms)
✔ composer.lease.get/claim/release handlers round-trip P0 fields (0.132375ms)
✔ validate composer.lease.claim/release/get (1.189791ms)
✔ message-router chat.create uses composer lease gate (0.422916ms)
✔ lifecycle stamps __cmspark_surface from auth after ACL (0.188833ms)
✔ extension-origin loop keeps its own socket as actuator (0.4175ms)
✔ tray origin with no extension peer is BROWSER_UNAVAILABLE (0.123042ms)
✔ tray origin uses picked extension socket, not chat origin (0.083083ms)
✔ missing origin with no extension peer is unavailable (0.053458ms)
✔ summoner allows chat.create and ping (0.610875ms)
✔ summoner denies trust elevation (0.059833ms)
✔ tray surface does not use summoner allowlist (0.0395ms)
✔ summoner allows remaining S21 methods (0.04375ms)
✔ summoner denies anything else not on the allowlist (0.08375ms)
✔ auth.handshake accepts optional surface tray|summoner (0.56075ms)
✔ auth.handshake rejects surface other than tray|summoner (0.293875ms)
✔ CONTINUE_MESSAGE is the exact non-retry user line (0.348875ms)
✔ buildContinueChatCreate uses CONTINUE_MESSAGE and the given thread (0.268583ms)
✔ ATTACH_NOTIFY_COPY tells the user we cannot open the side panel (0.062958ms)
✔ filterThreadsByTitle empty query returns the most recent thread (4.669ms)
✔ filterThreadsByTitle whitespace query is treated as empty (last thread) (0.074625ms)
✔ filterThreadsByTitle matches title or alias includes query (0.0815ms)
✔ filterThreadsByTitle empty-state copy is P0 不搜正文 even with no matches (0.049458ms)
✔ filterThreadsByTitle empty list + empty query yields no match + hint (0.036458ms)
✔ mapChatMessageToSummonerCmd: chat.token → summoner.token (0.094625ms)
✔ mapChatMessageToSummonerCmd: chat.done → summoner.done (0.078125ms)
✔ mapChatMessageToSummonerCmd: chat.error passes error_code (0.06475ms)
✔ mapChatMessageToSummonerCmd ignores unrelated / confirm frames (0.036125ms)
✔ attachChromeOnly calls openChrome and never openSidePanel (0.052041ms)
✔ menu-bar-agent constructs a second CompanionClient with surface=summoner (0.27575ms)
✔ menu-bar-agent attach path uses openChrome, not openSidePanel (0.651042ms)
✔ CompanionClient.sendChatCreate is fire-and-forget (no sendRequest) (0.184917ms)
✔ candidates do not include Spotlight / Raycast / IME space chords (0.304625ms)
✔ stolen defaults canonicalize and are banned (0.92375ms)
✔ safe picker aliases canonicalize into the candidate list (0.1005ms)
✔ empty / unknown combos are not accepted (0.053791ms)
✔ nextSummonerHotkeyCmd prompts when empty, sets when persisted (0.1055ms)
✔ Tray.swift candidate table matches TS and registers Carbon hotkey (0.443708ms)
✔ 25 user messages truncate to last 20 lines (0.378583ms)
✔ tool role line starts with [工具] (0.081459ms)
✔ empty content is skipped (0.259958ms)
✔ user/assistant prefixes 你/助手 (0.04125ms)
✔ no mermaid/html wrapping — plaintext only (0.160125ms)
✔ round-trip summoner.open (0.820791ms)
✔ round-trip summoner.hydrate (0.600709ms)
✔ round-trip summoner.submit (0.103583ms)
✔ round-trip summoner.attach_chrome (0.058167ms)
✔ round-trip summoner.composing (0.071959ms)
✔ remaining outbound cmds round-trip (0.118625ms)
✔ summoner.hotkey.set requires a non-empty combo (0.047292ms)
✔ remaining inbound events round-trip (0.099ms)
✔ { cmd: summoner.confirm.allow } is invalid — no confirm dialect (0.052792ms)
✔ any summoner.confirm.* payload is invalid (0.093958ms)
✔ encoded messages never carry Allow/Deny confirm chrome (0.091125ms)
✔ hydrate is two-phase capture payload — plaintext lines, no chat bubbles (0.038208ms)
✔ parseSummonerLine never throws; invalid JSON is null (0.043458ms)
✔ outbound rejects missing/wrong fields (0.054ms)
✔ inbound rejects missing/wrong fields (0.049542ms)
✔ isSummonerConfirmDialect is false for valid summoner traffic (0.041708ms)
✔ tray originating + ext pick → forward is invoked with ext, not tray (0.374041ms)
✔ tray originating + pick null → browserUnavailableResult; forward NOT called (0.330625ms)
✔ chrome-extension originating → forward with same originating ws (0.075208ms)
✔ production createToolExecutor L1 path calls forwardL1OrUnavailable (lockstep) (0.674125ms)
ℹ tests 72
ℹ suites 0
ℹ pass 72
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 43.431916
```

| File | Pass |
|------|------|
| `l1-actuator.test.js` | 4 |
| `tool-forward-actuator.test.js` | 4 |
| `classify-error-browser-unavailable.test.js` | 3 |
| `summoner-acl.test.js` | 7 |
| `composer-lease.test.js` | 11 |
| `summoner-hydrate.test.js` | 5 |
| `summoner-protocol.test.js` | 16 |
| `summoner-client.test.js` | 16 |
| `summoner-hotkey.test.js` | 6 |
| **Total** | **72 pass / 0 fail** |

### 4.3 No LLM tool named `openChrome` / `launch_browser`

```bash
rg -n "openChrome|launch_browser" companion/src/bridge companion/src/bridge/tool-definitions-catalog.json || true
```

**[executed]** empty output (rg exit 1, no matches).

`openChrome()` exists only as a **user-gesture host RPC** (`platform.ts` / `attachChromeOnly`). It is **not** in `tool-definitions-catalog.json` and is **not** an LLM tool. Catalog names remain existing CDP / host / pack tools; no `launch_browser`.

---

## 5. How to open the overlay

No default hotkey (S11). First overlay open with empty `summoner.hotkey` prompts a picker that bans Spotlight / Raycast / IME space chords.

**Always available without a hotkey:**

1. Companion tray running (hashed `cmspark-tray`).
2. Click the menu-bar icon.
3. Choose **召唤器（实验）…**
4. Window title: **CMspark 召唤器（实验）**

Attach CTA (detached only) calls `getChromeOpener().openChrome()` and notify copy includes `我们不能替你打开侧栏`. Close releases `composer.lease`; close ≠ `chat.abort`.

---

## 6. Manual matrix still needed (not run this session)

Machine units do not replace brief §11. Operator / author still must run, **with Chrome fully quit**:

| # | Check | Why units cannot close it |
|---|--------|---------------------------|
| 1 | Chrome quit | Live attach/detach badge + CTA |
| 2 | Four wireframe states | Search / continue / detached / empty must paint as chosen HTML |
| 3 | IME composing Return | 5/5 smoke: composing Return must **not** submit (S10 OPEN; fail → no-go for CN users) |
| 4 | Continue does not fire L1 | After `BROWSER_UNAVAILABLE`, 已连接，继续对话 is a **new user message** (`CONTINUE_MESSAGE`); `history.db` must show **zero** auto L1 replay |

Also still pending for product gate (brief §11): overlay hydrate of a real thread; non-web question streams; “open a URL” → badge + honest CTA; overlay+Panel dual-open → only one composer writable.

---

## 7. GOAL.md not changed (S24)

[executed] `git diff HEAD -- docs/GOAL.md docs/adr/020-capability-model-three-axes.md` is empty.

- `docs/GOAL.md` last commit: `16491b3 chore(release): bump product version to 0.5.2` — one-liner still **浏览器内的 AI Agent**.
- `docs/adr/020-capability-model-three-axes.md` last commit: `3e651a1` (coding-handoff nits) — §1 一句话定位 unchanged.

S24: HUD L2 productization does not yield. Spike does not rewrite the GOAL / ADR-020 sentence.

---

## 8. Go / no-go

| Decision | Result |
|----------|--------|
| **Code spike (Tasks 1–12) landed?** | **GO** — 14 commits; tsc 0; 72/72 unit; no `openChrome`/`launch_browser` LLM tool |
| **User falsification (8 Side Panel + 5 Raycast/uTools IME users, brief §11)?** | **NOT RUN** |
| **Rewrite ADR-020 / GOAL one-liner?** | **NO** — do not rewrite until §11 pass criteria (≥6/8 complete 1+2 without launching Chrome; task 3 CTA honesty; continue ≠ L1 replay; IME 5/5) |
| **Ship overlay as identity-2 product?** | **NO-GO** until 8+5 falsification is run. Fail → fall back to identity 1 (召唤器 = shortcut), do not slide to Electron |

P0 remaining: operator matrix §6, then the 8+5 cards. P1/P2 (attach state machine, GOAL rewrite) stay blocked on that.

---

*Ship note for OS agent shell P0 spike Task 13. Evidence tagged [executed] was produced on this worktree on 2026-08-22.*
