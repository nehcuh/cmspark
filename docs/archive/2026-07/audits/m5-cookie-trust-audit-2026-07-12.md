# M5 audit — cookie extension-side trust execution (CLOSED: not a gap)

> **Date**: 2026-07-12
> **Status**: Closed as 误报 (Case B) after code grounding. Per kimi directive, close M5 and move to follow-up C (MCP tool-call gate).
> **Scope**: Does the cookie tool's extension-side execution re-validate `trusted_domains`, or is it an unguarded pass-through?

## Conclusion

**Not a gap.** The extension is a pure pass-through executor of companion-validated params. Every cookie tool call passes through the companion's `isTrustedDomain` gate **before** it is dispatched to the extension; untrusted domains never reach the extension. There is no second, unguarded path to `chrome.cookies`. The trust boundary is correctly placed at the companion gate, not the extension.

## Grounding (code references)

### 1. Companion gates BEFORE dispatch — `companion/src/server.ts:235-271`

```ts
const COOKIE_TOOLS = ["get_cookies", "set_cookie", "delete_cookie", "list_all_cookies"]
if (COOKIE_TOOLS.includes(toolName)) {
  let isSafe = false
  let targetDomain = ""
  if (toolName === "get_cookies")      { targetDomain = finalParams.domain || ""; isSafe = isTrustedDomain(targetDomain) }
  else if (toolName === "set_cookie")  { targetDomain = finalParams.domain || getDomainFromUrl(finalParams.url || ""); isSafe = isTrustedDomain(targetDomain) }
  else if (toolName === "delete_cookie"){ targetDomain = finalParams.domain || getDomainFromUrl(finalParams.url || ""); isSafe = isTrustedDomain(targetDomain) }
  else if (toolName === "list_all_cookies") { isSafe = isTrustedDomain("*"); targetDomain = "Global / All Domains" }
  if (!isSafe) {
    // returns { success:false, error:"Security Block: ..." } — extension NEVER sees this call
    return result
  }
}
```

This runs inside `createToolExecutor` (server.ts:202) — the **only** `executeTool` (wired at server.ts:1791, passed to the session at :1966). There is no alternate dispatch path. `list_all_cookies` additionally requires the `"*"` global wildcard to be in `trusted_domains` (security.ts:8/23: `"*"` matches any hostname).

### 2. Extension is pass-through — `chrome-extension/src/background/browser-bridge.ts:928-960`

```ts
getCookies(params)     → chrome.cookies.getAll({ domain: params.domain })   // pass-through
setCookie(params)      → chrome.cookies.set({ url, name, value, domain, ... })  // pass-through
deleteCookie(params)   → chrome.cookies.remove({ url: params.url, name: params.name })  // pass-through
listAllCookies()       → chrome.cookies.getAll({})  // all cookies (gate requires "*" trusted)
```

The extension uses `params.domain` / `params.url` verbatim — but these params were already validated by the companion gate before dispatch. The extension does not (and need not) re-validate.

### 3. Single entry point — `chrome.cookies` only in `browser-bridge.ts`

`grep -rn "chrome.cookies" chrome-extension/src/` returns exactly 4 hits, all in `browser-bridge.ts:930/938/953/958`. There is **no** other call site — no extension UI button, no separate WS message type, no content script. `index.ts` has no cookie-specific message handler (the only "cookie" hit is a file-header comment). The sole path to `chrome.cookies` is `tool.execute` → `BrowserBridge.execute()` → the cookie handlers, which is gated by the companion.

### 4. L0 WS authentication covers the path — `server.ts:63-68`

> "A peer is UNauthenticated until it completes the ws-auth challenge–response handshake (auth.handshake). Every app message is rejected (and the connection terminated) until then, so a local process that forged the Origin header still cannot drive the agent without the shared secret." (PR #35)

An attacker cannot craft a `tool.execute` cookie message to the extension without the shared secret. With the secret, the companion (the gatekeeper) is already compromised — that is a trust-root failure, out of M5's scope. The cookie gate is enforced by the authenticated companion, not the extension.

### 5. Scheme edge case (kimi Q4) — `getDomainFromUrl` (`server.ts:51-58`)

```ts
function getDomainFromUrl(urlString: string): string {
  try { return new URL(urlString).hostname } catch { return "" }
}
```

`new URL("javascript:...").hostname` = `""`; `new URL("data:...").hostname` = `""`; same for `blob:`. `isTrustedDomain("")` = `false` (empty host never matches). So a `set_cookie`/`delete_cookie` call carrying a non-http(s) URL (and no explicit `domain`) derives an empty domain → blocked. No separate scheme block is needed for cookie tools; the domain gate covers it.

## Answering kimi's checklist

| Question | Answer |
|---|---|
| Q1. Does the extension call `chrome.cookies` on the message URL without reusing companion's validated result? | It uses the params directly, **but** they were companion-validated before dispatch. No unvalidated branch. |
| Q2. Can an attacker craft a message to make the extension do cookie ops on a non-trusted domain? | No — the companion gate blocks untrusted domains before dispatch, and the extension WS is L0-authenticated. |
| Q3. Does the extension re-parse domain from a tab URL? | No — it uses the companion-supplied `params.domain`/`params.url` verbatim (pass-through). |
| Q4. Does scheme blocking cover cookie tools? | Yes, indirectly — `getDomainFromUrl` yields `""` for `javascript:`/`data:`/`blob:` → `isTrustedDomain("")` = false → blocked. |

## Fragility note (not a gap)

The extension trusts the companion completely (pass-through). This is correct given the companion-as-gatekeeper + L0-authenticated-channel architecture, but it means: **any future code path that reaches `chrome.cookies` WITHOUT going through the companion gate** (e.g. a new extension-side cookie UI, or a new WS message type) would have no trust check. Today no such path exists. Worth a one-line lint/grep guard in review if cookie-touching UI is ever added — not actionable now.

## Disposition

**Close M5 as 误报.** No code change. Per kimi: move to follow-up C (MCP tool-call gate — god-mode should not auto-approve MCP tool capability) as the next milestone.
