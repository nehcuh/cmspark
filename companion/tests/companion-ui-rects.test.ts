import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import { ComputerError } from "../src/computer/types"

afterEach(() => {
  clearCompanionUiRects()
})
import {
  clearCompanionUiRects,
  setCompanionUiRect,
  screenPointHitsCompanionUi,
  assertClickClearsCompanionUi,
  applyCompanionUiRectEvent,
} from "../src/computer/companion-ui-rects"

test("screen point inside overlay rect is a hard S23 hit", () => {
  clearCompanionUiRects()
  setCompanionUiRect({ surface: "overlay", x: 100, y: 200, width: 420, height: 180 })
  assert.equal(screenPointHitsCompanionUi(100, 200), "overlay")
  assert.equal(screenPointHitsCompanionUi(519, 379), "overlay")
  assert.equal(screenPointHitsCompanionUi(99, 200), null)
  assert.equal(screenPointHitsCompanionUi(520, 200), null)
  assert.throws(
    () => assertClickClearsCompanionUi(150, 250),
    (err: unknown) =>
      err instanceof ComputerError &&
      err.code === "COMPANION_UI_CLICK_DENIED" &&
      /overlay/.test(err.message),
  )
})

test("hidden surface does not hit; pairing/hud/tray do", () => {
  clearCompanionUiRects()
  setCompanionUiRect({ surface: "overlay", x: 0, y: 0, width: 10, height: 10 })
  setCompanionUiRect({ surface: "overlay", hidden: true })
  assert.equal(screenPointHitsCompanionUi(5, 5), null)
  setCompanionUiRect({ surface: "hud", x: 10, y: 10, width: 20, height: 20 })
  setCompanionUiRect({ surface: "pairing", x: 50, y: 50, width: 10, height: 10 })
  setCompanionUiRect({ surface: "tray", x: 0, y: 780, width: 24, height: 24 })
  assert.equal(screenPointHitsCompanionUi(15, 15), "hud")
  assert.equal(screenPointHitsCompanionUi(55, 55), "pairing")
  assert.equal(screenPointHitsCompanionUi(2, 790), "tray")
  assert.equal(assertClickClearsCompanionUi(0, 0), undefined)
})

test("summoner surface cannot apply hud rects; huge rects are rejected", () => {
  const { applyCompanionUiRectEvent, getCompanionUiRects, clearCompanionUiRects } =
    require("../src/computer/companion-ui-rects") as typeof import("../src/computer/companion-ui-rects")
  clearCompanionUiRects()
  assert.equal(
    applyCompanionUiRectEvent(
      { type: "companion.ui.rect", surface: "hud", x: 0, y: 0, width: 10, height: 10 },
      { allowSurfaces: new Set(["overlay"]) },
    ),
    false,
  )
  assert.equal(getCompanionUiRects().length, 0)
  assert.equal(
    applyCompanionUiRectEvent({
      type: "companion.ui.rect",
      surface: "overlay",
      x: 0,
      y: 0,
      width: 9000,
      height: 10,
    }),
    false,
  )
})

test("companion.ui.rect is a known WS type for daemon apply", () => {
  const { validateWsMessage } = require("../src/ws/validate") as typeof import("../src/ws/validate")
  assert.equal(
    validateWsMessage({ type: "companion.ui.rect", surface: "overlay", x: 1, y: 2, width: 3, height: 4 }).valid,
    true,
  )
})

test("applyCompanionUiRectEvent updates and hides surfaces", () => {
  clearCompanionUiRects()
  assert.equal(
    applyCompanionUiRectEvent({
      type: "companion.ui.rect",
      surface: "overlay",
      x: 1,
      y: 2,
      width: 10,
      height: 10,
    }),
    true,
  )
  assert.equal(screenPointHitsCompanionUi(5, 5), "overlay")
  assert.equal(
    applyCompanionUiRectEvent({ type: "companion.ui.rect", surface: "overlay", hidden: true }),
    true,
  )
  assert.equal(screenPointHitsCompanionUi(5, 5), null)
  assert.equal(applyCompanionUiRectEvent({ type: "summoner.ready" }), false)
})
