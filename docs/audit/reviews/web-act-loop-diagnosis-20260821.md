# Web act-loop diagnosis — thread `a7ubt9` + sibling surfaces

**Date**: 2026-08-21  
**Status**: DIAGNOSIS (no implementation this document)  
**Blast**: T2 direction-lock (L1 browser Surface). Not a new runtime.  
**Trace**: `~/.cmspark-agent/threads/a7ubt9.json` (466 messages)

## Capability (ADR-020)

```text
Surface:      L1 browser CDP (click/type/read); host_computer is L2 last resort
L2-classes:   none new; evaluate/osascript already L2
Compose:      none
Autonomy:     single
Trust:        monotonic — better locators must NOT skip L2 evaluate/osascript
Channel:      community
```

## What the user actually hit

User: read the open tweet, compare Google “LLMs can’t jump” vs OpenAI “LLM can jump”, then publish to 知乎.

Tool histogram (assistant calls): `osascript_eval` **81**, `shell_exec` **54**, `evaluate` 26, `navigate` 15, `get_page_text` 14, `click` **3 (all failed)**.

User interventions in-thread: stop retrying `get_element_info`; why not `host_computer`; stop CDP after repeated failure.

## Ranked root causes

### RC1 — Locator primitive is CSS-only (highest leverage)

**Evidence**
- Catalog: `click` / `dblclick` / `get_element_info` **require** `selector`. `type` selector optional but click-to-focus still CSS. `tool-definitions-catalog.json` ~167–260.
- Runtime: `browser-bridge.ts` `click` / `getElementCenter` / fallback `document.querySelector` only (~777–804).
- Docs already pretend text click exists: `docs/architecture.md:305` `click("员工管理")`.
- Finder already exists and comments *future click({text})*: `find-element-by-text.ts:1-3`. Wired only to `browser_download` (`browser-download-handler.ts`). Plan D10 (`docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md:129`) already said independent `click({text})` can reuse the finder. **Not delivered.**
- a7ubt9: `click` `a[href*="blog" i]` — `querySelector` does not support the CSS4 `i` flag in this path; Zhihu `textarea.Input` / Draft.js selectors miss.

**Inference**: The model is forced to invent CSS for React/X/知乎. That is the primary capability hole, not “Chrome is uncontrollable.”

### RC2 — No observe step for interactive controls

**Evidence**
- Tools: `get_page_text` (visible text blob), `get_page_html` (≤500k HTML), `screenshot`, `get_element_info` (needs selector). No `snapshot` / uid list.
- Chrome DevTools MCP / Playwright: snapshot → uid → click.
- Prompt (`adapter.ts:453-467`): “You control a real Chrome browser” + list_tabs + get_page_text. **No** “snapshot before click.” Contrast `12b` observe→act for `host_computer` (`adapter.ts:447-451`).

**Inference**: Desktop CU has a playbook; **web L1 does not**. Model guesses locators, then HTML-dives.

### RC3 — Recoverable errors without a next action = retry storm

**Evidence**
- `security.ts:949-959`: `"element not found"`, `"not found"`, `"cannot access"`, `"chrome-extension://"` are **recoverable**.
- `click` error is a bare string `Element not found for selector: …` (`browser-bridge.ts:804`). No `error_code`, no `suggested_action`, no match list.
- `browser_download` already returns `ELEMENT_NOT_FOUND` / `ELEMENT_AMBIGUOUS` + `user_hint_zh` + `suggested_action` (`browser-download-handler.ts:162-183`).
- a7ubt9 streaks: `get_element_info` ×4, `click` ×2, `press_key` ×4 on `chrome-extension://` attach failure.

**Inference**: The classifier *encourages* another turn. Download learned this; click did not copy the contract. Same pattern will fire on any CSS-only tool.

### RC4 — Prompt / catalog / policy contradiction

**Evidence**
- Rule 8: osascript LAST-RESORT, prefer get_page_text/evaluate (`adapter.ts:466`).
- Rule 12/12b: host_computer LAST-RESORT; prefer CDP for web (`adapter.ts:448`).
- a7ubt9: 81 osascript, 1 host_computer only after the user ordered it.
- `evaluate` and `osascript_eval` are both L2 (`l2-admission.ts:50-51`). User config `security.auto_approve_dangerous: true` → both skip confirm. Osascript becomes a free CDP clone (`execute t javascript`).
- Catalog click requires selector; architecture shows text; prompt never mentions `text` locator.

**Inference**: Last-resort is **prose**, not a machine gate. Auto-approve + recoverable “not found” makes osascript the cheapest retry.

### RC5 — Wrong-surface attach (`chrome-extension://`)

**Evidence**
- `get_page_text` / `press_key`: `Cannot access a chrome-extension:// URL of different extension`.
- Recoverable via `chrome-extension://` and `cannot access` (`security.ts:968, 964`).
- No typed `WRONG_ORIGIN` / `suggested_action: list_tabs`.

**Inference**: Writer UIs, PDF viewers, password managers steal the “active” tab. Agent hammers CDP on a tab it cannot script.

### RC6 — `type` fallback is input/textarea-only

**Evidence**
- `typeText`: CDP `Input.insertText` then fallback `el.value = …` only if `INPUT`/`TEXTAREA` (`browser-bridge.ts:822-833`).
- a7ubt9 Zhihu: Draft.js `contenteditable`; agent used osascript `execCommand`.
- If CDP attach works, insertText is fine; if click-to-focus failed, type never runs.

**Inference**: Secondary to RC1. Matters for 知乎/Notion/Google Docs once locators work.

### RC7 — Sibling surfaces already solved pieces; web click did not absorb them

| Surface | What it already has | Gap vs web click |
|---------|---------------------|------------------|
| `browser_download` | text **or** selector; ELEMENT_* + zh hint | click/type did not reuse |
| `host_computer` | observe→act prompt; NL target | L2; last resort for web by design |
| `scroll` catalog | honest “moved=false, don’t claim” | click has no equivalent honesty |
| Pack `tool_not_allowed` | recoverable + suggested unapply | click has none |
| Meeting STT (this week) | timeout + suggested next copy | click waits forever in LLM loop instead |

## Candidate directions (for judges to rank, not implement)

| ID | Direction | Addresses | Cost | Risk |
|----|-----------|-----------|------|------|
| **W1** | `click`/`type`/`get_element_info` accept `text` (reuse finder); structured `ELEMENT_*` like download | RC1, RC3, D10 leftover | S | Wrong-click if ambiguous — **fail-closed** like download |
| **W2** | `snapshot_page` interactive a11y/role list + uid | RC2 | M | Token size; shadow DOM |
| **W3** | Machine act-loop: max N identical locator fails; osascript **blocked** for http(s) DOM when CDP tools exist; `chrome-extension://` non-retry typed error | RC3, RC4, RC5 | S | Might block rare needed osascript |
| **W4** | `type` contenteditable: insertText + execCommand/beforeinput, not `el.value` | RC6 | S | Editors with custom models |
| **W5** | Prompt lock-step: web observe→act; catalog descriptions match architecture; never last-resort-only-in-prose | RC4 | XS | Prompt-only without W1/W3 will fail again (D1: schema wins) |

**Implementer recommendation (not a verdict):** **W1 + W3 first** (absorb existing download contract + stop storms). **W2** as the L1 SoT in a second wave. **W4** with W1 for 知乎. **W5** only lock-step with schema, never instead of it. Do **not** make `host_computer` the default web path (Trust: L2 pixel on Chrome window).

## Explicit non-goals this round

- New agent runtime / “中层 Agent”
- Default-on CU for web
- Vendoring chrome-devtools-mcp as the Side Panel loop (different topology)

## Attack list for independent judges

1. Is RC1 overstated vs “model too dumb / Zhihu anti-bot”?
2. Would W3 (osascript block on http) break a legitimate use (iframe, file:, extension page)?
3. Is W2 required in wave-1 or gold-plating?
4. Did we miss evaluate-as-click (L2) as the real intended path?
5. Cross-surface: ACP / CU / MCP filesystem retry storms with the same recoverable-without-hint pattern?
6. Fail-closed text click: ELEMENT_AMBIGUOUS must not auto-pick (download D lock).
7. Trust: text click must not skip domain confirm on navigate; click itself is not L2 today — keep it that way.
