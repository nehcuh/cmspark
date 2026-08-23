Review complete. All cross-checks done — here is my external review.

# External review — OS Agent Shell brief v2 (fold confirmation)

Evidence level: all findings `[inspected]` (code + docs read; nothing executed). No files edited.

## Code-fact cross-check (brief §1 table vs live code)

| Brief claim | Verified |
|---|---|
| `pickAuthenticatedClientWs` extension-only, outbound-only | ✅ lifecycle.ts:252-266; wired only by `ensureOutboundToolRunnerWired` → companion-http (lifecycle.ts:273-301) |
| Chat loop binds executor to originating socket | ✅ lifecycle.ts:796 `createToolExecutor(ws)` per connection; adapter.ts:1192/1198 calls the closure |
| 15s timeout, not typed error | ✅ tool-forward.ts:20 `TOOL_EXECUTION_TIMEOUT_MS = 15000`; error string contains "timeout" → security.ts:950-976 `classifyError` recoverable → model retry (adapter.ts:1438) |
| `openSidePanel` cannot open the panel | ✅ platform.ts:142-151 (macOS: `tell application "Google Chrome" to activate` only) |
| Google Chrome only | ✅ platform.ts:129-132 |
| Tray: no chat composer, has thread.list/confirm/activate | ✅ companion-client.ts:199/226/257/269; Tray.swift stdin `confirm-response` (line 805) |
| Tray origin ≈ full-method WS (X6) | ✅ message-router.ts has no origin-based method ACL (only voice/STT origin fences) |

The factual foundation of v2 is accurate. The S19 problem is real and exactly as described.

## Findings

**BLOCK** — none remaining.

**MAJOR-1 — §3 diagram still calls the overlay "OS home"** (brief line 109: `(OS home, L0+search)`). S2 (line 134) and the normative-usage ban (line 26) forbid calling the summoner 「家/主界面」； the fold missed the canonical architecture diagram — the artifact most likely to be copied into architecture.md at P2. This is the precise X3/P-B1 residue. Fold: relabel to `OS summoner (L0 capture)`.

**MAJOR-2 — "overlay MinimalConfirm" contradicts S6/N2 in three surviving sentences.** S6 (line 138) and §13 (line 421: 召唤器不是 MinimalConfirm) say MinimalConfirm is Panel-only and the overlay renders badge/deeplink only, no Allow/Deny. But §5.5 (line 218: 召唤器可以…提供同一 MinimalConfirm), §9.2 item 15 (line 299: overlay MinimalConfirm 同时显示)， and §11 P1 (line 386: Overlay MinimalConfirm 接入 N5) all speak of an overlay MinimalConfirm as a real surface. An implementer reading §11-P1 could wire the overlay into the N5 confirm fan-in as a fourth writer — the exact “第四确认方言” S6 bans. Fold: purge the phrase; rename to read-only confirm mirror/badge; N5 fan-in stays three-way (WS ⊕ tray stdin ⊕ HUD) per N-lock C1.

**MAJOR-3 — §9.5 item 28 (line 313) contradicts the S24/§0 copy freeze.** Item 28: “接受本 brief 后必须改 GOAL / architecture §0” vs §0 (line 28) + S24 (line 156): P0 证伪通过前不改， 最多加「实验：菜单栏召唤」. §13 row 1 (line 419: “修订的是默认家文案”) leans the same pre-pass way. One timing must win. The freeze is the right call (it is what prevents the identity lie); amend item 28 and §13 to “证伪通过后（P2）必须改，否则文档分裂”.

**MAJOR-4 — S21's ACL is unenforceable as written and its allowlist breaks the live tray.** S17 (line 149) locks overlay to the single origin `cmspark-tray://local`; S21 (line 153) then specifies a *server* ACL allowing only `chat.create/abort`, `thread.list/select/create`, `history.query`. But (a) the tray's own WS client today calls `skill.list` (companion-client.ts:199) and `executeQuickAction` (companion-client.ts:257) — an origin-keyed ACL either breaks the tray menu or must exempt the shared connection, at which point it constrains nothing; (b) with one origin and (likely) one shared menu-bar-agent connection, the server has no discriminator for "this is the overlay." Not a trust *elevation* — the same-user-reads-`ws_secret` residual is pre-existing and documented (lifecycle.ts:200-206 comment; swift-tray-bridge.ts:68 "malicious tray self-approves any L2") — but the fold of Sec BLOCK-1 needs an enforcement point. Fold: give the overlay its own connection with a handshake surface claim (e.g. `auth.handshake` extension field, spoofable no worse than origin today) → per-connection ACL; allowlist scoped to overlay-tagged connections only, leaving tray-class methods intact.

**NIT-1** — P0 scope (§11, lines 347-352) omits the S21 hard-reject list. Cheap to include; without it the Sec BLOCK fold is paper-only during the spike. Recommend adding at least the hard-rejects (`allowTrust`, `config.set`, `unattended.arm`, `security.confirmation.response`) to P0.

**NIT-2** — `composer.lease` frame fields are OPEN (line 440), but the P0 pass criterion “只有一块能打字” (line 368) requires a minimal lease in P0. The minimal field set must be specified before the spike, not after.

**NIT-3** — `classifyError` is substring-based (security.ts:918-976; "timeout"/"not found"/"disconnected" all recoverable). §10's ban is testable, but the brief should state the token discipline: `BROWSER_UNAVAILABLE` error copy must not contain recoverable substrings. Also note mid-loop peer loss still yields one recoverable-classified retry before the S19 gate catches it — bounded, acceptable, worth one sentence.

**NIT-4** — §13 row 1 “修订的是默认家文案” uses banned home vocabulary in a normative table; rephrase to “P2 修订默认文案”.

## S1–S24 — only where I disagree with v2

- **S6** — AMEND (per MAJOR-2: purge overlay-MinimalConfirm phrasing; S6's own text is correct).
- **S21** — AMEND (per MAJOR-4: per-connection discriminator + allowlist completeness).
- All others — **LOCK**. Notably S19, S20, S13, S22, S23 are correctly derived from code facts and implementable as unit tests against today's code. S10 OPEN is acceptable for a P0 spike whose tasks (Chrome fully quit, chat-only) don't overlap LIVE CU; S22 already guards the overlap.

## Three-layer score

- **Outcome** (spike without lying): PASS. P0 scope is landable against today's code: S19 gate at dispatch, typed non-recoverable `BROWSER_UNAVAILABLE`, honest CTA, no openChrome tool, GOAL frozen. The two copy residues (MAJOR-1/2) must be scrubbed first — they are the only places v2 still half-says what v1 was rejected for.
- **Trajectory** (fold vs ignore): genuine fold. Every BLOCK in the synthesis maps to a new law or explicit text (S19/S20/S21/S22/S23/S24, §5.1 binary states, §11 observable gates); residuals are wording-level leaks, not ignored BLOCKs. P0 falsification is no longer theater: history.db zero-auto-L1, ≥6/8 no-Chrome completion, 30s-abandon probe, and explicit fail thresholds are all observable.
- **Component**: laws/files cited per finding above; checklist applied — axes fit (L0 capture shell, no fourth axis), no new runtime, no new confirm dialect (modulo MAJOR-2 wording), originWs discipline preserved (S6 禁止解绑)， no trust elevation from overlay.

## Residual before spike plan

1. Doc edits to the brief: diagram label (line 109), MinimalConfirm phrasing (lines 218/299/386), item-28/§13 freeze reconciliation (lines 313/419) — one editing pass, no architecture change.
2. S21 amendment: overlay-dedicated connection + handshake surface claim + per-connection ACL; enumerate tray-class methods that stay allowed.
3. P0 DoD additions: `classifyError("BROWSER_UNAVAILABLE…")` → non_recoverable unit test; tray-origin chat + L1 dispatch test (extension ws or typed error, never originating socket); no-auto-retry assertion; S21 hard-rejects included; minimal `composer.lease` fields.
4. Keep S10 process model and extension-id pin OPEN as declared; do not resolve by assertion.

All findings are foldable amendments; no BLOCK-class hole (trust is enforceable, no shipped identity lie, P0 is landable).

VERDICT: APPROVE_WITH_NITS
