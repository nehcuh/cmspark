/**
 * Batch E (#251): handshake Origin class, protocol lockstep, engines/esbuild.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { surfaceFromOrigin } from "../src/ws/handshake-surface"
import { isAllowedWsOrigin } from "../src/ws/lifecycle"
import {
  stampCmsparkSurface,
  handleComposerLeaseFamily,
  incomingHolderFromSurface,
} from "../src/ws/composer-lease"
import {
  PROTOCOL_VERSION,
  protocolVersionFromAuthOk,
  authOkProtocolMatchesLocal,
} from "../src/protocol"

function firstExisting(candidates: string[]): string {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[candidates.length - 1]
}

function srcFile(...parts: string[]): string {
  return firstExisting([
    path.join(__dirname, "..", "src", ...parts),
    path.join(__dirname, "..", "..", "src", ...parts),
  ])
}

function repoFile(...parts: string[]): string {
  return firstExisting([
    path.resolve(__dirname, "..", "..", ...parts),
    path.resolve(__dirname, "..", "..", "..", ...parts),
  ])
}

function companionPkg(): string {
  return firstExisting([
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(__dirname, "..", "..", "package.json"),
  ])
}

const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"
const TRAY = "cmspark-tray://local"

test("E1: chrome-extension omit → panel", () => {
  const r = surfaceFromOrigin(EXT, undefined)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.surface, "panel")
    assert.equal(r.coerced, false)
  }
})

test("E1: chrome-extension claimed tray → coerce panel", () => {
  const r = surfaceFromOrigin(EXT, "tray")
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.surface, "panel")
    assert.equal(r.coerced, true)
  }
})

test("E1: chrome-extension claimed summoner → terminate", () => {
  const r = surfaceFromOrigin(EXT, "summoner")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, "summoner_from_extension")
})

test("E1: tray Origin omit → terminate", () => {
  const r = surfaceFromOrigin(TRAY, undefined)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, "omit_tray")
})

test("E1: tray Origin explicit tray / summoner", () => {
  const t = surfaceFromOrigin(TRAY, "tray")
  const s = surfaceFromOrigin(TRAY, "summoner")
  assert.equal(t.ok, true)
  assert.equal(s.ok, true)
  if (t.ok) assert.equal(t.surface, "tray")
  if (s.ok) assert.equal(s.surface, "summoner")
})

test("E1: overlay HTTP is not a WS Origin", () => {
  assert.equal(isAllowedWsOrigin("http://127.0.0.1"), false)
  assert.equal(isAllowedWsOrigin("http://127.0.0.1:23403"), false)
})

test("E1: panel handshake stamp is tray; overlay claim mismatches", () => {
  const msg: Record<string, unknown> = {
    type: "composer.lease.claim",
    thread_id: "t1",
    holder: "overlay",
    rev: 0,
  }
  stampCmsparkSurface(msg, "panel")
  assert.equal(msg.__cmspark_surface, "tray")
  assert.equal(incomingHolderFromSurface("tray"), "panel")
  const stamped = msg.__cmspark_surface
  const out = handleComposerLeaseFamily("composer.lease.claim", msg, undefined, stamped)
  assert.equal(out?.error_code, "LEASE_HOLDER_SURFACE_MISMATCH")
})

test("E2: protocol_version literals lockstep with PROTOCOL_VERSION", () => {
  const proto = fs.readFileSync(srcFile("protocol.ts"), "utf8")
  const tray = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  const ext = fs.readFileSync(
    repoFile("chrome-extension", "src", "background", "ws-client.ts"),
    "utf8",
  )
  const fromProto = proto.match(/export const PROTOCOL_VERSION = (\d+)/)
  const fromTray = tray.match(/protocol_version:\s*(\d+)/)
  const fromExt = ext.match(/protocol_version:\s*(\d+)/)
  assert.ok(fromProto && fromTray && fromExt, "missing protocol_version literal")
  assert.equal(Number(fromProto[1]), PROTOCOL_VERSION)
  assert.equal(fromTray[1], fromProto[1])
  assert.equal(fromExt[1], fromProto[1])
})

test("E2: missing auth.ok fields = MIN; 99 does not match", () => {
  assert.equal(protocolVersionFromAuthOk({}), PROTOCOL_VERSION)
  assert.equal(authOkProtocolMatchesLocal({}), true)
  assert.equal(authOkProtocolMatchesLocal({ protocol_version: 99 }), false)
  assert.equal(authOkProtocolMatchesLocal({ negotiated_protocol_version: PROTOCOL_VERSION }), true)
})

test("E3: companion package.json declares esbuild and engines 22", () => {
  const pkg = JSON.parse(fs.readFileSync(companionPkg(), "utf8")) as {
    engines?: { node?: string }
    devDependencies?: Record<string, string>
  }
  assert.match(String(pkg.engines?.node ?? ""), /22/)
  assert.ok(pkg.devDependencies?.esbuild, "esbuild must be a direct devDependency")
  const rootPkg = JSON.parse(fs.readFileSync(repoFile("package.json"), "utf8")) as {
    engines?: { node?: string }
  }
  assert.match(String(rootPkg.engines?.node ?? ""), /22/)
})
