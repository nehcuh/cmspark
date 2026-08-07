// Path B M1 — STT session service: SttSessionCore + tmp + whisper-runner.
// Peer-bound max-1 session; model path allowlist; injectable runner/binary/probe.

import * as path from "node:path"

import {
  defaultWhisperSearchRoots,
  resolveWhisperArch,
  resolveWhisperBinary,
  resolveWhisperCliOnPath,
  type ResolveWhisperBinaryResult,
} from "./binary-resolve"
import { whisperPinResolveOpts } from "./whisper-binary-pins"
import {
  STT_INFER_MAX_MS,
  STT_MAX_RECORD_MS,
  STT_UPLOAD_IDLE_MS,
  isSttModelId,
  type SttModelId,
} from "./session-caps"
import {
  SttSessionCore,
  type SttSessionErrorCode,
  type SttSessionStart,
} from "./stt-session-core"
import {
  createSessionDir,
  gcOrphanSessions,
  removeSessionDir,
  sanitizeSessionId,
  writeSessionFile,
} from "./stt-tmp"
import { whisperModelDirName } from "./whisper-catalog"
import {
  probeWhisperModelDir,
  resolveWhisperRoot,
} from "./whisper-download"
import {
  getWhisperModelFiles,
  loadWhisperManifest,
  type WhisperManifest,
} from "./whisper-manifest"
import {
  runWhisperTranscribe,
  WhisperRunnerError,
  type WhisperRunResult,
} from "./whisper-runner"

// --- result types -------------------------------------------------------------

export type SttServiceErrorCode =
  | SttSessionErrorCode
  | "model_missing"
  | "binary_missing"
  | "hash_fail"
  | "infer_timeout"
  | "empty_result"
  | "peer_mismatch"
  | "resource_conflict"
  | "invalid_session_id"

export type SttServiceResult =
  | { ok: true; text?: string; ms?: number; modelId?: string }
  | { ok: false; code: SttServiceErrorCode; message: string }

export type SttStartRequest = SttSessionStart

export type WhisperRunnerFn = (opts: {
  binaryPath: string
  modelPath: string
  audioPath: string
  lang?: string
  timeoutMs?: number
  signal?: AbortSignal
}) => Promise<WhisperRunResult>

export type ProbeModelFn = (
  modelId: SttModelId,
  rootDir?: string,
) => { status: "ready" | "absent" | "incomplete"; error?: string }

export type SttSessionServiceDeps = {
  /** Companion data dir (…/.cmspark-agent or test temp). */
  dataDir: string
  now?: () => number
  /** Override whisper runner (tests inject fake). */
  runWhisper?: WhisperRunnerFn
  /** Override binary resolve. */
  resolveBinary?: () => ResolveWhisperBinaryResult
  /** Override model readiness probe. */
  probeModel?: ProbeModelFn
  /** Override model path resolve (still should be under whisper root). */
  resolveModelPath?: (modelId: SttModelId) => string | null
  /** Whisper models root override. */
  whisperRoot?: string
  /** Companion package root for default binary search. */
  companionRoot?: string
  /** Manifest override (tests). */
  manifest?: WhisperManifest
  maxRecordMs?: number
  uploadIdleMs?: number
  inferMaxMs?: number
  lang?: string
}

type BoundSession = {
  peerId: string
  sessionId: string
  modelId: SttModelId
  format: "pcm_s16le" | "wav"
  abortController: AbortController
  recordTimer?: ReturnType<typeof setTimeout>
  idleTimer?: ReturnType<typeof setTimeout>
  sessionDir?: string
  /** True while whisper child is running. */
  inferring: boolean
}

// --- service ------------------------------------------------------------------

export class SttSessionService {
  private readonly core: SttSessionCore
  private readonly deps: SttSessionServiceDeps
  private bound: BoundSession | null = null

  constructor(deps: SttSessionServiceDeps) {
    if (!deps.dataDir) throw new Error("SttSessionService requires dataDir")
    this.deps = deps
    this.core = new SttSessionCore(deps.now ?? (() => Date.now()))
  }

  getActive(): ReturnType<SttSessionCore["getActive"]> {
    return this.core.getActive()
  }

  getBoundPeerId(): string | null {
    return this.bound?.peerId ?? null
  }

  /**
   * Start a new STT session bound to peerId.
   * Probes model readiness; rejects unsafe sessionId.
   */
  start(req: SttStartRequest, peerId: string): SttServiceResult {
    if (!peerId) {
      return { ok: false, code: "peer_mismatch", message: "peerId required" }
    }
    try {
      sanitizeSessionId(req.sessionId)
    } catch (e) {
      return {
        ok: false,
        code: "invalid_session_id",
        message: e instanceof Error ? e.message : "invalid sessionId",
      }
    }

    if (!isSttModelId(req.modelId)) {
      return { ok: false, code: "invalid_model", message: `unknown modelId: ${req.modelId}` }
    }

    const root = this.whisperRoot()
    const probe = this.deps.probeModel ?? ((id, r) => probeWhisperModelDir(id, r, this.deps.manifest))
    const p = probe(req.modelId, root)
    if (p.status !== "ready") {
      return { ok: false, code: "model_missing", message: "model not ready" }
    }

    const r = this.core.start(req)
    if (!r.ok) return r

    // Drop any leftover bound from ended/aborted without peer
    this.clearTimersOnly()
    const ac = new AbortController()
    this.bound = {
      peerId,
      sessionId: req.sessionId,
      modelId: req.modelId,
      format: req.format,
      abortController: ac,
      inferring: false,
    }
    this.armRecordTimer()
    this.armIdleTimer()
    return { ok: true }
  }

  chunk(sessionId: string, seq: number, data: Buffer, peerId: string): SttServiceResult {
    const peer = this.requirePeer(peerId, sessionId)
    if (!peer.ok) return peer
    const r = this.core.appendChunk(sessionId, seq, data)
    if (r.ok) this.armIdleTimer()
    return r
  }

  /**
   * End session: reassemble audio → tmp file → whisper → unlink → text.
   */
  async end(sessionId: string, totalSeq: number, peerId: string): Promise<SttServiceResult> {
    const peer = this.requirePeer(peerId, sessionId)
    if (!peer.ok) return peer

    // Stop upload timers; keep abortController for infer cancel
    this.clearTimersOnly()

    const end = this.core.end(sessionId, totalSeq)
    if (!end.ok) {
      this.dropBound()
      return end
    }

    const audio = end.audio!
    const bound = this.bound!
    const modelId = bound.modelId
    const format = bound.format
    const ac = bound.abortController
    bound.inferring = true

    let sessionDir: string | undefined
    try {
      if (ac.signal.aborted) {
        this.core.clearIfEnded()
        this.dropBound()
        return { ok: false, code: "aborted", message: "session aborted" }
      }

      const binRes = this.resolveBinary()
      if (!binRes.ok) {
        this.core.clearIfEnded()
        this.dropBound()
        const code =
          binRes.reason === "hash_mismatch" ? "hash_fail" : "binary_missing"
        return { ok: false, code, message: binRes.message }
      }

      const modelPath = this.resolveModelPath(modelId)
      if (!modelPath) {
        this.core.clearIfEnded()
        this.dropBound()
        return { ok: false, code: "model_missing", message: "model path not resolved" }
      }

      sessionDir = await createSessionDir(sessionId, this.deps.dataDir)
      bound.sessionDir = sessionDir
      const fileName = format === "wav" ? "audio.wav" : "audio.pcm"
      const audioPath = await writeSessionFile(sessionDir, fileName, audio)

      const run = this.deps.runWhisper ?? runWhisperTranscribe
      const result = await run({
        binaryPath: binRes.path,
        modelPath,
        audioPath,
        lang: this.deps.lang ?? "zh",
        timeoutMs: this.deps.inferMaxMs ?? STT_INFER_MAX_MS,
        signal: ac.signal,
      })

      await removeSessionDir(sessionDir)
      sessionDir = undefined
      this.core.clearIfEnded()
      this.dropBound()

      return {
        ok: true,
        text: result.text ?? "",
        ms: result.ms,
        modelId,
      }
    } catch (e) {
      if (sessionDir) {
        try {
          await removeSessionDir(sessionDir)
        } catch {
          /* best-effort */
        }
      }
      this.core.clearIfEnded()
      const aborted =
        ac.signal.aborted ||
        (e instanceof WhisperRunnerError && e.code === "aborted")
      if (aborted) {
        this.dropBound()
        return { ok: false, code: "aborted", message: "session aborted" }
      }
      if (e instanceof WhisperRunnerError && e.code === "timeout") {
        this.dropBound()
        return { ok: false, code: "infer_timeout", message: e.message }
      }
      this.dropBound()
      return {
        ok: false,
        code: "resource_conflict",
        message: e instanceof Error ? e.message : String(e),
      }
    }
  }

  abort(sessionId: string | undefined, peerId: string): SttServiceResult {
    if (this.bound) {
      if (this.bound.peerId !== peerId) {
        return { ok: false, code: "peer_mismatch", message: "peer does not own session" }
      }
      if (sessionId !== undefined && this.bound.sessionId !== sessionId) {
        return { ok: false, code: "session_unknown", message: "session id mismatch" }
      }
      try {
        this.bound.abortController.abort()
      } catch {
        /* ignore */
      }
      if (this.bound.sessionDir) {
        void removeSessionDir(this.bound.sessionDir).catch(() => {})
      }
    }
    this.clearTimersOnly()
    const r = this.core.abort(sessionId)
    this.dropBound()
    return r
  }

  /** Abort without peer check (WS close / shutdown / record-idle timeout). */
  forceAbort(): void {
    if (this.bound) {
      try {
        this.bound.abortController.abort()
      } catch {
        /* ignore */
      }
      if (this.bound.sessionDir) {
        void removeSessionDir(this.bound.sessionDir).catch(() => {})
      }
    }
    this.clearTimersOnly()
    this.core.abort()
    this.dropBound()
  }

  // --- internals --------------------------------------------------------------

  private whisperRoot(): string {
    if (this.deps.whisperRoot) return path.resolve(this.deps.whisperRoot)
    return resolveWhisperRoot({ dataDir: this.deps.dataDir })
  }

  private resolveBinary(): ResolveWhisperBinaryResult {
    if (this.deps.resolveBinary) return this.deps.resolveBinary()
    const roots = defaultWhisperSearchRoots(
      this.deps.companionRoot ?? path.join(__dirname, "..", ".."),
    )
    const warch = resolveWhisperArch()
    const pinOpts = whisperPinResolveOpts(warch)
    if (pinOpts.forceUnpinned) {
      console.warn(
        "[voice] CMSPARK_WHISPER_UNPINNED=1 — skipping cmspark-whisper SHA256 pin (dev only)",
      )
    }
    const packaged = resolveWhisperBinary({
      searchRoots: roots,
      expectedSha256: pinOpts.expectedSha256,
      allowUnpinned: pinOpts.allowUnpinned,
    })
    if (packaged.ok) return packaged
    const pathCli = resolveWhisperCliOnPath()
    if (pathCli) {
      return {
        ok: true,
        path: pathCli,
        arch: warch === "unsupported" ? "darwin-arm64" : warch,
        sha256: "path-fallback",
        pinned: false,
      }
    }
    return packaged
  }

  /**
   * Model path only under resolveWhisperRoot + modelId + manifest basename.
   * Never accepts client-supplied paths.
   */
  private resolveModelPath(modelId: SttModelId): string | null {
    if (this.deps.resolveModelPath) {
      const p = this.deps.resolveModelPath(modelId)
      if (!p) return null
      // still enforce under whisper root
      const root = this.whisperRoot()
      const resolved = path.resolve(p)
      if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) {
        return null
      }
      return resolved
    }
    const root = this.whisperRoot()
    let files
    try {
      files = getWhisperModelFiles(modelId, this.deps.manifest ?? loadWhisperManifest())
    } catch {
      return null
    }
    const primary = files.find((f) => f.name.endsWith(".bin")) ?? files[0]
    if (!primary) return null
    // manifest schema already requires basename-only
    if (primary.name.includes("..") || primary.name.includes("/") || primary.name.includes("\\")) {
      return null
    }
    const modelPath = path.resolve(root, whisperModelDirName(modelId), primary.name)
    const rootResolved = path.resolve(root)
    if (!modelPath.startsWith(rootResolved + path.sep)) return null
    return modelPath
  }

  private requirePeer(peerId: string, sessionId: string): SttServiceResult {
    if (!this.bound) {
      // Let core produce session_unknown if needed — but bind missing means no peer
      const active = this.core.getActive()
      if (!active || active.sessionId !== sessionId) {
        return { ok: false, code: "session_unknown", message: "no matching session" }
      }
      return { ok: false, code: "peer_mismatch", message: "session has no peer binding" }
    }
    if (this.bound.peerId !== peerId) {
      return { ok: false, code: "peer_mismatch", message: "peer does not own session" }
    }
    if (this.bound.sessionId !== sessionId) {
      return { ok: false, code: "session_unknown", message: "session id mismatch" }
    }
    return { ok: true }
  }

  private armRecordTimer(): void {
    if (!this.bound) return
    if (this.bound.recordTimer) clearTimeout(this.bound.recordTimer)
    const maxMs = this.deps.maxRecordMs ?? STT_MAX_RECORD_MS
    this.bound.recordTimer = setTimeout(() => {
      this.forceAbort()
    }, maxMs)
    if (typeof (this.bound.recordTimer as any).unref === "function") {
      ;(this.bound.recordTimer as any).unref()
    }
  }

  private armIdleTimer(): void {
    if (!this.bound) return
    if (this.bound.idleTimer) clearTimeout(this.bound.idleTimer)
    // Idle only applies while receiving, not during infer
    if (this.bound.inferring) return
    const idleMs = this.deps.uploadIdleMs ?? STT_UPLOAD_IDLE_MS
    this.bound.idleTimer = setTimeout(() => {
      this.forceAbort()
    }, idleMs)
    if (typeof (this.bound.idleTimer as any).unref === "function") {
      ;(this.bound.idleTimer as any).unref()
    }
  }

  private clearTimersOnly(): void {
    if (this.bound?.recordTimer) {
      clearTimeout(this.bound.recordTimer)
      this.bound.recordTimer = undefined
    }
    if (this.bound?.idleTimer) {
      clearTimeout(this.bound.idleTimer)
      this.bound.idleTimer = undefined
    }
  }

  private dropBound(): void {
    this.clearTimersOnly()
    this.bound = null
  }
}

// --- process singleton --------------------------------------------------------

let singleton: SttSessionService | null = null

export function getSttSessionService(deps?: SttSessionServiceDeps): SttSessionService {
  if (!singleton) {
    if (!deps) {
      throw new Error("SttSessionService not initialized; pass deps on first call")
    }
    singleton = new SttSessionService(deps)
  }
  return singleton
}

export function resetSttSessionServiceForTests(): void {
  if (singleton) {
    try {
      singleton.forceAbort()
    } catch {
      /* ignore */
    }
  }
  singleton = null
}

/** Boot-time orphan GC (best-effort). Default max age 1h. */
export async function bootGcVoiceSttTmp(
  dataDir: string,
  maxAgeMs: number = 60 * 60 * 1000,
): Promise<number> {
  return gcOrphanSessions(dataDir, maxAgeMs)
}
