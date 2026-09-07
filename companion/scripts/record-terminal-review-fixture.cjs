// Node 22, after tsc -p tsconfig.test.json. Real handler/wire; synthetic PTY only.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path")
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-terminal-wire-"))
process.env.CMSPARK_DATA_DIR = temp
let pty
;(async () => {
  try {
    const config = require("../.test-dist/src/config")
    await config.initDataDir()
    config.saveConfig({ embedded_terminal: { enabled: true } })
    const { ThreadManager } = require("../.test-dist/src/threads/thread-manager")
    const tm = new ThreadManager(), thread = tm.create("Synthetic review")
    tm.update(thread.id, { workspace_root: temp })
    const { CodeReviewService } = require("../.test-dist/src/code-review/service")
    const service = new CodeReviewService(temp, { kind: "chat", threadId: thread.id })
    const view = service.create({ request_id: "ui-fixture", repository: "https://code.example.test/team/demo", base: "a".repeat(40), head: "b".repeat(40) })
    pty = require("../.test-dist/src/pty/session")
    pty.__testSetPtyPlatform("darwin")
    pty.__testSetPtySpawn(() => ({ pid: 0, write() {}, resize() {}, pause() {}, resume() {}, kill() {}, onData() {}, onExit() {} }))
    const { handleTerminalMessage } = require("../.test-dist/src/pty/handler")
    const session = { surface: "panel", originWs: { readyState: 1 }, sendToExtension() {}, requestConfirmation: async () => ({ approved: true }) }
    const services = { threadManager: tm }
    const opened = await handleTerminalMessage("terminal.open", { id: "fixture-terminal", thread_id: thread.id, review_id: view.review_id, user_gesture: true }, services, session)
    const report = { review_id: view.review_id, repository: view.repository, base: view.base, head: view.head, diff_hash: view.diff_hash,
      status: "partial", summary: "Synthetic external assessment", reviewed_files: [], findings: [], mappings: [] }
    const rejected = await handleTerminalMessage("terminal.review.submit", { id: "fixture-terminal", user_gesture: true, report: { ...report, head: "c".repeat(40) } }, services, session)
    const received = await handleTerminalMessage("terminal.review.submit", { id: "fixture-terminal", user_gesture: true, report }, services, session)
    if (opened.type !== "terminal.opened" || received.type !== "terminal.review.received") throw new Error("producer failed")
    const file = path.resolve(__dirname, "../../chrome-extension/tests/fixtures/terminal-review-v1.json")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ opened, rejected, received, report }, null, 2) + "\n")
  } finally {
    pty?.__testResetPtySessions()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})().catch(error => { console.error(error.message); process.exitCode = 1 })
