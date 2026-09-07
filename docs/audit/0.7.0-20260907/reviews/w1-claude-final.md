# W1 Historical-Origin Correction — Independent Review

Scope: single packet `/private/tmp/cmspark-w1-review-snapshot/w1-history-origin.md`. Read-only; no edits, commands, or subagents. No prior packets consulted. All findings `[inspected]` (static only, per constraints).

## 1. Verification of the packet's correction claims

### Claim: "www and casing were normalized BEFORE skillName was formed" — SUPPORTED by included sources
`[inspected]` In `site-op-memory.ts` @63aa4c63, every origin that reaches the site-op memory layer passes through `originForSiteOp()` → `canonicalizeSiteOrigin(originKeyFromUrl(url))`:
- `originKeyFromUrl` (dom-script-budget.ts:344) uses `new URL(s).host` — WHATWG URL parsing lowercases the host, so casing is normalized and non-default ports are retained (`u.host` includes `:port`).
- `canonicalizeSiteOrigin` (site-op-memory.ts:87) strips `www.` case-insensitively via `/^(https?:\/\/)www\./i`, preserving scheme and port.

So any producer consuming the site-op origin (which the `["site-op-memory"]` tag in the historical adapter implies — the tag originates in this very module) would receive `https://example-com`-shaped input, never `www-Example-COM`. The correction's direction is consistent with the included evidence. The final `legacyId` derivation (`url.host.toLowerCase().replace(/^www\./,"").replace(/\./g,"-")`) reproduces exactly this normalization: `https://www.Example.COM` → `example-com`, `https://example.com:8443` → `example-com:8443`.

### Claim: "the new helper probes that exact legacy key when its caller has the origin/port" — VERIFIED
`[inspected]` `readSiteExperienceEntries` (line 487) probes `[identity.id, identity.legacyId]`. For `https://example.com:8443`, `legacyId === "example-com:8443"` — the port-bearing key. Test at line 559 exercises this exact path and passes by inspection.

### Claim: "hostname-only legacy caller cannot recover unknown port files... deferred to W2" — VERIFIED as stated
`[inspected]` `readSiteExperienceEntries("example.com", ...)` probes only `"example-com"`, never `"example-com:8443"` (port is not enumerable from a hostname). The same holds in reverse: an apex caller misses port-specific legacy files even though `matchesSiteExperience` host-comparison would accept them. Correctly documented as a deferred preexisting limitation, not claimed fixed.

### Claim: "New v1 writes remain metadata guarded" — READ PATH VERIFIED, WRITE PATH NOT IN PACKET
`[inspected]` Read side: v1 identity requires `type === "site_knowledge"` + `tags` includes both `"auto"` and `"site-op-memory"`; legacy reads accept the historical `["site-op-memory"]` marker only when `id === identity.legacyId` (line 491). The pre-auto-tag historical doc is never `isOwnedSiteExperience`-owned (test line 549), so it can't become an automatic write target. The write path itself is asserted but not included in this packet — I cannot verify the write-side guard from here. Noted, not a code defect.

## 2. Code walkthrough findings

- **Identity function**: errors on non-HTTP(S), empty host; `host` excludes port (hostname-based v1 identity), `legacyId` includes non-default port (historical parity). URL default-port normalization (`:443`/`:80` stripped) matches historical `u.host` behavior — consistent.
- **`matchesSiteExperience`**: wildcard/comma guard runs before identity comparison; host comparison is normalized on both sides (lowercase, www-stripped, port-ignored). Try/catch handles identity throws. Correct.
- **Read precedence**: v1 entries inserted first, legacy deduped by `entry.content`; v1 wins ties including staleness — matches test 3 (line 533–540) by inspection.
- **Tests**: all four identity tests and the port/www test trace to correct expectations against the code by hand. No syntax or expectation errors found.

## 3. Remaining issues (nits)

1. **Producer→filename linkage is inferred, not shown in this packet.** The two included historical files prove origin normalization *upstream*; the adapter that formed the filename from the canonical origin (`createExperienceSkill(..., ["site-op-memory"], entry)`) is referenced (line 543) but its source is not included. The inference is strong and safe-direction (the helper now probes the canonical key), but the direct link remains unverified in this packet. Worst case if a `www-` key ever existed, it would remain unread — same class as the deferred port limitation, so not blocking.
2. **`originKeyFromUrl` does not strip `www.`** (dom-script-budget.ts:344) — only the site-op path canonicalizes. Fine today because the experience producer carries the site-op tag, but worth a one-line note that any future consumer of `originKeyFromUrl` must apply `canonicalizeSiteOrigin` before deriving filenames. Historical context only, no current regression.
3. **Missing combined test**: no case for `www` + uppercase + port together (e.g., `https://www.Example.COM:8443` → expected `example-com:8443`). Code is correct by inspection; the test would lock in the interaction.
4. **IPv6 / exotic hosts**: `legacyId` can contain `[` `]` `:` (e.g., `[::1]:8443`) — unsafe filename characters on some filesystems. Historical parity (same derivation), but undocumented in the comment at line 452.
5. **Leading-`www.` strip on hostnames like `www.com`** collapses to `com`. Preexisting historical behavior faithfully replicated; not introduced here.

No concrete W1 code regressions found in the final code or tests. The correction is internally consistent with the included historical sources.

## VERDICT: APPROVE_WITH_NITS

Rationale: the correction's three behavioral claims (www/case normalization upstream, port-retaining legacy key probing, v1 metadata guarding on read) are all verified against the included sources and tests; the one unverifiable link (producer source) is an evidence gap consistent with prior review context, not a code defect, and the deferred port-recovery limitation is honestly scoped. Nits 1–5 above are non-blocking; nits 1–2 deserve a sentence each in W2 documentation.
