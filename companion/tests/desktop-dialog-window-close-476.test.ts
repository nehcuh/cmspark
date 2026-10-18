/** Runs only the exact WM_CLOSE source branch, with inert C++ call seams.
 * No native compiler, Win32 call or physical/native acceptance is represented. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const cpp = fs.readFileSync(path.resolve(__dirname, "../../src/desktop/native/DesktopHost.cpp"), "utf8")
function closeBranch(name: "confirmation_proc" | "proc") {
  const signature = "static LRESULT CALLBACK " + name + "("
  const start = cpp.indexOf(signature); assert.ok(start >= 0); assert.equal(cpp.indexOf(signature, start + signature.length), -1)
  const end = name === "confirmation_proc" ? cpp.indexOf(" void begin_confirmation(", start) : cpp.indexOf(" int run(", start)
  assert.ok(end > start)
  const branches = [...cpp.slice(start, end).matchAll(/if\(message==WM_CLOSE\)\{([^{}]+)\}/g)]
  assert.equal(branches.length, 1, "the actual selected window procedure has exactly one close branch")
  return new Function("message", "WM_CLOSE", "self", "DestroyWindow", "hwnd", branches[0][0].replaceAll("self->", "self."))
}
function calls(name: "confirmation_proc" | "proc", message = 16) {
  const events: string[] = []
  const result = closeBranch(name)(message, 16, {
    retire_workspace() { events.push("retire-owned-workspace") },
    retire_dialog() { events.push("stop-owned-chat") },
    retire_confirmation(decision: number) { assert.equal(decision, 0); events.push("deny-this-confirmation") },
  }, () => events.push("destroy-main"), 0)
  return { result, events }
}
test("closing only the MCP confirmation title bar denies it without stopping an independent chat", () => {
  assert.deepEqual(calls("confirmation_proc"), { result: 0, events: ["deny-this-confirmation"] })
})
test("closing the actual main window still retires its captured chat before destroying the host", () => {
  assert.deepEqual(calls("proc"), { result: 0, events: ["retire-owned-workspace", "stop-owned-chat", "deny-this-confirmation", "destroy-main"] })
})
test("the close branch does not execute its actions for another window message", () => {
  for (const name of ["confirmation_proc", "proc"] as const) assert.deepEqual(calls(name, 5), { result: undefined, events: [] })
})
