import test from "node:test"
import assert from "node:assert/strict"
import {
  validateCliManifest,
  buildCliArgv,
  hostCliBindingPayload,
  looksLikeOptionInjection,
  validateSlotValue,
  fullStringRegexMatch,
} from "../src/apps/cli-manifest"
import { buildCliChildEnv, stripAnsi, prepareCliExecution, echoCliManifest } from "../src/apps/cli-exec"
import { markCliOutputSeen, clearCliOutputTaint, isCliOutputTainted, _resetCliQ5ForTests } from "../src/apps/cli-q5"
import { SecurityPolicy } from "../src/security-policy"
import type { AppEntry } from "../src/apps/types"
import { WORKER_HARD_DENY } from "../src/orchestrator/constants"

test("validateCliManifest requires ≥1 subcommand", () => {
  assert.ok(validateCliManifest({ schema_version: 1, subcommands: [] }))
  assert.equal(
    validateCliManifest({
      schema_version: 1,
      subcommands: [{ name: "run", risk: "read-only" }],
    }),
    null,
  )
})

test("value_regex full-string match (no partial pass)", () => {
  assert.equal(fullStringRegexMatch("safe", "safe"), true)
  assert.equal(fullStringRegexMatch("safe", "unsafe"), false)
  assert.equal(fullStringRegexMatch("safe", "safe;evil"), false)
  assert.equal(fullStringRegexMatch("^[A-Za-z0-9]+$", "abc"), true)
  assert.equal(fullStringRegexMatch("[A-Za-z0-9]+", "abcXXX"), true) // full match of pattern on whole value? "abcXXX" matches [A-Za-z0-9]+ fully
  assert.equal(fullStringRegexMatch("[A-Za-z0-9]+", "abc XXX"), false)
  assert.equal(
    validateSlotValue("unsafe", { value_regex: "safe", label: "arg" }),
    "arg failed value_regex",
  )
  assert.equal(validateSlotValue("safe", { value_regex: "safe", label: "arg" }), null)
})

test("validateCliManifest rejects invalid positional value_regex", () => {
  const err = validateCliManifest({
    schema_version: 1,
    subcommands: [
      {
        name: "run",
        risk: "read-only",
        positionals: [{ name: "p", required: true, value_regex: "[unclosed" }],
      },
    ],
  })
  assert.ok(err && err.includes("value_regex"))
})

test("buildCliArgv rejects undeclared flags and option injection", () => {
  const man = echoCliManifest()
  const bad = buildCliArgv(man, { app: "mac.cli.x", subcommand: "run", flags: { evil: true } as any })
  assert.equal(bad.ok, false)
  const inj = buildCliArgv(man, { app: "mac.cli.x", subcommand: "run", args: ["-rf"] })
  assert.equal(inj.ok, false)
  assert.ok(looksLikeOptionInjection("-rf"))
  const ok = buildCliArgv(man, { app: "mac.cli.x", subcommand: "run", args: ["hello_world"] })
  assert.equal(ok.ok, true)
  if (ok.ok) assert.deepEqual(ok.argv, ["run", "hello_world"])
})

test("hostCliBindingPayload non-empty and stable", () => {
  const a = hostCliBindingPayload({ app: "win.cli.rg", subcommand: "run", flags: { a: "1", b: "2" }, args: ["x"] })
  const b = hostCliBindingPayload({ app: "win.cli.rg", subcommand: "run", flags: { b: "2", a: "1" }, args: ["x"] })
  assert.ok(a.length > 0)
  assert.equal(a, b)
  assert.equal(hostCliBindingPayload({ app: "", subcommand: "run" }), "")
})

test("bindingPayloadFor host_cli three-place non-empty", () => {
  const payload = SecurityPolicy.bindingPayloadFor("host_cli", {
    app: "mac.cli.echo",
    subcommand: "run",
    args: ["t1"],
  })
  assert.ok(payload.includes("mac.cli.echo"))
  assert.ok(payload.includes("run"))
  const pol = new SecurityPolicy()
  const tok = pol.issueTokenFor("host_cli", { app: "mac.cli.echo", subcommand: "run", args: ["t1"] })
  assert.equal(
    pol.validateTokenFor(tok.token, "host_cli", { app: "mac.cli.echo", subcommand: "run", args: ["t1"] }),
    true,
  )
  assert.equal(
    pol.validateTokenFor(tok.token, "host_cli", { app: "mac.cli.other", subcommand: "run", args: ["t1"] }),
    false,
  )
})

test("buildCliChildEnv scrubs secrets", () => {
  const env = buildCliChildEnv({
    PATH: "/usr/bin",
    HOME: "/tmp",
    DEEPSEEK_API_KEY: "secret",
    CMSPARK_FOO: "x",
    OPENAI_API_KEY: "k",
    MY_TOKEN: "t",
    RANDOM_VAR: "nope",
  } as any)
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
  assert.equal(env.CMSPARK_FOO, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.MY_TOKEN, undefined)
  assert.equal(env.RANDOM_VAR, undefined)
  assert.ok(env.PATH || env.Path)
})

test("stripAnsi removes escapes", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red")
})

test("Q5 set/clear only via helpers", () => {
  _resetCliQ5ForTests()
  assert.equal(isCliOutputTainted("t1"), false)
  markCliOutputSeen("t1")
  assert.equal(isCliOutputTainted("t1"), true)
  clearCliOutputTaint("t1")
  assert.equal(isCliOutputTainted("t1"), false)
})

test("workers hard-deny host_cli", () => {
  assert.ok(WORKER_HARD_DENY.has("host_cli"))
})

test("prepareCliExecution dual door on lolbin", () => {
  const entry: AppEntry = {
    token: "mac.cli.bash",
    kind: "cli",
    display_name: "bash",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: new Date().toISOString(),
    exe: { path: "/bin/bash", user_writable_dir: false },
    cli_manifest: echoCliManifest() as any,
  }
  const r = prepareCliExecution(entry, { app: entry.token, subcommand: "run", args: ["hi"] })
  // bash is lolbin on most platforms
  assert.equal(r.ok, false)
})
