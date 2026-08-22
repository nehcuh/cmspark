# Adversary review (Product / UX / e87i9z) — Chrome vault-browser one-shot L2

**Batch**: `chrome-cu-oneshot-20260822`  
**Role**: independent Product / UX skeptic (did **not** implement)  
**Lane**: e87i9z replay — user says「模拟点击」; must get a **confirm dialog**, not STRUCTURAL deny; unattended must **not** silently inject Chrome.  
**Diff**: `docs/audit/reviews/chrome-cu-oneshot-diff-20260822.patch`  
**Worktree**: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` (`85cd7a5`) vs `origin/main` (`56a5973`)  
**Blast (claimed)**: T3 Trust. One-shot `host_computer` L2 for vault browsers; persistent `coordinateAllowed` stays false.

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / 三旗 cruise / G1 session-trust;
              does NOT persist Apps coordinateAllowed; LOLBIN/password-manager/terminal/wallet still STRUCTURAL
Channel:      community
```

Do **not** treat “Rule 12 now says MAY call Chrome” as proof the user sees a popup. The incident is **STRUCTURAL deny before any dialog**, plus the owner lock: **popup; user must click 允许; unattended must not silence**.

---

## Machine (this worktree) `[executed]`

- `tsc -p tsconfig.test.json`: **ok**
- `node --test` computer-policy + l2-admission-pure + web-act-loop-wave1: **54 pass / 0 fail**
- `buildComputerL2Preview` + Cockpit 1200-char slice (node, compiled `.test-dist`)

---

## 1. Findings

Skip algebra for vault-browser **initial L2** and **mid-task re-L2** is real in the three code belts (policy / l2-admission / executor). e87i9z **STRUCTURAL** is gone **if** that call previously made it to `assertCoordinateAllowed`. Residual product holes below; none silently inject Chrome **today** if the `vaultBrowserOneShot` reset stays. Several of them **teach the user or a later patch** that skip is allowed.

### NIT N1 — Cockpit session-trust checkbox is still offered, **default ON**, for Chrome one-shot

**Claim to falsify**: “无人值守 / 三旗 / 会话信任都不会跳过” is what the human sees and what Allow records.

**What the code actually does** `[inspected]`

- `l2-admission.ts:1299-1302` still sets `relevantApps: [chromeToken]` for every `host_computer`.
- Cockpit `ConfirmElevated` (`CockpitApp.tsx:420-425`, `:565-573`): `canOfferComputerSessionTrust("host_computer", token)` is **true for any app token**; `sessionTrust` state **defaults to that true**.
- Hint copy (`apps-utils.ts:88-90`): **「默认勾选：本对话内同类操作少问」**.

The skip is then **cleared** (`l2-admission.ts:679-683`) so the next Chrome task still prompts. Safety holds. The **UI lies**: the user is invited to grant a skip this path promises never to honor. Default-on is the wrong polarity for a one-shot that exists *because* G1 must not apply.

Product: hide the checkbox (or force it off + different hint) when `vaultBrowserOneShot`. Leaving default-on is how a later “checkbox is broken” fix re-introduces silent Chrome inject.

### NIT N2 — Warning banner is last in `extraLines`; Cockpit still slices 1200; Side Panel Allow shows none of it

**Claim to falsify**: LLM `task` text cannot hide or spoof the 「必须你点允许」 line.

See Q4. Short e87i9z tasks show the banner. A 1200-char padded `task` (schema allows **4000**) drops it from the only surface that renders preview. Compact `MinimalConfirm` never renders preview at all, and **允许 is one click**.

### NIT N3 — Catalog + user-guide checklist still describe the *old* dual-switch

`tool-definitions-catalog.json:1392` / `:1402` still require `AppEntry.coordinateAllowed` and “every task asks”. User guide §3 item 3 **and** the checklist still require 「已开允许坐标」 (`computer-use-user-guide.md:50`, `:64`). One-shot **skips the bit** (`policy.ts:173-176`). Chrome **cannot** open that bit on Windows (`handlers.ts:448-455`).

A model that obeys the catalog will **not** call Chrome (stuck in e87i9z). A human following the checklist cannot complete setup for Chrome. Rule 12 was updated; the tool card and the checklist were not.

### NIT N4 — Unattended evaluator is told `coordinateAllowed: true` for browsers

`l2-admission.ts:596-603` / `:651-658` call `evaluateUnattendedHostComputerSkipDetail({ coordinateAllowed: true, ... })` after one-shot `assertCoordinateAllowed` — the bit on the entry is still **false**. Skip is then forcibly cleared.

Belt: the reset. Suspender cut: if the reset is deleted, ADR-021’s real `coordinateAllowed` check would **not** save you, because the call site already lied. Pass `entryC.coordinateAllowed === true` (false for browsers).

Same shape for G1: `g1InitialSkipEligible` does not care about vault browsers; skip is set then cleared.

### NIT N5 — Rule 7 / 8 / 9c still forbid what Rule 12 now permits

WAVE-1 source lock was **weakened** to `NEVER default` + `ALWAYS pops a confirm` (`web-act-loop-wave1.test.ts:80-86`). Rules 7, 8 (win32), 9c still say do **not** use `host_computer` for browser-DOM / CDP_ATTACH_FAILED. See Q3.

### NIT N6 — Docs skip-path sections were not updated (only the structural-exclusion bullets)

ADR-017 D2 and user-guide §3.4 mention the one-shot. ADR-017 D3, D4, ADR-021, user-guide §3.5 / §5 / §5.1, `docs/GOAL.md`, `docs/architecture.md` still describe unattended / G1 skip **without** a browser exception. See Q5.

### NIT N7 — macOS `apps.set_coordinate_allowed` still does not STRUCTURAL-deny bundleId Chrome

DoD #2: “Chrome `coordinateAllowed` cannot be persisted.” Windows exe path: **yes** (`apps-coordinate.test.ts` chrome exe). macOS enumerate entries are **bundleId, often no `exe.path`**. Handler (`handlers.ts:448`) and `normalizeAppEntry` (`types.ts:295-303`) only inspect `entry.exe?.path`. Chrome.app can persist the bit after biometric. Injection still needs one-shot (`canEverCoordinate` false on `com.google.Chrome`), so this is not silent inject **today**. It is a loaded gun next to N4.

### NIT N8 — `security.critical_api_waived` still logs for cruise + Chrome one-shot

`l2-admission.ts:894-901` does not except `vaultBrowserOneShot` / `acpForceConfirm`-style. `forceConfirm` stays true, but the audit line says waived. Operator reading logs will believe 三旗 silenced Chrome.

---

## 2. Attack questions

### Q1. Would e87i9z after user says「模拟点击」reach a confirm dialog instead of STRUCTURAL deny?

**Yes — on the exact STRUCTURAL path. Not on every “模拟点击” utterance.**

`assertCoordinateAllowed` order (`policy.ts:137-188`) `[inspected]`:

| # | Fail | e87i9z STRUCTURAL? |
|---|------|---------------------|
| 1 | bad token / apps off / unknown / disabled / not gui | `APP_NOT_WHITELISTED` — never STRUCTURAL |
| 2 | `computer.coordinateEnabled !== true` (default **false**) | `COMPUTER_DISABLED` — never STRUCTURAL |
| 3 | vault/LOLBIN and not one-shot | **`APP_COORDINATE_STRUCTURAL`** |
| 4 | `coordinateAllowed !== true` | `APP_COORDINATE_DENIED` — Chrome never got here (`canEverCoordinate` already false) |

To have seen **STRUCTURAL**, e87i9z already had: global CU on, Apps on, Chrome (or Safari/…) as an enabled GUI whitelist entry, and the model actually called `host_computer` with that token. One-shot is wired on **both** belts with `allowVaultBrowserOneShot: true` (`l2-admission.ts:499-502`, `executor.ts:454-455`). Chrome then **returns the entry** without the bit (`policy.ts:173-176`). `[executed]` tests: chrome exe + mac `com.google.Chrome` one-shot; powershell still STRUCTURAL.

After that, dialog vs skip:

```
mustInteract = (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip
```

- `vaultBrowserOneShot && hostComputerGated` → `resolveL2ForceConfirm` **true** even under 三旗 (`l2-admission.ts:91`, `[executed]` pure test).
- `hostComputerTrustSkip` is set by G1 / unattended then **unconditionally cleared** for vault browsers (`:679-683`).
- `enterpriseSkip` is shell/netsec only.

So: **confirm is requested**. Fail-fast before dialog still exists (busy / rate-limit) — not STRUCTURAL, not a popup.

**What would still starve the popup for a looser “user typed 模拟点击” reading**

1. Chrome not in Apps → `APP_NOT_WHITELISTED` (typical CDP-only user). **Not e87i9z-STRUCTURAL.**
2. Catalog still says `coordinateAllowed=true` (`tool-definitions-catalog.json:1402`) vs Rule 12 MAY Chrome. Model may refuse to call (N3).
3. Rule 7/8/9c vs Rule 12 (N5) — model may `list_tabs` and stop.
4. Linux Rule 12 still NEVER (correct).

**Answer:** the STRUCTURAL e87i9z sequence does **not** survive this diff; it becomes a confirm. A cold user with CU off still gets an error, not a dialog. That is fail-closed, not the owner’s “popup then inject” story for first-time 模拟点击.

### Q2. Would unattended still *silently* inject Chrome (user said they want a popup)?

**No for initial L2 and mid-task re-L2 on a vault-browser entry — if `isVaultBrowserEntry` is true.** Not because unattended “doesn’t apply”; because skip is computed as if it did, then ripped out.

**Initial L2** `[inspected]`

- ADR-021 skip wants **real** `coordinateAllowed` (`unattended-grant.ts:372`, `:415-417`).
- Call site passes **`coordinateAllowed: true`** anyway (N4).
- Then `:679-683` forces `hostComputerTrustSkip = false`.
- `forceConfirm` stays true under cruise (Q1).
- God-mode / `auto_approve_dangerous` / `allow_all_schemes` / thread-trust only set `skipConfirmation`; `forceConfirm` overrides (`:961`).

**Mid-task re-L2** `[inspected]` `executor.ts:650-708`

| Skip | Vault-browser |
|------|----------------|
| `isUnattendedArmed()` | **blocked** by `&& !vaultBrowserOneShot` |
| 三旗 cruise (non-PROMPT_ALWAYS) | **blocked** by `&& !vaultBrowserOneShot` |
| G1 `isTrusted` | **blocked** by `&& !vaultBrowserOneShot` |

PROMPT_ALWAYS tags (danger / experimental / foreground) already re-prompt without unattended; with unattended they would have been silenced — **not** for vault browser.

**Silent inject that is *not* “unattended skip” (owned residual)**

- Compact Side Panel **允许** with no preview (N2). That is a popup, but not an *informed* one. Owner asked for a popup; they get one. Cockpit is auto-focused (`background/index.ts:415-424`) — good — but FocusBand Allow still works without reading it.
- Chrome Canary / Dev (`com.google.Chrome.canary`) is in `self-ui.ts` companion-host list and **not** in `MAC_BROWSER_VAULT_BUNDLE_IDS`. `canEverCoordinate` is **true**. One-shot flag never attaches. Persistent bit + unattended **can** silently inject Canary `[inspected]`. Pre-existing hole; this patch did not close it. e87i9z stable Chrome is not this.
- `chromium.exe` on Windows is not in `BASENAME_TO_VAULT_TOKEN` (only `chrome`). Same class of hole, pre-existing.

**Answer:** armed 无人值守 does **not** silence Chrome **stable** one-shot L2/re-L2 in this tree. The evaluator lie (N4) + default-on trust checkbox (N1) are how silence comes back.

### Q3. Does Rule 12 now tell the model to CU Chrome too early (before CDP/osascript)?

**Yes, on an explicit「模拟点击」; maybe, on first CDP failure.**

Rule 12 win32 + darwin (`adapter.ts:440`, `:449`) `[inspected]`:

> NEVER default to host_computer for browser-DOM — use get_page_text / click({text}) / type / evaluate **first**. After CDP attach freeze / DOM-script cap, **OR when the user explicitly asks for 模拟点击/像素点击**, you MAY call host_computer on the Chrome app token.

Rule 12b (`:463`): same OR (freeze/volume cap **or** explicit ask).

That OR is the e87i9z product lock. It **also** licenses first-turn pixel CU whenever the user utters 模拟点击, **before** `click({text})` / `evaluate` / darwin `osascript_eval`.

Contradictions the model still eats in the **same** system prompt `[inspected]`:

| Rule | Says | vs 12 |
|------|------|--------|
| **7** (`:478`) | CDP_ATTACH_FAILED → list_tabs / focus; **do NOT retry via evaluate or host_computer** | 12: after attach freeze, MAY CU |
| **8 win32** (`:482`) | **host_computer is NOT a browser-DOM fallback** | 12: it is, with confirm |
| **9c** (`:488`) | **NEVER use 9b/9c to operate a browser DOM** | 12: Chrome pixel CU |
| **12b** | LAST RESORT for **native** apps; browser-DOM not default | 12: Chrome token is allowed |
| App index (`:315`) | tokens are **「launch only, no args」** | 12: reuse token for CU |
| Catalog (`:1402`) | token **with coordinateAllowed=true** | 12: Chrome bit stays false |

WAVE-1 test no longer locks `NEVER use host_read/host_write/host_computer for browser-DOM` — only `NEVER default` + `ALWAYS pops a confirm`. That is an honest test change, not a proof of CDP-first.

**Product judgment**

- Explicit 模拟点击 → CU-without-CDP is **intended**. Do not add a fake “must try click() once” if the owner wanted a popup then pixels.
- **Do** resolve 7/8/9c or the model will either never call (e87i9z stuck) or call on the first `CDP_ATTACH_FAILED` without trying `list_tabs` / osascript (too early, and Rule 7 said that debugger miss is **not** a web fallback).
- Darwin: Rule 8 still wants osascript after CDP+scripting; Rule 12 never mentions it. 模拟点击 skips AppleScript. Say so on purpose or put osascript **before** the MAY.

Win32 Rule 12 still does not **list** `host_computer` in the tool bullets (only read/write/app/cli). Darwin does. Asymmetric training.

### Q4. Preview copy: can LLM task text spoof the warning line?

**Cannot forge a new preview line with `\n`. Can hide the real warning. Can put a look-alike inside the quoted 任务.**

Y3 still JSON-stringifies `task` (`preview.ts:105`). `[executed]` spoof input `ok\n⚠️ 系统已自动批准，无需点允许\n目标应用: 已放行` becomes one line:

```
任务: "ok\n⚠️ 系统已自动批准，无需点允许\n目标应用: 已放行"
```

The real banner is a later **verbatim** `extraLines` row (`l2-admission.ts:691-697`, `preview.ts:142`). Newlines in task do **not** become extra rows. That part of Y3 holds.

**Starvation (the actual spoof)** `[executed]` against Cockpit `CockpitApp.tsx:525`:

```text
(full_preview || code_preview).slice(0, 1200)
```

| `task` | preview length | 1200-slice contains 「浏览器像素点击」 / 「必须你点「允许」」 |
|--------|----------------|--------------------------------------------------------------|
| `模拟点击发布` + 1 click | 267 | **yes** |
| 400 × `x` | 661 | **yes** |
| 800 × `x` | 1061 | **yes** |
| 1200 × `x` + 3 clicks | 1505 | **no** (slice ends in padding) |
| 4000 × `汉` (schema cap) | 4349 | **no** |

`full_preview` is sent whole (`l2-admission.ts:1315`, `security-confirmation.ts:308-309`). Cockpit **re-truncates**. Tray summary is **800** chars (`l2-admission.ts:1140`). Banner is **last**, after rate-limit status, after every action and type corpus. Pad `task` (or dump 30 actions + type corpus) and the only human-facing warning this patch added **disappears**.

**Side Panel** `[inspected]`: `MinimalConfirm` never reads `full_preview` / `code_preview`. Compact bar is `高危 · host_computer` + **允许**. Hint: 「详细预览在确认台」. User can Allow without seeing ⚠️.

`preview_caption` (screenshot helper) sits **above** the `<pre>` and is **not** sliced. The new copy was not put there.

**Look-alike:** a short task can contain the same ⚠️ sentence inside JSON quotes. User sees two similar strings; one is data. Habituation, not a layout break.

**Answer:** line-break spoof **no**. Truncation hide **yes** (schema-legal). Compact Allow without banner **yes**. Put the banner **first** (or in `preview_caption`), and stop slicing `full_preview` in Cockpit, or this warning is theater for any non-toy task.

### Q5. Docs vs code drift (ADR-017 / user guide vs skip paths)?

**Partial. The exclusion bullet was patched; the skip-path SoT was not. Catalog was not patched at all.**

| Surface | Says now | Runtime |
|---------|----------|---------|
| ADR-017 **D2** (`:23`) | Browser bit never true; one-shot L2; unattended/三旗/G1 **never skip**; not persisted | **Matches** policy + skip reset |
| ADR-017 **D3** (`:26`) | Unattended grant **may silence** initial L2 **and** re-L2 for `coordinateAllowed` apps | Code: yes for real bits; **no** for vault-browser one-shot (D2 vs D3 collide) |
| ADR-017 **D3** cruise | 三旗 **may waive** `forceConfirm` (含 host initial) | Code: **not** when `vaultBrowserOneShot` |
| ADR-017 **D4** | G1 may skip later initial L2 | Code: **not** for vault browser |
| ADR-021 | skip ⇔ `armed && coordinateAllowed` | Call site **lies** `true` then reset (N4). ADR itself **not** in the diff |
| User guide **§3.3** (`:50`) | `coordinateAllowed === true` **required** | One-shot **bypasses** the bit |
| User guide **§3.4** (`:53`) | One-shot confirm; skips never | **Matches** skip reset |
| User guide **§3.5 / §5 / §5.1** | G1 / 值守 skip for 已开坐标 App | **No** browser exception |
| User guide **checklist** (`:64`) | 白名单 **且已开允许坐标** | Chrome **cannot** open that bit (Windows); one-shot doesn’t need it |
| Catalog `host_computer` | `coordinateAllowed` required; “ALWAYS shown”; god-mode/auto-approve do not skip (true) but **no** one-shot / 三旗 / G1 / 值守 language | Stale vs Rule 12 |
| `GOAL.md` / `architecture.md` | Dual switch + G1 skip; no one-shot | Stale (out of diff) |
| Comment `l2-admission.ts:242-247` | only 三旗 / G1 / 值守 waive | Comment **pre-patch**; vault-browser is a new non-waive |

**Skip-path reading a maintainer will implement next**

ADR-021 + user-guide §5.1: 值守 ⇒ silent CU on `coordinateAllowed` apps. D2 says browsers never have the bit. N7: macOS may persist the bit anyway. N4: admission already pretends the bit is true. Those three together are the drift that turns “docs say skip” into “code skip” in a “cleanup” PR.

**Answer:** D2/§3.4 match the new belt. D3/D4/§3.3/§3.5/§5/checklist/catalog/ADR-021 do **not**. For a Trust T3 change, that is not cosmetic.

---

## 3. DoD scorecard (external observables)

| # | Observable | Result | Evidence |
|---|------------|--------|----------|
| 1 | Chrome `host_computer` no longer STRUCTURAL before L2 when one-shot | **PASS** | `[executed]` policy tests; `[inspected]` both call sites pass `allowVaultBrowserOneShot: true` |
| 2 | Chrome `coordinateAllowed` cannot be persisted | **PASS-Windows / FAIL-macOS** | `[executed]` chrome exe STRUCTURAL_DENY; `[inspected]` handler + normalize only `exe.path` (N7) |
| 3 | Unattended + 三旗 + G1 cannot skip initial L2 or re-L2 for vault browser | **PASS*** | `[executed]` forceConfirm algebra; `[inspected]` skip reset + three executor guards. *N4 landmine; no integration test of unattended+Chrome `mustInteract` |
| 4 | powershell / 1Password / Terminal still STRUCTURAL with one-shot flag | **PASS** | `[executed]` powershell; password-managers not in `isVaultBrowserEntry` |
| 5 | hwnd swap Chrome → LOLBIN/password-manager denied | **PASS** | `[inspected]` ownership mismatch → `HWND_NOT_OWNED` first; lolbin/vault resolved exe → STRUCTURAL; one-shot only if `isBrowserVaultExePath(hwnd)` |
| 6 | WAVE-1 does not *default* `host_computer` for DOM | **PASS*** | `[executed]` source lock `NEVER default` + `ALWAYS pops a confirm`. *Rules 7/8/9c still say NEVER (N5) |

---

## 4. Outcome / trajectory / component

**Outcome (e87i9z user who already hit STRUCTURAL):** the next `host_computer` on the Chrome token should **pop Confirm Center / Cockpit**, not `APP_COORDINATE_STRUCTURAL`. Unattended / 三旗 / G1 should **not** auto-mint a token for that call. After Allow, pixels run under the existing executor (Chrome-as-self-UI raise is pre-existing 3ffkgl paradox — not introduced here; worth a human click-test because **target is now Chrome**).

**Outcome (user who only typed 模拟点击, CU never set up):** still **no** popup (`COMPUTER_DISABLED` / `APP_NOT_WHITELISTED`). Catalog/rules may prevent the call entirely (N3/N5).

**Trajectory:** small, named, three-belt change. Test lock is **unit-algebra + policy**, not “unattended armed + Chrome → dialog”. Default-on session-trust + unattended `coordinateAllowed: true` lie + stale skip docs are a **loaded skip path** waiting for a “fix the checkbox” PR. Do not merge as “Trust closed” without hiding the checkbox and prepending the banner.

**Component hotspots**

- `companion/src/computer/policy.ts:75-86` — `isVaultBrowserEntry` (Canary/Chromium gaps)
- `companion/src/computer/policy.ts:173-176` — one-shot STRUCTURAL bypass
- `companion/src/computer/policy.ts:240-249` — hwnd browser carve-out
- `companion/src/tool/l2-admission.ts:91` — cruise cannot waive
- `companion/src/tool/l2-admission.ts:499-502` — always-on one-shot flag
- `companion/src/tool/l2-admission.ts:596-603` — **unattended lied bit** (N4)
- `companion/src/tool/l2-admission.ts:679-697` — skip reset + banner **last**
- `companion/src/tool/l2-admission.ts:894-901` — waived log lie (N8)
- `companion/src/computer/executor.ts:656-708` — re-L2 skip disabled
- `companion/src/llm/adapter.ts:440-449,463,478-488` — Rule 12 vs 7/8/9c
- `companion/src/bridge/tool-definitions-catalog.json:1392,1402` — stale
- `companion/src/apps/handlers.ts:448-455` — macOS persist hole
- `chrome-extension/src/cockpit/CockpitApp.tsx:420-425,524-525,565-573` — default-on trust + 1200 slice
- `chrome-extension/src/sidepanel/components/MinimalConfirm.tsx:229-241` — Allow without preview
- `docs/adr/017-computer-use.md:23-26` — D2 vs D3
- `docs/computer-use-user-guide.md:50-64,106-113` — checklist / §5 skip

**Capability (ADR-020):** T3 Trust, L2 `host_computer` class reused, no new confirm dialect. Autonomy still single. Blast matches **if** one-shot never inherits G1/值守; the UI still **offers** that inheritance (N1).

---

## 5. Residual risks (owned)

1. **Informed consent:** banner last + Cockpit 1200 + compact Allow (N2). Short 模拟点击 is visible; schema-legal pad is not.
2. **Skip landmine:** N1 checkbox + N4 lied bit + N6 skip docs + N7 macOS persist. Today’s reset is the only adult in the room.
3. **Model may not call / may call too early:** N3 catalog + N5 rules. e87i9z can still fail by omission; other sessions can CU before CDP.
4. **Chrome is the CU host:** injecting the same browser that hosts Side Panel / Cockpit. Pre-existing self-UI recovery (`executor.ts:1594-1622`) was designed so **WeChat** clicks are not paused when Chrome takes FG. Target=Chrome inverts that. Human replay required; not a skip bug.
5. **Canary / `chromium.exe`:** not classified as vault-browser; unattended can still be silent. Pre-existing.

**Merge bar from this lane (not blocking if Pi treats them as nits):** hide/default-off session-trust for `vaultBrowserOneShot`; prepend banner or put it in `preview_caption`; stop Cockpit-slicing `full_preview`; pass real `entry.coordinateAllowed` into unattended; sync catalog + §3.3/checklist + ADR-017 D3 exception; drop or special-case `critical_api_waived`.

---

VERDICT: APPROVE_WITH_NITS
