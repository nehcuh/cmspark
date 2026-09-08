import test from "node:test"
import assert from "node:assert/strict"
import { SysTray2Adapter } from "../src/tray/systray2-bridge"

test("tray has no adjacent title and status changes preserve menu action routing", () => {
  const tray = new SysTray2Adapter() as any
  for (const [status, color, word] of [["running","green","运行中"],["stopped","red","已停止"],["unknown","yellow","状态未知"]]) {
    tray.status = status
    const menu = tray.buildMenu()
    assert.equal(menu.title, "")
    assert.ok(menu.tooltip.includes(word))
    assert.ok(menu.icon.includes(`tray-icon-${color}`))
    assert.equal(menu.isTemplateIcon, false)
    assert.equal(menu.items[0].title, "启动 Companion")
    assert.equal(menu.items[0].enabled, status !== "running")
    assert.equal(menu.items[1].enabled, status === "running")
    assert.equal(tray.seqMap[0].type, "start")
    assert.equal(tray.seqMap[1].type, "stop")
    assert.equal(tray.seqMap[2].type, "restart")
  }
})
