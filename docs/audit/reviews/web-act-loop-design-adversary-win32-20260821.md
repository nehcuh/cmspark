# Adversary review (win32 / linux) — web act-loop design spec

**Reviewer**: independent ADVERSARY / Windows–cross-OS skeptic. Did **not** write the spec, the direction fold, or a7ubt9.  
**Subject**: [`docs/superpowers/specs/2026-08-21-web-act-loop-design.md`](../../superpowers/specs/2026-08-21-web-act-loop-design.md) — especially **§8 平台**, plus §5.3–5.5, §7 Rule 8, §10 DoD, §11 非目标, §12.7  
**Date**: 2026-08-21  
**Trace**: a7ubt9 is **macOS-only** (spec header admits this). This lane does **not** claim a Windows replay.  
**Blast**: T2 design lock. No implementation in this document.  
**Evidence**: `[inspected]` source + CDP spec + direction fold; `[assumed]` live win32 Chrome IME / extra-field stripping (not executed on a Windows box this review).

Attack charter: whether §8 is an honest, implementable Windows/Linux contract, or a **Mac-shaped policy with a three-column table glued on**. Required attack surfaces: evaluate-only last-resort + cap 8; `powershell`+`chrome` heuristic; `press_key` Meta vs Ctrl; missing win32 tests; `host_computer` temptation.

Ranking this lane is allowed to accept/reject: **the claim that wave-1 as specified works on win32/linux.**

---

## Capability declaration (checked against spec §2)

```text
Surface:      L1 browser CDP (click/type/hover/get_element_info)
L2-classes:   none new; evaluate / osascript_eval / shell_exec still L2
Compose:      none
Autonomy:     single
Trust:        click-by-text ≠ evaluate; click not in L2_GATE_TOOLS;
              "不做网页默认 host_computer" (one-liner + §11)
Channel:      community
```

Axes fit for W1. The Windows hole is **not** a new Surface — it is that the L2 last-resort **the Mac storm actually used** (`osascript_eval` = `tell application "Google Chrome" … execute t javascript`) **has no peer**, while the prompt stack still funnels a capped evaluate into `host_computer`.

---

## Verdict in one paragraph

W1 locator honesty, typed `WRONG_ORIGIN` / `CDP_ATTACH_FAILED`, evaluate-null, and liar-success are **Chromium-shaped and implementable on all three OS**. That is the only part of §8 that is true. Everything that replaces Darwin’s third JS path (`osascript_eval` → Chrome AppleScript) is a **label**: “Windows 退路只有 budgeted evaluate”, cap `8` copied from a Mac success-loop, a `powershell`+`chrome` substring that does not match how `shell_exec` actually spawns on win32 (`cmd.exe` via `shell:true`), a `press_key` catalog story that teaches the **wrong bitmask** and does not match the **CDP wire**, and a Trust slogan “NEVER host for browser-DOM” that in code is only `host_read`/`host_write`. After cap 8 the remaining injective surface on win32 **is** `host_computer` (Rule 12b); on linux it is **nothing**. a7ubt9 was not replayed. DoD is Node-only and still asserts `shell_exec` 含 osascript. **This is a Mac spec with a table glued on.**

**VERDICT: REJECT** the claim that §8 / §5.3–5.5 / W5 Rule 8 are honest and implementable for Windows/Linux as written.

W1+W4+§5.1+§5.2 may still lock. Do not let implementers copy the Windows column until the MUST-FIX list below is folded. This is not a reject of click-by-text.

---

## 0. What is actually platform-honest today `[inspected]`

| Claim in spec §8 | Code today | Honest? |
|------------------|------------|---------|
| W1/W4/5.1/5.2 = 扩展 CDP, 同 | `chrome-extension/src/background/browser-bridge.ts` — same MV3 debugger + scripting | **Yes** (with edge:// / VK / IME nits) |
| osascript 工具 有 / **无** / 无 | `shouldExposeOsascript` = `platform === "darwin"`; `getToolDefinitions` filters the tool; `shouldL2GateOsascript` same | **Yes** — already shipped, tested win32+linux hide |
| Rule 8 Windows: NEVER call osascript | `adapter.ts` Rule 8 non-darwin: “NOT available… NEVER call it — use get_page_text or evaluate instead.” | **Half** — it hides the dead tool, then **names evaluate as the substitute** with no attach-gate |
| Rule 12 win32 NEVER host for browser-DOM | Rule 12 win32: “NEVER use **host_read/host_write** for browser-DOM”. `host_computer` not in that sentence. 12b (all OS): “host_computer is LAST RESORT pixel/OCR inject.” | **No** — direction fold overclaimed “NEVER host_*”; spec dropped the row instead of fixing the lie |
| 5.3 family win32 = evaluate ∪ shell 启发式 | **Not implemented** (spec). Heuristic as written is the glue. | **No** — see Attack 2 |
| `press_key` darwin Meta=8 / win Ctrl=2; fill_form 双发 | Catalog is **one** JSON, all-OS “Shift=4, Meta=8”. `press_key` never sends CDP `modifiers`. fill_form Meta uses CDP `modifiers: 4`; Ctrl+A sets only `ctrlKey` boolean. | **No** — see Attack 3 |
| 测试 同套 Node | `bridge.test.ts` hides osascript on win32/linux. No fill_form dual-send test. No press_key wire test. DoD §10.7 is osascript-shaped. | **No** — see Attack 4 |
| 禁止 `if (darwin) { cap } else skip` | Correct instinct (don’t skip the cap). Wrong implication (same cap + same last-resort **name** ⇒ same product). | **Table glue** |

`osascript_eval` is not “JS in a tab via a generic host script.” It is a **Chrome-specific AppleEvent**:

```1134:1140:companion/src/tool/companion-dispatch.ts
          "-e", "  tell application \"Google Chrome\"",
          ...
          "-e", "          set resultText to execute t javascript jsExpr",
```

There is no win32/linux analogue in tree. UIAutomation-on-Chrome is correctly a non-goal. That does **not** make evaluate a substitute: evaluate is `safeEvaluate` = CDP `Runtime.evaluate` then `chrome.scripting` — the **same two worlds click already used**.

---

## Attack 1 — evaluate-only last-resort + cap 8 is too aggressive, and is not a last-resort

**Spec**: §5.1 https attach fail → `suggested_action: list_tabs` **或 `evaluate`（L2）**. §5.4 “Windows 无此工具 → 退路只有 budgeted evaluate”. §5.3 `DOM_SCRIPT_SUCCESS_LOOP_MAX = 8`, same key, including `empty_completion`. §12.7 poses the question and does not answer it.

### Falsification `[inspected]`

`evaluate` is not a third Chrome-JS path:

```675:701:chrome-extension/src/background/browser-bridge.ts
  private async safeEvaluate(tabId: number, expression: string): Promise<any> {
    try {
      const cdp = await this.sendCdp(tabId, "Runtime.evaluate", { ... })
      ...
    } catch (cdpErr: any) {
      // Fallback to chrome.scripting only when CDP attach/evaluate truly failed
      try {
        const result = await this.scriptingExecute(tabId, expression)
```

`click` already: CDP mouse → `scriptingExecute` DOM `.click()`. `get_page_text` already: `safeEvaluate`. So:

| Situation | Darwin extra | win32 / linux |
|-----------|--------------|----------------|
| CDP attach works | CDP click/type | same |
| CDP attach fails, `chrome.scripting` works | scripting fallback (click **already**) | same — `evaluate` adds nothing new |
| CDP attach fails, scripting blocked (X.com CSP — **catalog’s osascript raison d’être**) | `osascript_eval` AppleEvent JS | **dead**, unless `host_computer` |
| Scripting/evaluate **succeeds** but SPA didn’t publish (a7ubt9 working-path) | 81× osascript success; cap 8 would have cut at 8 | 81× evaluate success; cap 8 cuts at 8, then hop |

Rule 8 today on non-darwin `[inspected]`:

```464:468:companion/src/llm/adapter.ts
8. ${
  os.platform() === "darwin"
    ? "osascript_eval is a LAST-RESORT macOS-only tool ..."
    : "osascript_eval is NOT available on this platform (Windows/Linux) and is not in your tool list. NEVER call it — use get_page_text or evaluate instead."
}
```

Darwin last-resort is **gated** (spec W5: must already have seen `CDP_ATTACH_FAILED`). Windows “instead” is **ungated everyday evaluate**. Spec §7 Rule 8 Windows line is only “不要调用 osascript（工具表无此项）” — it never says evaluate is last-resort-after-attach. The table cell in §5.4 does.

Cap 8 on **identical** `(family, exprHash, tabId)` success:

- a7ubt9 had **26 evaluate + 81 osascript**. Fold: those osascripts were **successes**. On Windows the same user goal is an evaluate success loop. Cap 8 then `DOM_SCRIPT_LOOP_CAPPED` + `suggested_action: stop_or_change_task`.
- Spec §12.2 already worries “同一 evaluate 读 9 个列表页”. On Windows that is the **primary** DOM tool, not the Mac extra. Same threshold is not “platform-equal”; it is **stricter where the tool is the only inject**.
- Cap is trivially bypassed by whitespace/comment in `code` (`exprHash` of the raw string). Storming models hop. Stopping models stop. a7ubt9 was the former.
- `empty_completion` counts as success. Spec’s own evaluate-null honesty (20/26 in the Mac trace) means “ran, returned null” still burns the budget.

**Linux is not win32.** `host_computer` hard-refuses off darwin/win32:

```1638:1641:companion/src/tool/companion-dispatch.ts
      const isMac = os.platform() === "darwin"
      const isWin = os.platform() === "win32"
      if (!isWin && !isMac) {
        return { success: false, error: `host_computer requires macOS or Windows (platform=${os.platform()})` }
```

§8 “linux | 同 win32” for 5.3 family is false at the product layer: after cap 8, win32 still has CU (if enabled); linux has **evaluate, then silence**.

### Inference

“Budgeted evaluate” is a **name** for a path that is either (a) already tried by click, or (b) the entire remaining write path, capped as if it were Darwin’s extra. Copying cap=8 from a Mac success-loop without a Windows residual is how you **manufacture** the `host_computer` temptation the one-liner forbids.

### MUST-FIX

1. **Do not** list `evaluate` as `suggested_action` for `CDP_ATTACH_FAILED` unless evaluate’s **scripting** world is known-good. If attach failed, say `list_tabs` / `retry_after_user_focus` / `stop_or_change_task`. Evaluate is the same debugger.
2. Split last-resort by OS in W5, not only “osascript omitted”:
   - darwin: osascript after typed `CDP_ATTACH_FAILED`, budgeted.
   - win32: **no third JS path**. If CDP+scripting both fail → typed dead-end, **not** “try evaluate”. If they succeed-but-don’t-publish → cap, then **stop** (see Attack 5).
   - linux: same dead-end; do not imply CU exists.
3. Either **raise** the identical-evaluate success cap on non-darwin (evaluate is the inject, not the extra) **or** keep 8 and **hard-stop** the thread’s DOM-script family (not recoverable hop to CU). Spec currently: capped but still `recoverable`. That is hop-bait.
4. Record in §8: X.com-class CSP last-resort is **darwin-only**. Wave-1 on Windows does not restore it. Do not let catalog keep “X.com CSP → osascript” as if the product were cross-OS.

---

## Attack 2 — `powershell`+`chrome` heuristic is Mac fingerprint with a Windows word glued on

**Spec §5.3**: family includes `shell_exec` if argv/command matches `osascript` / `osacript` / `execute javascript` / `chrome.automation`; **win32 另含 `powershell` 且同时含 `chrome` 或 `javascript`**. Fail-closed 偏计入.

Direction fold MUST #2 was broader: `powershell`/`cscript` **hosting Chrome JS**, plus `execute javascript` / `chrome.automation`. Spec **dropped `cscript`** and collapsed “hosting Chrome JS” into `powershell ∧ (chrome ∨ javascript)`.

### Falsification `[inspected]`

Windows `shell_exec` does **not** wrap in PowerShell. Node `spawn(command, { shell: true })` uses `%ComSpec%` = **cmd.exe**:

```288:308:companion/src/capability/shell.ts
 * Options for Node spawn of shell_exec children (legacy shell:true path).
 * windowsHide: true on win32 ...
    shell: true,
    ...
    detached: process.platform !== "win32",
```

`shouldUseArgvSpawn` on win32 only for `.exe`/`.com`. Bare names stay **cmd**.

So:

| Command the model actually sends | Spec heuristic | Reality |
|----------------------------------|----------------|---------|
| `powershell -c "Start-Process chrome"` | **HIT** (`powershell`+`chrome`) | Launch browser. **False positive.** Spec §12.3 already asked this. Unanswered. |
| `powershell -c "Get-Process chrome"` | HIT | Process list. False positive. |
| `cmd /c start chrome` / `start chrome` | MISS (no `powershell`) | Default `shell:true` shape. |
| `cscript //nologo inject.js` (direction named this) | MISS (dropped) | Classic Windows JS host. |
| `mshta javascript:...` / `wscript` | MISS | LOLBIN JS. |
| `python -c "from selenium..."` / `node -e` CDP | MISS unless string contains `execute javascript` | Same bypass family as Mac `shell_exec osascript -e`, which is why fold #1 existed. |
| linux `xdotool` / `ydotool` / `wtype` type into Chrome | MISS | linux “同 win32” is empty. |

Fail-closed **偏计入** is actually **fail-open on the real Windows shell** (cmd) and **fail-closed on the English word `powershell`**. That is the inverse of a7ubt9: there the bypass was `shell_exec` wrapping the **same** AppleScript. Here the fingerprint looks for a shell the spawn path does not use.

`exprHash` of a launch command vs an inject command is different keys — so even the false positive only caps **repeated identical** `Start-Process chrome`, not a mixed session. The false **negative** is the storm hole: cmd/cscript/node/python inject never enters `dom_script`.

### MUST-FIX

1. Restore direction’s `cscript` / restore a **DOM-inject** predicate, not `powershell∧chrome`.
2. Fingerprint the **payload**, not the interpreter brand: `execute javascript`, `chrome.automation`, `--remote-debugging-port`, `Runtime.evaluate`, `document.querySelector`, `el.click()`, `chrome.debugger`. Interpreter (`powershell`/`cmd`/`cscript`/`mshta`/`node`/`python`) is optional context, not the match.
3. Explicit **allow** for `Start-Process chrome` / `Get-Process chrome` / `tasklist | findstr chrome` — launching or listing Chrome is not DOM inject.
4. linux: either name `xdotool`/`ydotool` in the same family or write “linux shell heuristic is best-effort; CU does not exist.” Do not write “同 win32”.
5. DoD must include: `powershell -c Start-Process chrome` **not** capped; `cscript`/`cmd` string that contains `execute javascript` **capped**; parameterized `platform: win32` (no need for a VM).

---

## Attack 3 — `press_key` Meta vs Ctrl: three encodings, dual-send is theater, Win-key fear is Mac folklore

**Spec §5.5**: catalog/description darwin Meta（掩码 **8**），win32/linux Ctrl（掩码 **2**）. **不**自动重映射（避免 Win 键误伤）. `fill_form` 继续双发 Meta+A 与 Ctrl+A.

Direction MUST #3: “tell the model Ctrl on win32/linux, Meta on darwin; **do not require the LLM to know bitmask 8 vs 2**.” Spec **re-introduced the numbers**.

### Falsification `[inspected]`

**Encoding A — CDP official** (Chrome DevTools Protocol Input.dispatchKeyEvent): Alt=1, Ctrl=2, **Meta/Command=4**, **Shift=8**. No `ctrlKey`/`metaKey` boolean fields. Extra JSON is ignored. [web:0]

**Encoding B — CMspark catalog / `press_key` docs**: Alt=1, Ctrl=2, **Shift=4, Meta=8** (`tool-definitions-catalog.json` lines 360–362). **One** catalog for all platforms. `getToolDefinitions` only filters `osascript_eval` — there is **no** description mutator for press_key.

**Encoding C — what the extension actually sends:**

fill_form “Mac” half uses **CDP Meta=4** + a non-protocol `metaKey: true`:

```846:861:chrome-extension/src/background/browser-bridge.ts
        // Select all and delete — P1 CORR-06: macOS needs Meta+A; also send Ctrl+A for others
        // P1 CORR-06: send Meta+A (macOS) then Ctrl+A (others) — both are no-ops on wrong OS
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
          type: "keyDown", key: "a", code: "KeyA", metaKey: true, modifiers: 4,
        })
        ...
        // Ctrl+A (Windows/Linux)
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
          type: "keyDown", key: "a", code: "KeyA", ctrlKey: true,
        })
```

Ctrl+A sets **`ctrlKey` only**. No `modifiers: 2`. No `windowsVirtualKeyCode: 65`. CDP consumer sees **modifiers=0**. `[assumed]` no-op for Select All on Windows. Dual-send is **Mac-working + Windows-comment**.

`press_key` uses CMspark bitmask **booleans**, never the CDP `modifiers` field, never VK:

```1138:1150:chrome-extension/src/background/browser-bridge.ts
  private async pressKey(...) {
    const modifiers = params.modifiers || 0
    await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown", key: params.key, code: params.code || `Key${params.key.toUpperCase()}`,
      ctrlKey: !!(modifiers & 2), altKey: !!(modifiers & 1), shiftKey: !!(modifiers & 4), metaKey: !!(modifiers & 8),
    })
```

Same file **already knows** Windows needs VK — scroll PageDown sets it:

```959:968:chrome-extension/src/background/browser-bridge.ts
      const pageKey = deltaY > 0 ? "PageDown" : "PageUp"
      const vk = deltaY > 0 ? 34 : 33
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
          type: "keyDown", key: pageKey, code: pageKey,
          windowsVirtualKeyCode: vk,
          nativeVirtualKeyCode: vk,
        })
```

fill_form Delete / press_key / fill_form Ctrl+A do **not**. The Windows-aware pattern exists **one function up** and was not applied. Classic Mac-shaped leftover.

If an implementer “fixes” §5.5 by passing catalog mask **8** through as CDP `modifiers`, they send **Shift**, not Meta. That is a footgun the spec loads by documenting mask 8.

**“避免 Win 键误伤”** is the wrong threat model. `press_key` is `chrome.debugger` **into the tab**. Meta in CDP is Command/Windows **as a page modifier**, not `SendInput` of VK_LWIN to the shell. Opening Start Menu is `[assumed]` not what tab-targeted `dispatchKeyEvent` does. fill_form already dual-sends Meta then Ctrl **because** the wrong chord is a **page no-op**. Refusing auto-remap / dual-send for `press_key` while calling fill_form dual-send the Windows strategy is inconsistent.

Catalog today cannot implement “darwin description vs win32 description” without new code. Spec §8 does not mention that mutator. W5 “catalog lock-step” on a single JSON will teach **every** model Meta=8.

### MUST-FIX

1. **One** wire encoding: CDP `modifiers` (Meta=4, Shift=8) + `windowsVirtualKeyCode`/`nativeVirtualKeyCode` on **all** `dispatchKeyEvent` (press_key, fill_form Select All / Delete). Stop sending DOM `ctrlKey` booleans as if they were protocol.
2. Map CMspark catalog mask → CDP mask in **one** helper. Document that helper. Do **not** teach the LLM two masks.
3. Wave-1 Windows/Linux: dual-send **in the tool** (Meta chord + Ctrl chord), same as fill_form **after** fill_form Ctrl actually sets `modifiers: 2` + VK 65. Prompt-only “use Ctrl on Windows” is W5-as-W3, which this whole batch already rejected for osascript.
4. Drop “Win 键误伤” or demote to a comment. If OS-level Win is ever a risk, that is host_computer, not press_key.
5. Test (extension unit, fake `sendCdp`): fill_form emits `modifiers: 4` **and** `modifiers: 2` (or helper-equivalent); press_key `modifiers: 2` on win32 description path sets CDP Ctrl bit, not Shift.

---

## Attack 4 — missing win32 tests; DoD is Darwin-named “platform-free”

**Spec §8**: 测试 | Node 平台无关单测 | 同套 | 同套. §10: ten Node cases. Item 7: `shell_exec` **含 osascript** 计入. “**不要**声称 a7ubt9 在 Windows 已复放.” Direction MUST #3: “one test that fill_form still dual-sends” — **dropped from spec DoD**. Direction MUST #5: fake `tabs.get` for attach typing, no Windows VM — fine, and then they shipped **zero** of the Windows-shaped cases that do not need a VM.

### Falsification `[inspected]`

Existing coverage:

| Test | What it proves | Windows product? |
|------|----------------|------------------|
| `bridge.test.ts` `shouldExposeOsascript("win32")===false`; linux names hide osascript | Tool table omit | **Yes**, already done |
| `shouldExposeOsascript("linux")` | **Not asserted** (only darwin/win32 helpers; linux via `getToolDefinitions`) | nit |
| Rule 8 / Rule 12 **strings** by platform | **No test** | The NEVER-host lie would not fail CI |
| fill_form dual-send | **No test** in chrome-extension | CORR-06 is a comment |
| press_key CDP `modifiers` / VK | **No test** | |
| dom_script heuristic `powershell`+`chrome` | **Not implemented**, and DoD only names osascript | Glue |
| host_computer refused on linux | exists in dispatch, not in this spec’s DoD | §8 “同 win32” untested as a **product** claim |

“Platform-free Node tests” is correct for `resolveLocator` 0/1/≥2. It is a **dodge** for §5.3–5.5, which are **defined** as platform-branching. A parameterized `platform: "win32"` in companion tests is how this repo already tests apps/ACP/uv (`apps-llm-index.test.ts`, `acp-win-spawn.test.ts`, …). The spec tells the implementer not to do that work.

Not replaying a7ubt9 on Windows is honest. Using that honesty to skip **contract** tests is not.

### MUST-FIX (DoD additions, still no VM)

11. `getToolDefinitions("win32"|"linux")` — no `osascript_eval` (exists). Add Rule 8 excerpt contains `NOT available` and does **not** promise a third JS path.
12. Rule 12 win32/darwin/linux: `NEVER … host_computer … browser-DOM` **or** whatever sentence you actually lock (today’s text would **fail** this test).
13. Heuristic table: see Attack 2.5 — win32 + linux fixtures, not `if (process.platform)`.
14. fill_form / press_key CDP payload (Attack 3.5).
15. `host_computer` on `platform=linux` → typed refuse; spec §8 must not say linux=win32 for last-resort.

Keep “do not claim a7ubt9 replayed on Windows.”

---

## Attack 5 — `host_computer` temptation is the Windows product, and the spec refused to look

**Spec one-liner / §11**: 不做网页默认 `host_computer`. Direction table row (later **deleted** from spec §8): “Win Rule 12 already says NEVER host_* for browser-DOM.”

### Falsification `[inspected]`

Win32 Rule 12 `[inspected]`:

```430:431:companion/src/llm/adapter.ts
   NEVER use host_read/host_write for browser-DOM tasks — use get_page_text / evaluate instead.
   NEVER propose these tools speculatively — only when the user's task cannot be accomplished via browser alone.
```

`these tools` in the win32 block are host_read / host_write / host_app / host_cli. **`host_computer` is not in the win32 Rule 12 body at all** (it appears in the darwin Rule 12 as LAST RESORT pixel inject). Shared **12b** (injected on **all** platforms, including linux where the tool then errors):

```447:448:companion/src/llm/adapter.ts
12b. host_computer playbook (when coordinate CU is enabled and required):
   - Prefer structure first: browser CDP for web; ... host_computer is LAST RESORT pixel/OCR inject.
```

Scroll already **names** CU when CDP/scripting exhaust:

```1130:1133:chrome-extension/src/background/browser-bridge.ts
          "Try press_key PageDown, or host_computer scroll if coordinate mode is on. " +
```

a7ubt9 user **asked** for `host_computer` after CDP lied (`memory/project-knowledge.md`). Diagnosis + all three adversaries + fold correctly refused CU-as-web-default **on Mac**, where osascript still wrote the 知乎 draft. On Windows:

1. osascript omitted (good).
2. evaluate named as substitute (Rule 8).
3. Same-expression success cap 8 (recoverable).
4. 12b: CU is last resort.
5. Rule 12 NEVER does not mention `host_computer`.
6. Chrome can be an Apps GUI entry with `coordinateAllowed` (user opt-in, not default — still the **remaining inject** after cap).

That is not “网页默认”. It is **网页失败后的设计漏斗**. Spec §8 deleted the host_computer row rather than make Rule 12 match the slogan. Implementers will ship the slogan and the 12b funnel.

Linux: 12b still injected; tool returns `host_computer requires macOS or Windows`. Prompt vs runtime split. Table glue.

### MUST-FIX

1. Rule 12 **all platforms**: `NEVER use host_computer for browser-DOM / http(s) tabs. Browser tools only. host_computer is host apps, not Chrome.` Same sentence darwin/win32/linux. 12b must not contradict it (“last resort pixel inject” **of a whitelisted host app**, not of the page).
2. `DOM_SCRIPT_LOOP_CAPPED` / `CDP_ATTACH_FAILED` after evaluate+scripting fail: `suggested_action` **must not** be host_computer. `stop_or_change_task` only.
3. Strip “or host_computer scroll…” from browser-bridge scroll warning (or gate it: only if the **target is not a browser tab**).
4. Put the host_computer row **back** in §8, with linux = **tool absent/refused**, not “同 win32”.
5. Trust: CU on Chrome window remains user-opt-in `coordinateAllowed` + critical L2. Wave-1 must not **prompt-steer** into it when the locator/cap fails.

---

## Other Windows/Linux nits (not the ranking, still fold)

**NIT-A — `edge:` in §5.1, not in `ensureAttached`.** Spec classifies `edge:` / `devtools:` as `WRONG_ORIGIN`. `ensureAttached` only special-cases `chrome-extension://` and `chrome://`. On Windows, sideload-in-Edge and `edge://`, `edge-extension://`, `chrome-untrusted://` will throw generic attach failure → risk of `CDP_ATTACH_FAILED` or `ELEMENT_NOT_FOUND` instead of `WRONG_ORIGIN`. Implement origin check from `tabs.get(tabId).url` as spec 5.1 already says; expand the scheme list.

**NIT-B — `file:` PDF (spec §12.4).** Windows `file:///C:/Users/…/x.pdf`. Not http(s), not chrome-*. Attach fail currently becomes locator miss. Same on all OS; more common on Windows Downloads. Classify `file:` attach fail as `CDP_ATTACH_FAILED` or a new `FILE_SCHEME_NO_CDP`, not `ELEMENT_NOT_FOUND`.

**NIT-C — IME `[assumed]`.** Windows Ctrl+Space / Ctrl+Shift IME. Dual-send Ctrl+A during composition can eat a composing character instead of select-all. Out of wave-1 if fill_form Ctrl actually works; mention as residual.

**NIT-D — Chrome vs Edge host process.** osascript hard-codes `"Google Chrome"`. Windows CU whitelist is exe path. Wave-1 correctly refuses UIAutomation-on-Chrome. Do not let implementers “fix” Windows last-resort by adding `msedge.exe` coordinate default.

**NIT-E — linux shell family.** `xdotool type`, `ydotool`, `wtype` are the linux analogue of Darwin `osascript -e`. Spec heuristic will not see them. Either fingerprint or document residual.

---

## What I tried to turn into extra blockers (and did not)

| Hypothesis | Result |
|------------|--------|
| W1 `resolveLocator` is Mac-only | **Falsified.** Extension JS. Same on Chromium MV3. |
| `shouldExposeOsascript` is theater and the tool still ships on win32 | **Falsified.** Filter + L2 gate + macos-only error string; tests hide it. |
| Cap 8 should be skipped on Windows | **Rejected as a product idea** (that is `if darwin cap else skip`, which spec correctly forbids). The fix is **honest last-resort + no CU funnel**, not skipping the cap. |
| Must add UIAutomation-on-Chrome in wave-1 | **Rejected.** New L2 surface; spec non-goal is right. |
| Auto-remap Meta→Ctrl in press_key is enough | **Insufficient** while the CDP wire ignores booleans and uses the wrong mask. |

---

## Implementer MUST (fold these or keep REJECT)

1. **Last-resort matrix** in §8 that is code-true: darwin = osascript AppleEvent; win32/linux = **no third JS path**; evaluate is not that path.
2. `CDP_ATTACH_FAILED` must not `suggested_action: evaluate` by default.
3. Cap 8 stays **or** is raised with an explicit Windows rationale; either way **capped ⇒ not recoverable into CU**.
4. Heuristic = inject payload, not `powershell∧chrome`; include cmd/cscript; exclude Start-Process chrome; linux not “同”.
5. press_key/fill_form: CDP `modifiers` + VK; one mapping helper; dual-send in tool; catalog not teaching mask 8 as CDP Meta.
6. Rule 12/12b: NEVER `host_computer` for browser-DOM, all OS; restore §8 host_computer row; linux CU refused.
7. DoD items 11–15 above (parameterized, no VM). Still do not claim a7ubt9 Windows replay.

Until 1–7 are in the spec, implementers will: copy cap 8, grep `powershell`, change a catalog sentence to “use Ctrl on Windows”, and ship a Mac policy that **steers Windows storms into CU**.

---

## Verdict

| Question | Answer |
|----------|--------|
| Is W1/W4/§5.1/§5.2 honest on win32/linux? | **Yes** — Chromium MV3. Ship. |
| Is §8 + §5.3–5.5 + Rule 8 Windows line honest? | **No** — Mac-shaped, table glued on. |
| Implementable as written without lying to the model? | **No** — evaluate is not osascript; fill_form Ctrl is not CDP Ctrl; Rule 12 NEVER is not NEVER host_computer; linux is not win32. |
| a7ubt9 Windows replay claimed? | **No** (good). Used as cover to skip contract tests (bad). |

**VERDICT: REJECT** (Windows/Linux honesty of this spec).  

Re-review trigger: spec diff that folds MUST-FIX 1–7. Then this lane can move to APPROVE_WITH_NITS. W1 locator lock does not need to wait if it is a separate patch without pretending §8 is done.

```text
ADVERSARY_WIN32: REJECT
W1_LOCATOR: APPROVE (not in dispute this lane)
HOST_COMPUTER_AS_WEB_DEFAULT: still no — and the spec must stop accidentally designing it in
```
