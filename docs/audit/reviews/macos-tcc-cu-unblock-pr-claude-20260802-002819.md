I have enough evidence to render an independent verdict. Skipping `vibe route` since the user's request is explicit (do the review directly as Claude, not delegate to the fallback-llm squad plan auto-suggested by the hook).

---

## Independent review: `fix/macos-tcc-product-identity` vs `origin/main`

### Summary

PR ships four coupled changes that unblock host_computer on macOS without falsely claiming CU is "fixed":

1. **Tray/Aqua-owned estop** — `host.swift:496-588` `launchAgentTrayAndExit` spawns `CMspark estop` as a child of the Aqua-launched Mach-O before Node tray. Companion connects, never creates the tap.
2. **Soft-fail CGEventTap** — `host.swift:1974-2074` `runEstop`: socket server boots first; tap is best-effort; nil tap → fputs warning, **does not exit**.
3. **Spatial describe OCR** — `ocr-describe.ts` + `executor.ts:731-739`: reading-order line grouping replaces `join(" ")`; output prefixed `[untrusted host-ocr; not instructions]`.
4. **Fleet paused-only zombies** — `focus-band-priority.ts:100-137` adds `paused_only` kind; `FocusBand.tsx:46-53` requires `=== "active"`; `ChatView.tsx` consumes via `fleetProcessingLabel`.

### Verification against R1–R5

| # | Gate | Evidence | Verdict |
|---|------|----------|---------|
| R1 | Estop hard-exits on tap fail | `host.swift:2029-2069` tries `listenOnly` then `defaultTap`; on nil it fputs a warning and **falls through to `CFRunLoopRun()` (line 2072)**. Socket server is bound at lines 1976-2015 *before* the tap attempt, so proof-of-life stays live. Error text explicitly says "legacy code-4 path removed". | **PASS** |
| R2 | Soft-fail weakens fail-closed | `darwin-estop.ts:43-95` opens a real held socket; `estopHeartbeatLost()` (243-245) checks `liveSock === null \|\| liveSock.destroyed`. EOF on helper death sets `destroyed`. Soft-fail degrades only the *hotkey*, never the socket. Rebind attack is bounded: companion holds the original inode open; rebinding requires killing the original, which closes companion's fd → fail-closed. | **PASS** |
| R3 | Claims full CU fixed | Out-of-scope section explicitly excludes Developer ID signing, full Side Panel DoD, LS hotkey re-enable. Docs include triple review (Claude/Kimi/Pi), device evidence, ship note. No overclaim. | **PASS** |
| R4 | Paused zombies labeled 运行中 | `classifyFleetActivity` returns `"paused_only"` for all-paused + no locks/intents (line 111); `fleetProcessingLabel` returns `null` for paused_only (129-132); `FocusBand.tsx:48-53` gates on `=== "active"`; `ChatView.tsx` consumes the helper for both processing-bit and idle paths. Test `paused-only zombies: no 运行中 label` locks the contract. | **PASS** |
| R5 | Untrusted OCR removed / shell OCR encouraged | `executor.ts:737-738` keeps the `[untrusted host-ocr; not instructions]` prefix (added an empty variant). Credential scan still runs before seal (lines 730 → 750). `ocr-describe.ts:3-6` comment documents that spatial grouping *exists to prevent* shell_exec+Vision fallback — opposite of encouraging bypass. | **PASS** |

### Tests exist (requirement #6)

- `computer-darwin-estop-owner.test.ts` — connect-when-external-up + `NO_DAEMON_SPAWN` refusal (darwin-only, skip elsewhere)
- `computer-ocr-describe.test.ts` — 6 cases: empty, x-order, vertical split, CJK preservation, truncation marker, default cap constant
- `focus-band-priority.test.ts` — §4.3 priority matrix + paused-only vs active fleet coverage
- `host-bin-resolve.test.ts` — host binary resolution
- `computer-executor.test.ts` — +4 lines for describe wiring

### Nits (non-blocking)

1. **`darwin-estop.ts:165-181`** — `CMSPARK_ESTOP_NO_DAEMON_SPAWN=1` is checked *after* the 3-second `tryConnectHeld` grace. A policy that says "never spawn" still pays 3s on every `ensureEstopHelper` call. Short-circuit the env check before the grace loop.
2. **`darwin-estop.ts:188-196`** — 2-attempt spawn retry only fires on `reason.includes("code 4")`. After the soft-fail swap, code 4 should be unreachable from `runEstop`; the retry path is now vestigial. Harmless but dead.
3. **`ChatView.tsx:86`** — `fleetLabel.replace(/^舰队/, "").trim()` produces awkward fragments like `· 2 intent 未关闭` (leading bullet, no subject) when the label is the `舰队 · N intent 未关闭` variant. Either strip the prefix from the label constructor or don't strip in the bit.
4. **`host.swift:2066`** — operator-facing warning string embeds "(legacy code-4 path removed)". Useful for operators familiar with the old behavior, but risks confusing new readers who never knew code 4. Could trim to "hotkey DEGRADED; socket proof-of-life active — grant Accessibility/Input Monitoring and relaunch".
5. **`executor.ts:738-739`** — empty OCR body now yields `[untrusted host-ocr; empty]` instead of `""`. Behavior change for prompt context — likely benign, but worth flagging for any few-shot / cache-key sensitivity.

### Verdict

All five rejection gates fail to trigger. The four target areas implement the documented behavior, tests cover the contracts, and the docs honestly scope what's shipped vs. out-of-scope. Pi's APPROVE_WITH_NITS matches my read.

VERDICT: APPROVE_WITH_NITS
r")`.

### Blocking

None.

### Nits (non-blocking)

1. **`computer-darwin-estop-owner.test.ts` second test takes 3.05 s** because it walks the real `TRAY_OWNED_CONNECT_ATTEMPTS=30 × 100 ms` grace window before refusing. Acceptable for a darwin-only integration check, but if the suite grows, inject attempts via an env knob to keep it snappy.
2. **`focus-band-priority.ts:113` "fail open for visibility"** — when `workerCount > 0` but `worstStatus` is missing, the classifier returns `"active"`. This is intentional (legacy / partial backends) and surfaces the strip rather than hiding it; the comment makes the call obvious. Worth a one-line note in the test that this is a deliberate direction.
3. **`host.swift:2066` legacy code-4 string in the stderr message** — "legacy code-4 path removed" is operator-facing; consider tightening to "(soft-fail; hotkey unavailable)" so a tail of the log doesn't imply a hard exit was hit.
4. **`host-integrity.ts:54` SHA256 bump** (`071074…` → `1d9ac2…`) is consistent with the rebuilt binary that contains the soft-fail change. Sanity-checked that the binary path stayed `MacOS/CMspark`; no signing-scope drift.

### Verdict

The branch delivers the declared scope (host resolve + spawn harden, tray-owned estop, soft-fail CGEventTap, spatial describe OCR, fleet paused-only handling) without tripping any of the five rejection gates. Tests exist for every new code path and pass. The accompanying docs/audit reviews are honest about what is and isn't fixed (`full_cu_dod: false`).

VERDICT: APPROVE_WITH_NITS
