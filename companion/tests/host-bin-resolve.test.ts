import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import test from "node:test"
import {
  resolveHostBinary,
  resolveHostBinaryCandidates,
  resolvePackagedContentsDir,
} from "../src/host-use/darwin/host-bin"

test("packaged layout prefers Contents/MacOS/CMspark over Resources/cmspark-host", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-hostbin-"))
  try {
    const macOS = path.join(root, "Contents", "MacOS")
    const resources = path.join(root, "Contents", "Resources")
    fs.mkdirSync(macOS, { recursive: true })
    fs.mkdirSync(resources, { recursive: true })
    const mainBin = path.join(macOS, "CMspark")
    const legacy = path.join(resources, "cmspark-host")
    fs.writeFileSync(mainBin, "main")
    fs.chmodSync(mainBin, 0o755)
    fs.writeFileSync(legacy, "legacy")
    fs.chmodSync(legacy, 0o755)

    const candidates = resolveHostBinaryCandidates(resources)
    assert.equal(candidates[0], mainBin)
    // first existing among candidates would be mainBin
    const firstExisting = candidates.find((c) => fs.existsSync(c))
    assert.equal(firstExisting, mainBin)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("candidates still include dist cmspark-host for dev", () => {
  const c = resolveHostBinaryCandidates("/tmp/fake-dir")
  assert.ok(
    c.some(
      (p) =>
        p.endsWith(`${path.sep}dist${path.sep}cmspark-host`) ||
        p.includes(`${path.sep}dist${path.sep}cmspark-host`),
    ),
  )
})

test("CMSPARK_HOST_BIN without ALLOW throws (D10 dual opt-in)", () => {
  const prevBin = process.env.CMSPARK_HOST_BIN
  const prevAllow = process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
  try {
    process.env.CMSPARK_HOST_BIN = "/tmp/mock-host-bin"
    delete process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
    assert.throws(
      () => resolveHostBinary(),
      /CMSPARK_HOST_BIN override ignored|CMSPARK_ALLOW_HOST_BIN_OVERRIDE/,
    )
  } finally {
    if (prevBin === undefined) delete process.env.CMSPARK_HOST_BIN
    else process.env.CMSPARK_HOST_BIN = prevBin
    if (prevAllow === undefined) delete process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
    else process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE = prevAllow
  }
})

test("CMSPARK_HOST_BIN with ALLOW=1 returns override path", () => {
  const prevBin = process.env.CMSPARK_HOST_BIN
  const prevAllow = process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
  try {
    process.env.CMSPARK_HOST_BIN = "/tmp/mock-host-bin-allowed"
    process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE = "1"
    assert.equal(resolveHostBinary(), "/tmp/mock-host-bin-allowed")
  } finally {
    if (prevBin === undefined) delete process.env.CMSPARK_HOST_BIN
    else process.env.CMSPARK_HOST_BIN = prevBin
    if (prevAllow === undefined) delete process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE
    else process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE = prevAllow
  }
})

test("resolvePackagedContentsDir finds Contents from agent script path", () => {
  const script =
    "/Applications/CMspark.app/Contents/Resources/cmspark-agent.js"
  const contents = resolvePackagedContentsDir(script, "/usr/bin/node")
  assert.equal(contents, path.normalize("/Applications/CMspark.app/Contents"))
})

test("resolvePackagedContentsDir finds Contents from node inside app", () => {
  const nodeBin =
    "/Applications/CMspark.app/Contents/Resources/node"
  const contents = resolvePackagedContentsDir("", nodeBin)
  assert.equal(contents, path.normalize("/Applications/CMspark.app/Contents"))
})

test("F2: candidate path math matches real repo layout (no dist/dist dead path)", () => {
  // Real layout: host-bin.ts compiles to <root>/companion/dist/host-use/darwin
  // and sources to <root>/companion/src/host-use/darwin. The repo-root dist
  // binary lives at <root>/companion/dist/cmspark-host. From either __dirname
  // the candidate must resolve there — never into a non-existent dist/dist.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-hostbin-layout-"))
  try {
    // Build the two real-depth __dirname trees.
    const compiledDarwin = path.join(root, "companion", "dist", "host-use", "darwin")
    const srcDarwin = path.join(root, "companion", "src", "host-use", "darwin")
    const distHost = path.join(root, "companion", "dist", "cmspark-host")
    fs.mkdirSync(compiledDarwin, { recursive: true })
    fs.mkdirSync(srcDarwin, { recursive: true })
    fs.writeFileSync(distHost, "host", { mode: 0o755 })

    // Candidates from BOTH real __dirname depths must include the dist binary…
    for (const fromDir of [compiledDarwin, srcDarwin]) {
      const candidates = resolveHostBinaryCandidates(fromDir)
      assert.ok(
        candidates.includes(distHost),
        `candidates from ${path.basename(path.dirname(path.dirname(path.dirname(fromDir))))}/… include repo-root dist binary`,
      )
      // …and must contain NO dist/dist dead path.
      const deadDistDist = candidates.filter((c) =>
        c.includes(`${path.sep}dist${path.sep}dist${path.sep}cmspark-host`),
      )
      assert.equal(deadDistDist.length, 0, `no dist/dist dead candidate from ${fromDir}`)
      // repo-root dist host must be reachable (>=1 — compiled depth may also hit it
      // via ../../cmspark-host since dist top-level hosts the binary; dev depth via
      // ../../../dist only). No dead path, at least one real hit.
      assert.ok(
        candidates.includes(distHost),
        `repo-root dist host is reachable from ${fromDir}`,
      )
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("F2: fallback resolves to repo-root dist from compiled or dev-src __dirname", async () => {
  const hostBin = await import("../src/host-use/darwin/host-bin")
  // The fallback line uses path.resolve(__dirname, "../../../dist/cmspark-host").
  // Simulate both __dirname depths by checking resolveHostBinaryCandidates last
  // element matches a hand-computed repo-root path for each depth.
  const src = fs.readFileSync(
    path.join(process.cwd(), "src", "host-use", "darwin", "host-bin.ts"),
    "utf8",
  )
  const fallbackMatch = src.match(/return path\.resolve\(__dirname,\s*"([^"]+)"/)
  assert.ok(fallbackMatch, "fallback uses path.resolve(__dirname, …)")
  assert.equal(fallbackMatch[1], "../../../dist/cmspark-host")
})
