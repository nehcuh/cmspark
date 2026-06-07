// Menu Bar Agent — CLI-based interactive menu for CMspark Companion control
// Phase 1: Command-line menu with readline (minimal viable implementation)

import * as readline from "readline"
import * as child_process from "child_process"
import * as path from "path"
import * as os from "os"
import { isProcessRunning, readPidFile } from "./daemon"
import { getConfigDir, getPidFilePath } from "./config"

let menuInterval: NodeJS.Timeout | null = null
let rl: readline.Interface | null = null

function getCompanionPid(): number | null {
  return readPidFile(getPidFilePath())
}

function isCompanionRunning(): boolean {
  const pid = getCompanionPid()
  if (!pid) return false
  return isProcessRunning(pid)
}

function getLogDir(): string {
  return path.join(getConfigDir(), "logs")
}

function getLatestLogFile(): string | null {
  try {
    const logDir = getLogDir()
    const files = require("fs").readdirSync(logDir)
      .filter((f: string) => f.startsWith("companion-") && f.endsWith(".log"))
      .sort()
    if (files.length === 0) return null
    return path.join(logDir, files[files.length - 1])
  } catch {
    return null
  }
}

function printMenu() {
  const running = isCompanionRunning()
  const pid = getCompanionPid()
  const statusIcon = running ? "●" : "○"
  const statusText = running ? `运行中 (pid: ${pid})` : "已停止"

  console.clear()
  console.log("CMspark Agent Menu")
  console.log("==================")
  console.log("[1] 启动 Companion")
  console.log("[2] 停止 Companion")
  console.log("[3] 查看状态")
  console.log("[4] 查看日志")
  console.log("[5] 打开 Chrome Side Panel")
  console.log("[6] 退出")
  console.log("")
  console.log(`Companion 状态: ${statusIcon} ${statusText}`)
  console.log("WebSocket: ws://127.0.0.1:23401")
  console.log("")
  process.stdout.write("请选择操作: ")
}

function startCompanion(): void {
  if (isCompanionRunning()) {
    console.log("\nCompanion 已经在运行中")
    pauseAndContinue()
    return
  }
  console.log("\n正在启动 Companion...")
  try {
    const proc = child_process.spawn("node", [path.join(__dirname, "index.js"), "daemon", "start", "--daemonize"], {
      detached: true,
      stdio: "ignore",
    })
    proc.unref()
    console.log("Companion 守护进程已启动")
  } catch (err: any) {
    console.error("启动失败:", err.message)
  }
  pauseAndContinue()
}

function stopCompanion(): void {
  if (!isCompanionRunning()) {
    console.log("\nCompanion 未在运行")
    pauseAndContinue()
    return
  }
  console.log("\n正在停止 Companion...")
  try {
    child_process.execSync("node " + path.join(__dirname, "index.js") + " daemon stop", { timeout: 15000 })
    console.log("Companion 已停止")
  } catch (err: any) {
    console.error("停止失败:", err.message)
  }
  pauseAndContinue()
}

function showStatus(): void {
  const running = isCompanionRunning()
  const pid = getCompanionPid()
  console.log("\n--- 状态信息 ---")
  console.log(`Companion: ${running ? "运行中" : "已停止"}`)
  if (pid) console.log(`PID: ${pid}`)
  console.log(`WebSocket: ws://127.0.0.1:23401`)
  console.log(`数据目录: ${getConfigDir()}`)
  console.log(`日志目录: ${getLogDir()}`)
  console.log("----------------")
  pauseAndContinue()
}

function showLogs(): void {
  const logFile = getLatestLogFile()
  if (!logFile) {
    console.log("\n暂无日志文件")
    pauseAndContinue()
    return
  }
  console.log(`\n--- 最新日志 (${path.basename(logFile)}) ---`)
  try {
    const lines = require("fs").readFileSync(logFile, "utf-8").split("\n").filter((l: string) => l.trim())
    const tail = lines.slice(-20)
    for (const line of tail) {
      try {
        const entry = JSON.parse(line)
        console.log(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.event}`)
      } catch {
        console.log(line)
      }
    }
  } catch (err: any) {
    console.error("读取日志失败:", err.message)
  }
  console.log("----------------")
  pauseAndContinue()
}

function openSidePanel(): void {
  console.log("\n请手动打开 Chrome 扩展的 Side Panel")
  console.log("chrome-extension://<id>/sidepanel.html")
  pauseAndContinue()
}

function pauseAndContinue(): void {
  console.log("")
  process.stdout.write("按 Enter 继续...")
  if (rl) {
    rl.once("line", () => {
      printMenu()
    })
  }
}

export function startMenuBarAgent(): void {
  if (rl) {
    console.log("菜单栏代理已在运行")
    return
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Status polling every 5 seconds (just refreshes display if menu is showing)
  menuInterval = setInterval(() => {
    // No-op for now; menu redraws on next user interaction
  }, 5000)

  printMenu()

  rl.on("line", (input) => {
    const choice = input.trim()
    switch (choice) {
      case "1":
        startCompanion()
        break
      case "2":
        stopCompanion()
        break
      case "3":
        showStatus()
        break
      case "4":
        showLogs()
        break
      case "5":
        openSidePanel()
        break
      case "6":
      case "q":
      case "quit":
        stopMenuBarAgent()
        break
      default:
        console.log("\n无效选择，请重新输入")
        pauseAndContinue()
    }
  })

  rl.on("close", () => {
    stopMenuBarAgent()
  })
}

export function stopMenuBarAgent(): void {
  if (menuInterval) {
    clearInterval(menuInterval)
    menuInterval = null
  }
  if (rl) {
    rl.close()
    rl = null
  }
  console.log("\n菜单栏代理已退出")
  process.exit(0)
}
