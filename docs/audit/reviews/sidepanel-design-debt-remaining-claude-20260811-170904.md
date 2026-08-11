---

## 1. Summary

Plan-gate review for W4 (density budget measure + surgical collapse only if fail) + W5 (residual indigo/blue hex → tokens on 3 named files). Capability declaration present and accurate (L0 chrome only; no Surface/Compose/Autonomy/Trust/Channel shift). All SoT code claims fact-verified against working tree. Rejection gates R1–R4 cleared: no false claims, no FocusBand/Settings/BottomBar mandate, no mass-hex sweep, no trust/L2 elevation. Diff patch (`sidepanel-design-debt-remaining-diff-20260811-170904.patch`) matches live `git diff` exactly (17 files, 82+/60−) — not stale. Plan is tight, monotonic, implementable.

## 2. Factual spot-check (all `[inspected]`)

| Spec claim | Verified at | Status |
|---|---|---|
| `BoardPanel.tsx` `tool_verified` bg `#2563eb` | `BoardPanel.tsx:23` | ✅ present |
| `AppsPanel.tsx` `color: "#2563eb"` | `AppsPanel.tsx:1146` | ✅ present |
| `computer-utils.ts` `bg: "#dbeafe"` | `computer-utils.ts:186` | ✅ present |
| `SettingsIntentBar.tsx` already cleaned in W1–W3 | diff line 173 (dead `|| "#2563eb"` fallback removed) | ✅ consistent |
| FocusBand / SceneStatusBar / RunBusyChip / WorkerScopeBar stack | `App.tsx:186–190` | ✅ |
| `FOCUS_BAND_MAX_PX = 80` | `focus-band-priority.ts:5` | ✅ |
| SceneStatusBar / RunBusyChip / WorkerScopeBar maxHeight 28 | each `*:89 / *:104 / *:81` | ✅ |
| StatusRail minHeight 44 | `StatusRail.tsx:449` | ✅ |
| `ui.bottomBarStrip = false` | `flags.ts:13` | ✅ |
| Target tokens exist (`accent`/`accentSoft`/`accentText`/`modeBrowserBg`/`textSecondary`) | `tokens.ts:23–40` | ✅ |

## 3. Blocking

None. R1 (false claims), R2 (forbidden rewrite mandate), R3 (mass hex), R4 (trust elevation) all cleared.

## 4. Nits (non-blocking)

- **N1 — Static budget under-specifies inter-band overhead.** W4 method sums max heights but ignores 1px borders + gap/padding between FocusBand/Scene/RunBusy/Worker (`FocusBand.tsx:242,297,318,340` show real paddings). Recommend the budget note add a `+N px chrome gutters` term so the worst-case 40% threshold isn't gamed by ignoring seams.
- **N2 — `computer-utils.ts` `#dbeafe → tokens.modeBrowserBg` is a hue shift, not a value swap.** `modeBrowserBg = #eef2ff` (indigo-soft) vs current `#dbeafe` (blue-soft). Fine — flag in the budget note so reviewers don't read it as a regression.
- **N3 — AppsPanel.tsx:1146 target is ambiguous.** Spec says "`tokens.accent` / `tokens.accentText` as fits contrast". Pin one at implementation time (text-on-light → likely `accentText #3730a3` for AA).
- **N4 — DESIGN.md lag-note wording self-contradicts.** Body lists `SettingsIntentBar` as still carrying stale blue, but parenthetical admits the dead `|| "#2563eb"` fallback was already removed in this same diff. Drop `SettingsIntentBar` from the lag-note list (or rewrite as "Board/Apps only").
- **N5 — `#dbeafe` UIA "未探测" badge contrast.** `computer-utils.ts:194` also has `bg: "#e5e7eb"` for OCR chip — out of W5 scope (correct), but worth noting that the spec only fixes the UIA `#dbeafe` row; the OCR `#e5e7eb` remains raw hex. Defer to a future gray-ladder pass (consistent with "no mass gray migration").

## 5. Scope W4/W5 keep-cut

- **W4 keep:** static measure first; surgical dedupe only if budget fails; no new meta-band; no FocusBand priority machine edit; no `bottomBarStrip=true`; no Board Host entry. ✅ matches plan.
- **W4 cut:** nothing in plan exceeds W4 boundaries.
- **W5 keep:** only BoardPanel.tsx:23, AppsPanel.tsx:1146, computer-utils.ts:186 — three lines. ✅ matches plan.
- **W5 cut:** no Packs `#b45309` orange campaign, no AppsPanel/ThreadList gray ladder, no Settings rewrite. ✅ matches plan.
- **Acceptance B1–B6:** all implementable. B3 (rg `#2563eb` → 0) will succeed after the 3-line W5 migration (currently 2 hits, both addressed). B6 test green is post-implementation verification.

## 6. ADR-020 checklist

- Axes fit: pure Surface-L0 chrome recolor + doc; does not touch Composition/Autonomy. ✅
- Pack-first: N/A (no new scenario). ✅
- Confirm dialects: N/A (no new gate). ✅
- Trust monotonicity: N/A (no trust change). ✅
- originWs: N/A (no confirm request change). ✅
- Capability declaration present and correct. ✅

N1–N5 are non-blocking documentation/contrast-choice refinements addressable at implementation time.

VERDICT: APPROVE_WITH_NITS
