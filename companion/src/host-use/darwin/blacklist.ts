// macOS bundle-id denylist for host_read. Apps in this set are NEVER accessible
// via host_read regardless of agent request or user approval — god-mode cannot
// bypass (Round 1 §3.3 N13). This is the first line of defense; AX role +
// window-title heuristics are the second line (Phase 1).

export const VAULT_BUNDLE_IDS: ReadonlySet<string> = new Set([
  // Password managers
  "com.agilebits.onepassword-osx",      // 1Password 7
  "com.1password.1password",            // 1Password 8
  "com.1password.1password-launcher",
  "com.bitwarden.desktop",
  "com.lastpass.lastpassmacdesktop",
  "com.dashlane.dashlane",
  "org.keepassx.keepassxc",
  "com.microsoft.autoupdate.keepassx", // keepassx variant

  // Apple system credentials
  "com.apple.keychainaccess",
  "com.apple.SecurityAgent",
  "com.apple.systempreferences",
  "com.apple.settings",
  "com.apple.Passbook",                 // Wallet
  "com.apple.authenticatorcored",       // 2FA authenticator

  // Browsers (built-in password managers)
  "com.apple.Safari",
  "com.google.Chrome",
  "org.mozilla.firefox",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "company.thebrowser.Browser",         // Arc
  "com.mighty.app",

  // Terminal / SSH (scrollback may contain secrets)
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.todesktop.230313mzl4w4u92",      // Warp
  "com.neovide.neovide",

  // Crypto wallets
  "io.metamask",
  "com.ledger.live",
  "com.exodus.exodus",
  "org.electrum.electrum",
])

// Phase 1 W7 (Q4 expansion per W7 final doc): Notes + Finder added so the
// inline checkbox is functional for non-Mail reads. Without this expansion,
// the checkbox is inert (Pi-sub structural finding — would-block-Phase-1-ship).
// Finder "read" is metadata-only (size, mod date); file CONTENT reads still
// go through MCP filesystem, not host_read.
export const READ_ALLOWED_APPS: ReadonlySet<string> = new Set([
  "com.apple.mail",
  "com.apple.Notes",
  "com.apple.finder",
])

export function isVaultApp(application: string): boolean {
  return VAULT_BUNDLE_IDS.has(application)
}

export function isReadAllowed(application: string): boolean {
  return READ_ALLOWED_APPS.has(application)
}
