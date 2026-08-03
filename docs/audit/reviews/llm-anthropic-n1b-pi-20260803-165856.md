All probes confirm the fix is robust — even weird spellings (`%2E`, double-dot, uppercase, port-suffixed) resolve to `firstParty: true`, i.e. the direction of error is toward denial, never allow.

## Verification summary

**1. must_fix CLOSED — verified empirically + by regression tests**
- `hostnameFromBaseUrl("https://api.anthropic.com./v1")` → `"api.anthropic.com"` (trailing FQDN dot stripped, headers.ts:122)
- `isAnthropicFirstPartyHost("api.anthropic.com.")` → `true` (strip `.replace(/\.$/,"")` at headers.ts:96)
- `assertHeaderPolicy` + `buildRequestHeaders` with baseUrl `https://api.anthropic.com./v1` + `client_header_profile=claude_code_compat` → hard `HeaderPolicyError` (`HEADER_POLICY_DENIED`) — no spoof UA/`x-app` emitted
- Same deny via non-empty `extra_headers` on trailing-dot first-party host
- Regression tests present for both URL-level (`hostnameFromBaseUrl`) and host-level trailing-dot cases (`llm-headers-policy.test.ts` lines 78–105, 134–158)

**2. No regression**
- Defaults: `defaultConfig` (config.ts:260–264) = `protocol:"openai"`, `client_header_profile:"none"`; `loadConfigFile` does `deepMerge(defaultConfig, parsed)` (config.ts:465) so legacy configs unchanged
- Host matcher still rejects `evilanthropic.com`/`evilanthropic.com.`/`myclaude.ai` (no bare `endsWith`); suffix `.anthropic.com`/`.claude.ai` + exact matches intact
- L7 union intact: first-party + (profile≠none OR any extra_headers) → hard deny; extra headers shape-validated (CRLF/Host/Cookie/hop-by-hop rejected) on all hosts
- `npx tsc -p tsconfig.test.json` clean; `node --test` → **28/28** pass for llm-headers-policy, and config+settings-web+policy combined **87/87 pass** (0 fail) — no regression

**3. Spot-check for new L7 re-opens** — none found. `buildRequestHeaders`/`assertHeaderPolicy` are not yet imported by any runtime code (providers/ contains only headers.ts; adapter wiring is a later node), so no new bypass path exists in this node's shipped surface.

## Nits (non-blocking)
1. `buildRequestHeaders` extras-merge double-check (headers.ts:215–219) only re-checks spoof-class keys, not all keys — currently unreachable on first-party because `assertHeaderPolicy`'s union already refuses *any* extras there, but it's a partial guard that would silently narrow if the union were ever relaxed. Consider `assert.ok(!isAnthropicFirstPartyHost(host))` or removing the redundancy.
2. `isAnthropicFirstPartyHost` port-strip `split(":")[0]` (headers.ts:96) mangles IPv6 literals (`[::1]` → `[`) — harmless today (result `false` = safe direction) but worth a comment.
3. Prior review's forward note still open (by design, next node): anthropic provider must re-assert L7 on final URL after `fetch` cross-origin redirect, since fetch strips only authorization/host on redirect — compat UA/`x-app` would survive. Not a blocker; no provider exists in this node.

VERDICT: APPROVE_WITH_NITS
