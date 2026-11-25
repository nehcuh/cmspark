import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { enumerateMacApps } from "../src/apps/enumerate"

test("macOS discovery includes system apps and deduplicates bundle IDs across roots", async (t) => {
  const homeApps = path.join(os.homedir(), "Applications")
  const bundles = new Map([
    ["/System/Applications", ["TextEdit.app"]],
    ["/Applications", ["TextEdit Copy.app"]],
    [homeApps, ["Owned.app"]],
  ])
  const visited: string[] = []
  t.mock.method(fs.promises, "readdir", async (dir: string) => {
    visited.push(dir)
    return bundles.get(dir)?.map(name => ({ name, isDirectory: () => true })) ?? []
  })
  const candidates = await enumerateMacApps(undefined, async (plist, key) => {
    const name = path.basename(path.dirname(path.dirname(plist)))
    if (key === "CFBundleIdentifier") {
      if (name === "Owned.app") return "com.example.owned"
      return name === "TextEdit.app" ? "com.apple.TextEdit" : "COM.APPLE.TEXTEDIT"
    }
    return null
  })
  assert.deepEqual(visited, [...bundles.keys()])
  assert.deepEqual(candidates, [
    { name: "TextEdit", source: "installed", bundleId: "com.apple.TextEdit", path: path.join("/System/Applications", "TextEdit.app") },
    { name: "Owned", source: "installed", bundleId: "com.example.owned", path: path.join(homeApps, "Owned.app") },
  ])
})

test("system TextEdit is discoverable through its installed Info.plist", { skip: process.platform !== "darwin" }, async () => {
  const candidates = await enumerateMacApps(["/System/Applications"])
  assert.ok(candidates.some(app => app.bundleId === "com.apple.TextEdit" && app.path === "/System/Applications/TextEdit.app"))
})
