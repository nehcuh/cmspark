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
import * as os from "os"
import type { CompanionConfig } from "../config"
import type { AppEntry } from "../apps/types"
import { basenameToVault, isLolbinPath } from "../apps/guards"
import { APP_TOKEN_PATTERN } from "../apps/types"
import { ComputerError, type WindowInfo } from "./types"

/**
 * macOS vault bundle IDs — structural exclusion set (WP3 + adversarial review H6).
 * Apps whose bundle ID matches any entry here can NEVER carry coordinateAllowed
 * as a persistent Apps bit. Browsers may still take a one-shot L2 path
 * (`allowVaultBrowserOneShot`); LOLBIN / password-managers / terminals / wallets
 * remain impossible even with L2.
 */
export const MAC_BROWSER_VAULT_BUNDLE_IDS: ReadonlySet<string> = new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.canary",
  "com.google.Chrome.dev",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "company.thebrowser.Browser",     // Arc
  "com.brave.Browser",              // Brave
  "com.microsoft.edgemac",          // Edge
  "com.microsoft.edgemac.beta",
  "com.operasoftware.Opera",
  "com.vivaldi.Vivaldi",
  "org.chromium.Chromium",
])

export const WIN_BROWSER_VAULT_TOKENS: ReadonlySet<string> = new Set([
  "win.chrome",
  "win.edge",
  "win.firefox",
  "win.brave",
  "win.arc",
  "win.opera",
])

const MAC_VAULT_BUNDLE_IDS = new Set([
  // 密码管理器
  "com.agilebits.onepassword7",
  "com.1password.1password", // 1Password 8
  "com.bitwarden.desktop",
  "com.lastpass.lastpassmacdesktop",
  "com.dashlane.dashlanephonefinal",
  "com.keepassxc.keepassxc",
  // 浏览器 (persistent coordinateAllowed still denied; one-shot L2 is separate)
  ...MAC_BROWSER_VAULT_BUNDLE_IDS,
  // 终端 + 编辑器
  "com.apple.Terminal", "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "com.github.wez.wezterm",
  "net.kovidgoyal.kitty",
  // 系统安全
  "com.apple.keychainaccess", "com.apple.systempreferences",
  "com.apple.Passwords",            // macOS Sequoia Passwords.app
  "com.apple.Wallet",               // Wallet (信用卡/票券)
  "com.apple.Authenticator",        // 内置认证器
  // 认证器
  "com.google.Authenticator", "com.authy.authy-mac",
  // 加密钱包
  "com.metamask.MetaMask", "com.ledger.live", "com.exodus.Exodus",
  "com.coinbase.wallet",
  // SSH/密钥管理
  "com.maxgoedjen.secretive.Secretive",
])

function bundleIdInSet(id: string | undefined, set: ReadonlySet<string>): boolean {
  if (!id) return false
  if (set.has(id)) return true
  const lower = id.toLowerCase()
  for (const x of set) {
    if (x.toLowerCase() === lower) return true
  }
  return false
}

/** Windows exe identity (tests / probes). Production classifiers key off `platform`. */
export function looksLikeWinExePath(p: string): boolean {
  const s = String(p || "")
  return /\.exe$/i.test(s) || /^[a-zA-Z]:[\\/]/.test(s)
}

function vaultPathIsBrowser(p: string): boolean {
  try {
    const tok = basenameToVault(p)
    return tok != null && WIN_BROWSER_VAULT_TOKENS.has(tok)
  } catch {
    return false
  }
}

/**
 * True when the AppEntry is a browser vault surface (Chrome/Safari/…).
 * Identity is platform-native (Trust REJECT 2026-08-22 nits fold):
 *   win32  → exe path only (pasted mac bundleId on notepad.exe is not a browser)
 *   darwin → bundleId wins when present (dummy.exe must not un-vault Chrome)
 */
export function isVaultBrowserEntry(entry: AppEntry, platform: string = os.platform()): boolean {
  if (platform === "win32") {
    return entry.exe?.path ? vaultPathIsBrowser(entry.exe.path) : false
  }
  if (bundleIdInSet(entry.bundleId, MAC_BROWSER_VAULT_BUNDLE_IDS)) return true
  return entry.exe?.path ? vaultPathIsBrowser(entry.exe.path) : false
}

/**
 * #360 (CU-B) platform-independent seam: is this whitelisted app token a
 * vault browser surface RIGHT NOW? Resolves the entry and delegates to
 * isVaultBrowserEntry — which keys off exe identity on win32 and bundleId on
 * darwin, covering BOTH WIN_BROWSER_VAULT_TOKENS and
 * MAC_BROWSER_VAULT_BUNDLE_IDS. Callers (dispatch / audit) must use this
 * instead of re-implementing a Windows-tokens-only check (that would leave
 * macOS browsers unprotected).
 */
export function isVaultBrowserAppToken(cfg: CompanionConfig, token: string): boolean {
  const entry = cfg.apps?.entries?.[token]
  return entry ? isVaultBrowserEntry(entry) : false
}

export function isBrowserVaultExePath(p: string): boolean {
  try {
    const tok = basenameToVault(p)
    return tok != null && WIN_BROWSER_VAULT_TOKENS.has(tok)
  } catch {
    return false
  }
}

export type CoordinateAssertOpts = {
  /**
   * host_computer admission only. Lets a vault *browser* through without the
   * persistent coordinateAllowed bit. Unattended/cruise/G1 MUST still not skip
   * the task L2 (enforced in l2-admission + executor). Never used by
   * apps.set_coordinate_allowed.
   */
  allowVaultBrowserOneShot?: boolean
}

/**
 * Structural eligibility — vault-mapped (browser/password-manager/terminal/
 * wallet) and LOLBIN exes can NEVER carry coordinateAllowed (A10.3).
 * macOS: vault bundle IDs are structurally excluded.
 */
export function canEverCoordinate(entry: AppEntry, platform: string = os.platform()): boolean {
  if (platform === "win32") {
    // Exe path is the identity — ignore a pasted mac bundleId.
    if (entry.exe?.path) {
      if (isLolbinPath(entry.exe.path)) return false
      try {
        if (basenameToVault(entry.exe.path) !== null) return false
      } catch {
        return false
      }
    }
    return true
  }
  // darwin / others: bundleId is native identity. Case-insensitive so
  // Chrome Canary/Dev stored as com.google.chrome.canary still fail closed.
  // dummy.exe on a Chrome bundle must NOT un-vault (Trust nits REJECT).
  if (bundleIdInSet(entry.bundleId, MAC_VAULT_BUNDLE_IDS)) {
    return false
  }
  if (entry.exe?.path) {
    if (isLolbinPath(entry.exe.path)) return false
    try {
      if (basenameToVault(entry.exe.path) !== null) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * The full A10 + whitelist gate. Returns the entry on success; throws a typed
 * ComputerError otherwise. Pure over the passed config — injectable in tests.
 */
export function assertCoordinateAllowed(
  cfg: CompanionConfig,
  token: string,
  opts?: CoordinateAssertOpts,
): AppEntry {
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
  // Vault browsers: persistent bit still denied (canEverCoordinate false);
  // host_computer may pass allowVaultBrowserOneShot and skip the bit (L2 required).
  if (!canEverCoordinate(entry)) {
    if (opts?.allowVaultBrowserOneShot === true && isVaultBrowserEntry(entry)) {
      return entry
    }
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
export function assertHwndOwnedByEntry(
  info: WindowInfo,
  entry: AppEntry,
  opts?: CoordinateAssertOpts,
): void {
  if (!info.alive) {
    throw new ComputerError("HWND_DEAD", `computer: hwnd ${info.hwnd} is no longer a live window`)
  }
  // macOS WP3: ownership is by bundleId; Windows: ownership is by exe path
  const entryPath = os.platform() === "darwin"
    ? (entry.bundleId ?? entry.exe?.path ?? "")
    : (entry.exe?.path ?? "")
  const isMacEntry = os.platform() === "darwin" && entry.bundleId != null
  if (!entryPath) {
    throw new ComputerError("HWND_NOT_OWNED", `computer: app "${entry.token}" has no exe path or bundleId to bind`)
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
  // the moment of truth. macOS entries (bundleId) skip this Windows-only path.
  if (!isMacEntry && info.exePath) {
    if (isLolbinPath(info.exePath)) {
      throw new ComputerError(
        "APP_COORDINATE_STRUCTURAL",
        `computer: hwnd ${info.hwnd} resolves to a vault/LOLBIN binary "${info.exePath}" — coordinate operation is structurally denied`,
        { hwnd: info.hwnd, actual: info.exePath },
      )
    }
    const browserHwnd =
      opts?.allowVaultBrowserOneShot === true &&
      isVaultBrowserEntry(entry) &&
      isBrowserVaultExePath(info.exePath)
    if (!browserHwnd && basenameToVault(info.exePath) !== null) {
      throw new ComputerError(
        "APP_COORDINATE_STRUCTURAL",
        `computer: hwnd ${info.hwnd} resolves to a vault/LOLBIN binary "${info.exePath}" — coordinate operation is structurally denied`,
        { hwnd: info.hwnd, actual: info.exePath },
      )
    }
  }
}

/**
 * WP2: exe sha256 drift vs the add-time record (§E.2.1 optional hardening).
 * Computed ONCE per task (hashing per action would re-read a multi-MB binary
 * on every step; the per-action path+structural checks above stay fresh).
 * Drift = the binary on disk no longer matches what the owner whitelisted —
 * for coordinate injection this fails CLOSED (the plan's "drift -> manual"
 * downgrade means: the task stops and a human must re-review the entry).
 *
 * macOS: no-op — code signing is the trust anchor (adversarial review M5).
 */
export function assertExeNotDrifted(entry: AppEntry, hashFile: (p: string) => string): void {
  // macOS entries use code signing as the integrity anchor — no binary hash drift check
  const isMacEntry = os.platform() === "darwin" && entry.bundleId != null
  if (isMacEntry) return
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
