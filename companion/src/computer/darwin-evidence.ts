// macOS evidence sealer (WP3 + adversarial review C1).
//
// KEY DESIGN (C1 fix): cryptographic keys NEVER leave the Swift binary.
// The companion calls cmspark-host evidence-seal which performs AES-256-GCM
// encryption inside the Swift process using keys stored in the macOS Keychain
// via SecItemAdd with code-signing ACL.

import { execFile, type ExecFileException } from "child_process"
import { promisify } from "util"
import { ComputerError, type RectPx } from "./types"
import { resolveHostBinary } from "../host-use/darwin/host-bin"
import type { EvidenceSealer } from "./evidence"

const execFileAsync = promisify(execFile)

function parseEvidenceJson(stdout: string, label: string): Record<string, any> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new ComputerError("EVIDENCE_ERROR", `${label}: invalid JSON from cmspark-host (${(err as Error).message})`)
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ComputerError("EVIDENCE_ERROR", `${label}: malformed payload from cmspark-host`)
  }
  return parsed as Record<string, any>
}

function rethrowEvidenceError(err: ExecFileException | Error, label: string): never {
  if (err && typeof err === "object" && "stderr" in err && (err as any).stderr) {
    throw new ComputerError("EVIDENCE_ERROR", `${label}: ${(err as any).stderr}`)
  }
  throw new ComputerError("EVIDENCE_ERROR", `${label}: ${err.message}`)
}

export class MacEvidenceSealer implements EvidenceSealer {
  async protect(inPath: string, outPath: string, blurRects: RectPx[]): Promise<{ sha256: string }> {
    const bin = resolveHostBinary()
    const args = ["evidence-seal", "--input", inPath, "--output", outPath]
    if (blurRects && blurRects.length > 0) {
      args.push("--blur-rects", JSON.stringify(blurRects))
    }
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, args, { encoding: "utf-8", timeout: 15000 })
    } catch (err) {
      rethrowEvidenceError(err as ExecFileException | Error, "evidence-seal")
    }
    const parsed = parseEvidenceJson(result.stdout, "evidence-seal")
    if (parsed.ok !== true) {
      throw new ComputerError("EVIDENCE_ERROR", `evidence-seal: ${parsed.error ?? "unknown error"}`)
    }
    const sha256 = (parsed.sha256 as string) ?? ""
    return { sha256 }
  }
}
