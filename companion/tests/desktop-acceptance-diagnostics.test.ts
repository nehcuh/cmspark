import test from "node:test"
import assert from "node:assert/strict"
import { acceptanceDiagnostic } from "./fixtures/desktop-480/native-acceptance-controller"

test("native acceptance diagnostics admit only fixed phases, names and bounded counts", () => {
  const counts = { auths: 1, issues: 1, launches: 1, exits: 0, listReads: 4 }
  const observations: any[] = [{ kind: "fixed", name: "AUTH_1", proof: "never-log" }, { kind: "fixed", name: "raw-proof-never-log" }, { kind: "fixed", name: "AUTH_1" }, { kind: "window", secret: "never-log", view: "compact" }]
  const value = acceptanceDiagnostic("deadline", "waiting-reconnect-auth", "reconnect", counts, observations)
  assert.deepEqual(value, { reason: "deadline", phase: "waiting-reconnect-auth", mode: "reconnect", ...counts, lastExitCode: null, fixed: ["AUTH_1"], inheritance: [], identity: [], windows: 1 })
  assert.doesNotMatch(JSON.stringify(value), /never-log|proof|secret|endpoint/)
  const unknown = acceptanceDiagnostic("raw-proof-never-log", "raw-proof-never-log", "raw-proof-never-log", { auths: Infinity, issues: -1, launches: 1.5, exits: 1001, listReads: 0 }, [])
  assert.deepEqual(unknown, { reason: "unknown", phase: "unknown", mode: "unknown", auths: null, issues: null, launches: null, exits: null, listReads: 0, lastExitCode: null, fixed: [], inheritance: [], identity: [], windows: 0 })
})

test("native acceptance exit codes preserve bounded 32-bit callback values without coercion", () => {
  const counts = { auths: 1, issues: 1, launches: 1, exits: 1, listReads: 1 }
  const report = (lastExitCode: unknown) => acceptanceDiagnostic("cleanup", "waiting-reconnect-auth", "reconnect", { ...counts, lastExitCode: lastExitCode as number }, [])
  // The existing N-API int32 callback represents high-bit Windows statuses as negative.
  for (const code of [0, 41, 45, 177, -1, -0x80000000, -1073741819, 0xc0000005, 0xffffffff]) assert.equal(report(code).lastExitCode, code)
  for (const code of [undefined, null, -0x80000001, 0x100000000, NaN, Infinity, 1.5, "45", { valueOf() { throw Error("must-not-coerce") } }]) assert.equal(report(code).lastExitCode, null)
})
