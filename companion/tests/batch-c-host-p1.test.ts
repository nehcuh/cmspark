/**
 * Batch C host P1 (#247) — TDD DoD.
 * C1 osascript URL bind · C2 MCP loader env · C3 quoted -c · C4 Win scripts dual opt-in · C5 spawn HMAC
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { commandMatchesAllowlistEntry, tryParseSimpleArgv } from "../src/capability/shell"
import { resolveWinScript } from "../src/host-use/win/powershell"
import { buildMcpStdioEnv } from "../src/mcp/transport"
import { isUnsafeLoaderEnvKey } from "../src/user-env"
import { SecurityPolicy } from "../src/security-policy"
import { computeWorkerWhitelist } from "../src/orchestrator/spawn"
import { canonicalizeOsascriptUrl } from "../src/tool/osascript-bind"
import { WORKER_HARD_DENY } from "../src/orchestrator/constants"
import catalog from "../src/bridge/tool-definitions-catalog.json"

test("C3: quoted -c / clustered interpreter flags denied; grep -ic still allowed", () => {
  assert.equal(commandMatchesAllowlistEntry("python3 '-c' 'code'", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 -c", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 -ic 'code'", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 script.py", "python3"), true)
  assert.equal(commandMatchesAllowlistEntry("grep -ic pattern file", "grep"), true)
  assert.equal(commandMatchesAllowlistEntry("wc -c file", "wc"), true)
})

test("W1: bare shell entries reject exec flags; errexit and non-interpreter -c stay allowed", () => {
  // sh/bash/zsh: -c denied (incl. clustered forms), errexit allowed
  assert.equal(commandMatchesAllowlistEntry("bash -c 'rm -rf /'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("sh -c 'id'", "sh"), false)
  assert.equal(commandMatchesAllowlistEntry("zsh -c 'id'", "zsh"), false)
  assert.equal(commandMatchesAllowlistEntry("bash -lc 'id'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("bash -ec 'id'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("bash -e script.sh", "bash"), true)
  assert.equal(commandMatchesAllowlistEntry("bash -eu script.sh", "bash"), true)
  assert.equal(commandMatchesAllowlistEntry("bash script.sh", "bash"), true)
  // pwsh/powershell: -c / --command / -ec / --encodedcommand denied
  assert.equal(commandMatchesAllowlistEntry("pwsh -c 'Get-Process'", "pwsh"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh -Command 'x'", "pwsh"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh -ec ZQB0AA==", "pwsh"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell --command 'x'", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh -File script.ps1", "pwsh"), true)
  // deno/bun: eval / -e denied
  assert.equal(commandMatchesAllowlistEntry("deno eval '1+1'", "deno"), false)
  assert.equal(commandMatchesAllowlistEntry("bun -e 'x'", "bun"), false)
  assert.equal(commandMatchesAllowlistEntry("deno run script.ts", "deno"), true)
  // non-interpreter bare entries keep intentional relaxation
  assert.equal(commandMatchesAllowlistEntry("grep -c pattern file", "grep"), true)
  // interpreter behavior unchanged
  assert.equal(commandMatchesAllowlistEntry("python3 -c 'x'", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("node -e 'x'", "node"), false)
  assert.equal(commandMatchesAllowlistEntry("osascript -e 'x'", "osascript"), false)
})

test("W1b: pwsh unique prefixes / .exe basenames / bun --eval denied", () => {
  // WinPS unique-prefix resolution: -com/-co = -Command, -e/-enc = -EncodedCommand
  assert.equal(commandMatchesAllowlistEntry("powershell -com 'Get-Date'", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh -co 'x'", "pwsh"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell -enc ZQB0AA==", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh -e ZQB0AA==", "pwsh"), false)
  // `=` glued forms
  assert.equal(commandMatchesAllowlistEntry("pwsh -c=Get-Date", "pwsh"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell --command=Get-Date", "powershell"), false)
  // posix -e semantics untouched (errexit is NOT an EncodedCommand prefix)
  assert.equal(commandMatchesAllowlistEntry("bash -e script.sh", "bash"), true)
  assert.equal(commandMatchesAllowlistEntry("bash -eu script.sh", "bash"), true)
  // .exe basename normalization: deny sets still apply to *.exe entries
  assert.equal(commandMatchesAllowlistEntry("bash.exe -c id", "bash.exe"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell.exe -c id", "powershell.exe"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell.exe -com id", "powershell.exe"), false)
  // non-family entries unaffected by .exe stripping
  assert.equal(commandMatchesAllowlistEntry("grep.exe -c pattern file", "grep.exe"), true)
  // deno/bun: --eval
  assert.equal(commandMatchesAllowlistEntry("bun --eval 'x'", "bun"), false)
  assert.equal(commandMatchesAllowlistEntry("deno --eval 'x'", "deno"), false)
  // regressions: relaxation rules unchanged
  assert.equal(commandMatchesAllowlistEntry("grep -c pattern file", "grep"), true)
  assert.equal(commandMatchesAllowlistEntry("bash -C script.sh", "bash"), true) // noclobber
})

test("W1b: unparseable argv is deny (L-c; policy already owns `|`)", () => {
  // metachar `|` forces tokenizeSimpleArgv to return null → matcher fail-closed
  assert.equal(commandMatchesAllowlistEntry("bash -c 'a|b'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("bash -lc 'a|b'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell -com 'a|b'", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell.exe -c 'a|b'", "powershell.exe"), false)
  assert.equal(commandMatchesAllowlistEntry("bun --eval 'a|b'", "bun"), false)
  // no deny-flag and still unparseable → deny (do not fallback-allow)
  assert.equal(commandMatchesAllowlistEntry("bash -e 'a|b'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("grep -c 'a|b'", "grep"), false)
})

test("W1c: pwsh slash flags and bun/deno print-eval denied", () => {
  // WinPS 5.1 accepts `/` flag prefixes — same deny rules as `-`/`--`
  assert.equal(commandMatchesAllowlistEntry("powershell /c Get-Date", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell /Command 'x'", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh /com 'x'", "pwsh"), false)
  assert.equal(commandMatchesAllowlistEntry("powershell /ec ZQB0AA==", "powershell"), false)
  assert.equal(commandMatchesAllowlistEntry("pwsh /e ZQB0AA==", "pwsh"), false)
  // slash PATH arguments must NOT be caught (`/tmp/…` is no command prefix)
  assert.equal(commandMatchesAllowlistEntry("powershell /tmp/x.ps1", "powershell"), true)
  assert.equal(commandMatchesAllowlistEntry("pwsh -File /tmp/x.ps1", "pwsh"), true)
  // bun/deno print-eval
  assert.equal(commandMatchesAllowlistEntry("bun -p 'x'", "bun"), false)
  assert.equal(commandMatchesAllowlistEntry("bun --print 'x'", "bun"), false)
  assert.equal(commandMatchesAllowlistEntry("bun --print=code", "bun"), false)
  assert.equal(commandMatchesAllowlistEntry("deno --print 'x'", "deno"), false)
  // regressions
  assert.equal(commandMatchesAllowlistEntry("bash -e script.sh", "bash"), true)
  assert.equal(commandMatchesAllowlistEntry("grep -c pattern file", "grep"), true)
})

test("W1d: node -p / perl -E / cmd family / php -r denied", () => {
  // node print-eval (mirrors W1c deno/bun -p/--print)
  assert.equal(commandMatchesAllowlistEntry("node -p 'x'", "node"), false)
  assert.equal(commandMatchesAllowlistEntry("node --print 'x'", "node"), false)
  assert.equal(commandMatchesAllowlistEntry("node --print=x", "node"), false)
  // perl uppercase -E (generic -e rule is lowercase-only)
  assert.equal(commandMatchesAllowlistEntry("perl -E 'say 1'", "perl"), false)
  assert.equal(commandMatchesAllowlistEntry("perl -e 'x'", "perl"), false) // still denied
  // cmd family: /c and /k, case-insensitive, .exe normalized
  assert.equal(commandMatchesAllowlistEntry("cmd /c dir", "cmd"), false)
  assert.equal(commandMatchesAllowlistEntry("cmd /C dir", "cmd"), false)
  assert.equal(commandMatchesAllowlistEntry("cmd /k dir", "cmd"), false)
  assert.equal(commandMatchesAllowlistEntry("cmd.exe /c dir", "cmd.exe"), false)
  // positional-arg boundary: cmd script.bat stays allowed (documented)
  assert.equal(commandMatchesAllowlistEntry("cmd script.bat", "cmd"), true)
  // php code-run flags (php-scoped — ruby's legit -r require is unaffected)
  assert.equal(commandMatchesAllowlistEntry("php -r 'echo 1'", "php"), false)
  assert.equal(commandMatchesAllowlistEntry("php -R 'echo 1'", "php"), false)
  assert.equal(commandMatchesAllowlistEntry("php -B 'echo 1'", "php"), false)
  assert.equal(commandMatchesAllowlistEntry("ruby -r json x.rb", "ruby"), true)
  // unparseable (`|`) is deny via L-c, not fallback-allow
  assert.equal(commandMatchesAllowlistEntry("node -p 'a|b'", "node"), false)
  assert.equal(commandMatchesAllowlistEntry("perl -E 'a|b'", "perl"), false)
  assert.equal(commandMatchesAllowlistEntry("php -r 'a|b'", "php"), false)
  // regressions
  assert.equal(commandMatchesAllowlistEntry("bash -e script.sh", "bash"), true)
  assert.equal(commandMatchesAllowlistEntry("grep -c pattern file", "grep"), true)
})

test("W1e: quote-join / empty-quote / backslash / tokenize-null fail-closed", () => {
  // A: wrapping quotes + glob poison previously fallback-allowed `'-c'`
  assert.equal(commandMatchesAllowlistEntry("bash '-c' 'echo PWNED' '*'", "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("bash '-c' 'echo PWNED' '?'", "bash"), false)
  // L-b: intra-token empty quotes / backslash. No `~` — that would hide L-b behind tokenize-null.
  assert.equal(commandMatchesAllowlistEntry('bash -""c "echo pwned"', "bash"), false)
  assert.equal(commandMatchesAllowlistEntry("bash -\\c echo pwned", "bash"), false)
  // T-join: POSIX `"-"c` is one word `-c`. Trailing ENV= forces shell:true today.
  assert.equal(commandMatchesAllowlistEntry('bash "-"c "echo PWNED" X=1', "bash"), false)
  assert.equal(commandMatchesAllowlistEntry('bash "-l"c "echo PWNED" X=1', "bash"), false)
  // Interpreter L-b / T-join without glob/`~` poison
  assert.equal(commandMatchesAllowlistEntry('python3 -""c "import os"', "python3"), false)
  assert.equal(commandMatchesAllowlistEntry('python3 "-"c "import os" X=1', "python3"), false)
  assert.equal(commandMatchesAllowlistEntry('node -""e "1"', "node"), false)
  assert.equal(commandMatchesAllowlistEntry('sh -""c "id"', "sh"), false)
  assert.equal(commandMatchesAllowlistEntry('deno -""e "1"', "deno"), false)
  // L-c unique: unclosed quote, no deny-flag, `echo` is in neither deny set
  assert.equal(commandMatchesAllowlistEntry("echo 'unterminated", "echo"), false)
  // T-join argv: adjacent quoted spans concatenate
  assert.deepEqual(tryParseSimpleArgv('"foo""bar"'), ["foobar"])
  // I2 regressions
  assert.equal(commandMatchesAllowlistEntry("bash -e script.sh", "bash"), true)
  assert.equal(commandMatchesAllowlistEntry("grep -ic pattern file", "grep"), true)
})

test("C4: WIN_SCRIPTS without ALLOW throws even when NODE_ENV is empty", () => {
  const prevScripts = process.env.CMSPARK_WIN_SCRIPTS
  const prevAllow = process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
  const prevNode = process.env.NODE_ENV
  try {
    process.env.CMSPARK_WIN_SCRIPTS = "/tmp/cmspark-win-scripts"
    delete process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
    delete process.env.NODE_ENV
    assert.throws(
      () => resolveWinScript("computer-uia-watch.ps1"),
      /CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE/,
    )
  } finally {
    if (prevScripts === undefined) delete process.env.CMSPARK_WIN_SCRIPTS
    else process.env.CMSPARK_WIN_SCRIPTS = prevScripts
    if (prevAllow === undefined) delete process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
    else process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE = prevAllow
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
  }
})

test("C4: dual opt-in joins even under NODE_ENV=production", () => {
  const prevScripts = process.env.CMSPARK_WIN_SCRIPTS
  const prevAllow = process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
  const prevNode = process.env.NODE_ENV
  try {
    process.env.CMSPARK_WIN_SCRIPTS = "/tmp/cmspark-win-scripts"
    process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE = "1"
    process.env.NODE_ENV = "production"
    assert.equal(
      resolveWinScript("computer-uia-watch.ps1"),
      path.join("/tmp/cmspark-win-scripts", "computer-uia-watch.ps1"),
    )
  } finally {
    if (prevScripts === undefined) delete process.env.CMSPARK_WIN_SCRIPTS
    else process.env.CMSPARK_WIN_SCRIPTS = prevScripts
    if (prevAllow === undefined) delete process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
    else process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE = prevAllow
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
  }
})

test("C2: loader keys rejected by name; PATH and operator secrets stay", () => {
  assert.equal(isUnsafeLoaderEnvKey("NODE_OPTIONS"), true)
  assert.equal(isUnsafeLoaderEnvKey("node_options"), true)
  assert.equal(isUnsafeLoaderEnvKey("DYLD_INSERT_LIBRARIES"), true)
  assert.equal(isUnsafeLoaderEnvKey("PYTHONINSPECT"), true)
  assert.equal(isUnsafeLoaderEnvKey("BASH_ENV"), true)
  assert.equal(isUnsafeLoaderEnvKey("PATH"), false)
  assert.equal(isUnsafeLoaderEnvKey("HOME"), false)
  assert.equal(isUnsafeLoaderEnvKey("BRAVE_API_KEY"), false)
  assert.throws(
    () => buildMcpStdioEnv({ NODE_OPTIONS: "--require ./x" }),
    /NODE_OPTIONS/,
  )
  assert.throws(
    () => buildMcpStdioEnv({ DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib" }),
    /DYLD_INSERT_LIBRARIES/,
  )
  const env = buildMcpStdioEnv({ PATH: "/custom/bin", BRAVE_API_KEY: "k" })
  assert.equal(env.PATH, "/custom/bin")
  assert.equal(env.BRAVE_API_KEY, "k")
})

test("C1: canonicalize keep-query drop-hash; reject fragments", () => {
  assert.equal(
    canonicalizeOsascriptUrl("https://a.example/x?q=1#hash"),
    "https://a.example/x?q=1",
  )
  assert.equal(canonicalizeOsascriptUrl("https://a.example/x?u=https://good.tld"), "https://a.example/x?u=https://good.tld")
  assert.equal(canonicalizeOsascriptUrl("zhihu.com"), null)
  assert.equal(canonicalizeOsascriptUrl("example.com"), null)
})

test("C1: HMAC binds canonical URL; swap URL fails", () => {
  const policy = new SecurityPolicy()
  const a = {
    expression: "document.title",
    url: "https://good.example/page?q=1",
  }
  const payload = SecurityPolicy.bindingPayloadFor("osascript_eval", a)
  assert.match(payload, /document\.title/)
  assert.match(payload, /https:\/\/good\.example\/page\?q=1/)
  const { token } = policy.issueTokenFor("osascript_eval", a)
  assert.equal(
    policy.validateTokenFor(token, "osascript_eval", {
      expression: "document.title",
      url: "https://evil.example/",
    }),
    false,
  )
  assert.equal(policy.validateTokenFor(token, "osascript_eval", a), true)
})

test("C5: spawn HMAC sort+unique; extra tool fails; empty !== missing", () => {
  const policy = new SecurityPolicy()
  const base = { role_label: "reviewer", pack_id: "p1", alias: "w1" }
  const p1 = { ...base, tool_allow: ["evaluate", "list_tabs"] }
  const pReorder = { ...base, tool_allow: ["list_tabs", "evaluate"] }
  const pDup = { ...base, tool_allow: ["list_tabs", "evaluate", "list_tabs"] }
  const pExtra = { ...base, tool_allow: ["list_tabs", "evaluate", "click"] }
  const pMissing = { ...base }
  const pEmpty = { ...base, tool_allow: [] as string[] }
  assert.equal(
    SecurityPolicy.bindingPayloadFor("spawn_worker", p1),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pReorder),
  )
  assert.equal(
    SecurityPolicy.bindingPayloadFor("spawn_worker", p1),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pDup),
  )
  assert.notEqual(
    SecurityPolicy.bindingPayloadFor("spawn_worker", p1),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pExtra),
  )
  assert.notEqual(
    SecurityPolicy.bindingPayloadFor("spawn_worker", pMissing),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pEmpty),
  )
  const { token } = policy.issueTokenFor("spawn_worker", p1)
  assert.equal(policy.validateTokenFor(token, "spawn_worker", pExtra), false)
  assert.equal(policy.validateTokenFor(token, "spawn_worker", pReorder), true)
})

test("C1: catalog no longer teaches fragment contains", () => {
  const osa = (catalog as any[]).find((t) => t?.function?.name === "osascript_eval")
  assert.ok(osa)
  const desc = String(osa.function.description)
  const urlDesc = String(osa.function.parameters?.properties?.url?.description || "")
  assert.equal(osa.function.parameters.required.includes("expression"), true)
  assert.equal(osa.function.parameters.required.includes("url"), false)
  assert.ok(osa.function.parameters.properties.tabId)
  assert.doesNotMatch(desc, /contains/i)
  assert.doesNotMatch(urlDesc, /zhihu\.com matches/)
})

test("C5: empty roleAllow does not fall back to the default browser set", () => {
  const empty = computeWorkerWhitelist({ parentWhitelist: null, roleAllow: [] })
  assert.equal(empty.length, 0)
  const def = computeWorkerWhitelist({ parentWhitelist: null, roleAllow: null })
  assert.ok(def.includes("list_tabs"))
  const withShell = computeWorkerWhitelist({
    parentWhitelist: null,
    roleAllow: ["list_tabs", "shell_exec", "osascript_eval"],
  })
  assert.ok(withShell.includes("list_tabs"))
  assert.equal(withShell.includes("shell_exec"), false)
  for (const d of WORKER_HARD_DENY) {
    assert.equal(withShell.includes(d), false, d)
  }
})
