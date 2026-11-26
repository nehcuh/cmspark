import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { resolvePowerShellExe, resolveWinScript } from "../host-use/win/powershell"
import { isMiniAction, type MiniAction } from "./actions"
import { MiniChat } from "./chat"
import { MiniProfileLock } from "./profile-lock"
import { WindowsMiniHotkeys, type MiniHotkey } from "./windows-hotkeys"

export class WindowsMini {
  private child?: ChildProcessWithoutNullStreams
  private enabled = false
  private ready = false
  private retiring?: Promise<void>
  private action?: AbortController
  private chat?: AbortController
  private conversation = new MiniChat()
  private readonly hotkeys: WindowsMiniHotkeys
  private readonly profileLock: MiniProfileLock
  private initialized = false
  private pendingHotkey?: MiniHotkey
  private stopped = false

  constructor(private readonly dir: string,
    private readonly run: (action: MiniAction, signal: AbortSignal) => Promise<void>,
    private readonly visible: (value: boolean) => void,
    private readonly notify: (message: string) => void) {
    this.profileLock = new MiniProfileLock(dir)
    this.hotkeys = new WindowsMiniHotkeys(dir, key => { void this.invokeHotkey(key) },
      pid => this.dispatchPending(pid), notify)
  }

  async start(): Promise<void> {
    await this.claimProfile(false)
  }

  private async claimProfile(fromMenu: boolean): Promise<boolean> {
    if (this.stopped) return false
    if (this.initialized) return true
    const acquired = await this.profileLock.acquire()
    if (this.stopped) return false
    if (!acquired) {
      this.visible(false)
      if (fromMenu) this.notify("另一个 CMspark 托盘正在管理此配置的 Mini。请从该托盘操作。")
      return false
    }
    if (!this.initialized) {
      this.enabled = !existsSync(join(this.dir, "mini-hidden"))
      if (this.enabled) this.startHost()
      this.hotkeys.start()
      this.initialized = true
    }
    return true
  }

  async openHotkeySettings(): Promise<void> {
    if (await this.claimProfile(true)) this.hotkeys.settings()
  }

  private async invokeHotkey(key: MiniHotkey): Promise<void> {
    if (this.retiring) await this.retiring
    if (this.stopped || this.action) return
    // A hidden orb is unnecessary for Chrome destinations and native region selection.
    if (!this.enabled && !this.child && key !== "chat" && key !== "shot") {
      await this.perform(key)
      return
    }
    this.startHost()
    this.pendingHotkey = key
    if (this.ready && this.child?.pid) this.dispatchPending(this.child.pid)
  }

  private dispatchPending(pid: number): void {
    if (!this.ready || this.child?.pid !== pid || !this.pendingHotkey) return
    this.command("invoke:" + this.pendingHotkey)
    this.pendingHotkey = undefined
  }

  async toggle(): Promise<void> {
    const takingOver = !this.initialized
    if (!await this.claimProfile(true)) return
    if (takingOver && this.enabled) return
    const hidden = join(this.dir, "mini-hidden")
    if (this.enabled) {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(hidden, "", { mode: 0o600 })
      this.enabled = false
      this.pendingHotkey = undefined
      this.cancel()
      this.visible(false)
      await this.stopHost()
    } else {
      rmSync(hidden, { force: true })
      this.enabled = true
      if (this.retiring) await this.retiring
      if (this.enabled && !this.stopped) {
        this.startHost()
        this.command("show")
        if (this.ready) this.visible(true)
      }
    }
  }

  private startHost(): void {
    if (this.child) return
    mkdirSync(this.dir, { recursive: true })
    const child = spawn(resolvePowerShellExe(), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", resolveWinScript("mini-orb.ps1"),
    ], { stdio: "pipe", windowsHide: true, env: {
      ...process.env, CMSPARK_MINI_POSITION_FILE: join(this.dir, "mini-position.json"),
      CMSPARK_MINI_TEMPORARY: this.enabled ? "0" : "1",
    } })
    this.child = child
    this.hotkeys.setOrbPid(child.pid)
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
      this.hotkeys.setOrbPid()
      this.pendingHotkey = undefined
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
      this.visible(this.enabled)
      const pid = this.child?.pid
      if (!pid || !this.pendingHotkey) return
      // USER32 can reject a newly spawned PID until WPF creates its first window.
      // Let the shortcut owner finish the targeted grant before opening the input UI.
      const needsFocus = this.pendingHotkey === "chat" || this.pendingHotkey === "shot"
      if (!needsFocus || !this.hotkeys.prepareForeground(pid)) this.dispatchPending(pid)
      return
    }
    if (!this.ready) return
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
      const key = line.slice(7)
      if (isMiniAction(key)) void this.perform(key)
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
      if (!current.signal.aborted) {
        const message = detail && detail.length <= 180 ? detail :
          "未能打开快速操作。请确认 Companion 和 Chrome 扩展已连接后重试。"
        if (this.enabled) this.command("notice", message)
        else this.notify(message)
      }
    } finally {
      if (this.action === current) {
        this.action = undefined
        if (this.enabled) this.command("show")
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.enabled = false
    this.pendingHotkey = undefined
    this.cancel()
    try {
      await Promise.all([this.hotkeys.stop(), this.stopHost()])
    } finally {
      await this.profileLock.release()
    }
  }

  private stopHost(): Promise<void> {
    if (this.retiring) return this.retiring
    const child = this.child
    if (!child) return Promise.resolve()
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()))
    this.command("quit")
    child.stdin.end()
    this.child = undefined
    this.hotkeys.setOrbPid()
    this.ready = false
    const timer = setTimeout(() => child.kill(), 1500)
    this.retiring = closed.finally(() => { clearTimeout(timer); this.retiring = undefined })
    return this.retiring
  }
}
