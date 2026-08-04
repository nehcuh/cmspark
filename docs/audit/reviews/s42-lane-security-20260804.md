# Security Lane
**Range:** 79d7420..d4c4ebf  
**Tip:** d4c4ebf  
**Date:** 2026-08-04  
**Status:** WATCH  
**Recommendation:** REQUEST_CHANGES  
**Evidence mode:** live source inspection of tip tree `[inspected]`; S41 residual claims re-verified against production code (not patch-only). Tests read but not re-run in this lane (`[inspected]`, not `[executed]`).

## Executive summary

S41 P0 packaging claims (skill_install L2 + content cap + zip extract budget + dest_path honesty + config.test blank merge + POSIX argv ENV=/`~`) are **present in live source** and should not be rubber-stamped as open. Outbound MCP (stdio + loopback HTTP + disclosure session + dual-entry tab lease + L8 confirm fan-out + B1 whitelist skip) is substantially real, not scaffold-only.

However, the B1 skip is driven by a **client-supplied param** (`__outbound_mcp`) that the LLM path can still inject for tools using the generic Zod fallback. That is a confirmed pack / multi-agent tool-surface bypass and is the primary merge blocker for this security lane. Secondary issues: L8 incomplete on URL-gate navigate, skill overwrite after L2 without explicit overwrite preview, and zip extract memory inflation before budget.

## S41 P0 residual verification

| S41 claim | Live status | Evidence |
|-----------|-------------|----------|
| skill_install L2 | **FIXED** | `L2_GATE_TOOLS` includes `skill_install` (`server.ts:899-912`); `capabilityForceConfirm` (`server.ts:1363-1370`); executor requires `validateTokenFor` (`server.ts:3406-3420`); binding fingerprint (`security-policy.ts:86-99`) |
| content cap | **FIXED** | `MAX_CONTENT_BYTES = 256 * 1024` (`skill-install.ts:93-150`) |
| zip uncompressed budget | **FIXED** | extract loop counts files/bytes; cleanup on breach (`skill-engine.ts:828-918`) |
| dest_path honesty | **FIXED** | `importSkill*` returns `{ name, destPath }`; skill_install surfaces them (`skill-install.ts:152-207`, `skill-engine.ts:806-922`) |
| config.test empty base_url | **FIXED** | `nonBlank(override?.base_url, config.llm.base_url)` (`message-router.ts:342-353`) |
| POSIX argv `FOO=1` / `~` | **FIXED** | rejects env-assignment tokens and unquoted `~` (`shell.ts:163-168`) |

Residual S41-class issues that remain are **not** the old P0 blockers; they are narrower (overwrite UX, Downloads segment looseness, zip memory-before-budget).

---

## Findings

### F1 [HIGH] — `__outbound_mcp` is LLM-injectable → pack / multi-agent tool whitelist bypass (B1 inverted)

- **File:line**
  - `companion/src/server.ts:640-670` — `isOutboundMcpCall = (finalParams as any).__outbound_mcp === true` skips `threadManager.isToolAllowed`
  - `companion/src/server.ts:666-670` — comment documents intentional B1 skip for synthetic outbound holders
  - `companion/src/outbound-mcp/companion-http.ts:233-238` — production path *sets* the flag after auth
  - `companion/src/bridge/tool-schemas.ts:285-286,352-364` — tools without dedicated schemas use `GENERIC_FALLBACK = z.record(z.unknown())` (**preserves** unknown keys)
  - `companion/src/llm/adapter.ts:726-731` — spreads parsed args into `executeTool` (only injects `__thread_id`; does not strip `__outbound_*`)
  - `companion/tests/integration/outbound-mcp-executor.test.ts:189-211` — proves flag alone toggles whitelist behavior
- **Evidence** `[inspected]`
- **Attack**
  1. Mission Pack / worker thread with `tool_whitelist` excluding e.g. `click`, `type`, `screenshot`, `get_page_text`, `list_tabs`, `skill_install`, `wait_for` (all fall through generic schema).
  2. LLM (or prompt-injection) emits tool args including `"__outbound_mcp": true`.
  3. Zod generic fallback keeps the flag; `isToolAllowed` is skipped; tool proceeds under normal L1/L2 gates for that tool name.
  4. Secondary effects: multi-agent early tab HARD lease skipped (`server.ts:734-736`); L2 confirm origin unbound + fan-out when tool hits L2 path (`server.ts:1691-1735`) — any authenticated peer may approve.
- **Risk**
  - **Composition / Autonomy isolation break**: pack and multi-agent surfaces are policy, not mere UX. A worker that was denied browser tools can still drive CDP tools without pack consent.
  - `shell_exec` / `host_*` / `navigate` mostly use structured Zod objects that **strip** unknown keys by default — so RCE-class tools are less reachable via this injection. Impact concentrates on **generic-schema browser tools + skill_install**.
  - Confirmed, not theoretical: createToolExecutor treats the flag as ground truth with no channel authentication (HTTP Bearer only applies to companion-http entry; Side Panel path does not re-prove outbound provenance).
- **Fix**
  1. **Do not trust params.** Prefer closed-over option: `createToolExecutor(ws, { outbound: true })` only from `ensureOutboundToolRunnerWired`, **or** strip all `__outbound_*` / `__thread_id` from inbound LLM args and re-inject only from companion-controlled sources.
  2. At minimum at start of `createToolExecutor`:  
     `delete finalParams.__outbound_mcp; delete finalParams.__outbound_caller_id`  
     then re-apply only if `AsyncLocalStorage` / runner-private symbol marks outbound.
  3. Add adversarial unit test: `tryParseToolArgs("list_tabs", { __outbound_mcp: true })` must not produce a trusted outbound flag into Side Panel executor; pack-denied tool must still return `tool_not_allowed`.

### F2 [MEDIUM] — Outbound URL-gate navigate does not get L8 fan-out / tray; origin stays bound

- **File:line**
  - `companion/src/server.ts:2102-2173` — `URL_GATE_TOOLS` (`navigate`/`create_tab`/`set_tab_url`) always `send` to single `ws` and `{ originWs: ws }`
  - Contrast L2 path fan-out: `server.ts:1691-1735` (only when already inside L2_GATE confirm)
  - Outbound allowlist includes `cmspark__navigate` (`outbound-mcp/profile.ts:7-16`)
- **Evidence** `[inspected]`
- **Risk**
  - ADR-022 L8 intent: outbound must not depend on a single Side Panel focus. Navigate is the highest-frequency outbound interactive tool that needs human confirm for non-whitelisted hosts, yet it **does not** fan-out to all authenticated peers, **does not** prefer tray, and **rejects** cross-peer `respondFrom` (origin-bound).
  - Coding-agent workflow: user watches IDE; confirm sits on an unfocused extension socket → timeout / “no UI” failures. Not an auth bypass, but security UX that causes users to enable `auto_approved_domains` / `auto_approve_dangerous` — widening blast radius.
- **Fix**
  - When `isOutboundMcpCall`, reuse L8 sendConfirm fan-out + tray + unbound origin for URL-gate confirms (same pattern as L2), while keeping scheme hard-block and whitelist validation on `add_to_whitelist`.

### F3 [MEDIUM] — skill_install L2 does not disclose overwrite; silent `rmSync` / write still after approve

- **File:line**
  - `companion/src/skills/skill-engine.ts:821-823` — `writeFileSync` overwrites single-file skill with no existence check
  - `companion/src/skills/skill-engine.ts:855-858` — folder install `fs.rmSync(destDir, { recursive: true })` before extract
  - L2 preview only: `path=… zip=… content_len=…` (`server.ts:948-949`) — no existing skill name / “overwrite” flag
- **Evidence** `[inspected]`
- **Risk**
  - S41 fixed *ungated* durable write; residual is **destructive integrity** after a single L2 click. Prompt-injection can replace a trusted skill the user previously installed; next `use_skill` loads attacker body into agent context without a second HITL.
  - Severity capped at MEDIUM because L2 + forceConfirm (god-mode does not skip) is now required.
- **Fix**
  - Before write: if dest exists, set `forceConfirm` preview `overwrite=true name=…` and bind overwrite bit into `bindingPayloadFor`.
  - Optional: refuse overwrite unless `params.overwrite === true` after a second confirm.

### F4 [MEDIUM] — Zip extract budgets after full `getData()` load (memory zip-bomb residual)

- **File:line**
  - `companion/src/skills/skill-engine.ts:889-900` — `const data = entry.getData()` then `extractBytes += data.length` and compare to `MAX_ZIP_EXTRACT_BYTES`
  - Compressed cap only at install layer: `MAX_ZIP_BYTES = 25MiB` (`skill-install.ts:89-193`)
- **Evidence** `[inspected]`
- **Risk**
  - A highly compressible ≤25 MiB zip can expand to multi-GB **in process memory** before the byte budget throws. Partial dest is cleaned (`skill-engine.ts:911-917`), but RSS spike can OOM companion (availability / local DoS). Not remote without L2 path/zip under allowlisted sources.
- **Fix**
  - Prefer entry header uncompressed size sum before `getData()` (with distrust of headers + hard cap), or stream with running total and abort without materializing full buffers; keep post-write cleanup.

### F5 [LOW] — skill_install source allowlist is path-segment based (`downloads` / `下载`), not OS Downloads root

- **File:line**
  - `companion/src/skills/skill-install.ts:66-87`
- **Evidence** `[inspected]`
- **Risk**
  - Any realpath containing a `downloads` segment (e.g. project dir `…/downloads/…` under tmp, or intentional folder name) is allowed. Mitigated by L2 + not full FS. Same class as S41 P1.
- **Fix**
  - Resolve known Downloads folders (Chrome known_folder / XDG / macOS) + realpath containment; keep tmp + data-dir.

### F6 [LOW] — WS `config.test` still lacks settings-web private-IP SSRF parity

- **File:line**
  - `companion/src/message-router.ts:335-372` — probes via `probeLlmConnection(testConfig)` with user/override URL
  - Contrast comments at `message-router.ts:1386` for other SSRF gates
- **Evidence** `[inspected]`
- **Risk**
  - Authenticated local UI can point probe at RFC1918 / metadata-ish hosts. Pre-existing class; empty-base_url clobber is fixed. Low in local-companion threat model.
- **Fix**
  - Reuse settings-web private/loopback block list on probe URL host (with explicit opt-in for local OpenAI-compatible servers if product needs it).

### F7 [LOW] — Outbound L3 disclosure is self-service for any Bearer holder (by design, residual honesty)

- **File:line**
  - `companion/src/outbound-mcp/companion-http.ts:330-339` — `acknowledge: true` + Bearer → `acceptOutboundDisclosure`
  - `companion/src/outbound-mcp/stdio-server.ts:107-130` — meta tool same pattern
  - Facade correctly **ignores** caller `disclosure_accepted` bool (`facade.ts:22-26,79-80`) — S41 landmine fixed
- **Evidence** `[inspected]`
- **Risk**
  - Any local process with `ws_secret` can enable page-text/screenshot exfil to the coding-agent context without a CMspark UI prompt. Equivalent in power to already driving the paired Extension; not a new remote vector. Residual: users may believe “disclosure” means human HITL in Side Panel — it currently means agent-acknowledged session flag.
- **Fix**
  - Product: optional L2/tray confirm on first disclosure per caller; document clearly in mcp-outbound UX that acknowledge is agent-side.

### F8 [LOW] — L8 unbound confirm widens cross-peer approve for true outbound L2 tools

- **File:line**
  - `server.ts:1733-1735` — `confirmOriginOpts = undefined` when outbound
  - `security-confirmation.ts:401-415` — origin mismatch only when `originWs` set
- **Evidence** `[inspected]`
- **Risk**
  - Intentional for IDE-unfocused approve; any other authenticated extension/tray peer can approve. Acceptable if F1 is fixed so Side Panel LLM cannot enter this mode. Combined with F1 → HIGH (already covered). Alone → LOW (local multi-client trust).
- **Fix**
  - Keep unbound only when outbound provenance is server-authenticated; bind otherwise.

---

## Solid (do not regress)

1. **skill_install Trust packaging (S41)** — L2 + forceConfirm (god-mode never skips) + token binding on mode/path/content hash + content size cap + capability-audit lines + honest dest_path `[inspected]`
2. **Outbound profile fail-closed** — default allowlist is L1 browser subset only; no shell/host/cookies/evaluate/skill_install (`profile.ts:7-16`) `[inspected]`
3. **Disclosure authorization not caller-bool** — server session map only (`disclosure-session.ts`, `facade.ts:79-80`) `[inspected]`
4. **Loopback HTTP + Bearer** — `127.0.0.1` bind (`server.ts:5682-5683`); `authorizeOutboundHttp` timing-safe compare (`companion-http.ts:68-95`); health unauthenticated but no secrets (`companion-http.ts:315-321`) `[inspected]`
5. **Dual-entry L9** — interactive outbound requires tabId; Side Panel force-releases outbound holder (`dual-entry.ts:54-158`); Side Panel path calls `sidePanelWinsReleaseOutboundLease` (`server.ts:651-660`) `[inspected]`
6. **Prefer extension over tray for CDP** — `pickAuthenticatedClientWs` prefers `chrome-extension://` (`server.ts:188-207`); avoids 15s tool.execute dead-end on tray `[inspected]`
7. **SPA scroll expression** — pure numeric embedding via `Number(v)||0`; no user strings; selectors are static literals (`spa-scroll-expr.ts:6-14`); unit tests assert no `${` (`spa-scroll-expr.test.ts`) `[inspected]`
8. **shell_exec** — L2 forceConfirm retained; win32 argv `.exe`/`.com` only; ENV=/`~` reject from argv; `windowsHide` paths unchanged intent `[inspected]`
9. **Cookie trust** — still domain-gated (not weakened by this range’s outbound work) `[inspected]` prior S41
10. **security_token strip from LLM** — still stripped before L2 (`server.ts:594-608`) `[inspected]`
11. **Extension sendResponse** — outer try/catch + async `return true` patterns on chat/config/notebook paths reduce port-closed races (`background/index.ts:427-439`) `[inspected]`
12. **URL scheme hard-block** for navigate family still present; analyze_image fetch gate still separate and strict `[inspected]`

---

## Residual / open questions

1. **F1 fix design choice**: closed-over executor option vs AsyncLocalStorage vs private Symbol — architecture lane should pick one; security requires “params never authorize outbound.”
2. **Does product want skill_install on outbound profile later?** Currently forbidden — keep it that way until overwrite + content Trust story is complete.
3. **Zip engine tests** still use AdmZip-free stubs for `importSkillFolder` in `skill-install.test.ts` — extract budget is covered elsewhere? Confirm engine-level tests exist before claiming bomb defense is regression-locked.
4. **config.test SSRF** still open (F6); not a merge-blocker for outbound.
5. **Tray-only macOS users without Side Panel** + outbound navigate confirm path (F2) — product/UX confirmation needed.
6. **Threat model note**: possession of `ws_secret` ≈ full agent. Outbound HTTP does not expand beyond that given loopback bind; do not claim “remote MCP attack” without secret theft or local malware.

---

## Verdict rationale

| Axis | Call |
|------|------|
| S41 P0 residual | **Closed** in source (do not re-open as P0) |
| New outbound surface | Real, mostly sound profile/auth/lease/disclosure-session design |
| Blocker | **F1 HIGH** pack/worker whitelist bypass via injectable `__outbound_mcp` |
| Secondary | F2–F4 MEDIUM should fix before calling ADR-022 L8/L9 “done” |

**Status: WATCH** — not SAFE (F1), not BLOCK (no unauthenticated RCE / cookie-trust invert found).  
**Recommendation: REQUEST_CHANGES** until F1 is fixed and covered by a negative test. F2–F3 strongly preferred in the same batch; F4–F7 trackable as follow-ups.
