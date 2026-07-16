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

// Phase 0: only Mail is readable. Any other bundle id is rejected before
// dispatching to host.swift, regardless of blacklist status. This is a
// stricter check than the blacklist (Kimi phase0 review Critical #4).
export const READ_ALLOWED_APPS: ReadonlySet<string> = new Set([
  "com.apple.mail",
])

export function isVaultApp(application: string): boolean {
  return VAULT_BUNDLE_IDS.has(application)
}

export function isReadAllowed(application: string): boolean {
  return READ_ALLOWED_APPS.has(application)
}
