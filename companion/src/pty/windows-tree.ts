import { spawn } from "child_process"
import { windowsTaskkillPath } from "../acp/win-spawn"

/** Keep the root alive until taskkill has enumerated its children. Killing the
 * ConPTY handle first can orphan them before /T walks the process tree. */
export function killWindowsPtyTree(pid: number, releaseHandle: () => void, spawnFn: typeof spawn = spawn): void {
  let released = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const release = () => {
    if (released) return
    released = true
    clearTimeout(timer)
    try { releaseHandle() } catch { /* already exited */ }
  }
  try {
    const child = spawnFn(windowsTaskkillPath(), ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore", windowsHide: true,
    })
    // ENOENT/EACCES arrive asynchronously. Never retry the numeric PID later.
    child.on("error", release)
    child.once("close", release)
    timer = setTimeout(() => {
      try { child.kill() } catch { /* gone */ }
      release()
    }, 5_000)
    timer.unref()
  } catch { release() }
}
