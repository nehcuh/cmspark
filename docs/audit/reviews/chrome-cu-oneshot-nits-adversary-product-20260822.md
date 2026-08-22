# Adversary review (Product / prompt / docs lock) — Chrome CU one-shot nits fold

**Batch**: `chrome-cu-oneshot-nits-20260822`
**Role**: independent Product adversary (did **not** implement; did **not** write the fold)
**Lane**: prompt coherence / catalog / user-guide / Rule 7–9c vs 12 / ADR-017 D3 / ADR-021 · GOAL · architecture
**Worktree**: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` **HEAD `f4a743e`** (`f4a743e78ac0f5b510f5210cf9c11e12698db7e3`)
**Nits fold**: `9a2a0f3..f4a743e` (`fix(computer): fold Chrome CU one-shot residual nits`)
**Prior dual**: `chrome-cu-oneshot-claude-20260822.md` residual 1–5, 7
**Prior this lane**: `chrome-cu-oneshot-adversary-product-20260822.md` (N3/N5/N6 on `85cd7a5`)

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / cruise / G1;
              does NOT persist Apps coordinateAllowed; LOLBIN/PM/terminal/wallet STRUCTURAL
Channel:      community
```

This lane does **not** re-litigate skip algebra or persist-deny (Trust/Runtime). It asks: after the fold, do catalog / rules / user-guide / ADRs still *teach* persist-required or unattended-skip-for-browsers, and will the model still refuse Chrome CU or fire it on the first `CDP_ATTACH_FAILED`?

---

## Machine (this worktree) `[executed]`

| Command | Result |
|---------|--------|
| `git rev-parse HEAD` | `f4a743e78ac0f5b510f5210cf9c11e12698db7e3` |
| `tsx --test tests/web-act-loop-wave1.test.ts tests/tool-schemas.test.ts` | **57 pass / 0 fail** (includes catalog one-shot lock + WAVE-1 Rule 12/7/12b source lock) |
| Catalog dump via `tool-definitions-catalog.json` | `one-shot L2 confirm` **true**; old `AND explicitly opted into coordinate control` **false**; app desc `with coordinateAllowed=true` **false** |

`getToolDefinitions()` is a passthrough of that JSON (`tool-definitions.ts:117-121` filters only `osascript_eval` off non-darwin). WAVE-1 `tool("host_computer","darwin")` hits the **runtime** card, not the file in isolation. `[executed]`

---

## Must-falsify scorecard (spawn claims vs tree)

The spawn asked to **falsify** six “still broken” statements. A claim is **FALSIFIED** if the fold actually removed it; **HOLDS** if it is still true.

| # | Claim to falsify | Result | Why |
|---|------------------|--------|-----|
| 1 | Catalog `host_computer` **long description still requires persist `coordinateAllowed`** (JSON **and** `getToolDefinitions()`) | **FALSIFIED** | Runtime card no longer says “AND explicitly opted into coordinate control”. Browsers = one-shot L2 that 无人值守/三旗/G1 will **NOT** skip. `[executed]` WAVE-1 + dump |
| 2 | User-guide **checklist** still requires 浏览器「允许坐标」 | **FALSIFIED** | Checklist `:64` now: 原生 App 须已开「允许坐标」; **浏览器不能开该开关**, 走一次性确认. `[inspected]` |
| 3 | Rule 7 / 8 / 9c still **contradict** Rule 12; WAVE-1 source lock still **allows** the contradiction | **HOLDS (weaker form)** | 7/8/9c no longer say NEVER `host_computer`. They now MAY after freeze/cap / 模拟点击. **New** contradiction: 7/8 wait for a **phantom** `TAB_ATTACH_FROZEN` that no tool ever returns; 12 uses prose “CDP attach freeze”; first `CDP_ATTACH_FAILED` still looks like freeze. WAVE-1 **replaced** the old NEVER-retry lock and does **not** pin real error codes. `[executed]` grep + WAVE-1 |
| 4 | ADR-017 **D3** still says 三旗 can waive host initial L2 with **no** vault-browser exception | **FALSIFIED** | D3 now: waive **非浏览器** host initial; **vault-browser one-shot（D2）永不 waive**. `[inspected]` `:25-26` |
| 5 | ADR-021 / GOAL.md / architecture.md still teach unattended skip **for browsers** | **PARTIALLY HOLDS** | GOAL `:70` and architecture **9.1** table `:689` now except browsers. ADR-021 **§2** skip bullet excepts one-shot. **ADR-021 §4 re-L2** still “值守时 `executor.reL2` **全部静默通过**” with **no** vault-browser exception. Architecture **9.3** still “Vault/**浏览器**/终端等 **结构排除** 坐标” (reads as CU impossible). `[inspected]` |
| 6 | Model will still **never** call `host_computer` after freeze **OR** will call it on **first** `CDP_ATTACH_FAILED` (too early) | **HOLDS as trajectory** | Explicit「模拟点击」is now licensed by 7 **and** 12 — e87i9z utterance path is open. Freeze-recovery is still starved (`TAB_ATTACH_FROZEN` never appears). First `CDP_ATTACH_FAILED` is still easy to misread as “attach freeze”. WAVE-1 would stay green either way. `[inspected]` + `[executed]` grep |

**DoD 1 (Claude residuals 1–5, 7 actually gone?):** 1 (G1 checkbox), 2 (waived log), 4 (catalog/checklist), 7 (HOST_CHROME / Canary / chromium / notepad — claimed in this fold; not re-executed here) **look gone in tree**. Residual **3** is not gone (phantom code). Residual **5** is mostly gone, leftover ADR-021 §4 / architecture 9.3. Product does not treat leftover skip-*sentences* as a live skip path (Trust belts still hold).

---

## 1. Findings

### PASS P1 — Catalog + runtime tool card no longer demand persist `coordinateAllowed`

**Claim 1 is dead in this tree.** `[executed]`

`tool-definitions-catalog.json:1392` (and `getToolDefinitions()`):

> Native apps also need `AppEntry.coordinateAllowed`. Browsers (Chrome/Safari/Edge/…) cannot persist that bit — they take a **one-shot L2 confirm** that 无人值守 / 三旗 / G1 will **NOT** skip. … dialog is **ALWAYS** shown for browser one-shot (god-mode / auto-approve / unattended do NOT skip it) … native `coordinateAllowed` apps may skip only via G1 or an armed unattended grant.

`app` param `:1402`: same one-shot / will-not-skip language. Old `with coordinateAllowed=true` is gone. WAVE-1 pins `one-shot L2 confirm` + `will NOT skip` + absence of `AND explicitly opted into coordinate control`.

A model that **obeys the tool card** can now call Chrome without the bit. That was Product N3 / Claude residual 4. Fold landed.

Residual inside the card (non-blocking): the parenthetical “god-mode / auto-approve / unattended” omits 三旗, which the previous sentence already named. Not a persist requirement.

### PASS P2 — Checklist no longer requires 浏览器「允许坐标」

**Claim 2 is dead.** `[inspected]` `docs/computer-use-user-guide.md:64`

> 目标 App 已加白名单；**原生 App** 须已开「允许坐标」。**浏览器**不能开该开关，走 `host_computer` 一次性确认（确认台必须点允许）

§3 item 3 (`:50`) and item 4 (`:52`) already had the exception before this fold; the checklist was the one a human would actually follow. Fold landed.

### NIT N1 — Rule 7/8 invented `TAB_ATTACH_FROZEN`; no tool ever returns it (claim 3 + 6)

**This is the fold’s new product hole, not a leftover.** `[executed]` repo-wide grep: `TAB_ATTACH_FROZEN` occurs **only** in `adapter.ts:478` and `:482`.

Real typed codes the model actually sees `[inspected]` `dom-script-budget.ts:88,147,150`, WAVE-1 classify list:

| Code the runtime emits | In Rule 7/8? |
|------------------------|--------------|
| `CDP_ATTACH_FAILED` | yes — “list_tabs / stop; **NOT** a substitute for a missed debugger” |
| `DOM_SCRIPT_VOLUME_CAPPED` | Rule 7 says “DOM-script **volume** cap”; Rule 8 says “DOM-script cap” (no code) |
| `DOM_SCRIPT_LOOP_CAPPED` | **not named** |
| `TAB_ATTACH_FROZEN` | **named, does not exist** |

Rule 12 (`:440/:449`) still uses **prose** “After **CDP attach freeze** / DOM-script cap” — no code at all.

**Trajectory if the model is literal:** it waits for `TAB_ATTACH_FROZEN` after attach trouble, never sees it, **never** CU-after-freeze. That is claim 6 left tail, and it is **introduced by this fold** (the previous NEVER-retry was at least internally consistent).

**Trajectory if the model is sloppy:** “CDP attach freeze” ≈ first `CDP_ATTACH_FAILED` → CU **too early**, before `list_tabs` / darwin `osascript_eval`. Rule 7’s “NOT a substitute for a missed debugger” fights Rule 12’s freeze prose **in the same prompt**. That is claim 6 right tail.

WAVE-1 (`web-act-loop-wave1.test.ts:88-96`) `[executed]` now locks:

- `NEVER default to host_computer for browser-DOM`
- `do NOT retry via evaluate (same debugger)`
- `host_computer is NOT a substitute for a missed debugger`
- `ALWAYS pops a confirm`
- `Do NOT use 9b/9c as the default way…`
- Linux NEVER

It does **not** lock `CDP_ATTACH_FAILED` ≠ freeze. It does **not** lock `DOM_SCRIPT_VOLUME_CAPPED` / `LOOP_CAPPED` as the cap trigger. It **used to** lock `do NOT retry via evaluate or host_computer` — that lock was **weakened on purpose**, and the replacement does not pin the error-code boundary. Claim 3 “WAVE-1 still allows the contradiction” **holds**.

Rule 9c (`:488`) is actually aligned: “Do NOT use 9b/9c as the **default** … After freeze/cap or explicit 模拟点击, MAY”. No longer NEVER. Not the problem.

### NIT N2 — Win32 Rule 8 says **stop** on `CDP_ATTACH_FAILED`, then MAY CU after a phantom freeze (same paragraph)

`adapter.ts:482` (non-darwin) `[inspected]`:

> If click/evaluate returns `CDP_ATTACH_FAILED`, **stop or list_tabs** — there is no third JS injection path. After `TAB_ATTACH_FROZEN` / DOM-script cap or an explicit user 模拟点击, `host_computer` … is Rule 12.

That is a stop-then-MAY in one rule. Darwin Rule 8 (`:481`) is cleaner: osascript last-resort after CDP+scripting fail, then CU after freeze/cap or 模拟点击. Win32 has no osascript, so the first attach miss is the only signal — and the rule both forbids treating it as CU **and** names a non-existent later signal.

### NIT N3 — Win32 Rule 12 still does not **list** `host_computer` as a tool; app index still says launch-only

`adapter.ts:428-441` `[inspected]`: win32 Rule 12 bullets are `host_read` / `host_write` / `host_app` / `host_cli`. `host_computer` appears only in the NEVER-default / MAY paragraph. Darwin (`:446`) has a dedicated LAST-RESORT `host_computer` bullet.

`buildAppIndexSection` (`:313`): every GUI token is tagged **`[launch only, no args]`**. Rule 12 still says “NEVER guess tokens” then “MAY call host_computer on **the Chrome app token**”. Catalog now says the token works without the bit. The index still teaches launch-only.

For **explicit 模拟点击** this is training friction, not a forbid (7 and 12 both MAY; catalog is the tool card). For freeze-recovery on **Windows**, combined with N1/N2, the model has no tool bullet, a phantom freeze code, and a launch-only index. That is how e87i9z-class **omission** survives after catalog is fixed.

### NIT N4 — ADR-021 §4 / §6 still teach unattended **all** re-L2 silent (claim 5 leftover)

**§2 is fixed** (`021-unattended-desktop-session.md:47`) `[inspected]`:

> 该次任务 App **实时** `coordinateAllowed`（**vault-browser one-shot 永不 skip** — 浏览器不能持有该 bit，确认台必须弹出）

**§4 is not** (`:57-64`):

> 值守 `isUnattendedArmed()` 时，`executor.reL2` **全部静默通过**（含原 `PROMPT_ALWAYS_TAGS` …）。审计：`reason_skip: unattended_session_grant`。

No vault-browser sentence. A maintainer “syncing executor to ADR-021 §4” would delete `&& !vaultBrowserOneShot` on re-L2 and **re-open mid-task silent Chrome inject**. That is the exact “docs teach skip” failure mode the prior product review named. The fold patched the **initial-L2** bullet and left the **re-L2 SoT**.

**§6 table** (`:75-81`) still says the grant “可跳 initial **与** mid-task re-L2” with no exception — historical “修订既有 ADR 措辞” row, still a skip-teaching surface.

This is **not** a live skip today (executor guards are out of this lane). It **is** a docs lock miss against claim 5.

### NIT N5 — User-guide skip tables / §1 / §3.5 still omit the browser exception in the generic sentences

Checklist is fixed (P2). Remaining teaching surfaces `[inspected]`:

| Surface | Says | vs one-shot |
|---------|------|-------------|
| §1 Trust table `:15` | session-trust 有条件抑后续 initial L2（§5） | no browser exception |
| §1 body `:23` | 勾选 session-trust 且条件满足，**后续任务**初始 L2 可能被静默跳过 | Chrome one-shot never |
| §2 `:31` | 浏览器内 → L1 CDP，**不必**上 Computer Use | correct as **default**; no pointer to Rule 12 模拟点击 |
| §3 item 5 `:56-57` | G1 可 skip；无人值守对 **已开坐标的白名单 App** 静默 | browsers cannot hold the bit, so 值守 sentence is technically true; G1 sentence is not |
| §5 intro `:85-96` | G1 可 skip 后续 initial L2 | no exception |
| §5.1 table `:106` + 启用前 `:113` | **浏览器 one-shot 永不 skip** | **matches** |

A user who stops at §1 / §5 intro still thinks Chrome session-trust will silence the next task. Fold hid the G1 checkbox (`hostComputerConfirmRelevantApps` → `[]`, `l2-admission.ts:131-136,:1314-1315`) so the UI no longer *offers* that lie. Docs §1/§5 still *tell* it.

### NIT N6 — architecture 9.3 still “结构排除” browsers; 9.1 is updated

`architecture.md:689` (9.1) `[inspected]`: 浏览器走一次性 L2（值守/三旗/G1 永不 skip）. **Matches.**

`architecture.md:706` (9.3 关键不变量):

> Vault/**浏览器**/终端等 **结构排除** 坐标。

That sentence still reads “browsers cannot coordinate”, i.e. the **pre-fold** A10.3 story. A later patcher treating 9.3 as the invariant list could “fix” one-shot as a bug. GOAL.md `:70` **was** updated and does not have this leftover. `[inspected]`

ADR-017 D3 (`:25-26`) **was** updated (claim 4 dead). Consequences `:40` still “双开关 + 任务级 L2（… G1 / ADR-021 值守条件放宽）” without naming the browser floor — weaker leftover.

---

## 2. Attack questions (this fold)

### Q1. Does the catalog still stop the model from calling Chrome (e87i9z omission)?

**No, not via persist-required.** `[executed]` P1.

The remaining omission channels are prompt, not catalog: phantom `TAB_ATTACH_FROZEN` (N1), win32 Rule 12 with no `host_computer` bullet (N3), app index launch-only (N3). **Explicit 模拟点击** is licensed in Rule 7 **and** 12. That is the incident lock; the fold opened it.

### Q2. Do user-facing docs still require 浏览器「允许坐标」?

**Checklist: no.** §3.3/§3.4 already excepted. §1/§5 generic skip copy still implies Chrome G1 skip (N5) — UX dishonesty, not a setup blocker.

### Q3. Will the model CU on first `CDP_ATTACH_FAILED`, or never after freeze?

**Both remain possible; WAVE-1 cannot fail either.** `[executed]` N1/N2.

- Literal: wait for `TAB_ATTACH_FROZEN` → never.
- Fuzzy: “CDP attach freeze” = first `CDP_ATTACH_FAILED` → too early.
- Cap path: `DOM_SCRIPT_VOLUME_CAPPED` is the closest real code to Rule 7’s “volume cap”; `LOOP_CAPPED` is unnamed. Unlocked.

**Explicit 模拟点击** does not wait for freeze. Product lock for e87i9z holds **if** the model reads the MAY clause.

Darwin: Rule 8 still wants osascript after CDP+scripting fail **before** freeze-CU, except explicit 模拟点击. That order is now stated. Win32 has no third JS path, so the phantom freeze is load-bearing — and missing.

### Q4. Can a maintainer re-open unattended skip from docs alone?

**Initial L2: no**, if they read D2/D3/ADR-021 §2/GOAL/architecture 9.1.

**Mid-task re-L2: yes**, if they read ADR-021 §4 as SoT (N4) and “fix” executor to match “全部静默通过”. That is the only remaining **skip-teaching** SoT on the Trust T3 path. Not a live hole in this tree.

### Q5. Did WAVE-1 stop being a CDP-first lock?

**It stopped being a NEVER-CU lock. It is still a NEVER-default lock.** `[executed]`

Old: `do NOT retry via evaluate or host_computer`.
New: evaluate never; CU not a missed-debugger substitute; ALWAYS confirm; NEVER default.

That is an honest test change for Rule 12. It is **not** proof of CDP-first-then-cap. Claim 3 stands as “lock allows the remaining contradiction”, not as “lock still forbids Rule 12”.

---

## 3. Claude 20260822 residuals vs this tree (product-visible)

| Claude residual | Fold? | Product view at `f4a743e` |
|-----------------|-------|---------------------------|
| 1 G1 checkbox still offered | **yes** | `hostComputerConfirmRelevantApps(true) → []` (`l2-admission.ts:131-136,:1314`). Prior Product N1. Out of prompt-coherence except docs §1 still describing the checkbox (`:92`). |
| 2 `critical_api_waived` for Chrome | **yes** | `:909` `&& !vaultBrowserOneShot`. Log nit closed. `[inspected]` |
| 3 Rules 7/8/9c vs 12 | **attempted** | 9c aligned. 7/8 MAY + phantom `TAB_ATTACH_FROZEN`. **Not gone.** N1/N2. |
| 4 Catalog + checklist | **yes** | P1/P2. |
| 5 ADR-017 D3 / GOAL / architecture | **mostly** | D3 + GOAL + 9.1 done. 9.3 + ADR-021 §4 leftover. N4/N6. |
| 7 HOST_CHROME / Canary / chromium / notepad | **claimed in fold** | Out of this lane’s execution; patch + tests exist. Product catalog already says Edge/Brave/Chrome. |

Explicitly out of fold (still true, not scored): compact Side Panel `MinimalConfirm` never renders preview.

---

## 4. DoD scorecard (this lane)

| # | Observable | Result | Evidence |
|---|------------|--------|----------|
| 1 | Named residuals 1–5, 7 gone in tree | **PASS\* ** | 1,2,4,7 look gone. \*3 not gone (N1). \*5 leftover N4/N6 |
| 2 | Unattended cannot skip Chrome one-shot L2 | **n/a this lane** (Trust); docs §2/D3/GOAL no longer teach it for **initial** |
| 3 | Persist bit denied on Canary / chromium.exe | **n/a this lane**; catalog does not mention Canary by name (Edge/Brave yes) |
| 4 | powershell / 1Password still STRUCTURAL | **n/a this lane**; catalog still lists PM/terminal/LOLBIN as hard boundaries |
| 5 | WAVE-1 still NEVER **default** host_computer for DOM | **PASS** `[executed]` source lock |
| 6 | No **new skip/persist** hole from the fold | **PASS** for skip/persist. **New prompt hole:** `TAB_ATTACH_FROZEN` (N1) — freeze-recovery starvation, not a silent inject |

ADR-020: T3 Trust, L2 class reused, no new confirm dialect, no new runtime. Trust monotonicity for browsers is **stricter** than Notepad. Axes fit. Anti-patterns 1–4 absent.

---

## 5. Outcome / trajectory / component

**Outcome (e87i9z user says「模拟点击」):** catalog no longer forbids the call; Rule 7 and Rule 12 both MAY; ALWAYS confirm. The STRUCTURAL-deny-before-dialog product failure is **not** re-opened by prompt/docs. Setup checklist no longer tells the human to flip a switch Chrome cannot have.

**Outcome (CDP freeze / volume cap, no 模拟点击):** model is **not** reliably trained to CU. It is trained to wait for `TAB_ATTACH_FROZEN` (never emitted) or to treat first `CDP_ATTACH_FAILED` as freeze (too early). WAVE-1 cannot catch either. This is **prompt quality**, not a skip hole.

**Trajectory:** the nits fold did the named catalog / checklist / D3 / GOAL / 9.1 / Rule-12-cross-ref work. It **also** minted a fake error code and left ADR-021 §4 as a skip-teaching SoT for re-L2. Do not treat “Rules 7/8/9c updated” as CDP-first locked.

**Component hotspots**

- `companion/src/bridge/tool-definitions-catalog.json:1392,:1402` — **fixed** (P1)
- `companion/src/bridge/tool-definitions.ts:117-121` — passthrough; runtime = catalog
- `companion/src/llm/adapter.ts:313` — app index launch-only (N3)
- `companion/src/llm/adapter.ts:428-441` — win32 Rule 12 no `host_computer` bullet (N3)
- `companion/src/llm/adapter.ts:440,:449,:463` — Rule 12/12b MAY + prose “CDP attach freeze”
- `companion/src/llm/adapter.ts:478,:482` — Rule 7/8 **`TAB_ATTACH_FROZEN` phantom** (N1/N2)
- `companion/src/llm/adapter.ts:488` — Rule 9c aligned
- `companion/tests/web-act-loop-wave1.test.ts:80-96` — catalog + NEVER-default lock; **no** real freeze code
- `docs/computer-use-user-guide.md:64` — **fixed**; `:15,:23,:56,:85` leftover skip copy (N5)
- `docs/adr/017-computer-use.md:25-26` — **fixed**
- `docs/adr/021-unattended-desktop-session.md:47` — **fixed**; `:57-64,:77` leftover (N4)
- `docs/GOAL.md:70` — **fixed**
- `docs/architecture.md:689` — **fixed**; `:706` leftover 结构排除 (N6)

---

## 6. Residual (owned, non-blocking)

1. **Replace `TAB_ATTACH_FROZEN` with real codes** (`CDP_ATTACH_FAILED` = list_tabs, **not** CU; `DOM_SCRIPT_VOLUME_CAPPED` / `LOOP_CAPPED` = MAY CU + confirm). Pin that split in WAVE-1. Until then claim 6 holds as trajectory. (N1/N2)
2. **Win32 Rule 12**: add a `host_computer` bullet matching darwin LAST-RESORT + browser one-shot. Drop or qualify `[launch only, no args]` when the same token is the CU app. (N3)
3. **ADR-021 §4 / §6**: one sentence “vault-browser one-shot never silent on re-L2”. Same class of miss as pre-fold D3. (N4)
4. **User-guide §1 / §3.5 / §5 intro** and **architecture 9.3**: either except browsers or stop saying 结构排除 坐标 for 浏览器. (N5/N6)
5. Pre-existing, out of fold: compact Allow without preview; Chrome-as-CU-host self-UI.

None of these silence the Chrome one-shot dialog or persist `coordinateAllowed`. None re-open unattended **initial** L2 skip. They can still starve freeze-recovery or CU-too-early, which is why this is not a clean APPROVE.

**Merge bar from this lane:** N1 (phantom code + WAVE-1 pin) is the only item I would still want in-tree before calling prompt-lock **done**. N3–N6 are docs/training nits.

---

VERDICT: APPROVE_WITH_NITS
