// #244: Side Panel must land on a real Chrome window, not the overlay --app shell.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isOverlayShellTabUrl,
  isOverlayAppWindow,
  pickSidePanelWindow,
} from "../src/background/pick-sidepanel-window"

test("#244 overlay shell URL is loopback / or /summoner only", () => {
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/"), true)
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/?thread=abc"), true)
  assert.equal(isOverlayShellTabUrl("http://localhost:23403/summoner"), true)
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/api/events"), false)
  assert.equal(isOverlayShellTabUrl("https://127.0.0.1:23403/"), false)
  assert.equal(isOverlayShellTabUrl("https://github.com/"), false)
  assert.equal(isOverlayShellTabUrl("chrome://newtab/"), false)
  // Query discipline (companion isSummonerLoopbackUrl): no token, no extras, no dup keys.
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/?token=abc"), false)
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/?foo=1"), false)
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/?thread="), false)
  assert.equal(isOverlayShellTabUrl("http://127.0.0.1:23403/?thread=a&thread=b"), false)
})

test("#244 pickSidePanelWindow skips focused overlay --app in favor of a real window", () => {
  const overlay = {
    id: 11,
    focused: true,
    type: "normal",
    tabs: [{ url: "http://127.0.0.1:23403/", active: true }],
  }
  const real = {
    id: 22,
    focused: false,
    type: "normal",
    tabs: [{ url: "https://github.com/nehcuh/cmspark", active: true }],
  }
  assert.equal(isOverlayAppWindow(overlay), true)
  assert.equal(isOverlayAppWindow(real), false)
  assert.equal(pickSidePanelWindow([overlay, real]), 22)
  assert.equal(pickSidePanelWindow([overlay]), undefined)
  assert.equal(pickSidePanelWindow([real, overlay]), 22)
})

test("#244 pickSidePanelWindow prefers focused real window", () => {
  const a = {
    id: 1,
    focused: false,
    type: "normal",
    tabs: [{ url: "https://a.example/", active: true }],
  }
  const b = {
    id: 2,
    focused: true,
    type: "normal",
    tabs: [{ url: "https://b.example/", active: true }],
  }
  assert.equal(pickSidePanelWindow([a, b]), 2)
})

test("#244 background ui.open_sidepanel uses pickSidePanelWindow + populate, never overlay id", () => {
  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  const start = bg.indexOf("async function handleCompanionMessage")
  const end = bg.indexOf("function setupMessageHandlers")
  const slice = bg.slice(start, end)
  assert.match(slice, /pickSidePanelWindow/)
  assert.match(slice, /populate:\s*true/)
  assert.match(slice, /windowTypes:\s*\[["']normal["']\]/)
  assert.match(slice, /sidePanel\.open\(\s*\{\s*windowId/)
  assert.match(slice, /windows\.create/)
  assert.match(slice, /windowId == null/)
  assert.match(bg, /from "\.\/pick-sidepanel-window"/)
})
