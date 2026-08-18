Mock ground truth secured — `comp-a-centered.html:62-71` shows the approved Comp A rail had **exactly one** 32px right icon next to the centered title. The collision finding is now fully evidenced. Delivering the review.

---

# Independent Review — `companion-canon-ui-r2`

**Patch freshness** [executed]: `git status`/`git diff` at review time matches `companion-canon-ui-r2-diff-20260818-154102.patch` exactly (11 files, +398/−320). Not stale.
**Machine gate** [executed]: `tsc` 0 errors; test suite 703/703 pass.

## 1. Findings

### P1-1 — 320px rail: centered brand text collides with the right cluster in every capability state [inspected, arithmetic + mock ground truth]

- `StatusRail.tsx:215-217` — brand is `position:absolute; left:50%; translateX(-50%)` → "CMspark" (15px/600 ≈ 62px) sits at ≈ **[129, 191]** on a 320px panel.
- `StatusRail.tsx:218-235, 479-485` — cluster (`marginLeft:auto`) packs ModeBadge + 新增对话(32) + 历史对话(32); `:256-286` adds conn dot (+label when disconnected); `:287-306` adds ⋯(32). Right-aligned, the cluster's left edge lands at:
  - L0 聊 (badge ≈48): **≈143** → brand overlaps the badge by ~48px
  - L1 网页 (≈59): ≈132 → near-total overlap of badge
  - L2 计算机 (≈70): ≈121; `计算机 · LIVE` (≈110): ≈81 → brand entirely inside the badge zone
  - Disconnected (conn label +22–60px) and cruise-armed (+≤140px pill) make it worse.
- Brand is a positioned element, so it **paints on top of** the static ModeBadge — dark bold "CMspark" glyphs strike through 「网页」/「计算机 · LIVE」. `pointerEvents:none` keeps clicks intact, so nothing is unreachable — but the defect is present in 100% of frames.
- Root cause confirmed against the approved mock: `comp-a-centered.html:62-71` has only one 32px right icon ([278,310]) — 88px clear of the centered title. The five extra right-rail affordances this diff adds were never in the mock, so the mock does not certify this layout. No headless browser available in this repo; overlap is robust to ±15px font-metric error, so the finding stands without a rendered screenshot.
- Does not falsify C″ (one rail, all controls present and operable), so per the agreed REJECT bar it is not blocking — but it should be the first follow-up fix. Cheapest fixes: left-anchor brand next to gear; or render brand only when measured clearance allows; or let the rail carry the CompanionMark glyph at small size instead of the wordmark.

### P2-1 — Dead styles after refactor
`StatusRail.tsx:501-514` (`brandMark`), `:522-540` (`threadIdBadge`), `:541-544` (`spacer`), `:600` (`iconBtn`) — none referenced in JSX. tsc can't catch style-map orphans; delete.

### P2-2 — Dead export added by this very diff
`icons.tsx:169-175` — `IconPlus` is exported and never imported (implementation uses `IconNewChat`). Delete.

### P2-3 — Doc drift inside the same batch
- `docs/DESIGN.md` Input/Composer section: "Empty-state placeholder: `畅所欲问`" — that string ships nowhere (`meta-slash.ts:334-336` = 描述任务 / 问这页 / 排队跟进); it is the mock's placeholder (`comp-a-centered.html:101`) that your D″ cut superseded.
- `App.tsx:1-8` THESIS cites “接下来想做什么？”/“畅所欲问” — both stale vs shipped L0 copy (`ChatView.tsx:1532` 要我帮你做什么？). FINISH claims "undocumented is unfinished" while the header documents the wrong strings.

### P2-4 — No regression test for the core trust fix
`ThreadList.tsx:52-69` `createBlankThread` — the R1 poison fix (no DeepSeek stamp, no `trusted_domains: []`, no `active_skill_ids: ["browse"]`) is the highest-stakes change in the batch and the only major one with zero test coverage. Placeholders got their test (`composer-slash-parity.test.ts:122-128`); this didn't. It's a pure function — one assertion (`config_override` deep-equals `{}`, `active_skill_ids` deep-equals `[]`, no `base_url` key) locks it forever.

### P2-5 — L0 first invitation is an L1 page task
`ChatView.tsx:1552` — L0's first row is “总结当前打开的页面”， identical to L1's first row. Auto-escalation makes it functionally honest, and the D″-specified L0 greeting/hint are clean, but the L0 row set blurs the “L0 ≠ 操作当前标签” line D″ just established. Either accept explicitly or make L0 row 1 L0-pure.

### P2-6 — Two 设置 entrypoints with divergent behavior
Rail gear (`StatusRail.tsx:201-214`) is context-aware (→ connection when disconnected); thread-list header 设置 (`ThreadList.tsx:1283-1292`) always opens `model`. Duplication invites drift; make the header button context-aware too or drop it.

## 2. Do C″ and D″ actually hold?

**C″ (一条栏) — HOLDS** [inspected]. One rail carries 设置 + brand + ModeBadge + 新增对话 + 历史对话 + conn + ⋯ (`StatusRail.tsx:201-306`); ModeBadge renders unconditionally (`:219-224`), not gated on `hasMessages` — `hasMessages` only disables ⋯ menu export/skill items (`:314-317`, pre-existing). Conn = dot always, label only when disconnected, click → connection settings only when disconnected (`:256-286`) — whisper, not costume. Gear routes connection-when-disconnected / model-otherwise (`:206-211`). 急停 not buried: FocusBand renders above ChatView in the App layout. The P1 collision is a defect *within* the one rail, not a second rail.

**D″ (Agent 诚实) — HOLDS** [inspected]. L0 title “要我帮你做什么？”, hint “问问题、写文案，或描述任务。” — no 操作当前标签， no 随便聊 (`ChatView.tsx:1532-1538`); rows are 起草说明 / 装配 with human gloss “打开装配（技能、场景、知识）” (`:1554`). L1 hint is a page task (“让我操作当前标签”， `:1535`) — allowed at L1. Placeholders L0 描述任务 / L1 问这页 (`meta-slash.ts:334-336`), verified by test. 装配 button in composer capsule with `aria-label="装配"` + title gloss “装配 — 技能、场景、知识”； attach has `aria-label="添加文件或图片"` (App.tsx composer section). P2-5 is a residual blur, not a violation of the cut as specified.

**Trust / createBlankThread — POISON REMOVED** [inspected]. `ThreadList.tsx:52-69`: `config_override: {}` → falls back to live `state.config` (App.tsx effective-model fallback); `chat.send` carries no config so companion-side config stays authoritative; `useWebSocket` auto-create path matches. No DeepSeek `base_url`, no empty `api_key`, no `trusted_domains: []`, no `["browse"]` skill stamp. New threads inherit real trust. Consistent across both creation paths.

## 3. ADR-020 checklist application

- **Surface**: diff touches Panel chrome only; no new L2 tool/surface/gate. ✓
- **Composition**: 装配 remains the composition entry (composer button + empty-state row), glossed for humans; Board stays Autonomy-only (`composeSectionsExcludeBoard` guard + test intact). No bare “中层 Agent” framing. ✓
- **Autonomy**: no new confirm family, no originWs changes, cruise disarm path untouched, 急停 above stream. ✓
- **Trust monotonicity**: `createBlankThread` now *preserves* live trust instead of de-escalating to empty — strictly monotonicity-improving. ✓
- **No new runtime**: all changes are React UI + tokens + copy. ✓
- **Declaration vs diff**: declared blast (Panel chrome / compose entry chrome) matches the actual diff; no undeclared capability. ✓

## 4. UI/UX backlog (prioritized, next ship)

1. **Fix rail brand/cluster collision** (P1-1) — left-anchor brand beside gear, or conditional render on measured width.
2. **`createBlankThread` regression test** (P2-4) — lock the trust fix.
3. **Purge dead styles + `IconPlus`** (P2-1/2).
4. **Sync DESIGN.md + App.tsx THESIS to shipped copy** (P2-3).
5. **L0 invitation set** — accept or purify row 1 (P2-5).
6. **Unify 设置 behavior** across both entrypoints (P2-6).
7. **EmptyState copy tests** per level via existing `data-testid` — cheap lock on D″ strings.
8. **Disconnected-state rail audit** — conn label + cruise pill + collision fix should be verified together at 320px in one render pass.

---

Blocking check per contract: C″ true, D″ true, trust poison removed, machine green — the agreed REJECT bar is not met. The P1 collision and P2s above are non-blocking and listed for the immediate follow-up.

VERDICT: APPROVE_WITH_NITS
