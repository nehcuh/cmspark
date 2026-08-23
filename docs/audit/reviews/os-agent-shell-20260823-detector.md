# Impeccable Assessment B — Summoner overlay design spec (detector + visual evidence)

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Role | Assessment B (detector + visual). Isolated from Assessment A. |
| Target | HTML specs for the Swift Summoner overlay (native UI not injectable) |
| Detector | `node .grok/skills/impeccable/scripts/detect.mjs --json` (skill v4.0.4) |
| Copy lock | [brief v2.1](../../decisions/os-agent-shell-brief-2026-08-22.md) S7/S12/S14 · [ship note](../../decisions/os-agent-shell-p0-spike-ship-note-2026-08-22.md) §2 v2 empty-state · [journeys](../../superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md) Always/Never |
| **VERDICT** | **APPROVE_WITH_NITS** |

No project source was modified. Only this file was written.

---

## 1. CLI findings JSON summary

All runs cwd `/Users/huchen/Projects/cmspark`. Exit code **2** = non-advisory findings present; **0** = clean.

### 1.1 Chosen (primary)

```
node …/detect.mjs --json docs/design/os-summoner-p0-chosen.html
EXIT=2   count=1
```

| antipattern | severity | category | file | line | snippet |
|-------------|----------|----------|------|------|---------|
| `flat-type-hierarchy` | warning | slop | `docs/design/os-summoner-p0-chosen.html` | 30 | Sizes: 11px, 12px, 12.5px, 13px, 15px, 20px (ratio 1.8:1) |

Raw JSON `[executed]`:

```json
[
  {
    "antipattern": "flat-type-hierarchy",
    "name": "Flat type hierarchy",
    "description": "Font sizes are too close together — no clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).",
    "severity": "warning",
    "category": "slop",
    "file": "/Users/huchen/Projects/cmspark/docs/design/os-summoner-p0-chosen.html",
    "line": 30,
    "snippet": "Sizes: 11px, 12px, 12.5px, 13px, 15px, 20px (ratio 1.8:1)"
  }
]
```

### 1.2 Directory `docs/design`

```
node …/detect.mjs --json docs/design
EXIT=2   count=3
```

| # | antipattern | file | line | snippet |
|---|-------------|------|------|---------|
| 1 | `flat-type-hierarchy` | `os-summoner-p0-chosen.html` | 30 | 11 / 12 / 12.5 / 13 / 15 / 20 (ratio 1.8:1) |
| 2 | `dark-glow` | `os-summoner-p0-options.html` | 84 | Zero-offset box-shadow glow (`#fbbf24`) |
| 3 | `flat-type-hierarchy` | `os-summoner-p0-wireframes.html` | 10 | 10 / 11 / 12 / 18 (ratio 1.8:1) |

PNG `os-summoner-p0-wireframes.png` is not an HTML/text target; detector did not emit a finding for it.

### 1.3 Per-file repeats

| target | EXIT | count | rules |
|--------|------|-------|-------|
| `os-summoner-p0-wireframes.html` | 2 | 1 | `flat-type-hierarchy` @ L10 |
| `os-summoner-p0-options.html` | 2 | 1 | `dark-glow` @ L84 (Option B lamp) |

### 1.4 Side Panel TSX (regex engine)

Detector **does** accept `.tsx`: non-HTML files go through `detectText` (regex), not the static HTML/CSS cascade. `[executed]`

```
node …/detect.mjs --json chrome-extension/src/sidepanel/store/agentStore.tsx
EXIT=0   count=0   []

node …/detect.mjs --json chrome-extension/src/sidepanel/App.tsx
EXIT=0   count=0   []
```

**Coverage caveat:** 0 findings on TSX is **not** an a11y/cascade all-clear. Overlay chrome is Swift; these files only carry the Panel dual-composer standby string (`overlayStandbyLabel` → 「这边暂时打不了字，正在召唤器里说」), which matches journeys J4. `[inspected]`

### Totals

| scan | files with hits | unique rules | errors | warnings | advisories |
|------|-----------------|--------------|--------|----------|------------|
| chosen.html | 1 | 1 | 0 | 1 | 0 |
| docs/design | 3 | 2 (`flat-type-hierarchy`, `dark-glow`) | 0 | 3 | 0 |
| TSX (2 files) | 0 | 0 | 0 | 0 | 0 |

No P0 detector hits. Highest severity in CLI output: **warning**.

---

## 2. False positives

1. **`flat-type-hierarchy` on `chosen.html:30` — partial FP.** `[executed]` sizes are real. **20px is the spec-page `h1`**, not overlay chrome. Overlay steps are 11 (badge/hint) / 12–12.5 (who/CTA) / 13 (hits/thread) / 15 (composer). That is Operate-mode density on a 420px card, not marketing-page slop. Do not “fix” by inflating overlay type to a 1.25 scale.

2. **`flat-type-hierarchy` on `wireframes.html:10` — FP for product.** Annotation sheet (10px callouts, 12px items, 18px page title). Not shipping UI.

3. **`dark-glow` on `options.html:84` — out of chosen mix.** `[inspected]` Option B split-flap `.b .lamp { box-shadow: 0 0 8px #fbbf24 }`. Options gallery is explicitly **not** the selected world (ship note: “Option set (not the chosen mix)”). Finding is true *in that file*; it must not gate the 看山 chosen spec.

4. **TSX clean pass — not a positive signal** that Side Panel visual quality was scanned. Regex engine only.

---

## 3. Skipped / failed browser steps

| Step | Result | Reason |
|------|--------|--------|
| Inject into Swift `NSPanel` overlay | **SKIPPED** | Native overlay. Cannot inject. Fallback signal as specified. **Do not claim the live tray overlay was seen.** |
| `detect.mjs` URL/browser engine (`file://…chosen.html`) | **FAILED** `[executed]` | `Error: puppeteer is required for URL scanning. Install: npm install puppeteer` → JSON `[]`, EXIT=0 (empty, not a pass). Deterministic **cascade/contrast scan of computed styles via detector = unavailable** after a real attempt. |
| Impeccable `live-inject` / live-server | **SKIPPED** | Not requested; HTML was opened via a throwaway static server instead. |
| MCP `take_screenshot` of HTML mock | **FAILED** | Chrome DevTools MCP navigated successfully; screenshot payloads truncated (`integrity check failed: image bytes are truncated`). No reliable raster of the live mock from MCP. |
| Raster of four-state wireframes | **READ** `[inspected]` | `docs/design/os-summoner-p0-wireframes.png` opened as image. Matches `wireframes.html`, **not** v2 talk-first empty. |

**What did succeed (HTML mock only, not Swift):**

- `python3 -m http.server 8766 --bind 127.0.0.1 --directory docs/design` `[executed]`
- Chrome DevTools MCP `navigate_page` → `http://127.0.0.1:8766/os-summoner-p0-chosen.html` (title: 选定稿 A结构 × C看山)
- Clicked tabs **1 空场 / 2 检索 # / 3 续聊 / 4 未连接**
- `evaluate_script` computed styles + a11y snapshots for all four states `[executed]`

Server was stopped after measurement.

---

## 4. Visual evidence (HTML mock, live DOM)

Overlay `#ov` is 420px. Composer `border-radius: 16px`. `[executed]`

### 4.1 Empty (first paint) — `apply("empty")`

| Probe | Measured |
|-------|----------|
| Badge text | `检测浏览器…` (warn class `.badge`, not `.ok`) |
| Field icon | **`⌕` always in `.field`**, `aria-hidden="true"` |
| Placeholder | `说点什么，或按住说话…` |
| Input value | `""` |
| Hint | `回车发送到当前线程，输入 # 搜标题` |
| Hits / thread / CTA | `hidden` + `display:none` (correctly collapsed) |
| `#foot` | **`hidden=true` but computed `display:flex`, 396×38, paints `发送` + `已连接，继续对话`** |
| `sendVisible` if you trust `.hidden` | `false` (JS intent) |
| What is actually painted | send + continue **visible** (CSS wins) |
| Missing vs journeys J1 | `新对话`; `继续 · {title}` |

**Root cause of the foot leak** `[inspected]` `chosen.html` L58 `.foot { display: flex; … }` author style **overrides** the UA `[hidden] { display: none }`. JS `$("foot").hidden = st !== "chat"` does not hide the box.

A11y snapshot on empty listed buttons `发送` and `已连接，继续对话` even on first paint. Overlay `innerText` includes both.

### 4.2 Search `#`

Badge `浏览器已连接` `.ok`. Value `#投研纪要`. Hint `只搜标题，不搜正文`. Hits visible. **Foot still painted** (`hidden` + `display:flex`). Search state must not show send/continue (Enter = select title). Icon still `⌕` (OK *here*, wrong on talk).

### 4.3 Chat / 续聊

Plaintext `你` / `助手` lines; `threadLooksLikeBubbles: false`. No Allow/Deny. Foot **intentionally** shown: `发送` + `已连接，继续对话`. Side `完整格式在侧栏`. Icon still `⌕` on a talk field holding `和比亚迪比呢？`.

### 4.4 Detached / 未连接

Badge `浏览器未连接`. CTA copy **does** contain `我们不能替你打开侧栏` + `激活 Google Chrome` + 拼图钉上. **AND** the leaked foot still paints **`已连接，继续对话` under a 未连接 badge.** State lie. Journeys NEVER: 未连接就藏发送 — JS *intends* to hide send here; CSS then shows send **and** the connected-continue CTA together with the attach CTA.

---

## 5. HTML spec vs locked copy

Lock sources: brief S7 (empty default TALK; `#` searches titles), ship note v2 empty-state, journeys Always/Never.

### 5.1 `os-summoner-p0-chosen.html` (selected mix)

| Lock | Spec mock | Status |
|------|-----------|--------|
| Empty talks, not search. Placeholder `说点什么，或按住说话…` | Placeholder correct | OK |
| First-paint badge `检测浏览器…` (J1 / NEVER 已配对却写死未连接) | Empty badge is `检测浏览器…` | OK |
| `#` starts title search; hint `只搜标题，不搜正文` | Search tab does this | OK |
| **No search icon in talk field** | **`⌕` in `.field` on every state including empty/talk** | **VIOLATES** |
| Send always visible in talk, including detached | JS: foot hidden unless `st==="chat"` (hides empty + off). CSS: foot always flex-painted | **VIOLATES both ways** (intent hides send on empty/detached; leak paints continue on empty/search/off) |
| CTA must contain 不能替你打开侧栏; no fake openSidePanel | CTA string correct; button `激活 Google Chrome` | OK |
| History plaintext `你`/`助手`, no bubbles | Thread is div lines, not bubbles | OK |
| 「实验」 only in window title; no overlay 召唤器·实验 | `#exp` never filled | OK |
| No Allow/Deny / 主界面 | `hasAllow:false`, `hasZhuJiemian:false` | OK |
| 16px composer radius; 看山 white + indigo send | `fieldRadius: 16px`; `--accent:#4f46e5` | OK |
| `继续 · {title}` when last thread known | Not in mock | Missing |
| J1 顶栏 +「新对话」 | Not in mock | Missing |
| Placeholder 按住说话 | No 🎙 control in mock | Missing (copy over-promises) |

**Empty first paint is the worst frame:** talk placeholder + **search glyph** + **warn badge** + **「已连接，继续对话」** while still “检测浏览器…”. A Swift port that copies the mock 1:1 ships a search-launcher that lies about connection.

### 5.2 `os-summoner-p0-wireframes.html` + `.png` (stale vs v2)

Raster `[inspected]` matches the HTML sheet.

| Frame | What it paints | vs v2 lock |
|-------|----------------|------------|
| 01 空场 | Placeholder **`输入线程标题`**; hint 不搜文件和应用; dual pill 已连接\|未连接; **`召唤器 · 实验`** in chrome; **no send** | **Search-first empty.** 「实验」 on overlay. First paint is not `检测浏览器…`. |
| 02 检索 | `⌕　投研纪要`; title hits; no `#` prefix in the box | Search-first leftover (chosen uses `#` to enter search) |
| 03 续聊 | Plaintext log; 发送 + 已连接，继续对话; 完整格式在侧栏 | Structure OK; continue-on-already-connected is copy-odd |
| 04 未连接 | Honest 不能打开侧栏 + 激活 Google Chrome; **no send** | Violates “detached 仍有发送” |

Wireframes/PNG **must not** be treated as copy lock. They predate the same-day v2 empty-state amend. Implementers who draw from the PNG will ship “输入线程标题”.

### 5.3 `os-summoner-p0-options.html`

Gallery of A/B/C. Option C uses chat bubbles (`.c .log .u/.s`). Option B has the amber glow the detector flagged. Not the chosen mix. Do not copy B/C.

### 5.4 Contrast the detector missed (puppeteer absent)

`[executed]` WCAG 2.x:

| pair | ratio | AA 11–12px text |
|------|-------|-----------------|
| `--faint` `#a3a3a3` on `#fff` (empty hint) | **2.52:1** | **FAIL** (needs 4.5:1) |
| `--secondary` `#737373` on `#fff` | 4.74:1 | pass |
| body `#171717` on `#fff` | 17.93:1 | pass |
| warn badge `#92400e` on `#fffbeb` | 6.84:1 | pass |

The **primary empty-state instruction** is below AA. Static detector did not report it.

---

## 6. Integrity score (audit.md dimensions, spec-only)

HTML mock / spec sheet, not Swift.

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | Hint 2.52:1; foot `[hidden]` overridden so extra buttons stay in a11y tree; search glyph unlabeled (aria-hidden, so talk field has no “this is talk” cue) |
| 2 | Performance | 4 | Static spec page |
| 3 | Responsive | 3 | Overlay fixed 420px (correct for the product); spec page tabs wrap |
| 4 | Theming | 3 | 看山 tokens consistent on chosen; hard-coded `#444`/`#334155` leftovers |
| 5 | Implementation integrity | 2 | Talk-first **contract** is coherent; **first-paint mock and wireframe PNG contradict the lock** |
| **Total** | | **14/20** | **Good band, weak integrity** |

---

## 7. VERDICT

**APPROVE_WITH_NITS** for design-spec *quality of the chosen world*.

Not REJECT: identity is locked (L0 capture, not 主界面), 看山 tokens, plaintext history, honest attach CTA, `#` search, no Allow, detector only warnings, two of three CLI hits are FP/out-of-mix.

Not APPROVE: the **shipping pictures disagree with the locked copy**.

Nits Swift / next HTML pass must not copy:

1. **Search icon `⌕` in the talk field** (chosen L92, all four live states). Talk field is empty invitation, not Raycast search. Show `⌕` only when value starts with `#`.
2. **Foot / `[hidden]` leak.** `.foot { display:flex }` paints `发送` + `已连接，继续对话` on empty, search, and 未连接. Use `[hidden]{display:none!important}` or don’t use `hidden` with an author `display`. Product rule: **发送 visible in talk including detached**; **「已连接，继续对话」 only after attach**, never on empty-detect or 未连接.
3. **Empty first paint:** keep `检测浏览器…` + talk placeholder + hint; drop warn-styling-as-error, drop continue CTA, add `新对话` / `继续 · {title}` per journeys. Do not use wireframe “输入线程标题”.
4. **Treat `wireframes.html` + `.png` as structure-only and stale on empty.** Copy lock is chosen contract + ship note v2 + journeys.
5. Hint color: replace `--faint` `#a3a3a3` (2.52:1) with `--secondary` `#737373` (4.74:1) or darker.
6. Placeholder “按住说话” without a 🎙 control over-promises STT.

CLI: **0 errors, 3 warnings (2 FP/out-of-mix, 1 partial FP).** Visual/copy nits above are **not** in the detector JSON; they are the actual spec defects.

---

*Assessment B · detector + live HTML mock (not Swift overlay) · 2026-08-23*
)
