// Windows app-token denylist for host_read / host_write. Apps in this set are
// NEVER accessible via host_use regardless of agent request or user approval —
// god-mode cannot bypass (Round 1 §3.3 N13). Mirrors darwin/blacklist.ts; the
// token scheme is "win.<app>" because Windows has no bundle-id equivalent and
// our TargetId grammar (win:<app>:<root>:<kind>-<id>) already constrains which
// apps are addressable at all.

export const VAULT_WIN_APPS: ReadonlySet<string> = new Set([
  // Password managers
  "win.1password",
  "win.bitwarden",
  "win.lastpass",
  "win.dashlane",
  "win.keepassxc",
  "win.keepass",

  // Windows system credential surfaces
  "win.credential_manager",
  "win.settings",
  "win.control_panel",
  "win.authenticator",

  // Browsers (built-in password managers + session cookies)
  "win.chrome",
  "win.edge",
  "win.firefox",
  "win.brave",
  "win.arc",
  "win.opera",

  // Terminal / shells (scrollback may contain secrets)
  "win.terminal",
  "win.cmd",
  "win.powershell",
  "win.powershell_ise",
  "win.wsl",

  // Crypto wallets
  "win.metamask",
  "win.exodus",
  "win.ledgerlive",
  "win.electrum",
])

// Phase 1 W8-windows: exactly the three tokens the win TargetId grammar can
// produce. Read whitelist mirrors darwin's READ_ALLOWED_APPS contract (a
// non-vaulted unknown app is still rejected — whitelist is the second gate).
// win.fs "read" is metadata-only (path, mtime); file CONTENT reads still go
// through MCP filesystem, not host_read.
export const READ_ALLOWED_WIN_APPS: ReadonlySet<string> = new Set([
  "win.outlook.classic",
  "win.onenote.desktop",
  "win.fs",
])

export function isVaultApp(app: string): boolean {
  return VAULT_WIN_APPS.has(app)
}

export function isReadAllowed(app: string): boolean {
  return READ_ALLOWED_WIN_APPS.has(app)
}
