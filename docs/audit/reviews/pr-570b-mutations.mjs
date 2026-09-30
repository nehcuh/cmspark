// Review mutation harness for #569 — NOT part of the PR. Applies one mutation
// to a source file, prints a marker, and the caller restores via git checkout.
// Usage: node scratch/mutate-569.mjs <mutation-id>
import { readFileSync, writeFileSync } from "node:fs"

const id = process.argv[2]
const NL = "\r\n" // repo files are CRLF

function patch(file, find, replace) {
  let s = readFileSync(file, "utf8")
  if (!s.includes(find)) {
    console.error(`PATCH-FAIL: target not found in ${file} for ${id}`)
    process.exit(2)
  }
  s = s.replace(find, replace)
  writeFileSync(file, s)
  console.log(`${id} applied to ${file}`)
}

switch (id) {
  // M1: persist only for non-workers (the author's claimed-red mutation)
  case "M1": {
    const find = `    try {${NL}      threadManager.update(threadId, {${NL}        last_run_terminal: runStats.terminal,`
    const repl = `    if (threadManager.get(threadId)?.agent_role === "worker") { /* M1: skip */ } else ${`try {${NL}      threadManager.update(threadId, {${NL}        last_run_terminal: runStats.terminal,`}`
    patch("src/llm/adapter.ts", find, repl)
    break
  }
  // M2: remove the local fallback (author's claimed-red mutation)
  case "M2": {
    const find = `  const runStats: RunStats =${NL}    params.runStats ?? { toolCalls: 0, closingTurnToolCalls: 0, totalTokens: 0, terminal: null }`
    const repl = `  const runStats: RunStats = params.runStats as RunStats // M2: fallback removed`
    patch("src/llm/adapter.ts", find, repl)
    break
  }
  // M3: move persist back to message-router (author's claimed-red mutation)
  case "M3": {
    // 3a: delete the adapter persist block
    const find = `    try {${NL}      threadManager.update(threadId, {${NL}        last_run_terminal: runStats.terminal,${NL}        last_run_ended_at: new Date().toISOString(),${NL}      })${NL}    } catch (termErr: any) {${NL}      logger.warn("run.terminal_persist_failed", {${NL}        thread_id: threadId,${NL}        error: termErr?.message || String(termErr),${NL}      })${NL}    }${NL}`
    patch("src/llm/adapter.ts", find, `    // M3: persist removed from adapter${NL}`)
    // 3b: add it back into the router right after broadcastLoopStatus
    const find2 = `        await broadcastLoopStatus(session, services.threadManager, rest.thread_id, runStats.terminal)`
    const repl2 = `${find2}${NL}        services.threadManager.update(rest.thread_id, { last_run_terminal: runStats.terminal, last_run_ended_at: new Date().toISOString() }) // M3`
    patch("src/message-router.ts", find2, repl2)
    break
  }
  // M4: drop the ?? null coercion in dispatch (author's claimed-red mutation)
  case "M4": {
    let s = readFileSync("src/tool/companion-dispatch.ts", "utf8")
    const before = s
    s = s.split("last_run_terminal: w.last_run_terminal ?? null,").join("last_run_terminal: w.last_run_terminal, // M4")
    s = s.split("last_run_ended_at: w.last_run_ended_at ?? null,").join("last_run_ended_at: w.last_run_ended_at, // M4")
    if (s === before) { console.error("PATCH-FAIL: M4 targets not found"); process.exit(2) }
    writeFileSync("src/tool/companion-dispatch.ts", s)
    console.log("M4 applied to src/tool/companion-dispatch.ts")
    break
  }
  // M5 (reviewer's own): move the persist block OUT of the finally, before the try —
  // all string guards should still pass if placement-in-finally is unpinned.
  case "M5": {
    const find = `    try {${NL}      threadManager.update(threadId, {${NL}        last_run_terminal: runStats.terminal,${NL}        last_run_ended_at: new Date().toISOString(),${NL}      })${NL}    } catch (termErr: any) {${NL}      logger.warn("run.terminal_persist_failed", {${NL}        thread_id: threadId,${NL}        error: termErr?.message || String(termErr),${NL}      })${NL}    }${NL}`
    patch("src/llm/adapter.ts", find, `    // M5: persist moved out of finally${NL}`)
    const anchor = `  try {${NL}  await runContextBudgetPass("pre_loop")`
    const repl = `  try { threadManager.update(threadId, { last_run_terminal: runStats.terminal, last_run_ended_at: new Date().toISOString() }) } catch (termErr: any) { logger.warn("run.terminal_persist_failed", { thread_id: threadId, error: termErr?.message || String(termErr) }) } // M5${NL}  try {${NL}  await runContextBudgetPass("pre_loop")`
    patch("src/llm/adapter.ts", anchor, repl)
    break
  }
  // M6 (reviewer's own): ended_at as a constant — should RED via explicit guard
  case "M6": {
    const find = "last_run_ended_at: new Date().toISOString(),"
    patch("src/llm/adapter.ts", find, "last_run_ended_at: \"2026-09-30T00:00:00.000Z\", // M6")
    break
  }
  // M7 (reviewer's own): drop terminal:null from the fallback literal — tsc should reject
  case "M7": {
    const find = "params.runStats ?? { toolCalls: 0, closingTurnToolCalls: 0, totalTokens: 0, terminal: null }"
    patch("src/llm/adapter.ts", find, "params.runStats ?? ({ toolCalls: 0, closingTurnToolCalls: 0, totalTokens: 0 } as never) // M7")
    break
  }
  // M8 (reviewer's own): persist only when the caller did NOT pass runStats (kick-only)
  case "M8": {
    const find = `    try {${NL}      threadManager.update(threadId, {${NL}        last_run_terminal: runStats.terminal,`
    const repl = `    if (!params.runStats) ${`try {${NL}      threadManager.update(threadId, {${NL}        last_run_terminal: runStats.terminal,`}`
    patch("src/llm/adapter.ts", find, repl)
    break
  }
  default:
    console.error(`unknown mutation ${id}`)
    process.exit(1)
}
