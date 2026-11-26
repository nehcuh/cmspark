import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { resolvePowerShellExe, resolveWinScript } from "../host-use/win/powershell"
import type { MiniAction } from "./actions"
import { MiniChat } from "./chat"

const actions = new Set<MiniAction>(["search", "todo", "ask", "ocr", "capture"])

export class WindowsMini {
  private child?: ChildProcessWithoutNullStreams
  private enabled = false
  private ready = false
  private retiring?: Promise<void>
  private action?: AbortController
  private chat?: AbortController
  private conversation = new MiniChat()

  constructor(private readonly dir: string,
    private readonly run: (action: MiniAction, signal: AbortSignal) => Promise<void>,
    private readonly visible: (value: boolean) => void) {}

  start(): void {
    if (!existsSync(join(this.dir, "mini-hidden"))) this.enable()
  }

  async toggle(): Promise<void> {
    const hidden = join(this.dir, "mini-hidden")
    if (this.enabled) {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(hidden, "", { mode: 0o600 })
      this.enabled = false
      this.cancel()
      this.visible(false)
      await this.stopHost()
    } else {
      rmSync(hidden, { force: true })
      this.enabled = true
      if (this.retiring) await this.retiring
      if (this.enabled && !this.child) this.enable()
    }
  }

  private enable(): void {
    if (this.child) return
    mkdirSync(this.dir, { recursive: true })
    const child = spawn(resolvePowerShellExe(), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", resolveWinScript("mini-orb.ps1"),
    ], { stdio: "pipe", windowsHide: true, env: {
      ...process.env, CMSPARK_MINI_POSITION_FILE: join(this.dir, "mini-position.json"),
    } })
    this.child = child
    this.enabled = true
    this.ready = false
    this.conversation = new MiniChat()
    child.stdin.on("error", () => { /* close retires pending work */ })
    child.stderr.resume()
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
    reader.on("line", (line: string) => { if (this.child === child) this.receive(line) })
    child.on("error", error => console.warn("[mini] Windows host unavailable:", error.message))
    child.once("close", code => {
      reader.close()
      if (this.child !== child) return
      const unexpected = this.enabled
      this.child = undefined
      this.ready = false
      this.enabled = false
      this.cancel()
      this.visible(false)
      if (unexpected) console.warn("[mini] Windows host exited:", code)
    })
  }

  private command(command: string, text?: string): void {
    if (!this.child?.stdin.writable) return
    const data = text === undefined ? command : command + ":" + Buffer.from(text, "utf8").toString("base64")
    this.child.stdin.write(data + "\n")
  }

  private cancel(): void {
    this.action?.abort()
    this.action = undefined
    this.chat?.abort()
    this.chat = undefined
  }

  private receive(line: string): void {
    if (line === "ready") {
      this.ready = true
      if (!this.enabled) this.command("hide")
      this.visible(this.enabled)
      return
    }
    if (!this.enabled || !this.ready) return
    if (line === "chat-close") {
      this.chat?.abort()
      this.chat = undefined
    } else if (line.startsWith("say:") && !this.chat) {
      const data = line.slice(4)
      if (data.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        this.command("error", "消息格式无效，请重试。")
        return
      }
      void this.reply(Buffer.from(data, "base64").toString("utf8"))
    } else if (line.startsWith("action:") && !this.action) {
      const key = line.slice(7) as MiniAction
      if (actions.has(key)) void this.perform(key)
    }
  }

  private async reply(text: string): Promise<void> {
    const current = this.chat = new AbortController()
    try {
      const answer = await this.conversation.reply(text, current.signal)
      if (!current.signal.aborted) this.command("reply", answer)
    } catch {
      if (!current.signal.aborted) this.command("error", "主模型未能回复。请检查模型设置和连接后重试。")
    } finally {
      if (this.chat === current) this.chat = undefined
    }
  }

  private async perform(key: MiniAction): Promise<void> {
    const current = this.action = new AbortController()
    try {
      await this.run(key, current.signal)
    } catch (error) {
      const detail = error instanceof Error ? error.message : ""
      if (!current.signal.aborted) this.command("notice", detail && detail.length <= 180 ? detail :
        "未能打开快速操作。请确认 Companion 和 Chrome 扩展已连接后重试。")
    } finally {
      if (this.action === current) {
        this.action = undefined
        if (this.enabled) this.command("show")
      }
    }
  }

  async stop(): Promise<void> {
    this.enabled = false
    this.cancel()
    await this.stopHost()
  }

  private stopHost(): Promise<void> {
    if (this.retiring) return this.retiring
    const child = this.child
    if (!child) return Promise.resolve()
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()))
    this.command("quit")
    child.stdin.end()
    this.child = undefined
    this.ready = false
    const timer = setTimeout(() => child.kill(), 1500)
    this.retiring = closed.finally(() => { clearTimeout(timer); this.retiring = undefined })
    return this.retiring
  }
}
