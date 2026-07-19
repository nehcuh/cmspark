// WP3 — UIA admission probe verdicts (L0 layer admission, plan §B) and the
// AppEntry.uiaCapable write-back (plan §K.5).
//
// The ps1 (computer-uia-probe.ps1) is READ-ONLY: a bounded control-view walk
// emitting statistics only (never element names — screen content is user
// data). The VERDICT lives here in TS so the thresholds are unit-testable
// without spawning PowerShell.
//
// §K.5 decision (WP3): uiaCapable is a THREE-STATE admission hint
// (undefined = never probed), NOT a privilege bit. It selects only the
// locator LAYER ORDER (L0 UIA first vs L1 OCR only). Every injection-safety
// invariant (coordinateAllowed, vault/LOLBIN exclusion, IL/desktop gates,
// danger scan, budget) is independent of it — a hand-tampered value can
// cause a wasted locate round-trip, never an unsafe injection. It therefore
// does NOT need the add-flow biometric gate (ADR-010 protects capability
// grants, not layer hints). Write-back tampering semantics, ADR-010 parity:
//   - validateAppEntry constrains the fields (boolean / ISO string);
//   - the write path revalidates the new entry before replaceAppsEntries;
//   - a HAND-SET value (uiaCapable present, uiaProbedAt absent) is a human
//     override and is NEVER overwritten by the auto write-back;
//   - the write touches ONLY uiaCapable + uiaProbedAt.
//
// Write timing decision: TASK-START LAZY probe (executor, after the hwnd is
// resolved). Not at app-add time (the app may not be running and the panel
// add-flow must stay fast), not in the launch path (host_computer never
// starts apps), not a background sweep (no provenance for the hwnd choice).

import { getConfig, replaceAppsEntries } from "../config"
import { applyUiaProbedVerdict } from "../apps/types"
import { parsePsJson, resolveWinScript, runPs, type PsRunner } from "../host-use/win/powershell"
import { rethrowComputerPsError } from "./win-adapters"

/** A tree is rich enough to admit L0 on node count alone. */
export const UIA_CAPABLE_MIN_NODES = 40
/** A sparse tree (< this) gets one hydration re-check before the verdict. */
export interface UiaProbeStats {
  nodes: number
  maxDepth: number
  edits: number
  documents: number
  interactive: number
  /** Depth>=1 elements with a non-empty accessible Name. */
  named: number
  /** Named elements that are also on-screen with a non-empty rect — the
   *  discriminator: UIA-blind OSR apps show only unnamed Panes (cloudmusic
   *  spike: 5 nodes, 0 named), while legacy WinForms keeps names on Pane
   *  controls (fixture: 3 nodes, namedOnscreen=1). */
  namedOnscreen: number
  capped: boolean
  hydrationRechecked: boolean
  passANodes: number
  durationMs: number
}

export interface UiaVerdict {
  uiaCapable: boolean
  /** Confidence in the VERDICT (not in any future locate): 0.9 rich tree,
   *  0.6 single-signal (capable) / substantial-but-unaddressable (blind),
   *  0.4 sparse-tree negative (post-hydration-recheck, probably blind). */
  confidence: number
  stats: UiaProbeStats
}

/**
 * Verdict rule (bias toward CAPABLE): a false positive costs one honest L0
 * locate round-trip that degrades to L1 with a structured reason; a false
 * negative silently disables the more precise layer for the app. No safety
 * invariant depends on this (§K.5 — see header).
 */
export function uiaVerdictFromStats(s: UiaProbeStats): UiaVerdict {
  const rich = s.edits + s.documents > 0 || s.nodes >= UIA_CAPABLE_MIN_NODES
  if (rich) return { uiaCapable: true, confidence: 0.9, stats: s }
  if (s.namedOnscreen >= 1) return { uiaCapable: true, confidence: 0.6, stats: s }
  const confidence = s.nodes >= 8 ? 0.6 : 0.4
  return { uiaCapable: false, confidence, stats: s }
}

/** Read-only UIA admission probe (production: PsUiaProber; tests: fake). */
export interface UiaProber {
  probe(hwnd: number): Promise<UiaVerdict>
}

/**
 * Write the probed verdict back into apps.entries (§K.5). Enforces the
 * hand-set-override rule inside applyUiaProbedVerdict and revalidates before
 * the wholesale swap. Returns {applied, reason} for the audit log — never
 * throws on a refused write (a write-back failure must never fail the task
 * that produced the verdict).
 */
export function writeBackUiaVerdict(
  token: string,
  verdict: UiaVerdict,
  probedAt: string,
): { applied: boolean; reason?: string } {
  try {
    const entries = getConfig().apps?.entries ?? {}
    const r = applyUiaProbedVerdict(entries, token, verdict.uiaCapable, probedAt)
    if (!r.applied) return { applied: false, reason: r.reason }
    replaceAppsEntries(r.entries)
    return { applied: true }
  } catch (err) {
    return { applied: false, reason: `error: ${(err as Error)?.message ?? String(err)}` }
  }
}

/** ps1-backed prober — computer-uia-probe.ps1 (READ-ONLY). */
export class PsUiaProber implements UiaProber {
  constructor(private runner: PsRunner = runPs) {}

  async probe(hwnd: number): Promise<UiaVerdict> {
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-uia-probe.ps1"), ["-Hwnd", String(hwnd)])
    } catch (err) {
      rethrowComputerPsError(err, "uia.probe")
    }
    const r = parsePsJson<any>(stdout!, "computer.uia.probe")
    const stats: UiaProbeStats = {
      nodes: Number(r.nodes ?? 0),
      maxDepth: Number(r.maxDepth ?? 0),
      edits: Number(r.edits ?? 0),
      documents: Number(r.documents ?? 0),
      interactive: Number(r.interactive ?? 0),
      named: Number(r.named ?? 0),
      namedOnscreen: Number(r.namedOnscreen ?? 0),
      capped: r.capped === true,
      hydrationRechecked: r.hydrationRechecked === true,
      passANodes: Number(r.passANodes ?? 0),
      durationMs: Number(r.ms ?? 0),
    }
    return uiaVerdictFromStats(stats)
  }
}
