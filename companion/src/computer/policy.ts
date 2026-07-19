// A10 / §E.2 — coordinate capability policy gates (fail-closed).
//
// Default-deny on TWO independent switches (A10):
//   1. global config computer.coordinateEnabled (default false)
//   2. per-app AppEntry.coordinateAllowed (default false)
// Both are set only through the biometric gate (apps/biometric-gate.ts reuse);
// either being off hard-fails every coordinate tool call. Vault-mapped and
// LOLBIN apps are STRUCTURALLY excluded — the bit can never be set on them,
// and this module re-checks at execution time (config-tamper belt).

import * as path from "path"
import type { CompanionConfig } from "../config"
import type { AppEntry } from "../apps/types"
import { basenameToVault, isLolbinPath } from "../apps/guards"
import { APP_TOKEN_PATTERN } from "../apps/types"
import { ComputerError, type WindowInfo } from "./types"

/**
 * Structural eligibility — vault-mapped (browser/password-manager/terminal/
 * wallet) and LOLBIN exes can NEVER carry coordinateAllowed (A10.3).
 */
export function canEverCoordinate(entry: AppEntry): boolean {
  if (entry.exe?.path) {
    if (isLolbinPath(entry.exe.path)) return false
    if (basenameToVault(entry.exe.path) !== null) return false
  }
  return true
}

/**
 * The full A10 + whitelist gate. Returns the entry on success; throws a typed
 * ComputerError otherwise. Pure over the passed config — injectable in tests.
 */
export function assertCoordinateAllowed(cfg: CompanionConfig, token: string): AppEntry {
  if (!APP_TOKEN_PATTERN.test(token)) {
    throw new ComputerError("APP_NOT_WHITELISTED", `computer: invalid app token "${token}"`)
  }
  const appsCfg = cfg.apps
  if (!appsCfg || appsCfg.enabled === false) {
    throw new ComputerError("APP_NOT_WHITELISTED", "computer: the Apps feature is disabled")
  }
  // Switch 1 — global (A10.1). Hand-edited config.json with the flag set is an
  // explicit owner opt-in (ADR-010); the UI path always goes through the
  // biometric gate (computer/handlers.ts).
  if (cfg.computer?.coordinateEnabled !== true) {
    throw new ComputerError(
      "COMPUTER_DISABLED",
      "computer: coordinate computer-use is disabled globally (computer.coordinateEnabled=false)",
    )
  }
  const entry = appsCfg.entries?.[token]
  if (!entry) {
    throw new ComputerError(
      "APP_NOT_WHITELISTED",
      `computer: unknown app token "${token}" — not in the App-tab whitelist`,
    )
  }
  if (!entry.enabled) {
    throw new ComputerError(
      "APP_NOT_WHITELISTED",
      `computer: app "${entry.display_name}" (${token}) is disabled in the App tab`,
    )
  }
  if (entry.kind !== "gui") {
    throw new ComputerError("APP_NOT_WHITELISTED", `computer: "${token}" is not a gui app`)
  }
  // Structural exclusion is re-checked here even though the bit cannot be set
  // through any handler — a hand-edited config must not smuggle it in.
  if (!canEverCoordinate(entry)) {
    throw new ComputerError(
      "APP_COORDINATE_STRUCTURAL",
      `computer: "${token}" maps to a vault/LOLBIN binary — coordinate operation is structurally denied`,
    )
  }
  // Switch 2 — per-app (A10.2).
  if (entry.coordinateAllowed !== true) {
    throw new ComputerError(
      "APP_COORDINATE_DENIED",
      `computer: app "${entry.display_name}" (${token}) has coordinateAllowed=false`,
    )
  }
  return entry
}

/** NTFS-insensitive, separator-normalized path comparison (§E.2.1). */
export function normalizeExePath(p: string): string {
  return path.resolve(p).replace(/\//g, "\\").toLowerCase()
}

/**
 * §E.2.1/B5 — hwnd ownership: the window's process exe must resolve to the
 * SAME binary recorded in the AppEntry. Re-checked before every injection
 * (window replacement / pid reuse mid-task stops the task, fail-closed).
 * WP2: the RESOLVED exe also passes the vault/LOLBIN structural recheck —
 * a whitelisted-looking entry whose hwnd now belongs to a browser/LOLBIN
 * process (config tamper, path swap) is denied at execution time, same as
 * `win/adapter.ts`'s vacuous recheck philosophy (§E.2.2).
 */
export function assertHwndOwnedByEntry(info: WindowInfo, entry: AppEntry): void {
  if (!info.alive) {
    throw new ComputerError("HWND_DEAD", `computer: hwnd ${info.hwnd} is no longer a live window`)
  }
  const entryPath = entry.exe?.path
  if (!entryPath) {
    throw new ComputerError("HWND_NOT_OWNED", `computer: app "${entry.token}" has no exe path to bind`)
  }
  if (!info.exePath || normalizeExePath(info.exePath) !== normalizeExePath(entryPath)) {
    throw new ComputerError(
      "HWND_NOT_OWNED",
      `computer: hwnd ${info.hwnd} belongs to "${info.exePath ?? "unknown"}", not the whitelisted "${entryPath}" — refusing to inject`,
      { hwnd: info.hwnd, actual: info.exePath, expected: entryPath },
    )
  }
  // WP2: defensive structural recheck on the RESOLVED exe (not just the
  // recorded entry config) — the coordinate path re-denies vault/LOLBIN at
  // the moment of truth.
  if (isLolbinPath(info.exePath!) || basenameToVault(info.exePath!) !== null) {
    throw new ComputerError(
      "APP_COORDINATE_STRUCTURAL",
      `computer: hwnd ${info.hwnd} resolves to a vault/LOLBIN binary "${info.exePath}" — coordinate operation is structurally denied`,
      { hwnd: info.hwnd, actual: info.exePath },
    )
  }
}

/**
 * WP2: exe sha256 drift vs the add-time record (§E.2.1 optional hardening).
 * Computed ONCE per task (hashing per action would re-read a multi-MB binary
 * on every step; the per-action path+structural checks above stay fresh).
 * Drift = the binary on disk no longer matches what the owner whitelisted —
 * for coordinate injection this fails CLOSED (the plan's "drift -> manual"
 * downgrade means: the task stops and a human must re-review the entry).
 */
export function assertExeNotDrifted(entry: AppEntry, hashFile: (p: string) => string): void {
  const recorded = entry.exe?.sha256
  const exePath = entry.exe?.path
  if (!recorded || !exePath) return // no add-time record — nothing to compare
  let actual: string
  try {
    actual = hashFile(exePath)
  } catch (err) {
    throw new ComputerError(
      "APP_EXE_DRIFT",
      `computer: could not hash "${exePath}" for the drift check (${String((err as Error)?.message ?? err)}) — fail-closed`,
    )
  }
  if (actual.toLowerCase() !== recorded.toLowerCase()) {
    throw new ComputerError(
      "APP_EXE_DRIFT",
      `computer: "${exePath}" sha256 drifted since add-time — the whitelisted binary was replaced; refusing coordinate operation until the entry is re-reviewed`,
      { expected: recorded.toLowerCase(), actual: actual.toLowerCase() },
    )
  }
}
