Now I have enough context. Let me write the independent review.

---

## Verdict

**APPROVE_WITH_CHANGES**

---

## Core thesis

The brief diagnoses the right problem: CMspark reports `success:true` at the event-post layer while the user-visible outcome (message appears in WeChat) never materialises. The R/A/W/C model correctly identifies that Write needs a fundamentally different success standard from Read. The success contract (pre → act → post-verify) is the single most important product decision in this document — without it, computer-use is a confidence-destroying machine. The foreground paradox (A ∧ B) is real and P1 is the architecturally correct resolution. However, the brief pulls its punch on WeChat: it proposes S-vision as "experimental" but doesn't fully commit to what that means for the product that triggered this entire redesign. That needs hardening.

The current `host-use/` codebase confirms the diagnosis: only `hostRead` exists. Write doesn't. The brief is right to say "stop patching coordinate and build the Write product from scratch with a success contract."

---

## Decisions (numbered)

**D1 — Endorse the R/A/W/C model with one rename and one split.**

The four-layer model is product-correct. Change: rename "C" from "Coordinate" to "Click (coordinate)" — it describes mechanism, not user intent. Split C into **C-read** (click to navigate, open menus, select items) and **C-write** (click to type, click to press send). C-read's success contract is "UI state changed observably" (a menu opened, a list item highlighted). C-write inherits the full Write success contract (pre → act → post-verify). This matters because the current brief lumps "click this button" and "type hello world" into one C layer when they have fundamentally different failure characteristics and verification costs.

**D2 — Endorse the success contract as mandatory for all Write operations, but scope post-verification pragmatically.**

The four-step contract (pre → act → post-verify → typed error) is the right product architecture. But the brief implies OCR verification for every type operation. For S-semantic apps, post-verification is cheap (re-read via API). For S-ax, it's moderate (AX tree query). For S-vision, OCR verification doubles the cost and latency of every write. The pragmatic scoping: **S-semantic and S-ax require post-verification always. S-vision write operations require post-verification only when the user has opted into "foreground takeover mode."** If S-vision write isn't in foreground takeover mode, it's simply not offered as a write path — return `TYPE_NOT_SUPPORTED_FOR_APP` instead of attempting and then OCR-verifying.

**D3 — P1 is the right foreground strategy, but must be paired with an explicit P4 boundary for S-vision apps.**

P1 (control-plane/data-plane separation) is architecturally correct and should be the default for all S-semantic and S-ax apps. The agent owns foreground management; the user does not.

However, for S-vision apps where P1 may fail (WeChat potentially refusing input when not key window), the product must have an explicit P4 boundary: **S-vision write is NOT a supported product capability by default.** The user can opt into "foreground takeover mode" per app, which is a different product mode with different expectations. Crucially, even in foreground takeover mode, the success contract applies — and if post-verification fails, the error is typed, not silent.

The brief lists P1–P4 as alternatives to "choose one." The correct answer is **P1 as default architecture + P4 as the S-vision product boundary.** They're not alternatives; they operate at different layers.

**D4 — The triage of S-vision (WeChat-class) apps must be more definitive.**

The brief says: "仅实验：需「前台接管模式」或只读截图；默认不保证发送消息." This is honest but too soft. The product should say:

- **S-vision Read**: supported (screenshot + describe/OCR). Works today.
- **S-vision Write**: **not supported by default.** The product makes no claim that you can send WeChat messages through CMspark.
- **S-vision Write with foreground takeover**: opt-in experimental mode. User explicitly enables per app. The UX copy says: "微信可能不接受后台输入。开启前台接管后，我会暂时把微信窗口放到前面来操作。发送结果会截图验证。此功能为实验性，不保证成功。"

This is shippable honesty. The user pain that triggered this brief ("send hello world to WeChat fails") doesn't get solved in v1 — and that's the right call. Solving it requires either (a) WeChat to support AX/semantic APIs (out of our control) or (b) a level of coordinate reliability that doesn't exist yet. Don't ship a feature that silently fails 40% of the time.

**D5 — Kill list is correct but needs one addition: kill "event-post success" as a concept in the API.**

The brief says `ok:true` should be renamed to `posted:true` and that `completed` should require verification. This is right, but go further: **every write tool must return a structured result with two separate booleans**: `posted` (was the event injected?) and `verified` (was the effect confirmed?). The agent and the user see both. A `posted:true, verified:false` result triggers a typed error (TYPE_NO_EFFECT), not task completion. This change alone would have caught the WeChat "hello world" failure immediately instead of letting it accumulate 20+ fake successes across threads.

**D6 — The 2-week golden path must NOT include WeChat.**

The brief's proposed golden path is the WeChat story. That's wrong. The 2-week golden path should be:

1. **"Read today's Mail and summarise"** — Mail.app via AppleScript, pure read, S-semantic. Already partially working via `hostRead`.
2. **"Create a note in Notes saying 'test'"** — Notes.app via AppleScript, write with post-verification (re-read the note). S-semantic write with full success contract.

These two stories:
- Use only L1 (AppleScript) — the most reliable layer
- Demonstrate the complete R→W success contract without foreground complexity
- Build user trust on the most reliable path before attempting harder apps
- Can ship in 2 weeks because `hostRead` and the AppleScript infrastructure already exist

The WeChat story is a 4–8 week effort that requires foreground takeover mode, OCR verification loops, and a fundamentally different reliability profile. It should be a Phase 2 milestone, not the golden path.

**D7 — The confirmation economics are correct, but the "no re-L2 for Chrome self-UI" rule needs an exception for actual foreign app foreground changes.**

The brief says Chrome self-UI yield should be silent (no re-L2). Correct. But the rule should be: **only the Companion knows what's "self" vs "foreign."** The current macOS `exePath` matching bug (where `com.google.Chrome` was misclassified) proves that self-detection is fragile. The principle: Companion tracks which PID it raised; if the foreground changes to something the Companion didn't raise, that's foreign and triggers re-L2. If Companion raised it (including re-raising the target after Chrome briefly took focus), it's self and silent. This keeps the user out of system-level foreground management.

---

## Kill list

1. **Kill `type` without post-verification.** No write tool returns success without evidence the effect occurred. Rename all internal `ok:true` to `posted:true` and add `verified` as a separate field.

2. **Kill coordinate/vision-click as the default path for any app.** The L1→L4 priority in the original design brief is correct. The as-built reality inverted it. Restore the priority: semantic API → AX → coordinate. Coordinate is always last resort, never default.

3. **Kill the instruction "keep WeChat foreground."** It's a product anti-pattern that asks the user to solve a system problem. If an app requires foreground, the agent manages it (P1) or the app is classified as unsupported for write (P4).

4. **Kill TinyClick as a dependency in the success path.** If it helps, great. But the product must not depend on experimental coordinate-refinement layers for its success contract. TinyClick is a SPI tweak, not a product feature.

5. **Kill the notion that WeChat "send message" is a v1 feature.** It's the hardest problem in computer-use and it's what triggered this redesign. Ship the reliable stuff first (Mail, Notes, Finder). Build trust. Then tackle WeChat as a dedicated Phase 2 with foreground takeover mode.

6. **Kill silent retry loops.** The brief mentions "不累积 20 次假 type." Codify this: maximum 2 retries for any write operation. After 2 failures with typed errors, stop and ask the user. This prevents the retry-storm fatigue described in T11.

---

## 2-week golden path

**Story 1: "Read my Mail inbox and summarise today's emails"**

- L1 AppleScript → Mail.app
- Pure read, no foreground complexity
- Returns structured data (sender, subject, date, body preview)
- LLM summarises in side panel
- Success metric: user sees accurate summary of today's emails in <10 seconds

**Story 2: "Create a note in Notes saying 'Meeting notes: discuss Q3 roadmap'"**

- L1 AppleScript → Notes.app
- Write with post-verification: after creating note, re-read Notes to confirm the note exists with correct content
- Full success contract demonstration
- Success metric: user opens Notes.app and sees the note with correct content

**What this validates:**
- The R→W pipeline works end-to-end for S-semantic apps
- The success contract (pre → act → post-verify) is implementable
- User trust can be established on the most reliable path first
- The confirmation UX (L2 for write) works without foreground paradox

**What this deliberately excludes:**
- WeChat / S-vision apps
- Coordinate / vision-click
- Foreground takeover mode
- Any app without a semantic API

---

## Risks

**R1 — WeChat may be the only thing users actually want.** If the top user demand is "send WeChat messages" and v1 can't do it, adoption of computer-use may be near zero. The Mail/Notes golden path may feel like a demo, not a product. Mitigation: instrument the golden path heavily; if adoption is zero after 2 weeks, that's data, not failure. But be prepared for the possibility that computer-use without WeChat has no market.

**R2 — The success contract may be too expensive for S-ax apps.** For apps with usable AX trees but no semantic API, post-verification requires an AX tree query after every write. If the AX tree is large or slow, this doubles latency. Mitigation: for S-ax, post-verification can be targeted (query only the specific element that was acted upon, not the full tree).

**R3 — P1 foreground management may cause visual jank.** The brief acknowledges "raise 闪一下." Users may find this jarring, especially if it happens multiple times per task. Mitigation: batch operations where possible (acquire focus once, do all writes, then release). If jank is severe, consider P3 (tray-based confirmation) as a Phase 2 mitigation.

**R4 — The vault blacklist may create a false sense of security.** The brief inherits the original design's vault blacklist (1Password, Keychain, banking apps). But screenshot OCR of non-blacklisted apps can still capture sensitive data displayed on screen (e.g., a password visible in a non-password-manager app). The redaction pipeline (N15) helps but is probabilistic. Risk: a screenshot captures credentials from an app not on the blacklist.

**R5 — Path dependency is real.** The brief's §6 acknowledges this honestly: "实现者倾向于继续修 SkyLight / autoscale / self-UI." The risk is that the team reads this review, nods, and then continues patching coordinate anyway because it's the code they know. Mitigation: the success contract must be implemented in the tool return schema first, before any new write tools are added. This forces every write path through the verification gate from day one.

---

## VERDICT: APPROVE_WITH_CHANGES
