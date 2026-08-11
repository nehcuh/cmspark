All claims verified against code. Here is my independent review.

---

## 1. Summary

The CONDITIONAL GO plan is a pre-implementation design-gate doc (the "diff" is the SoT itself + an unrelated `.impeccable/` .gitignore addition). Every machine-checkable code claim in the SoT — flags, BottomBar gate, the lying toast string, token hexes vs DESIGN.md, residual `#2563eb`, textMuted contrast, and the 4-strip status accretion — is **true on spot-check**. Scope is correctly bounded to copy + contrast policy + docs SoT (W1–W3) with W4 explicitly measurement-gated. No rejection gate triggers; no Trust/L2/Compose/Autonomy expansion.

## 2. Factual spot-check

**E1 — PASS.** `ui/bottomBarStrip: false` (`sidepanel/ui/flags.ts`); App renders BottomBar only under the flag (`App.tsx:195`); StatusRail toasts the exact string `场景 / 任务板已移至底栏「更多」— 主栏仅保留当前模式高频入口` (`StatusRail.tsx`, menu item `关于「更多」面板`, toast text — exact match). Real paths exist: `meta-slash.ts:65/94/130` (`/场景`, `/board` → `panelId: "board"`, `装配`), and `ComposeDrawer.tsx:123` already carries a correct note "任务板 / 编排不在装配内 — 使用 /board 或 ⋯「编排」". Product-truth bug confirmed.

**E2 — PASS.** `tokens.ts`: `accent: "#4f46e5"`, `bg: "#f5f6fa"`. `docs/DESIGN.md:15` canvas `#fafbfc`, `:23` accent `#2563eb` — both disagree with tokens. Residual `#2563eb` grep-verified in `BoardPanel.tsx`, `AppsPanel.tsx` (also `SettingsIntentBar.tsx` — the "e.g." covers it).

**E3 — PASS.** `textMuted #94a3b8` on `bg #f5f6fa` computes to **2.37:1** (matches SoT). Used on empty/guidance copy: `ThreadList.tsx:936` (`暂无线程…`/`无匹配线程`), `ThreadList.tsx:1062` (`选择上方标签查看会话`), `AtThreadPopover.tsx:125` (`无匹配会话`), and `ChatView.tsx` empty kicker (`emptyKicker` @1607–1612, 11px uppercase). Not only decorative meta.

**E4 — PASS.** `App.tsx:176/186/188/189/190` renders StatusRail + FocusBand + SceneStatusBar + RunBusyChip + WorkerScopeBar. UIUX v2 P4 (`2026-07-31-sidepanel-uiux-redesign.md:50`) says "single status rail, not 4 strips"; density budget `≥55%` L0 idle / `≥40%` worst-case @ 640px confirmed (`:53`, `:384–385`, `:510–511`). SoT states these are **not** re-measured this batch — honest.

## 3. Blocking issues

None. R1–R5 all pass:
- R1: no false code facts found (all spot-checks pass)
- R2: no FocusBand rewrite / Settings restructure / second runtime in the GO scope
- R3: no Trust / auto_approve / L2 tool changes
- R4: the fix is copy, not re-enabling the strip — plan explicitly requires the opposite
- R5: no ontology rename

## 4. Nits (non-blocking)

1. **W1 "open Host panels" vs spec constraint** — UIUX v2 `:395` says "Board under Autonomy chrome only". W1's "(or open Host panels) as appropriate" must not translate into an L0 board entry point; keep the fix to copy/slash hints (`/board`, `装配` chips). Plan is not explicit about this constraint.
2. **W2 ordering vs "prefer minimal blast"** — option A darkens the shared `textMuted` token, which also hits decorative timestamps (`ChatView.tsx:981` "Vision cached", etc.), a wider blast than option B. SoT says "prefer minimal blast" but lists A first; suggest B-first ordering or scoping A to new usage only.
3. **W4 can silently die** — A6 only documents W4 if run; nothing forces the density measurement to ever happen, leaving UIUX v2 `:384–385` acceptance checkboxes open indefinitely. Consider a timeboxed measurement regardless of budget outcome.
4. **Legacy hexes remain** — A3 only requires DESIGN.md to defer to tokens; residual `#2563eb` in BoardPanel/AppsPanel/SettingsIntentBar stays. Consistent with out-of-scope, but the one-line lag note in W3 should explicitly name the surviving panels so a future batch can claim them.
5. **Exact replacement toast/menu strings unspecified** — fine at plan gate; leave to implementer with A1 as the check.
6. **Patch noise** — the `.gitignore` `.impeccable/` entries are unrelated to the batch; harmless tooling hygiene, but should be a separate commit.
7. **A2's "document which"** — 11px kickers are bold/letter-spaced semantic labels, not decorative; implementer should move them to `textSecondary` (7:1) rather than argue AA exemption at 2.37:1.

## 5. Scope assessment

- **W1 (keep, required)** — correct and minimal; verifiable via A1.
- **W2 (keep, required)** — correct; prefer option B (surgical) with A-policy documented.
- **W3 (keep, required)** — correct; role→token table + lag note is the cleanest cut.
- **W4 (keep optional)** — correctly gated on measurement; do not promote to required, but ensure it isn't deferred forever (nit 3).
- Kill list correct: FocusBand rewrite, Settings (~3.8k LOC), rename, polish all NO-GO with no evidence they're smuggled in.

## 6. ADR-020

Declaration present and accurate: Surface L0 panel chrome, L2-classes none, Compose none, Autonomy none, Trust no elevation, Channel unchanged. No new tools/gates/UI entry points, no confirm-family or `securityConfirmations.request` changes (originWs N/A), no 中层 Agent language, no new runtime. Pack-first not implicated (no new primary chrome; 装配 references are existing surface). **No violation** if landed as written.

```
VERDICT: APPROVE_WITH_NITS
```
