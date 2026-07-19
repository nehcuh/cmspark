// A7 — evidence chain v1: ~/.cmspark-agent/computer-evidence/<taskId>/
//   task.json.sealed        task metadata (app, corpus hash, hwnd — sealed)
//   actions.json.sealed     per-action records (action, coords, layer,
//                           confidence, timings, before/after sha256, flags)
//   before-<seq>.png.sealed / after-<seq>.png.sealed
//
// Properties (A7):
//  - DPAPI CurrentUser at-rest encryption for EVERY persisted artifact
//    (screenshots AND metadata) — offline/backup/other-user reads get ciphertext.
//  - Credential neighborhoods (danger scan hits) are pixelated BEFORE sealing;
//    the raw capture is deleted by the sealer — original pixels never persist.
//  - 7-day TTL janitor + purge-all, covering the whole evidence directory.
//  - history.db NEVER stores image bytes or full OCR text (store.ts redaction).

import * as fs from "fs"
import * as path from "path"
import { DATA_DIR } from "../config"
import { ComputerError, type RectPx, sha256Hex } from "./types"

export const EVIDENCE_DIR_NAME = "computer-evidence"
export const EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Injectable sealer — PsEvidenceSealer in production, fake in tests. */
export interface EvidenceSealer {
  protect(inPath: string, outPath: string, blurRects: RectPx[]): Promise<{ sha256: string }>
}

export interface EvidenceActionRecord {
  seq: number
  action: string
  x?: number
  y?: number
  layer?: string
  confidence?: number
  /**
   * WP1 honest semantics (review R4): true means the PIXEL-REGION channel
   * confirmed target stability between the locate frame and the pre-inject
   * frame. This is a pixel-STABILITY cross-check, NOT a semantic OCR↔UIA
   * verification — WP1 has no second semantic layer (that arrives with WP3).
   */
  crossverified: boolean
  /** Which channel verified: "pixel-region" (WP1) / "uia+ocr" (WP3 L0 witness). Absent when not verified. */
  crossverifyChannel?: string
  uncrossverified: boolean
  /**
   * WP3 (§B.1): per-layer locate attempts with structured degradation
   * reasons (uia-not-found / uia-ocr-disagree / ocr-language-missing /
   * wp5-not-implemented / wp6-not-implemented …). Present on click-family
   * actions that located through the layer chain.
   */
  locateAttempts?: import("./types").LocateAttempt[]
  /**
   * X1 (WP3 adversary): quantified UIA↔OCR witness strength — present on
   * click-family actions where the L0 witness ran. Records WHY "uia+ocr"
   * was (or was not) granted: dual bbox size caps (oversized), anchor char
   * coverage, contiguous reconstruction, window-area ratio.
   */
  witness?: {
    agree: boolean
    oversized: boolean
    matchedChars: number
    anchorChars: number
    coverage: number
    reconstructed: boolean
    bboxAreaRatio: number
  }
  dangerScan?: { regionLevel: string; windowLevel: string; regionHits: string[]; windowHits: string[] }
  beforeSha256?: string
  afterSha256?: string
  durationMs: number
  note?: string
}

export interface EvidenceSink {
  readonly dir: string
  init(meta: Record<string, unknown>): Promise<void>
  sealScreenshot(rawPath: string, seq: number, phase: "before" | "after", blurRects: RectPx[]): Promise<{ sha256: string }>
  appendAction(record: EvidenceActionRecord): Promise<void>
  finalize(summary: Record<string, unknown>): Promise<void>
}

export function evidenceBaseDir(baseDir?: string): string {
  return baseDir ?? path.join(DATA_DIR, EVIDENCE_DIR_NAME)
}

/** Injectable lstat surface for the Y5 reparse-point check. */
export interface ReparseFsLike {
  lstatSync(p: string): { isSymbolicLink(): boolean }
}

/**
 * Y5 (WP2): refuse reparse points (symlink/junction) in the evidence dir
 * chain. A pre-planted symlink at the base or task dir would redirect sealed
 * evidence outside the sandbox — and the A7.2 janitor's deletes would
 * follow it too. Checked before every init, fail-closed. A missing
 * component is fine (it will be created as a real directory).
 */
export function assertNotReparsePath(target: string, f: ReparseFsLike = fs): void {
  let isLink = false
  try {
    isLink = f.lstatSync(target).isSymbolicLink()
  } catch {
    return // does not exist — nothing to reparse through
  }
  if (isLink) {
    throw new ComputerError(
      "EVIDENCE_ERROR",
      `computer.evidence: "${target}" is a reparse point — refusing to store evidence through it (Y5)`,
    )
  }
}

export class ComputerEvidence implements EvidenceSink {
  readonly dir: string
  private records: EvidenceActionRecord[] = []

  constructor(
    readonly taskId: string,
    private sealer: EvidenceSealer,
    baseDir?: string,
  ) {
    // taskId is a companion-generated uuid — sanitize defensively anyway.
    const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, "")
    this.baseDir = evidenceBaseDir(baseDir)
    this.dir = path.join(this.baseDir, safe)
  }
  private readonly baseDir: string

  async init(meta: Record<string, unknown>): Promise<void> {
    // Y5: refuse reparse points BEFORE creating anything (symlinked base or
    // pre-planted task dir redirects sealed evidence outside the sandbox).
    assertNotReparsePath(this.baseDir)
    assertNotReparsePath(this.dir)
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = path.join(this.dir, `.task-${process.pid}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), "utf8")
    await this.sealer.protect(tmp, path.join(this.dir, "task.json.sealed"), [])
    // sealer deletes the raw tmp (production); belt cleanup for fake sealers.
    try { fs.rmSync(tmp, { force: true }) } catch { /* best-effort */ }
  }

  async sealScreenshot(
    rawPath: string,
    seq: number,
    phase: "before" | "after",
    blurRects: RectPx[],
  ): Promise<{ sha256: string }> {
    const out = path.join(this.dir, `${phase}-${seq}.png.sealed`)
    try {
      return await this.sealer.protect(rawPath, out, blurRects)
    } catch (err) {
      if (err instanceof ComputerError) throw err
      throw new ComputerError("EVIDENCE_ERROR", `computer.evidence: seal failed: ${(err as Error)?.message}`)
    }
  }

  async appendAction(record: EvidenceActionRecord): Promise<void> {
    this.records.push(record)
    await this.flushActions()
  }

  async finalize(summary: Record<string, unknown>): Promise<void> {
    const tmp = path.join(this.dir, `.summary-${process.pid}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(summary, null, 2), "utf8")
    await this.sealer.protect(tmp, path.join(this.dir, "summary.json.sealed"), [])
    try { fs.rmSync(tmp, { force: true }) } catch { /* best-effort */ }
  }

  private async flushActions(): Promise<void> {
    const tmp = path.join(this.dir, `.actions-${process.pid}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(this.records, null, 2), "utf8")
    await this.sealer.protect(tmp, path.join(this.dir, "actions.json.sealed"), [])
    try { fs.rmSync(tmp, { force: true }) } catch { /* best-effort */ }
  }
}

export type EvidenceFactory = (taskId: string) => EvidenceSink

// ---------------------------------------------------------------------------
// TTL janitor + purge-all (A7.2). Pure over an injected fs-like surface so the
// retention property is unit-testable without touching the real directory.
// ---------------------------------------------------------------------------

export interface JanitorFs {
  readdir(dir: string): string[]
  statMtimeMs(p: string): number
  rmrf(p: string): void
  exists(p: string): boolean
}

export const realJanitorFs: JanitorFs = {
  readdir(dir) {
    try { return fs.readdirSync(dir) } catch { return [] }
  },
  statMtimeMs(p) {
    try { return fs.statSync(p).mtimeMs } catch { return 0 }
  },
  rmrf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* best-effort */ }
  },
  exists(p) {
    return fs.existsSync(p)
  },
}

/**
 * Delete task directories whose newest artifact is older than ttlMs. Returns
 * the removed task ids. Cascade note (A7.2): history.db holds only hashes +
 * metadata for host_computer (store.ts redaction), so wiping this directory
 * removes every persisted pixel/text artifact of the task.
 */
export function runEvidenceJanitor(opts: {
  baseDir?: string
  ttlMs?: number
  now?: number
  fsLike?: JanitorFs
}): string[] {
  const f = opts.fsLike ?? realJanitorFs
  const dir = evidenceBaseDir(opts.baseDir)
  const ttl = opts.ttlMs ?? EVIDENCE_TTL_MS
  const now = opts.now ?? Date.now()
  const removed: string[] = []
  if (!f.exists(dir)) return removed
  for (const entry of f.readdir(dir)) {
    const full = path.join(dir, entry)
    const mtime = f.statMtimeMs(full)
    if (mtime > 0 && now - mtime > ttl) {
      f.rmrf(full)
      removed.push(entry)
    }
  }
  return removed
}

/** 「立即清除全部证据」— wipe the entire evidence directory. */
export function purgeAllEvidence(opts: { baseDir?: string; fsLike?: JanitorFs } = {}): number {
  const f = opts.fsLike ?? realJanitorFs
  const dir = evidenceBaseDir(opts.baseDir)
  if (!f.exists(dir)) return 0
  const entries = f.readdir(dir)
  for (const entry of entries) f.rmrf(path.join(dir, entry))
  return entries.length
}

/** Stable audit id for an evidence artifact set (hash of ordered sha256s). */
export function evidenceDigest(sha256s: string[]): string {
  return sha256Hex([...sha256s].sort().join("|")).slice(0, 16)
}
