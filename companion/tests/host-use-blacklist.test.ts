// Unit tests for companion/src/host-use/darwin/blacklist.ts
//
// The vault-app denylist + Phase 0 whitelist gate host_read before the Swift
// binary is invoked. These tests verify the gating logic in isolation.

import test from "node:test"
import assert from "node:assert/strict"

import {
  isVaultApp,
  isReadAllowed,
  VAULT_BUNDLE_IDS,
  READ_ALLOWED_APPS,
} from "../src/host-use/darwin/blacklist.js"

test("VAULT_BUNDLE_IDS covers password managers (1Password / Bitwarden / LastPass / Dashlane / KeePassXC)", () => {
  assert.ok(VAULT_BUNDLE_IDS.has("com.agilebits.onepassword-osx"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.1password.1password"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.bitwarden.desktop"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.lastpass.lastpassmacdesktop"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.dashlane.dashlane"))
  assert.ok(VAULT_BUNDLE_IDS.has("org.keepassx.keepassxc"))
})

test("VAULT_BUNDLE_IDS covers Apple system credentials (Keychain / SecurityAgent / Settings / Wallet)", () => {
  assert.ok(VAULT_BUNDLE_IDS.has("com.apple.keychainaccess"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.apple.SecurityAgent"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.apple.systempreferences"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.apple.Passbook"))
})

test("VAULT_BUNDLE_IDS covers browsers with built-in password managers", () => {
  assert.ok(VAULT_BUNDLE_IDS.has("com.apple.Safari"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.google.Chrome"))
  assert.ok(VAULT_BUNDLE_IDS.has("org.mozilla.firefox"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.microsoft.edgemac"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.brave.Browser"))
})

test("VAULT_BUNDLE_IDS covers terminals (scrollback may contain secrets)", () => {
  assert.ok(VAULT_BUNDLE_IDS.has("com.apple.Terminal"))
  assert.ok(VAULT_BUNDLE_IDS.has("com.googlecode.iterm2"))
})

test("isVaultApp returns true for known vault apps", () => {
  assert.equal(isVaultApp("com.1password.1password"), true)
  assert.equal(isVaultApp("com.apple.keychainaccess"), true)
  assert.equal(isVaultApp("com.apple.Safari"), true)
})

test("isVaultApp returns false for Mail (not blacklisted — Mail is the Phase 0 target)", () => {
  assert.equal(isVaultApp("com.apple.mail"), false)
  assert.equal(isVaultApp("com.apple.Notes"), false)
})

test("isVaultApp case-sensitive (bundle ids are case-sensitive in macOS)", () => {
  assert.equal(isVaultApp("COM.APPLE.KEYCHAINACCESS"), false)
  assert.equal(isVaultApp("com.1Password.1Password"), false)
})

test("READ_ALLOWED_APPS Phase 0 whitelist is Mail-only", () => {
  assert.equal(READ_ALLOWED_APPS.size, 1, "Phase 0 must restrict to exactly 1 app")
  assert.ok(READ_ALLOWED_APPS.has("com.apple.mail"))
})

test("isReadAllowed returns true for Mail, false for Finder/Notes (Phase 0 scope)", () => {
  assert.equal(isReadAllowed("com.apple.mail"), true)
  assert.equal(isReadAllowed("com.apple.finder"), false)
  assert.equal(isReadAllowed("com.apple.Notes"), false)
})

test("isReadAllowed returns false even for apps NOT on blacklist (defense in depth)", () => {
  // com.apple.Photos is not blacklisted (no secret material assumption) but
  // also not whitelisted for Phase 0 read. Must be rejected.
  assert.equal(isReadAllowed("com.apple.Photos"), false)
})
