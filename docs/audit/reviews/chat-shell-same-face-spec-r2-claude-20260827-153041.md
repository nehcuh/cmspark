All verification complete. Here is my review.

# Dual external review — ChatShell spec r2 (#239)

## Blocker-by-blocker closure check (all verified against real files)

1. **Fake 贴回** — CLOSED [inspected+executed]. Pin 5 (spec:42) + §3.5 table (spec:143) + NEVER #14 (spec:212). The replacement footnote exists verbatim in code: `SUMMONER_ATTACH_FOOTNOTE = "我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。"` at companion/src/summoner/client.ts:47-48. Chrome-window real re-dock is explicitly another ticket with the `chrome-extension://` user-gesture requirement (spec:42).
2. **tray/Mac DoD vs Swift out of scope** — CLOSED. Pin 2 (spec:39), §0 chair "Mac 热键/托盘仍是 Swift 收起条（旧壳，不假装已换脸）" (spec:32), §4 (spec:170), NEVER #15. Swift copy confirmed: `SUMMONER_CHEVRON_EXPAND = "展开对话"` client.ts:28, and pin 12 locks it untranslated.
3. **正在看 on overlay ⇒ ACL** — CLOSED. Pin 3 (spec:40) confines the 当前页 chip to the extension surface; `list_tabs`/`tab.*`/`ui.dock`/`ui.open_sidepanel` banned from all three gates (spec:40, :192, NEVER #13). Current ACLs verified clean: `SUMMONER_ALLOW` (summoner-acl.ts:14-45) and `SUMMONER_WEB_DISPATCH_ALLOW` (summoner-web.ts:36-58) contain none of them; this diff adds zero ACL entries.
4. **Unspecified pop-out** — CLOSED. Pin 4 (spec:41): extension slot (explicitly not `SUMMONER_ALLOW`) `overlay.shell.open {thread_id}` → existing primitive `openLoopbackPage`, verified at companion/src/summoner-web.ts:276 (invoked at menu-bar-agent.ts:1652). No `sidePanel.open` (F-I-4).
5. **Silent supersede of 收起条** — CLOSED. Header exception (spec:11) explicitly supersedes the 08-26 40pt default for the HTML shell only, and mandates the supersede be written into the landing PR's PRODUCT/DESIGN (pin 11, spec:48; §4 spec:170). Not silent.
6. **Honesty CTAs evicted** — CLOSED. Pin 6 (spec:43) keeps `打开确认台`/`打开浏览器`/`打开并前置浏览器` in dedicated slots outside the 3 chips; computer CTA migrates to FocusBand/overlay `cta-box`, not deleted. All three constants verified at client.ts:44-46.
7. **DOM-feed license** — CLOSED. Pin 9 (spec:46) + §3.4 (spec:128-134): chips are fixed templates, fill-not-send (spec:126, §7 spec:222), no `{标题}`/DOM interpolation, page ops stay on tools + untrusted tags.

## ADR-020 checklist

- Declaration present and correct (spec:13-20, matches the prompt's Blast). Pure L0 Surface; L2=none; Compose=none (static templates are not a new composition protocol); Autonomy=none; overlay trust unchanged. Pin 1 (spec:38) explicitly refuses a shared runtime (no `chrome.*`/`agentStore` into summoner-web) — no new runtime, no bare "中层 Agent". No new confirm dialect; trust monotonicity untouched (no code diff at all — 5 doc files, 828 insertions, patch file confirmed non-stale against `git diff --cached`). originWs N/A.
- "Become Gemini" axis: NEVER list (§6), 干活 copy pinned (pin 8), no fake dock hold in the spec — per instructions, not a REJECT ground.

## Non-blocking nits

1. **The staged wireframe contradicts the r2 pins it ships with** (docs/design/chat-shell-same-face-wireframes.html): banned copy 「正在看：…」 at lines 278, 328, 375, 394 (spec §3.3 at spec:119 mandates `当前页：` and bans 正在看)； floating mock D still draws 3 chips + page chip (lines 323-328) despite its own r2 annotation (line 333) and pin 3/§3.4 (overlay =永远无页)； tray mock E still shows a **solid filled 「贴回侧栏」 button** (line 348) — r1 blocker #1 / NEVER #14 verbatim; greetings retain 「今天」 and double-greeting (lines 271-272, 301, 321-322) vs pin 8. Non-blocking because the spec is the normative contract with exact pinned strings and pin-12 test locks (spec:49, :188-193) mechanically prevent this copy from reaching product — but regenerate the 线稿 (or stamp "copy 以 r2 pins 为准") before a plan is written from it.
2. Flow SVG node 「点「贴回侧栏」」 (wireframes.html:210) sits in the main flow without an inline 另票 mark; only the §04 header discloses 本票不锁. Cosmetic given §3.5's （不画贴回） row.
3. Pin 12 names `empty-state-copy.test.ts` / `summoner-web.test.ts` — neither exists yet anywhere in the repo. Fine as "plan 必须带” requirements, but the plan-stage reviewer must verify they're actually created with exactly those locks.

Outcome: all seven r1 blockers genuinely closed in the SoT, anchored to real, verified code. Trajectory correct; component (spec) sound; the drift lives only in the auxiliary sketch, which the pins and test locks override.

VERDICT: APPROVE_WITH_NITS
