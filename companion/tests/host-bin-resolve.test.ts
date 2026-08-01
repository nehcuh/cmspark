import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import test from "node:test"
import {
  resolveHostBinary,
  resolveHostBinaryCandidates,
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
