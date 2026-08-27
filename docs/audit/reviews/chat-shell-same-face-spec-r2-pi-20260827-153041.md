All required files inspected. Patch confirmed current (staged files match patch hashes, `git status`/`git log` agree — not stale).

## r2 review — ChatShell spec (#239), dual T2

### r1 blockers → r2 closure (SoT = `docs/superpowers/specs/2026-08-27-chat-shell-same-face-design.md`)

1. **Fake 贴回** — Closed. Pin 5: 贴回 = `SUMMONER_ATTACH_FOOTNOTE` 附言，不画实心按钮; §3.2 浮动 HTML topbar 明示不放松实心「贴回侧栏」; §3.5 表格「(不画贴回)」; NEVER 14. Footnote copy matches `client.ts` exactly (`SUMMONER_ATTACH_FOOTNOTE` at companion/src/summoner/client.ts:33, lockstep string verified [inspected]). Chrome-window 真贴回 explicitly deferred to another ticket with user-gesture constraint (pin 5, §3.5).
2. **Tray/Mac DoD vs Swift** — Closed. Pin 2 + §0 椅子: 本票浮动 DoD = overlay HTML; Mac 热键/托盘仍 Swift 收起条「旧壳，不假装已换脸」; §4/§7: supersede 仅 HTML 壳, Swift 仍 40pt + `展开对话`. Plan file map contains zero Swift files [inspected].
3. **正在看 on overlay ⇒ ACL** — Closed. Pin 3 + §3.3: 芯片只在 Side Panel (`chrome.tabs.query`); overlay HTML/Swift 永远无页变体; copy 改为 `当前页：{标题}`、禁止「正在看/正在分享」; NEVER 13. Verified live: `SUMMONER_ALLOW` (companion/src/ws/summoner-acl.ts:27-60) contains no `list_tabs`/`tab.*`/`ui.dock`; overlay `summoner-web.ts` has no 允许/拒绝 controls and no tab verbs [inspected].
4. **弹出无协议** — Closed. Pin 4 + §3.5: extension-origin WS `overlay.shell.open {thread_id}` → existing `openLoopbackPage` (exists, companion/src/summoner-web.ts:276 [inspected]), **not** in `SUMMONER_ALLOW`, no `sidePanel.open`. Plan Task 4 tests `assertSummonerAllowed` denies it and origin-gates to `chrome-extension://` [inspected].
5. **收起条 silent supersede** — Closed. Pin 11 + §4: HTML 空态默认整张脸 is an **explicit, scoped** supersede of the 08-26 收起条 (header 例外 note too); Swift keeps the bar. `placeWindow(false)` at summoner-web.ts:1253 confirms the current default is collapsed — the flip is a real, tested change [inspected].
6. **诚实 CTA evicted** — Closed. Pin 6 + §3.1/§3.4: `打开确认台`/`打开浏览器` keep slots, 不进三芯片; computer invite re-homed to FocusBand + overlay `cta-box`. `summoner-web.ts:827/829` already carries `SUMMONER_OPEN_CONFIRM` + `SUMMONER_ATTACH_FOOTNOTE`; slice-5 `empty-state-copy.ts:12-17` has the cockpit CTA today [inspected]. Plan Task 3 keeps `#ctaBox`, Task 2 re-homes L2.
7. **DOM-feed license** — Closed. Pin 9 + §3.3/§3.4: chips = fixed templates, fill never inserts `{标题}`/DOM, 发送本轮 ≠ 拼页文进 prompt; plan test asserts `!c.fill.includes("vibesop")` [inspected].

Greeting copy is grounded: slice-5 `empty-state-copy.ts` already uses 「要对这页做什么？」/「要我帮你做什么？」 [inspected]; pin 8 removes 「今天」.

### ADR-020 checklist
Declaration present in blast + spec (Surface L0 / L2 none / Compose static chips / Autonomy none / Trust overlay-no-Allow-Deny + F-I-4 + no tab.* / Channel community) [inspected]. Axes fit (Surface-only, no L2). Trust monotonicity holds: `SUMMONER_ALLOW` unchanged, `overlay.shell.open` explicitly kept off it and origin-gated; F-I-4 preserved; no `sidePanel.open` anywhere on Companion side. No new confirm dialect / runtime / Pack scenario. originWs n/a (no new `securityConfirmations.request`). No bare 中层 Agent language.

### Nits (non-blocking)
- **Wireframes not fully re-synced to r2 pins** (`docs/design/chat-shell-same-face-wireframes.html`): E 托盘 float still draws filled 贴回侧栏 button (:348) — contradicts pin 5/NEVER 14 and its own flow SVG 「无实心贴回」; pagechips still say 正在看： (:278, :328, :375, :394) — contradicts §3.3 `当前页：{标题}`; D 浮动 still draws page chip + 3 chips (:322-328) though its own anno says 无页则无三条建议; greetings still carry 「今天」 (:272, :301, :322, :353) — contradicts pin 8. SoT text is authoritative and the drafted plan/test locks forbid implementing these as drawn, but a visual/IA ticket should carry a wireframe that matches its pins — one sync pass needed.
- **Plan drafted before dual gate** — `docs/superpowers/plans/2026-08-27-slice-239-chat-shell-same-face.md` exists while spec says 「dual-external 后写 plan」; it correctly self-gates on 「未 dual APPROVE* 不得实现」 and matches pins, so ordering-only.

### Verdict
All 7 r1 blockers are genuinely closed in the SoT (not papered — verified against live ACL, overlay HTML, client.ts, empty-state-copy.ts, and the pre-drafted plan), with test locks that enforce the ACL non-growth and copy contract. Remaining issues are stale wireframe drawings and plan ordering, both non-blocking.

VERDICT: APPROVE_WITH_NITS
