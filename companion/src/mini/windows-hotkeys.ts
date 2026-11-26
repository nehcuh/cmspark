import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { resolvePowerShellExe, resolveWinScript } from "../host-use/win/powershell"
import { isMiniAction, type MiniAction } from "./actions"

export type MiniHotkey = MiniAction | "chat" | "shot"

/** The message window owns its registrations even while the desktop orb is hidden. */
export class WindowsMiniHotkeys {
  private readonly file: string
  private child?: ChildProcessWithoutNullStreams
  private orbPid = 0

  constructor(dir: string, private readonly invoke: (action: MiniHotkey) => void,
    private readonly foregroundReady: (pid: number) => void,
    private readonly notify: (message: string) => void) {
    this.file = join(dir, "mini-hotkeys.json")
  }

  start(): void {
    if (existsSync(this.file)) this.getHost()
  }

  settings(): void {
    this.getHost().stdin.write("settings\n")
  }

  setOrbPid(pid = 0): void {
    this.orbPid = pid
    if (this.child?.stdin.writable) this.child.stdin.write(`orb-pid:${pid}\n`)
  }

  prepareForeground(pid: number): boolean {
    if (this.orbPid !== pid || !this.child?.stdin.writable) return false
    this.child.stdin.write(`orb-ready:${pid}\n`)
    return true
  }

  private getHost(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn(resolvePowerShellExe(), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", resolveWinScript("mini-hotkeys.ps1"),
    ], { stdio: "pipe", windowsHide: true, env: { ...process.env, CMSPARK_MINI_HOTKEYS_FILE: this.file } })
    this.child = child
    child.stdin.on("error", () => { /* close reports a lost host */ })
    child.stderr.resume()
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
    let unavailable = false
    reader.on("line", line => {
      if (this.child !== child) return
      if (line === "ready") this.setOrbPid(this.orbPid)
      else if (line === "conflict") this.notify("部分 Mini 快捷键已被占用。请在托盘的「Mini 快捷键设置」中查看。")
      else if (line === "unavailable") {
        unavailable = true
        this.notify("此配置的快捷键已由另一个 CMspark 托盘管理。")
      } else if (line === "orb-ready:" + this.orbPid) {
        this.foregroundReady(this.orbPid)
      } else if (line.startsWith("action:")) {
        const action = line.slice(7)
        if (action === "chat" || action === "shot" || isMiniAction(action)) this.invoke(action)
      }
    })
    child.once("error", error => console.warn("[mini] Windows hotkey host unavailable:", error.message))
    child.once("close", () => {
      reader.close()
      if (this.child !== child) return
      this.child = undefined
      this.foregroundReady(this.orbPid)
      if (!unavailable) this.notify("快捷键服务已退出。请从托盘打开「Mini 快捷键设置」以重新启用。")
    })
    return child
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.child = undefined
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()))
    if (child.stdin.writable) child.stdin.end("quit\n")
    const timer = setTimeout(() => child.kill(), 1500)
    try { await closed } finally { clearTimeout(timer) }
  }
}
