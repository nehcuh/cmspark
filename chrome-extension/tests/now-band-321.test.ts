// #321 PR-2「一条 Now」— FocusBand absorbs SceneStatusBar / RunBusyChip /
// WorkerScopeBar. These tests pin the PR's hard assertions:
//   1. FocusBand stays ≤80px (constants untouched; new rows ≤ tier budgets)
//   2. No fourth independent horizontal band above the conversation
//   3. Scene attached ⇒ scene chips visible (idle definition excludes scene)
//   4. Confirm > 急停 semantics unchanged (attention never displaced)
//   5. Legacy data-testids ride the new nodes
//   6. buildScopedRunBusyInput has exactly one derivation site

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  resolveFocusBandSlot,
  sceneChipsSecondary,
  type FocusBandInput,
} from "../src/sidepanel/components/focus-band-priority"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

const base: FocusBandInput = {
  hasPendingConfirm: false,
  hasL2Task: false,
  l2AbortRequired: false,
  hasFleetActivity: false,
  isBrowserContext: false,
}

test("#321 PR-2: height budget constants unchanged (≤80px hard cap)", () => {
  assert.equal(FOCUS_BAND_MAX_PX, 80)
  assert.equal(FOCUS_BAND_PRIMARY_MAX_PX, 56)
  assert.equal(FOCUS_BAND_SECONDARY_MAX_PX, 24)
})

test("#321 PR-2: new ladder — worker_scope > run_busy > l1_context > scene > empty", () => {
  // worker_scope wins over run_busy / L1 / scene
  assert.equal(
    resolveFocusBandSlot({
      ...base,
      hasWorkerScope: true,
      hasRunBusy: true,
      isBrowserContext: true,
      hasScene: true,
    }).primary,
    "worker_scope",
  )
  // run_busy wins over L1 / scene
  assert.equal(
    resolveFocusBandSlot({
      ...base,
      hasRunBusy: true,
      isBrowserContext: true,
      hasScene: true,
    }).primary,
    "run_busy",
  )
  // L1 context still beats scene (scene never displaces work-state L1)
  assert.equal(
    resolveFocusBandSlot({ ...base, isBrowserContext: true, hasScene: true }).primary,
    "l1_context",
  )
  // scene alone keeps the band alive — 场景不算 idle 破坏者，绝不隐藏场景名
  const sceneAlone = resolveFocusBandSlot({ ...base, hasScene: true })
  assert.equal(sceneAlone.primary, "scene")
  assert.deepEqual(sceneAlone, {
    primary: "scene",
    secondaryAbort: false,
    secondaryContext: false,
    secondaryTools: false,
  })
  // everything off → still empty (scene absent does not resurrect the band)
  assert.equal(resolveFocusBandSlot(base).primary, "empty")
})

test("#321 PR-2: attention states unchanged — Confirm/L2 own the band even with new flags on", () => {
  const withNewFlags: FocusBandInput = {
    ...base,
    hasWorkerScope: true,
    hasRunBusy: true,
    hasScene: true,
  }
  assert.equal(
    resolveFocusBandSlot({ ...withNewFlags, hasPendingConfirm: true }).primary,
    "confirm",
  )
  assert.equal(
    resolveFocusBandSlot({ ...withNewFlags, hasL2Task: true, l2AbortRequired: true }).primary,
    "l2_safety",
  )
  // Confirm + L2 running keeps 急停 secondary (hard rule 1, 只扩不改)
  assert.equal(
    resolveFocusBandSlot({
      ...withNewFlags,
      hasPendingConfirm: true,
      hasL2Task: true,
      l2AbortRequired: true,
    }).secondaryAbort,
    true,
  )
})

test("#321 PR-2: sceneChipsSecondary matrix — rides under light primaries, yields to attention/height", () => {
  const lightSlot = resolveFocusBandSlot({ ...base, hasFleetActivity: true })
  assert.equal(lightSlot.primary, "fleet")
  assert.equal(sceneChipsSecondary(lightSlot, true), true)

  const l1Slot = resolveFocusBandSlot({ ...base, isBrowserContext: true })
  assert.equal(l1Slot.primary, "l1_context")
  assert.equal(sceneChipsSecondary(l1Slot, true), true)

  const confirmSlot = resolveFocusBandSlot({ ...base, hasPendingConfirm: true })
  assert.equal(sceneChipsSecondary(confirmSlot, true), false)

  const l2Slot = resolveFocusBandSlot({ ...base, hasL2Task: true })
  assert.equal(sceneChipsSecondary(l2Slot, true), false)

  const sceneSlot = resolveFocusBandSlot({ ...base, hasScene: true })
  assert.equal(sceneChipsSecondary(sceneSlot, true), false)

  // Secondary height consumed by abort/tools → scene waits
  assert.equal(
    sceneChipsSecondary(
      { primary: "confirm", secondaryAbort: true, secondaryContext: false, secondaryTools: false },
      true,
    ),
    false,
  )
  assert.equal(
    sceneChipsSecondary(
      { primary: "fleet", secondaryAbort: false, secondaryContext: false, secondaryTools: true },
      true,
    ),
    false,
  )
  // No scene attached → never render the row
  assert.equal(sceneChipsSecondary(lightSlot, false), false)
})

test("#321 PR-2: single buildScopedRunBusyInput derivation (was three)", () => {
  const files = [
    "App.tsx",
    ...readdirSync(join(process.cwd(), "src/sidepanel/components"))
      .filter((f) => typeof f === "string" && /\.tsx?$/.test(f))
      .map((f) => `components/${f}`),
    ...readdirSync(join(process.cwd(), "src/sidepanel/hooks"))
      .filter((f) => typeof f === "string" && /\.tsx?$/.test(f))
      .map((f) => `hooks/${f}`),
  ]
  const hits: string[] = []
  for (const f of files) {
    const body = readFileSync(join(process.cwd(), "src/sidepanel", f), "utf8")
    const occurrences = body.match(/buildScopedRunBusyInput\s*\(/g)
    if (occurrences) hits.push(...occurrences.map(() => f))
  }
  assert.deepEqual(hits, ["hooks/use-scoped-run-busy.ts"])
  // App + FocusBand both consume the hook
  assert.match(src("src/sidepanel/App.tsx"), /useScopedRunBusy\(\)/)
  assert.match(src("src/sidepanel/components/FocusBand.tsx"), /useScopedRunBusy\(\)/)
})

test("#321 PR-2: no fourth horizontal band — App stack is StatusRail + FocusBand above ChatView", () => {
  const app = src("src/sidepanel/App.tsx")
  assert.doesNotMatch(app, /<SceneStatusBar\s*\/>/)
  assert.doesNotMatch(app, /<RunBusyChip\s*\/>/)
  assert.doesNotMatch(app, /<WorkerScopeBar\s*\/>/)
  // Mount order: StatusRail … FocusBand … ChatView (nothing band-like between)
  const rail = app.indexOf("<StatusRail")
  const band = app.indexOf("<FocusBand")
  const chat = app.indexOf("<ChatView")
  assert.ok(rail >= 0 && band > rail && chat > band)
  const between = app.slice(band, chat)
  assert.doesNotMatch(between, /<[A-Z][A-Za-z]+\s*\/>/) // no self-closing component mounts
  // The three old band files are gone (readFileSync must throw ENOENT)
  const gone = (rel: string) => {
    try {
      src(rel)
      return false
    } catch {
      return true
    }
  }
  assert.ok(gone("src/sidepanel/components/SceneStatusBar.tsx"))
  assert.ok(gone("src/sidepanel/components/RunBusyChip.tsx"))
  assert.ok(gone("src/sidepanel/components/WorkerScopeBar.tsx"))
})

test("#321 PR-2: popout bar removed from ChatView, affordance lives on StatusRail", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.doesNotMatch(chat, /popoutBar|popoutDots|popoutBtn/)
  assert.doesNotMatch(chat, /const handlePopout/)
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  assert.match(rail, /onPopout/)
  assert.match(rail, /canPopout/)
  assert.match(rail, /弹出对话框/)
  assert.match(rail, /IconExternal/)
})

test("#321 PR-2: legacy data-testids ride the new nodes", () => {
  const row = src("src/sidepanel/components/SceneStatusRow.tsx")
  assert.match(row, /data-testid="scene-status-bar"/)
  assert.match(row, /data-testid="tool-surface-chip"/)
  const fb = src("src/sidepanel/components/FocusBand.tsx")
  assert.match(fb, /data-worker-scope-bar/)
})

test("#321 PR-2: dark chrome stays exclusive to Confirm/急停 — scene/runbusy/worker are light", () => {
  const fb = src("src/sidepanel/components/FocusBand.tsx")
  // SceneStatusRow and the run-busy/worker rows must not reference dark tokens
  const row = src("src/sidepanel/components/SceneStatusRow.tsx")
  assert.doesNotMatch(row, /darkBg|darkElevated|darkBorder|darkDanger/)
  // In FocusBand, dark tokens appear only in the abort line + dark card shell
  const darkRefs = [...fb.matchAll(/tokens\.dark\w+/g)].map((m) => m[0])
  assert.ok(darkRefs.length > 0)
  const stylesBlock = fb.slice(fb.indexOf("const styles"))
  const abortBlock = stylesBlock.slice(
    stylesBlock.indexOf("abortLine:"),
    stylesBlock.indexOf("secondaryContext:"),
  )
  for (const ref of new Set(darkRefs)) {
    assert.ok(
      abortBlock.includes(ref) || ref === "tokens.darkElevated" || ref === "tokens.darkBorder",
      `dark token ${ref} used outside abort/dark-card chrome`,
    )
  }
  // New primaries resolve to the light card in cardTone logic (confirm→confirm, l2/abort→dark, else light)
  assert.match(fb, /: "light"/)
})

test("#321 PR-2: new rows fit their tier budgets (≤56 primary / ≤24 secondary)", () => {
  const row = src("src/sidepanel/components/SceneStatusRow.tsx")
  assert.match(row, /maxHeight:\s*36/) // scene primary row ≤56 tier
  assert.match(row, /rowSecondary:\s*\{[\s\S]*?maxHeight:\s*24/) // secondary ≤24
  const fb = src("src/sidepanel/components/FocusBand.tsx")
  assert.match(fb, /maxHeight:\s*FOCUS_BAND_MAX_PX/)
  // worker/runbusy rows are single-line with capped height
  const worker = fb.slice(fb.indexOf("workerRow:"), fb.indexOf("workerBack:"))
  assert.match(worker, /maxHeight:\s*28/)
  const runBusy = fb.slice(fb.indexOf("runBusyRow:"), fb.indexOf("runBusyDot:"))
  assert.match(runBusy, /maxHeight:\s*28/)
})

test("#321 PR-2: scene visibility wiring — FocusBand derives hasScene and renders the row", () => {
  const fb = src("src/sidepanel/components/FocusBand.tsx")
  assert.match(fb, /readSceneStatus/)
  assert.match(fb, /hasScene/)
  assert.match(fb, /sceneChipsSecondary\(slot, hasScene\)/)
  assert.match(fb, /slot\.primary === "scene" && <SceneStatusRow \/>/)
  assert.match(fb, /sceneAsSecondary && <SceneStatusRow secondary \/>/)
  // worker + runbusy primaries render their rows
  assert.match(fb, /slot\.primary === "worker_scope"/)
  assert.match(fb, /slot\.primary === "run_busy"/)
  assert.match(fb, /SET_FLEET_LIST_OPEN/)
})
