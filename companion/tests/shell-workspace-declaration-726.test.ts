// Complete real shell module with the existing inert731 child fixture, then actual
// server start serialization and adapter result serialization -> real observer.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import ts from "typescript"
const scope = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../.." : "..")
function compile(code: string, globals: Record<string, any> = {}) { const exports: any = {}; vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, ...globals }, { timeout: 2000 }); return exports }
function parse(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(scope, file), "utf8"), ts.ScriptTarget.Latest, true) }
function node(file: ts.SourceFile, predicate: (n: ts.Node) => boolean): string { const found: ts.Node[] = []; function walk(n: ts.Node) { if (predicate(n)) found.push(n); ts.forEachChild(n, walk) }; walk(file); assert.equal(found.length, 1); return found[0].getText(file) }
function fixture(platform = "win32") {
  const sf = parse("tests/shell-output-encoding-731.test.ts")
  const declaration = node(sf, n => ts.isFunctionDeclaration(n) && n.name?.text === "fixture")
  return compile(`${declaration}\nexports.fixture=fixture`, { fs, path, vm, ts, assert, EventEmitter, Buffer, TextDecoder, console, AbortController, require, source: path.join(scope, "src/capability/shell.ts") }).fixture("confirm_per_command", true, platform)
}
function declaration(command: string, platform: string, shell: string) { const sf = parse("src/capability/shell.ts"); return compile(node(sf, n => ts.isFunctionDeclaration(n) && n.name?.text === "declaredShellCwd")).declaredShellCwd(command, platform, shell) }
function wireObserver(command: string, result: unknown) {
  const server = parse("src/server.ts"), adapter = parse("src/llm/adapter.ts")
  const summary = node(server, n => ts.isFunctionDeclaration(n) && n.name?.text === "summarizeToolParams")
  const start = node(server, n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(server) === "ws.send" && n.getText(server).includes('type: "tool.start"'))
  const finish = node(adapter, n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(adapter) === "sendToExtension" && n.getText(adapter).includes('type: "tool.result"') && n.getText(adapter).includes("result: toolResult,"))
  const messages: any[] = []
  compile(`${summary}\nexport function send(){${start};${finish}}`, { finalParams: { command }, toolResult: result, actingThreadId: "A", threadId: "A", toolName: "shell_exec", toolCallId: "owned", tc: { id: "owned" },
    ws: { send(raw: string) { messages.push(JSON.parse(raw)) } }, sendToExtension(msg: any) { messages.push(JSON.parse(JSON.stringify(msg))) } }).send()
  assert.equal(Object.hasOwn(messages[0].params, "command"), false)
  assert.equal(JSON.stringify(messages[0]).includes(command), false)
  const observer = compile(fs.readFileSync(path.resolve(scope, "../chrome-extension/src/sidepanel/coding-handoff/workspace-hints.ts"), "utf8"))
  const o = new observer.WorkspaceHints(); o.select("A", 1); o.observe({ type: "connected" }); for (const m of messages) o.observe(m)
  return { rows: o.view().rows, messages }
}
test("#726 actual shell success -> real serialized start/result -> actual literal hint without command", async () => {
  for (const [platform, command, wanted] of [["win32", 'cd /d "C:\\中文 Repo" && git status', "C:\\中文 Repo"], ["darwin", "cd '/中文 Repo' && git status", "/中文 Repo"]]) {
    const f = fixture(platform), pending = f.shell.shellExec({ command }); f.close(); const result = await pending
    const wire = wireObserver(command, result)
    console.log(JSON.stringify({ phase: "ACTUAL_SHELL_JSON_OBSERVER", platform, declaredPresent: Object.hasOwn(result.data, "declared_cwd"), candidateCount: wire.rows.length, startHasCommand: Object.hasOwn(wire.messages[0].params, "command") }))
    assert.equal(result.data.declared_cwd, wanted); assert.equal(result.data.cwd, "OWNED_CWD")
    assert.equal(f.spawnCalls.length, 1); assert.equal(f.spawnCalls[0][0], command); assert.equal(f.spawnCalls[0][1].shell, true)
    assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0); assert.equal(f.shell.listActiveShellRunIds().length, 0)
    assert.equal(wire.rows.length, 1); assert.equal(wire.rows[0].path, wanted); assert.equal(wire.rows[0].source, "literal-cd")
    assert.equal(JSON.stringify(wire.messages).includes("git status"), false)
  }
})
test("#726 actual nonzero/timeout/abort never publish declared_cwd and keep original result state", async () => {
  for (const mode of ["exit", "timeout", "abort"]) {
    const f = fixture(), controller = new AbortController(), pending = f.shell.shellExec({ command: 'cd /d "C:\\repo" && git status', signal: controller.signal })
    if (mode === "timeout") (Array.from(f.timers.values())[0] as () => void)()
    if (mode === "abort") controller.abort()
    f.close(mode === "exit" ? 2 : 0); const result = await pending
    assert.equal(Object.hasOwn(result.data, "declared_cwd"), false); assert.equal(result.success, true)
    assert.equal(result.data.timed_out, mode === "timeout"); assert.equal(result.data.aborted, mode === "abort")
    assert.equal(f.shell.listActiveShellRunIds().length, 0); assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0)
  }
})
test("#726 platform quotes, unknown shell, expansions and suffix interpretation refuse declaration", () => {
  assert.equal(declaration('cd /d "C:\\中文" && git status', "win32", "cmd.exe"), "C:\\中文")
  assert.equal(declaration("cd '/中文' && git status", "linux", "/bin/sh"), "/中文")
  for (const [command, platform, shell] of [
    ["cd /d 'C:\\repo' && git status", "win32", "cmd.exe"],
    ['cd /d "C:\\repo"', "win32", "powershell.exe"], ['cd /d "C:\\repo"', "linux", "/bin/sh"],
    ["cd /repo", "linux", "/bin/bash"], ["cd /repo", "unknown", "/bin/sh"],
    ["cd $HOME", "linux", "/bin/sh"], ["cd ~/repo", "linux", "/bin/sh"],
    ["cd /repo || echo x", "linux", "/bin/sh"], ["cd /repo; whoami", "linux", "/bin/sh"],
    ["git --cwd /repo status", "linux", "/bin/sh"], ["cd /repo && echo $(id)", "linux", "/bin/sh"],
    ["cd /repo && echo x && echo y", "linux", "/bin/sh"], ["cd relative", "linux", "/bin/sh"], ["cd /repo && ", "linux", "/bin/sh"],
    ["cd /repo*", "linux", "/bin/sh"], ["cd /d C:\\re?po", "win32", "cmd.exe"],
    ["cd /repo\u061c", "linux", "/bin/sh"], ["cd /repo\u0085", "linux", "/bin/sh"],
  ]) assert.equal(declaration(command, platform, shell), undefined, command)
})
