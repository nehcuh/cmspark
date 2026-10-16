import test from "node:test"
import assert from "node:assert/strict"
import { acceptanceDiagnostic } from "./fixtures/desktop-480/native-acceptance-controller"

test("native acceptance diagnostics admit only fixed phases, names and bounded counts", () => {
  const counts = { auths: 1, issues: 1, launches: 1, exits: 0, listReads: 4 }
  const observations: any[] = [{ kind: "fixed", name: "AUTH_1", proof: "never-log" }, { kind: "fixed", name: "raw-proof-never-log" }, { kind: "fixed", name: "AUTH_1" }, { kind: "window", secret: "never-log", view: "compact" }]
  const value = acceptanceDiagnostic("deadline", "waiting-reconnect-auth", "reconnect", counts, observations)
  assert.deepEqual(value, { reason: "deadline", phase: "waiting-reconnect-auth", mode: "reconnect", ...counts, fixed: ["AUTH_1"], windows: 1 })
  assert.doesNotMatch(JSON.stringify(value), /never-log|proof|secret|endpoint/)
  const unknown = acceptanceDiagnostic("raw-proof-never-log", "raw-proof-never-log", "raw-proof-never-log", { auths: Infinity, issues: -1, launches: 1.5, exits: 1001, listReads: 0 }, [])
  assert.deepEqual(unknown, { reason: "unknown", phase: "unknown", mode: "unknown", auths: null, issues: null, launches: null, exits: null, listReads: 0, fixed: [], windows: 0 })
})
