// Preliminary text check only: presence of a string does not prove the runtime
// consumes it. Do not use as a packaging security gate without that proof.
import { createHash } from "node:crypto"

const PREFIX = "CMSPARK_SWIFT_TRAY_SHA256_V1:"
const MARKER = /(["'])CMSPARK_SWIFT_TRAY_SHA256_V1:([0-9a-f]{64})\1/g

export function trayPinLiteral(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("TRAY_PIN_EMPTY")
  return PREFIX + createHash("sha256").update(bytes).digest("hex")
}

/** Values handed directly to esbuild by the macOS ARM64 package producer. */
export function trayBuildDefines(bytes) {
  return {
    __CMSPARK_PACKAGED_TRAY__: "true",
    __CMSPARK_SWIFT_TRAY_SHA256__: JSON.stringify(trayPinLiteral(bytes)),
  }
}

// Input keys must be exact producer paths, not basename or suffix matches.
// This only establishes graph inclusion; it does not authenticate the producer.
export function assertTrayBundleGraph(metafile, output, bridgeInput) {
  if (!metafile || typeof metafile !== "object" || !metafile.outputs || typeof metafile.outputs !== "object") {
    throw new Error("TRAY_BUNDLE_GRAPH_INVALID")
  }
  const record = metafile.outputs[output]
  const input = record?.inputs?.[bridgeInput]
  if (!input || !Number.isSafeInteger(input.bytesInOutput) || input.bytesInOutput <= 0) {
    throw new Error("TRAY_BUNDLE_BRIDGE_MISSING")
  }
}

export function verifyTrayPackage(bundleBytes, trayBytes) {
  if (!Buffer.isBuffer(bundleBytes)) throw new Error("TRAY_BUNDLE_INVALID")
  const bundle = bundleBytes.toString("utf8")
  const matches = [...bundle.matchAll(MARKER)]
  if (matches.length !== 1 || bundle.split(PREFIX).length !== 2) throw new Error("TRAY_PIN_MARKER_INVALID")
  if (matches[0][2] !== trayPinLiteral(trayBytes).slice(PREFIX.length)) throw new Error("TRAY_PIN_MISMATCH")
}
