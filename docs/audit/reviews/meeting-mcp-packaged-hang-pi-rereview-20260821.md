# Pi re-review — meeting stop hang + packaged MCP npx ENOENT (fold confirmation)

| Field | Value |
|-------|--------|
| **Date** | 2026-08-21 |
| **Reviewer** | Pi (eval-engineering-gate confirmation sequence). Did **not** implement. |
| **Batch** | `meeting-mcp-packaged-hang-20260821` |
| **Base claimed** | `50869a9` |
| **Diff (frozen)** | `docs/audit/reviews/meeting-mcp-packaged-hang-diff-20260821.patch` (includes B1/B2 fold) |
| **Blast** | T2 (L0 meeting UX + Compose mcp-server spawn env) |
| **Evidence** | Live files **[inspected]**. MACHINE **[assumed]** (this judge has no shell; implementer this session: chrome-extension hang/caps EXIT 0, companion mcp EXIT 0, package-gates 112/0). Installed `/Applications/CMspark.app` **not re-probed**. |

## Confirmation-order status

1. MACHINE green — implementer-reported this session; **not re-run here**.
2. Independent adversaries:
   - Meeting/STT: `APPROVE_WITH_NITS`
   - MCP/packaging: `APPROVE_WITH_NITS`
   - Product/DoD: **`REJECT` (B1, B2)** — synthesis says both were absorbed after REJECT
3. Pi: confirm or reject the **fold** against **live** source. Product B1 still true in live `MeetingPanel` → mandatory `REJECT`.

## Capability declaration (checked)

```text
Surface:      L0 (会议工作台 STT / 结束并生成纪要)
L2-classes:   (none)
Compose:      mcp-server (stdio spawn PATH + npm_config_prefix)
Autonomy:     single
Trust:        无新确认门；MCP stdio env 仍走 allowlist（不 dump process.env / user_env）
Channel:      community
```

Axes fit. Fold does not add chrome, confirm dialect, L2 tool, or a “中层 Agent”. MCP remains Composition.

---

## 1. The two Product blockers — live check

### B1 — stuck 「生成中…」 after 「结束并生成纪要」 + Companion death

**Product required to lift:** (a) `generate:false` + enabled generate CTA + honest copy, **or** (b) retry `generate_minutes` after `connectionState==="connected"` and time out busy if send fails.

**Live path [inspected]**

Incident click still sets `wantGenerateRef` and `phase=stopping` (`MeetingPanel.tsx:775-786`). Disconnect debounce (5s) / failsafe (20s) / adapter `onEnd` still share `finalizeCapture` (`:370-418`, `:422-448`, `:523-528`). `finalizedRef` first-wins unchanged.

What Product cited as B1 is **gone**:

| Pre-fold (Product evidence) | Live fold |
|---|---|
| `finalizeCapture` set `busy+pendingGenerate` **then** fire-and-forget `meeting.generate_minutes` | Those two `setBusy/setPendingGenerate` lines **removed** (`:380-414`). Minutes go through `sendMinutesJob` **after** refine drain |
| `sendViaRuntime` drop + no busy timeout → 「生成中…」 forever; CTA `disabled={busy}` | `sendMinutesJob` (`:342-364`): if `meetingMinutesSendPlan(connected)==="defer-reconnect"`, **clears** busy/pending, sets retry flag, honest copy. If connected, sets busy and sends |
| No retry | Reconnect effect (`:450-456`) sends when `companionConnected && retry && phase==="idle"` |
| No busy timeout | Watchdog 90s on `pendingGenerate` (`:458-467`, `MEETING_MINUTES_WATCHDOG_MS` in `meeting-caps.ts:45`) unsticks + tells user to click again |
| CTA label stuck 「生成中…」 (`:1710-1712`) | After defer: `busy=false`, `pendingGenerate=false`, `capturing=false` (`:183-187`) → button **enabled**, label 「生成会议纪要」 |

`meetingMinutesSendPlan` (`meeting-caps.ts:47-50`) is the testable seam. Manual 「生成会议纪要」 also goes through `sendMinutesJob` (`MeetingPanel.tsx:1103-1126`), so a known-disconnect click cannot re-stick busy (same-tick `setBusy(true)` in `generate()` is overwritten by the defer branch; React 18 batches).

**Incident mapping (Companion already dead, 5s debounce fires with `wantGenerate=true`):** UI `connectionState` is polled every 3s (`useWebSocket.ts:1873-1889`). By the time the 5s debounce runs, `companionConnectedRef` is false → **defer, not send**. Auto-retry on reconnect. B1 as Product wrote it is **not** true in live code.

**Not a remaining B1**

- 90s watchdog on a **false-connected** dropped send (`sendViaRuntime` still ignores SW `{ok:false}` at `MeetingPanel.tsx:74-79` / `background/index.ts:1318-1324` / `ws-client.ts:209-231`) is Product option (b) done incompletely, not “forever stuck”. See N-fold-1.
- No `meeting.list` / load-last UI: Product marked **optional**. Closing the panel still drops in-memory transcript + retry flag. Pre-existing; panel-open incident path recovers.

**Verdict on B1:** **FIXED** in live `MeetingPanel`. Not a blocker.

### B2 — TROUBLESHOOTING present-tense overclaim (installed 10:00 `.app`)

Live `docs/TROUBLESHOOTING.md:73` **[inspected]**:

> **已发布的旧包没有这层修复**——立刻可用的办法是… `env.PATH` …或… `npm_config_prefix` …**新版本** Companion 会把「带 npx 的 node 目录」排在打包 node 之前，并默认 pin 这个 prefix。

Does **not** claim the running `/Applications/CMspark.app` is already fixed. Matches implementer honesty + Product’s required version caveat.

`docs/mcp.md:200-201` still says “Companion 会自动补充 nvm、homebrew” with no version split (Product extra evidence). That is **not** the B2 sentence they required to change. Residual docs nit (N-docs-1).

**Verdict on B2:** **FIXED**. Not a blocker.

---

## 2. Agree / disagree with adversaries (post-fold)

### Product (`REJECT` B1, B2)

| # | Finding | Live | Agree? |
|---|---------|------|--------|
| **B1** | Dead-socket `generate_minutes` leaves 「生成中…」; copy lies | Fold: defer + retry + 90s watchdog. Incident debounce path unsticks immediately | **Was true; now false.** Do not carry REJECT |
| **B2** | TROUBLESHOOTING speaks as if 10:00 `.app` is patched | `:73` names 旧包 + workaround + 新版本 | **Was true; now false** |
| N1 | `stopGrace` 12s vs large/slow last window; turbo `empty_result` banner | Unchanged: `local-stt-adapter.ts:65-69,203,990-994,851-881` | **Agree (nit)** |
| N2 | 5s debounce vs packed-MV3 alarm floor unproven | Unchanged constants + 3s UI poll | **Agree (nit)** |
| N3 | `config.env.PATH` verbatim; prefix combo untested | Unchanged `transport.ts:225`; prefix still applied unless override `:228-237` | **Agree (nit)** |
| N4 | Windows launcher / SEA / mkdir mode | Unchanged | **Agree (nit)** |
| N5 | Adapter hang tests would fail old code; MeetingPanel recovery untested | Adapter tests still the real RED. B1 fold test is **only** the 3-line helper (`meeting-caps.test.ts:61-65`) — deleting `sendMinutesJob` defer in the panel would still pass | **Agree, and the fold made this worse** (N-fold-3) |

### Meeting/STT (`APPROVE_WITH_NITS`)

| # | Finding | Live | Agree? |
|---|---------|------|--------|
| Hang closed (adapter re-arm + 20s failsafe + 5s debounce + stopping copy) | `local-stt-adapter.ts:975-995`; `MeetingPanel.tsx:422-448`; `meeting-caps.ts:54-69`; wired `:1646` | **Agree** |
| N1 interimText masks 「正在结束」 | `meeting-caps.ts:62` still before `phase==="stopping"` | **Agree (nit)** |
| N2 20s failsafe does not extend infer | Comment at `meeting-caps.ts:30-34` still overclaims; adapter kills at 12s | **Agree (nit)** |
| N3 last window drop | Unchanged | **Agree (nit)** |
| N4 turbo `empty_result` banner | Unchanged | **Agree (nit)** |
| N5 React effects untested | Still true; now also B1 wiring | **Agree (nit)** |
| N6 duplicate `CapturePhase` | `MeetingPanel.tsx:59` vs `meeting-caps.ts:52` | **Agree (nit)** |
| N7 streaming `waited < 300` tautology | Not re-read line-by-line this pass; original citation accepted | **Agree (nit)** |
| N8 disconnect-first eats `wantGenerate` | Still true for auto-minutes. Fold **improves** the follow-up: idle 「生成会议纪要」 now defers + retries instead of sticking busy | **Agree (nit, milder)** |
| Attack #1 double finalize | `finalizedRef` still sync first-wins. Fold adds a **new** double-`generate_minutes` window (N-fold-2), not double finalize | **Agree hang-safe; see fold nit** |

Meeting verdict **APPROVE_WITH_NITS** still correct for the hang itself.

### MCP (`APPROVE_WITH_NITS`)

| # | Finding | Live | Agree? |
|---|---------|------|--------|
| No MCP blocker; incident PATH + prefix real | `dirHasNpx` `:47-57`; unpaired **not** prepended `:75-78`; prefix pin `:228-237`; allowlist `:174-208` no secret spread | **Agree** |
| NIT-1 `launch-companion.sh` is not DMG Aqua | Source script **does** export prefix (`scripts/launch-companion.sh:8-11`). Product `.app` entry is still Mach-O / `host.swift`, not this script. Package-gates only grep the script (`test-package-gates.sh:137-143`) | **Agree (nit)** |
| NIT-2 unpaired Resources last vs leftover PATH | **Folded.** Live `:167-169` strips unpaired `nodeDir` from leftover segments and `tail.push`s it last. Incident `PATH=Resources:nvm-bin` → nvm scan in HEAD, Resources last | **Was true; now false** |
| NIT-3 verbatim PATH; prefix combo untested | Still `env.PATH = configEnv?.PATH \|\| buildSpawnPath()` (`:225`); p0 test still does not combine Resources-first PATH + prefix | **Agree (nit)** |
| NIT-4 Windows / SEA | Unchanged | **Agree (nit)** |
| NIT-5 mkdir no `0o700` | `transport.ts:232` still `{ recursive: true }` only | **Agree (nit)** |
| NIT-6 allowlist / no `process.env` spread | Unchanged; prefix not inherited from `process.env` | **Agree** |
| NIT-7 classic `stop()` no re-arm | `local-stt-adapter.ts:998-1001` | **Agree (nit)** |
| NIT-8 interim vs stopping copy | Same as Meeting N1 | **Agree (nit)** |
| NIT-9 tests skip / no incident PATH fixture / gates are string greps | `mcp.test.ts:237-257` still conditional on runner `execPath` dir + sibling npx. **No new leftover-PATH fixture** for the NIT-2 fold. Gates still grep `launch-companion.sh` | **Agree (nit)** |
| NIT-10 live `.app` unpatched; don’t ship “installed is fixed” | TROUBLESHOOTING now honest. This judge did not re-list `/Applications/CMspark.app` | **Agree as residual, not B2** |

MCP `APPROVE_WITH_NITS` still correct; NIT-2 is absorbed.

---

## 3. New holes from the fold (adversaries could not have scored these)

### N-fold-1 — `sendViaRuntime` still ignores SW `ok:false` (incomplete Product (b))

**file:line:** `MeetingPanel.tsx:74-79`, `:357-363`; `background/index.ts:1318-1324`; `ws-client.ts:209-231`; poll lag `useWebSocket.ts:1889`

If the panel still thinks `connectionState==="connected"` (≤3s poll) and `onEnd`/`sendMinutesJob` runs on a dead socket, the send path sets `busy+pendingGenerate` and drops the message. Retry flag is **cleared** (`:354`). Unstick is the **90s** watchdog, not immediate defer.

Not B1: Product allowed “time out busy if send fails”. Bounded, copy at `:464` is honest. Should still treat SW `{ok:false}` as `defer-reconnect` (or arm retry) instead of waiting 90s.

### N-fold-2 — busy no longer set at start of `finalizeCapture` → double-submit window

**file:line:** `MeetingPanel.tsx:370-414` (removed immediate `setBusy`/`setPendingGenerate`); drain up to ~22s then 150ms then `sendMinutesJob`

During refine drain, `phase` is already `idle` (`:375`), so `capturing` is false and the generate CTA is **enabled** while auto-generate is still queued. A click calls `generate()` → `sendMinutesJob`, then the IIFE calls `sendMinutesJob` again. Two `meeting.generate_minutes`. Hang-safe (`finalizedRef` does not apply to minutes). Wasteful / possible `meeting.error` flicker.

### N-fold-3 — B1 lock is not machine-checkable in the panel

**file:line:** `meeting-caps.test.ts:61-65` vs `MeetingPanel.tsx:342-364,450-467`

The new test only asserts `meetingMinutesSendPlan(false)==="defer-reconnect"` and the 90s constant. There is **zero** `MeetingPanel` test (`chrome-extension/tests` has no `MeetingPanel` reference). Deleting the defer branch in the panel would stay GREEN. Same class as Meeting N5, now covering the Product blocker that just got folded.

### N-fold-4 — reconnect retry is edge-triggered and bails without clearing the flag

**file:line:** `MeetingPanel.tsx:450-456`

```ts
if (phaseRef.current !== "idle") return  // retry flag stays true
```

Effect deps are `[companionConnected, sendMinutesJob]`. If the user starts a **new** recording while waiting for reconnect, the retry is skipped and **never** re-armed on later idle. Next WS blip may fire minutes against the **new** `meetingIdRef`. Low likelihood; messy.

### N-fold-5 — disconnect copy wins over defer copy

**file:line:** `MeetingPanel.tsx:442` then `:347-351` (`setError(prev => prev || …)`)

Debounce writes 「可基于已有转写生成纪要」 first; defer’s 「重连后将自动生成纪要」 is swallowed. Not a lie (CTA is enabled). Incomplete.

None of these restore Product B1 (forever stuck 生成中 + lying copy) or B2.

---

## 4. MCP / launch live (fold + residuals)

| Item | Live | Score |
|------|------|--------|
| `dirHasNpx` | `transport.ts:47-57` (`npx.cmd`/`npx.exe`/`npx` on win32) | Hold |
| Unpaired `nodeDir` last, including leftover PATH | `:75-78,167-169` | Hold (NIT-2 folded) |
| `buildMcpStdioEnv` prefix under `~/.cmspark-agent/npm-prefix` unless `config.env` override | `:225-237` | Hold |
| Secrets excluded | `:174-208`; p0 test | Hold |
| `config.env.PATH` verbatim | `:225`; `mcp.test.ts:401-418` **requires** it | Residual NIT-3 |
| `launch-companion.sh` prefix | `scripts/launch-companion.sh:8-11` | Hold as **zip/staging** script, not DMG executable (NIT-1) |
| Package-gates 112/0 | Implementer **[assumed]**; gates are string greps | Weak for Aqua launch |

---

## 5. External DoD (source tree, not 10:00 `.app`)

| DoD | Result | Evidence |
|-----|--------|----------|
| `adapter.stop()` no STT ACK → `onEnd` within stopGrace | **Hold [inspected]** | re-arm `:990-994`; `pendingWaitMs` `:203`; tests cited by Meeting adversary |
| Stopping hint ≠ 「正在听…约 8 秒」 | **Hold** (empty interim) | `meeting-caps.ts:62-63`; `MeetingPanel.tsx:1646` |
| Disconnect 5s < failsafe 20s | **Hold** | `meeting-caps.ts:35,42`; test `:33-38` |
| 「结束并生成纪要」+ Companion death → minutes **or** working generate CTA | **Hold** for known-disconnect (defer + enabled CTA + retry). Race false-connected: 90s then enabled CTA | B1 section |
| `buildSpawnPath` npx-pair before Resources | **Hold** logic; test still conditional | `transport.ts:167-169`; `mcp.test.ts:248-253` |
| `buildMcpStdioEnv` prefix + secrets | **Hold** | `transport.ts:228-237`; p0 test |
| `launch-companion.sh` has prefix | **Hold as source** | `:8-11`; gates `:137-143` |
| TROUBLESHOOTING does not claim installed app is fixed | **Hold** | `:73` |
| No new L2 / confirm / default-on / 中层 Agent | **Hold** | fold = panel send plan + MCP env + docs |
| Pack-first / no new chrome | **Hold** | |

10:00 `/Applications/CMspark.app` remains unpatched until rebuild. Out of source DoD. Do not merge-communicate “user’s installed DMG is fixed.”

---

## 6. Capability checklist (ADR-020)

| Check | Result |
|-------|--------|
| Axes fit | Pass. Hang = Surface L0. MCP PATH/prefix = Compose `mcp-server`. |
| Do not call MCP a 中层 Agent | Pass |
| Pack-first / no new primary chrome | Pass |
| New confirm dialect | None |
| Trust monotonicity | N/A (no deeper Surface). Prefix default is data-dir; operator `config.env.npm_config_prefix` can still aim at the bundle (MCP NIT-5) |
| originWs | Untouched |
| No new runtime | Pass |
| Experimental locators as write-path success | Untouched |
| P1-1..P1-4 | Untouched |

---

## 7. Three layers

| Layer | Assessment |
|-------|------------|
| **Outcome** | Source DoD for the two incidents holds, including Product’s user-visible minutes/CTA recovery on the incident (known-disconnect) path. 10:00 binary is still the old binary. |
| **Trajectory** | Fold stayed on B1/B2 + MCP leftover-PATH. No drive-by chrome/L2. Claim 4 (DMG via `launch-companion.sh`) remains a mechanism overclaim. |
| **Component** | Remaining: `sendViaRuntime` fire-and-forget; watchdog-only false-connected unstick; panel tests missing; leftover-PATH untested; `config.env.PATH` verbatim; launchers other than `launch-companion.sh`; last-window 12s; no load-last. |

---

## 8. Nits I keep (non-blocking)

1. **N-fold-1** — honor `sendResponse({ok:false})` as defer/retry; 90s is a backstop, not the send-fail path.
2. **N-fold-2** — set `pendingGenerate` (disable CTA) at the start of `finalizeCapture` when `wantGenerate`, not only after drain.
3. **N-fold-3** — one panel-level test that `sendMinutesJob` defer clears busy (or that a mocked disconnected finalize does not leave `pendingGenerate`).
4. **N-fold-4** — retry on idle **or** clear the flag when starting a new capture.
5. **MCP NIT-1 / NIT-3 / NIT-4 / NIT-5 / NIT-9** — DMG/`host.swift` prefix; verbatim PATH + untested combo; Windows launcher; mkdir mode; incident PATH fixture (now including leftover-PATH last).
6. **Meeting N1–N5, N8** — interim copy; 12s last window; turbo banner; untested React failsafe; disconnect-first skips auto-minutes.
7. **N-docs-1** — `docs/mcp.md:200` still present-tense with no 旧包 split.
8. **No load-last meeting** — optional completeness; reopen-panel = blank remains.

---

## 9. What I executed / inspected

**Inspected:** Product/Meeting/MCP/synthesis reports; dual-review checklist; frozen patch (B1/B2/PATH-tail hunks present); live `MeetingPanel.tsx` (sendMinutesJob, retry, watchdog, finalizeCapture, generate CTA); `meeting-caps.ts`; `meeting-caps.test.ts`; `local-stt-adapter.ts` stop/pending; `transport.ts` `dirHasNpx`/`buildSpawnPath`/`buildMcpStdioEnv`; `launch-companion.sh`; `TROUBLESHOOTING.md:73`; `docs/mcp.md:200`; `ws-client.ts` `send`; `background/index.ts` meeting forward; `useWebSocket.ts` 3s poll; `meeting-handlers.ts` `generate_minutes`; `mcp.test.ts` PATH tests; `p0-deep-diagnosis-batch.test.ts`; `test-package-gates.sh:137-143`.

**Not executed:** `tsc` / `node --test` / `test-package-gates.sh`; live `PATH=Resources:nvm-bin npx`; installed `.app` listing. MACHINE line is **[assumed]** from the implementer session, not this judge.

---

## 10. Decision

Product REJECT was earned **on the pre-fold tree**. Live tree absorbs B1 (incident path defers, CTA not stuck, retry + watchdog) and B2 (TROUBLESHOOTING names 旧包). MCP leftover-PATH nit is folded. Fold introduces real but non-blocking holes (ignored SW send result, drain-time double submit, helper-only test). Meeting hang fix stands.

Not clean `APPROVE`: nits above are real. Not `REJECT`: Product B1 is **not** still true in live `MeetingPanel`.

VERDICT: APPROVE_WITH_NITS
