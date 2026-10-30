import test from "node:test"
import assert from "node:assert/strict"
import { assertTrayBundleGraph, trayBuildDefines, trayPinLiteral, verifyTrayPackage } from "../swift-tray-package-pin.mjs"

const tray = Buffer.from("owned inert tray bytes")
const marker = trayPinLiteral(tray)
const bundle = Buffer.from(`const embedded = "${marker}";`)

test("build defines contain the digest of the actual provided bytes", () => {
  assert.deepEqual(trayBuildDefines(tray), {
    __CMSPARK_PACKAGED_TRAY__: "true",
    __CMSPARK_SWIFT_TRAY_SHA256__: JSON.stringify(marker),
  })
  assert.throws(() => trayBuildDefines(Buffer.alloc(0)), /TRAY_PIN_EMPTY/)
})

test("bundle graph requires the exact bridge in the selected output", () => {
  const output = "dist/cmspark-agent.js"
  const input = "dist/tray/swift-tray-bridge.js"
  const metadata = { outputs: { [output]: { inputs: { [input]: { bytesInOutput: 20 } } } } }
  assert.doesNotThrow(() => assertTrayBundleGraph(metadata, output, input))
  for (const bad of [null, {}, { outputs: {} }, { outputs: { [output]: { inputs: { [`other/${input}`]: { bytesInOutput: 20 } } } } },
    { outputs: { [output]: { inputs: { [input]: { bytesInOutput: 0 } } } } }]) {
    assert.throws(() => assertTrayBundleGraph(bad, output, input), /TRAY_BUNDLE_/)
  }
})

test("package pin accepts matching bytes", () => {
  assert.doesNotThrow(() => verifyTrayPackage(bundle, tray))
})

test("package pin rejects modified or absent tray bytes", () => {
  assert.throws(() => verifyTrayPackage(bundle, Buffer.from("different bytes")), /TRAY_PIN_MISMATCH/)
  assert.throws(() => verifyTrayPackage(bundle, Buffer.alloc(0)), /TRAY_PIN_EMPTY/)
})

test("package pin rejects absent, malformed and duplicate markers", () => {
  assert.throws(() => verifyTrayPackage(Buffer.from("no marker"), tray), /TRAY_PIN_MARKER_INVALID/)
  assert.throws(() => verifyTrayPackage(Buffer.from("CMSPARK_SWIFT_TRAY_SHA256_V1:BAD"), tray), /TRAY_PIN_MARKER_INVALID/)
  for (const suffix of ["a", "_suffix", "é"]) {
    assert.throws(() => verifyTrayPackage(Buffer.from(`"${marker}${suffix}"`), tray), /TRAY_PIN_MARKER_INVALID/)
  }
  assert.throws(() => verifyTrayPackage(Buffer.from(`"${marker}" "${marker}"`), tray), /TRAY_PIN_MARKER_INVALID/)
})
