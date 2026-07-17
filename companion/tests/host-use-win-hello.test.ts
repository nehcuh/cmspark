// Unit tests for the Windows Hello wrapper (companion/src/host-use/win/index.ts)
//
// All tests use an injected fake PsRunner — no powershell.exe is spawned.
// Exit-code contract under test (hello-verify.ps1):
//   exit 0 + {"verified":true,"nonce":<echo>} → { ok, nonce }
//   nonce echo mismatch                        → throw (forgery defense)
//   exit 3                                     → { unavailable } (downgrade, not error)
//   exit 4                                     → { cancelled } (deny, no fallback)
//   spawn ENOENT                               → { unavailable } (downgrade, not crash)

import test from "node:test"
import assert from "node:assert/strict"

import { tryWindowsHello, probeWindowsHello } from "../src/host-use/win/index.js"
import type { PsRunner } from "../src/host-use/win/powershell.js"

function runnerRejects(fields: { code: unknown; stderr?: string }): PsRunner {
  return async () => {
    throw Object.assign(new Error(`exit ${fields.code}`), {
      code: fields.code,
      stderr: fields.stderr ?? "",
    })
  }
}

test("hello exit 0 + valid JSON echo → ok with nonce", async () => {
  let seenNonce = ""
  const runner: PsRunner = async (script, args) => {
    assert.ok(script.endsWith("hello-verify.ps1"))
    assert.equal(args[0], "-Nonce")
    seenNonce = args[1]
    assert.match(seenNonce, /^[0-9a-f]{16}$/)
    assert.equal(args[2], "-Reason")
    assert.equal(args[3], "Create a new OneNote page")
    return JSON.stringify({ verified: true, nonce: seenNonce })
  }
  const result = await tryWindowsHello("tc-1", "Create a new OneNote page", runner)
  assert.deepEqual(result, { ok: true, nonce: seenNonce })
})

test("hello nonce echo mismatch → throw (compromised script cannot fabricate success)", async () => {
  const runner: PsRunner = async () => JSON.stringify({ verified: true, nonce: "forged-forged-00" })
  await assert.rejects(
    () => tryWindowsHello("tc-2", "reason", runner),
    /nonce echo mismatch/,
  )
})

test("hello verified=false payload → throw", async () => {
  let seenNonce = ""
  const runner: PsRunner = async (_s, args) => {
    seenNonce = args[1]
    return JSON.stringify({ verified: false, nonce: seenNonce })
  }
  await assert.rejects(() => tryWindowsHello("tc-3", "reason", runner), /nonce echo mismatch|invalid payload/)
})

test("hello exit 3 → unavailable (downgrade path, NOT an error)", async () => {
  const runner = runnerRejects({ code: 3, stderr: "HELLO_UNAVAILABLE:DeviceNotPresent" })
  const result = await tryWindowsHello("tc-4", "reason", runner)
  assert.deepEqual(result, { unavailable: true })
})

test("hello exit 4 → cancelled (caller denies, never falls back)", async () => {
  const runner = runnerRejects({ code: 4 })
  const result = await tryWindowsHello("tc-5", "reason", runner)
  assert.deepEqual(result, { cancelled: true })
})

test("hello spawn ENOENT → unavailable (missing powershell/script is a downgrade, not a crash)", async () => {
  const runner = runnerRejects({ code: "ENOENT" })
  const result = await tryWindowsHello("tc-6", "reason", runner)
  assert.deepEqual(result, { unavailable: true })
})

test("hello exit 5 with stderr → surfaces script detail", async () => {
  const runner = runnerRejects({ code: 5, stderr: "HELLO_FAILED:RetriesExhausted" })
  await assert.rejects(
    () => tryWindowsHello("tc-7", "reason", runner),
    /windows hello: HELLO_FAILED:RetriesExhausted/,
  )
})

test("probeWindowsHello: exit 0 → true; any failure → false", async () => {
  const okRunner: PsRunner = async (_s, args) => {
    assert.deepEqual(args, ["-ProbeOnly"])
    return JSON.stringify({ available: true })
  }
  assert.equal(await probeWindowsHello(okRunner), true)
  assert.equal(await probeWindowsHello(runnerRejects({ code: 3, stderr: "HELLO_UNAVAILABLE:DeviceNotPresent" })), false)
  assert.equal(await probeWindowsHello(runnerRejects({ code: "ENOENT" })), false)
})
