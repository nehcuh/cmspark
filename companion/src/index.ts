// cmspark-agent CLI entry point

import { startServer } from "./server"
import { initDataDir, getLockFilePath, getPidFilePath } from "./config"
import {
  acquireLock,
  releaseLock,
  isProcessRunning,
  readPidFile,
  writePidFile,
  cleanupPidFile,
  daemonize,
  setupGracefulShutdown,
} from "./daemon"
import { startMenuBarAgent } from "./menu-bar-agent"
import * as fs from "fs"
import * as path from "path"

function printUsage(): void {
  console.log(`cmspark-agent v0.1.0

Usage:
  cmspark-agent start                    Start the companion server (foreground)
  cmspark-agent stop                     Stop the companion server
  cmspark-agent status                   Show server status
  cmspark-agent daemon start [--daemonize]  Start daemon
  cmspark-agent daemon stop                 Stop daemon
  cmspark-agent daemon status               Show daemon status
  cmspark-agent daemon logs                 View daemon logs
  cmspark-agent menu-bar                 Start menu bar agent`)
}

async function handleDaemonStart(): Promise<void> {
  const lockPath = getLockFilePath()
  const pidPath = getPidFilePath()

  // Check if already running
  const existingPid = readPidFile(pidPath)
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`[cmspark-agent] Daemon already running (pid: ${existingPid})`)
    process.exit(0)
  }

  // Try to acquire lock
  const lockAcquired = await acquireLock(lockPath)
  if (!lockAcquired) {
    // Lock exists but no PID or dead PID — try cleanup
    const pidFromLock = readPidFile(pidPath)
    if (pidFromLock && !isProcessRunning(pidFromLock)) {
      console.log(`[cmspark-agent] Cleaning up stale lock from dead process (pid: ${pidFromLock})`)
      cleanupPidFile(pidPath)
      releaseLock(lockPath)
      const retry = await acquireLock(lockPath)
      if (!retry) {
        console.error("[cmspark-agent] Failed to acquire lock after cleanup")
        process.exit(1)
      }
    } else {
      console.error("[cmspark-agent] Another instance is already running")
      process.exit(1)
    }
  }

  const shouldDaemonize = process.argv.includes("--daemonize")

  if (shouldDaemonize) {
    console.log("[cmspark-agent] Daemonizing...")
    daemonize({ silent: true })
  }

  writePidFile(pidPath, process.pid)

  setupGracefulShutdown(() => {
    releaseLock(lockPath)
    cleanupPidFile(pidPath)
  })

  await initDataDir()
  await startServer()
}

async function handleDaemonStop(): Promise<void> {
  const lockPath = getLockFilePath()
  const pidPath = getPidFilePath()
  const pid = readPidFile(pidPath)

  if (!pid) {
    console.log("[cmspark-agent] No PID file found — daemon not running")
    // Clean up any stale lock
    releaseLock(lockPath)
    process.exit(0)
  }

  if (!isProcessRunning(pid)) {
    console.log(`[cmspark-agent] Process ${pid} is not running — cleaning up stale state`)
    cleanupPidFile(pidPath)
    releaseLock(lockPath)
    process.exit(0)
  }

  console.log(`[cmspark-agent] Sending SIGTERM to process ${pid}...`)
  try {
    process.kill(pid, "SIGTERM")
  } catch (err: any) {
    console.error("[cmspark-agent] Failed to send signal:", err.message)
    process.exit(1)
  }

  // Wait up to 10 seconds for process to exit
  const start = Date.now()
  const timeout = 10000
  while (Date.now() - start < timeout) {
    if (!isProcessRunning(pid)) {
      console.log("[cmspark-agent] Daemon stopped successfully")
      cleanupPidFile(pidPath)
      releaseLock(lockPath)
      process.exit(0)
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  console.error("[cmspark-agent] Daemon did not exit within 10 seconds")
  process.exit(1)
}

async function handleDaemonStatus(): Promise<void> {
  const lockPath = getLockFilePath()
  const pidPath = getPidFilePath()
  const lockExists = fs.existsSync(lockPath)
  const pid = readPidFile(pidPath)
  const running = pid ? isProcessRunning(pid) : false

  console.log("Daemon status:")
  console.log(`  Lock file: ${lockExists ? "present" : "not present"} (${lockPath})`)
  console.log(`  PID file:  ${pid ? pid : "not present"} (${pidPath})`)
  console.log(`  Process:   ${running ? "running" : pid ? "dead (stale)" : "not running"}`)

  if (running) {
    console.log(`  WebSocket: ws://127.0.0.1:23401`)
  }

  process.exit(running ? 0 : 1)
}

async function handleDaemonLogs(): Promise<void> {
  const logDir = path.join(require("os").homedir(), ".cmspark-agent", "logs")
  const files = fs.readdirSync(logDir)
    .filter((f: string) => f.startsWith("companion-") && f.endsWith(".log"))
    .sort()

  if (files.length === 0) {
    console.log("[cmspark-agent] No log files found")
    process.exit(0)
  }

  const latest = path.join(logDir, files[files.length - 1])
  console.log(`[cmspark-agent] Latest log: ${latest}\n`)

  try {
    const content = fs.readFileSync(latest, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim())
    const tail = lines.slice(-50)
    for (const line of tail) {
      try {
        const entry = JSON.parse(line)
        console.log(`[${entry.ts}] ${entry.level.toUpperCase().padEnd(5)} ${entry.event}`)
        if (entry.data && Object.keys(entry.data).length > 0) {
          console.log("  ", JSON.stringify(entry.data))
        }
      } catch {
        console.log(line)
      }
    }
  } catch (err: any) {
    console.error("[cmspark-agent] Failed to read logs:", err.message)
    process.exit(1)
  }

  process.exit(0)
}

async function main() {
  const command = process.argv[2]
  const subCommand = process.argv[3]
  const subSubCommand = process.argv[4]

  switch (command) {
    case "start":
      await initDataDir()
      await startServer()
      break

    case "stop":
      console.log("Stop command not yet implemented (use 'daemon stop' instead)")
      process.exit(0)

    case "status":
      console.log("Status command not yet implemented (use 'daemon status' instead)")
      process.exit(0)

    case "daemon": {
      switch (subCommand) {
        case "start":
          await handleDaemonStart()
          break
        case "stop":
          await handleDaemonStop()
          break
        case "status":
          await handleDaemonStatus()
          break
        case "logs":
          await handleDaemonLogs()
          break
        default:
          console.log("Usage: cmspark-agent daemon {start|stop|status|logs}")
          process.exit(1)
      }
      break
    }

    case "menu-bar":
      startMenuBarAgent()
      break

    case "--help":
    case "-h":
    case undefined:
      printUsage()
      process.exit(0)

    default:
      console.error(`Unknown command: ${command}`)
      printUsage()
      process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
