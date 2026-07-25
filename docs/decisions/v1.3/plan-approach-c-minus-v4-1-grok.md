# Approach C-minus v4.1 Patch — Pi Blocker Resolution

**Author**: Grok (planning owner)  
**Date**: 2026-07-24  
**Status**: DRAFT — awaits Pi re-confirmation before Claude proceeds P2+  
**Base**: `docs/decisions/v1.3/plan-approach-c-minus-v4-grok.md` (v4)  
**Trigger**: Pi CONDITIONAL APPROVE (Q2 + Q3 blockers; Q1/Q4 non-blocking required diffs)  
**Scope guard**: Does **not** reopen plist 14.4, S-P0-2, 3 inject error codes, Phase 1 high-risk exclusions.  
**Evidence tags**: `[inspected]` code-path re-verified 2026-07-24 in approach-c-minus-skylight worktree; `[assumed]` design contract

---

## 0. How to read this patch

This is a **delta against v4**, not a full rewrite. Apply patches in document order onto the v4 plan. Unmentioned sections of v4 remain in force.

| Pi ID | Verdict | v4.1 action |
|---|---|---|
| Q1 | PASS + adds | D-Q1-add: V9, V10 in §1 |
| Q2 | **BLOCKER** | D2.1–D2.3 + self-UI buffer note |
| Q3 | **BLOCKER** | D3.1–D3.4 |
| Q4 | PASS + adds | D4.1–D4.3 |
| Q5 | CONDITIONAL APPROVE | This patch clears both blockers |

**Sequencing reminder (Pi)**: P1 (`host.swift` screenshot no-activate) is safe under v3 inject invariants and may proceed (or already landed as canary-gated path — `[inspected]` `host.swift:792-808`). **P5 (session grant) MUST NOT start until Pi re-confirms this v4.1.** P2+ after re-confirm.

---

## 1. Non-blocking: §1 vision checklist additions (D-Q1-add)

**Replace** v4 §1 table rows V5–V8 footer with the following **additions** (keep V1–V8; append V9–V10):

| # | Property | Pass signal | v3 status | v4 owner |
|---|---|---|---|---|
| V9 | **AX-first locate preference** — L0 UIA/AX identity preferred over pixel/OCR; image coords are fallback when AX is incapable | `locate-chain` still runs L0 before L1; a regression that silently drops L0 fails this item even if V5 (canonical coords) still passes | Partial — code has L0→L1 (`locate-chain.ts:239-374`) but plan never named the priority | Defect 3 + locate contract |
| V10 | **Capture frame metadata truthfulness** — image-scale metadata MUST be truthful and present on every successful capture | Every capture JSON / `CaptureMeta` carries real `imageWidth`, `imageHeight`, `scaleX`, `scaleY` (not hardcoded `dpi:72` alone); missing/false metadata is a contract bug | FAIL — `host.swift:914-915` returns `"dpi": 72` hardcoded | Defect 3 M1 |

**Rationale (Pi Q1)**: Without V9, dropping L0 still passes "canonical coords." Without V10, M1 is only an implementation fix, not a durable contract.

---

## 2. BLOCKER 1 — Screenshot variance classifier + self-UI safety (Q2 / D2.1–D2.3)

### 2.1 REPLACE v4 §2.4 entirely

#### 2.4 Occlusion / stale-frame contract after no-activate `[inspected]`

**Facts re-verified**:

- SCK path already uses `SCContentFilter(desktopIndependentWindow:)` with `excludingDesktopWindows(false, onScreenWindowsOnly: false)` (`host.swift:869-876`) — window backing store, not screen composite.
- `MacScreenCapturer.captureWindow` has no retry / variance detection (`darwin-adapters.ts` capture path).
- SHA256 of PNG bytes is computed in `cuScreenshot` at `host.swift:914` immediately before the success JSON return.
- Diff primitive exists: `cuImgDiff` cell-loop at `host.swift:932+`.
- Click inject keeps `--check-occlusion` (`darwin-adapters.ts` MacInputInjector.click).

**Plan decision (fail-closed, not soft-degraded)**:

| Item | Contract |
|---|---|
| **Classifier name** | Stale / solid-frame detector (internal) |
| **Site** | `companion/src/host-use/darwin/host.swift` — `cuScreenshot`, **after** PNG write + **alongside** existing SHA256 at `:914`, **before** success JSON return. Not in TypeScript: host already has the `CGImage` and `cuImgDiff` cell machinery; TS only maps the typed error. |
| **Threshold (quantified)** | Frame is **stale/solid** if **either**: (1) **luma stdev** of the full captured image `< 1.0` (near-uniform black/white/solid), **OR** (2) when a prior capture for the **same `windowId`** exists in the host process cache (last successful PNG path or in-memory downsample), **≥ 99% of pixels are identical** to that prior frame (downsample to ≤ 64×64 cells for cost; identical-cell ratio ≥ 0.99). First capture of a windowId has no prior → only (1) applies. |
| **On trip** | Return **hard error** with code **`CAPTURE_FAILED`** (existing `types.ts:177` / host error code surface). **Do not** invent `CAPTURE_DEGRADED`. **Do not** auto-activate. |
| **Audit (operators only)** | Log stderr + companion maps to audit event **`computer.capture.degraded`** with `{ windowId, reason: "luma_stdev"|"pixel_identity", metric, threshold, sha256? }`. This event is **never** placed in tool-result text or LLM-visible channels. |
| **LLM / tool surface** | Model and tool result see only **`CAPTURE_FAILED`** (typed `ComputerError`). Task pauses honestly. No soft "degraded, please activate" string that page content or prior tool results could teach the model to request. |
| **TS mapping** | `darwin-adapters.ts` `MacScreenCapturer.captureWindow`: on host error code `CAPTURE_FAILED`, throw `ComputerError("CAPTURE_FAILED", …)` unchanged enum. No new code. |
| **Canary** | `CMSPARK_SCREENSHOT_FORCE_FG=1` remains the only activate path (already partially landed `[inspected]` `host.swift:803-808`). Not used as automatic recovery on classifier trip. |
| **Inject occlusion** | Unchanged: `--check-occlusion` on click; fails closed without raise. |

**Classifier sketch (host.swift, load-bearing site)**:

```swift
// In cuScreenshot, after PNG write, before success return (~line 914):
// 1. Compute luma stdev over CGImage (or 64×64 downsample of capturedImage).
// 2. If priorSHA/priorCells for windowId exist and identity ≥ 0.99 → fail.
// 3. If lumaStdev < 1.0 → fail.
// 4. Else update prior cache for windowId; compute sha256; return success JSON
//    including imageWidth/imageHeight/scaleX/scaleY (M1 — see D4.1).
// On fail:
//   fputs audit line for computer.capture.degraded …
//   return cuError("stale or solid capture frame", code: "CAPTURE_FAILED")
```

**Lab case C (minimized / other Space)**: fail with **`CAPTURE_FAILED`** (or existing capture/window errors if SCK throws first). Typed, no auto-activate. Explicitly: use `CAPTURE_FAILED`, not a new enum member.

### 2.2 Self-UI skip-raise safety (amend v4 §2.3)

**Add** to the FOREGROUND-YIELD self-UI row / §2.3 action:

> When self-UI yield is detected **and** skip-raise is taken (Darwin SkyLight path): **do not re-raise**; log `computer.task.foreground_yielded.self_ui.skip_raise` and `continue`.
>
> **Why after-frame channels remain valid**: post-action `diff` / zone / blob (`executor.ts:1165`) compare two captures obtained via **windowID** SCK (`desktopIndependentWindow`). They operate on the **target window backing store**, not the screen composite. Chrome sitting frontmost does **not** replace the after-frame content of the target hwnd. Therefore self-UI skip-raise is a **non-event** for diff/zone/blob false-positive dialog detection. No need to skip or relax `diffRatio` thresholds on self-UI yield.
>
> Foreign-process FOREGROUND-YIELD (non self-UI) still pauses / prompts (T3).

### 2.3 R1 mitigation restatement (D2.3) — patch v4 §7 R1

| ID | Risk | Likelihood | Impact | Mitigation (**v4.1**) |
|---|---|---|---|---|
| R1 | SCK background capture returns **stale/black** frame when occluded | Med | Wrong clicks / silent bad evidence | **G2-A4** + **§2.4 classifier** in `cuScreenshot` (luma stdev `< 1.0` OR ≥99% identity vs prior same windowId) emits **`CAPTURE_FAILED`** fail-closed + operator audit `computer.capture.degraded` (never LLM-visible) + canary `CMSPARK_SCREENSHOT_FORCE_FG` for A/B only |

Delete v4's "typed CAPTURE_DEGRADED" wording everywhere (R1, §2.4). Soft degraded **surface to the model is rejected**.

### 2.4 Files / lines delta for Defect 1 (amend v4 §2.5)

1. `host.swift` `cuScreenshot` — no-activate (canary only; may already be landed `:792-808`) + **variance classifier before success return (~`:914`)** + scale fields in JSON (shared with Defect 3 M1).  
2. `darwin-adapters.ts` — map `CAPTURE_FAILED`; no LLM-facing degraded string.  
3. `executor.ts:1337-1371` — self-UI skip-raise + buffer note (no diff relaxation needed).  
4. Rebuild host + SHA (S-P0-2 path unchanged).

---

## 3. BLOCKER 2 — Initial L2 session skip hardening (Q3 / D3.1–D3.4)

### 3.1 D3.1 — `reL2ShouldPrompt` as code-level predicate

**Contract change (explicit)**: today's `session-trust` grants **blanket** reL2 auto-approval when `isTrusted` (`executor.ts:617-622` `[inspected]`). v4.1 **narrows** that to a **reason allowlist**. This is a **contract change**, not only a doc table.

#### Function (pure, unit-tested)

**Location**: `companion/src/computer/session-trust.ts`  
**Signature**:

```ts
/**
 * Returns true when a mid-task reL2 reason must always surface a human prompt,
 * even if (sessionId, app) is trusted under the v4 session operating grant.
 *
 * Call site: executor.ts reL2() ~617-622 — replace blanket isTrusted auto-approve.
 */
export function reL2ShouldPrompt(reason: string): boolean
```

**Also export reason constants** (or accept the existing `dangerousApis` / reason tags already passed into `reL2`) so the matrix is not fragile string-matching on Chinese user-facing copy alone. Prefer matching on the **stable tag** already passed as `dangerous: string[]` (e.g. `computer.danger_detected`) with `reason` as secondary:

```ts
export function reL2ShouldPrompt(tags: readonly string[], reasonText?: string): boolean
```

**Recommended implementation shape** (Claude picks one; tests lock behavior):

```ts
// session-trust.ts
export const REL2_PROMPT_ALWAYS_TAGS = [
  "computer.danger_detected",
  "computer.experimental_suggestion",
  // foreign FOREGROUND-YIELD uses confirm with a distinctive tag — ensure call
  // sites pass one of these stable tags (add if missing today):
  "computer.foreground_yielded",
] as const

export const REL2_SILENT_WHEN_TRUSTED_TAGS = [
  "computer.budget_exhausted",
  "computer.uncrossverified_exceeded", // or whatever tag uncross path uses
  "computer.dialog_suspected", // only after grant; still audit-logged
  // self_ui_yield must NOT call reL2 at all (skip_raise continue) — not in matrix
] as const

export function reL2ShouldPrompt(tags: readonly string[]): boolean {
  // Any prompt-always tag → true. Unknown tags → true (fail closed).
  // Only pure silent-allowlist tags (and empty) may return false.
}
```

**Call-site change** (`executor.ts:617-622`):

```ts
// BEFORE (v3 spike — blanket):
if (trust.isTrusted(deps.sessionId, params.app)) {
  log("computer.task.reconfirm.auto_approved", { taskId, reason, app: params.app })
  return true
}

// AFTER (v4.1):
if (
  trust.isTrusted(deps.sessionId, params.app) &&
  !reL2ShouldPrompt(dangerous) // stable tags; not Chinese reason prose
) {
  log("computer.task.reconfirm.auto_approved", { taskId, reason, tags: dangerous, app: params.app })
  return true
}
// else fall through to existing confirm dialog
```

**Matrix (T3 catalog elevated to code)** — unit-test every row:

| Tag / situation | Trusted session? | Prompt? |
|---|---|---|
| `computer.budget_exhausted` | yes | **silent** auto-approve + audit |
| uncrossverified sub-budget exceeded | yes | **silent** + audit |
| self-UI yield | n/a | **no reL2** (skip_raise continue) |
| dialog_suspected after grant (non-danger) | yes | **silent** + audit (Hermes) **or** prompt once — prefer silent with audit per v4 T2; tests document choice |
| `computer.danger_detected` | yes | **always prompt** |
| `computer.experimental_suggestion` | yes | **always prompt** |
| foreign FOREGROUND-YIELD (`computer.foreground_yielded`) | yes | **always prompt** |
| unknown / untagged reason | yes | **always prompt** (fail closed) |
| any of the above | no | **always prompt** (unchanged) |

**Note on FOREGROUND-YIELD call site** (`executor.ts:1373+`): ensure `dangerous` array includes a stable tag (`computer.foreground_yielded`) so the predicate does not depend on free-text `reason`.

### 3.2 D3.2 — Credential-surface re-scan forces next initial L2

**Attack residual**: session trust skips initial L2; a click (not type/key) can move focus onto a password field. Type/key hard-deny (`executor.ts:893-902`) does not block the **focusing click**. After-frame OCR already scans credentials (`executor.ts:1216-1243` `[inspected]`).

**Rule (mandatory)**:

> Even under session trust, if an action's **after-frame** danger scan finds **any** credential rect (`credentialRects.length > 0`), set a session-scoped flag. The **next** initial L2 for that `(sessionId, app)` **cannot skip** — must prompt — even if still "trusted" for reL2 silent reasons.

#### Data model

Extend grant record in `session-trust.ts` (process memory only):

```ts
type GrantRecord = {
  grantedAt: number          // ms epoch
  lastUsedAt: number         // ms epoch — for idle expiry (D3.4)
  credentialSurfaceSeen: boolean
  // optional: typeCorpusHashSnapshot from v4
}

// Map: sessionId -> Map<appToken, GrantRecord>
```

#### Write path

In `executor.ts` after after-frame OCR + `scanDanger` (~`:1223`):

```ts
if (afterBlur.length > 0 && deps.sessionId && params.app) {
  trust.markCredentialSurfaceSeen(deps.sessionId, params.app)
  log("computer.session_trust.credential_surface_seen", { taskId, app: params.app })
}
```

#### Read path (initial L2 gate)

At initial L2 skip decision (server gate — §3.4):

```ts
if (
  trust.isTrusted(sessionId, app) &&
  !trust.credentialSurfaceSeen(sessionId, app) &&
  !trust.isIdleExpired(sessionId, app) &&
  typeCorpus ⊆ prior &&
  !draftHasT3OnlyFlags
) {
  // skip dialog, mint token, audit computer.session_trust.task_auto_approved
} else {
  // full/mini L2 as today
}
```

After a successful **interactive** initial L2 approve while `credentialSurfaceSeen` was true: **clear** the flag (user has re-consented with fresh preview of the new surface), refresh `lastUsedAt` / `grantedAt`.

**Does not enlarge click-target attack surface beyond per-task L2 baseline** (Pi A2 documentation): initial-L2-skip still does not enumerate click targets; hard-deny + danger region scan + this credential latch are the residual controls. Document in tool-definitions contract text.

### 3.3 D3.4 — Idle expiry MANDATORY (override v4 "nice-to-have")

**Replace** v4 §3.3 TTL row:

| API / policy | Behavior (**v4.1**) |
|---|---|
| **TTL / idle expiry** | **Mandatory**. Default **`IDLE_EXPIRY_MS = 30 * 60 * 1000`** (30 minutes). Configurable via companion config key e.g. `computer.session_trust_idle_ms` (clamp 1 min … 24 h). On `isTrusted` / skip-gate consult: if `now - lastUsedAt > idleMs` → treat as **untrusted** (must prompt), clear or re-grant only after interactive approve. Touch `lastUsedAt` on grant, on successful task_auto_approved, and on any mid-task silent auto-approve. |
| Process lifetime | Still clears all trust on companion restart (unchanged). |
| `clearSession` | Unchanged on thread delete. |

**Rationale (Pi)**: long-running companion + long chat can accumulate hours of silent trust; cost of one extra prompt after idle ≪ cost of silent inject while user is away.

### 3.4 D3.3 — `server.ts` gate sites verified `[inspected]`

v4 cited `server.ts:466-470, 823-940, ~2078+`. Pi required verification of the second entry point.

| Site | Lines (worktree 2026-07-24) | Role | Trust skip applies? |
|---|---|---|---|
| **G1 — pre-dialog L2 gate** | `server.ts:465-470` (`hostComputerGated`) entering the block at `:471` | Decides whether to show critical-class confirmation when `!finalParams.security_token` | **YES — primary skip site.** If trust+corpus+!credentialSurface+!idleExpired → mint security token **without** dialog (same mint path as post-approve), audit `computer.session_trust.task_auto_approved`. |
| **G1b — dialog construction / grant record** | `server.ts:823-940` region (preview, originWs, approve → `getComputerSessionTrust().grant` at `:933-939`) | Interactive approve path; records grant | On **interactive** approve: `grant()` + clear `credentialSurfaceSeen` + set timestamps. Skip path must **not** double-prompt but **must** still mint token + may refresh `lastUsedAt`. |
| **G2 — execute case** | `server.ts:2078+` `case "host_computer":` | **Post-token execution only**. Validates `security_token`, single-task invariant, estop, runs executor. **Not an L2 dialog entry point.** | **No second L2.** Under T1/T2, behavior is identical whether token came from interactive approve or trust skip — G2 only checks token validity. **Missed skip at G1 cannot be "fixed" at G2** without weakening token binding; Claude must implement skip only at G1. |

**Claude checklist before coding P5**:

1. `rg -n "host_computer|hostComputerGated|security_token" companion/src/server.ts` — confirm no third pre-execute confirm path.  
2. Implement skip **only** where `hostComputerGated && !finalParams.security_token` would have shown the dialog.  
3. Token minting parameters (app + task + corpus hash) remain identical to interactive path so G2 validation is unchanged.  
4. Do **not** treat `case "host_computer"` as a place to bypass security_token.

### 3.5 Threat notes (Pi A1–A3) — document, not reopen daemon decision

| Attack | Stance in v4.1 |
|---|---|
| **A1 WS hijack / stolen sessionId** | Grant is process + session + app scoped + **30 min idle**. Loopback-only today. **Daemon-mode threat model is out of scope**; if daemon ships later, this grant shape must be re-reviewed (spike rejected daemon partly on this surface — v4.1 must not silently weaken that rejection). State in ADR consequences. |
| **A2 Prompt injection → new click targets** | Initial-L2-skip does **not** enlarge click-target surface beyond per-task L2 baseline. Hard-deny + danger region + **credential latch (D3.2)** + type corpus for TYPE. Document residual. |
| **A3 LLM output drift task1→task2** | Danger hard path still fail-closed; caution path **no longer** silent under trust (**D3.1**). |

### 3.6 Amend v4 §3.3 table rows (summary)

```diff
- | reL2() | Keep auto-approve for non-T3 reasons when trusted; exclude danger + experimental …
+ | reL2() | Call reL2ShouldPrompt(tags); silent only for allowlisted tags when trusted; danger /
+          experimental / foreign FG-yield / unknown → always prompt. See D3.1.

- | TTL | Process lifetime is OK for v4; optional 30 min idle expiry is nice-to-have, not required
+ | TTL | Process lifetime + MANDATORY idle expiry default 30 min (configurable). See D3.4.

+ | credentialSurfaceSeen | After-frame credential OCR → force next initial L2. See D3.2.
```

### 3.7 Amend v4 §3.5 Files / lines

1. `session-trust.ts` — `GrantRecord`, `reL2ShouldPrompt`, idle expiry, `markCredentialSurfaceSeen` / `credentialSurfaceSeen`, tests for matrix + idle + latch.  
2. `server.ts:465-470` + approve/mint path (`:823-940`) — initial L2 skip; **not** `:2078` (execution only).  
3. `executor.ts:617-622` — use `reL2ShouldPrompt`; ensure FOREGROUND-YIELD / danger / experimental pass stable tags.  
4. `executor.ts:1216-1243` — set credential latch on after-frame.  
5. `tool-definitions.ts:549` — contract text (first task / idle / danger / credential re-prompt).  
6. Tests: session-trust matrix, idle clock, credential latch, server gate skip vs force.

---

## 4. Non-blocking Q4 diffs (D4.1–D4.3)

### 4.1 D4.1 — scaleX AND scaleY (not singular backingScale)

**Amend** v4 §4.4 M1:

| # | Site | v4.1 action |
|---|---|---|
| M1 | `host.swift` screenshot JSON (~`:915`) | Return **`imageWidth`**, **`imageHeight`**, **`scaleX`**, **`scaleY`** as **separate** fields. `scaleX = imageWidth / rect.width`, `scaleY = imageHeight / rect.height` (guard div-by-zero → `CAPTURE_FAILED`). Do **not** collapse to a single `backingScale` (mixed-DPI multi-monitor / non-uniform scaling). Keep or derive truthful dpi if useful; **never** hardcode `72` as the only scale signal (V10). |
| M3 | `CaptureMeta` | Same four fields; both scales required on Darwin capture success. |

Autoscale (M6) uses the two scales independently when classifying Retina-class OOB.

### 4.2 D4.2 — M8 drift threshold named

**Amend** v4 §4.4 M8:

> Per-action `infoForHwnd` vs `shot.rect`: if `max(|Δx|,|Δy|,|Δw|,|Δh|) > DRIFT_THRESHOLD_PX` → re-capture before bounds check.  
> **`DRIFT_THRESHOLD_PX = 8`** — matches `WITNESS_TOLERANCE_PX` in `locate-chain.ts:99` `[inspected]`.

### 4.3 D4.3 — locate-chain `shot.rect` re-validation

**Add** to v4 §4.6:

> `locate-chain.ts`: bind `const rect0 = { ...shot.rect }` at chain entry. Before returning a hit from **each** layer (UIA L0, OCR L1, …), re-read live window bounds (or re-use capturer meta if chain re-shot) and if drift vs `rect0` exceeds **8px**, **abort layer hit** and either re-capture+restart chain once or return locate failure — do **not** convert UIA→image with a stale `shot.rect` (`locate-chain.ts:259-265` assumes 1:1 offset today; M5 scale-aware conversion still needs a fresh rect).

---

## 5. Risk register updates (§7)

| ID | Change |
|---|---|
| **R1** | **Replace** mitigation per §2.3 of this patch (`CAPTURE_FAILED` + classifier; no model-visible degraded). |
| **R3** | **Strengthen**: idle 30 min mandatory; credential latch; `reL2ShouldPrompt` narrows prior blanket trust. Residual: click-target injection within non-danger UI still session-silent (documented A2). |
| **R11** | **Confirm** self-UI skip-raise is non-event for diff channels (window buffer, not composite) — aligns with §2.2. |
| **R12 (NEW)** | Classifier false positive (live but low-variance UI, e.g. solid-color loading screen) → extra `CAPTURE_FAILED`. **Mitigation**: threshold stdev `< 1.0` is extreme; G2-A4 on real apps; canary FORCE_FG for lab only; do not auto-activate on FP. |
| **R13 (NEW)** | Classifier false negative (stale but noisy frame) → bad clicks. **Mitigation**: SkyLight + occlusion check; pixel dialog detector; G2; identity check vs prior when available. |
| **R14 (NEW)** | Daemon / multi-peer WS later reopens A1. **Mitigation**: out of scope; ADR states re-review required; idle expiry bounds process-local damage. |
| **R10** | **Update**: Pi CONDITIONAL APPROVE addressed by this v4.1; await re-confirm. Fallback (Defect1+3 only) still available if Q3 re-rejected. |

---

## 6. ADR snapshot update (§11 deltas)

| Field | v4 | **v4.1 delta** |
|---|---|---|
| **Decision** | no-activate + session grant skip + C-space coords | **+** fail-closed capture variance classifier (`CAPTURE_FAILED`); **+** `reL2ShouldPrompt` reason allowlist; **+** credential-surface latch; **+** mandatory 30 min idle expiry; **+** dual scaleX/scaleY; **+** V9 AX-first / V10 metadata truth |
| **Consequences** | softens per-task → per-session/app | Softening is **bounded**: prompt-always tags never silent; credential screen forces re-prompt; idle expiry; model never sees soft capture degraded; daemon threat unchanged (still rejected / re-review later) |
| **Follow-ups** | multi-monitor; logical-size capture; drag; FORCE_FG cleanup | **+** mixed-DPI straddle window; **+** optional identity-cache eviction policy; **+** consider logical-size PNG to retire autoscale crutch |

---

## 7. Implementation order delta (§6)

| Phase | v4 | v4.1 note |
|---|---|---|
| **P1** | host no-activate | **May start / may already be landed** (`host.swift:792-808`). Safe under v3 inject. Stop after P1+rebuild if Pi has not re-confirmed v4.1. |
| **P1b (NEW, with P1 or next host rebuild)** | — | Variance classifier + scaleX/Y JSON in same `cuScreenshot` edit train when possible (one rebuild). If P1 already shipped alone, P1b is next host touch. |
| **P2–P4** | coords / locate / inject | Apply D4.1–D4.3. |
| **P5** | session grant | **Blocked until Pi re-confirms v4.1.** Must include D3.1–D3.4 in the same PR train as skip-gate (do not land skip without predicate + latch + idle). |
| **P6–P8** | as v4 | self-UI note per §2.2; G2 adds classifier trip lab (force solid frame → CAPTURE_FAILED, no activate). |

### G2 additions

| Step | PASS |
|---|---|
| A5 | Induce solid/stale capture (if lab-feasible) → tool error `CAPTURE_FAILED`; logs contain `computer.capture.degraded`; **no** activate; LLM-facing result has no "degraded please activate" coaching |
| B6 | Idle 30 min (or test with injected clock) → next task prompts again |
| B7 | After click that surfaces password field → next task initial L2 prompts despite prior trust |
| B8 | Trusted session + danger caution path → Side Panel confirm (not silent) |

---

## 8. Claude do / don't (supersede conflicting v4 lines for blockers)

**Do after Pi re-confirm of this v4.1:**

1. Implement P1b classifier + D4 scale fields with host rebuild/SHA.  
2. Implement P5 **as a single atomic safety unit**: `reL2ShouldPrompt` + idle + credential latch + G1 skip together.  
3. Unit-test reason matrix, idle, latch, coords scales, locate rect re-validate.  
4. Never expose `CAPTURE_DEGRADED` or soft capture diagnostics on the tool/LLM surface.

**Do not:**

1. Start P5 before Pi re-confirm.  
2. Invent new error codes for stale capture.  
3. Auto-activate when classifier trips.  
4. Blanket `isTrusted` auto-approve all reL2 reasons.  
5. Treat `server.ts:2078` as an L2 gate.  
6. Reopen plist / S-P0-2 logic / 3 inject codes / Phase 1 exclusions.

---

## 9. Pi re-review checklist (short)

Please confirm each in `review-pi-plan-v4-1.txt` (or amend prior review):

- [ ] **B1**: Classifier threshold + site (`cuScreenshot` ~`:914`) + `CAPTURE_FAILED` + LLM-opaque audit — acceptable?  
- [ ] **B1**: Self-UI skip-raise + window-buffer diff note — acceptable?  
- [ ] **B2**: `reL2ShouldPrompt` location + fail-closed unknown tags — acceptable?  
- [ ] **B2**: Credential latch + clear-on-interactive-reapprove — acceptable?  
- [ ] **B2**: 30 min idle mandatory — acceptable?  
- [ ] **B2**: G1 vs G2 site split (`:465-470` skip, `:2078` execute-only) — correct?  
- [ ] Non-blocking V9/V10, scaleX/Y, 8px drift, locate rect re-validate — acceptable?  
- [ ] Verdict: **APPROVE** / **CONDITIONAL** (list) / **REJECT**

---

## 10. Diff index (quick)

| ID | Section | Load-bearing artifact |
|---|---|---|
| D-Q1-add | §1 | V9 AX-first; V10 capture metadata truth |
| D2.1 | §2.4 | stdev `< 1.0` OR ≥99% identity; site host.swift ~914; `CAPTURE_FAILED` |
| D2.2 | §2.4 | LLM sees only `CAPTURE_FAILED` |
| D2.3 | §7 R1 | mitigation depends on D2.1 |
| D2-self-ui | §2.3 | window buffer ⇒ skip-raise safe for diff |
| D3.1 | §3 | `reL2ShouldPrompt` in `session-trust.ts`; call `executor.ts:617-622` |
| D3.2 | §3 | `credentialSurfaceSeen` latch |
| D3.3 | §3 | server G1 vs G2 verified |
| D3.4 | §3 | idle 30 min mandatory |
| D4.1 | §4 | scaleX **and** scaleY |
| D4.2 | §4 | drift 8px |
| D4.3 | §4 | locate-chain rect re-validate |
| R12–R14 | §7 | new risks |
| ADR | §11 | v4.1 consequences |

---

*End of Grok v4.1 patch. Awaiting Pi re-confirmation. Claude: P1 only until then; P5 only after APPROVE on this document.*
