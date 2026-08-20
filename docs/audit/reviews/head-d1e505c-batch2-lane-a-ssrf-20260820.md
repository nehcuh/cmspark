# Lane A (SSRF / LLM-endpoint DNS / IMDS) — independent adversary

**Date**: 2026-08-20
**Reviewer**: Lane A (did not implement this batch; did not rubber-stamp)
**Repo**: `/Users/huchen/Projects/cmspark`
**Base**: `d1e505cd725e6cf105e009476468e81af727a226` (`main` HEAD)
**Branch**: `fix/head-d1e505c-adversary-residuals`
**Frozen patch**: `docs/audit/reviews/head-d1e505c-batch2-diff-20260820.patch`
**Scope**: SSRF / LLM-endpoint DNS / IMDS / settings-web / request-path gate. Voice STT and osascript L2 ignored unless they leak a trust skip into this path.

## Patch freshness

[executed] `git diff d1e505c` byte-matches the frozen patch for every file it lists (24 files). SHA of each per-file hunk pair identical. Patch is **not stale**.

Working tree vs `d1e505c`: +676 / −111 across those 24 files. Untracked review artifacts only (this report among them).

## Capability declaration (verified, not trusted)

| Axis | Claimed | Lane A |
|------|---------|--------|
| Surface | L1 LLM endpoint + existing L2 osascript (no new Surface) | **Hold** for this path. No new LLM fetch Surface. Osascript edits exist in the same patch (`message-router.ts`, `companion-dispatch.ts`) but do not skip this gate (out of Lane A unless leak; none found). |
| L2-classes | none new | **Hold** |
| Compose | none | **Hold** |
| Autonomy | single | **Hold** |
| Trust | monotonic — more IMDS forms blocked; DNS fail-closed; unkeyed vision `detected` ignored | **Hold on this path.** Lexical IMDS expanded (XLAT + GCP trailing-dot). DNS fail-closed with distinct copy. `resolveNativeVision` ignores unkeyed `detected`. No new `auto_approve_*` write, whitelist write, or confirm skip in the SSRF files. |
| Channel | community | **Assumed** from the declaration; not re-derived. |

Osascript regex is no longer a tokenless / post-L2 hard-block. That is a Trust *relaxation on a different surface*. It does not leak into `throwIfLlmEndpointBlocked` / `assertLlmEndpointAllowedAsync`. Not scored here.

## Method

1. Read live `companion/src/security.ts`, `settings-web.ts`, providers, vision-pipeline, connection-test, config handlers, lifecycle, `likely-multimodal.ts`.
2. Hostile probes via `npx tsx` importing **live** `src/` (not tests, not `.test-dist`).
3. Targeted tests only (no full `npm test`): `llm-endpoint-url`, `likely-multimodal`, `llm-connection-test`, `llm-provider-anthropic`, `settings-web` → **73/73 pass**.

---

## Claims

### 1. S-XLAT — IPv4-translated `::ffff:0:0:0/96` reduces to IMDS and is blocked

**Claim**: `[::ffff:0:a9fe:a9fe]`, `[::ffff:0:169.254.169.254]` → 169.254.169.254, blocked. Public NAT64 `64:ff9b::808:808` allowed. `::1` allowed.

**Code** [inspected]: `embeddedV4FromGroups` at `companion/src/security.ts:234-258`. New branch `241-247` matches groups `[0,0,0,0,0xffff,0,hi,lo]`. Disjoint from:

- v4-mapped (`groups[5]===0xffff`, line 237)
- v4-compatible (first six groups 0 and `groups[6]>>8 !== 0`, line 248)
- NAT64 well-known (`0x64,0xff9b` + four zeros, line 251)
- 6to4 (`groups[0]===0x2002`, line 254)

**Probes** [executed] `assertLlmEndpointUrlAllowed` / `assertLlmEndpointAllowedAsync` / `normalizeIpLiteral`:

| URL | WHATWG hostname | lexical | async |
|-----|-----------------|---------|-------|
| `http://[::ffff:0:a9fe:a9fe]/v1` | `[::ffff:0:a9fe:a9fe]` | IMDS | IMDS |
| `http://[::ffff:0:169.254.169.254]/v1` | canonicalized to `[::ffff:0:a9fe:a9fe]` | IMDS | IMDS |
| `http://[0:0:0:0:ffff:0:a9fe:a9fe]/v1` | `[::ffff:0:a9fe:a9fe]` | IMDS | IMDS |
| `http://[64:ff9b::808:808]/v1` | same | **null (allow)** | **null** |
| `http://[::1]:11434/v1` | `[::1]` | **null** | **null** |
| `http://[::ffff:0:808:808]/v1` (SIIT of 8.8.8.8) | same | **null** | — |
| `http://[::ffff:a9fe:a9fe]/v1` (v4-mapped) | same | IMDS | — |
| `http://[64:ff9b::a9fe:a9fe]/v1` (NAT64 IMDS) | same | IMDS | — |
| `http://[2002:a9fe:a9fe::]/v1` (6to4 IMDS) | same | IMDS | — |

`normalizeIpLiteral("::ffff:0:a9fe:a9fe")` → `"169.254.169.254"`. `net.isIPv6` accepts the SIIT form, so `parseIpv6Groups` is not skipped.

**XLAT misfire on other layouts?** [executed] No steal of v4-mapped / NAT64 / 6to4 / `::` / `::1`. Public SIIT `::ffff:0:808:808` correctly stays allowed (not IMDS).

Non-canonical embeddings that are **not** RFC 2765 SIIT stay unreduced (see P2-A5). They are not the claimed forms.

**Verdict on claim: HOLD.**

### 2. S-GCPDOT — trailing-dot GCP alias

**Claim**: `isCloudMetadataIp` strips trailing dots so `metadata.google.internal.` matches.

**Code** [inspected]: `companion/src/security.ts:296-309` — `h.replace(/\.+$/, "")` then exact compare. `canonicalizeLlmHostname` (`340-344`) does the same for allowlist / DNS.

**Probes** [executed]:

- `http://metadata.google.internal./` → IMDS (lexical + async)
- `http://METADATA.GOOGLE.INTERNAL./` → IMDS (WHATWG lowercases)
- `isCloudMetadataIp("metadata.google.internal.")` → `true`
- `canonicalizeLlmHostname("metadata.google.internal.")` → `"metadata.google.internal"`

Image-fetch (`isCloudMetadataIp` consumer) inherits the strip — Trust-monotonic extra block, not a new skip.

**Verdict on claim: HOLD.**

### 3. S-NODNS / N1 — distinct IMDS vs DNS-fail copy

**Claim**: `classifyLlmHostnameDns` + `assertLlmEndpointAllowedAsync`: IMDS copy vs DNS-fail copy are DISTINCT. NXDOMAIN is not labeled metadata.

**Code** [inspected]:

- `LLM_ENDPOINT_IMDS_ERROR` = `"Cloud-metadata / link-local hosts are not allowed"` (`security.ts:336`)
- `LLM_ENDPOINT_DNS_ERROR` = `"Could not resolve LLM host (DNS failed)"` (`337`)
- `classifyLlmHostnameDns` (`353-369`): IP literals skip DNS; empty answers / lookup errors → `"unresolved"`; any A/AAAA in IMDS/link-local tables → `"imds"`
- `assertLlmEndpointAllowedAsync` (`376-389`): lexical first (IMDS copy), then `kind === "imds"` vs `"unresolved"`

**Probes** [executed]:

- `http://169.254.169.254/v1` → IMDS, not DNS
- `http://unresolvable.invalid/v1` → DNS, `!==` IMDS
- `classifyLlmHostnameDns("unresolvable.invalid")` → `"unresolved"`
- `classifyLlmHostnameDns("[::ffff:0:a9fe:a9fe]")` → `"imds"` (canonicalizes brackets, `net.isIP` == 6, no DNS)
- Mock `dns.promises.lookup` → `169.254.169.254` for `https://imds.example.test/v1` (via unit test + Anthropic provider test): IMDS, no fetch
- Mock ENOTFOUND for Anthropic `streamChat`: DNS copy, `fetched === false`

settings-web `/api/test` [executed via tests]: NXDOMAIN copy matches `/resolve|DNS/i` and does **not** match `/metadata|link-local/`; IMDS-resolving hostname matches metadata copy and not DNS copy.

**Verdict on claim: HOLD.**

Note: `hostnameResolvesToImds` (`371-373`) is `kind !== "ok"` so DNS fail is `true`. **No production caller** (grep: definition + tests only). Misleading name; see nit A6.

### 4. N2 — `canonicalizeLlmHostname` for settings-web allowlist AND `net.isIP`

**Claim**: trailing-dot `localhost.` hits allowlist.

**Code** [inspected]: `settings-web.ts:144-155` — `canonicalizeLlmHostname` before `LLM_HOST_ALLOWLIST.has`, `net.isIP`, and DNS.

**Probes** [executed]:

- `canonicalizeLlmHostname("LocalHost.")` → `"localhost"` (unit test)
- `canonicalizeLlmHostname("[::1]")` → `"::1"`
- settings-web test `POST /api/test trailing-dot localhost hits allowlist (not DNS)` — `http://localhost.:9/v1` error is **not** metadata/DNS (connection fail). Pass.

`http://localhost.:11434/v1` lexical allow [executed] (`assertLlmEndpointUrlAllowed` → null).

**Verdict on claim: HOLD.**

### 5. N3 — chat / request path is DNS-gated before fetch

**Claim**: `OpenAIProvider.streamChat/complete`, `AnthropicProvider.streamChat/complete`, vision-pipeline, lifecycle vision health check, `probeLlmConnection`, `config.test` / `config.testVision`.

**Call graph** [inspected]:

| Site | Gate | Before fetch? |
|------|------|----------------|
| `openai.ts:37` `streamChat` | `throwIfLlmEndpointBlocked(this.config.base_url)` | yes, before `client.chat.completions.create` |
| `openai.ts:112` `complete` | same | yes |
| `anthropic.ts:64` `streamChat` | same | yes, before `fetch(url)` |
| `anthropic.ts:104` `complete` | same | yes |
| `adapter.ts` / `llm-extract.ts` / `skill-engine.ts` | `createProvider` → those methods | yes |
| `vision-pipeline.ts:166-175` `doAnalyze` | `assertLlmEndpointAllowedAsync(visionUrl)` | yes, before `new OpenAI` + `chat.completions.create` |
| `ws/lifecycle.ts:613-614` | `throwIfLlmEndpointBlocked(visionUrl)` | yes, before `models.list()` |
| `connection-test.ts:89-93` `probeLlmConnection` | `assertLlmEndpointAllowedAsync` | yes |
| `handlers/config.ts:330-334` `config.test` | async gate, then `probeLlmConnection` (second gate) | yes |
| `handlers/config.ts:362-366` `config.testVision` | async gate, then `models.list()` | yes |

**Probes** [executed] with `dns.promises.lookup` forced to `169.254.169.254` and `fetch` mocked:

- `assertLlmEndpointAllowedAsync("https://api.openai.com/v1")` → IMDS
- `probeLlmConnection({ base_url: "https://api.openai.com/v1", ... })` → `{ ok:false, error: IMDS }`, **fetchCalls []**
- `OpenAIProvider.complete` / `streamChat` throw IMDS, **fetch []**
- `AnthropicProvider.complete` throw IMDS, **fetch []**

Anthropic unit tests: NXDOMAIN and IMDS-resolving host do not fetch.

**Verdict on claim: HOLD** for the listed N3 sites.

Gap (not in the N3 list, still in Lane A surface): settings-web `/api/testVision` fetch after allowlist skip — see P2-A1. `/api/test` is covered because it calls `probeLlmConnection`.

`probeNativeVision` (`connection-test.ts:135-177`) has **no** gate. Sole production caller is `config.test` *after* both gates. See P2-A2.

`POST /api/config` saves `base_url` with only `new URL` parse (`handlers/config.ts:444-447`). Persistence of an IMDS URL is not a fetch. Request-path choke still fires later.

### 6. C1 — `resolveNativeVision` ignores unkeyed `opts.detected`

**Code** [inspected]: `companion/src/llm/likely-multimodal.ts:30-46` — `void opts.detected`; routing is override → name heuristic → keyed `{url,model}` cache only.

Panel lock-step [inspected]: `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts:154-169` also ignores unkeyed `detected`.

`adapter.ts:527-531` and `visionConfigForAnalyze` (`likely-multimodal.ts:73-80`) do **not** pass `detected`.

**Probes** [executed]:

- `resolveNativeVision({ modelName: "foo-bar-7b", mode: "auto", detected: true })` → `false`
- `detected: false` on `gpt-4o` still `true` (heuristic)
- `mode: "on"` still `true`

Unit test `resolveNativeVision: on/off override heuristic` pass.

**Verdict on claim: HOLD.**

---

## Hostile questions

### Q1. Re-run XLAT / GCPDOT against live compiled functions. `::1` and public NAT64 still allowed?

**Yes.** [executed] See claim 1–2 tables. `::1` and `64:ff9b::808:808` remain allowed. Decimal / hex / octal IPv4 (`2852039166`, `0xa9fea9fe`, `0251.0376.0251.0376`) WHATWG-canonicalize to `169.254.169.254` and are blocked.

### Q2. Does the XLAT matcher misfire on other group layouts (v4-mapped, NAT64, 6to4)?

**No steal.** [executed] Matchers are prefix-disjoint. v4-mapped IMDS still blocked by the *old* branch. NAT64/6to4 IMDS still blocked by their branches. Public NAT64 / public 6to4 (`2002:808:808::`) allowed.

### Q3. Does fail-closed DNS on the REQUEST path block legitimate LAN hostnames that don't resolve?

**Yes, by design, for names.** [executed] With lookup forced to throw:

- `http://10.251.241.12/v1` (RFC1918 **literal**) → **allowed** (`net.isIP`, no DNS)
- `http://ollama.lan/v1` → DNS_ERROR
- `http://localhost/v1` → DNS_ERROR (localhost is a name)

Production callers all go through `assertLlmEndpointAllowedAsync` / `throwIfLlmEndpointBlocked` (N3 table). CI fixtures that used `.example` hosts were updated to mock DNS (`llm-connection-test.test.ts:15-26`, Anthropic `beforeEach` public lookup).

Availability residual: mDNS `.local` / broken `localhost` getaddrinfo fails closed. Users can still use RFC1918 / loopback **literals**. Not a security defect.

### Q4. Can an allowlisted public host (`api.openai.com`) skip DNS and rebind to IMDS?

**Request path: no.** [executed] Mock A=`169.254.169.254` → `assertLlmEndpointAllowedAsync("https://api.openai.com/v1")` is IMDS; OpenAI/Anthropic providers and `probeLlmConnection` do not fetch.

**settings-web `/api/test`: no (second gate).** [executed] `validateTestBaseUrl` allowlist-skips (`settings-web.ts:147`), then `probeLlmConnection` DNS-gates. POST `/api/test` with openai + IMDS DNS → IMDS error, fetchCalls `[]`.

**settings-web `/api/testVision`: yes, skip then fetch.** [executed]

```
POST /api/testVision https://api.openai.com/v1  + DNS→IMDS
  → { ok:true, message:"success: 200 (gpt-4o)" }
  fetchCalls: ["https://api.openai.com/v1/models"]

POST /api/testVision http://api.openai.com/v1  + DNS→IMDS
  → { ok:true, ... }
  fetchCalls: ["http://api.openai.com/v1/models"]
```

Cause: `llmHostBlockReason` returns `null` for allowlisted names (`settings-web.ts:147`) and the vision branch (`477-485`) `fetch`es without `assertLlmEndpointAllowedAsync`.

Why not P1:

- N2 documents the allowlist skip as intentional (localhost / public providers).
- Real `https://api.openai.com` rebind still dies on TLS (cert ≠ IMDS). HTTP allowlisted names are the theoretical hole.
- Settings server is loopback + unguessable token; attacker who poisons `api.openai.com` already owns resolver.
- Chat / `config.test` / `probeLlmConnection` do **not** skip.

Scored P2-A1.

### Q5. TOCTOU: lexical allow then later DNS rebind — is the request-path gate actually before fetch, or only on probe?

**Before fetch on N3 sites.** [inspected + executed] `throwIfLlmEndpointBlocked` is the first `await` in `streamChat`/`complete`. Probe is not the only choke.

Residual TOCTOU remains: lookup at T1 vs `fetch`/SDK connect at T2 (no address pin). Redirect-follow to IMDS after a public first hop is also unblocked. Classic SSRF class; pinning would be the real fix. P2-A3, not merge-blocking for community-channel user-configured LLM URLs.

### Q6. Trust monotonicity: no new auto-approve / whitelist write / confirm skip?

**On this path: yes.** [inspected] Diff of `security.ts` / `settings-web.ts` / providers / vision / connection-test / config.test* / lifecycle / `likely-multimodal.ts`: only tighter IMDS, DNS fail-closed, unkeyed `detected` ignored, request-path throws.

No new `auto_approved_domains` write, no new `auto_approve_dangerous` default, no confirm skip in these files.

Out of Lane A: osascript regex hard-block removal. Does not skip LLM DNS/IMDS.

---

## Findings

### P2-A1 — `/api/testVision` allowlist skip then fetch (no second DNS gate)

- **File**: `companion/src/settings-web.ts:147` (skip), `:477-485` (fetch)
- **Sev**: P2 (non-blocking)
- **Evidence**: [executed] mock DNS A=169.254.169.254 still fetched `http(s)://api.openai.com/v1/models`
- **Why not P1**: TLS on HTTPS; loopback+token; chat path gated; `/api/test` re-gates
- **Suggestion**: run `assertLlmEndpointAllowedAsync(validatedBaseUrl)` in the vision branch (same as `probeLlmConnection`), or drop the allowlist skip for non-loopback names

### P2-A2 — `probeNativeVision` has no DNS gate

- **File**: `companion/src/llm/connection-test.ts:135-177`
- **Sev**: P2
- **Evidence**: [inspected] no `assertLlmEndpointAllowedAsync`; sole caller `handlers/config.ts:338` is after two gates
- **Suggestion**: gate inside `probeNativeVision` so a future caller cannot fetch blind

### P2-A3 — lookup-then-fetch TOCTOU + redirect-follow

- **File**: `security.ts:353-395` + every `fetch` / OpenAI SDK call after the gate
- **Sev**: P2 residual
- **Evidence**: [inspected] `dns.promises.lookup` then later `fetch` uses a second getaddrinfo; Anthropic `fetch` default-follows redirects
- **Suggestion**: pin resolved addresses (custom lookup + connect-to-IP + Host header) and `redirect: "error"` / re-validate Location

### P2-A4 — Alibaba IMDS `100.100.100.200` still allowed

- **File**: `security.ts:296-309`, `318-334`
- **Sev**: P2 pre-existing (intranet/CGNAT tradeoff)
- **Evidence**: [executed] `assertLlmEndpointAllowedAsync("http://100.100.100.200/latest/meta-data")` → `null`
- **Note**: LLM gate *intentionally* allows RFC1918 / CGNAT so LAN OpenAI-compat works. Not introduced by this batch.

### P2-A5 — Non-canonical IPv6 embeddings not reduced

- **File**: `security.ts:234-258`
- **Sev**: nit / P2-low
- **Evidence**: [executed] `http://[::ffff:0:0:a9fe:a9fe]/v1` allowed (ffff in hextet 3, not SIIT `/96`). `http://[2001:db8::5efe:a9fe:a9fe]/v1` (ISATAP-shaped) allowed. `http://[ffff::a9fe:a9fe]/v1` allowed.
- **Why not P1**: those are not RFC 2765 SIIT / v4-mapped / WKP NAT64 / 6to4. Typical macOS/Linux stacks will not treat them as IPv4 169.254.169.254. `fe80::5efe:a9fe:a9fe` is already blocked by `fe80::/10`.

### Nit-A6 — `hostnameResolvesToImds` lies on DNS fail

- **File**: `security.ts:371-373`
- **Evidence**: [inspected] `!== "ok"`; [executed] tests expect NXDOMAIN → `true`. No production caller.

### Nit-A7 — Fail-closed names vs LAN mDNS

- **File**: `security.ts:353-388` production callers in N3 table
- **Evidence**: [executed] `localhost` / `ollama.lan` DNS-fail → DNS_ERROR; RFC1918 literals still work
- **Note**: intentional. Document for operators using `.local` hostnames.

### Nit-A8 — OpenAIProvider has no dedicated DNS/IMDS unit test

Anthropic has `streamChat DNS NXDOMAIN…` / `host resolving to IMDS…`. OpenAI path confirmed only by live probe in this review. Non-blocking.

---

## Targeted tests [executed]

```
npx tsx --test tests/llm-endpoint-url.test.ts \
  tests/likely-multimodal.test.ts \
  tests/llm-connection-test.test.ts \
  tests/llm-provider-anthropic.test.ts \
  tests/settings-web.test.ts
```

**73 pass / 0 fail.** Did not run full `npm test`.

---

## Claim scoreboard

| ID | Result | Evidence |
|----|--------|----------|
| S-XLAT | HOLD | [executed] |
| S-GCPDOT | HOLD | [executed] |
| S-NODNS / N1 | HOLD | [executed] |
| N2 canonicalize allowlist | HOLD | [executed] |
| N3 request-path DNS | HOLD on listed sites | [executed]+[inspected] |
| C1 unkeyed `detected` | HOLD | [executed] |
| Trust monotonic (this path) | HOLD | [inspected] |
| Q4 allowlist rebind | mitigated on chat/`/api/test`; residual on `/api/testVision` | [executed] |
| Q5 TOCTOU | gate is pre-fetch; pin/redirect residual | [inspected] |

No P0/P1 that must block merge.

VERDICT: APPROVE_WITH_NITS
