// Unit tests for companion/src/host-use/win/blacklist.ts
//
// Mirrors tests/host-use-blacklist.test.ts (darwin): vault set coverage,
// read-whitelist exact size, and whitelist rejection of non-vaulted unknowns.

import test from "node:test"
import assert from "node:assert/strict"

import {
  VAULT_WIN_APPS,
  READ_ALLOWED_WIN_APPS,
  isVaultApp,
  isReadAllowed,
} from "../src/host-use/win/blacklist.js"

test("vault set covers password managers, browsers, terminals, crypto wallets", () => {
  for (const app of [
    "win.1password",
    "win.bitwarden",
    "win.keepassxc",
    "win.credential_manager",
    "win.chrome",
    "win.edge",
    "win.firefox",
    "win.brave",
    "win.terminal",
    "win.powershell",
    "win.powershell_ise",
    "win.metamask",
    "win.exodus",
    "win.ledgerlive",
  ]) {
    assert.ok(isVaultApp(app), `expected ${app} on vault blacklist`)
  }
})

test("vault lookup is exact — case variants and unknowns are not vaulted", () => {
  assert.equal(isVaultApp("WIN.CHROME"), false)
  assert.equal(isVaultApp("win.outlook.classic"), false)
  assert.equal(isVaultApp("com.google.Chrome"), false) // darwin token ≠ win token
})

test("read whitelist is EXACTLY the three win tokens (plan §D.7)", () => {
  assert.equal(READ_ALLOWED_WIN_APPS.size, 3)
  assert.ok(isReadAllowed("win.outlook.classic"))
  assert.ok(isReadAllowed("win.onenote.desktop"))
  assert.ok(isReadAllowed("win.fs"))
})

test("whitelist rejects non-vaulted unknowns (whitelist is the second gate)", () => {
  // Not on the vault list, but still not read-allowed — mirrors darwin's
  // vault→whitelist two-gate contract (Kimi phase0 review Critical #4).
  assert.equal(isReadAllowed("win.word"), false)
  assert.equal(isReadAllowed("win.chrome"), false) // vaulted AND not allowed
  assert.equal(isReadAllowed("com.apple.mail"), false) // darwin token ≠ win token
  assert.equal(isReadAllowed(""), false)
})

test("both sets are exported as ReadonlySet with expected types", () => {
  assert.ok(VAULT_WIN_APPS instanceof Set)
  assert.ok(READ_ALLOWED_WIN_APPS instanceof Set)
  assert.ok(VAULT_WIN_APPS.size >= 20, "vault set should be meaningfully populated")
})
