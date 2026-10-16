// Test-owned observation only. These records never join protocol stdio,
// process identity, target environment or an authorization decision.
import fs from "node:fs"
import path from "node:path"
import type { TestContext } from "node:test"
import { windowsPowerShellExePath } from "../../src/acp/win-spawn"

const childProcess: typeof import("node:child_process") = require("node:child_process")
export const WINDOWS_JOB_PHASES = ["wrapper_entered", "before_add_type", "after_add_type", "before_run"] as const
const LIMIT = 4096
const FILE = "windows-job-phases-650.jsonl"
type Phase = typeof WINDOWS_JOB_PHASES[number]
type Record = { phase: Phase; elapsed_ms: number }
export type PhaseSnapshot = {
  capture_state: "empty" | "partial" | "complete" | "missing" | "unsafe" | "oversize" | "malformed" | "unavailable"
  records: Record[]
}

export const quoteWindowsJobPhaseLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'"
function once(source: string, needle: string): void {
  if (source.split(needle).length !== 2) throw Error("OWNED_PHASE_BOOTSTRAP_SEAM_INVALID")
}

export function createWindowsJobPhaseDiagnostics(root: string) {
  const directory = fs.lstatSync(root, { bigint: true })
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error("OWNED_PHASE_ROOT_INVALID")
  const ownedRoot = fs.realpathSync(root), file = path.join(ownedRoot, FILE)
  const fd = fs.openSync(file, "wx", 0o600)
  const identity = fs.fstatSync(fd, { bigint: true })
  fs.closeSync(fd)
  if (!identity.isFile() || identity.nlink !== 1n) throw Error("OWNED_PHASE_FILE_INVALID")

  // Open, never create a replacement. This is an inert owned fixture, not a
  // cross-process defense against a malicious same-UID path-replacement race.
  // JS snapshots reject identity/link drift; no secret or authority uses this file.
  const observer = `
# CMSPARK_650_PHASE_BEGIN
$script:__cm650Clock=[Diagnostics.Stopwatch]::StartNew(); $script:__cm650Count=0;
function __CmsparkPhase650([string]$phase) {
  $stream=$null;
  try {
    if($script:__cm650Count -ge 4 -or $phase -notin @('wrapper_entered','before_add_type','after_add_type','before_run')) { return };
    if(([IO.File]::GetAttributes(${quoteWindowsJobPhaseLiteral(file)}) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return };
    $stream=[IO.File]::Open(${quoteWindowsJobPhaseLiteral(file)},[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::Read);
    $record='{"phase":"'+$phase+'","elapsed_ms":'+$script:__cm650Clock.ElapsedMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture)+'}'+[Environment]::NewLine;
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes($record);
    if($stream.Length -gt 4096 -or $stream.Length+$bytes.Length -gt 4096) { return };
    [void]$stream.Seek(0,[IO.SeekOrigin]::End); $stream.Write($bytes,0,$bytes.Length); $stream.Flush(); $script:__cm650Count++;
  } catch {} finally { if($null -ne $stream) { try { $stream.Dispose() } catch {} } }
};
# CMSPARK_650_PHASE_END
`

  function snapshot(): PhaseSnapshot {
    let input: number | undefined
    const result = (capture_state: PhaseSnapshot["capture_state"], records: Record[] = []): PhaseSnapshot => ({ capture_state, records })
    try {
      const nowRoot = fs.lstatSync(ownedRoot, { bigint: true })
      if (!nowRoot.isDirectory() || nowRoot.isSymbolicLink() || nowRoot.dev !== directory.dev || nowRoot.ino !== directory.ino) return result("unsafe")
      const before = fs.lstatSync(file, { bigint: true })
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.dev !== identity.dev || before.ino !== identity.ino) return result("unsafe")
      if (before.size > BigInt(LIMIT)) return result("oversize")
      input = fs.openSync(file, fs.constants.O_RDONLY | (process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)))
      const opened = fs.fstatSync(input, { bigint: true })
      if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== identity.dev || opened.ino !== identity.ino || opened.size !== before.size) return result("unsafe")
      const bytes = Buffer.alloc(LIMIT + 1), count = fs.readSync(input, bytes, 0, bytes.length, 0)
      const after = fs.fstatSync(input, { bigint: true }), linked = fs.lstatSync(file, { bigint: true })
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.nlink !== 1n || linked.dev !== opened.dev || linked.ino !== opened.ino || linked.nlink !== 1n || linked.isSymbolicLink()) return result("unsafe")
      if (count > LIMIT) return result("oversize")
      if (BigInt(count) !== opened.size) return result("unsafe")
      if (!count) return result("empty")
      const text = bytes.subarray(0, count).toString("utf8")
      if (!text.endsWith("\n")) return result("malformed")
      const lines = text.split(/\r?\n/); lines.pop()
      if (lines.length > WINDOWS_JOB_PHASES.length) return result("malformed")
      const records: Record[] = []
      for (const [index, line] of lines.entries()) {
        let item: unknown
        try { item = JSON.parse(line) } catch { return result("malformed") }
        if (!item || typeof item !== "object" || Array.isArray(item)) return result("malformed")
        const value = item as { phase?: unknown; elapsed_ms?: unknown }
        if (Object.keys(value).sort().join(",") !== "elapsed_ms,phase" || value.phase !== WINDOWS_JOB_PHASES[index] || typeof value.elapsed_ms !== "number" || !Number.isSafeInteger(value.elapsed_ms) || value.elapsed_ms < 0 || (index > 0 && value.elapsed_ms < records[index - 1].elapsed_ms)) return result("malformed")
        if (line !== JSON.stringify({ phase: value.phase, elapsed_ms: value.elapsed_ms })) return result("malformed")
        records.push({ phase: value.phase as Phase, elapsed_ms: value.elapsed_ms })
      }
      return result(records.length === WINDOWS_JOB_PHASES.length ? "complete" : "partial", records)
    } catch (error) {
      return result((error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unavailable")
    } finally { if (input !== undefined) { try { fs.closeSync(input) } catch { /* observation only */ } } }
  }

  function decorateSpawnArgs(args: unknown[]): unknown[] {
    if (args[0] !== windowsPowerShellExePath() || !Array.isArray(args[1])) return args
    const argv: unknown[] = args[1]
    const preamble = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]
    if (argv.length !== 5 || !preamble.every((value, index) => argv[index] === value) || typeof argv[4] !== "string") return args
    const encoded = argv[4]
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return args
    const buffer = Buffer.from(encoded, "base64")
    if (buffer.length % 2 !== 0 || buffer.toString("base64") !== encoded) return args
    const source = buffer.toString("utf16le")
    if (!source.includes("CMsparkOwnedJob") && !source.includes("$targetEnvironment=[Text.StringBuilder]::new()")) return args
    const entry = "try { $targetEnvironment=[Text.StringBuilder]::new();"
    const addType = "; Add-Type -TypeDefinition @'\n"
    const afterType = "\n'@; exit ([CMsparkOwnedJob]::Run("
    const run = "exit ([CMsparkOwnedJob]::Run("
    for (const seam of [entry, addType, afterType, run]) once(source, seam)
    if (!(source.indexOf(entry) < source.indexOf(addType) && source.indexOf(addType) < source.indexOf(afterType))) throw Error("OWNED_PHASE_BOOTSTRAP_ORDER_INVALID")
    const decorated = source
      .replace(entry, "try { " + observer + "__CmsparkPhase650 'wrapper_entered'; $targetEnvironment=[Text.StringBuilder]::new();")
      .replace(addType, "; __CmsparkPhase650 'before_add_type'; Add-Type -TypeDefinition @'\n")
      .replace(afterType, "\n'@; __CmsparkPhase650 'after_add_type'; " + run)
      .replace(run, "__CmsparkPhase650 'before_run'; " + run)
    return [args[0], [...argv.slice(0, 4), Buffer.from(decorated, "utf16le").toString("base64")], ...args.slice(2)]
  }
  return { snapshot, decorateSpawnArgs }
}

export function observeWindowsJobPhases(t: Pick<TestContext, "mock">, root: string) {
  const phases = createWindowsJobPhaseDiagnostics(root), original = childProcess.spawn
  t.mock.method(childProcess, "spawn", function(this: unknown, ...args: unknown[]) {
    return Reflect.apply(original, this, phases.decorateSpawnArgs(args))
  })
  return phases
}
