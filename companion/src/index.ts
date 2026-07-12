#!/usr/bin/env node
// cmspark-agent CLI entry point

import { startServer } from "./server"
import { initDataDir, getLockFilePath, getPidFilePath } from "./config"
import { getSwiftTrayPath, getTrayBuildScript, getTrayCwd } from "./paths"
import {
  acquireLock,
  releaseLock,
  isProcessRunning,
  isDaemonRunning,
  readPidFile,
  writePidFile,
  cleanupPidFile,
  daemonize,
  setupGracefulShutdown,
} from "./daemon"
import { startMenuBarAgent } from "./menu-bar-agent"
import { runInteractiveSettings, runNonInteractiveSettings, runNonInteractiveSettingsCli } from "./settings-cli"
import { getPlatform } from "./platform"
import * as fs from "fs"
import * as path from "path"
import * as child_process from "child_process"

function printUsage(): void {
  console.log(`cmspark-agent v0.3.0

Usage:
  cmspark-agent start                      启动 Companion 服务器（前台）
  cmspark-agent stop                       停止 Companion 服务器
  cmspark-agent status                     查看服务器状态

  cmspark-agent daemon start [--daemonize]  启动守护进程
  cmspark-agent daemon stop                停止守护进程
  cmspark-agent daemon status              查看守护进程状态
  cmspark-agent daemon logs                查看守护进程日志

  cmspark-agent settings                   打开 Web 设置面板（浏览器）
  cmspark-agent settings --set key=value   非交互式修改配置

  cmspark-agent settings-ui                打开 Web 设置面板
  cmspark-agent settings-cli               打开终端交互式设置（旧版）

  cmspark-agent tray                       启动系统托盘（推荐）
  cmspark-agent tray status                查看托盘后端信息
  cmspark-agent tray rebuild               重新编译 Swift 托盘（macOS）

  cmspark-agent menu-bar                   启动菜单栏（已弃用，请使用 tray）`)
}

// ---------------------------------------------------------------------------
// Tray sub-commands
// ---------------------------------------------------------------------------

async function handleTrayStatus(): Promise<void> {
  const { detectTrayBackend } = await import("./tray/tray-adapter")
  const backend = detectTrayBackend()
  const platform = getPlatform()

  console.log("CMspark 托盘状态:")
  console.log(`  平台: ${platform} (${process.arch})`)
  console.log(`  托盘后端: ${backend}`)

  const pid = readPidFile(getPidFilePath())
  console.log(`  Companion: ${pid && isProcessRunning(pid) ? "运行中" : "已停止"}`)
  console.log(`  WebSocket: ws://127.0.0.1:23401`)

  if (platform === "darwin" && process.arch === "arm64") {
    const swiftBin = getSwiftTrayPath()
    console.log(`  Swift 托盘: ${fs.existsSync(swiftBin) ? "可用" : "未编译"}`)
  }

  process.exit(0)
}

async function handleTrayRebuild(): Promise<void> {
  if (process.platform !== "darwin") {
    console.error("[cmspark-agent] Swift 托盘仅支持 macOS")
    process.exit(1)
  }

  const buildScript = getTrayBuildScript()
  if (!fs.existsSync(buildScript)) {
    console.error(`[cmspark-agent] 编译脚本不存在: ${buildScript}`)
    process.exit(1)
  }

  console.log("[cmspark-agent] 重新编译 Swift 托盘...")
  try {
    child_process.execSync(`bash "${buildScript}"`, {
      cwd: getTrayCwd(),
      stdio: "inherit",
    })
    console.log("[cmspark-agent] Swift 托盘编译成功")
    process.exit(0)
  } catch {
    console.error("[cmspark-agent] Swift 托盘编译失败")
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Daemon commands
// ---------------------------------------------------------------------------

async function handleDaemonStart(): Promise<void> {
  const lockPath = getLockFilePath()
  const pidPath = getPidFilePath()

  // Use isDaemonRunning (not isProcessRunning): a stale daemon.pid can point at
  // a PID the OS has recycled to an unrelated process (e.g. RuntimeBroker.exe on
  // Windows). The bare PID-existence check would then falsely report "already
  // running" and refuse to start the real server.
  const existingPid = readPidFile(pidPath)
  if (existingPid && isDaemonRunning(existingPid)) {
    console.log(`[cmspark-agent] Daemon already running (pid: ${existingPid})`)
    process.exit(0)
  }

  const lockAcquired = await acquireLock(lockPath)
  if (!lockAcquired) {
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
    // In SEA mode process.argv[0] === process.argv[1] === exe path, so
    // slice(1) would include the exe path as the first "arg", causing the
    // spawned grandchild to see the exe path as the command ("Unknown command").
    // getSelfSpawnArgs() handles both SEA and non-SEA correctly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSelfSpawnArgs } = require("./paths") as typeof import("./paths")
    const { execPath, args } = getSelfSpawnArgs(["daemon", "start"])
    const grandchild = child_process.spawn(execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    grandchild.unref()
    process.exit(0)
  }

  writePidFile(pidPath, process.pid)

  // Release daemon lock — startServer() will acquire its own
  releaseLock(lockPath)

  setupGracefulShutdown(() => {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

    case "tray": {
      switch (subCommand) {
        case "status":
          await handleTrayStatus()
          break
        case "rebuild":
          await handleTrayRebuild()
          break
        default:
          await startMenuBarAgent()
      }
      break
    }

    case "settings": {
      const cliArgs = process.argv.slice(3)
      // P0-2B: read-only WS pairing secret (first-run / re-pair display). The
      // secret is generated, not user-set, so it has no place in --set.
      if (cliArgs.includes("--ws-secret")) {
        const { getSharedSecretForDisplay } = await import("./ws-auth")
        process.stdout.write(getSharedSecretForDisplay() + "\n")
        process.exit(0)
      }
      const setFlags = cliArgs.filter((a) => a.startsWith("--set="))
      const hasSetStdin = cliArgs.includes("--set-stdin")
      if (setFlags.length > 0 || hasSetStdin) {
        await runNonInteractiveSettingsCli(cliArgs)
        process.exit(0)
      }
      // Interactive mode -> Web settings page
      try {
        const { startSettingsServer } = await import("./settings-web")
        const { port, token } = await startSettingsServer()
        const url = `http://127.0.0.1:${port}/settings?token=${token}`
        const platform = getPlatform()
        if (platform === "darwin") {
          child_process.execSync(`open "${url}"`, { stdio: "ignore" })
        } else if (platform === "linux") {
          child_process.execSync(`xdg-open "${url}"`, { stdio: "ignore" })
        } else if (platform === "win32") {
          try {
            child_process.spawn("explorer", [url], { detached: true, stdio: "ignore" }).unref()
          } catch {
            child_process.execSync(`cmd /c start "" "${url}"`, { stdio: "ignore" })
          }
        }
        console.log(`Settings page opened: ${url}`)
        console.log("Press Ctrl+C to stop the server")
        await new Promise(() => {})
      } catch (err: any) {
        console.error(`Failed to open web settings: ${err.message}`)
        console.log("Falling back to CLI settings...")
        await runInteractiveSettings()
        process.exit(0)
      }
      break
    }

    case "settings-ui":
    case "settings-web": {
      const { startSettingsServer } = await import("./settings-web")
      const port = await startSettingsServer()
      const url = `http://127.0.0.1:${port}/settings`
      const platform = getPlatform()
      if (platform === "darwin") {
        child_process.execSync(`open "${url}"`, { stdio: "ignore" })
      } else if (platform === "linux") {
        child_process.execSync(`xdg-open "${url}"`, { stdio: "ignore" })
      } else if (platform === "win32") {
        try {
          child_process.spawn("explorer", [url], { detached: true, stdio: "ignore" }).unref()
        } catch {
          child_process.execSync(`cmd /c start "" "${url}"`, { stdio: "ignore" })
        }
      }
      console.log(`Settings page: ${url}`)
      console.log("Press Ctrl+C to stop the server")
      await new Promise(() => {})
      break
    }

    case "settings-cli": {
      await runInteractiveSettings()
      process.exit(0)
    }

    case "menu-bar":
      console.warn("[cmspark-agent] 'menu-bar' 已弃用，请使用 'tray' 命令")
      await startMenuBarAgent()
      break

    case "--help":
    case "-h":
      printUsage()
      process.exit(0)

    case undefined:
      // In SEA (packaged exe): double-click → start tray directly
      // In dev mode: show CLI usage
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sea = require("node:sea") as { isSea?: () => boolean } | null
        if (sea?.isSea?.()) {
          await startMenuBarAgent()
          break
        }
      } catch { /* not in SEA mode */ }
      printUsage()
      process.exit(0)

    default:
      console.error(`Unknown command: ${command}`)
      printUsage()
      process.exit(1)
  }
}

// Global crash logger — write to file before exiting so hidden Windows processes
// leave diagnostics even without a console window
function writeCrashLog(label: string, err: unknown): void {
  try {
    const logDir = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".cmspark-agent", "logs")
    fs.mkdirSync(logDir, { recursive: true })
    const logFile = path.join(logDir, "crash.log")
    const ts = new Date().toISOString()
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    fs.appendFileSync(logFile, `[${ts}] ${label}: ${msg}\n`)
  } catch { /* nothing we can do */ }
  console.error(`[${label}]`, err)
}

process.on("uncaughtException", (err) => {
  writeCrashLog("uncaughtException", err)
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  writeCrashLog("unhandledRejection", reason)
})

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
