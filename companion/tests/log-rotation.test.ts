import test, { before, after, beforeEach, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-log-rotation-"))

let clearConfigCache: typeof import("../src/config").clearConfigCache
let initDataDir: typeof import("../src/config").initDataDir
let saveConfig: typeof import("../src/config").saveConfig
let pruneOldLogs: typeof import("../src/log-rotation").pruneOldLogs
let rotateLogFileIfNeeded: typeof import("../src/log-rotation").rotateLogFileIfNeeded
let logEvent: typeof import("../src/logger").logEvent
let getLogFilePath: typeof import("../src/logger").getLogFilePath

async function resetConfigFile() {
  clearConfigCache()
  for (const f of fs.readdirSync(tempHome)) {
    if (f === "config.json" || f.startsWith("config.json.corrupt-") || f.includes(".tmp-")) {
      try { fs.rmSync(path.join(tempHome, f)) } catch { /* ignore */ }
    }
  }
  await initDataDir()
  clearConfigCache()
}

function clearLogDirs() {
  const logsDir = path.join(tempHome, "logs")
  const mcpLogsDir = path.join(tempHome, "mcp", "logs")
  if (fs.existsSync(logsDir)) {
    for (const f of fs.readdirSync(logsDir)) {
      try { fs.rmSync(path.join(logsDir, f)) } catch { /* ignore */ }
    }
  }
  if (fs.existsSync(mcpLogsDir)) {
    for (const f of fs.readdirSync(mcpLogsDir)) {
      try { fs.rmSync(path.join(mcpLogsDir, f)) } catch { /* ignore */ }
    }
  }
}

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = tempHome
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.CMSPARK_API_KEY

  const cfg = await import("../src/config")
  clearConfigCache = cfg.clearConfigCache
  initDataDir = cfg.initDataDir
  saveConfig = cfg.saveConfig

  const rotation = await import("../src/log-rotation")
  pruneOldLogs = rotation.pruneOldLogs
  rotateLogFileIfNeeded = rotation.rotateLogFileIfNeeded

  const logger = await import("../src/logger")
  logEvent = logger.logEvent
  getLogFilePath = logger.getLogFilePath

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

describe("pruneOldLogs retention", { concurrency: 1 }, () => {
  before(async () => {
    await resetConfigFile()
    saveConfig({ log_retention_days: 7, log_max_file_mb: 10 })
  })

  beforeEach(() => {
    clearLogDirs()
  })

  test("deletes companion date logs older than retention", () => {
    const logsDir = path.join(tempHome, "logs")
    const oldFile = path.join(logsDir, "companion-2026-06-01.log")
    const rotatedOld = path.join(logsDir, "companion-2026-06-01.1.log")
    const recentFile = path.join(logsDir, "companion-2026-07-12.log")
    const todayFile = path.join(logsDir, `companion-${new Date().toISOString().slice(0, 10)}.log`)
    fs.writeFileSync(oldFile, "old\n")
    fs.writeFileSync(rotatedOld, "old rotated\n")
    fs.writeFileSync(recentFile, "recent\n")
    fs.writeFileSync(todayFile, "today\n")

    pruneOldLogs()

    assert.equal(fs.existsSync(oldFile), false, "old log should be deleted")
    assert.equal(fs.existsSync(rotatedOld), false, "old rotated log should be deleted")
    assert.equal(fs.existsSync(recentFile), true, "recent log should be kept")
    assert.equal(fs.existsSync(todayFile), true, "today log should be kept")
  })

  test("deletes mcp logs by mtime when older than retention", () => {
    const mcpLogsDir = path.join(tempHome, "mcp", "logs")
    const oldMcp = path.join(mcpLogsDir, "server-a.log")
    const recentMcp = path.join(mcpLogsDir, "server-b.log")
    const oldNonLog = path.join(mcpLogsDir, "server-a.pid") // non-.log file, old mtime
    fs.writeFileSync(oldMcp, "old mcp\n")
    fs.writeFileSync(recentMcp, "recent mcp\n")
    fs.writeFileSync(oldNonLog, "old non-log\n")
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 10)
    fs.utimesSync(oldMcp, oldDate, oldDate)
    fs.utimesSync(oldNonLog, oldDate, oldDate)

    pruneOldLogs()

    assert.equal(fs.existsSync(oldMcp), false, "old mcp log should be deleted by mtime")
    assert.equal(fs.existsSync(recentMcp), true, "recent mcp log should be kept")
    assert.equal(fs.existsSync(oldNonLog), true, "non-.log file in mcp/logs must be left untouched")
  })

  test("keeps non-date companion filenames and unparseable dates", () => {
    const logsDir = path.join(tempHome, "logs")
    const noDate = path.join(logsDir, "companion-foo.log")
    const badDate = path.join(logsDir, "companion-2026-99-99.log")
    fs.writeFileSync(noDate, "no date\n")
    fs.writeFileSync(badDate, "bad date\n")

    pruneOldLogs()

    assert.equal(fs.existsSync(noDate), true, "non-date filename should be kept")
    assert.equal(fs.existsSync(badDate), true, "invalid date filename should be kept")
  })

  test("does not throw on missing directories", () => {
    fs.rmSync(path.join(tempHome, "logs"), { recursive: true, force: true })
    fs.rmSync(path.join(tempHome, "mcp", "logs"), { recursive: true, force: true })
    assert.doesNotThrow(() => pruneOldLogs())
  })

  test("retention boundary is deterministic at UTC midnight (keeps file dated today-retention)", () => {
    // The cutoff is anchored to UTC midnight, so the file dated EXACTLY
    // (today_UTC - retentionDays) is kept (== cutoff, not <); one day older is deleted.
    // This must hold regardless of the local time-of-day the test runs at.
    const logsDir = path.join(tempHome, "logs")
    fs.mkdirSync(logsDir, { recursive: true }) // prior test may have removed the dir
    const todayUtc = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const boundary = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - 7))
    const older = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - 8))
    const boundaryFile = path.join(logsDir, `companion-${fmt(boundary)}.log`)
    const olderFile = path.join(logsDir, `companion-${fmt(older)}.log`)
    fs.writeFileSync(boundaryFile, "boundary\n")
    fs.writeFileSync(olderFile, "older\n")

    pruneOldLogs() // retention = 7 (set in describe before)

    assert.equal(fs.existsSync(boundaryFile), true, "file dated today_UTC-7 must be kept (UTC-midnight boundary)")
    assert.equal(fs.existsSync(olderFile), false, "file dated today_UTC-8 must be deleted")
  })
})

describe("rotateLogFileIfNeeded size rotation", { concurrency: 1 }, () => {
  before(async () => {
    await resetConfigFile()
    saveConfig({ log_max_file_mb: 0.001 }) // ~1 KiB
  })

  beforeEach(() => {
    clearLogDirs()
  })

  test("renames oversized log to .1.log before new writes", () => {
    const logsDir = path.join(tempHome, "logs")
    const filePath = path.join(logsDir, "companion-2026-07-13.log")
    const rotated = path.join(logsDir, "companion-2026-07-13.1.log")
    const bigLine = "x".repeat(2048)
    fs.writeFileSync(filePath, `${bigLine}\n`)

    rotateLogFileIfNeeded(filePath)

    assert.equal(fs.existsSync(filePath), false, "original oversized log should be rotated away")
    assert.equal(fs.existsSync(rotated), true, "rotated .1.log should exist")
    assert.ok(fs.statSync(rotated).size > 2048, "rotated file should retain content")
  })

  test("overwrites previous .1.log on subsequent rotation", () => {
    const logsDir = path.join(tempHome, "logs")
    const filePath = path.join(logsDir, "companion-2026-07-13.log")
    const rotated = path.join(logsDir, "companion-2026-07-13.1.log")
    fs.writeFileSync(rotated, "previous rotated\n")
    fs.writeFileSync(filePath, `${"x".repeat(2048)}\n`)

    rotateLogFileIfNeeded(filePath)

    assert.equal(fs.existsSync(filePath), false)
    assert.ok(
      fs.readFileSync(rotated, "utf-8").startsWith("x"),
      "previous .1.log should be overwritten",
    )
  })

  test("does nothing when file is under threshold", () => {
    const logsDir = path.join(tempHome, "logs")
    const filePath = path.join(logsDir, "companion-2026-07-13.log")
    fs.writeFileSync(filePath, "small\n")

    rotateLogFileIfNeeded(filePath)

    assert.equal(fs.existsSync(filePath), true)
    assert.equal(fs.readFileSync(filePath, "utf-8"), "small\n")
  })

  test("does not throw when file does not exist", () => {
    const missing = path.join(tempHome, "logs", "companion-missing.log")
    assert.doesNotThrow(() => rotateLogFileIfNeeded(missing))
  })
})

describe("logEvent integration", { concurrency: 1 }, () => {
  before(async () => {
    await resetConfigFile()
    saveConfig({ log_max_file_mb: 0.001 })
  })

  beforeEach(() => {
    clearLogDirs()
  })

  test("writing an oversized log triggers rotation before append", () => {
    const filePath = getLogFilePath()
    const rotated = filePath.replace(/\.log$/, ".1.log")
    fs.writeFileSync(filePath, `${"x".repeat(2048)}\n`)

    logEvent("info", "test.after.rotation", { msg: "hello" })

    assert.equal(fs.existsSync(rotated), true, "rotation should have happened")
    const content = fs.readFileSync(filePath, "utf-8")
    assert.ok(content.includes("test.after.rotation"), "new entry should be in fresh file")
    assert.ok(content.includes('"msg":"hello"'), "new entry data should be present")
  })
})
