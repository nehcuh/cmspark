import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { getAppRoot, getAssetsDir } from "../paths"
import { parseMiniInvocation, isMiniCapture, type MiniAction, type MiniTiming } from "./actions"

type Action = MiniAction | "chat"

export function linuxMiniScript(name: "linux-mini-orb.py" | "linux-mini-region.py"): string {
  const root = getAppRoot()
  return [join(__dirname, name), join(root, name), join(root, "src", "mini", name)]
    .find(existsSync) ?? join(root, name)
}

/** GTK owns the mapped window. The tray owns the user's visibility preference. */
export class LinuxMiniHost {
  private child?: ChildProcessWithoutNullStreams
  private exited?: Promise<void>
  private wanted = false
  private mapped = false
  private stopped = false
  private showing?: Promise<void>
  private waiting?: { resolve: () => void, reject: (error: Error) => void }

  constructor(private readonly dir: string,
    private readonly onAction: (action: Action, timing?: MiniTiming) => Promise<void>,
    private readonly onClosed: (message?: string) => void) {}

  show(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Mini 已关闭"))
    this.wanted = true
    if (this.mapped) return Promise.resolve()
    if (this.showing) return this.showing
    if (!this.child) this.start()
    this.showing = new Promise<void>((resolve, reject) => { this.waiting = { resolve, reject } })
    this.command("show")
    return this.showing
  }

  hide(): void {
    this.wanted = false
    this.mapped = false
    this.command("hide")
    this.waiting?.reject(new Error("Mini 已隐藏"))
    this.waiting = undefined
    this.showing = undefined
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.hide()
    this.command("quit")
    await this.exited
  }

  private command(value: string): void {
    if (this.child?.stdin.writable) this.child.stdin.write(value + "\n")
  }

  private start(): void {
    const child = spawn("/usr/bin/python3", [linuxMiniScript("linux-mini-orb.py"),
      join(this.dir, "linux-mini-position.json"), join(getAssetsDir(), "cmspark.png")], { stdio: "pipe" })
    this.child = child
    this.exited = new Promise(resolve => child.once("close", () => resolve()))
    let detail = ""
    child.stdin.on("error", () => { /* The close handler reports launch and pipe failures. */ })
    child.on("error", error => { detail = error.message })
    child.stderr.on("data", data => { detail = (detail + data.toString()).slice(-700) })
    const lines = createInterface({ input: child.stdout })
    lines.on("line", line => {
      if (child !== this.child || !this.wanted) return
      if (line === "shown") {
        this.mapped = true
        this.waiting?.resolve()
        this.waiting = undefined
        this.showing = undefined
      } else if (line.startsWith("action:")) {
        const invocation = parseMiniInvocation(line.slice(7))
        if (invocation) void this.dispatch(invocation.action, child, invocation.timing)
      }
    })
    child.once("close", () => {
      lines.close()
      this.child = undefined
      this.mapped = false
      const message = detail.trim().split("\n").pop() || "Linux Mini 窗口已关闭"
      if (this.waiting) this.waiting.reject(new Error(message))
      else if (this.wanted && !this.stopped) this.onClosed(message)
      this.waiting = undefined
      this.showing = undefined
    })
  }

  private async dispatch(action: Action, child: ChildProcessWithoutNullStreams, timing?: MiniTiming): Promise<void> {
    const restore = action !== "chat" && isMiniCapture(action)
    if (restore) this.mapped = false
    try {
      await this.onAction(action, timing)
    } catch (error) {
      console.warn("[mini] Linux action failed:", error)
    } finally {
      if (restore && this.wanted && !this.stopped && child === this.child) this.command("show")
    }
  }
}
