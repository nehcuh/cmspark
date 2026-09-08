I'll read the packet first and follow only its review instructions.# Independent design gate — #471

**Scope:** this packet only. No other files, diffs, or runtime. Claims below are from the written spec + the included `SettingsSection` source.

**Lens:** correctness, a11y, trust, completeness. User bar: summoner/chat **visual system** (not a restyle), **no 山**, **logical settings**.

---

## VERDICT: **REJECT**

Direction is right. The packet is not implementable without inventing trust chrome, save scope, IA mapping, and the 320px nav. Those guesses are how the last pass became “superficial styling.”

---

## What is solid

- Same light surface, type hierarchy, rounded field, bottom actions as main chat; 山 removed from header + initial + dynamic empty; no replacement hero icon.
- Empty state is a sentence; history / new chat stay; attach, dictation, send under the field; meeting / open-browser secondary.
- Protocol, ids, confirmation handlers/defaults, and keep-mounted pages are called out as invariants.
- Eight named categories; model page scoped to model / vision / reasoning budget; voice split out; upload + notes export + session index under files.
- Stable ids `model | connection | security | integrations | secrets | experimental`; `export` relabeled; new `voice`; old hashes still resolve.
- Hide unused pages with `display`/`aria-hidden`, do not unmount (matches `SettingsSection` D-S8).
- Visual order = DOM order; no `order` shuffle.
- Verification includes 320/390/800/1440 + short viewport, draft survival, deep links, isolated summon HTML, production build. Dual review + CI; no ship.

That is a real product change, not a theme tweak. It is still underspecified where trust and IA meet.

---

## P0 — trust chrome has no replacement

Today, collapsed `SettingsSection` is the cross-page trust surface:

- `badge` always visible when collapsed (“armed trust”)
- `forceHint` when collapsed (e.g. 未配对)

The new IA is **one visible page**. Those headers go away. The spec says 配对/高权限状态必须跨分类可见且可定位, and does not specify:

| Gap | Why it blocks |
|-----|----------------|
| Where it lives | Nav item? Sticky banner? Status chip in chrome? |
| What it shows | Pairing vs armed-trust vs both; copy; severity |
| Locate | Click/keyboard path to `connection` / `security` |
| Live updates | Pairing can change while the user is on 模型; hidden `aria-hidden` pages will not announce |
| In-progress confirm | Phrase panel / download state must survive hide, but a pending high-privilege confirm must still be **reachable**, not only preserved in a `display:none` tree |

Keeping children mounted preserves **data**. It does not preserve **visibility**. Shipping category nav without this chrome is a trust regression against the current accordion.

**To clear:** one component spec (placement at 320 and 1440, content, activate → category, `aria-live` / focus rule when status appears off-page).

---

## P0 — save/test model contradicts itself

Three rules, no composition:

1. 保存/测试只一处常驻
2. Each form already has its own save **or** unified save
3. Immediate-effect controls keep current semantics and copy

Pages stay mounted, so hidden categories can hold dirty drafts and integration-internal drafts.

Unspecified:

- Does the chrome save **current category**, **all mounted unified-save forms**, or **everything dirty**?
- Do in-page Save buttons disappear? If yes, per-form handlers have no target. If no, “只一处” is false.
- Immediate-effect fields: does the bar imply they are unsaved?
- Hidden dirty secrets/security: silent persist (good) vs surprise write (bad) vs lost on app quit because user saved on 模型 (bad)

This is data integrity + consent, not polish.

**To clear:** a table: control → save timing (unified / own / immediate) → chrome visibility → whether a save on page A commits page B.

---

## P1 — category ↔ id ↔ field map is incomplete

Display categories (8) and ids in the packet do not fully bind.

| Display | Stated id | Hole |
|---------|-----------|------|
| 模型与推理 | `model` | Voice/shortcuts leave; **orphan field list missing** |
| 输入与语音 | `voice` (new) | “Voice setters require target page update” — **no setter inventory** |
| 文件与知识 | `export` (label only) | Upload + notes export + session index; hash stays `export` — OK if documented |
| 连接与配对 | `connection` | |
| 安全与信任 | `security` | |
| 本机与工具 | `integrations`? | **Never stated.** 既有权限/集成控件 + 清楚子标题 has no parent page and no subtitle list |
| 密钥与环境 | `secrets` | |
| 实验功能 | `experimental` | |

Also missing:

- Old hash → new category table (`#export`, `#model` after voice split, any in-page anchors)
- Whether inner `SettingsSection` accordions remain inside a category or become headings (`userOpenSections formerly persisted` is otherwise undefined)
- Deep-link behavior rewrite: “add target to **open set**” is accordion language. Single current page needs **set current category + still mount others**, and a rule for stale persisted open-sets

Without this, “logical settings” is implementer taste. That is how fields land on the wrong page.

---

## P1 — a11y of the new primary nav is unspecified

The IA change **is** the a11y surface. Packet only says 宽屏左导航、窄屏紧凑分类选择.

Not specified:

- Control: tabs vs listbox vs native `<select>` vs radio group (320/390 cannot be a left rail)
- `aria-current` / selected
- Keyboard: Tab to nav vs arrow between categories
- On change: focus to the page `h1` or leave focus on the selector
- One heading per category page (today’s shell is a **button**, not a heading)
- Short screen: sticky save vs scroll; 常驻 bar vs 40px row + content
- 320: no horizontal overflow — nav labels are long (密钥与环境, 模型与推理); truncation / wrapping / compact names missing

“废除 CSS order” is a requirement with **no target DOM** for summoner actions (attach / dictation / send / meeting / browser). Cannot review reading order vs visual order from this packet.

Included `SettingsSection` (if reused inside pages):

- Toggle has `aria-expanded` but **no `aria-controls`**; panel has **no `id` / `role="region"`**
- `aria-hidden={!open}` + `display:none` is OK; `aria-hidden` on a container that still has focusable descendants is a footgun if display ever changes
- `forceHint` is not a live region

Those are fixable nits **if** accordion survives. They do not replace a spec for category nav.

---

## P1 — summoner/chat consistency has no contract

Isolated summon **HTML** cannot share React `tokens` (the included file imports `../ui/tokens`). Packet asserts 同一套浅色、文字层级、圆角输入区、底部操作排布 and does not define:

- Shared CSS variables / type ramp / radius / control height / muted text
- Empty-state **copy** (“一句提示”)
- What “次要” means for 会议 / 打开浏览器 (text link, quieter button, overflow — overflow hides confirmation-adjacent actions)
- Header after 山 is gone (title? nothing?)
- Other 山 surfaces: loading, error, idle-after-delete-thread (only 页头 / 初始 / 动态空态 named)

Verification “山不会恢复” under isolated transport is necessary and still not a visual spec. This is the exact failure mode the user already rejected.

---

## P2 — nits (would not reject alone)

- Persist last category vs ignore `userOpenSections` — first-load surprise.
- `data-settings-section={title}` keys a11y/tests on **localized title**; brittle if titles change with IA.
- Badge slot has no name/politeness when used for armed trust.
- Independent settings **page** vs in-panel 320: same IA or two shells — only “独立设置网页也改浅色” is written.
- “无发布安装” is process, not product; fine.

---

## Completeness checklist (packet vs needed)

| Required to implement | In packet? |
|----------------------|------------|
| No 山 + no hero replacement | Yes |
| Chat-aligned visual **system** (tokens/CSS for React **and** isolated HTML) | No |
| Empty-state sentence | No copy |
| Action row DOM (primary vs secondary) | Intent only |
| 8 categories | Names only |
| Field move list + voice setter list | No |
| ID/hash map including `integrations` ↔ 本机与工具, `export` label | Partial |
| Keep mounted / don’t drop confirm phrase / download | Yes (behavior) |
| Cross-category pairing / high-privilege **UI** | Requirement only |
| Single save chrome vs existing handlers | Contradictory |
| Narrow nav + keyboard + headings | No |
| Viewport matrix | Yes (as test list) |

---

## What APPROVE would need (minimal addendum)

1. **Trust strip:** component, 320/1440 layout, copy, click → category, live-region/focus when status changes off-page, pending confirm still reachable.
2. **Save table:** every control class × chrome × hidden-page dirty state.
3. **IA table:** display name, stable id, old hashes, every field/setter that moves (especially voice + integrations). Accordion: keep vs replace; `userOpenSections` migration.
4. **Nav a11y:** control pattern per breakpoint, keyboard, `aria-current`, focus on change, page heading, short-screen sticky bar. Summoner action **DOM order** (not CSS `order`).
5. **Visual contract:** tokens/CSS variables shared with isolated HTML; empty-state sentence; secondary-action treatment; 山 inventory including load/error.

Until those five exist, implementation will invent UI. That is out of bounds for this gate.

**VERDICT: REJECT**
