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

/**
 * Extract validator message-type keys from the `const validators: Record<...> = { ... }`
 * object only (brace-balanced). Day dual-review nit: avoids whole-file false positives.
 */
function extractValidatorKeys(src: string): Set<string> {
  const out = new Set<string>()
  const start = src.indexOf("const validators:")
  if (start < 0) {
    // Fallback: old layout had validators only as export function body
    const fnStart = src.indexOf("export function validateWsMessage")
    if (fnStart < 0) return out
    return extractValidatorKeysLoose(src.slice(fnStart, fnStart + 80_000))
  }
  const braceOpen = src.indexOf("{", start)
  if (braceOpen < 0) return out
  let depth = 0
  let i = braceOpen
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  const slice = src.slice(braceOpen, i)
  // Message keys are dotted (chat.create) or underscored families — require a function value
  const re = /"([a-zA-Z][a-zA-Z0-9_./-]*)"\s*:\s*(?:\(|async\s*\(|function)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(slice))) {
    out.add(m[1])
  }
  return out
}

/** Loose fallback when validators object marker is missing. */
function extractValidatorKeysLoose(slice: string): Set<string> {
  const out = new Set<string>()
  const re = /"([a-zA-Z][a-zA-Z0-9_./-]*)"\s*:\s*(?:\(|async\s*\(|function)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(slice))) {
    out.add(m[1])
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
  // Brace-scoped extract should still find CORE_REQUIRED without whole-file noise
  for (const t of CORE_REQUIRED) {
    assert.ok(keys.has(t), `brace-scoped validators missing "${t}"`)
  }
})

test("C9 validator extract is brace-scoped (not whole-file false positives)", () => {
  const validatorSrc = fs.existsSync(VALIDATE)
    ? fs.readFileSync(VALIDATE, "utf8")
    : fs.readFileSync(SERVER, "utf8")
  const keys = extractValidatorKeys(validatorSrc)
  // Should not pick up random object keys from comments or unrelated maps
  assert.ok(!keys.has("type"), "must not extract generic 'type' key")
  assert.ok(keys.has("chat.create"))
  assert.ok(keys.has("security.unattended.arm"))
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
