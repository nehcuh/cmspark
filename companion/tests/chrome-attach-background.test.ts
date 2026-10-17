import test from "node:test"
import assert from "node:assert/strict"
import * as http from "node:http"
import { getChromeOpener } from "../src/platform"
import { attachChromeOnly, ATTACH_NOTIFY_COPY, ATTACH_SILENT_COPY } from "../src/summoner/client"
import { startSummonerWebServer, stopSummonerWebServer } from "../src/summoner-web"

// Exercise the coupled production opener/attach functions. Only the OS command
// boundary is inert: these tests cannot launch Chrome or observe actual focus.
for (const platform of ["darwin", "win32", "linux", "other"] as const) {
  for (const foreground of [false, true]) {
    test(`${platform} attach ${foreground ? "explicit foreground" : "background"} requests only the permitted command`, (t) => {
      const calls: Array<{ command: string; args: string[] }> = []
      let unrefs = 0
      t.mock.method(require("os"), "platform", () => platform)
      t.mock.method(require("child_process"), "spawn", (command: string, args: string[]) => {
        calls.push({ command, args })
        return { unref: () => { unrefs++ } }
      })
      const message = attachChromeOnly(getChromeOpener(), { foreground })
      if (foreground) {
        assert.equal(message, ATTACH_NOTIFY_COPY)
        assert.equal(calls.length, 1)
        if (platform === "darwin") assert.deepEqual(calls[0].args, ["-e", 'tell application "Google Chrome" to activate'])
        else if (platform === "win32") assert.deepEqual(calls[0], { command: "cmd", args: ["/c", "start", "chrome"] })
        else assert.deepEqual(calls[0], { command: "xdg-open", args: ["chrome://newtab/"] })
      } else if (platform === "darwin") {
        assert.deepEqual(calls, [{ command: "open", args: ["-ga", "Google Chrome"] }])
        assert.equal(message, ATTACH_SILENT_COPY)
        assert.match(message, /已请求/)
        assert.doesNotMatch(message, /已在后台打开/)
      } else {
        assert.deepEqual(calls, [])
        assert.match(message, /不支持后台打开/)
        assert.match(message, /展示浏览器/)
        assert.doesNotMatch(message, /已在后台打开|已请求/)
      }
      assert.equal(unrefs, calls.length)
    })
  }
}

for (const silent of [undefined, () => false] as const) {
  test(`attach ${silent ? "unsupported" : "missing"} silent method never falls back to foreground or side panel`, () => {
    let foreground = 0
    let sidePanel = 0
    const opener = {
      openChrome: () => { foreground++ },
      openChromeSilent: silent,
      openSidePanel: () => { sidePanel++ },
    }
    const message = attachChromeOnly(opener)
    assert.match(message, /不支持后台打开/)
    assert.match(message, /展示浏览器/)
    assert.equal(foreground, 0)
    assert.equal(sidePanel, 0)
    assert.equal(attachChromeOnly(opener, { foreground: true }), ATTACH_NOTIFY_COPY)
    assert.equal(foreground, 1)
    assert.equal(sidePanel, 0)
  })
}

test("legacy void silent opener remains a compatible background request", () => {
  let silent = 0
  const message = attachChromeOnly({
    openChrome: () => assert.fail("foreground fallback"),
    openChromeSilent: () => { silent++ },
  })
  assert.equal(silent, 1)
  assert.equal(message, ATTACH_SILENT_COPY)
  assert.match(message, /已请求/)
})

test("silent request errors propagate instead of claiming success or retrying foreground", () => {
  const error = new Error("owned inert spawn failure")
  assert.throws(() => attachChromeOnly({
    openChrome: () => assert.fail("foreground fallback"),
    openChromeSilent: () => { throw error },
  }), (actual) => actual === error)
})

test("actual /api/attach HTTP response preserves unavailable background and explicit foreground outcomes", async (t) => {
  const calls: Array<{ command: string; args: string[] }> = []
  t.mock.method(require("os"), "platform", () => "win32")
  t.mock.method(require("child_process"), "spawn", (command: string, args: string[]) => {
    calls.push({ command, args })
    return { unref() {} }
  })
  const opener = getChromeOpener()
  const { port, token } = await startSummonerWebServer({
    preferredPort: 23590,
    attachChrome: (opts) => attachChromeOnly(opener, opts),
    dispatch: async () => assert.fail("attach must not dispatch a tool or open a side panel"),
  })
  t.after(() => stopSummonerWebServer())
  async function attach(foreground: boolean): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port, path: "/api/attach", method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `cmspark_overlay=${token}`,
          Origin: `http://127.0.0.1:${port}`,
        },
      }, (res) => {
        let body = ""
        res.on("data", (chunk) => { body += chunk })
        res.on("end", () => resolve({ status: res.statusCode || 0, body }))
      })
      req.on("error", reject)
      req.end(JSON.stringify({ foreground }))
    })
  }
  const background = await attach(false)
  assert.equal(background.status, 200, background.body)
  // Check the actual route's production message field, not a hand-built payload.
  assert.match(JSON.parse(background.body).message, /不支持后台打开/)
  assert.match(JSON.parse(background.body).message, /展示浏览器/)
  assert.deepEqual(calls, [])
  const foreground = await attach(true)
  assert.equal(foreground.status, 200, foreground.body)
  assert.equal(JSON.parse(foreground.body).message, ATTACH_NOTIFY_COPY)
  assert.deepEqual(calls, [{ command: "cmd", args: ["/c", "start", "chrome"] }])
})
