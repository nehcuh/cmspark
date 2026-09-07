Actual model: deepseek-v4-pro (invoked through Claude Code CLI).

# Review — Issue #451 (shared Chat context & experience lifecycle)

Packet: `/private/tmp/cmspark-w1-review-snapshot/451-context.md`. Read-only review of the packet diff against the issue's stated scope. Note on process: the injected review skill prescribes parallel subagents, but this task's explicit instruction forbids subagents and I have no agent tool in this session, so this is a single integrated two-axis review (standards + spec) — all findings below are grounded in packet code with file/line evidence.

---

## Security / authorization

### MAJOR-1 — The "context-only" `list_tabs` branch is reachable by the untrusted model tool loop; no provenance check
`chrome-extension/src/background/browser-bridge.ts` (packet lines 64–70):

```ts
case "list_tabs":
  if (params.__site_context_tab_id !== undefined) {
    const id = params.__site_context_tab_id
    if (!Number.isSafeInteger(id) || id < 0) return { success: false, error: "Invalid context tab id" }
    const tab = await chrome.tabs.get(id)
    const target = await browserSiteTarget(id, tab.url)
    return target ? { success: true, data: { site_target: target } } : { success: false, error: "SITE_TARGET_UNAVAILABLE" }
  }
```

- The bridge cannot distinguish the internal authenticated context read (`resolveBrowserSiteTarget`, companion/src/site-context/browser-resolver.ts, packet lines 847–874, which passes `__thread_id` alongside) from a model-initiated `list_tabs` tool call. `__thread_id` is ignored in this branch; nothing ties the call to the request scope that was granted the tab id.
- Model tool-call params are model-controlled. The packet shows the model path strips only `surface` (`delete normalized.surface`, packet line 353) and runs `normalizeWaitForToolParams` — nothing visible removes `__site_context_tab_id`. So a model (or prompt-injection) calling `list_tabs` with `{__site_context_tab_id: N}` receives `site_target` (origin, path, `navigation_key`) for any tab id it guesses — tab ids are small sequential integers.
- The capability declaration itself concedes "authenticated metadata boundary needs security review" (packet line 7). This review confirms the boundary is *not* authenticated in code: the internal-read path and the public tool share one branch. If the incremental disclosure is small today only because the pre-existing public `list_tabs` already exposes tab URLs, that argument should be documented at the boundary, and the magic param should be namespaced/gated so model-originated params can never reach it (e.g., strip `__site_context_tab_id` in the model tool-param normalization path).

### MAJOR-2 — `navigation_key` is an unkeyed SHA-256 over the *full URL including query and fragment*, and it is model-visible
`chrome-extension/src/background/browser-site-target.ts` (packet lines 768–775):

```ts
url.username = ""
url.password = ""
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href))
```

`url.href` still contains `?query#fragment` at hash time (only userinfo is cleared). The same is mirrored companion-side in `siteTargetFromBrowser` (`companion/src/site-context/target.ts`, packet line 1023, `createHash("sha256").update(url.href)`), and the resulting key is injected into the model-visible system prompt via `wrapKnowledgeBlock("site-target", ..., JSON.stringify(request.target))` (`companion/src/site-context/service.ts`, packet lines 958–960).

- The packet's claim is "No raw URL/query/fragment/userinfo crosses the NEW context-only response" (line 7). True literally, but the *hash of* query+fragment crosses, and it is an **unkeyed, offline-verifiable hash shown to the model**. A malicious or prompt-injected model can dictionary-attack short-secret query values (`?token=123456`, `?sid=abc123`) against the hash to recover them — the very secrets redaction was meant to keep from the model. This is a concrete side channel of the redaction design.
- Caveat (calibrated): if the pre-existing public `list_tabs`/`get_page_text` already exposes the same URLs with query strings to the model, the marginal disclosure is zero — but the packet doesn't establish that, and the context path is precisely the one being promoted as the redacted metadata boundary.
- Fix options: hash only `origin + pathname` (navigation identity rarely needs the query), or use a keyed HMAC with a secret the model never sees, so guesses can't be verified offline.

### MAJOR-3 — Cross-session persisted site-op bans silently stop restoring for hostname-only clients (regression vs pre-#451)
`companion/src/llm/adapter.ts` (packet lines 286–292):

```ts
try {
  if (hostname && !params.contextSelection) {
    hydratePersistedSiteOpExperience(...)
```

The router now sets `contextSelection` unconditionally on all three entry points (`companion/src/message-router.ts`, packet lines 389, 399, 409). Therefore `!params.contextSelection` is never true for chat.create / regenerate / file.upload — `hydratePersistedSiteOpExperience` is dead for all wire entry points. Restoration now happens only inside `buildCurrentContext` when `contextTarget` resolved (packet lines 268–275, `refreshPersistedSiteOpExperience(threadId, contextTarget.origin, entries)`).

- **Old extension client** (hostname only, no `context_tab_id`) → `contextTabId === undefined` → `contextTarget` undefined → **zero restore**. Pre-#451, every `chat.create` with a hostname hydrated persisted bans for that host. Now a hostname-only message restores nothing, while the packet's compatibility claim only says "Old clients remain hostname hints" (line 7) — it does not disclose that hostname hints no longer trigger any machine restore.
- This is declared in the packet ("No machine restore from hostname hints in new Chat path", line 11), so it may be intentional — but the functional regression (known-bad locators get retried until runtime counters re-ban at `SITE_LOCATOR_FAIL_BAN`) for any mixed-version pairing deserves an explicit compat decision and release note. Runtime counters partially self-heal (2+ fails re-ban), which is why this is MAJOR rather than BLOCK.

### NIT — `chrome.tabs.get(id)` is unguarded in the bridge context branch
`browser-bridge.ts` packet line 67. A closed/reused tab id rejects the promise; `browserSiteTarget`'s internal try/catch doesn't cover it. It fails closed only because `resolveBrowserSiteTarget` attaches `.catch(() => undefined)` (browser-resolver.ts, packet line 866). If `BrowserBridge.execute` has no outer catch (not shown in the packet), this surfaces as an unhandled rejection / error frame in the extension. Wrap `chrome.tabs.get` and return `SITE_TARGET_UNAVAILABLE`.

### NIT — `getBySite` superset via `isOwnedSiteExperience`
`companion/src/skills/skill-engine.ts` (packet lines 468–470): `matchSite(s.site, hostname) || isOwnedSiteExperience(s, hostname)`. The semantics of `isOwnedSiteExperience` (exact-origin ownership vs `matchSite`'s suffix matching) aren't visible in the packet. Verify it can't match an experience doc owned by a *different* origin (e.g., subdomain confusion `example.com` vs `attacker.example.com`) — this union widens prompt injection of site knowledge, so the exactness matters.

---

## Correctness / regressions

### NIT — Restore fidelity limited to budget-injected sources
`adapter.ts` packet lines 269–274: `selectedIds` is built from `context.retrieved_sources`, which only contains documents whose summaries survived `KNOWLEDGE_INJECT_BUDGET_CHARS` (skill-engine.ts, packet lines 1428–1445 — `knowledgeBudgetStop` skips the rest). Documents selected but budget-dropped get no ban restore, so "Current Chat restores only from actually selected knowledge documents" is really "only from actually *injected* documents". Consistent fail-safe, but the spec claim overstates coverage — document it or restore from the full selected set.

### NIT — `readSiteExperienceEntries` argument switched from host to full origin
`adapter.ts` packet line 270 passes `contextTarget.origin` (e.g., `https://www.example.com`) and line 359 switches from `host` to `rec.origin`. The function's internal matching (hostname vs canonical origin) is not in the packet; the old call sites passed a bare host. If it does exact-origin comparison these calls are consistent with the new exact keys; if it strips `www` internally they diverge. Verify; the chat-loop test doesn't exercise restored-ban restore through `readSiteExperienceEntries`.

### NIT — Mid-loop refresh latency budget
`browser-resolver.ts` packet lines 849–858: every `buildCurrentContext` (initial + each round, adapter.ts packet lines 328–341) can wait up to `budgetMs = 1500` for the extension. With an unresponsive extension, a multi-round chat accrues up to 1.5 s dead time per round. Consider caching the target within a request unless the tab navigated (the tool-exec path already knows when navigate/set_tab_url succeeded — packet lines 349–351).

### NIT — TOCTOU on the browser-selected tab id
`active-tab-hostname.ts` packet lines 33–43 captures the active tab id at WS-send time; the Companion resolves it up to 1.5 s later. If the user switches tabs in between, knowledge is projected for the stale tab, with no re-check against the current active tab. The navigation hash mitigates navigation-within-tab but not tab switching. Inherent to the design; note as accepted risk.

### NIT — Wrapping operational directives in untrusted tags
`adapter.ts` packet line 311: `siteOpPrompt ? wrapKnowledgeBlock("execution-experience", "Execution experience (data only)", siteOpPrompt) : ""`. `formatSiteOpMemoryPrompt` emits directives ("Do NOT retry these locators…", site-op-memory.ts packet lines 693–696). Under the system rule 11 shown at packet line 223, content inside `<untrusted-N>` must not be followed — so the prompt-level ban instruction is now explicitly "data only". Enforcement survives at the tool layer (`siteBan.banned` → `bannedSiteOpResult`, adapter.ts packet lines 1554–1564), so this is deliberate hardening (locators are page-influenced) rather than a break — but confirm that prompt-level ban compliance was intentionally traded for injection resistance.

### NIT — `navigation_key` invalidation is computed but never enforced in the Chat path
`siteTargetKey` (target.ts, packet lines 1042–1044) and the mid-loop rebuilds re-resolve the target fresh each round; no code compares the previous round's `navigation_key` to detect that the tab navigated between rounds — the refresh simply re-reads the tab. Harmless for chat (each round gets the current state), but the "change detector" semantics only matter for the future #456 boundary. Per the review scope I do not expand into #456; just noting the key is inert in #451 itself.

### NIT — `formatSiteOpMemoryPrompt(threadId, contextTarget?.origin)` with an unresolvable target
Mid-loop (adapter.ts packet line 335): if `contextTarget` is undefined, `matchesTarget` returns `true` for all origins (site-op-memory.ts packet lines 671–672), listing every origin's bans — pre-existing behavior for the no-hostname case, but now reachable mid-loop after a target disappears. Low impact (same thread's own memory); cosmetic.

---

## Test coverage

- Strong: real `SkillEngine` + real `chatCreate` with mocked browser/LLM (site-context-chat.test.ts), real `BrowserBridge` (active-tab-context.test.ts), TTL/foreign-origin/unknown-schema matrices (site-context-lifecycle.test.ts), exact-origin key matrix (site-context-target.test.ts). Source-lock boundary update is sound (run-progress.test.ts packet lines 727–735 — asserts boundary existence rather than silently slicing).
- Gaps (NIT): no test for `chrome.tabs.get` rejection on a closed tab; no test that a model-forged `__site_context_tab_id` is neutralized (see MAJOR-1); no hostname-hint fallback test through real `chatCreate` (old-client message shape); no chat-loop test of restored-ban behavior through `readSiteExperienceEntries`. The lifecycle test covers `refreshPersistedSiteOpExperience` directly, not its chat wiring.

---

## Spec conformance (packet claims vs code)

Verified in code: three entry points wired (index.ts + message-router.ts, packet lines 91–187, 389, 399, 409); cached semantic match reuse (`cachedMatchedSkillIds`, skill-engine.ts packet lines 488–490); knowledge_blocks opt-in with identical prompt for legacy callers (site-context-service.test.ts asserts `plain.prompt === projected.prompt`); exact WHATWG origin machine keys with distinct www/port/scheme (site-op-memory.ts packet lines 578–583, tests); historical bans separate from runtime counters with TTL, stale/schema/foreign-origin rejection and replace-refresh not clearing runtime failures (packet lines 630–657); unknown schema survives edit (skill-engine.ts packet lines 2139, 2164–2166; service test asserts version 2 retained); `knowledgeView` not wired as MCP; teardown helper not claimed for #456. The one overstated claim is the restore-fidelity one noted above ("selected" vs "injected"). Machine evidence (4939/4916 pass etc.) is claimed, not verifiable from the packet.

---

## VERDICT: REJECT

No BLOCK-level defect (no crash, data loss, or open injection path beyond pre-existing public read tools). But three MAJORs stand: (1) the context-only `list_tabs` branch is model-reachable with no provenance/authorization check — the exact "authenticated metadata boundary" the issue itself flags for review, and it is not authenticated; (2) the unkeyed SHA-256 `navigation_key` over full URL query+fragment is shown to the model, making redacted URL secrets offline-verifiable — a disclosure side channel contradicting the intent of the redaction claim; (3) persisted site-op bans silently stop restoring for hostname-only (old-extension) clients. These need fixes (or explicit, documented risk acceptance with a keyed-HMAC/param-namespacing change) before this context wire should ship as a safe metadata boundary. The NITs can ride along with the fixes.