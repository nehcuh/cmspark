import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MiniProfileLock } from "./profile-lock"
import { isMiniCapture, type MiniAction, type MiniTiming } from "./actions"

export type DesktopMiniAction = MiniAction | "chat"
type Host = { show(): Promise<void>; hide(): void; stop(): Promise<void> }

/** Native hosts own placement; the same preference and action lifecycle serve macOS and Linux. */
export class DesktopMini {
  private readonly lock: MiniProfileLock
  private readonly hidden: string
  private visible = false
  private stopped = false
  private active?: AbortController
  private changes = Promise.resolve()

  constructor(private readonly dir: string, private readonly host: Host,
    private readonly run: (action: DesktopMiniAction, signal: AbortSignal, timing?: MiniTiming) => Promise<void>,
    private readonly menu: (visible: boolean) => void, private readonly notify: (text: string) => void,
    private readonly restoreAfterCapture?: () => void) {
    this.lock = new MiniProfileLock(dir)
    this.hidden = join(dir, "mini-hidden")
  }

  start(): Promise<void> { return this.change(false) }
  toggle(): Promise<void> { return this.change(true) }

  private change(toggle: boolean): Promise<void> {
    const next = this.changes.then(async () => {
      if (this.stopped) return
      if (!await this.lock.acquire()) {
        if (toggle) this.notify("另一个 CMspark 托盘正在管理此配置的 Mini")
        return
      }
      if (this.stopped) return
      const show = toggle ? !this.visible : !existsSync(this.hidden)
      if (show) {
        await this.host.show()
        if (this.stopped) return
        if (toggle) rmSync(this.hidden, { force: true })
      } else {
        if (toggle) {
          mkdirSync(this.dir, { recursive: true, mode: 0o700 })
          writeFileSync(this.hidden, "", { mode: 0o600 })
        }
        this.active?.abort()
        this.host.hide()
      }
      this.visible = show
      this.menu(show)
    }).catch((err: Error) => this.notify(err.message || "无法显示 Mini 桌面小球"))
    this.changes = next
    return next
  }

  closed(message?: string): void {
    this.visible = false
    this.menu(false)
    this.active?.abort()
    if (message && !this.stopped) this.notify(message)
  }

  async perform(action: DesktopMiniAction, timing?: MiniTiming): Promise<void> {
    if (!this.visible || this.stopped || this.active) return
    const current = this.active = new AbortController()
    try { await this.run(action, current.signal, timing) }
    catch (err) {
      if (!current.signal.aborted) this.notify(err instanceof Error ? err.message : "快速操作失败")
    } finally {
      this.active = undefined
      if (this.visible && !this.stopped && !current.signal.aborted && action !== "chat" && isMiniCapture(action)) this.restoreAfterCapture?.()
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.active?.abort()
    try { await this.host.stop(); await this.changes }
    finally { await this.lock.release() }
  }
}
