// App tab (WP2) — add-time security guards (adversary D1, design §7.1).
//
// Two independent gates, BOTH path-independent (lowercase exe basename):
//
//  1. LOLBIN_BASENAMES — hard deny, any policy, any kind, not overridable
//     (vault-blacklist philosophy). Adding powershell/cmd/mshta/… as an
//     "app" would make L0 launch a silent arbitrary-command primitive
//     (tier-collapse via add — the design's #1 threat). Includes companion's
//     own exe (self-add recursion) and interpreters (python/node/AutoHotkey).
//     Adversary D3 demoted this list to defense-in-depth behind the
//     structural rule "auto = L0 no-arg launch only", but it remains a
//     mandatory P1 gate (设计 §9 安全三件套).
//
//  2. basenameToVault — D1 BLOCKER: the vault blacklist (VAULT_WIN_APPS) is
//     an exact-match set enforced only on host_read/host_write tokens; it
//     does NOT propagate to the win.app.*/win.cli.* namespace on its own.
//     chrome.exe added as win.cli.chrome + --headless --dump-dom would read
//     any logged-in session DOM. So: vault-mapped basenames are denied for
//     the CLI track outright, and GUI vault apps may only do plain L0 launch
//     (never templates — P1 ships no templates anyway).

import { VAULT_WIN_APPS } from "../host-use/win/blacklist"
import type { AppKind } from "./types"

/** Companion's own exe name (packaged SEA binary) — self-add is denied. */
export const COMPANION_EXE_BASENAME = "cmspark-agent"

/**
 * Lowercase basenames WITHOUT extension. Match normalizes
 * path.basename(p).toLowerCase() and strips a single trailing .exe/.bat/.cmd/.com.
 */
export const LOLBIN_BASENAMES: ReadonlySet<string> = new Set([
  // shells / script hosts
  "powershell", "pwsh", "cmd", "wscript", "cscript", "mshta",
  // loader / execution proxies
  "rundll32", "regsvr32", "wmic", "wsl", "bash",
  // build / install execution proxies
  "msbuild", "installutil", "regasm",
  // misc lolbins
  "forfiles", "pcalua", "control",
  // terminal launchers (also vault-mapped below)
  "wt", "windowsterminal",
  // interpreters (arbitrary code by design)
  "python", "pythonw", "node", "autohotkey",
  // companion itself (self-add recursion / config self-modification surface)
  COMPANION_EXE_BASENAME,
])

/**
 * exe basename → vault blacklist token (D1). Covers the VAULT_WIN_APPS set's
 * spirit: password managers, browsers (session cookies + built-in password
 * managers), terminals/shells (scrollback may contain secrets), crypto
 * wallets. System credential surfaces (win.credential_manager, win.settings,
 * …) have no direct exe basename and are unreachable here by construction.
 */
const BASENAME_TO_VAULT_TOKEN: Readonly<Record<string, string>> = {
  // browsers
  chrome: "win.chrome",
  msedge: "win.edge",
  msedge_proxy: "win.edge",
  firefox: "win.firefox",
  brave: "win.brave",
  arc: "win.arc",
  opera: "win.opera",
  // password managers (GUI + CLI basename forms)
  op: "win.1password",
  "1password": "win.1password",
  bw: "win.bitwarden",
  bitwarden: "win.bitwarden",
  lastpass: "win.lastpass",
  dashlane: "win.dashlane",
  keepassxc: "win.keepassxc",
  keepass: "win.keepass",
  // terminals / shells (most are also lolbins; mapping matters for the
  // GUI-kind vault verdict and for audit messages)
  wt: "win.terminal",
  windowsterminal: "win.terminal",
  cmd: "win.cmd",
  powershell: "win.powershell",
  pwsh: "win.powershell",
  wsl: "win.wsl",
  bash: "win.wsl",
  // crypto wallets
  metamask: "win.metamask",
  exodus: "win.exodus",
  ledgerlive: "win.ledgerlive",
  electrum: "win.electrum",
}

/** Normalize an exe path (or bare name) to its lowercase extension-less basename. */
export function exeBasename(p: string): string {
  // Split on BOTH separators — guard logic must be deterministic whether the
  // host parsing the path is Windows or not (tests run cross-platform; the
  // targets are always Windows paths).
  const segments = String(p || "").split(/[\\/]/)
  let base = (segments[segments.length - 1] || "").toLowerCase()
  for (const ext of [".exe", ".bat", ".cmd", ".com"]) {
    if (base.endsWith(ext)) {
      base = base.slice(0, -ext.length)
      break
    }
  }
  return base
}

/** True when the exe basename is a hard-deny lolbin (any policy, any kind). */
export function isLolbinPath(p: string): boolean {
  return LOLBIN_BASENAMES.has(exeBasename(p))
}

/**
 * Map an exe path to its vault blacklist token, or null when unmapped.
 * The returned token is guaranteed to be a member of VAULT_WIN_APPS — a
 * stale mapping that drifted from the blacklist fails closed to "unmapped"
 * would be a silent hole, so we assert membership and throw in dev; in
 * production the mapping table above is kept in sync with blacklist.ts.
 */
export function basenameToVault(p: string): string | null {
  const token = BASENAME_TO_VAULT_TOKEN[exeBasename(p)] ?? null
  if (token !== null && !VAULT_WIN_APPS.has(token)) {
    // Mapping-table drift — fail loud, never silently unmapped.
    throw new Error(`apps guards: vault mapping "${token}" not present in VAULT_WIN_APPS (table drift)`)
  }
  return token
}

export type AddGuardVerdict =
  | { allowed: true; vaultToken: string | null; templatesAllowed: boolean }
  | { allowed: false; reason: "lolbin" | "vault_cli"; vaultToken: string | null; detail: string }

/**
 * D1 gate for apps.add. `exePath` may be any form (the caller canonicalizes
 * separately); matching is by basename only.
 *
 *  - lolbin basename          → hard deny (any kind, any policy)
 *  - vault-mapped + kind cli  → deny (D1: CLI track fully inherits the vault blacklist)
 *  - vault-mapped + kind gui  → allow, templatesAllowed=false (plain L0 launch only;
 *                               P1 ships no templates, so this is forward-looking for P2)
 *  - anything else            → allow
 */
export function checkAddAllowed(exePath: string, kind: AppKind): AddGuardVerdict {
  const base = exeBasename(exePath)
  if (LOLBIN_BASENAMES.has(base)) {
    return {
      allowed: false,
      reason: "lolbin",
      vaultToken: null,
      detail:
        `"${base}.exe" is a blocked interpreter/system binary — it cannot be added ` +
        `as an app at any policy (tier-collapse protection, design §7.1)`,
    }
  }
  const vaultToken = basenameToVault(exePath)
  if (vaultToken && kind === "cli") {
    return {
      allowed: false,
      reason: "vault_cli",
      vaultToken,
      detail:
        `"${base}.exe" maps to vault app "${vaultToken}" — password managers, browsers, ` +
        `terminals and wallets cannot be added to the CLI track (adversary D1: the vault ` +
        `blacklist fully applies to win.cli.*)`,
    }
  }
  return {
    allowed: true,
    vaultToken,
    templatesAllowed: vaultToken === null,
  }
}
