/** Runs only the exact WM_CLOSE source branch, with inert C++ call seams.
 * No native compiler, Win32 call or physical/native acceptance is represented. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const cpp = fs.readFileSync(path.resolve(__dirname, "../../src/desktop/native/DesktopHost.cpp"), "utf8")
function closeBranch(name: "confirmation_proc" | "proc", source = cpp) {
  const signature = "static LRESULT CALLBACK " + name + "("
  const start = source.indexOf(signature); assert.ok(start >= 0); assert.equal(source.indexOf(signature, start + signature.length), -1)
  const end = name === "confirmation_proc" ? source.indexOf(" void begin_confirmation(", start) : source.indexOf(" int run(", start)
  assert.ok(end > start)
  const branches = [...source.slice(start, end).matchAll(/if\(message==WM_CLOSE\)\{([^{}]+)\}/g)]
  assert.equal(branches.length, 1, "the actual selected window procedure has exactly one close branch")
  return new Function("message", "WM_CLOSE", "self", "DestroyWindow", "hwnd", branches[0][0].replaceAll("self->", "self."))
}
function calls(name: "confirmation_proc" | "proc", message = 16, source = cpp) {
  const events: string[] = []
  const result = closeBranch(name, source)(message, 16, {
    retire_archive() { events.push("retire-archive-state") },
    retire_dialog() { events.push("stop-owned-chat") },
    retire_confirmation(decision: number) { assert.equal(decision, 0); events.push("deny-this-confirmation") },
  }, () => events.push("destroy-main"), 0)
  return { result, events }
}
test("closing only the MCP confirmation title bar denies it without stopping an independent chat", () => {
  assert.deepEqual(calls("confirmation_proc"), { result: 0, events: ["deny-this-confirmation"] })
})
test("closing the actual main window still retires its captured chat before destroying the host", () => {
  assert.deepEqual(calls("proc"), { result: 0, events: ["retire-archive-state", "stop-owned-chat", "deny-this-confirmation", "destroy-main"] })
})
test("the close branch does not execute its actions for another window message", () => {
  for (const name of ["confirmation_proc", "proc"] as const) assert.deepEqual(calls(name, 5), { result: undefined, events: [] })
})

// Execute the whole current branches for each source variant, rather than
// permitting any new call or deleting the independent-chat close assertion.
test("archive-aware main close preserves exact retirement order across checkout EOLs and rejects omissions", () => {
  function verify(source: string) {
    assert.deepEqual(calls("confirmation_proc", 16, source), { result: 0, events: ["deny-this-confirmation"] })
    assert.deepEqual(calls("proc", 16, source), { result: 0, events: ["retire-archive-state", "stop-owned-chat", "deny-this-confirmation", "destroy-main"] })
    for (const name of ["confirmation_proc", "proc"] as const) assert.deepEqual(calls(name, 5, source), { result: undefined, events: [] })
  }
  for (const source of [cpp, cpp.replace(/\r?\n/g, "\r\n")]) verify(source)
  const actual = "self->retire_archive();self->retire_dialog();self->retire_confirmation(0);DestroyWindow(hwnd);"
  assert.equal(cpp.split(actual).length, 2)
  for (const changed of [
    actual.replace("self->retire_archive();", ""), actual.replace("self->retire_dialog();", ""),
    actual.replace("self->retire_confirmation(0);", ""), actual.replace("DestroyWindow(hwnd);", ""),
    "DestroyWindow(hwnd);self->retire_archive();self->retire_dialog();self->retire_confirmation(0);",
  ]) assert.throws(() => verify(cpp.replace(actual, changed)))
  assert.throws(() => verify(cpp.replace("if(message==WM_CLOSE){self->retire_confirmation(0);return 0;}", "if(message==WM_CLOSE){self->retire_archive();self->retire_confirmation(0);return 0;}")))
})
