import { randomBytes } from "node:crypto"
import { DesktopIdentityRegistry } from "./identity"
import { resolveDesktopNative } from "./native-artifacts"
export type DesktopView = "compact" | "workspace"
export type DesktopNativeChild = { terminate(): void }
export type DesktopNativeBinding = { launch(binary: string, capabilityId: string, secret: string, endpoint: string, onExit: (code: number) => void): DesktopNativeChild }
type State = { host: string; capability: string; child?: DesktopNativeChild; ready: boolean; resolve: (v: boolean) => void; promise: Promise<boolean>; timer: NodeJS.Timeout }
/** Daemon-only issuer. The renderer never imports or receives this object. */
export class DesktopHostLauncher {
  private current?: State
  constructor(private readonly registry: DesktopIdentityRegistry, private readonly endpoint: string,
    private readonly window: (host: string, view: DesktopView) => boolean,
    private readonly native: () => { binding: DesktopNativeBinding; binary: string } = resolveDesktopNative) {}
  authenticated(host: string): void { const s = this.current; if (s?.host === host) { s.ready = true; clearTimeout(s.timer); s.resolve(true) } }
  async open(view: DesktopView): Promise<Record<string, unknown>> {
    if (view !== "compact" && view !== "workspace") return { type: "desktop.open.result", ok: false, error_code: "DESKTOP_VIEW_INVALID" }
    let s = this.current
    if (!s) {
      // Integrity failure occurs before issuance; one synchronous section owns launch.
      let resolved: ReturnType<typeof this.native>
      try { resolved = this.native() } catch { return { type: "desktop.open.result", ok: false, error_code: "DESKTOP_NATIVE_UNAVAILABLE" } }
      const host = randomBytes(16).toString("hex")
      const boot = this.registry.issue(host)
      let finish!: (v: boolean) => void
      const promise = new Promise<boolean>(r => { finish = r })
      const timer = setTimeout(() => this.retire(host), 30_000)
      s = { host, capability: boot.capabilityId, ready: false, resolve: finish, promise, timer }
      this.current = s
      try { s.child = resolved.binding.launch(resolved.binary, boot.capabilityId, boot.secret, this.endpoint, () => this.retire(host)) }
      catch { this.retire(host) }
    }
    if (!await s.promise || this.current !== s || !this.window(s.host, view)) return { type: "desktop.open.result", ok: false, error_code: "DESKTOP_DISCONNECTED" }
    return { type: "desktop.open.result", ok: true, state: "ready", view }
  }
  private retire(host: string): void {
    const s = this.current; if (!s || s.host !== host) return
    this.current = undefined; clearTimeout(s.timer); this.registry.revoke(s.capability); s.resolve(false)
    // The native binding owns a real process object, never a caller-supplied PID.
    try { s.child?.terminate() } catch { /* already exited */ }
  }
  close(): void { const s = this.current; if (s) this.retire(s.host) }
}
