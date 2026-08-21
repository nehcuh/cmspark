# Adversary review (win32 / cross-OS) — web act-loop WAVE-1 **implementation**

**Reviewer**: independent ADVERSARY / Windows–cross-OS skeptic. Did **not** implement WAVE-1, write the spec, or fold a7ubt9.  
**Subject**: W3′ attach classification · W4 type · W5 Rule 12/7/8 · `fill_form` Ctrl VK · `press_key` CDP modifiers · OS last-resort matrix  
**SoT**: [`docs/superpowers/specs/2026-08-21-web-act-loop-design.md`](../../superpowers/specs/2026-08-21-web-act-loop-design.md) §5.1 §5.4 §5.5 §8 · DoD **8, 9, 18, 19**  
**Date**: 2026-08-21  
**Blast**: T2 implementation. No Windows VM. No a7ubt9 replay.  
**Evidence tags**: `[executed]` ran the named command; `[inspected]` read the code path; `[assumed]` not verified on a Windows box.

Attack charter (locked by the review prompt):

1. `https` attach fail → `CDP_ATTACH_FAILED` not `ELEMENT_NOT_FOUND`; `suggested_action` must **not** contain `evaluate` or `host_computer`. Classification from `tabs.get` URL, **not** error substring (DoD 8, 19).
2. `chrome-extension://` → `WRONG_ORIGIN` (DoD 9). `file:` HTML is **not** `WRONG_ORIGIN`.
3. `fill_form` Ctrl+A actually sends `windowsVirtualKeyCode` (DoD 18). Meta half too.
4. `press_key` sends official CDP modifiers (Meta=4 Shift=8) plus VK.
5. catalog `press_key` description no longer publishes Meta=8 Shift=4 as SoT.
6. Rule 12/7 NEVER `host_computer` for browser-DOM on **both** win32 and darwin prompt strings. win32 Rule 8: no third JS path.
7. Windows has no osascript; must not suggest it in `failInteractive` `suggested_action`.
8. Tests parameterized `platform`/`win32` for heuristic (`Start-Process` vs `cscript`+`querySelector`) without a VM.

This lane is allowed to accept/reject: **the claim that WAVE-1 as shipped is an honest Windows/Linux contract, machine-checkable without a VM.**

---

## Capability declaration (checked against spec §2)

```text
Surface:      L1 CDP (click/type/hover/press_key/fill_form/evaluate) — no new Surface
L2-classes:   none new; evaluate / osascript_eval / shell_exec / host_computer still L2
Compose:      none
Autonomy:     single
Trust:        resolveLocator stays in the extension IIFE;
              click ∉ L2_GATE_TOOLS;
              NEVER host_computer for browser-DOM (Rule 12/7)
Channel:      community
```

Axes fit. The Windows hole is still **not** a new Surface — it is whether attach-fail typing, the Ctrl chord, and the prompt/tool-result funnel actually stop the model hopping to `evaluate` / `host_computer` / a fictional third JS path.

---

## Verdict in one paragraph

The **product code** for the eight attacks is mostly the spec the design adversary demanded: URL-based `WRONG_ORIGIN` vs `CDP_ATTACH_FAILED`, `file:` not privileged, `fill_form` Ctrl half now carries `windowsVirtualKeyCode: 65` + CDP `modifiers: 2`, `press_key` re-encodes the legacy mask onto official Meta=4/Shift=8 + VK, catalog no longer teaches the wrong bits, Rule 12/7 name `host_computer` on both win32 and darwin, Rule 8 non-darwin says there is no third JS path, `failInteractive` never suggests `osascript`/`evaluate`/`host_computer`, click stays out of `L2_GATE_TOOLS`. That is real work.

It is **not shippable as WAVE-1**. Companion `npm test` **cannot compile** `tests/web-act-loop-wave1.test.ts` (`import.meta` under `module: commonjs` + strict `fields.items`). The locks that supposedly prove Attacks 5/6/8 **never enter the repo test runner**. `[executed]` `npx tsc -p tsconfig.test.json` → exit 2. The same file **does** pass under `tsx` — so this is CI theater, not a logic failure of the assertions. Separately, `failInteractive` still **gates** attach typing on an English error regex (`browser-bridge.ts:328-330`) even though spec §5.1 is titled `tabs.get` URL, 禁止 error 子串; DoD 8 tests only the pure helper. linux still inherits the **macOS** Rule 12 body (CU as LAST RESORT) plus untouched 12b; scroll exhausted still names `host_computer`. Spec §5.4 / W5 12/12b are not closed.

**This is not a reject of click-by-text or of the Ctrl VK helper.** It is a reject of “WAVE-1 OS matrix is done and machine-checkable.”

---

## Outcome (DoD 8 / 9 / 18 / 19)

| DoD | Claim | Evidence | Result |
|-----|--------|----------|--------|
| **8** | `https://zhihu.com` + attach fail → `CDP_ATTACH_FAILED` not `ELEMENT_NOT_FOUND` | Helper `[executed]` `locator-classify.test.ts` (`classifyAttachFailure("https://www.zhihu.com/write")`). Wiring `[inspected]`: `ensureAttached` wraps `Debugger attach failed for tab…` (`browser-bridge.ts:209`) which **does** match `/debugger attach/`. **No test drives `failInteractive`.** Stale-debugger `"Debugger is not attached"` does **not** match the regex → fallback `ELEMENT_NOT_FOUND`. | **Helper PASS. Wiring unproven. Residual lie path.** |
| **9** | `chrome-extension://` → `WRONG_ORIGIN`; `file:` HTML is not | Helper `[executed]`. `ensureAttached` pre-throws `Cannot access a chrome-extension:// URL` (`:189-191`) which is attachish + URL-classified. `file:` → `classifyTabUrl` `"file"` → `CDP_ATTACH_FAILED`. | **PASS** (with 5s stall nit on `chrome-extension://`, `:185-187`) |
| **18** | `fill_form` Ctrl+A half has `windowsVirtualKeyCode` | `[executed]` `type-fallback.test.ts`: Ctrl payloads `vk=65`, `modifiers=2`; Meta half `vk=65`, `modifiers=4`. `[inspected]` `fillForm` sends `selectAllKeyPayloads()` verbatim (`:1071-1074`). | **PASS** |
| **19** | `CDP_ATTACH_FAILED.suggested_action` contains neither `evaluate` nor `host_computer` | Helper type is `"list_tabs"` only. `failInteractive` attachish path forwards that. Non-attachish + default fallback `CDP_ATTACH_FAILED` uses `refine_text_or_selector` (`:340`) — still no evaluate/CU. **No test asserts the exclusion string.** Scroll warning **does** name `host_computer` (`:1371`) but that path is `success:true` / not this code. | **PASS for the typed attach code. Funnel leftover elsewhere.** |

Chrome-extension WAVE-1 tests: `[executed]`

```text
npx tsc -p tsconfig.test.json && node --test .test-dist/tests/locator-classify.test.js .test-dist/tests/type-fallback.test.js
ℹ pass 14  fail 0
```

Companion WAVE-1 tests: `[executed]` **compile red under the repo runner; green only via tsx.**

```text
npx tsc -p tsconfig.test.json
# tests/web-act-loop-wave1.test.ts(12,36): error TS1343: import.meta …
# tests/web-act-loop-wave1.test.ts(28,19): error TS18048: fields.items possibly undefined
# exit 2

npx tsx --test tests/web-act-loop-wave1.test.ts tests/dom-script-budget.test.ts
# ℹ pass 15  fail 0
```

`npm --prefix companion test` is `rm .test-dist && tsc -p tsconfig.test.json && node scripts/run-tests.mjs`. **The wave-1 companion file makes the whole suite fail to start.** Other companion tests use `__dirname` because `tsconfig` is `"module": "commonjs"`. This file is the only `import.meta.url` under `companion/tests/*.ts`.

---

## Trajectory

Diff intent matches W3′/W5/§5.5: new `locator-classify.ts`, `cdp-keys.ts`, adapter Rule 7/8/12 strings, catalog booleans, budget heuristic, L2 freeze. No W2 snapshot. Click not promoted to L2.

Drift / leftovers in files this wave **touched**:

- `browser-bridge.ts:1371` still teaches `host_computer scroll` after CDP/scripting exhaust. Same funnel the design-win32 adversary already named. Wave-1 edited this file for `failInteractive` / `pressKey` / `fillForm` and left the CU hop in a **browser** tool result.
- Rule **12b** (`adapter.ts:454-459`) was **not** patched. Spec W5: “三平台 Rule 12/**12b**” NEVER `host_computer` for browser-DOM. 12b still: “host_computer is LAST RESORT pixel/OCR inject.”
- linux (`platform !== "win32"`) still gets the **macOS** Rule 12 body (`adapter.ts:426` ternary). Spec §5.4: linux 同 win32; 文案不得暗示有 CU. Dispatch already hard-refuses CU off darwin/win32; the prompt still describes how to use it.

No thrash. No new L2 class. Trust freeze (click ∉ `L2_GATE_TOOLS`) holds `[executed]` `L2_GATE_TOOLS.includes("click") === false`.

---

## Component (hotspots)

| ID | Sev | file:line | Note |
|----|-----|-----------|------|
| **W-TEST** | **P0 block** | `companion/tests/web-act-loop-wave1.test.ts:12,28` | `import.meta` + strict optional → `tsc -p tsconfig.test.json` red. Claimed locks for catalog / Rule 12 / heuristic / L2 **do not run** in `npm test`. `[executed]` |
| **W-GATE** | **P1** | `chrome-extension/src/background/browser-bridge.ts:325-340` | Attach typing still **gated** on `/debugger attach\|cannot access\|chrome-extension:\/\/\|chrome:\/\/\|script injection failed/i`. Spec §5.1 title: `tabs.get` URL, 禁止 error 子串. Code **does** use URL for WRONG_ORIGIN vs CDP_ATTACH_FAILED **once the regex hits**. `"Debugger is not attached"` / `"No tab with given id"` (`:198`) / non-English Chrome → fallback often `ELEMENT_NOT_FOUND`. DoD 8 tests never construct this function. |
| **W-L12** | **P2** | `companion/src/llm/adapter.ts:426-446,454-459` | win32 + darwin both have NEVER `host_computer` for browser-DOM (`:438`, `:446`) — Attack 6 string **present**. linux inherits darwin CU playbook. 12b unpatched. Source-lock test is **one** regex across the file (`wave1.test.ts:80`) — deleting the darwin sentence still passes. |
| **W-SCROLL** | **P2** | `browser-bridge.ts:1362-1373` | `success:true` exhausted scroll: `"Try press_key PageDown, or host_computer scroll if coordinate mode is on."` Contradicts Rule 12 NEVER-as-web-default. Not DoD 19’s field, still the a7ubt9 hop. |
| **W-STALL** | nit | `browser-bridge.ts:182-187` | `chrome-extension://` / `chrome://` / `about:blank` retry 10×500ms **before** throwing. DoD 9 is correct after ~5s. `edge://` / `devtools://` skip the wait (URL doesn’t match those prefixes) and still classify via `classifyTabUrl` as privileged. |
| **W-CODE** | nit | `browser-bridge.ts:1395-1399` | `press_key` `code` defaults to ``Key${key.toUpperCase()}`` → `Enter` becomes `KeyENTER`. VK map still sets 13/34. Extra DOM `ctrlKey`/`metaKey` booleans are spread onto CDP `Input.dispatchKeyEvent` (not protocol fields). Spec asked official `modifiers`+VK; extras are `[assumed]` ignored by Chrome. |
| **W-MASK** | nit | `cdp-keys.ts:28-36` · `pressKey :1384-1392` | Legacy mask still Shift=4 Meta=8 decode (spec-allowed). `keysFromLegacyModifierMask` has **zero** tests. Catalog test only `doesNotMatch(/Meta=8/)` on `modifiers.description`, not `Shift=4`, not `press.description`. |
| **W-8TEST** | nit | `wave1.test.ts:66-82` | Heuristic strings are win32-shaped (good). No `getToolDefinitions("win32")`, no `os.platform` mock, no `suggested_action` lock excluding `osascript`/`evaluate`/`host_computer`. Rule 8 “no third JS injection path” **untested**. Named “win32 parameterized”; it is not. |

---

## Attack 1 — https attach fail / DoD 8, 19 / URL vs substring

**Spec §5.1**: classify from `tabs.get(tabId).url`. https + debugger+scripting both fail → `CDP_ATTACH_FAILED`. `suggested_action` ∈ {`list_tabs`, `retry_after_user_focus`, `stop_or_change_task`}. **禁止** `evaluate`. §5.4 win32: **禁止** `host_computer`.

### What is true `[inspected]` `[executed]`

```14:41:chrome-extension/src/background/locator-classify.ts
export function classifyTabUrl(url: string | undefined | null): TabUrlClass {
  // chrome-extension / chrome / edge / devtools → privileged
  // http(s) → web ; file: → file
}
export function classifyAttachFailure(url: string | undefined | null): {
  error_code: "WRONG_ORIGIN" | "CDP_ATTACH_FAILED"
  suggested_action: "list_tabs"
} {
  const kind = classifyTabUrl(url)
  if (kind === "privileged") {
    return { error_code: "WRONG_ORIGIN", suggested_action: "list_tabs" }
  }
  return { error_code: "CDP_ATTACH_FAILED", suggested_action: "list_tabs" }
}
```

The **code** WRONG_ORIGIN vs CDP_ATTACH_FAILED is URL-only. `suggested_action` is the literal `"list_tabs"` — DoD 19 holds on this helper. https unit test exists and `[executed]` passes.

`ensureAttached` wrap (`:209`) `Debugger attach failed for tab ${tabId}: ${e.message}` matches `/debugger attach/`. First-attach fail on `https://zhihu.com` **should** hit attachish → `CDP_ATTACH_FAILED`. `safeEvaluate` concatenates CDP+scripting errors (`:869-871`); `"script injection failed"` still matches.

### Falsification

`failInteractive` **still consults the error string first**:

```325:340:chrome-extension/src/background/browser-bridge.ts
    const attachish =
      /debugger attach|cannot access|chrome-extension:\/\/|chrome:\/\/|script injection failed/i.test(msg)
    if (attachish) {
      const c = classifyAttachFailure(url)
      return codedToolError(c.error_code, msg, { suggested_action: c.suggested_action, tab_url: url || "" })
    }
    return codedToolError(fallbackCode, msg, { suggested_action: "refine_text_or_selector" })
```

Spec parenthetical is 禁止 error 子串. This is the old Mac-shaped classifier with a URL second stage glued on.

Lie paths `[inspected]`:

| Error | attachish? | fallback used by click/hover/drag | DoD 8 |
|-------|------------|-------------------------------------|-------|
| `Debugger attach failed for tab N: …` | yes | — | holds |
| `Script injection failed in both ISOLATED and MAIN worlds` | yes | — | holds |
| `Cannot access a chrome-extension:// URL…` | yes | URL decides code | holds |
| `Debugger is not attached to the tab` (stale `attachedTabs`) | **no** (`debugger attach` is not a substring of `debugger is not attached`) | `ELEMENT_NOT_FOUND` | **miss** |
| `No tab with given id ${tabId}.` (`ensureAttached` `:198`) | **no** | `ELEMENT_NOT_FOUND` | miss (different symptom, same user-visible lie) |
| non-English / Chromium phrasing without those tokens | no | `ELEMENT_NOT_FOUND` | miss |

DoD 8 tests **only** call `classifyAttachFailure("https://…")`. They would still pass if `failInteractive` were deleted. That is the same “Node-only, helper-only” dodge the design adversary rejected for §8.

Default fallback `CDP_ATTACH_FAILED` (evaluate’s both-worlds fail, `:1592`) with attachish **false** yields `suggested_action: refine_text_or_selector` — not evaluate/CU (DoD 19 still holds) but not the §5.1 table either.

**Attack 1: helper PASS, wiring PARTIAL, tests FAIL the spirit of DoD 8.** Not enough alone to reject the chord/VK work; enough to refuse “attach honesty is done.”

---

## Attack 2 — chrome-extension WRONG_ORIGIN; file: HTML is not (DoD 9)

`classifyTabUrl("chrome-extension://…") === "privileged"` `[executed]`.  
`classifyAttachFailure("file:///tmp/x.html").error_code === "CDP_ATTACH_FAILED"` `[executed]`.

`ensureAttached` additionally **refuses** `chrome-extension://` and `chrome://` before `debugger.attach` (`:189-194`). Message contains `Cannot access` + `chrome-extension://` → attachish → URL class. Extension has `"tabs"` permission (`chrome-extension/package.json:48`) so `tabs.get().url` is `[assumed]` populated; if it were omitted, `classifyTabUrl(undefined) === "empty"` → **CDP_ATTACH_FAILED not WRONG_ORIGIN**. Residual, not the DoD 9 fixture.

`edge://` / `devtools:` are privileged in `classifyTabUrl` even though `ensureAttached` does not pre-reject them. Attach fail still WRONG_ORIGIN. Good.

**Attack 2: PASS** (stall nit W-STALL).

---

## Attack 3 — fill_form Ctrl+A VK (DoD 18)

```76:96:chrome-extension/src/background/cdp-keys.ts
export function selectAllKeyPayloads(): SelectAllKeyPayload[] {
  const vk = 65
  const chord = (type, which) => ({
    type, key: "a", code: "KeyA",
    ...(which === "meta" ? { metaKey: true } : { ctrlKey: true }),
    modifiers: which === "meta" ? CDP_MOD_META : CDP_MOD_CTRL, // 4 then 2
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  return [meta down/up, ctrl down/up]
}
```

`fillForm` (`:1071-1074`) `sendCdp(..., payload)` with that object. Tests `[executed]` assert Ctrl `modifiers===2` and Meta `modifiers===4`, both `vk===65`.

Dual-send is spec-locked (§5.5 / §11 非目标: 自动 Meta→Ctrl except fill_form dual-send). CDP `Input.dispatchKeyEvent` is **page**-level; Win+A Action Center is `[assumed]` **not** this path (design-win32 already demoted “Win 键误伤”). Making Meta half also carry VK is correct for darwin Command-A, not an OS-hotkey regression.

**Attack 3: PASS.**

---

## Attack 4 — press_key official CDP modifiers + VK

```19:26:chrome-extension/src/background/cdp-keys.ts
export function cdpModifiersFromKeys(k): number {
  return (alt?1:0)|(ctrl?2:0)|(meta?4:0)|(shift?8:0)
}
```

```1384:1403:chrome-extension/src/background/browser-bridge.ts
    const fromMask = typeof params.modifiers === "number"
      ? keysFromLegacyModifierMask(params.modifiers) : undefined
    const modifiers = cdpModifiersFromKeys(keys)   // official
    const vk = windowsVirtualKeyCode(String(params.key))
    await this.sendCdp(..., { type: "keyDown", ...payload })  // includes modifiers + vk
```

Legacy mask (Shift=4 Meta=8) is decoded **then** rewritten to official CDP. Spec §5.5 explicitly kept that compatibility. LLM that sends official `modifiers:8` meaning Shift gets **Meta**. Catalog now says 不要用数字掩码 — the footgun is residual, not a new SoT.

`press_key` does **not** dual-send Meta+Ctrl. Spec §11 non-goal. Catalog description tells win/linux to pass `ctrlKey`. Prompt-only remap; design adversary hated that; **locked spec accepted it**. This lane does not re-open that fight.

No fake-`sendCdp` test of `pressKey()` itself. Helper unit tests `[executed]` `cdpModifiersFromKeys({metaKey:true})===4`, `{shiftKey:true}===8`, `{ctrlKey:true}===2`, `windowsVirtualKeyCode("PageDown")===34`.

**Attack 4: PASS** (nits W-CODE, W-MASK).

---

## Attack 5 — catalog no longer publishes Meta=8 Shift=4

```381:410:companion/src/bridge/tool-definitions-catalog.json
"name": "press_key",
"description": "发送键盘按键。修饰键用布尔：darwin 全选/快捷键用 metaKey，Windows/Linux 用 ctrlKey。不要用数字掩码。",
"ctrlKey" / "metaKey" / "altKey" / "shiftKey": booleans
"modifiers": "可选遗留参数；优先使用 ctrlKey/metaKey/altKey/shiftKey"
```

`rg Meta=8|Shift=4` in `*.json`/`*.ts`: **only** comments in `cdp-keys.ts` and the wave1 test’s `doesNotMatch(/Meta=8/)`. `[inspected]`

Zod has matching booleans (`tool-schemas.ts:132-141`).

Test does **not** scan `press.description` or `Shift=4`. Theater-grade lock, but the catalog itself is clean.

**Attack 5: PASS.**

---

## Attack 6 — Rule 12/7 NEVER host_computer; win32 Rule 8 no third JS path

**win32 Rule 12** `:438`:

`NEVER use host_read/host_write/host_computer for browser-DOM tasks — use get_page_text / click({text}) / type / evaluate. NEVER propose host_computer as the default way to operate a web page.`

**darwin Rule 12** `:446`: same NEVER sentence (plus Mail/Notes CU LAST RESORT above it).

**Rule 7** `:471`: `If a tool returns CDP_ATTACH_FAILED, call list_tabs / ask the user to focus the tab; do NOT retry via evaluate or host_computer (same debugger / not a web fallback).`

**Rule 8 non-darwin** `:475`:

`osascript_eval is NOT available on this platform (Windows/Linux) and is not in your tool list. NEVER call it. If click/evaluate returns CDP_ATTACH_FAILED, stop or list_tabs — there is no third JS injection path and host_computer is NOT a browser-DOM fallback.`

The **strings Attack 6 named are in source** `[inspected]`. The previous win32 lie (“NEVER host_read/host_write” only; Rule 8 “use evaluate instead”) is gone.

### Remaining funnel `[inspected]`

1. **12b** (`:454-459`) still LAST RESORT CU, **no** NEVER-for-DOM. Spec W5 said Rule 12/**12b**. 12b is injected **after** Rule 12 on every platform, including linux where the tool hard-refuses (`companion-dispatch.ts` host_computer `!isWin && !isMac`).
2. **linux Rule 12 is the darwin block** (`:426` `win32 ? win : mac`). Spec §5.4: 文案不得暗示有 CU. linux prompt describes Mail.app + `host_computer: LAST RESORT pixel/OCR inject`.
3. Source lock (`wave1.test.ts:78-81`) is one `assert.match` on the file. It does **not** instantiate `os.platform()==="win32"` vs `"darwin"` vs `"linux"`. Deleting one branch still passes. Rule 8 “no third JS” is **not** in the lock.
4. `osascript_eval` catalog description still exists in the full catalog (filtered from LLM on non-darwin — `tool-definitions.ts:117-120`, already tested in `bridge.test.ts`). Fine.

**Attack 6: PASS on the named win32+darwin sentences. FAIL spec §5.4 linux + W5 12b. Tests do not lock either platform branch.**

---

## Attack 7 — Windows must not see osascript in failInteractive suggested_action

`classifyAttachFailure` return type is `"list_tabs"`. `failInteractive` suggested_action ∈ {`list_tabs`, `refine_text_or_selector`}. No `osascript` token in that function `[inspected]`.

`getToolDefinitions("win32")` omits the tool (pre-existing `bridge.test.ts`). Rule 8 tells the model the tool is absent.

**Attack 7: PASS.** (No win32 assertion that `suggested_action` excludes `osascript` — covered by W-8TEST.)

---

## Attack 8 — parameterized win32 tests, no VM

Spec §8: 测试必须 `platform: "win32"` 参数化**启发式与 suggested_action**. DoD 禁止只写「含 osascript」.

What exists `[executed via tsx, not via npm test]`:

| Test | Locks | platform: "win32"? |
|------|-------|-------------------|
| `isDomInjectShellCommand('powershell -c "Start-Process chrome"') === false` | DoD 15 launch allow | string-shaped, not `platform` arg (heuristic is OS-agnostic — OK) |
| `cmd /c echo document.querySelector && cscript inject.js === true` | DoD 15 inject | same |
| `cscript //nologo inject.js === false` (`dom-script-budget.test.ts`) | §5.3 known residual file-backed | honest |
| `cappedDomScriptResult` `suggested_action` excludes evaluate/host_computer | §5.3 cap | yes, **budget** not attach |
| Rule 12/7 source grep | Attack 6 | **no** platform split |
| `classifyAttachFailure` suggested_action `list_tabs` | DoD 8/19 helper | **no** failInteractive |
| fill_form VK | DoD 18 helper | not `sendCdp` |

There is **no** test that:

- `failInteractive` on `{url: "https://zhihu.com", err: "Debugger attach failed"}` → code `CDP_ATTACH_FAILED`, `suggested_action` matches `/evaluate|host_computer|osascript/` **false**
- adapter source for the **non-darwin** Rule 8 ternary contains `no third JS injection path`
- `getToolDefinitions("win32")` press_key description (catalog is global; this would still be cheap)

And the file that contains the “win32 parameterized” test **does not compile** in `npm test` (W-TEST).

**Attack 8: FAIL as a machine gate.** Heuristic **logic** is correct when run with tsx.

---

## Trust / L2 (charter adjacent)

```49:67:companion/src/tool/l2-admission.ts
export const L2_GATE_TOOLS = [
  "evaluate", "osascript_eval", "host_read", "host_write", "shell_exec", …
]
```

`click` / `fill_form` / `press_key` / `type` are absent. `[executed]` wave1 test (tsx). Spec §2 Trust freeze holds.

---

## MUST-FIX (merge-blocking)

1. **Make `companion/tests/web-act-loop-wave1.test.ts` compile under `tsconfig.test.json`.** Use `__dirname` like every other companion test; fix `fields.items` strict access. Until `npx tsc -p tsconfig.test.json` is green, WAVE-1 companion locks are fiction. `[executed]`

2. **Drive `failInteractive` (or extract the attachish predicate) in an extension unit test** with fake `chrome.tabs.get`:
   - url `https://www.zhihu.com/write` + err `Debugger attach failed for tab 1: Cannot attach to this target` → `CDP_ATTACH_FAILED`, `suggested_action` does not match `/evaluate|host_computer|osascript/`
   - url `chrome-extension://gfbliohnn/pdf.html` + the same **https-looking** error substring → still `WRONG_ORIGIN` (URL wins)
   - url `file:///tmp/x.html` → not `WRONG_ORIGIN`
   Optional but recommended: `"Debugger is not attached"` on https must **not** become `ELEMENT_NOT_FOUND` — either fold it into attachish **or** classify any `sendCdp`/`scriptingExecute` throw via URL first (that is what §5.1 actually wrote).

3. **Do not merge while `npm --prefix companion test` is compile-red.** This is not optional polish.

---

## Should-fix (P2, would keep APPROVE_WITH_NITS if 1–3 were done)

4. Rule 12 linux: do not ship the Mail.app / `host_computer: LAST RESORT` paragraph. Spec §5.4. Same ternary that already special-cases win32 can special-case `linux` (or treat `!== "darwin"` as the win32 Rule 8+12 NEVER block).
5. Add NEVER-for-browser-DOM to **12b**, or stop injecting 12b when the user goal is a tab. Spec W5 “Rule 12/12b”.
6. Delete `host_computer scroll` from the scroll exhausted warning (`browser-bridge.ts:1371`). `press_key PageDown` is enough.
7. Lock Rule 8 non-darwin string and both Rule 12 branches with `getToolDefinitions("win32")` / a `platform:` parameterized adapter excerpt — this repo already does that for apps/ACP.
8. Test `keysFromLegacyModifierMask(8).metaKey === true` and that `press_key` `modifiers:8` becomes CDP `4`, not Shift.

## Nits

- `ensureAttached` 5s retry on `chrome-extension://` before WRONG_ORIGIN.
- `press_key` `code: KeyENTER` for named keys; drop DOM booleans from the CDP payload (keep them in the **schema**).
- Catalog test should `doesNotMatch(/Meta=8|Shift=4/)` on the whole `press_key` function JSON.
- `TYPE_UNSUPPORTED_EDITOR` `suggested_action: click_then_type_or_evaluate` names evaluate — allowed for a live world, easy to misread after attach fail. Not DoD 19.

---

## What this lane is **not** rejecting

- Locator combination C, hitAttr split, SYNTAX_ERR-only, type focus path (other lanes).
- Budget 3+24 / `isDomInjectShellCommand` payload heuristic (logic `[executed]` via tsx; `Start-Process chrome` is not inject; `querySelector`+cscript is; bare `cscript inject.js` is the documented residual).
- `file:` / https PDF plugin lying `ELEMENT_NOT_FOUND` (spec known residual).
- press_key not auto-remapping Meta→Ctrl (spec non-goal).
- Absence of UIAutomation / xdotool third JS path (spec §5.4 / §11).

---

## Judges

| Gate | Result |
|------|--------|
| MACHINE (extension WAVE-1 tests) | **PASS** `[executed]` 14/14 |
| MACHINE (companion `tsc -p tsconfig.test.json`) | **FAIL** `[executed]` wave1.test.ts TS1343 + TS18048 |
| MACHINE (companion wave1 via tsx) | PASS 15/15 — **not** the repo runner |
| ADVERSARY (this document) | **REJECT** |

Nits 4–8 are not the reject. **W-TEST + untested failInteractive gate** are.

VERDICT: REJECT
