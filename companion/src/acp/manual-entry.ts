// UI-only text preparation. No prompt, env, task file, subprocess or native terminal operation.
import * as fs from "fs"
import * as path from "path"
import { LAUNCH_PRESETS } from "./launch-presets"
import { buildInteractiveExecFragment, buildWindowsCommandLine, shellSingleQuote } from "./open-local-terminal"
import { retainTerminalCommandLine } from "./progress-caps"

export type ManualEntryLaunch = Readonly<{
  executable: string; cwd: string; kind: string; platform: NodeJS.Platform
  realExecutable: string; realCwd: string; identity: string; cwdIdentity: string
}> | Readonly<{ error: string }>

function fileIdentity(file: string): string {
  const st = fs.statSync(file)
  if (!st.isFile()) throw new Error("not a file")
  return [st.dev, st.ino, st.size, st.mtimeMs].join(":")
}
function directoryIdentity(dir: string): string {
  const st = fs.statSync(dir)
  if (!st.isDirectory()) throw new Error("not a directory")
  // Directory contents may change; only replacement invalidates launch ownership.
  return [st.dev, st.ino].join(":")
}
export function manualEntryPathsSafe(executable: string, cwd: string, platform: NodeJS.Platform): boolean {
  // Existing POSIX builder's apostrophe escaping is not safe; decline rather than broaden it.
  const unsafe = platform === "win32" ? /[\x00-\x1f\x7f'"&|<>^%!]/ : /[\x00-\x1f\x7f']/
  const paths = platform === "win32" ? path.win32 : path.posix
  return paths.isAbsolute(executable) && paths.isAbsolute(cwd) && !unsafe.test(executable) && !unsafe.test(cwd)
}

/** Called ONLY after the actual CLI child emits successful spawn, with its captured start inputs. */
export function captureManualEntryLaunch(input: { agentId: string; command: string; cwd: string; args?: string[] }): ManualEntryLaunch {
  const platform = process.platform
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") return Object.freeze({ error: "此平台尚无经过验证的交互启动命令。" })
  const basename = path.basename(input.command).toLowerCase()
  const expected = platform === "win32" ? basename.replace(/\.(exe|cmd|bat|com)$/, "") : basename
  if (!Object.hasOwn(LAUNCH_PRESETS, input.agentId) || expected !== input.agentId || (input.args?.length ?? 0) !== 0)
    return Object.freeze({ error: "此启动器或自定义参数没有经过交互入口验证；无法提供新启动命令。" })
  if (!manualEntryPathsSafe(input.command, input.cwd, platform)) return Object.freeze({ error: "启动路径包含无法安全引用的字符；无法提供交互命令。" })
  try {
    const realExecutable = fs.realpathSync(input.command), realCwd = fs.realpathSync(input.cwd)
    fs.accessSync(input.command, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK)
    return Object.freeze({ executable: input.command, cwd: input.cwd, kind: input.agentId, platform,
      realExecutable, realCwd, identity: fileIdentity(realExecutable), cwdIdentity: directoryIdentity(realCwd) })
  } catch { return Object.freeze({ error: "未能验证实际启动程序或工作区；无法提供交互命令。" }) }
}

export function prepareManualEntry(launch: ManualEntryLaunch | undefined):
  { ok: true; commandLine: string; shell: "cmd.exe" | "POSIX sh" } | { ok: false; error: string } {
  if (!launch) return { ok: false, error: "此会话没有已验证的 CLI 启动记录；无法提供交互入口。" }
  if ("error" in launch) return { ok: false, error: launch.error }
  try {
    if (fs.realpathSync(launch.executable) !== launch.realExecutable || fs.realpathSync(launch.cwd) !== launch.realCwd ||
        fileIdentity(launch.realExecutable) !== launch.identity || directoryIdentity(launch.realCwd) !== launch.cwdIdentity) throw new Error("identity changed")
    fs.accessSync(launch.executable, launch.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK)
  } catch { return { ok: false, error: "实际启动程序或工作区已删除或发生变化；请重新启动会话后再准备入口。" } }
  const line = launch.platform === "win32"
    ? buildWindowsCommandLine(launch.cwd, launch.executable)
    : `cd ${shellSingleQuote(launch.cwd)} && ${buildInteractiveExecFragment({ command: launch.executable, agentId: launch.kind })}`
  const commandLine = retainTerminalCommandLine(line)
  if (!commandLine) return { ok: false, error: "交互启动命令超出可安全复制的长度。" }
  return { ok: true, commandLine, shell: launch.platform === "win32" ? "cmd.exe" : "POSIX sh" }
}
