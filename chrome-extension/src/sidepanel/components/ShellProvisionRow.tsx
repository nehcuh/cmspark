/** Read-only shell qualification. Refresh lists modules; it does not write config. */
export type ShellProvisionRowView = "provided" | "community" | "unavailable" | "unknown" | "missing"

export function ShellProvisionRow({ view, onOpenProfile }: { view: ShellProvisionRowView; onOpenProfile?: () => void }) {
  if (view === "missing") return null
  if (view === "provided") return <div>shell 已由 enterprise 档提供。执行命令仍需单独确认。</div>
  if (view === "unavailable") return <div>shell 模块不可用。这不是未开启的电源。</div>
  if (view === "unknown") {
    return <div>shell 提供状态未知。请刷新本机能力列表，不要再次切换相同档位。<button type="button" onClick={() => chrome.runtime.sendMessage({ type: "modules.list" })}>刷新本机能力列表</button></div>
  }
  return <div>shell 随 enterprise 档提供。确认升档后可用。<button type="button" onClick={() => onOpenProfile?.()}>前往能力档确认升档</button></div>
}
