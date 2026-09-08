**Independent architecture/design review (Grok 4.6).** Frozen packet only: plan `2026-09-08-desktop-workbench.md` (#476), plus the inlined `summoner-acl.ts` and `shell-open.ts`. No other reports, no repo edits, no implementation completeness demand. Slice 1 is not treated as #476 done.

---

## Outcome

The stated outcome matches the product ask: CMspark as a quiet standalone conversation workspace (conversations, MCP, skills, knowledge, local work), no Codex, quick summon kept, web jobs on the **existing** Chrome, background = avoid foreground activation **where supported**, never headless or another profile, foreground = show the operation page, extension = current authenticated browser transport and **not** a requirement for non-browser jobs.

The packet is honest about the current object: overlay is a 360×420 Chromium `--app` host on an **isolated UI profile**, not the user’s automation profile, and not a native WKWebView/WebView2 host. Overlay ACL is alias/trash-constrained; restoring nav cannot mint a desktop manager. Same Companion thread store; no second persistence. Those are the right seams.

Two outcome boundaries are still too soft and will be mis-closed if left as written.

**Correction A — “browser-free” is two different claims.**  
Local work without the user’s Chrome/extension is an #476 outcome. Chromium `--app` as the **UI host** is a packaging fact, not that outcome. Native webview is not implied by “usable without Codex.” Slice 6’s “if native webview is required” plus “Chromium shell dependence is an explicit gap, not silently accepted as done” currently lets a later PR either (1) close #476 while still depending on Chrome/Edge for the shell, or (2) hold #476 hostage to WKWebView/WebView2. Pick one in the plan:

- **Recommended:** #476 accepts isolated Chromium `--app` (or Edge `--app`) as UI host if it is not the automation profile, opens at workspace size, and local work does not need the extension. Native webview is a **follow-on issue**, implemented and verified before anyone claims browser-free **hosting**.
- **Alternative:** native host is in #476; then slice 6 is mandatory and #476 cannot close on `--app`.

Do not keep both hedges.

**Correction B — background honesty.**  
User confirmation already allows foreground when background is unsupported. The gap is **silent** fallback in `client.ts`. Slice 5 must fail loud: requested background + unsupported → tell the user the operation will activate a window (or refuse), never open foreground as if background succeeded.

---

## Trajectory

Slice 1 is correctly **not** #476. Explicit read-only until the management transport exists is the right first move. Linked per-slice Issue/PR + #476 held open until full acceptance is the right issue hygiene. #475 stays out. Good.

The dangerous trajectory is not “slice 1 closes the issue.” It is “slice 1 ‘fixes MCP’ by turning the overlay into a manager” and “slice 3 ships a terminal before desktop confirmation exists.”

**Correction C — slice 1 MCP.**  
Inlined ACL already allowlists `mcp.toggle_server` while comments and the plan say overlay must not mutate MCP (`mcp.add` denied; list is the overlay story). Payload policy does **not** constrain toggle. Combined with “stale clickable toggle calling an intentionally unavailable API,” “fix dead MCP interaction” will be implemented as “make toggle work.” That is overlay elevation, which the plan itself forbids.

Slice 1 acceptance must say: overlay MCP stays read-only; dead control is removed or disabled with honest copy; server status comes from real response fields, not `enabled`-as-health; `mcp.toggle_server` is denied on summoner **or** payload-blocked. Mutation waits for the desktop identity in slice 2.

**Correction D — slice 3 vs 4.**  
PTY/ACP execution is a sensitive standalone tool. Confirmation is specified as a dependency, then numbered **after** local work. That ordering will ship a working terminal on overlay/tray confirm paths or with visibility-as-permission.

Split slice 3:

- 3a: bind **existing** PTY/ACP output and lifecycle to thread/session; reconnect/stop; unavailable = recoverable; never fabricate success; viewing prior artifacts.
- 3b: **new** local terminal/agent gestures only after slice 4 (desktop origin, challenge/action bind, expiry, cancel/disconnect).

Do not replay extension/overlay approvals. Desktop window visibility is not consent.

**Correction E — slice 6 vs slices 1–5.**  
If Correction A’s recommended split is taken, slices 1–5 can make the product usable; slice 6 validates macOS/Windows **shell behavior** (workspace size, quick vs workspace, degrade-to-tab honesty). Native webview does not gate conversation/MCP/knowledge/local work.

---

## Components

| Seam | Packet | Verdict |
|---|---|---|
| Overlay 360×420, isolated `--user-data-dir` | Evidenced in `shell-open.ts` | Keep as quick summon. Not the user’s Chrome. |
| Workspace chrome | 220px labeled nav, 780px column, resources as a real pane | Right IA. No icon ribbon, no mascots/metrics. |
| Summoner ACL | Allowlist + alias/trash payload policy | Overlay must stay this tight. |
| Tray | `surface !== "summoner"` is **ungated** | Fail-open. Desktop must not inherit this. |
| Thread store | Reuse Companion; no second store | Correct. |
| MCP/skills/knowledge/ACP/PTY handlers | Reuse with identity + payload/event checks | Correct; not a rewrite. |
| Chrome adapter | Existing extension peer; FG/BG policy missing | Slice 5; no CDP-by-default, no headless, no profile copy. |
| Confirmation | New desktop origin rules | Required; not a skin on web confirm. |
| Native webview | Later host for the same HTML | Separate from automation browser. |

**Blocker — desktop identity is named, not specified.**  
Today: origin stays `cmspark-tray://local`; only `surface === "summoner"` is restricted; every other surface, including omitted, is full tray. A handshake of `surface: "desktop"` on that origin is **tray**, i.e. settings, confirm, MCP mutate, trust elevation.

“Separate typed local desktop identity, allowlisted methods, per-resource payload checks, preserve overlay” is the right sentence. It is not yet a contract. Slice 2 implementers will either widen `SUMMONER_ALLOW` (forbidden by the plan) or add `desktop` and inherit fail-open tray (forbidden by “no permission model bypass”).

**Correction F — write the handshake before any management form:**

1. Surfaces are an explicit enum: `tray | summoner | desktop` (names flexible; cardinality is not).
2. **Unknown and omitted fail closed** for privileged methods. Tray full access is only `surface === "tray"` (or a **new** desktop origin). Do not keep `!== "summoner"` as the tray grant once a third client exists.
3. Overlay allowlist and payload policy stay as they are (trash-only delete, alias-only update, no MCP add, pack.apply overlay-eligible, etc.).
4. Desktop gets its **own** method allowlist + per-resource payload checks (MCP CRUD/connect, skills/knowledge management, thread tags/folders, config reads). Not “tray minus a few,” not “summoner plus everything.”
5. Same handlers, new identity. No live config-schema migration. Config writes and secret redaction reviewed **before** forms (API keys never echoed; save-in-progress vs persisted success from real writes).

**Correction G — confirmation ownership.**  
Reuse `SecurityConfirmationManager` with a desktop-bound origin/challenge; do not stand up a second queue that can accept a web `id`. Prompt the **desktop connection that issued the tool**, not the extension confirm UI, unless that UI is explicitly origin-bound to the same challenge (the packet already says never replay a web approval — lock that to connection + action + expiry + cancel-on-disconnect).

**Correction H — workspace vs overlay is one app, two sizes.**  
`OVERLAY_WINDOW_SIZE` is 360×420. “Workspace opens at a useful larger size” has no number. Specify a default distinct from overlay (e.g. ≥1100×720 or equivalent), keep quick mode compact, one HTML shell with compact vs workspace layout—not a second product. `--app` argv must still be loopback, no token in query (already correct in `isSummonerLoopbackUrl`).

Reuse extension visual density/type (ChatShell / resource panes) rather than a parallel HUD language. That is match-the-extension; it is not a mandate to load the MV3 bundle inside `--app`.

---

## T3 declarations

Appropriate as an **implementation-release** gate, not a demand that this design already be shipped: independent Grok 4.6 + DeepSeekV4Pro, frozen packets, actual verdicts, negative auth/payload/cross-thread/confirmation tests, rendered UI, machine checks, per-slice evidence, #476 open, #475 separate.

**Correction I — bind viewports to modes**, or 320px will be used to fail a 220px sidebar that should not exist in quick mode:

| Width / height | Mode |
|---|---|
| 320 / 390 | Quick/overlay or narrow workspace: **named** disclosure, no icon ribbon; New conversation + composer + stop reachable |
| 760 | Mid workspace; content + stop reachable |
| 1440 | 220px labeled nav + ≤780px reading column |
| Short height | Composer and stop remain reachable; history must not eat the whole HUD (current overlay bug) |

**Correction J — negative tests the identity contract implies** (still design-level, not “write the tests now”):

- Summoner/overlay must not invoke desktop methods (`mcp.add`, config write, PTY start, confirm respond).
- Desktop must not be authenticated as tray by omitting `surface`.
- Overlay `thread.update` cannot set whitelist/knowledge; `thread.delete` hard-delete denied.
- Confirm token from extension/overlay cannot approve a desktop tool; expired/disconnected challenge cannot be replayed.
- Cross-thread: PTY/ACP bytes and knowledge mutations cannot attach to another thread id.
- Management payloads redact secrets; `enabled` is not asserted as connected.

Machine checks belong **before** release review of each slice, not only at the end of #476.

This design-gate review does **not** require slices to be implemented. It does require the identity, confirm-ordering, MCP overlay, host-boundary, and breakpoint corrections above to be in the plan before slice 2 is coded. Otherwise T3 will rubber-stamp a tray-shaped desktop.

---

## What is already good (do not “fix”)

- Overlay vs desktop vs automation Chrome vs UI host are four things; the packet mostly treats them as four things.
- Same thread backend; no Codex; no extra cloud; no mandatory coding agent.
- Read-only slice 1; #476 stays open; #475 out of band.
- Local agent down = recoverable, never fake success.
- No implicit remote debugging, no headless, no profile copy.
- Resource panes: one heading, search, primary action, loading/error/empty/save/success.
- Pack/MCP/skills/knowledge as handler reuse, not a new runtime.

---

## VERDICT: APPROVE_WITH_NITS

The architecture is the right product: overlay stays a tight summoner; desktop is a new privileged client; Chrome remains the user’s Chrome; local work must not wait on the extension. Gaps in the inlined sources are real, not theatrical. Slice 1 is correctly incomplete.

Do not implement slice 2 until **Correction F** (fail-closed desktop identity) is written into the plan. Do not treat wiring `mcp.toggle_server` as slice 1. Do not ship new PTY/ACP gestures before desktop confirmation. Do not close #476 on native-webview ambiguity or silent foreground fallback.

Mandatory nits: A/B (outcome bounds), C (slice 1 MCP), D (3a/3b vs 4), E (slice 6), F (identity), G (confirm origin), H (workspace size / one shell), I/J (T3 viewports and negatives).
