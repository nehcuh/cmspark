/**
 * C9 multi-adv: WS dual tables lockstep — router case arms ⊆ validators keys
 * (or explicit ALLOWLIST for intentional divergences).
 *
 * Prevents production fail-closed "Companion dead" when a router case is added
 * without a validateWsMessage entry.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

// Compiled under CommonJS (tsconfig.test); paths resolve from .test-dist/tests → companion/
const ROOT = path.resolve(__dirname, "..", "..")
// When run from source via node --experimental (rare): also try sibling
const ROUTER_CANDIDATES = [
  path.join(ROOT, "src", "message-router.ts"),
  path.join(__dirname, "..", "src", "message-router.ts"),
]
const SERVER_CANDIDATES = [
  path.join(ROOT, "src", "server.ts"),
  path.join(__dirname, "..", "src", "server.ts"),
]
// C10-A: validators live in ws/validate.ts (re-exported from server.ts)
const VALIDATE_CANDIDATES = [
  path.join(ROOT, "src", "ws", "validate.ts"),
  path.join(__dirname, "..", "src", "ws", "validate.ts"),
]
function firstExisting(paths: string[]): string {
  for (const p of paths) {
    if (fs.existsSync(p)) return p
  }
  return paths[0]
}
const ROUTER = firstExisting(ROUTER_CANDIDATES)
const SERVER = firstExisting(SERVER_CANDIDATES)
const VALIDATE = firstExisting(VALIDATE_CANDIDATES)

/**
 * Router-only / internal / delegated cases that need not be top-level validator keys
 * (e.g. fallthrough to handleAppsMessage with shared prefix, or alias).
 * Document each intentional divergence.
 */
const ROUTER_ONLY_ALLOWLIST = new Set<string>([
  // settings.test is an alias of config.test in router
  "settings.test",
  // Sub-handlers may share a generic path; apps.* / computer.* registered as families
  // Keep empty unless we discover pure fallthrough cases without validators.
])

/** Core types that MUST appear in both tables (smoke lock). */
const CORE_REQUIRED = [
  "config.get",
  "config.set",
  "thread.list",
  "thread.update",
  "chat.create",
  "security.unattended.arm",
  "security.unattended.disarm",
  "pack.apply",
  "pack.list",
] as const

function extractRouterCases(src: string): Set<string> {
  const out = new Set<string>()
  // case "foo.bar":
  const re = /case\s+"([a-zA-Z0-9_./-]+)":/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    out.add(m[1])
  }
  return out
}

function extractValidatorKeys(src: string): Set<string> {
  const out = new Set<string>()
  // Inside validateWsMessage: "type.name": (m) => or "type.name": () =>
  // Also multi-line. Prefer keys in validators object — look for quoted keys followed by :
  // Scoped: after `const validators:` until closing of validateWsMessage is hard;
  // practical: all top-level `"x.y":` patterns near validators assignment.
  const start = src.indexOf("const validators:")
  const fnStart = src.indexOf("export function validateWsMessage")
  const sliceStart = start >= 0 ? start : fnStart >= 0 ? fnStart : 0
  // End at next export function after validators or 1500 lines later
  let sliceEnd = src.indexOf("\nexport function", sliceStart + 20)
  if (sliceEnd < 0) sliceEnd = Math.min(src.length, sliceStart + 80_000)
  const slice = src.slice(sliceStart, sliceEnd)
  const re = /"([a-zA-Z0-9_./-]+)"\s*:\s*(?:\(|async\s*\(|function)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(slice))) {
    out.add(m[1])
  }
  // Also catch `"x.y": () =>` already covered; and `"x.y": (m) =>`
  // Fallback: any "a.b": at line start with indent inside validators
  const re2 = /^\s+"([a-zA-Z0-9_./-]+)"\s*:/gm
  while ((m = re2.exec(slice))) {
    // Skip non-message-looking keys
    if (m[1].includes(".") || m[1].includes("_") || /^[a-z]/.test(m[1])) {
      out.add(m[1])
    }
  }
  return out
}

test("C9 extract router cases and validator keys non-empty", () => {
  const routerSrc = fs.readFileSync(ROUTER, "utf8")
  const validatorSrc = fs.existsSync(VALIDATE)
    ? fs.readFileSync(VALIDATE, "utf8")
    : fs.readFileSync(SERVER, "utf8")
  const cases = extractRouterCases(routerSrc)
  const keys = extractValidatorKeys(validatorSrc)
  assert.ok(cases.size > 30, `expected many router cases, got ${cases.size}`)
  assert.ok(keys.size > 30, `expected many validator keys, got ${keys.size}`)
})

test("C9 core client→server types present in both router and validators", () => {
  const routerSrc = fs.readFileSync(ROUTER, "utf8")
  const validatorSrc = fs.existsSync(VALIDATE)
    ? fs.readFileSync(VALIDATE, "utf8")
    : fs.readFileSync(SERVER, "utf8")
  const cases = extractRouterCases(routerSrc)
  const keys = extractValidatorKeys(validatorSrc)
  for (const t of CORE_REQUIRED) {
    assert.ok(cases.has(t), `router missing case "${t}"`)
    assert.ok(keys.has(t), `validators missing key "${t}"`)
  }
})

test("C9 router cases ⊆ validators ∪ ALLOWLIST (client→server lockstep)", () => {
  const routerSrc = fs.readFileSync(ROUTER, "utf8")
  const validatorSrc = fs.existsSync(VALIDATE)
    ? fs.readFileSync(VALIDATE, "utf8")
    : fs.readFileSync(SERVER, "utf8")
  const cases = extractRouterCases(routerSrc)
  const keys = extractValidatorKeys(validatorSrc)

  // Filter out non-WS case labels that appear in nested switches (rare) — keep dotted types
  const clientTypes = [...cases].filter(
    (c) => c.includes(".") || ["ping", "pong", "auth"].includes(c),
  )

  const missing: string[] = []
  for (const c of clientTypes) {
    if (ROUTER_ONLY_ALLOWLIST.has(c)) continue
    if (!keys.has(c)) missing.push(c)
  }

  if (missing.length > 0) {
    // Soft fail with actionable list — full lockstep may need ALLOWLIST growth
    // for computer.* family batch registration patterns.
    const sample = missing.slice(0, 40)
    assert.fail(
      `Router cases missing validators (${missing.length}): ${sample.join(", ")}${
        missing.length > 40 ? "…" : ""
      }. Add validators or document in ROUTER_ONLY_ALLOWLIST.`,
    )
  }
})
