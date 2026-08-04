# Correctness Lane
**Range:** 79d7420..d4c4ebf  
**Tip:** d4c4ebf  
**Status:** WATCH  
**Recommendation:** APPROVE_WITH_NITS  

**Method:** live source inspection (file:line) + targeted tests `[executed]` (companion outbound-mcp / skill-install / shell argv / B1 integration; extension spa-scroll-expr). No source edits.

---

## Verdict (one line)

S41 P0 residuals (dest_path, empty `base_url`, `FOO=1`/`~`, shell glyph) and outbound B1 / extension-prefer / sendResponse fixes are **closed with tests**; residual correctness risk is **SPA scroll fallback direction/stacking**, **tray-only outbound still timing out**, and **disclosure accept JSON honesty**.

---

## Findings

### F1 [MEDIUM] — SPA scroll always fires PageDown (ignores scroll-up / overshoots)

- **File:** `chrome-extension/src/background/browser-bridge.ts:896-922`  
- **Evidence:** `[inspected]`  
  After CDP Runtime.evaluate, if `data?.moved !== true`, path **3 always** dispatches `PageDown` keyDown/keyUp — independent of `deltaY` sign:

```896:922:chrome-extension/src/background/browser-bridge.ts
    // 3) CDP PageDown as third signal (X timeline often listens to keyboard)
    if (data?.moved !== true) {
      try {
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "PageDown",
          ...
```

- **Risk:**
  1. Agent `scroll` with negative `deltaY` / scroll-up can still move the feed **down**.
  2. When Runtime.evaluate returns `moved: false` (or mouseWheel sets `moved: null`), **mouseWheel + PageDown (+ scripting)** all run without re-sampling scrollTop → double/triple downward nudge on X-like SPAs.
- **Tests:** `spa-scroll-expr.test.ts` only checks string embedding of numbers/selectors — **no** fallback-order / direction coverage.  
- **Fix:**  
  - Gate keyboard fallback on `deltaY > 0` → PageDown, `deltaY < 0` → PageUp; skip when `deltaY === 0`.  
  - Prefer sequential “try → re-measure → only then next path”; do not stack mouseWheel+PageDown when prior path already likely moved.  
  - Unit/integration assert scroll-up never emits PageDown.

---

### F2 [MEDIUM] — Outbound still binds tray when no extension peer (15s timeout residual)

- **File:** `companion/src/server.ts:194-207`, `215-238`  
- **Evidence:** `[inspected]`  
  `pickAuthenticatedClientWs` correctly prefers `chrome-extension://`, but **falls back to any authenticated peer** (including `cmspark-tray://local`). Commit d31be84 documents that tray **does not handle `tool.execute`**.

```194:207:companion/src/server.ts
export function pickAuthenticatedClientWs(): WebSocket | null {
  let fallback: WebSocket | null = null
  for (const c of clients) {
    ...
    if (/^chrome-extension:\/\//i.test(origin)) {
      return c
    }
    // tray / unknown — only use if no extension peer
    if (!fallback) fallback = c
  }
  return fallback
}
```

- **Risk:** Tray-only session (or missing Origin demoting extension to fallback class) still wires runner → outbound invoke waits full tool timeout instead of fast `EXTENSION_UNAVAILABLE`. Prefer-extension fixes the common dual-peer case; tray-only remains broken-by-design.  
- **Tests:** no unit coverage for pick/prefer/fallback matrix.  
- **Fix:** Only accept `chrome-extension://` for outbound runner; if none → `setOutboundToolRunner(null)` + `EXTENSION_UNAVAILABLE`. Optionally reject missing Origin for runner binding.

---

### F3 [MEDIUM] — `cmspark__accept_data_disclosure` JSON says `ok: true` when companion dual-write fails

- **File:** `companion/src/outbound-mcp/stdio-server.ts:123-145`  
- **Evidence:** `[inspected]`  

```123:145:companion/src/outbound-mcp/stdio-server.ts
      const sess = acceptOutboundDisclosure(cid)
      ...
      const remote = await companionPostDisclosure(...)
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ok: true,   // always true in body
            ...
            companion_disclosure: remote.ok ? "ok" : remote.error || "failed",
          }),
        }],
        isError: !remote.ok,
      }
```

- **Risk:** MCP `isError` is set, but agents that parse tool **text JSON** see `ok: true` and proceed to exfil tools → companion gate then fails with `DISCLOSURE_REQUIRED` (confusing loop). Local stdio session accepted while companion (execute SoT) is not.  
- **Fix:** Set body `ok: remote.ok`; on remote failure do not claim success (and optionally revoke local accept or never accept local-first).

---

### F4 [LOW–MEDIUM] — Dual-entry: Side Panel “wins” releases outbound but single-agent path takes no HARD lease

- **File:** `companion/src/outbound-mcp/dual-entry.ts:134-158`, `companion/src/server.ts:651-664`, `734-738`  
- **Evidence:** `[inspected]` + prior L8/L9 residual N2  
  `sidePanelWinsReleaseOutboundLease` force-frees `outbound_mcp:*`. Multi-agent HARD acquire is skipped for normal chats (`multi && !isOutboundMcpCall`). Outbound can re-acquire the same tab on the next invoke while Side Panel CDP is in flight.  
- **Risk:** Dual-entry thrash / interleaved CDP on one tab under concurrent Grok + Side Panel. Not a wrong return value in the happy serial case.  
- **Fix (product):** optional short exclusive Side Panel lease after force-release, or hold FORCE_RELEASING until pending CDP drains (documented residual is acceptable for P0c if called out).

---

### F5 [LOW] — Folder/zip skill names that sanitize to pure dashes collide (silent overwrite)

- **File:** `companion/src/skills/skill-engine.ts:851-857`, `1009-1014`  
- **Evidence:** `[inspected]`  
  `importSkill` rejects empty/`-` safe names; `importSkillFolder` / `importSkillFiles` do not. Pure CJK / symbol names collapse to `----` / `---` etc. → same `destDir` → `rmSync` overwrite. dest_path is “honest” but not unique identity.  
- **Risk:** Second CJK-named zip install wipes the first.  
- **Fix:** Reuse importSkill validation; disambiguate with basename or hash suffix; unit-test CJK name.

---

## Closed S41 / focus residuals (do not re-open without regression)

| Topic | Status | Evidence |
|--------|--------|----------|
| skill_install `dest_path` honesty | **FIXED** | Returns `imported.destPath` + `name` (`skill-install.ts:160-166`, `203-208`, `248-253`, `269-274`); tests assert zip dest ≠ skills root `[executed]` |
| config.test empty `base_url` | **FIXED** | `nonBlank` trim\|\|stored (`message-router.ts:342-353`) `[inspected]` |
| shell argv `FOO=1` / `~` | **FIXED** | `tryParseSimpleArgv` rejects (`shell.ts:163-168`); unit tests `[executed]` |
| shell card ✓ vs exit≠0 | **FIXED** | ChatView prefers `shellFailed` (`ChatView.tsx:460-467`) `[inspected]` |
| B1 whitelist skip | **FIXED** | `!isOutboundMcpCall` around ThreadManager gate (`server.ts:666-671`); integration suite 8/8 `[executed]` |
| Outbound invoke bridge | **SOLID** | gate → lease → tagged runner; HTTP e2e + facade + dual-entry 61 tests `[executed]` |
| extension-prefer dispatch | **MOSTLY FIXED** | Prefer extension works; residual F2 tray-only |
| sendResponse always | **FIXED** | Outer try/catch + default unknown type answers (`index.ts:427-439`, `1016-1027`); useWebSocket never claims channel for UI→SW `[inspected]` |
| CDP-first SPA scroll order | **IMPROVED** | Runtime.evaluate → mouseWheel → PageDown → scripting (`browser-bridge.ts:845-1037`); residual F1 |

---

## Solid

1. **Outbound MCP stack:** dual gate (stdio + companion), server-side disclosure only, profile allowlist, L9 tabId required for interactive tools, L8 confirm fan-out unbound for outbound, confirm timeout remapped to `OUTBOUND_CONFIRM_REQUIRED` (not generic CDP timeout).  
2. **B1:** production `__outbound_mcp` skips synthetic-thread whitelist deny; counterfactual without flag still denied.  
3. **HTTP client:** 120s timeout destroys request; bearer required on invoke/disclosure; health unauthenticated on loopback only.  
4. **skill_install Trust packaging:** L2 binding, content cap, zip extract budget + cleanup, capability audit on success paths.  
5. **SPA scroll expression:** number-only interpolation (`spa-scroll-expr.ts`) — no user-string injection into evaluate.  
6. **MV3 message port:** unknown/throw paths always `sendResponse` — removes false “port closed” UX.

---

## Residual

| ID | Residual | Sev |
|----|----------|-----|
| F1 | PageDown direction + stacked fallbacks | MEDIUM |
| F2 | Tray-only outbound timeout vs fail-fast | MEDIUM |
| F3 | Disclosure accept body `ok: true` vs remote fail | MEDIUM |
| F4 | Side Panel wins without exclusive hold (single-agent) | LOW–MEDIUM |
| F5 | CJK/dash skill name collision overwrite | LOW |
| — | Outbound lease not released on tool complete (idle TTL / Side Panel wins) — by design | LOW |
| — | No test for `pickAuthenticatedClientWs` origin matrix | LOW |
| — | `extractNameFromMarkdown` in skill-install unused dead code | LOW |

---

## Tests vs claims

| Claim | Coverage | Result |
|--------|----------|--------|
| dest_path honesty | skill-install.test | **pass** `[executed]` |
| ENV=/~ argv | shell-progress-windowsHide | **pass** `[executed]` |
| outbound gate/HTTP/L9 | outbound-mcp-* | **61 pass** `[executed]` |
| B1 createToolExecutor | integration/outbound-mcp-executor | **8 pass** `[executed]` |
| spa-scroll expr | spa-scroll-expr.test | **2 pass** `[executed]` |
| scroll fallback direction | — | **miss (F1)** |
| pick extension vs tray | — | **miss (F2)** |
| disclosure dual-write honesty | — | **miss (F3)** |

---

## Recommendation detail

**APPROVE_WITH_NITS** — merge of this range is correctness-acceptable for Outbound MCP P0c + S41 P0 closure. Do **not** claim “SPA scroll fully correct on all directions” or “outbound always fails closed when only tray is up” until F1–F2 land.

Should-fix next slice: F1 (PageUp/PageDown by sign + sequential re-measure), F2 (extension-only runner), F3 (honest disclosure response).

**Lane status:** **WATCH** (no production-breaking B1-class bug found open; nits are real).

---

*Correctness lane — S42 range 79d7420..d4c4ebf*  
*Evidence: primarily `[inspected]`; tests tagged `[executed]` where run.*
