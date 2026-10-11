Reviewed frozen diff: /tmp/cmspark-592-protocol-frozen.diff

SHA-256: c79ab0e2df56461b30a399c3089c6addf35471a58fbdfde39ff0eef0b8802a17

Base: 50c04f252d5055e02f54ebd3cffc37f91fecec7b. Kimi process exit 0; full local transcript: /tmp/cmspark-592-protocol-kimi.log. The report below is the final reviewer response; earlier working notes are omitted.

# Final review — CMspark #592 R5–R10 (MCP protocol / cooperation / outbound reliability)

**Verdict: APPROVE** — no blocking findings. One focused compiled run re-verified on this tree: 6 suites (mcp-protocol-reliability, cooperation-mcp, outbound-mcp-cancellation, outbound-mcp-schema, integration/mcp-selection-gate, integration/security-gates) → **111 pass, 0 fail, 0 cancel, 0 skip**, exit 0 (`companion/.test-dist`, Node 22.23.2, `node scripts/run-tests.mjs`).

## What I traced in the submitted diff (not assumed)

**R5/R6 — catalog refresh (`companion/src/mcp/client.ts:262-397`)**
- `refreshCache` coalesces per (kind, client): an in-flight burst sets `dirty` and triggers exactly one follow-up; a stale client's finally sees `this.refreshes.get(kind) !== entry` and never publishes or re-dirties (verified at client.ts:290-296).
- Publication is gated on `isCurrentClient` (client.ts:262-264, 344) — a pending refresh from a closed/replaced connection returns the current cache without emitting `tools_changed`. Matches the "cannot overwrite a reconnected client" test.
- `collectPages` (client.ts:299-322): single `withCallTimeout` deadline across all pages, abort check after each page, item bound 10 000, repeated-cursor detection, page bound 100. Failure path throws before any cache mutation, so the last complete snapshot is retained.

**R7 — structured results and schema fidelity (`client.ts:441-445`, `dispatch.ts:416-432,455-459,473-475`, `aggregator.ts:40-52,162`)**
- `structuredContent` survives the client projection and dispatch: success yields `{content, structuredContent}`; `isError` keeps `success:false` and the enhanced error while carrying `data`; both the outer recovery-rejection branch and the final return preserve `outcome.data`. I traced all three previously-reproduced drops — they are closed in this diff.
- Aggregator scan is iterative with a `seen` set (no stack overflow on cyclic schemas) and covers keys, values, `$defs`/`definitions`, array items; `normalizeInputSchema` now passes `$defs`/`definitions` through. Injection patterns are imperative phrases (`content-sanitizer.ts:9-34`), so key-scanning is stricter without meaningful false-positive surface; fail direction is catalog exclusion, not corruption.

**R8 — cooperation identity boundaries (`cooperation-plan.ts:43-103,158-177,179-212`, `dispatch.ts:223-230,405-414`, `spawn.ts:25-75`)**
- Bindings persist only `{server_name, tool_name, identity}` where identity is a sha256 over key-sorted JSON of config + inputSchema — no credentials in the plan (test asserts the plan JSON lacks the env credential, including after ThreadManager reload).
- `plannedWorkerMcpError` matches bindings by declared alias **and** by any required tool whose bound server/tool equals the live route of the requested name (cooperation-plan.ts:88-94) — the sanitized-collision bypass is closed. It re-checks stale attempt/run-id, worker whitelist (`tm.isToolAllowed`), parent manual selection, and revalidates each bound name against the live binding resolved through the *current* alias.
- Dispatch re-checks planned identity after confirmation and compares the live route to the captured route synchronously before `manager.callTool` (dispatch.ts:409-414), covering both retarget-during-confirmation probes. Retries re-enter `runOnce`, so the same gates apply.
- Legacy checkpoints without `mcp_bindings` fail closed (`assertBoundMcpCapability` throws on missing binding). Wildcard ∩ exact parent grants materialize to concrete live tools; MCP deny patterns are expanded and matched with dispatch semantics (`isMcpToolAllowedByWhitelist`), so a narrower deny cannot survive as a broader wildcard; workers inherit manual selection without widening (ancestor walk in the selection gate).

**R9 — cancellation (`security-confirmation.ts:258-385`, `companion-http.ts:585,730-731,981-985`, `bridge.ts`, `http-client.ts:153-163`, `server.ts` hunks, `image-fetch-admission.ts`, `l2-admission.ts:1561`, `url-cookie-admission.ts:311,401`)**
- Abort handling removes only its own pending entry/timer, settles the promise even when the peer send throws, fires the terminal listener once, and late `respond`/`respondFrom` return `unknown` (pending already deleted). The early-return for an already-aborted signal cannot strand a pending entry.
- The HTTP `res.on("close")` → `controller.abort()` is guarded by `!res.writableEnded`, so normal response completion never aborts; disconnect during HITL now denies the prompt (audit `CALLER_CANCELLED`), consistent with the updated e2e test's `respondFrom → "unknown"` assertion.
- `server.ts` re-checks `signal?.aborted` between every admission await and immediately before extension forward — a late approval after cancel cannot dispatch.

**R10 — outbound schemas (`tool-schema.ts`, `stdio-server.ts:264-370`, `companion-http.ts:635-640`)**
- Schemas are generated from the native Zod contracts / tool catalog (single source), AJV-validated at the boundary and re-validated by native `tryParseToolArgs` (unknown meta-tool names fall back to a generic schema — no crash path, `tool-schemas.ts:486-499`). Flat and `{args, domain}` forms are both accepted; ambiguous wrappers (args + flat mix, non-object args, non-string domain) rejected; `domain` never enters tool args.
- The `missingTabId` carve-out only defers to the L9 lease gate, which itself fails with `TAB_ID_REQUIRED` before any runner contact — malformed args cannot ride the carve-out to execution. Lease-requiring tools (including screenshot/vision) get a mandatory positive-integer `tabId`. No profile membership changed.

## Nonblocking notes

1. **Dispatch success shape change** — for tools returning `structuredContent`, `executeMcpTool` success `data` is now `{content, structuredContent}` instead of the bare content array (dispatch.ts:432). This is the spec'd contract, but any consumer that assumed an array for such tools should be aware. Content-only tools are byte-identical.
2. **Wildcard materialization is point-in-time** — `expandMcpPatterns` (spawn.ts:30-36) resolves wildcards against the live catalog at whitelist-compute time; tools added later are not retroactively granted. This is the safe direction and matches the spec, but it means a worker's wildcard grant does not track future catalog growth.
3. **Not every inner L2 confirm receives the signal** — only the confirm call at `l2-admission.ts:1561` is abort-wired; other prompts inside that module linger until timeout after cancel. No dispatch can result (post-admission aborted checks), so this is a prompt-lifetime/UX nit, not an authority hole.

## Evidence boundaries

- Verified by direct source trace + this run: the six focused suites above (111/111).
- Relied on as recorded (not re-run here): full host suite 5593/5560 pass, arm64 container 807/806, production build, 975-file SHA manifest, adversary 143-test integrated run.
- Not claimed: live browser behavior, Windows native paths, remote CI.

To resume this session: kimi -r session_b0bd6f03-5262-4ea5-8934-45b7fb4f764e
