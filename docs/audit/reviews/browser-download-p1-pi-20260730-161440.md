Now I have a comprehensive understanding of the entire diff. Let me compile my findings.

---

## Review: browser-download-p1 (Round 4)

### Verification of claimed fixes

**R4 fix — BD-TIMEOUT-DEADLINE-UNASSERTED**: ✅ Confirmed. `download-waiter.test.ts` now includes:

- `"download waiter: timeout → DOWNLOAD_TIMEOUT"` (line 85) — asserts `setTimer` is called with `ms === timeoutMs` via the injectable clock.
- `"download waiter: wall-clock setTimeout path honors short timeoutMs"` (line 179) — uses production `setTimeout` default (no injectable `setTimer`), asserts `elapsed >= 25` for a 40ms timeout, proving the production path doesn't silently ignore `timeoutMs`.

In `download-waiter.ts`, the timer wiring is:
```ts
const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms))
// ...
timer = setTimer(() => { finishErr(...) }, opts.timeoutMs)
```
And the error message references `opts.timeoutMs` — so deadline is both asserted and surfaced in the error string.

**Plan verification checklist:**

| # | Item | Status |
|---|------|--------|
| 1 | Path sandbox Downloads-only; UNC/escape | ✅ `path-sandbox.ts` + handler UNC check (defense-in-depth). Tests cover `..` escape, sibling prefix, junction realpath, UNC, device paths. |
| 2 | Alias download→browser_download before sandbox | ✅ `server.ts:484-485` renames before path sandbox (line 686) and before `resolveToolDispatchTimeoutMs` (line 2221). Companion test `"download alias → prepare PATH_ESCAPE"` confirms. |
| 3 | DOWNLOAD_BUSY before TabQueue | ✅ `runWithDownloadBusyBeforeQueue` acquires busy bit, enters TabQueue only on success, rejects concurrent same-tab immediately. Unit test `"concurrent same-tab browser_download → DOWNLOAD_BUSY (not TabQueue serialize)"` proves busy-before-queue with asserted `innerEntered === 1`. |
| 4 | Waiter onCreated-only | ✅ `download-waiter.ts` tracks only ids from `onCreated`; `onChanged` ignores untracked ids. Test `"ignores complete without prior onCreated (pre-existing)"` and `"rejects onCreated with startTime before registration"` confirm. |
| 5 | text\|selector; no new L2 dialect | ✅ Zod schema `refine((v) => !!(v.selector \|\| v.text))`. `browser_download` is NOT in `L2_GATE_TOOLS`. No new confirmation path. |
| 6 | Tool catalog inject ok | ✅ `ensureBrowserDownloadTool` injects `BROWSER_DOWNLOAD_TOOL` at `getAllToolDefinitions()` cache time. Test `"browser_download is in tool catalog"` passes on all platforms. |
| 7 | ADR-020 declaration | ❌ **BLOCKING** — see below. |

---

### BLOCKING: Missing ADR-020 capability declaration

Per `docs/audit/reviews/_templates/dual-review-capability-checklist.md`:

> *If missing and the diff is not pure docs/test/refactor, treat as **nit** at minimum; if the change adds tools/gates/UI entry points, treat missing declaration as **blocking**.*

The implementer prompt does **not** include the required `Surface / L2-classes / Compose / Autonomy / Trust / Channel` declaration block. This diff is not pure docs/test/refactor — it adds the `browser_download` tool (a substantially new tool replacing the trivial `Browser.setDownloadBehavior`-only `download` with full chrome.downloads orchestration, busy gates, and path sandboxing). The plan document `2026-07-29-windows-download-platform-tools.md` mentions ADR-020 in its metadata but does not contain the formal axes declaration in the format the checklist requires.

The declaration is straightforward to provide; the tool is:
- `Surface: L0` (standard browser tool, no L2 for default Downloads path)
- `L2-classes: (none)`
- `Compose: none`
- `Autonomy: n/a`
- `Trust: sandbox-only (Downloads root)`
- `Channel: community`

But until it's in the implementer prompt/PR body, the checklist gates this as blocking.

---

### Nits (non-blocking)

1. **`companion/src/server.ts:691` — `as any` cast**: `threadManager.get(actingThreadId) as any` bypasses type safety. The `try/catch` guards runtime failure, but a proper `ThreadInfo` interface with an optional `agent_role` field would be cleaner.

2. **`chrome-extension/src/background/browser-bridge.ts:34` — public mutable `downloadBusyTabs`**: `downloadBusyTabs: Set<number>` is a public property with no access control. Direct external mutation could break the busy-gate invariants. Consider making it private with a read-only accessor.

3. **Duplicate UNC check**: Both `browser-download-handler.ts:55` and `path-sandbox.ts` (`isUncOrDevicePath`) check UNC paths. The handler-side regex (`/^\\\\/` and `/^\/\/[^/]/`) is a subset of sandbox-side checks (which also cover `\\?\` device paths). This is fine as defense-in-depth, but a comment noting the intentional redundancy would help future readers.

4. **`download-waiter.ts:109,122` — `void promise.catch(() => {})`**: Suppressing unhandled rejections in `finishErr` and `dispose`. The intent (prevent unhandled rejections when `wait()` hasn't been attached yet) is reasonable, but this pattern can mask real bugs in the promise chain.

---

VERDICT: REJECT
