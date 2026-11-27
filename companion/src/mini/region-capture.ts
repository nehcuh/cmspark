import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as wait } from "node:timers/promises"
import { promisify } from "node:util"
import { windowsPowerShellExePath } from "../acp/win-spawn"
import { validatePng } from "../activity/image"
import { resolveWinScript } from "../host-use/win/powershell"
import type { MiniTiming } from "./actions"
import { linuxMiniScript } from "./linux-mini"

const run = promisify(execFile)
const maxPngBytes = 6 * 1024 * 1024

const tooLarge = "截图区域过大，请缩小范围（最多 8192 像素宽或高、1600 万像素、6 MiB）"

async function captureMacRegion(signal?: AbortSignal, timing?: MiniTiming): Promise<Buffer | null> {
  if (timing) {
    if (!timing.region) throw new Error("请先框选延时截图区域")
    try {
      await wait(timing.seconds * 1000, undefined, { signal })
    } catch (error) {
      if (signal?.aborted) return null
      throw error
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "cmspark-mini-"))
  const file = join(dir, "region.png")
  try {
    try {
      await run("/usr/sbin/screencapture", [...(timing ? ["-R" + timing.region] : ["-i", "-s"]), "-x", "-tpng", file], { signal })
    } catch (error) {
      const e = error as { code?: number; stderr?: string }
      if (signal?.aborted || (e.code === 1 && !e.stderr?.trim())) return null
      throw new Error("无法框选屏幕，请检查 macOS 系统设置中的屏幕录制权限。")
    }
    if (signal?.aborted) return null
    const size = await stat(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null
      throw err
    })
    if (!size?.size) return null
    if (size.size > maxPngBytes) throw new Error(tooLarge)
    const image = await readFile(file)
    validatePng(image)
    return image
  } finally { await rm(dir, { recursive: true, force: true }) }
}

/** The Mini host hides its own window before opening the picker. Only an accepted crop leaves the helper. */
export async function captureMiniRegion(signal?: AbortSignal, timing?: MiniTiming): Promise<Buffer | null> {
  if (signal?.aborted) return null
  if (process.platform === "darwin") return captureMacRegion(signal, timing)
  if (process.platform !== "win32" && process.platform !== "linux") throw new Error("此系统不支持桌面框选")
  const linux = process.platform === "linux"
  try {
    const { stdout } = await run(linux ? "/usr/bin/python3" : windowsPowerShellExePath(), linux ? [linuxMiniScript("linux-mini-region.py"), String(timing?.seconds ?? 0)] : [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", resolveWinScript("mini-region.ps1"), "-OwnerPid", String(process.pid), "-DelaySeconds", String(timing?.seconds ?? 0),
    ], { windowsHide: true, encoding: "buffer", maxBuffer: maxPngBytes, signal })
    if (signal?.aborted || !stdout.length) return null
    validatePng(stdout)
    return stdout
  } catch (error) {
    if (signal?.aborted) return null
    if ((error as { stderr?: Buffer }).stderr?.toString("utf8").includes("MINI_REGION_TOO_LARGE"))
      throw new Error(tooLarge)
    if (linux) throw new Error("无法打开截图选区。请检查 GTK 3 图形桌面；Wayland 还需启用桌面截屏门户。")
    throw new Error("无法读取所选屏幕区域，请检查 Windows 桌面后重试")
  }
}
