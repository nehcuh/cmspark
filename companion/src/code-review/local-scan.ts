import { Worker } from "node:worker_threads"
import { LOCAL_LIMITS, localScanSchema, type LocalScan, type LocalRun } from "./local-contract"

/** Trusted, dependency-free worker source. It only parses bytes; downloaded
 * content is NEVER interpolated into source, imported, extracted or executed.
 * Inline source also works with the bundled Node and optional SEA distributions. */
function scanWorkerBoot() {
  const { parentPort, workerData } = require("node:worker_threads")
  const { inflateRawSync } = require("node:zlib")
  const { createHash } = require("node:crypto")
  const limits = workerData.limits
  const digest = (bytes: any) => createHash("sha256").update(bytes).digest("hex")
  const fail = () => { throw new Error("ARTIFACT_UNSAFE_OR_UNSUPPORTED_ZIP") }
  const crc32 = (bytes: Buffer) => {
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  function archive(item: any) {
    const bytes = Buffer.from(item.bytes)
    if (bytes.length > limits.downloadBytes || digest(bytes) !== item.sha256) throw new Error("ARTIFACT_HASH_MISMATCH")
    let end = bytes.length - 22
    while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--
    if (end < 0 || end < bytes.length - 65557 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) fail()
    const count = bytes.readUInt16LE(end + 10), central = bytes.readUInt32LE(end + 16)
    if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count
      || count > limits.entries || count === 0xffff || central + bytes.readUInt32LE(end + 12) !== end) fail()
    let pos = central, expanded = 0
    const files = new Map<string, { hash: string; text: string | null }>(), names = new Set<string>()
    const omitted: { path: string; reason: string }[] = []
    const ranges: [number, number][] = []
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) fail()
      const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10)
      const crc = bytes.readUInt32LE(pos + 16), packed = bytes.readUInt32LE(pos + 20), size = bytes.readUInt32LE(pos + 24)
      const len = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32)
      const mode = bytes.readUInt32LE(pos + 38) >>> 16, start = bytes.readUInt32LE(pos + 42)
      if (pos + 46 + len + extra + comment > end || !len || flags & ~0x808 || ![0, 8].includes(method)
        || size === 0xffffffff || packed === 0xffffffff || start === 0xffffffff || bytes.readUInt16LE(pos + 34)) fail()
      const nameBytes = bytes.subarray(pos + 46, pos + 46 + len)
      const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes).normalize("NFC")
      // Portable Windows/POSIX paths. Reject ambiguous names even though we
      // never extract: they cannot safely identify source evidence.
      const parts = name.replace(/\/$/, "").split("/")
      if (!name || name.length > 512 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith("/")
        || parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)
          || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
        || mode && ![0, 0x8000, 0x4000].includes(mode & 0xf000)
        || names.has(name.toLowerCase())) fail()
      names.add(name.toLowerCase())
      if (start + 30 > central || bytes.readUInt32LE(start) !== 0x04034b50
        || bytes.readUInt16LE(start + 6) !== flags || bytes.readUInt16LE(start + 8) !== method) fail()
      const localLen = bytes.readUInt16LE(start + 26), localExtra = bytes.readUInt16LE(start + 28)
      const dataStart = start + 30 + localLen + localExtra, dataEnd = dataStart + packed
      if (dataEnd > central || !bytes.subarray(start + 30, start + 30 + localLen).equals(nameBytes)
        || ranges.some(([a, b]) => start < b && dataEnd > a)) fail()
      ranges.push([start, dataEnd])
      pos += 46 + len + extra + comment
      expanded += size
      if (size > limits.entryBytes || expanded > limits.expandedBytes) throw new Error("ARTIFACT_EXPANSION_LIMIT")
      const data = method === 0 ? bytes.subarray(dataStart, dataEnd)
        : inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: limits.entryBytes })
      if (data.length !== size || crc32(data) !== crc) fail()
      if (name.endsWith("/")) { if (size) fail(); continue }
      if (!name.startsWith(item.strip_prefix)) { omitted.push({ path: name, reason: "outside_selected_prefix" }); continue }
      const relative = name.slice(item.strip_prefix.length)
      if (!relative) fail()
      let text: string | null = null, reason = "binary_or_unsupported_format"
      if (/(?:^|\/)(?:\.git|node_modules|vendor)\//i.test(relative)) reason = "metadata_or_vendor"
      else if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|c|h|cpp|cs|php|rb|sh|ps1|json|ya?ml|toml|sql|md|txt|xml|html|css|lock)$/i.test(relative)
        || /(?:^|\/)(?:Dockerfile|Makefile|\.env(?:\.[\w-]+)?)$/i.test(relative)) {
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); if (text.includes("\0")) text = null } catch {}
      }
      if (text === null) omitted.push({ path: relative, reason })
      files.set(relative, { hash: digest(data), text })
    }
    if (pos !== end || !files.size) fail()
    return { item, files, omitted, entries: count }
  }
  try {
    const archives = workerData.artifacts.map(archive)
    const base = archives.find((a: any) => a.item.role === "base"), head = archives.find((a: any) => a.item.role === "head")
    const changes: any[] = [], findings: any[] = [], gaps = [
      "ARTIFACT_COMMIT_IDENTITY_UNVERIFIED", "STATIC_RULE_REVIEW_ONLY", "NO_RUNTIME_OR_TEST_EXECUTION",
      "NO_DEPENDENCY_VULNERABILITY_DATABASE", "NO_HUMAN_OR_SEMANTIC_REVIEW", "NO_DEPLOYMENT_APPROVAL",
    ]
    for (const name of [...new Set<string>([...base.files.keys(), ...head.files.keys()])].sort()) {
      const oldFile = base.files.get(name), newFile = head.files.get(name)
      if (oldFile?.hash === newFile?.hash) continue
      changes.push({ path: name, kind: !oldFile ? "added" : !newFile ? "deleted" : "modified",
        base_hash: oldFile?.hash || null, head_hash: newFile?.hash || null,
        inspected: (!oldFile || oldFile.text !== null) && (!newFile || newFile.text !== null) })
    }
    const rules: [string, string, RegExp][] = [
      ["dynamic_code", "动态代码执行候选，需人工确认输入可控性", /\beval\s*\(|\bnew\s+Function\s*\(/],
      ["shell_execution", "命令执行候选，需核对参数与授权边界", /\b(?:exec|execSync|spawn|system|popen)\s*\(/],
      ["tls_disabled", "TLS 校验关闭候选", /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*["']?0/],
      ["embedded_credential", "疑似内嵌凭据，报告仅保留哈希证据", /(?:api[_-]?key|password|secret|token)\s*[=:]\s*["'][^"']{8,}["']/i],
      ["install_hook", "安装生命周期脚本变更，未运行，需人工评审", /"(?:preinstall|postinstall|prepare)"\s*:/],
    ]
    for (const a of archives) {
      if (a.item.role === "base") continue
      for (const [name, file] of a.files) {
        if (file.text === null) continue
        const oldLines = new Set<string>((base.files.get(name)?.text || "").split(/\r?\n/))
        const lines = file.text.split(/\r?\n/)
        lines.forEach((line: string, index: number) => {
          for (const [rule, summary, pattern] of rules) if (pattern.test(line)) {
            if (findings.length >= limits.findings) { if (!gaps.includes("FINDINGS_LIMIT_REACHED")) gaps.push("FINDINGS_LIMIT_REACHED"); continue }
            findings.push({ role: a.item.role, path: name, line: index + 1, rule, severity: "major", summary,
              file_hash: file.hash, line_hash: digest(line), introduced: a.item.role === "head" && !oldLines.has(line) })
          }
        })
      }
    }
    if (archives.some((a: any) => a.omitted.length)) gaps.push("UNSCANNED_FILES_PRESENT")
    if (changes.some(c => !c.inspected)) gaps.push("UNSCANNED_CHANGES_PRESENT")
    const sources: any[] = []
    if (workerData.capsule) {
      let sourceBytes = 0
      for (const change of changes) {
        if (!change.inspected) continue
        const oldFile = base.files.get(change.path), newFile = head.files.get(change.path)
        const source = { path: change.path, base_text: oldFile?.text ?? null, head_text: newFile?.text ?? null,
          base_hash: change.base_hash, head_hash: change.head_hash }
        sourceBytes += Buffer.byteLength(JSON.stringify(source))
        if (sources.length >= 128 || sourceBytes > 256 * 1024) { gaps.push("AGENT_SOURCE_CAPSULE_PARTIAL"); break }
        sources.push(source)
      }
    }
    parentPort.postMessage({ ok: true, sources, result: { scanner: "local-static.v1", changes, findings, gaps,
      artifacts: archives.map((a: any) => ({ role: a.item.role, sha256: a.item.sha256, entries: a.entries,
        scanned: [...a.files.values()].filter((f: any) => f.text !== null).length, omitted: a.omitted })) } })
  } catch (error: any) {
    const message = String(error?.message || "")
    parentPort.postMessage({ ok: false, error: /^ARTIFACT_[A-Z_]+$/.test(message) ? message : "ARTIFACT_PARSE_FAILED" })
  }
}

export function scanArtifacts(artifacts: Array<LocalRun["artifacts"][number] & { bytes: Buffer }>, signal: AbortSignal): Promise<LocalScan> {
  return runScanWorker(artifacts, signal, false).then(value => value.result)
}
export type ReviewSource = { path: string; base_text: string | null; head_text: string | null; base_hash: string | null; head_hash: string | null }
export function buildAgentCapsule(artifacts: Array<LocalRun["artifacts"][number] & { bytes: Buffer }>, signal: AbortSignal): Promise<{ result: LocalScan; sources: ReviewSource[] }> {
  return runScanWorker(artifacts, signal, true)
}
function runScanWorker(artifacts: Array<LocalRun["artifacts"][number] & { bytes: Buffer }>, signal: AbortSignal, capsule: boolean): Promise<{ result: LocalScan; sources: ReviewSource[] }> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(`(${scanWorkerBoot.toString()})()`, {
      eval: true, workerData: { artifacts, limits: LOCAL_LIMITS, capsule },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    })
    let settled = false
    const finish = (error?: Error, result?: unknown, sources: ReviewSource[] = []) => {
      if (settled) return
      settled = true; signal.removeEventListener("abort", abort)
      void worker.terminate()
      if (error) reject(error)
      else { try { resolve({ result: localScanSchema.parse(result), sources }) } catch { reject(new Error("ARTIFACT_INVALID_SCAN_RESULT")) } }
    }
    const abort = () => finish(new Error("ARTIFACT_CANCELLED"))
    signal.addEventListener("abort", abort, { once: true })
    worker.once("message", value => value?.ok ? finish(undefined, value.result, value.sources) : finish(new Error(value?.error || "ARTIFACT_SCAN_FAILED")))
    worker.once("error", () => finish(new Error("ARTIFACT_WORKER_FAILED")))
    worker.once("exit", () => { if (!settled) finish(new Error("ARTIFACT_WORKER_EXITED")) })
    if (signal.aborted) abort()
  })
}
