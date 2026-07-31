// PR7 — Cockpit StatusRail grammar (mode badge + connection labels align with Panel)
import test from "node:test"
import assert from "node:assert/strict"
import { cockpitModeBadgeLabel } from "../src/cockpit/cockpit-status"
import {
  connectionColorDark,
  connectionLabel,
  tokens,
} from "../src/sidepanel/ui/tokens"

test("cockpitModeBadgeLabel: LIVE when task active", () => {
  assert.equal(
    cockpitModeBadgeLabel({ live: true, hasTask: true, hasConfirm: false }),
    "L2 · LIVE",
  )
})

test("cockpitModeBadgeLabel: L2 when task finished/present but not live", () => {
  assert.equal(
    cockpitModeBadgeLabel({ live: false, hasTask: true, hasConfirm: false }),
    "L2",
  )
})

test("cockpitModeBadgeLabel: 确认 when pending confirm only", () => {
  assert.equal(
    cockpitModeBadgeLabel({ live: false, hasTask: false, hasConfirm: true }),
    "确认",
  )
})

test("cockpitModeBadgeLabel: 工作区 idle", () => {
  assert.equal(
    cockpitModeBadgeLabel({ live: false, hasTask: false, hasConfirm: false }),
    "工作区",
  )
})

test("Cockpit connection grammar shares Panel labels", () => {
  assert.equal(connectionLabel("connected"), "已连接")
  assert.equal(connectionLabel("connecting"), "连接中")
  assert.equal(connectionLabel("disconnected"), "未连接")
  // Dark surface uses darkLive not light success
  assert.equal(connectionColorDark("connected"), tokens.darkLive)
  assert.notStrictEqual(connectionColorDark("connected"), tokens.success)
})
