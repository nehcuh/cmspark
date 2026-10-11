// Real synthetic ACP peer; no model, network, repository reads or executed task.
const fs = require("node:fs")
const readline = require("node:readline")
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n")
fs.writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid))
let promptId
readline.createInterface({ input: process.stdin }).on("line", line => {
  const msg = JSON.parse(line)
  if (msg.method === "initialize") {
    fs.writeFileSync(process.env.FIXTURE_STAGE_FILE, "initialize")
    if (process.env.FIXTURE_MODE === "hang-init") return
    send({ id: msg.id, result: { protocolVersion: 1 } })
  } else if (msg.method === "session/new") {
    send({ id: msg.id, result: { sessionId: "synthetic-lifecycle-session" } })
  } else if (msg.method === "session/prompt") {
    promptId = msg.id
    fs.writeFileSync(process.env.FIXTURE_STAGE_FILE, "prompt")
    send({ method: "session/update", params: { update: {
      sessionUpdate: "agent_thought_chunk", content: { text: "EXCLUDED_REASONING" },
    } } })
    if (process.env.FIXTURE_MODE === "hang-prompt") return
    if (process.env.FIXTURE_MODE === "empty") {
      send({ id: promptId, result: { stopReason: "end_turn" } }); return
    }
    send({ id: "permission", method: "session/request_permission", params: { title: "fixture operation" } })
  } else if (msg.id === "permission") {
    fs.writeFileSync(process.env.FIXTURE_PERMISSION_FILE, JSON.stringify(msg.result))
    const text = process.env.FIXTURE_MODE === "oversize" ? "x".repeat(256 * 1024 + 1) : '{"result":"真实分块✅"}'
    const middle = Math.floor(text.length / 2)
    for (const chunk of [text.slice(0, middle), text.slice(middle)]) {
      send({ method: "session/update", params: { update: {
        sessionUpdate: "agent_message_chunk", content: { text: chunk },
      } } })
    }
    send({ id: promptId, result: { stopReason: "end_turn" } })
    // Persistent protocol server deliberately does not exit at end_turn.
  }
})
