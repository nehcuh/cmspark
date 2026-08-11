I have all the evidence needed. Let me write the review.

---

# Independent review — Side Panel design debt (CONDITIONAL GO)

## 1. Summary

CONDITIONAL GO plan is tightly bounded, capability declaration is correct (L0 Panel chrome only; no Compose / Autonomy / Trust / L2 changes), and all code-level factual claims I spot-checked hold. The plan correctly brackets redesign energy as NO-GO and scopes W1–W3 + optional W4 to surgical fixes. The single highest-value catch: the DESIGN.md ↔ `tokens.ts` drift is materially **wider** than the SoT claims (every light-surface role row disagrees, not just accent/canvas) — W3's two-option fix still covers it, but acceptance A3 is worded too narrowly. No rejection gate triggered.

## 2. Factual spot-check (Read/Grep on the actual repo)

| Claim in SoT | Verdict | Evidence |
|---|---|---|
| E1: `bottomBarStrip: false` | **PASS** | `chrome-extension/src/sidepanel/ui/flags.ts:13` |
| E1: BottomBar gated by `ui.bottomBarStrip` | **PASS** | `chrome-extension/src/sidepanel/App.tsx:195` — `{ui.bottomBarStrip ? <BottomBar …/> : null}` |
| E1: StatusRail toast teaches 底栏「更多」while strip is off | **PASS** | `chrome-extension/src/sidepanel/components/StatusRail.tsx:428-433` — `"场景 / 任务板已移至底栏「更多」— 主栏仅保留当前模式高频入口"` |
| E1: Real `/board`, `/装配`, chips paths exist | **PASS** | `chrome-extension/src/sidepanel/composer/meta-slash.ts:94-102` (`board`), `:130-136` (`装配`), `composerChipsForLevel` `:289-311` |
| E2: `tokens.accent = #4f46e5`, `tokens.bg = #f5f6fa` | **PASS** | `chrome-extension/src/sidepanel/ui/tokens.ts:11, 23` |
| E2: DESIGN.md accent `#2563eb`, canvas `#fafbfc` | **PASS** | `docs/DESIGN.md:15, 23` |
| E2: Residual `#2563eb` in sidepanel secondary panels | **PASS** | `chrome-extension/src/sidepanel/components/BoardPanel.tsx:23`, `AppsPanel.tsx:1146`. Also a dead fallback at `SettingsIntentBar.tsx:176` (`tokens.accent || "#2563eb"`) — harmless since `tokens.accent` is always defined |
| E3: `textMuted = #94a3b8` | **PASS** | `tokens.ts:20` |
| E3: ≈2.37:1 on `#f5f6fa` canvas | **PASS** (≈2.40:1 by my calc) | WCAG AA fail for normal text confirmed |
| E3: `textMuted` used on empty / "暂无*" guidance | **PASS** | `ThreadList.tsx:936, 963, 1062, 1263, 1425, 1524, 1528`; `AtThreadPopover.tsx:125` ("无匹配会话"); plus many decorative timestamp/preview uses |
| E4: 4-strip accretion (StatusRail + FocusBand + SceneStatusBar + RunBusyChip + WorkerScopeBar) | **PASS** | `App.tsx:186-190` renders `FocusBand`, `SceneStatusBar`, `RunBusyChip`, `WorkerScopeBar` as siblings |

**Patch freshness:** `git status` matches the diff file exactly (base `6d95973`, `.gitignore` modified, spec + prompt + patch untracked). Not stale.

**ADR-020 capability declaration:** present in the SoT (Surface L0; L2-classes none; Compose none; Autonomy none; Trust no elevation; Channel unchanged). For a docs+tokens+copy change with no tool/gate/UI-entry additions, this satisfies the checklist.

## 3. Blocking issues

None. No rejection gate (R1–R5) is triggered:
- **R1** — every code fact I checked holds.
- **R2/R3/R4/R5** — the plan's "Explicit out-of-scope" list (`docs/superpowers/specs/2026-08-11-sidepanel-design-debt-conditional-go.md:103-110`) correctly excludes FocusBand rewrite, Settings restructure, Trust/L2 changes, BottomBar re-enable, and ontology rename. W1 explicitly removes the lying toast rather than re-enabling the strip.

## 4. Nits (non-blocking)

1. **DESIGN.md drift is larger than the SoT states.** The SoT highlights accent/canvas, but `docs/DESIGN.md:13-32` disagrees with `tokens.ts` on `text.primary` (`#111827` vs `#0f172a`), `text.secondary` (`#4b5563` vs `#475569`), `text.muted` (`#9ca3af` vs `#94a3b8`), `surface.muted` (`#f3f4f6` vs `#eef0f5`), `accent.soft` (`#dbeafe` vs `#eef2ff`), `status.live` (`#16a34a` vs `#059669`), `mode.l1` (`#dbeafe`/`#1e40af` vs `#eef2ff`/`#3730a3`). And `docs/DESIGN.md:121` says `userBubbleBg (#2563eb)` while `tokens.ts:63` is `#4f46e5`. **Recommend acceptance A3 say "any role row in the DESIGN.md color table and Message Bubbles section"** rather than only accent/canvas, otherwise an implementer could literally satisfy A3 and leave most of the drift in place. The SoT's W3 option "drop hex columns and keep role → tokens.* name only + one-line lag note" is the lower-recurrence option and is the right default.

2. **W2 option choice has real blast-radius asymmetry that the SoT names but doesn't resolve.** Option (A) darkening `tokens.textMuted` globally affects every consumer (including decorative timestamps that were intentionally muted); option (B) swapping only empty/guidance strings to `textSecondary` is more surgical. The SoT says "prefer minimal blast" — agree, pick (B) at implementation time unless measurement shows (B)'s sites miss an AA-critical spot.

3. **A4 is narrower than the SoT's NO-GO list.** A4 only says "No FocusBand architecture change; no Settings restructure". Suggest mirroring the SoT's full "Explicit out-of-scope" list (rename, polish pass, hex-migration campaign, BottomBar re-enable) so the acceptance gate doesn't read as the only boundary.

4. **Dead `#2563eb` fallback at `SettingsIntentBar.tsx:176`** (`tokens.accent || "#2563eb"`) — not in scope, but a free drive-by deletion in W3 if convenient; otherwise leave for the monotonic hex-migration campaign.

5. **No unit test for the W1 copy/flag interaction.** Since `meta-slash.ts` is already data-driven and tested, a small test asserting the StatusRail menu never emits "底栏更多" while `ui.bottomBarStrip === false` would lock the fix against regression. Acceptable to defer.

## 5. Scope assessment (W1–W4)

- **W1 (copy fix)** — keep. Highest product-truth value; trivial blast radius.
- **W2 (textMuted contrast policy)** — keep; pick option (B) at impl time. Real AA win.
- **W3 (DESIGN.md SoT)** — keep; prefer the "role → tokens.* name" table form to break the recurrence.
- **W4 (density measure + surgical collapse)** — keep as **optional / Day 1–2 only**, exactly as the SoT frames it. The spec P4 budget (≥55%/≥40%) is the right gate; the explicit "Forbidden: new unified meta-band component; FocusBand priority machine rewrite" guard (SoT:101) is what keeps this from metastasizing. Do **not** promote W4 to required without measured failure.

Kill list (FocusBand rewrite / Settings / rename / polish) is correct.

## 6. ADR-020 capability check

- Axes fit: change hangs on **Surface (L0 Panel chrome)** — not Composition, not Autonomy. ✓
- Pack-first: no new scenario; only copy/token/doc edits. ✓
- Confirm dialects: untouched. ✓
- Trust monotonicity: untouched (no L0/L2/CU/shell/netsec changes). ✓
- originWs: not applicable — no new `securityConfirmations.request`. ✓
- No new runtime. ✓

No Surface / Compose / Trust violation if landed as written.

VERDICT: APPROVE_WITH_NITS
