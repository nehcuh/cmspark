import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { windowsPowerShellExePath } from "../acp/win-spawn"
import { validatePng } from "../activity/image"
import { resolveWinScript } from "../host-use/win/powershell"

const run = promisify(execFile)
const maxPngBytes = 6 * 1024 * 1024

/** The Mini host hides its own window before opening the picker. Only an accepted crop leaves the helper. */
export async function captureMiniRegion(signal?: AbortSignal): Promise<Buffer | null> {
  if (process.platform !== "win32") throw new Error("屏幕区域选择需要 Windows 桌面")
  if (signal?.aborted) return null
  try {
    const { stdout } = await run(windowsPowerShellExePath(), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", resolveWinScript("mini-region.ps1"), "-OwnerPid", String(process.pid),
    ], { windowsHide: true, encoding: "buffer", maxBuffer: maxPngBytes, signal })
    if (signal?.aborted || !stdout.length) return null
    validatePng(stdout)
    return stdout
  } catch (error) {
    if (signal?.aborted) return null
    if ((error as { stderr?: Buffer }).stderr?.toString("utf8").includes("MINI_REGION_TOO_LARGE"))
      throw new Error("截图区域过大，请缩小范围（最多 8192 像素宽或高、1600 万像素、6 MiB）")
    throw new Error("无法读取所选屏幕区域，请检查 Windows 桌面后重试")
  }
}
