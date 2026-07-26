I have enough grounding. Writing the review now.

---

# Product Design Review — Computer Use redesign brief (2026-07-25)

Reviewer: independent senior product + systems designer.
Evidence: brief under review; `computer-use-design-brief.md`; `executor.ts` (1538 LOC), `darwin-adapters.ts` (1055 LOC), `host-skylight.swift` (1368 LOC), `self-ui.ts`, `tool-definitions.ts:548-564` (host_computer API), `diagnosis-synthesis.md`. Confirmed before writing: no `TYPE_NO_EFFECT` / `SEND_NO_EFFECT` typed error exists yet (`computer/types.ts` only carries `FOREGROUND_RAISE_FAILED`); `crossverifyChannel` is `pixel-region` only on the click path and `undefined` for `type` — i.e. the brief's claim "type has no post-verify, fake success" is literally true in code.

## Verdict

`APPROVE_WITH_CHANGES` — diagnosis is correct and overdue; proposal is one product decision and three API decisions short of shippable.

## Core thesis

The brief correctly identifies the original sin: an entire stack (SkyLight per-PID, autoscale, self-UI allow-list, variance classifier, TinyClick) was built to prop up a **product promise that should never have been made** — that a coordinate injector can deliver "send a message in WeChat" with the same confidence as an AppleScript call. WeChat is a vision-only target. Equating `event_posted == task_completed` for it is not a bug; it is a category error baked into the tool name and its return shape. The fix is not another SPI patch, it is (1) splitting the ontology into R / A / W / C with **success contracts per layer**, (2) enforcing the control-plane/data-plane split as a *product* rule, and (3) being honest in the API so the LLM cannot lie to itself.

However, the brief still leaves three holes that will re-create the current failure mode if not closed:

1. It punts on the **one load-bearing empirical question**: does WeChat accept synthetic keyboard input into a non-key, non-frontmost window? If yes → P2 ships and P1 is moot. If no → P1 is the only path *and it must be allowed to fail visibly*. The brief's "implementation suspects… but sample limited" is the entire ballgame; until that experiment is run, P1 vs P2 is theology.
2. It conflates "agent verifies" with "user verifies." For S-vision send, **the only honest verifier is the user**. The brief's VERIFY step is drawn as if OCR can close the loop; on a vision-only target it cannot, and you will recreate fake-success at the verify layer instead of the inject layer.
3. It dismisses **P3 (native tray confirm window)** too quickly ("engineering big; forks UX"). The Swift tray binary already exists, the pairing-window precedent already shipped (`A8`), and a native confirm window is what every serious native agent does. P3 may be *cheaper* than P1 + self-UI-allow-list + raise-failure recovery + re-L2-suppression logic combined.

Below: concrete decisions, kill list, and a 2-week golden path that closes these three holes.

## Decisions (numbered)

**D1 — Adopt R/A/W/C as the product ontology, but propagate it to the tool surface, not just the spec.**
The brief keeps `host_computer` as one blob doing all four. That is the original sin repeated. Split:

- `host_read` (R) — already exists, mostly correct.
- `host_app` (A — launch/activate) — already exists.
- `host_write` (W semantic) — already exists for Notes/Finder/OneNote; **extend** to Mail send, and make this *the* "send a message" path for any S-semantic / S-ax app.
- `host_computer` (C coordinate) — **rename the return field** `ok` → `posted` (brief §3.4), and **remove the word "send" from its description** so the LLM stops reaching for it as a write tool. Its description must say: *"injects input coordinates; cannot verify the application's semantic state; for write/send tasks prefer host_write or another semantic tool."*

Tool names are the LLM's ontology. If you don't split here, every system-prompt patch is a band-aid.

**D2 — Success contract is a hard requirement, and for S-vision the verifier is the user, not OCR.**
Adopt the pre/act/post contract from §3.4 verbatim, with two implementation rules the brief omits:

- For **S-semantic / S-ax**: post-verify via the same API (set value → read value back; send mail → message-id returned). This is real verification.
- For **S-vision**: post-verify is **human**. Concretely: after the action sequence, return `verification_required: true` with a screenshot cropped to the expected bubble region, and **do not let the LLM emit "已发送"** until the user clicks a single in-panel ✓. This is "shippable honesty" — the failure mode isn't eliminated, but it is no longer invisible. (This is also the only design that survives WeChat changing its DOM.)

OCR-based verify for S-vision send is a trap: WeChat's bubble animation, font hinting, and anti-aliasing will give you a 5–15% false-negative rate, and you will ship a "smarter fake-success" instead of a honest one. Don't go there.

**D3 — Run the P1 vs P2 experiment in week 1, before any architecture commitment.**
The brief lists P1–P4 as if they are philosophical preferences. They are not — they collapse to one empirical question: *on the target app (WeChat), can a synthetic key event reach a non-key window?* Run this on Monday:

1. Open WeChat, focus Chrome.
2. `CGEventPostToPid(weChatPid, keyDownEvent('h'))` — does the WeChat input field receive it?
3. Repeat with `SLEventPostToPid`, with `ax.focusedWindow.setAttribute(kAXFocusedAttribute, True)`, and with `NSRunningApplication.activate`.
4. Three runs each, cold and warm.

Outcomes:
- All-fail → P1 (foreground takeover) is the only path; design raise/restore as a *product* primitive with typed failures (`FOREGROUND_RAISE_FAILED` already exists in `darwin-adapters.ts:682` — good).
- PID-post works → P2 is the product path; **kill the self-UI allow-list** (`computer/self-ui.ts`) because it's patching a non-problem.
- Mixed (works for click, not for type) → tier the contract per action.

Don't write a single line of P3 architecture until this table is filled in. The brief is correct that the implementation has path-dependency bias toward SkyLight; the corrective is empirical refutation, not more design.

**D4 — P3 (native tray confirm window) should be re-evaluated, not deferred.**
The brief dismisses P3 on engineering cost. Push back:

- The Swift binary already exists (`companion/src/host-use/darwin/host.swift`, 1845 LOC).
- The pairing window already exists and ships (`A8` in `CLAUDE.md`; `Tray.swift` PairingController).
- Adding a "task confirm" native window is comparable scope to the existing pairing window — not the multi-quarter fork the brief implies.
- P3 *alone* dissolves the product paradox: confirm happens in a 1Password-style native sheet that **does not raise Chrome to frontmost**, so the target app keeps foreground, so injection works.

P3 + P4 (cut S-vision write to experimental-only) is actually the cleanest combination. Don't let "we already built the side panel" sunk-cost the architecture.

**D5 — Adopt P4 (cut S-vision write scope) explicitly and loudly.**
This is the single most important product decision in the brief and it's listed as one option among four. It should be the headline.

- S-vision **read** (screenshot, describe, OCR): supported, no illusions.
- S-vision **write/send**: experimental, foreground-takeover mode, **user-verified** (D2). Default LLM behavior on WeChat-class write intent: propose a safer alternative (Notes, Mail, system share sheet) and only proceed with coordinate injection on explicit user override.
- Marketing copy, in-app onboarding, and tool descriptions must all say this. The current `host_computer` description (`tool-definitions.ts:549`) does say "CRITICAL-class" and "task-level confirmation" — good — but says nothing about reliability tier. That's where the lie of omission lives.

**D6 — Tier the foreground/confirm strategy as a matrix, not a pick.**
The brief asks "P1 or P2 or P3 or P4?". The honest answer is a matrix:

| App tier | Confirm surface | Foreground strategy |
|---|---|---|
| S-semantic (Mail, Notes) | Side panel OK | None needed (API path) |
| S-ax (most native apps) | Side panel OK | P1 agent-raise, silent re-raise on self-UI yield |
| S-vision (WeChat, Electron games) | P3 native tray window **strongly preferred** | P1 + visible raise + D2 user-verify |

**D7 — Kill the "20 fake type retries" failure mode at the executor level, not just the contract level.**
The brief says "VERIFY fail → don't accumulate 20 fake types". Today in `executor.ts` this is enforced only by budget exhaustion (`budget`, default 15, max 30). For type actions specifically, add: **on first post-verify miss, halt the action sequence and surface a typed error `TYPE_NO_EFFECT`** (recoverable — LLM can call `screenshot` and re-plan, but cannot call `type` again with the same text in the same task). Same for `SEND_NO_EFFECT`. The LLM's loop is what generates the 20 retries; break it at the executor, not the prompt.

**D8 — Keep every existing security red line; do not relax any of them for "make WeChat work".**
The list, all already in code or P0 briefs, must remain non-negotiable:
- L2 critical class for all writes; god-mode does not skip (`host_computer` description, line 549).
- type text hash-bound to L2 corpus (executor invariant A3, line 22).
- Hard-deny on payment/transfer/captcha final-confirm clicks (A4, line 25).
- Hard-deny on typing into credential contexts (A4).
- Vault blacklist hardcoded (1Password / Keychain / bank apps).
- Per-call biometric for writes (Q1 ship blocker).
- The five P0 security fixes from `diagnosis-synthesis.md` (S-P0-1 host-bin env override, S-P0-2 tray TOCTOU, S-P0-3 page-sanitizer, S-P0-4 wildcard apex, S-P0-5 HMAC timing) are **prerequisites** — without them, no computer-use promise is real, regardless of product model.

If a reviewer proposes relaxing any of these to make WeChat send "work", refuse. The whole point of P4 is that some apps are simply not safe targets.

## Kill list

In order of urgency (highest first):

1. **Kill the SkyLight per-PID SPI as a golden-path dependency.** It's an arms race with Chromium (`docs/decisions/v1.3/adversary-approach-c-round1.txt` B1/B2 already document this: requires disabling library validation, stability unverified on macOS 14/15/26, cua #1503 Sonoma crash, yabai Tahoe breaks). It is acceptable as a research spike. It is not acceptable as a load-bearing piece of a "send a WeChat message" promise. Demote to opt-in experiment.
2. **Kill TinyClick as a default locator on the write path.** It's research-grade (`tinyclick-golden-eval.ts`, `tinyclick-worker.ts`). The brief already says "TinyClick is搁置" — make that real by removing it from the default locator chain for write actions.
3. **Kill the self-UI allow-list patch (`computer/self-ui.ts`) once D3 resolves.** It exists only because the side panel raises Chrome and breaks injection. If P3 ships, the side panel doesn't raise during confirm and the entire problem class vanishes. If P2 works, raise isn't needed at all. Either way, `self-ui.ts` is patching a symptom.
4. **Kill the variance classifier for foreground-yield detection** (the `p2_capture_classifier_and_or_vs_or.md` thread). It was built to distinguish "Chrome self-yield" from "foreign yield". Once D4/D5 separate the control and data planes, this classifier is moot.
5. **Kill the implicit equivalence between `ok:true` and "task success" in the API.** Hard-rename `ok` → `posted` on every coordinate-path return, including history.db (`history/store.ts`). This is one rename, not a refactor, and it is the single highest-leverage honesty fix in the entire stack.
6. **Kill the LLM's ability to report "已发送" without verification.** System-prompt level: for any write/send action, the assistant message must reference either (a) the post-verify signal returned by the tool, or (b) the user-confirmation ✓. Anything else is treated as a hallucination.
7. **Kill "foreground checklist" UX copy.** Anywhere the product currently asks the user to "keep WeChat in front", remove it. The brief is right: that is making the user do the agent's job.

## 2-week golden path

Two stories, both end-to-end demonstrable, both grounded in outcomes not event-posts success:

**Story A — S-ax / S-semantic, reliable path (proves the contract works):**

> "用 Mail 给 Chen 发一封邮件，标题 hello world，正文 hello world"

End-to-end:
- LLM picks `host_write` (Mail), not `host_computer`.
- Pre: AX confirms compose window open, recipient resolved.
- Act: API send.
- Post: message-id returned; tool emits `verified: "message_id:…"`.
- Side panel: "✓ 已发送 (message id …)" with the verifiable receipt.

**Why this proves the contract:** the success contract (pre/act/post) is demonstrated on a tier where post-verify is *real*. This is the existence proof that the contract is implementable and that the LLM can trust the tool's return.

**Story B — S-vision, honest path (proves the contract fails-closed):**

> "在微信文件传输助手发一句 hello world"

End-to-end:
- LLM classifies target tier = S-vision, surfaces tier badge to user.
- LLM **asks** the user: "WeChat 是 vision-only app，我不能保证发送成功。要试吗？(我会在你视觉确认后报 success)" — explicit opt-in.
- User confirms → P1 foreground takeover → type → enter.
- Tool returns `posted: true, verification_required: true` + screenshot crop of expected bubble area.
- Side panel: a single ✓ button. LLM does **not** emit "已发送" until ✓ is clicked.
- If user clicks ✗ or 30s passes → tool result is `verified: false`; LLM emits "我可能没发成功，请检查微信".

**Why this proves the contract:** the worst-case outcome (message didn't appear) is no longer invisible. The user is the verifier. The LLM cannot lie. This is the **minimum honest shippable thing**; everything else (P2 background injection, P3 native confirm) is upside on top.

**Milestones:**

- Week 1, day 1–2: D3 experiment. Decision recorded in `docs/decisions/v1.3/foreground-strategy-experiment-2026-07-25.md`. Drop P2 (or commit to P1) based on data.
- Week 1, day 3–5: API rename `ok → posted` (D5 kill #5) + add `verification_required` to host_computer return shape. Tests updated. Backward-compat shim for one release.
- Week 1, day 6–7: `TYPE_NO_EFFECT` / `SEND_NO_EFFECT` typed errors in executor (D7). Existing unit tests extended.
- Week 2, day 1–3: Story A end-to-end on Mail (S-ax path). Demo recorded. Metric: 10/10 trials, message-id returned = success.
- Week 2, day 4–5: Story B end-to-end on WeChat (S-vision path). Demo recorded including the **fail-closed** case (deliberately break injection, show user-✗ flow). Metric: 0/10 false-success reports.
- Week 2, day 6–7: ship to a closed beta of 5 users; instrument outcome-success-rate per tier (D below).

If Story B cannot hit "0/10 false-success" by week 2, that itself is the answer — WeChat send is not a v1.3 product, and you ship Story A + S-vision read-only instead. That is still a coherent, honest shippable.

## Risks

**R1 — D3 experiment returns "mixed" (some apps accept background key, some don't).** Then you've bought a per-app behavior matrix forever. Mitigation: ship D5 (tier classification) regardless; the matrix becomes the S-semantic / S-ax / S-vision table.

**R2 — User-verify UX (D2) creates fatigue and users start clicking ✓ without looking.** Same failure mode as L2 re-prompt fatigue. Mitigations: (a) only request verify on S-vision write, not on every action; (b) the ✓ sheet shows the cropped screenshot, forcing at least a glance; (c) track verify-fatigue as a metric (see "Tier migration" below).

**R3 — P3 native tray confirm window ships, but you don't deprecate side-panel confirm fast enough → two confirm surfaces in parallel → more confusion, not less.** Mitigation: gate side-panel confirm for write tasks behind the same `verification_required` flag; once P3 is stable, side-panel write-confirm becomes deprecated path.

**R4 — LLM still tries host_computer for write tasks because of habit / context.** Mitigation: D1 (split tool surface). The single biggest lever is renaming the tool's return field and editing its description so the LLM cannot reach for "I posted events, therefore I succeeded."

**R5 — The brief's `posted ≠ completed` rename breaks consumers expecting `ok`.** Minor; shim for one release. Already standard practice (`tool-definitions.ts` carries versioned descriptions).

**R6 — Security P0s from `diagnosis-synthesis.md` (S-P0-1, S-P0-2, etc.) ship before this redesign, and the redesign's promises depend on them.** Track explicitly: D8 says "prerequisites". If any of the five is not yet fixed at the moment Story A/B ship, the entire promise is built on sand and the redesign should hold.

## Answers to §5 questions (one line each, expanded above)

1. **R/A/W/C + success contract**: adopt, but propagate to the tool surface (D1) and make S-vision's verifier the user, not OCR (D2).
2. **P1–P4**: matrix by app tier (D6); run the D3 experiment before choosing; seriously re-evaluate P3 — it may be cheaper than P1.
3. **WeChat S-vision support level**: read supported; write/send experimental + foreground-takeover + user-verified (D5). Never promise parity with S-semantic.
4. **Minimum golden path**: Stories A (Mail) + B (WeChat honest) above.
5. **Kill list**: 7 items above, headlined by SkyLight SPI demotion and `ok → posted` rename.
6. **Security red lines**: D8 — eight items, all already in code/briefs, none relaxed for "make WeChat work".
7. **Success metrics**: outcome-success-rate per tier (target ≥95% S-semantic, ≥85% S-ax, transparent for S-vision); false-success rate (<2% for tiers 1–2, structurally bounded for tier 3 because user-verified); re-L2 prompts per task (target 1.0); foreground-takeover visibility (target 100% for S-vision write); tier migration rate (% of vision-only intents successfully redirected to a semantic path — measures honesty in routing, target ≥30%).

## VERDICT: APPROVE_WITH_CHANGES
