import test from "node:test"
import assert from "node:assert/strict"
import {
  tokens, workspacePalette,
  riskColor,
  riskColorDark,
  riskLabel,
  statusColor,
  connectionColor,
  connectionColorDark,
  connectionLabel,
  connectionDotShadow,
  connectionDotShadowDark,
} from "../src/sidepanel/ui/tokens"

test("tokens accent is quiet-premium indigo not Material", () => {
  assert.equal(workspacePalette.accent[0], "#4f46e5")
  const accent: string = tokens.accent
  const danger: string = tokens.danger
  assert.ok(accent !== "#4A90D9")
  assert.ok(danger !== "#F44336")
  assert.ok(accent !== "#2563eb") // former bright blue — upgraded for premium pass
})

test("darkWarning tokens exist for SafetyStrip", () => {
  assert.ok(tokens.darkWarning)
  assert.ok(tokens.darkWarningBg)
})

test("riskColor maps levels without Material hexes", () => {
  assert.equal(riskColor("low"), tokens.warning)
  assert.equal(riskColor("high"), tokens.danger)
  assert.equal(riskLabel("medium"), "中风险")
  assert.ok(!riskColor("high").includes("F44336"))
})

test("riskColorDark for dark surfaces", () => {
  assert.equal(riskColorDark("low"), tokens.darkWarning)
  assert.equal(riskColorDark("high"), tokens.darkDanger)
})

test("statusColor semantic", () => {
  assert.equal(statusColor("success"), tokens.success)
  assert.equal(statusColor("error"), tokens.danger)
  assert.equal(statusColor("running"), tokens.warning)
})

test("connectionColor uses status tokens only (no Material hex)", () => {
  assert.equal(connectionColor("connected"), tokens.success)
  assert.equal(connectionColor("connecting"), tokens.warning)
  assert.equal(connectionColor("disconnected"), tokens.danger)
  for (const s of ["connected", "connecting", "disconnected"] as const) {
    const c = connectionColor(s)
    assert.ok(c !== "#4CAF50" && c !== "#FF9800" && c !== "#F44336", c)
  }
  assert.equal(connectionLabel("connected"), "已连接")
  assert.equal(connectionLabel("connecting"), "连接中")
  assert.equal(connectionLabel("disconnected"), "未连接")
  assert.ok(connectionDotShadow("connected").includes("5, 150, 105"))
  assert.equal(connectionDotShadow("disconnected"), "none")
})

test("connectionColorDark uses dark status roles (Cockpit StatusRail)", () => {
  assert.equal(connectionColorDark("connected"), tokens.darkLive)
  assert.equal(connectionColorDark("connecting"), tokens.darkWarning)
  assert.equal(connectionColorDark("disconnected"), tokens.darkDanger)
  for (const s of ["connected", "connecting", "disconnected"] as const) {
    const c = connectionColorDark(s)
    assert.ok(c !== "#4CAF50" && c !== "#FF9800" && c !== "#F44336", c)
  }
  assert.ok(connectionDotShadowDark("connected").includes("52, 211, 153"))
  assert.equal(connectionDotShadowDark("disconnected"), "none")
  // Shared labels with Panel light grammar
  assert.equal(connectionLabel("connected"), "已连接")
})

test("radius SoT is 6/8/12 (UIUX v2)", () => {
  assert.equal(tokens.radiusSm, 6)
  assert.equal(tokens.radiusMd, 8)
  assert.equal(tokens.radiusLg, 12)
  assert.equal(tokens.radiusPill, 999)
})

test("semantic role hexes match companion canon tokens", () => {
  // surface.canvas / elevated (white companion)
  assert.equal(workspacePalette.bg[0], "#f8f8f4")
  assert.equal(workspacePalette.bgElevated[0], "#ffffff")
  assert.equal(tokens.darkBg, "#171717")
  assert.equal(tokens.darkElevated, "#222222")
  // text
  assert.equal(workspacePalette.text[0], "#202922")
  assert.equal(workspacePalette.textSecondary[0], "#45534b")
  assert.equal(tokens.emptyTitle, 22)
  assert.equal(tokens.radiusComposer, 20)
  // borders are translucent rgba (not flat gray)
  assert.equal(workspacePalette.border[0], "#dadfd7")
  assert.ok(String(tokens.darkBorder).includes("rgba"))
  // status.live / warn / danger
  assert.equal(workspacePalette.success[0], "#059669")
  assert.equal(workspacePalette.warning[0], "#d97706")
  assert.equal(workspacePalette.danger[0], "#dc2626")
  assert.equal(tokens.darkLive, "#34d399")
  assert.equal(tokens.darkWarning, "#fbbf24")
  assert.equal(tokens.darkDanger, "#f87171")
  assert.equal(workspacePalette.accent[0], "#4f46e5")
  assert.equal(tokens.darkAccent, "#818cf8")
  assert.ok(tokens.shadowFocus)
  assert.ok(tokens.shadowLg)
  // Hero surfaces
  assert.equal(tokens.radiusBubble, 14)
  // sheet / menu / scrim
  assert.equal(tokens.radiusSheet, 16)
  assert.equal(tokens.radiusMenu, 10)
  assert.ok(tokens.scrim.includes("15, 23, 42"))
  assert.ok(tokens.dangerSurface.includes("220, 38, 38"))
  assert.ok(tokens.modeBrowserLine)
  assert.ok(tokens.modeComputerLine)
})

test("workspace text and controls clear 4.5:1 in both system themes", () => {
  const luminance = (color: string) => {
    const [r, g, b] = color.slice(1).match(/../g)!.map(channel => {
      const value = parseInt(channel, 16) / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    })
    return .2126 * r + .7152 * g + .0722 * b
  }
  const pairs = [
    ["text", "bg"], ["textSecondary", "bgMuted"], ["textMuted", "bgElevated"],
    ["userBubbleInk", "userBubbleBg"], ["actionInk", "actionPrimary"],
    ["accent", "bg"], ["warningText", "warningSoft"],
  ] as const
  for (const theme of [0, 1] as const) {
    for (const [foreground, background] of pairs) {
      const first = luminance(workspacePalette[foreground][theme])
      const second = luminance(workspacePalette[background][theme])
      assert.ok((Math.max(first, second) + .05) / (Math.min(first, second) + .05) >= 4.5,
        `${foreground} on ${background}, theme ${theme}`)
    }
  }
})
