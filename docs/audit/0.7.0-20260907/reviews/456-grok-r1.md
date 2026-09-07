I'll treat this as a frozen-packet review: first the context index, then all six numbered parts, with no other files or commands.Parts 1–3 are in; continuing through the remaining three so the packet is complete before judging.# Independent #456 review (frozen R1 packet)

Read-only inspection of the six-part frozen packet only. No commands, edits, other reports, or subagents. Core / Pack / release / real-pilot remain separate gates and are **not** approved here.

**Evidence:** `[inspected]` throughout.

---

## VERDICT

**APPROVE WITH NITS.**

No **BLOCK** or **MAJOR** on the T3 boundary as implemented in this packet. Nits do not raise this verdict. Any future BLOCK/MAJOR on this packet would still block regardless of wording.

This verdict is **not** approval of Core, Pack, a version bump, real config mutation, app replacement, or a real-model / enterprise-page pilot.

---

## What holds (exact claims checked)

**Grant / session ownership**
- Context export is a distinct profile (`outbound_context_v1`) with `allow_context_export === true` plus exact origins and selected IDs. `requireContextGrant` does not treat page-export or a sibling key as sufficient.
- `lookupContextGrant` is id-exact and omits token hash. `requireLiveGrant` binds `id`, `caller_id`, `revoked_at`, and expiry (invalid expiry denies).
- Session handles are server-issued UUIDs, distinct from `session_id`. Resolve requires the same live grant and caller. Sibling handle reuse is `SCOPE_DENIED`. HTTP `/session` ignores client `session_id`.
- Legacy `ws_secret` cannot issue a context session (`mode === "grant"` and profile must match). `site_context` without session/`grant_id`/engine returns `GRANT_DENIED`.
- Default/interact issue cannot persist context fields (`CONTEXT_PROFILE_REQUIRED`). Malformed/legacy records fail closed via `contextPermissionFromRecord`.
- Empty knowledge IDs mean none, not all (unselect TOCTOU → empty `knowledge`, `GRANT_DENIED` omission).

**Async revocation / disclosure**
- `projectOutboundContext` re-reads the grant after every await; the returned projection is filtered on a post-await synchronous grant/version/origin check (Node event-loop atomicity as documented).
- Revoke / origin drop / navigation during target resolution deny (`GRANT_DENIED` / `SCOPE_DENIED` / `TARGET_CHANGED`).
- Non-`site_context` reads re-check live grant and per-key `denyOutboundExfilIfNeeded` after the runner, then capture. Mid-read revoke discards export and does not append an Observation (HTTP e2e in packet).
- Page exfil remains per-key flag + caller HITL; HTTP ack is still not consent. Context knowledge does **not** use page HITL (independent grant-time permission, as specified).
- Caller liveness uses `res.close` + `req.aborted` + response writable state, not `IncomingMessage.destroyed` after a normal body read.

**Knowledge version / deletion**
- Live `getKnowledgeVersion` after `refresh()`; missing → `NOT_FOUND`, hash mismatch → `REDACTED` and omitted from `knowledgeView`.
- `knowledgeView` intersects snapshot blocks with currently authorized IDs. Extra engine blocks cannot ride along unless their `source.id` is in that set.
- `requestSchema` is `.strict()` (`tabId` required). HTTP extra `thread_id` fails closed.

**Capture / experience isolation**
- Capture runs only for context-profile + grant + session, and only for successful `get_page_text` / `get_page_html`, after revoke/exfil/disconnect checks. Incoming `observation_id` / `evidence_capture` are stripped.
- Experience writes require `scope.kind === "mcp"` and `url.origin === origin`. Chat scopes cannot write. Other grant/session/origin hashes read empty.
- New session does not inherit old failure counts. No evidence-read tool is added. Draft/interact/html extras are not on this profile.

**HTTP / stdio / UI / CLI**
- HTTP `/session` and invoke bind caller from the token, not the body.
- stdio advertises a closed `site_context` schema and auto-attaches a server handle; dispatcher does not retry the same invocation (`SCOPE_DENIED` drops the cached handle).
- CLI requires `--context-config` only on this profile, 64 KiB cap, `parseContextPermission`.
- UI sends context fields only for this profile; origins required when export is checked; copy states knowledge vs page permission are independent.

**Default-profile regression**
- `outboundToolsForProfiles([])` and `[outbound_l1_default]` stay the default eight. Context is allowlist + `cmspark__site_context` only. Empty-set union-all is gone (`if (!profileSet.has(p)) continue`). stdio length 11 = eight + `site_context` + two metadata tools; no `get_page_html` / `draft_*`.

---

## FINDINGS

### BLOCK

None.

### MAJOR

None.

### NIT

**NIT-1 — Context-profile page export is still not origin-scoped**
`companion/src/outbound-mcp/companion-http.ts` (`companionInvokeOutbound` non-`site_context` path).
`context_origins` is enforced only inside `projectOutboundContext`. `get_page_text` / screenshot on the same key still follow legacy per-key `allow_page_export` + HITL for any leased `tabId`.
Repro: issue `outbound_context_v1` with `allow_context_export` for `https://devops.example.test` **and** `--allow-page-export`; `list_tabs` + `get_page_text` on another origin succeeds.
This is not a sibling-grant bypass and is no stronger than today’s default key with page export, but the origin list looks like a key-wide allowlist. Worth a UI/CLI one-liner that page export remains all-tabs.

**NIT-2 — Session liveness is not re-checked after HITL, before actuators**
Same function: `contextSessions.resolve` runs once up front and returns a **copy**. After a long first-exfil HITL, `if (contextSession && …)` is still true even if the registry entry expired. Click/read still run; post-runner `scope()` then throws `SCOPE_DENIED` and strips `data`.
Grant *is* re-checked before the runner. Page bytes are not returned. Residual is the documented actuator-already-happened / client-retry class, now also on session TTL.

**NIT-3 — Any `SCOPE_DENIED` drops the stdio handle**
`companion/src/outbound-mcp/http-client.ts`. Origin mismatch on `site_context` is `SCOPE_DENIED` (not a dead handle). The client still `session = undefined`. Next explicit call mints a new session and zeros experience. Fail-closed, but it conflates “wrong origin” with “dead session”. Prefer clearing only on handle/session errors.

**NIT-4 — `/session` maps a revoke race to `BAD_BODY`**
`handleOutboundMcpHttp` session branch: `issue()` → `requireLiveGrant` can throw `GRANT_DENIED` after auth; the catch turns every non-`CAPACITY` throw into 400 `BAD_BODY`. Still denied. Map `GRANT_DENIED` to 403.

**NIT-5 — MCP metadata reads mutate Chat tab-url cache**
`companion/src/site-context/browser-resolver.ts` `applyTabNavigated(tabId, target.url)` on every `resolveBrowserSiteTarget`, including outbound `site_context`. Sanitized URL only; not model-visible. Cross-feature interference with a helper labeled “Local Chat entry only”.

**NIT-6 — Captured page reads now surface `observation_id` / `evidence_capture` on the MCP wire**
`captureLocalPageResult` + context-profile invoke. Default profile did not take this path. No read API in this packet, and untrusted ids are stripped on the way in. Treat those fields as non-capability. Do not add any tool that accepts them from the model.

**NIT-7 — Knowledge export has grant-time consent only (no first-exfil HITL)**
By spec, independent of page HITL. Residual: a 30d key with the checkbox on can `site_context` forever until revoke, including live document replacement under the same id (version pin is per-request, not per-issue). Already disclosed in UI/docs; keep it explicit in the issue confirmation.

**NIT-8 — Target path is exported whenever context export is on**
`siteTargetFromBrowser` strips query/fragment/userinfo (packet test: `token=private`, `#secret`). Path remains (`/reset-password/<token>`). Empty `context_knowledge_ids` still returns `target` if origin matches. Matches docs; path tokens are the leftover.

**NIT-9 — Small audit / capacity / residue nicks**
- `site_context` logs `ok: true` before the final `scope()`; a throw double-audits success then failure.
- Expired sessions are pruned only in `issue()`, not `resolve()`.
- Experience rows are not dropped on revoke; they are unreadable without a live handle and TTL out.
- WS pre-check is weaker than `parseContextPermission` (server still fail-closes).
- UI does not cap 64 knowledge checkboxes (WS/zod reject).

---

## Out of this review

Not signed off: #453 store/Core, #454/#455 Missions, Pack, version/release, real BrowserBridge against a live enterprise page, or a real external-model pilot. `evidenceScopeHash` / evidence-store directory isolation are used here but not defined in this packet; this review only checks that MCP writes `kind: "mcp"` and does not add a read tool.

`[inspected]` only — tests were not re-run.
