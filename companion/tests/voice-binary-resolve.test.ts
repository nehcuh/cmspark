// Path B Spike S4 — binary resolve + SHA256 pin

import test from "node:test"
import assert from "node:assert/strict"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  resolveWhisperArch,
  resolveWhisperBinary,
  sha256FileSync,
  whisperBinaryBasenames,
} from "../src/voice/binary-resolve"
import {
  expectedWhisperSha256,
  whisperPinResolveOpts,
} from "../src/voice/whisper-binary-pins"

test("resolveWhisperArch mapping", () => {
  assert.equal(resolveWhisperArch("darwin", "arm64"), "darwin-arm64")
  assert.equal(resolveWhisperArch("darwin", "x64"), "darwin-x64")
  assert.equal(resolveWhisperArch("win32", "x64"), "win-x64")
  assert.equal(resolveWhisperArch("linux", "x64"), "linux-x64")
  assert.equal(resolveWhisperArch("freebsd", "x64"), "unsupported")
})

test("basenames include arch-specific and plain", () => {
  const n = whisperBinaryBasenames("darwin-arm64")
  assert.ok(n.includes("cmspark-whisper-darwin-arm64"))
  assert.ok(n.includes("cmspark-whisper"))
})

test("not_found when empty roots", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-whisper-"))
  try {
    const r = resolveWhisperBinary({
      searchRoots: [dir],
      platform: "darwin",
      arch: "arm64",
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, "not_found")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("find plain name + unpinned ok", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-whisper-"))
  try {
    const bin = path.join(dir, "cmspark-whisper")
    fs.writeFileSync(bin, "fake-whisper-bin")
    const r = resolveWhisperBinary({
      searchRoots: [dir],
      platform: "darwin",
      arch: "arm64",
      allowUnpinned: true,
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.path, bin)
      assert.equal(r.pinned, false)
      assert.equal(r.sha256, sha256FileSync(bin))
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("hash_mismatch when pin wrong", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-whisper-"))
  try {
    const bin = path.join(dir, "cmspark-whisper-darwin-arm64")
    fs.writeFileSync(bin, "fake-whisper-bin")
    const r = resolveWhisperBinary({
      searchRoots: [dir],
      platform: "darwin",
      arch: "arm64",
      expectedSha256: "0".repeat(64),
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, "hash_mismatch")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("pin match", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-whisper-"))
  try {
    const bin = path.join(dir, "cmspark-whisper")
    const body = Buffer.from("pinned-content")
    fs.writeFileSync(bin, body)
    const digest = crypto.createHash("sha256").update(body).digest("hex")
    const r = resolveWhisperBinary({
      searchRoots: [dir],
      platform: "darwin",
      arch: "arm64",
      expectedSha256: digest,
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.pinned, true)
      assert.equal(r.sha256, digest)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("expectedWhisperSha256 rejects invalid / missing pins", () => {
  assert.equal(expectedWhisperSha256("unsupported"), null)
  assert.equal(expectedWhisperSha256(""), null)
  // live module may have darwin-arm64 filled by build script; invalid arch always null
  assert.equal(expectedWhisperSha256("freebsd-x64"), null)
})

test("whisperPinResolveOpts: missing pin → allowUnpinned", () => {
  const o = whisperPinResolveOpts("linux-x64", {})
  // linux-x64 may be unpinned on this machine; when pin is null:
  if (expectedWhisperSha256("linux-x64") == null) {
    assert.equal(o.allowUnpinned, true)
    assert.equal(o.expectedSha256, null)
    assert.equal(o.forceUnpinned, false)
  }
})

test("whisperPinResolveOpts: CMSPARK_WHISPER_UNPINNED=1 forces unpinned", () => {
  const o = whisperPinResolveOpts("darwin-arm64", { CMSPARK_WHISPER_UNPINNED: "1" })
  assert.equal(o.forceUnpinned, true)
  assert.equal(o.allowUnpinned, true)
  assert.equal(o.expectedSha256, null)
})

test("whisperPinResolveOpts: pin present enforces digest", () => {
  const pin = expectedWhisperSha256("darwin-arm64")
  if (!pin) {
    // build script not run yet — still assert shape for a synthetic env
    const o = whisperPinResolveOpts("darwin-arm64", {})
    assert.equal(typeof o.allowUnpinned, "boolean")
    return
  }
  const o = whisperPinResolveOpts("darwin-arm64", {})
  assert.equal(o.expectedSha256, pin)
  assert.equal(o.allowUnpinned, false)
  assert.equal(o.forceUnpinned, false)
})
