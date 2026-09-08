I'll read only the packet and follow its review instructions.# Independent design review — #474

**VERDICT: APPROVE_WITH_NITS**

Direction matches the user’s T2 ask: green = running, red = stopped, no adjacent “CMspark Agent running” chrome, authorized mark redesign, handlers untouched, no install-replace. The spec is implementable. It is not ship-ready until small-size, a11y-name, and dual-renderer contracts are nailed. No P0.

---

## What is clear and correct

Process color is the tray signal; WebSocket stays in details. That split is the right product cut and blocks the usual false “stopped” when the socket drops.

Three surfaces are differentiated well: extension = static green on transparent; app icon = same mark on a dark rounded plate; tray = transparent, state-tinted. Only the tray is live status.

Empty menu-bar title + no repeated Agent status header matches the “no adjacent running label” request. Tooltip / VoiceOver / details keep words for identification and color vision. Unknown is no longer copy-pasted as 已停止. Action bindings stay put.

Build story is sound: one JS geometry/PNG module, SVG as the audit artifact, Swift draws the same 24-grid at target resolution, compat tray emits 16/32/48 PNG/ICO, verify offscreen, no replacement in this ticket.

---

## Findings

**P1 — 16×16 mark will blob unless optically tightened.**
Three endpoints + a four-corner spark on a 24-grid, scaled to 16px, is ~0.67px per unit. “粗线、少节点” is not a stroke width. Without integer-aligned strokes (suggest 2–3 grid units), merged nodes, and a **blocking** 16/22/32 light+dark wallpaper preview, this ticket fails its own “清晰” goal. Same geometry at 24 is fine; 16 is the product.

**P1 — Color-only state fails color vision at a glance.**
Green vs red is the same path, recolored. Deuteranopia plus no-hover tray use means running/stopped collapse. Tooltip/VO are necessary but not sufficient. Add a cheap secondary cue that is still T2-visual: filled vs outline, or a one-grid cap on the spark. Yellow-as-third-state is not that cue.

**P1 — Empty title without `accessibilityLabel` is a functional regression.**
macOS tooltip ≠ VoiceOver name. Clearing the status item title (correct, per user) without an explicit AX label yields “status item” / silence. Spec must require `toolTip` **and** `accessibilityLabel` with distinct copy for 运行 / 已停止 / 检测中 / 未知. Unknown vs detecting must not share one string.

**P1 — JS and Swift are two path sources.**
“同一24网格” plus “SVG 可审计” does not stop drift. Freeze a coordinate table (or SVG path) as the single contract; Swift traces those numbers; add a hash or offscreen pixel check against JS PNG. Otherwise portability is a hope.

**MAJOR — Yellow buckets 检测中 and 未知.**
Same color is OK; same words are not. Detection is transient; unknown is stuck. Tray color may match; tooltip/VO/details must differ. Crash/clean-stop can both be red for T2; say so.

**MAJOR — Full-color tray vs template images, and contrast on wallpaper.**
State *is* hue, so `isTemplate` must be false. Green/red/yellow on arbitrary menu-bar wallpaper still needs a 1px contrasting edge (legibility, not glow). Yellow on light bar is the weak cell; the planned 明暗 preview must fail the ticket if it doesn’t read. Pin sRGB hexes so JS PNG and Swift agree.

**MAJOR — Extension/app icons are not live status.**
Always-green Chrome mark will be read as “Companion is up.” One sentence in the spec: only the tray encodes process state.

**NIT — Compat sizes.** Linux trays are often 22px; 16/32/48 miss that. ICO should embed 16 and 32 (48 optional).
**NIT — Stroke, cap, join, padding** belong in the 24-grid, not in implementer taste.
**NIT — Restart/start** should be yellow while probing, then green/red; don’t flash red.
**NIT — First menu row** after dropping the status header needs a named action, not a blank.

---

## Product / T2 fit

In scope: mark, colors, title/tooltip, copy for unknown, export pipeline, verification. Out of scope (correctly): handler rewiring, WS-as-process, DMG replace.

Do not treat WS disconnect as red. Do not put “CMspark Agent …” in the menu-bar title or as a duplicate menu header. Do not ship if 16px previews fail.

---

## Gate to merge

Treat as merge-ready only when: 16/22/32 light+dark previews pass; AX label + tooltip both set; title empty; green/red/yellow hex + non-template; JS/Swift share one coordinate contract; menu actions unchanged; unknown copy ≠ 已停止.
