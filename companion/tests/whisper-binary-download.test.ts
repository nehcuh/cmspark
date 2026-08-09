/**
 * Whisper runtime binary manifest + install probe (auto-download Path B).
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  parseWhisperBinaryManifest,
  primaryWhisperBinarySha256,
  loadWhisperBinaryManifest,
} from "../src/voice/whisper-binary-manifest"
import { probeWhisperBinaryInstall } from "../src/voice/whisper-binary-download"
import { expectedWhisperSha256 } from "../src/voice/whisper-binary-pins"
import { defaultWhisperBinaryInstallDir } from "../src/voice/binary-resolve"

function resolveManifestPath(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "assets", "whisper-binary.manifest.json"), // .test-dist/tests
    path.join(__dirname, "..", "assets", "whisper-binary.manifest.json"), // tests/
    path.join(process.cwd(), "assets", "whisper-binary.manifest.json"),
    path.join(process.cwd(), "companion", "assets", "whisper-binary.manifest.json"),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]!
}

describe("whisper-binary.manifest", () => {
  it("parses in-repo manifest", () => {
    const text = fs.readFileSync(resolveManifestPath(), "utf8")
    const m = parseWhisperBinaryManifest(text)
    assert.equal(m.schemaVersion, 1)
    assert.ok(m.binaries["win-x64"])
    assert.equal(m.binaries["win-x64"]!.kind, "zip")
  })

  it("win-x64 primary sha256 matches whisper-binary-pins", () => {
    const m = loadWhisperBinaryManifest(resolveManifestPath())
    const entry = m.binaries["win-x64"]!
    const primary = primaryWhisperBinarySha256("win-x64", entry)
    const pin = expectedWhisperSha256("win-x64")
    assert.equal(pin, primary, "pins.ts must match manifest primary exe hash")
  })

  it("rejects non-https url", () => {
    assert.throws(
      () =>
        parseWhisperBinaryManifest(
          JSON.stringify({
            schemaVersion: 1,
            binaries: {
              "win-x64": {
                kind: "zip",
                version: "x",
                url: "http://evil.example/x.zip",
                sha256: "a".repeat(64),
                size: 1,
                extract: {
                  stripPrefix: "",
                  files: [
                    {
                      src: "a.exe",
                      dest: "cmspark-whisper-win-x64.exe",
                      sha256: "b".repeat(64),
                      size: 1,
                    },
                  ],
                },
              },
            },
          }),
        ),
      /https/,
    )
  })
})

describe("probeWhisperBinaryInstall", () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-wbin-"))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("absent when empty dir", () => {
    const m = loadWhisperBinaryManifest(resolveManifestPath())
    const r = probeWhisperBinaryInstall(tmp, "win-x64", m)
    assert.equal(r.status, "absent")
  })

  it("default install dir is under dataDir/bin/whisper/arch", () => {
    const d = defaultWhisperBinaryInstallDir("win-x64", path.join(tmp, "data"))
    assert.ok(d.replace(/\\/g, "/").endsWith("data/bin/whisper/win-x64"))
  })
})
