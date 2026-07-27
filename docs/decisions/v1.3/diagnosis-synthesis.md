# cmSpark Deep Diagnosis — Synthesis

**Date**: 2026-07-24
**Auditors**: 9 Explore agents (subsystem maps) + 5 Explore agents (cross-cut dimensions)
**Reviewer swap**: Kimi → **Grok** per memory rule
**Container e2e**: skipped (no Node val-base image; Swift binary requires macOS)

---

## Methodology

10 mapping agents fanned out across subsystems (companion server, security, host-use, tray, llm+bridge, skills, threads+history, obsidian, extension background [failed 429], extension sidepanel+popup). 5 cross-cut audits covered architecture, correctness, security, tests+ops, WS protocol. This synthesis consolidates 14 reports into a prioritized backlog.

---

## P0 — Critical findings (must fix before next ship)

### Security P0s

**[S-P0-1] `CMSPARK_HOST_BIN` env override bypasses biometric gate**
`companion/src/host-use/darwin/host-bin.ts:15-20`
Production-disabled by `NODE_ENV`, but packaged apps leave `NODE_ENV` unset. `launchctl setenv CMSPARK_HOST_BIN /tmp/evil` substitutes the binary that performs Touch ID — returns `{verified:true}`, defeats the Q1 ship blocker ("biometric per-call for writes is non-negotiable").
Fix: Refuse env override unconditionally; add `SecStaticCodeCheckValidity`.

**[S-P0-2] Tray binary SHA256 TOCTOU + auto-rebuild substitution**
`companion/src/tray/swift-tray-bridge.ts:41-48, 88-103`
`verifyIntegrity` hashes then `spawn` — classic TOCTOU. On mismatch, auto-rebuild via `bash build-tray.sh` from hard-coded cwd. Race-replacing `dist/cmspark-tray` gains the privileged `respond()` path (bypasses `originWs`); malicious tray emits `{type:"confirm-response", approved:true, id:<guessed>}` to self-approve L2.
Fix: `fstat+execv` from same fd, or `clonedFd` from verified inode; gate `build()` behind explicit user prompt.

**[S-P0-3] `page-sanitizer.ts` bypass: nested scripts + slash-separated event handlers**
`chrome-extension/src/background/page-sanitizer.ts:15, 30`
`<scr<script>ipt>` survives one strip pass → `<script>`. `<img/onerror=...>` (slash, no whitespace) bypasses `\s+on\w+\s*=`. No re-pass.
Fix: Re-pass until stable; use DOMPurify server-side; broaden event-handler regex to `[\s/]+on\w+`.

**[S-P0-4] `*.suffix` wildcard apex-collapse**
`companion/src/security.ts:25-28`
`*.example.com` matches bare `example.com`. A user-typed `*.com` in config.json = global bypass. Config-edit path not validated against this rule (only the WS-injected `add_to_whitelist` path is).
Fix: Config sanitizer rejecting `*` and bare-TLD wildcards; reverse apex-collapse per RFC 6125.

**[S-P0-5] HMAC `validateToken` early-return timing oracles**
`companion/src/security-policy.ts:106-124`
`timingSafeEqual` only on final sig check; existence/type/ttl mismatches leak via early-return. Plain `code !== code` compare (non-constant-time).
Fix: Constant-time on every check, or hash+compare the inputs.

### Correctness P0s

**[C-P0-1] ThreadManager unguarded read-modify-write**
`companion/src/threads/thread-manager.ts:172-369`
`addMessage`/`update`/`create`/`delete` all do sync read→modify→write on `index.json` + per-thread `.json`. No mutex. Multi-client (server.ts:3479 supports it) + concurrent addMessage on same thread = lost message.
Fix: Per-file async queue (or process-wide for index.json).

**[C-P0-2] `historyStore.record` does full DB export on every tool call**
`companion/src/history/store.ts:305-328, 348-374`
`db.export()` (WASM→bytearray) + tmp+rename on EVERY record. Under load (50 tool calls), blocks event loop 50×. Crash between INSERT and following save() = inconsistent state.
Fix: Batch writes via transaction; periodic checkpoint, not per-row.

**[C-P0-3] historyStore schema has no migrations / `user_version` pragma**
`companion/src/history/store.ts:330-346`
Additive `CREATE TABLE IF NOT EXISTS` only. Adding a column or changing redaction format breaks old DBs silently.
Fix: `PRAGMA user_version` + migration runner.

**[C-P0-4] historyStore `init()` race**
`companion/src/history/store.ts:272-298`
`this.ready = this.init()` is async; `record()`/`query()` only check `if (!this.db)`. Calls between construction and `await initSqlJs` resolution silently no-op.
Fix: All public methods `await this.ready`.

**[C-P0-5] Tray `ConfirmController.show()` orphaned timers on preempt**
`companion/src/tray/Tray.swift:643-650`
A new request arriving while `pendingId != nil` auto-denies the prior, but does NOT invalidate prior `tickTimer`/`timeoutTimer`. Two tickTimers fire; orphaned timer prematurely denies new id.
Fix: Call `cleanup()` at top of `show()` before scheduling new timers.

**[C-P0-6] WS close orphans tray in-flight confirms**
`companion/src/server.ts:3485-3506`
`rejectAll("disconnect", ws)` rejects WS-side entries but does NOT call `tray.cancelConfirm()`. Tray dialog stays modal until its own timeout.
Fix: Track active `sharedConfirmId` per ws; cancel tray on disconnect.

**[C-P0-7] Tray promise rejects silently — unhandled rejection + orphaned WS pending**
`companion/src/server.ts:780-783`
`trayPromise` fed straight into `Promise.race`. If tray adapter rejects (IPC error, Swift crash), race picks rejection; `wsPromise` lingers in `securityConfirmations.pending` until 45s timeout.
Fix: Wrap tray promise with `.catch(() => null)` + null-check winner.

### Architecture P0s (block future work)

**[A-P0-1] `server.ts` is a 3582-line god-module**
~30 module-level mutable maps; 5 security gates inlined; tool dispatch via switch + ad-hoc `if` ladder; tray dispatch inlined. Daemon mode + capability-token P0b will collide here.
Fix: Carve into `transport/`, `gates/`, `tools/registry.ts`, `state/` modules.

**[A-P0-2] WS transport not encapsulated**
`WebSocket` / `ws.send` / `readyState` literals in ≥9 files. Port `23401` hardcoded in 4 places. No `Transport` interface.
Fix: Extract `Transport` interface; inject into gates & dispatchers.

**[A-P0-3] No ToolRegistry**
Adding `host_app` required edits across 4 sites in server.ts. Capability-token P0b requires touching the same blast radius.
Fix: `ToolRegistry` with `register(name, handler, schema)`.

### Ops P0s

**[O-P0-1] CI matrix is `ubuntu-latest` only**
`.github/workflows/ci.yml:11`
All platform-specific tests skipped on Linux (`{ skip: !WIN }`). Release ships to Windows + macOS but those paths never run in CI.
Fix: Matrix `ubuntu-latest` + `windows-latest` + `macos-latest`.

**[O-P0-2] Binary not codesigned/notarized**
`release.yml:122-124`, `scripts/create-dmg.sh:96` does ad-hoc only. Windows side has no signing. Users trained to `xattr -d` are primed for supply-chain attacks.
Fix: Developer ID + notarization (macOS); Authenticode (Windows).

**[O-P0-3] No auto-update mechanism**
No version check anywhere. Users run stale, known-vulnerable builds indefinitely.
Fix: Startup GitHub Releases API check + notify.

---

## P1 — High-priority (next 2 weeks)

### Security
- **[S-P1-1]** `isAllowedWsOrigin` accepts ANY chrome-extension id (`server.ts:77`). Pin to specific extension id.
- **[S-P1-2]** `respond()` privileged path is `public`. Make it accept branded `TrayRespondToken` only.
- **[S-P1-3]** content-sanitizer uses `.replace()` without `/g` — only first match replaced (`content-sanitizer.ts:100`).
- **[S-P1-4]** page-sanitizer misses `formaction`, `xlink:href`, `srcset`, `cite`, `background`, `data:image/svg+xml`.
- **[S-P1-5]** Thread-trust `clearBundle` TOCTOU between policy change and trust-map read (`thread-approvals.ts:74-87`).
- **[S-P1-6]** `image-src-exfil` regex 40-char window trivially evaded (`security.ts:230`).
- **[S-P1-7]** Skill-craft LLM output parsed with hand-rolled regex; description/body not sanitized.
- **[S-P1-8]** `skill-engine.ts:282-285` sends `sk-placeholder` on misconfig → leaks skill inventory to unauth third party.
- **[S-P1-9]** Skill-craft `safeName` not length-capped → 10KB directory names.
- **[S-P1-10]** Skill import doesn't reject symlink entries in zip.
- **[S-P1-11]** `recordExperience` uses `Date.now()` for id — collision-prone under rapid calls.
- **[S-P1-12]** `llmRerank` leaks all skill descriptions/tags to configured LLM endpoint.
- **[S-P1-13]** `ws_secret` rendered by Swift binary → captured in crash dumps.

### Correctness
- **[C-P1-1]** `adapter.ts:96` `MAX_TOOL_CALL_ROUNDS=100` with no token/dollar cap. Unbounded spend per chat turn.
- **[C-P1-2]** Extension-forwarded tool path ignores `signal` — abort can't cancel in-flight extension call (`server.ts:1265-1333`).
- **[C-P1-3]** `tab-resolver.ts` orphaned — adapter only uses `pinned_tabs[0]`, bypassing semantic recovery.
- **[C-P1-4]** `tabUrlCache` no TTL/eviction — closed-and-reopened tab keeps stale hostname (`server.ts:148`).
- **[C-P1-5]** `adapter.ts:534-866` tool loop sequential — parallel tool calls from LLM executed one at a time.
- **[C-P1-6]** `adapter.ts:329-349` context compaction can orphan tool messages → OpenAI 400.
- **[C-P1-7]** `useWebSocket.ts:148-151` streaming content not cleared on disconnect mid-stream.
- **[C-P1-8]** Tray `handleCrash` doesn't reject `pendingConfirms` — up to 64s wait after crash (`swift-tray-bridge.ts:292-314`).
- **[C-P1-9]** `record()` swallows all errors silently; history.db grows unbounded if retention shrinks at runtime.
- **[C-P1-10]** No file lock on `history.db` — concurrent companions = last-writer-wins data loss.
- **[C-P1-11]** SwiftTrayAdapter `kill()` SIGTERM→SIGKILL race with `handleCrash` respawn.

### Architecture
- **[A-P1-1]** Security gate ownership smeared across 4 modules — recommend `SecurityGate.evaluate()` facade.
- **[A-P1-2]** `tabUrlCache` ↔ `pendingToolCalls` ↔ `securityConfirmations` triangle with no invariant test.
- **[A-P1-3]** Tray↔server circular-ish coupling; `origin === "cmspark-tray://local"` is special-case hole.
- **[A-P1-4]** Only 4 of 102 tests import `server.ts`; gates untestable without WS server.

### Ops
- **[O-P1-1]** Log redaction regex misses keys (`credential`, `private_key`, `client_id`, `tenant`, `ws_url`); `modelMirror` URL not redacted.
- **[O-P1-2]** Log rotation single-file; `.1.log` unlinked on second rotation.
- **[O-P1-3]** `crash.log` unbounded — no rotation, no cap, no pruning.
- **[O-P1-4]** No metrics endpoint; `pendingToolCalls`/`mcpSessionByWs`/`tabUrlCache` growth untested.
- **[O-P1-5]** No Windows crash recovery (schtasks /run on logon, no Restart).
- **[O-P1-6]** Config validation shallow — typo `api_ke` silently drops key.
- **[O-P1-7]** No mid-tool disconnect integration test for server loop.

### WS protocol
- **[W-P1-1]** No protocol version handshake — v3 extension + v2 companion silently degrades.
- **[W-P1-2]** Streaming sends accumulated full content per token — O(n²) bytes (`adapter.ts:451`).
- **[W-P1-3]** Reconnect >5s = stale toolCallId silently dropped; no replay log.
- **[W-P1-4]** `abortControllers` keyed by thread_id, not request id — concurrent ops on same thread abort each other.
- **[W-P1-5]** No JSON schema validation — hand-rolled per-type switch.

---

## P2 — Medium (background)

### Code quality
- `server.ts:3094` API key masked but logged to stdout (acceptable for CLI, noisy on shared box).
- `tab-resolver.ts` keyword extraction EN+ZH only — poor recall on JA/KO.
- `vision-pipeline.ts:154` doesn't log vision token usage — under-counts spend.
- `adapter.ts:329` context compaction byte-counts as token proxy — diverges for CJK.
- `tool-schemas.ts:209-237` JSON-Schema→zod silently degrades `oneOf`/`anyOf`/`$ref`.
- `tool-definitions.ts:716-818` parallel to zod schemas — dead code with drift risk.
- `summary-export.ts:55` surrogate-split risk in transcript slicing.
- `vault-templates.ts:139-145` case-sensitive `startsWith` — macOS HFS+ case-insensitive edge case.
- `vault-templates.ts:184-195` CJK keys silently dropped by frontmatter parser.
- `vault-index.ts:30` threshold 0.28 empirically tuned; common-word bias.
- `historyStore.query` prepares statement per call — no cache.

### Tray
- `Tray.swift:631-632` singleton + `weak self` correct; `weak var window` would be cleaner.
- `Tray.swift:281-359` `TrayDelegate.shutdown()` is dead code.
- `systray2-bridge.ts:274-313` kill+respawn every 500ms debounce — heavy workaround.

### Host-use
- `host.swift:828` `cuScreenshot` hardcodes `dpi:72` — multi-monitor mixed-DPI clicks land wrong.
- `host.swift:908-936` `cuInject` click path has no on-screen bounds check.
- `host.swift:940-950` type injection iterates `unicodeScalars` — surrogate pairs split.
- `darwin-adapters.ts:427` `hwndBidCache` unbounded.
- `host.swift:549-555` `cuActivatePid` 250ms sleep — not a `foregroundHwnd()` poll.
- No Automation TCC probe (only Accessibility).

### Extension
- No virtualization on thread list / messages — 1000+ threads jank.
- `ThreadList.tsx:46-49` uses native `confirm()` — inconsistent with modal pattern.
- Message action buttons lack `aria-label`.
- No a11y on thread list items.

---

## Recommended P0 batching

Per `grok_review_every_fix.md` memory rule: each batch gets Grok review before merge.

**Batch 1 — Security P0s (this week)**
S-P0-1 (host-bin env override) → S-P0-2 (tray TOCTOU) → S-P0-3 (page-sanitizer) → S-P0-4 (wildcard apex) → S-P0-5 (HMAC timing).

**Batch 2 — Correctness P0s (next week)**
C-P0-5 (tray orphan timers — immediate, in fresh code I just shipped) → C-P0-6 (WS close tray orphan) → C-P0-7 (tray promise reject) → C-P0-1 (thread mutex) → C-P0-2/3/4 (historyStore).

**Batch 3 — Architecture P0s (parallel, longer)**
A-P0-1 (server.ts carve) — gated by capability-token P0b planning. Don't start before Round 2 advisor consensus.

**Batch 4 — Ops P0s (parallel)**
O-P0-1 (CI matrix) — quick win, unblocks platform tests. O-P0-2 (codesigning) + O-P0-3 (auto-update) — external dependencies, longer lead.

---

## What I skipped

- **Extension background map** failed with 429 on first attempt. Most of its surface (page-sanitizer, ws-client, security-token) covered by security + WS protocol cross-cuts. Recommend re-running this single map when fixing S-P0-3 / S-P1-4.
- **Container e2e phase** — no Node val-base image exists for cmSpark. Build one if CI matrix expansion warrants it.
- **P2 batch** — defer until P0+P1 land; track via this doc.
