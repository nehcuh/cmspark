# Approach C-minus v4 Plan — Hermes / OpenClaw Pattern

**Author**: Grok (planning owner per user directive 2026-07-24)  
**Date**: 2026-07-24  
**Status**: DRAFT — awaits Pi confirmation before Claude codes  
**Supersedes**: `plan-approach-c-minus.md` (v3 — SkyLight inject swap only)  
**Handoff**: Pi reviews → `review-pi-plan-v4.txt` → Claude implements file-by-file  
**Evidence tags**: `[inspected]` code-path read; `[assumed]` reasoned; `[executed]` deferred to Claude post-consensus

---

## Verdict: **PROCEED WITH PLAN**

v3 delivered a real inject primitive win (`SLEventPostToPid`) but **did not deliver Hermes/OpenClaw UX**. The three defects form one loop, not three independent bugs:

```
host_computer task (always initial L2 → Chrome frontmost)
    → cuScreenshot always cuActivatePid  → target yanked to front
    → inject (SkyLight, background-capable — good)
    → post-action FOREGROUND-YIELD / self-UI recovery may re-raise target
    → next action / next task → repeat
```

v4 closes that loop as one coherent design: **background capture + session-scoped consent + canonical client-logical coordinates**. SkyLight remains; UX becomes the product.

---

## 0. RALPLAN-DR summary (short)

### Principles
1. **Frontmost is not a precondition** for capture or inject on Darwin SkyLight path.
2. **Consent is session/app-scoped**, not per-action; hard-denies stay hard.
3. **One coordinate system end-to-end**: client-logical points of the target window.
4. **Do not weaken** vault blacklist, AST validation, S-P0-2 integrity, or the 3 inject error codes.
5. **Plist floor stays 14.4**; computer-use still runtime-gated to Tahoe 26.5+ SPI.

### Decision drivers (top 3)
1. User-visible foreground thrash + Chrome "Allow" fatigue (stated failure of v3).
2. Close the activation↔confirm vicious cycle (screenshot activate + side-panel L2).
3. Make explicit-coord clicks match the image the LLM actually saw.

### Viable options

| Option | Pros | Cons |
|---|---|---|
| **A — Coherent Hermes loop (CHOSEN)** | Fixes all 3 defects as one system; matches user vision; reuses session-trust spike | Changes critical-class "every task asks" contract for same-session same-app |
| B — Three independent patches | Smaller diffs | Leaves vicious cycle half-fixed; coord + cadence remain broken |
| C — Full ThreadApprovals kind for computer-use | Persistent cross-restart trust | Violates W7 Blocker 1 without owner decision; overkill for v4 |

**Invalidation**: B rejected because screenshot-activate + per-task L2 re-create each other's symptoms. C rejected for scope/governance; session-memory grant (process-lifetime) is enough for Hermes UX.

---

## 1. Vision alignment — Hermes / OpenClaw behavioral checklist

OpenClaw / Hermes-class Mac computer-use (Accessibility + ScreenCaptureKit, not AppleScript/HID) implies the following **observable properties**. v4 acceptance is against this checklist, not against "SkyLight posts events."

| # | Property | Pass signal | v3 status | v4 owner |
|---|---|---|---|---|
| V1 | **Frontmost invariant** — target app need not be frontmost for capture or inject; user's current front app stays put unless user-initiated | During multi-step task, `NSWorkspace.frontmostApplication` ≠ target for ≥ N−1 of N actions; user's browser/editor remains frontmost | FAIL — screenshot activates every step (`host.swift:797`) | Defect 1 |
| V2 | **Prompt cadence** — user consents once per (session, app) operating grant; not every click / every tool call | After first approved `host_computer` for `mac.app.X` in a WS session, subsequent low-risk actions for same app produce **zero** Side Panel confirms | FAIL — critical-class "every task asks" (`server.ts:466-468`, tool-definitions) + mid-task reL2 stack | Defect 2 |
| V3 | **Background capture** — ScreenCaptureKit window capture without `activate()` | `cuScreenshot` succeeds while target is occluded/behind; PNG content is live window buffer, not blank/stale chrome | FAIL — unconditional activate | Defect 1 open Q |
| V4 | **Background inject** — SkyLight per-PID delivery without raise | Already shipped in v3 (click path dropped `ensureForeground`) | PASS inject path | preserve |
| V5 | **Canonical coords** — LLM (x,y) ∈ client-logical of the captured window; inject hits the same pixel the model pointed at | No `OUT_OF_BOUNDS` for in-image clicks; manual click at known UI control lands on control | FAIL — `(722,872)` vs `880×640` | Defect 3 |
| V6 | **Hard safety floor unchanged** | Payment/captcha hard-deny, credential type hard-deny, vault blacklist, AST validation, S-P0-2, 3 inject codes | PASS (must not regress) | constraints |
| V7 | **E-stop remains reachable** | Hotkey / panel abort still aborts mid-task | PASS (must not regress) | constraints |
| V8 | **Occlusion honesty** | Inject with `--check-occlusion` still fails closed when target is fully covered *and* delivery would misroute; does **not** force-raise to "fix" occlusion | Partial — activate papered over occlusion | Defect 1 redesign |

**Non-goals for v4** (explicit): Windows Phase 1.5, Linux AT-SPI, biometric confirm (W7+), ThreadApprovals new kind, drag feature completion, Sequoia SkyLight port.

---

## 2. Defect 1 — `cuScreenshot` activation strategy

### 2.1 Root cause `[inspected]`

```swift
// companion/src/host-use/darwin/host.swift:792-797
let pid = cuPidForWindow(windowId)
// Pull target app to front so the screenshot captures a visible (non-occluded)
// frame. ... (b0faek bug)
cuActivatePid(pid)
```

`cuActivatePid` (`host.swift:625-630`) calls `app.unhide()` + `app.activate()` + 250 ms sleep. Every `trackCapture` / locate re-capture / post-inject after-shot pulls the target to front. That is the user-reported "不断将需要操作的程序切换到前台".

b0faek rationale was valid **for the HID era**: Side Panel confirm → Chrome frontmost → occluded target → stale/wrong capture → click misroute. After SkyLight, inject no longer needs frontmost; the leftover activate is pure regression relative to Hermes.

### 2.2 Open question — can ScreenCaptureKit capture background windows?

**Current capture path** `[inspected]` (`host.swift:856-869`):

```swift
let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
// ...
let filter = SCContentFilter(desktopIndependentWindow: targetWindow)
config.scalesToFit = false
```

This is already the **window-independent** SCK path (`desktopIndependentWindow`), not a display composite. Design intent of that API is to capture a window's own backing store without requiring frontmost.

| Scenario | Expected without activate | Verification in G2 |
|---|---|---|
| Target visible but not frontmost | Live content | Primary lab |
| Target fully occluded by another window | Usually still live content of that windowID | Lab case B |
| Target minimized / other Space | May fail or return empty — fail with typed error, do **not** auto-activate | Lab case C |
| Target hidden (`isHidden`) | Fail closed `HWND_OFFSCREEN` / capture error — optional one-shot unhide is **out of scope** for v4 default | document only |

**Plan decision (default)**: **Remove unconditional `cuActivatePid` from `cuScreenshot`.** Do not replace with "activate if occluded." Occlusion is an inject concern (`--check-occlusion`), not a capture precondition.

**Canary only** (dev/A-B, not production default):

| Env | Behavior |
|---|---|
| (unset) | No activate on screenshot (Hermes default) |
| `CMSPARK_SCREENSHOT_FORCE_FG=1` | Legacy b0faek activate (canary / rollback) |

Remove `CMSPARK_SKYLIGHT_FORCE_FG` in Stage 3 as already planned (v3); do **not** conflate the two knobs.

### 2.3 Related frontmost thrash to kill in the same PR train

| Site | File | v4 action |
|---|---|---|
| `cuScreenshot` activate | `host.swift:797` | **Delete** (canary env only) |
| Inject `ensureForeground` | `darwin-adapters.ts:513-516` | Already removed — **keep removed** |
| FOREGROUND-YIELD **self-UI recovery** `forceForeground` | `executor.ts:1357-1367` | **Change**: on Darwin SkyLight path, **do not re-raise**. Log `computer.task.foreground_yielded.self_ui.skip_raise` and `continue`. Re-raise was HID-era recovery and **itself steals foreground**. |
| `cuInject` canary activate | `host.swift:993-998` | Leave canary for inject A/B until Stage 3 cleanup; production path already skips |

### 2.4 Occlusion detection after no-activate

- Keep `--check-occlusion` on click inject (`darwin-adapters.ts:520`).
- If SCK returns a near-empty / solid frame while window reports non-zero bounds, surface a **soft** diagnostic (`CAPTURE_DEGRADED`) in logs; do **not** auto-activate. LLM/task can fail with honest error.
- Post-action dialog detector stays; foreign-process yield still pauses when **not** self-UI.

### 2.5 Files / lines

1. `companion/src/host-use/darwin/host.swift:792-797` — remove unconditional activate; optional env canary.
2. `companion/src/computer/executor.ts:1337-1371` — Darwin: self-UI yield → skip raise, continue.
3. Rebuild host binary + SHA rewrite (`build-host.sh` / `host-integrity.ts` auto path) — integrity pin updates; **S-P0-2 stays**.

---

## 3. Defect 2 — L2 confirmation cadence redesign

### 3.1 Why the user still clicks Allow constantly `[inspected]`

There are **two** prompt layers. v3 only partially softened the second; the first is the real fatigue source when the LLM emits one `host_computer` call per click (common).

| Layer | Where | Current rule | Hermes mismatch |
|---|---|---|---|
| **Initial task L2** | `server.ts:466-468`, gate before execute | **Every** `host_computer` invocation asks; god-mode / auto-approve / thread-trust do **not** skip | One tool call = one Chrome dialog |
| **Mid-task reL2** | `executor.ts:606-652` + call sites | Budget, uncross, danger caution, experimental, FOREGROUND-YIELD, dialog | Partially mitigated by `ComputerSessionTrust` **only inside reL2** |

`session-trust.ts` is explicit: grant is recorded on initial L2 approve (`server.ts:927-939`), consulted **only** at top of `reL2()` — **initial L2 is unaffected**.

So even with a perfect reL2 auto-approve, **N separate `host_computer` tasks ⇒ N Side Panel dialogs**. That is not Hermes.

### 3.2 Risk-tier model (v4)

Define three operating tiers. Names are plan-local; map onto existing mechanisms.

| Tier | Name | When | User prompt? |
|---|---|---|---|
| **T0** | App admission | `coordinateAllowed` + vault + global computer switch | App-tab opt-in (already) |
| **T1** | Session operating grant | First `host_computer` for `(sessionId, app)` in this companion process / WS session | **One** critical L2 (task text + type corpus + budget + app) |
| **T2** | Continuous operate | Subsequent tasks **and** mid-task reconfirms for same `(sessionId, app)` while grant live | **Silent** (audit log only), except T3 |
| **T3** | Elevated risk | Hard safety edges that must break silence | **Always prompt** (or hard-deny) |

#### T3 always-prompt / hard-deny catalog (do not weaken)

| Event | Behavior | Rationale |
|---|---|---|
| Payment / transfer / captcha final-confirm click | **Hard-deny** (existing A4) | No re-confirm path by design |
| Type/key in credential context | **Hard-deny** | Existing |
| `computer.danger_detected` (region caution / window hard) | **Prompt** (keep reL2, **do not** session-auto-approve) | Real risk |
| `computer.experimental_suggestion` (TinyClick) | **Prompt** (keep) | Uncalibrated |
| Budget exhausted | **Prompt** (keep) | Explicit extension of authority |
| New type text **not** in prior L2 corpus | **Prompt** or refuse `TYPE_TEXT_NOT_CONFIRMED` | Corpus binding (A3) — prefer **new mini-L2 enumerating only new literals** rather than full task re-ask |
| FOREGROUND-YIELD foreign process (non self-UI) | **Prompt** (keep) | Real takeover |
| FOREGROUND-YIELD self-UI (Chrome side panel) | **Silent continue, no raise** (Defect 1) | Benign |
| Uncrossverified sub-budget exceeded | **Silent auto-renew under T2 grant** OR single prompt once per grant — **prefer silent with audit** under Hermes; sub-budget still tracks evidence | Fatigue without safety gain when grant exists |
| Vault blacklist / AST validation / high-risk tools | **Unchanged** Phase 1 exclusions | Constraint |

### 3.3 Session operating grant — concrete design

**Extend** `ComputerSessionTrust` (do **not** invent ThreadApprovals kind):

```text
grant record:
  sessionId
  appToken
  grantedAt
  typeCorpusHashSnapshot?   // optional: for detecting new type literals
  source: "initial_l2"
```

| API change | Behavior |
|---|---|
| `isTrusted(sessionId, app)` | Existing — true after grant |
| **NEW** use at **initial L2 gate** (`server.ts` host_computer branch) | If trusted **and** action draft type-corpus ⊆ previously confirmed corpus (or empty type set) **and** no T3-only flags → **skip dialog**, mint security token as if approved, audit `computer.session_trust.task_auto_approved` |
| New type literals in draft | **Cannot** full auto-approve — show L2 with **only new strings** highlighted (minimal friction) OR refuse with `TYPE_TEXT_NOT_CONFIRMED` and force agent to re-call with user-visible text — **prefer mini-L2** |
| `reL2()` | Keep auto-approve for non-T3 reasons when trusted; **exclude** danger + experimental from auto-approve (today auto-approves **all** reL2 reasons — **tighten**) |
| Revocation | Companion restart (existing); thread delete (`clearSession`); optional future "Revoke computer trust" UI — not blocking v4 |
| TTL | Process lifetime is OK for v4; optional 30 min idle expiry is nice-to-have, not required |

**Critical contract change to document** in tool-definitions:

> Old: "input injection is NEVER thread-trusted — every task asks."  
> New: "First task per (session, app) always asks. Subsequent tasks in the same session for the same app are silent unless new type corpus, danger, experimental, budget, or foreign FOREGROUND-YIELD."

Update `bridge/tool-definitions.ts:549` description accordingly so the LLM does not promise "you'll be asked every time."

### 3.4 Why not only "batch more actions into one task"?

Agent behavior is not controlled by us. Hermes UX must hold for **one action per tool call**. Session grant is mandatory; multi-action tasks remain an efficiency optimization, not the safety/UX design.

### 3.5 Files / lines

1. `companion/src/computer/session-trust.ts` — document expanded scope; optional corpus snapshot fields.
2. `companion/src/server.ts:466-470, 823-940, ~2078+` — initial L2 skip when grant + corpus ⊆; audit logs.
3. `companion/src/computer/executor.ts:606-623` — **split** auto-approve allowlist: budget / uncross / self-ui / dialog-after-grant vs **never** auto danger/experimental.
4. `companion/src/bridge/tool-definitions.ts:549` — contract text.
5. Tests: session-trust + executor reL2 reason matrix + server gate unit/integration if present.

---

## 4. Defect 3 — coordinate space audit & canonical system

### 4.1 Symptom `[inspected]`

```ts
// executor.ts:857-862
const cw = shot.client.width
const ch = shot.client.height
// throw OUT_OF_BOUNDS if pointClient outside [0,cw) × [0,ch)
// Example: (722.79, 872.09) vs client 880×640
```

872 > 640 ⇒ y is **not** in the client-logical space used for the bounds check. 872 ≈ 880 suggests **x/y swap**, **image-pixel y on a 2× capture**, or **wrong window meta** — plan treats all three as first-class.

### 4.2 Spaces that exist today (must collapse to one)

| Space | Source | Units | Used by |
|---|---|---|---|
| **S0 Screen global** | `CGWindowList` bounds, AX position | Logical points (Retina: not pixels) | UIA locate hits (`types.ts:305-307`), CGEvent `mouseCursorPosition` |
| **S1 Window image** | PNG from SCK | **Device pixels** (often 2× logical) | OCR word boxes (`host.swift:967-978`), TinyClick, pixel diff, preview crosshair |
| **S2 Client-logical** | AX size / window bounds height−title | Logical points | `CaptureMeta.client`, bounds check, tool schema ("client-area physical pixels" — **misnamed**) |
| **S3 LLM output** | Model looking at the PNG (S1) or prompt text | **Whatever the model invents** | `action.x/y` explicit coords |

**Hardcoded lie** `[inspected]`: `host.swift:904` returns `"dpi": 72` always — no `image.width` / `image.height` / `scale` in JSON. Downstream cannot detect 2× mismatch.

### 4.3 Canonical system for v4

**Canonical: C = client-logical points of the target window**  
- Origin: top-left of **client area** (content below title bar), y-down.  
- Bounds: `[0, client.width) × [0, client.height)`.  
- Tool schema, bounds check, evidence seals, LLM instructions all speak **C**.

**Conversions (single shared module, e.g. `computer/coords.ts`):**

```text
scaleX = imageWidth  / rect.width     // typically 2 on Retina
scaleY = imageHeight / rect.height

// S1 image px → C
c.x = image.x / scaleX - client.x
c.y = image.y / scaleY - client.y

// C → S0 screen (for CGEvent / SLEventPostToPid)
screen.x = rect.x + client.x + c.x
screen.y = rect.y + client.y + c.y

// S0 → C (UIA)
c.x = uia.screenX - rect.x - client.x
c.y = uia.screenY - rect.y - client.y
```

(If `client.x/y` are already offsets inside the window bitmap in logical space, keep that definition consistent with `host.swift:833`.)

### 4.4 Mismatch sites to fix / instrument

| # | Site | Risk | v4 action |
|---|---|---|---|
| M1 | `host.swift:904` no image dimensions | Retina scale invisible | Return `imageWidth`, `imageHeight`, `scaleX`, `scaleY` (or single `backingScale`) |
| M2 | `MacScreenCapturer.captureWindow` (`darwin-adapters.ts:275-285`) | Drops scale | Plumb into `CaptureMeta` |
| M3 | `CaptureMeta` (`types.ts:239-252`) | No scale fields | Add `imageWidth`, `imageHeight`, `scaleX`, `scaleY` |
| M4 | OCR words in image px vs bounds in logical | L1 locate y overflow | Scale OCR → C inside locator or locate-chain |
| M5 | `locate-chain.ts:258-265` UIA S0→image assumes 1:1 | Wrong if image is 2× | Use scale-aware S0→C |
| M6 | Explicit LLM `action.x/y` treated as C without validation against image | `(722,872)` class | If point ∈ image pixel rectangle but not C, **auto-scale once** when `scale≈2` and scaled point ∈ C; log `computer.coords.autoscale`; if still OOB → `OUT_OF_BOUNDS` with **diagnostic payload** (cw,ch,imageW,imageH,scale,raw) |
| M7 | `injector.click(hwnd, pointClient)` → host CGEvent | **Client coords posted as if screen** `[inspected]` `executor.ts:1127` + `host.swift:1009` | **Convert C→S0 in MacInputInjector** (or host inject entry) before `CGEvent`. This is load-bearing for non-origin windows. |
| M8 | hwnd drift (resize / wrong window) | Stale client size | Per-action `infoForHwnd` already runs; compare `shot.rect` vs live bounds; if |Δ| > threshold → re-capture before bounds check |
| M9 | Tool text "physical pixels" | Misleads LLM toward image px | Rewrite to "client-logical points; origin top-left of content area; match screenshot **logical** size shown in capture meta" |

### 4.5 `(722, 872)` diagnostic procedure (Claude must run before claiming fix)

1. Log one failing action: `rawLLM`, `shot.client`, `shot.rect`, `imageWidth/Height`, `hwnd`, window title.  
2. Classify:
   - **Retina**: `raw.y / scale ∈ [0,ch)` and `raw.x / scale ∈ [0,cw)` → M1–M6.  
   - **Swap**: `(raw.y, raw.x)` in bounds → model/schema issue; add schema reminder + optional swap heuristic only if both orientations unique.  
   - **Wrong hwnd**: image aspect ≠ client aspect → M8.  
3. Unit tests for each class in `coords.ts` + executor bounds.

### 4.6 Files / lines

1. `host.swift` screenshot JSON + rebuild.  
2. `types.ts` `CaptureMeta`.  
3. **NEW** `computer/coords.ts` (pure functions + tests).  
4. `locate-chain.ts` scale-aware mapping.  
5. `darwin-adapters.ts` capturer + **inject C→S0**.  
6. `executor.ts:857-862` diagnostic OOB + optional autoscale.  
7. `tool-definitions.ts` schema language.  
8. OCR path in `host.swift` / `MacLocator` — document whether OCR returns image px (yes today) and convert at boundary.

---

## 5. Acceptance criteria — manual lab sequence (G2)

**Environment**: Tahoe 26.5+, Accessibility + Screen Recording granted to `com.cmspark.host`, companion + extension paired, target app e.g. Notes or NetEase Music with `coordinateAllowed`.

**Setup**: Second app (TextEdit / terminal) stays frontmost for the entire lab. Operator watches Mission Control / menu bar app name.

### G2-A — Frontmost invariant (Defect 1)

| Step | Action | PASS | FAIL |
|---|---|---|---|
| A1 | Bring TextEdit frontmost | — | — |
| A2 | Start multi-action `host_computer` (screenshot + 3 clicks + type) on target | Target **does not** become frontmost on any screenshot | Menu bar flashes to target every step |
| A3 | `log show` / companion logs | No `cuActivatePid` / no activate path without canary env | Activate still unconditional |
| A4 | PNG of occluded target (optional) | Readable content of target window | Black/blank forces activate |

### G2-B — Prompt cadence (Defect 2)

| Step | Action | PASS | FAIL |
|---|---|---|---|
| B1 | First `host_computer` for `mac.app.X` | Exactly **one** Side Panel confirm | Zero (too open) or hard-deny missing |
| B2 | Second task same session same app, low-risk clicks only | **Zero** confirms | Second full L2 |
| B3 | Third task includes new `type` literal not in B1 corpus | Exactly one mini/full L2 showing new text | Silent type of unconfirmed text |
| B4 | Force danger caution path (test fixture / staged UI) | Confirm appears despite grant | Silent danger |
| B5 | Mid-task budget exhaust | Confirm appears | Silent unbounded |

### G2-C — Coordinates (Defect 3)

| Step | Action | PASS | FAIL |
|---|---|---|---|
| C1 | Capture meta logs show `imageWidth/Height` and `scale` | Present and consistent with PNG | dpi:72 only |
| C2 | Explicit click at known control center in **C** space | Control activates; no OOB | OOB or wrong control |
| C3 | Reproduce old class: feed image-pixel coords that are 2× C | Autoscale recovers **or** OOB message includes scale diagnostic | Opaque OOB `880x640` only |
| C4 | Window not at (0,0) | Click still hits control (proves C→S0) | Click lands at screen origin offset |

### G2-D — Safety non-regression

| Step | PASS |
|---|---|
| D1 | Payment-like label still hard-denies |
| D2 | S-P0-2: wrong host hash refuses spawn |
| D3 | SPI missing still returns one of 3 codes (not collapsed) |
| D4 | E-stop aborts mid-task |

**Stop rule for Claude**: implement → unit/integration green → notify user for G2; **do not** claim Hermes complete without G2-A/B/C pass.

---

## 6. Implementation order

### Phase graph

```text
[ P0 Integrity preserve ] ─────────────────────────────────────────┐
                                                                   │
[ P1 Defect1 host.swift screenshot no-activate ]                   │
        │ rebuild host + SHA                                       │
        ▼                                                          │
[ P2 CaptureMeta + coords.ts + screenshot JSON scale ] ────────────┤
        │                                                          │
        ├──────────────► [ P3 locate-chain + OCR scale ]           │
        │                                                          │
        └──────────────► [ P4 inject C→S0 in MacInputInjector ]    │
                                                                   │
[ P5 session grant at initial L2 gate + reL2 allowlist split ] ────┤
        │                                                          │
        ▼                                                          │
[ P6 executor self-UI skip-raise + OOB diagnostics ]               │
        │                                                          │
        ▼                                                          │
[ P7 tool-definitions contract text + tests green ]                │
        │                                                          │
        ▼                                                          │
[ P8 G2 manual lab — Claude stops, user runs ]                     │
```

### Sequencing rules

| Order | Work | Parallel? | Verify |
|---|---|---|---|
| **1** | P1 screenshot no-activate | Alone first — smallest UX win; independent | Unit: host binary canary; manual smoke capture behind window |
| **2** | P2 coords plumbing | After P1 only if sharing host rebuild; else can merge one rebuild | JSON fields present |
| **3** | P3 + P4 | **Parallel** after P2 (locate vs inject) | Unit tests `coords.ts`; existing executor OOB tests updated |
| **4** | P5 session grant | **Parallel** with P2–P4 (different files: server/session-trust) | Tests for auto-approve matrix |
| **5** | P6 executor self-UI + OOB diag | After P4 (inject contract) + P5 (confirm behavior) | Executor tests |
| **6** | P7 docs/schema/tests | After all code | full `npm test` companion computer suite |
| **7** | P8 G2 | Human only | Checklist §5 |

### File ownership (Claude commit boundaries)

Prefer **atomic commits** matching phases:

1. `host.swift` + rebuild SHA — Defect 1  
2. `types.ts` + `coords.ts` + capturer + locate-chain + injector — Defect 3  
3. `session-trust.ts` + `server.ts` + `executor.ts` reL2 split — Defect 2  
4. `tool-definitions.ts` + test updates  
5. (no G2 in git)

### Explicit non-touch list

- Vault blacklist / AST validation  
- S-P0-2 `host-integrity.ts` logic (only SHA constant update via build)  
- Three inject error codes (no collapse)  
- Plist `LSMinimumSystemVersion` 14.4  
- Windows / Linux adapters beyond shared `coords` types if needed  
- Biometric / ThreadApprovals kinds  

---

## 7. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | SCK background capture returns **stale/black** frame when occluded | Med | Wrong clicks | G2-A4; typed `CAPTURE_DEGRADED`; canary `CMSPARK_SCREENSHOT_FORCE_FG`; do not silently activate in prod |
| R2 | Removing activate re-opens b0faek-class mis-click when Chrome covers target | Med | Safety | SkyLight per-PID + occlusion check; self-UI no longer needs raise; if occlusion fails closed, task pauses honestly |
| R3 | Session grant **over-trusts** — silent multi-task injection after one approve | Med (by design) | User surprise / abuse | Grant is process+session scoped; new type corpus re-asks; danger/experimental never auto; e-stop; panel abort; audit logs; document in UI copy |
| R4 | Tightening reL2 auto-approve (exclude danger) **increases** prompts vs current session-trust spike | Low | Slightly more prompts than broken spike | Correctness > spike behavior; still ≪ per-task L2 |
| R5 | Autoscale heuristic mis-classifies swap as retina | Low | Wrong click | Only autoscale when **both** raw/scale in-bounds exclusive; else OOB with diagnostics; never clamp |
| R6 | C→S0 inject conversion double-applies if host later also offsets | Med | Click miss | Single conversion site (prefer TypeScript injector); host documents "expects global screen points"; add host self-check comment |
| R7 | Multi-monitor / non-main display origins | Med | Missed clicks off main display | v4: document known gap (v3 D7 deferred); G2-C4 on primary display required; multi-monitor = follow-up |
| R8 | LLM still one-action tasks — grant helps prompts but not model quality | High | Residual OOB / bad targets | Coord fix + better schema text; not a prompt-cadence failure |
| R9 | Host rebuild SHA drift breaks integrity gate in CI | Med | CI red | Existing auto-rewrite; any `host.swift` change **must** update `CMSPARK_HOST_SHA256` in same commit |
| R10 | Plan itself under-scopes "initial L2 skip" security review | Med | Pi rejection | Pi must explicitly approve §3.3 contract change; if rejected, fall back to **Defect1+3 only** and accept multi-task prompts until product decision |
| R11 | Self-UI skip-raise leaves target occluded for **pixel** dialog detector | Low | False dialog pauses | Detector uses capture diff of target window, not global screen; occlusion ≠ foreign dialog |

### Acknowledged tradeoffs (not bugs)

1. **Hermes silence vs critical-class purity** — v4 deliberately weakens "every task asks" to "first task asks per session/app." That is the product requirement.  
2. **No activate ⇒ possible worse captures** when macOS will not composite occluded windows — fail honest rather than steal focus.  
3. **Autoscale is a compatibility crutch** — long-term the model should receive logical-size images or an explicit scale in the tool result; v4 may still send retina PNGs but **must** state logical size in tool result metadata.

---

## 8. Constraints checklist (must remain green)

| Constraint | Plan stance |
|---|---|
| Tahoe 26.5+ ship target; plist floor 14.4 | Unchanged |
| Phase 1 excludes 5 high-risk tools / vault blacklist / AST | Unchanged — not in touch list |
| S-P0-2 spawn guard | Keep; SHA update only via build |
| 3 inject error codes distinct | Keep; no collapse |
| `multi_agent_advisor_pattern` | This plan → Pi confirm → Claude codes |
| Out of scope | Win 1.5, Linux AT-SPI, biometric |

---

## 9. What Claude does / does not do

**After Pi approval (or conditional approval with listed edits):**

1. Implement in order §6.  
2. Run companion computer-use tests after each phase.  
3. Surface design blockers back to Grok — no unilateral redesign.  
4. **Stop before G2 manual lab**; notify user with build instructions.

**Until Pi lands:** no code changes from Claude (per user directive).

---

## 10. Pi review questions (explicit)

Please answer each in `docs/decisions/v1.3/review-pi-plan-v4.txt`:

1. Does §1 checklist actually match Hermes/OpenClaw, or is something missing (e.g. AX-first preference)?  
2. Is removing screenshot activate + skip self-UI raise safe given occlusion checks, or is a narrower "activate only if capture variance == 0" needed?  
3. Approve / reject **initial L2 session skip** (§3.3)? If reject, is Defect 2 then only reL2 tightening?  
4. Is the C-space + autoscale + C→S0 inject plan sufficient to catch `(722,872)` class bugs?  
5. Verdict: **APPROVE** / **CONDITIONAL APPROVE** (list diffs) / **REJECT**.

---

## 11. ADR (decision snapshot)

| Field | Content |
|---|---|
| **Decision** | v4 delivers Hermes UX via (1) no screenshot activate, (2) session/app operating grant skipping repeat initial L2 for low-risk drafts, (3) client-logical canonical coordinates with scale plumbing and C→S0 inject |
| **Drivers** | User foreground thrash + Allow fatigue; SkyLight alone insufficient |
| **Alternatives** | Independent patches; ThreadApprovals persistence |
| **Why chosen** | Closes vicious cycle; reuses session-trust; process-scoped trust avoids W7 ThreadApprovals block |
| **Consequences** | Security contract softens from per-task to per-session/app; must document; danger/experimental stay interactive |
| **Follow-ups** | Multi-monitor coords; logical-size capture option; drag via SkyLight; Stage 3 FORCE_FG cleanup |

---

*End of Grok v4 plan. Awaiting Pi confirmation.*
