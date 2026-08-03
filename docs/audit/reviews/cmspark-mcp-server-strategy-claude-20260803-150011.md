Repo spot-checks complete. Verifying the synthesis's claims about current code: ws-auth.ts is bound to the Extension via `.paired` marker only (no MCP caller auth), `companion/src/mcp/` contains client/manager/aggregator/transport but no server module, and architecture.md §8.1 confirms "MCP 客户端/聚合器" only. Locks map cleanly to ADR-020 axes.

---

# Dual Review — `cmspark-mcp-server-strategy`

**Stage reviewed:** Product strategy + adversary synthesis (docs-only, no implementation diff). Confirmed via `git status` — only new untracked files under `docs/decisions/` + this prompt's review corpus. Patch file `cmspark-mcp-server-strategy-diff-20260803-150011.patch` lists untracked docs only; not stale.

## 1. Findings

### Blocking — none

All seven rejection gates (R1–R7) fail to fire. Spot-checked each against repo:

- **R1** (default ship L2/cookies/shell): Synthesis §1 capability declaration + L3 + non-goals explicitly forbid. ✓
- **R2** (new runtime / 中层 Agent): §1 explicitly "Composition export of Surface L1, not a new runtime, not 中层 Agent." ✓
- **R3** (false `ws_secret` claim): `companion/src/ws-auth.ts:1-25` confirms `ws_secret` is HMAC challenge-response bound to the extension via the `.paired` marker (line 122) — nothing authenticates an arbitrary local MCP client process. Synthesis §4 Path B and §5 table state exactly this. ✓
- **R4** (all-in Browser MCP without Phase 0): L1 + L7 gate this; §3 positioning is explicitly complementary. ✓
- **R5** (localhost trusted): L4 + §8 blind spot #1 explicitly call out malicious/multi-client threat. ✓
- **R6** (Skill-only sufficient): L5 says "Skill = adoption only; capability body = MCP." ✓
- **R7** (trust monotonicity contradiction): §1 forbids L2 in default outbound; no ADR-020 amend needed. ✓

### Non-blocking nits (fold before / during Phase 0)

- **N1 — Loopback ≠ trust should be its own lock, not bundled inside L4.** L4 currently says "MCP caller is untrusted until grant; ops gated by risk." That bundles two things: (a) caller identity/auth, (b) per-op risk gating. The transport requirement — *localhost Origin is not authentication; stdio pipe parent PID is not authentication* — is implicit. Given §4 Path B's own framing of `ws_secret` scope, spell out the auth mechanism (per-caller token? signed grant? user-pasted per-client secret?) as a distinct lock. Today the only out-of-band secret is `ws_secret`, and the synthesis correctly notes it does not cover MCP callers.
- **N2 — L8 is a principle, not a deliverable.** "Confirm UX is product, not afterthought" risks becoming exactly the afterthought it warns against when the user is staring at the IDE, not the Side Panel. Tighten to a Phase 0 deliverable: *each outbound MCP tool call MUST surface an allow/deny affordance that does not require the Side Panel to be focused* (tray notification, global hotkey, or auto-focus the Side Panel window). `docs/confirm-center-user-guide.md` §3 currently only describes Side Panel + Cockpit paths — there is no IDE-driven confirm dialect designed today. Phase 0 *strategy brief* can proceed without this; Phase 0 *code* cannot.
- **N3 — Data-exfil default-deny is under-treated for read-type L1 tools.** L3 forbids `cookies / evaluate / L2 / shell / netsec` in the default outbound profile, but the JTBD itself ("read internal docs", "verify UI") is satisfied by returning page text / screenshots to a third-party LLM — i.e. the disclosure IS the value prop. `list_tabs`, `get_page_text`, snapshots, etc. can leak without crossing L3's gates. §8 blind spot #2 acknowledges this but it never becomes a lock. Recommend: lock that any tool returning page content over outbound MCP carries an explicit disclosure tag and is default-off until per-task user authorization. This is the kind of disclosure-vs-privacy-marketing tension §4 Path B flags but the locks don't resolve.
- **N4 — Dual-entry tab lease should be a lock (propose L9).** §5 says "Side Panel LLM path remains concurrent → requires lease / grant rules" but the rule never makes it into L1–L8. ADR-015 already ships `tab-lease.ts` (architecture.md §10.1, line 689); reuse it. Without L9, the Side Panel Agent and an external MCP client can thrash the same tab, and the user won't know which input owned the change. Suggested: *dual-entry (Side Panel + outbound MCP) tab operations MUST go through the existing tab-lease; conflict default = Side Panel wins, MCP queues with disclosure.*
- **N5 — Phase 0 pass/fail metrics are qualitative (§7).** T1 "should win or sole viable" / "Playwright may win — acceptable" is not measurable. Add numeric thresholds: completion-rate delta, median confirm-burden count, timeout-error rate, audit lines per call. Already listed as a non-blocking nit in the prompt.
- **N6 — Market scale numbers are approximate.** Star counts for Playwright MCP (~35k) and Chrome DevTools MCP (~48k) drift month-to-month; CWS user count for Browser MCP is rough. Treat as directional, refresh at brief time. Prompt already lists this nit.
- **N7 — ADR/doc filename convention unspecified.** The synthesis lives at `docs/decisions/cmspark-as-mcp-server-adversary-synthesis-2026-08-03.md` but no ADR number is reserved. When it converts to a brief, allocate an ADR slot (next free, e.g. 022).
- **N8 — Install/distribution (CWS) is named strategic (§4 Path B) but not locked.** The friction gap (`sideload + daemon + pair + MCP JSON` vs `npx` + Web Store) is real; recommend elevating to a non-goal of v0 explicitly so Phase 0 doesn't quietly assume it solved.
- **N9 — Tool-name collisions with Playwright MCP (§8 blind spot #7) are mentioned but not locked.** Cheap mitigation: namespace outbound tools `cmspark__<tool>` instead of bare names. Worth folding into L5 or a new lock.

## 2. Explicit answers — Must answer 1–8

1. **Market map good enough?** Yes. The four archetypes (A Playwright / B DevTools MCP / C real-Chrome extension / D cloud stealth) cover the actual competitive field and correctly frame C-class as contested. Not fatally wrong; star counts are approximate (N6).
2. **L1–L8 coherent with ADR-020? Missing blocking lock?** Coherent — see checklist §3. Two *near-blocking* omissions for Phase 0 *code*: dual-entry tab lease (N4) and L8 deliverable form (N2). Neither blocks the *strategy brief*. I'd add L9 (dual-entry lease) before any Phase 0 code lands.
3. **Preferred option?** **A**, with B/C as explicit pivots. The synthesis already names B as the §7 "Fail → pivot" path; that's correct. D (no outbound MCP now) is the right answer only if Phase 0 T1 fails to show logged-in irreplaceability. A is the right next step.
4. **"MCP caller untrusted + grant TBD" — Phase 0 risk or block?** Acceptable **for Phase 0** as long as: (a) Phase 0 runs localhost stdio-only with explicit warnings, (b) outbound MCP is not default-on for any install, (c) the grant model is designed *before* CWS listing or default-on. The synthesis treats this correctly (L4 + Phase 0 first). Not a block.
5. **L8 sufficient or tray/global confirm a Phase 0 gate?** **L8 is necessary but not sufficient.** For Phase 0 *strategy brief*: sufficient. For Phase 0 *code*: must tighten to a deliverable (N2). The user staring at the IDE cannot be the failure mode.
6. **Data-exfil under-treated?** Partially. L3's outbound profile gates `cookies/evaluate/L2/shell/netsec` but read-type L1 tools returning page content can still leak to a third-party LLM — which is the whole JTBD. §8 #2 calls it out; the lock is missing (N3).
7. **Dual-entry lease as lock before Phase 0 code?** **Yes — promote to L9** (N4). Before *strategy brief*: no. Before *Phase 0 code*: yes.
8. **What would force REJECT even for a brief?** Any of R1–R7 firing (none do), or a synthesis that hides the install/Pairing/grant complexity to make the product look easier than Playwright. The synthesis is honest about friction (§4 Path B, §5).

## 3. ADR-020 capability checklist result

| Check | Result |
|---|---|
| Surface vs Composition vs Autonomy fit | ✅ Outbound MCP = Composition export of L1; explicitly not "中层 Agent" (synthesis §1) |
| Pack-first | ✅ Pack in Compose axis (§1); differentiation via Trust/HITL/Pack (§3) |
| Confirm dialects | ⚠ Reuses existing domain/L2 families; no new dialect *proposed*, but no IDE-confirm dialect designed either (N2) |
| Trust monotonicity | ✅ L2/cookies/evaluate/shell/netsec out of default outbound (§1, L3) |
| originWs | n/a — no code change yet |
| No new runtime | ✅ Explicit (§1) |
| Experimental layers | n/a |

## 4. Recommended option + Phase 0 gating

**Recommend Option A** (proceed to decision brief + Phase 0 bake-off) with B (observability-only) and C (vertical Pack API) preserved as explicit pivots in §7. **Phase 0 may start after folding N1, N2, N3, N4, N9 into the locks** — these are the nits that distinguish "strategy direction" from "ready to write Phase 0 code." N5–N8 can fold into the brief itself.

No R1–R7 rejection gate fires; no blocking issue with the synthesis as a strategy document.

VERDICT: APPROVE_WITH_NITS
