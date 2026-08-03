All required reading and repo spot-checks complete. Patch is current (base `bf5cd71` == `git log` HEAD; only untracked docs — no code diff, as expected for a strategy review).

---

## 1. Findings

**Blocking: none.** Every R-gate is satisfied; no false repo claims found.

**Nits (fold into brief before Phase 0 code):**

- **N1 — Data-exfil is under-locked (Q6).** §8.2 and the non-goal list *identify* cloud context exfil, but no operative lock (L1–L8) default-denies full page-text/screenshot export to third-party LLMs, and the Phase 0 T1–T3 protocol inherently ships real logged-in page content to the client's cloud model. Fold into L3 or add a lock: outbound page-content tools default-deny until per-session disclosure; bake-off tasks restricted to non-sensitive pages unless disclosure is explicit.
- **N2 — Dual-entry lease should be an explicit lock (Q7).** Tab lease is mentioned as a reusable asset (§5) and blind-spot #3 flags tab fights, but it's not in L1–L8. Without it, a concurrent Side Panel / second MCP client thrashes the same tab and **invalidates the bake-off metrics** (T1 time, confirm burden) while breaking the user's real browser. Add **L9: dual-entry tab lease / session-bind is mandatory for any interactive outbound profile, in place before Phase 0 interactive tasks**.
- **N3 — originWs hand-off missing.** `security-confirmation.ts:139/146/265` already binds `originWs` for internal callers; the brief must require the outbound façade to bind `{ originWs: mcpSocket }` on every `securityConfirmations.request` (P1-2 watchlist) — otherwise the MCP path regresses the historical weak spot. Add to the brief's security section.
- **N4 — Market map: add C-class names.** Star counts are approximate (fine); add `browser-use` (agent-style logged-in automation) and BrowsermCP (~10k⭐) as named C-class competitors, and note browser-use as the real "logged-in session" threat since Playwright/DevTools don't own it.
- **N5 — Phase 0 pass metrics lack numeric thresholds** (§7): give T1 completion-rate/time and confirm-burden numbers, and define "confirm-timeout errors actionable" measurably (e.g., ≥90% of IDE-driven confirms resolved <45s without side-panel focus → proves tray path needed).

## 2. Answers to Must-answer 1–8

1. **Market map:** Good enough to set strategy. The decisive insight — *C-class is non-empty, so a commodity clone has no #2 slot* — is correct and the A/B/C/D split maps cleanly onto threat vectors (stateless CI, debug loop, real-session, stealth). N4 above.
2. **Locks L1–L8:** Coherent with ADR-020. L3 (L1-subset only) is strictly *narrower* than internal L1 (no cookies/evaluate), which is the correct monotonic direction. Missing **blocking** lock? No — but add N1/N2 as L9/L3-amendments; both are currently "blind spot + asset" rather than lock.
3. **Preferred option:** **A** — it is a cheap falsification experiment for the one claim that justifies the whole product ("logged-in irreplaceability"), and §7's fail→pivot already encodes B/C. B as observability-only would leave the core question unanswered; D forfeits the market without data. Keep B as the Phase-0-fail fallback, C as the vertical pivot (already in §7).
4. **Q4 — "MCP caller untrusted + grant TBD":** **Acceptable Phase 0 risk, not block** — *only* because Phase 0 ships nothing and L4 already forces per-risk gating with no "came from MCP" bypass. Condition: the decision brief must name the grant model as a **Phase 1 ship gate**, and Phase 0 may not include any confirm-skip experiment. Today's confirm stack (auto-deny on 45s timeout, `security-confirmation.ts`, L2 gates) makes the unsafe default fail-closed.
5. **Q5 — Confirm UX for IDE-driven calls:** L8 is **not sufficient alone** — today's confirms surface only in extension UI (Side Panel red bar / Cockpit, `confirm-center-user-guide.md` §3; 45s timeout + auto-deny when unfocused, §7). An IDE-focused user will not see them. Tray/global confirm must be **scoped into the Phase 0 spike as the measured confirm channel** (or Phase 0 measures only the fail path, voiding the confirm-burden metric); and it's an absolute **Phase 1 ship gate**. This makes L8 a Phase 0 *experiment item*, not a code gate — Phase 0 still ships nothing, so not REJECT.
6. **Q6 — Data exfil:** Identified but under-treated operatively (N1). No lock stops a bake-off client from dumping page text to a cloud LLM; the non-goal only forbids *claiming* privacy. Amend L3 with default-deny + disclosure.
7. **Q7 — Self-cannibalization / lease:** Yes, make it **L9 before Phase 0 interactive code** (N2) — not merely to protect the product, but because tab thrash corrupts the bake-off's own pass/fail data.
8. **Q8 — Would REJECT-level triggers exist?** Only the six R-gates — e.g., L3 weakened to default-export cookies/evaluate/shell (R1), the façade redescribed as an Agent runtime (R2), `ws_secret` asserted to auth MCP clients (R3 — false; `ws-auth.ts` is Extension↔Companion HMAC only), generic clone ship without Phase 0 (R4), localhost-trusted threat model (R5), Skill-only "serve external agents" (R6), or trust-monotonicity violation (R7). None present.

## 3. ADR-020 checklist

- **Declaration present:** Yes (synthesis §1 + prompt body; diff is pure docs → declaration clause satisfied).
- **Axes fit:** Correct — outbound MCP as **Composition export of Surface L1**, not a runtime, no "中层 Agent" (verified: `companion/src/mcp/` is client-only — `McpClient`/`McpManager`/aggregator/transport, no server implementation anywhere in `companion/src/`; `architecture.md:621-642` states Companion is MCP client/aggregator).
- **Pack-first:** Satisfied — Pack is optional scenario layer, no new primary Side Panel entry.
- **Confirm dialects:** No new confirm family proposed; reuses domain/L2 gates; new grant model is justified (new caller identity) — N3 ensures originWs is carried.
- **Trust monotonicity:** Safe — outbound default is *narrower* than internal L1 (L3 strips cookies/evaluate), new trust gates added, no looser inheritance. No ADR-020 amend needed.
- **No new runtime:** Confirmed.
- **Repo-truth check:** `ws_secret` ≠ MCP caller auth ✓ (ws-auth.ts: challenge–response, Extension↔Companion only); tab lease, domain whitelist, evaluate gating, audit all exist ✓; patch not stale ✓.

## 4. Recommendation

**Option A**, with N1–N3 folded into the decision brief and N4–N5 folded into the Phase 0 protocol, B as the fail-fallback (already in §7). **Phase 0 may start after the nits fold** — it ships no product, runs fail-closed, and every R-gate passes.

---

VERDICT: APPROVE_WITH_NITS
