I've verified the plan against the code. All factual claims check out:
- `message-router.ts:397` resolves hostname exactly as quoted.
- `background/index.ts:395-400` (chat.send), `:432-437` (regenerate), `:291-295` (quickAction fallback) all omit hostname.
- `server.ts:4275-4289` validators are permissive (won't reject new fields).
- `skill-engine.ts:234` `getBySite` filters on `type === "site_knowledge"` — won't pull user `skills/` notes by accident.
- Cookie tools do use explicit domain params + `trusted_domains`, independent of this path.

The two existing review files (`-claude-…md`, `-pi-…md`) are empty placeholders — this response *is* the Claude review.

---

# Review: Site-knowledge auto-load via chat hostname

## 1. Verdict

**APPROVE-WITH-AMENDS.** Diagnosis is correct, scope is appropriately minimal, risk profile is genuinely low (hostname only selects from the user's *own* knowledge store; it is not a tool-permission boundary). Three mechanical amends are needed before implementation; none change the design.

## 2. Findings (severity-ranked)

### L1 — Companion-side hostname normalization is required, not optional (plan §2)

`companion/src/skills/site-matcher.ts:15-24` does case-sensitive `pattern === hostname` / `hostname.endsWith("." + suffix)`. `chrome.tabs.query` returns the hostname in whatever case is in the URL bar — `https://GitHub.com/NaTe` is real and common. Without normalization, those tabs won't match a `github.com` pattern.

Plan §2 currently lists "lowercase hostname, strip trailing dots" under "Optionally." It must be mandatory, and it must happen **companion-side** at `message-router.ts:397` (not extension-side only), because:
- The extension is one client; the WS protocol accepts others.
- The server is the trust boundary for this field.

Suggested helper applied at `message-router.ts:397` and `:749`:

```ts
function normalizeHostname(h?: string): string | undefined {
  if (!h) return undefined
  let n = h.trim().toLowerCase().replace(/\.+$/, "")
  return n || undefined
}
const currentHostname = normalizeHostname(rest.hostname) 
  ?? (rest.url ? safeHostname(rest.url) : undefined)
```

### L2 — `new URL(rest.url)` can throw and abort the chat (plan §1 + message-router.ts:397)

`message-router.ts:397` is `rest.url ? new URL(rest.url).hostname : undefined` — no try/catch. Today `rest.url` is always undefined so it never fires; once the extension starts sending `url`, a malformed value (or a future malformed client) will throw and kill the chat path. The plan's own `getActiveTabContext` uses try/catch for exactly this; mirror that on the companion side. If you adopt my Q3 answer (drop `url` entirely), this finding evaporates — pick one.

### L3 — Validator should type-check the new optional fields (plan §2, server.ts:4275)

The validators at `server.ts:4275-4289` are permissive on unknown fields, so the plan's "no contract change required" is technically true. But the plan itself recommends documenting the fields as optional strings — make that concrete by extending both validators:

```ts
if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
```

Defense in depth: rejects malformed payloads early instead of letting them reach the URL parser.

### L4 — `file.upload` path silently skipped (plan §1, message-router.ts:453-590, background/index.ts:408-421)

`file.upload` → `chatCreate({...})` at `message-router.ts:566` with no hostname resolution, and `background/index.ts:409` also sends no hostname. The plan lists "same enrichment for chat.regenerate and quickAction" but omits `file.upload`. Result: a user who attaches a file while on `example.com` won't get site knowledge, while a plain chat on the same tab will. Inconsistent. Either:
- Add hostname to `file.upload` too, OR
- Explicitly document in plan §4 (out of scope) that file chats don't get site knowledge.

### N1 — Acceptance criterion for case-insensitive matching (plan §Acceptance)

Add step 6: *"Verify `https://Example.com` (mixed case) still matches a `example.com` site pattern."* Otherwise L1 will ship untested.

### N2 — Logging posture for hostname (plan §Risk table)

Add a row: hostname is local-only PII; default-log at `debug` (not `info`); if telemetry/crash reporting is ever added, hostname must be in the redaction list (treat like cookie domain). Local agent today → low concern, but make the rule explicit so a future change doesn't quietly leak it.

## 3. Answers to Reviewer questions

**Q1 — APPROVE / APPROVE-WITH-AMENDS / REJECT?**
APPROVE-WITH-AMENDS, per findings L1–L4. Amends are mechanical.

**Q2 — Fall back to first pinned tab hostname if active tab is chrome://?**
**No.** Pinned tabs are sticky context unrelated to the current task (pinned mail/calendar/docs while the user is on `chrome://settings`). A pinned-tab fallback would silently inject the wrong site's knowledge and undermine the "the page I'm looking at = the page that informs this chat" mental model. Predictable empty-on-chrome:// is better than clever-but-wrong. Keep current plan behavior.

**Q3 — Pass only `hostname`, or both `hostname` + `url`?**
**Pass only `hostname`.** Rationale:
- Companion only consumes hostname for `getBySite` / `matchSite`. URL path/query is never used.
- Full URLs routinely carry tokens, search terms, PII (`?q=…`, `?token=…`, `/u/bob`). Shipping them across WS for zero benefit is gratuitous surface.
- Removing `url` from the wire payload also dissolves finding L2 (no `new URL()` to throw) and shrinks N2's redaction scope.
- Update plan §1's send snippet to drop the `url` field; the companion's URL-parsing fallback at `message-router.ts:397` becomes dead code and can be removed for clarity.

**Q4 — Privacy concern logging hostname in companion logs?**
Local-only today: low concern, but — see N2. Default to `debug` level, never log the full URL, and put hostname on the future-telemetry redaction list. Don't gate the PR on this; just add the rule.

## 4. Should implementation proceed now?

**Yes — after applying L1–L4.** Those four amends are localized:
1. One normalize helper + calls at `message-router.ts:397`, `:749`.
2. (Resolved by Q3 — drop `url`.)
3. Two validator blocks at `server.ts:4275`, `:4285`.
4. Either include `file.upload` or move it to §4.

Risk is low and bounded: the worst a spoofed hostname can do is inject a doc *the user already authored* into *their own* prompt. Cookie/evaluate/navigate trust boundaries are untouched (verified — they don't read `rest.hostname`). Tests called for in plan §3 are sufficient; add the case-insensitive acceptance step (N1).

Want me to write this to `docs/audit/reviews/site-knowledge-hostname-fix-claude-20260728.md` (currently empty placeholder)?
