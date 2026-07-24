// WP2 guards matrix — D1 add-time gates (lolbin hard-deny + vault mapping).
// Pure logic, no config/filesystem — runs on any platform.

import test from "node:test"
import * as assert from "node:assert/strict"

import {
  LOLBIN_BASENAMES,
  basenameToVault,
  checkAddAllowed,
  exeBasename,
  isLolbinPath,
} from "../src/apps/guards"
import { VAULT_WIN_APPS } from "../src/host-use/win/blacklist"

// --- exeBasename normalization ---------------------------------------------

test("exeBasename: strips directory + .exe, lowercases", () => {
  assert.equal(exeBasename("C:\\Windows\\System32\\cmd.exe"), "cmd")
  assert.equal(exeBasename("c:\\program files\\google\\chrome\\application\\CHROME.EXE"), "chrome")
  assert.equal(exeBasename("/unix/style/path/pwsh.exe"), "pwsh")
  assert.equal(exeBasename("node"), "node")
  assert.equal(exeBasename(""), "")
})

// WP2 review W1 — the old "strip ONE trailing extension" loop let
// "cmd.exe.exe" through as "cmd.exe" (not in the blocklist) even though the
// add-flow's `.exe$` check passes. Prefix-before-first-dot is fail-closed.
test("W1: multi-extension lolbin bypass is closed (cmd.exe.exe, cmd.fake.exe)", () => {
  assert.equal(exeBasename("C:\\Windows\\System32\\cmd.exe.exe"), "cmd")
  assert.equal(exeBasename("C:\\Temp\\cmd.fake.exe"), "cmd")
  assert.equal(exeBasename("C:\\Temp\\powershell.exe.bat.exe"), "powershell")
  for (const evil of [
    "C:\\Windows\\System32\\cmd.exe.exe",
    "C:\\Temp\\cmd.fake.exe",
    "C:\\Temp\\powershell.exe.bat.exe",
    "wscript.exe.exe",
  ]) {
    assert.ok(isLolbinPath(evil), `isLolbinPath(${evil}) must be true`)
    const verdict = checkAddAllowed(evil, "gui")
    assert.equal(verdict.allowed, false, `${evil} must be denied`)
  }
  // Fail-closed direction is intentional: a lolbin-FIRST-segment multi-dot
  // name is blocked; a benign multi-dot name still matches its own prefix.
  assert.equal(exeBasename("C:\\Apps\\my.tool.exe"), "my")
  assert.ok(!isLolbinPath("C:\\Apps\\my.tool.exe"))
  // Vault mapping still lands on multi-dot paths (msedge_proxy has no dot).
  assert.equal(basenameToVault("C:\\Google\\chrome.exe.exe"), "win.chrome")
})

// --- lolbin hard deny -------------------------------------------------------

const REQUIRED_LOLBINS = [
  "powershell", "pwsh", "cmd", "wscript", "cscript", "mshta", "rundll32",
  "regsvr32", "wmic", "wsl", "bash", "msbuild", "installutil", "regasm",
  "forfiles", "pcalua", "control", "wt", "windowsterminal", "python",
  "pythonw", "node", "autohotkey", "cmspark-agent",
]

test("LOLBIN_BASENAMES covers the required D1/D3 set incl. companion self", () => {
  for (const name of REQUIRED_LOLBINS) {
    assert.ok(LOLBIN_BASENAMES.has(name), `missing lolbin basename: ${name}`)
  }
})

for (const name of REQUIRED_LOLBINS) {
  test(`lolbin "${name}" denied for gui AND cli, case + path variants`, () => {
    const variants = [
      `C:\\Dir\\${name}.exe`,
      `C:\\Dir\\${name.toUpperCase()}.EXE`,
      `${name}.exe`,
      `${name.toUpperCase()}`,
      `D:\\some\\where\\${name}.exe`,
    ]
    for (const v of variants) {
      assert.ok(isLolbinPath(v), `isLolbinPath(${v}) must be true`)
      for (const kind of ["gui", "cli"] as const) {
        const verdict = checkAddAllowed(v, kind)
        assert.equal(verdict.allowed, false, `${v} (${kind}) must be denied`)
        if (!verdict.allowed) assert.equal(verdict.reason, "lolbin")
      }
    }
  })
}

test("non-lolbin lookalikes are NOT denied (substring must not match)", () => {
  // e.g. "powershell_ise" is a vault app name but not the lolbin basename; and
  // "my-node-app" contains "node" but is a distinct basename.
  assert.ok(!isLolbinPath("C:\\apps\\my-node-app.exe"))
  assert.ok(!isLolbinPath("C:\\apps\\powershell_ise.exe"))
  assert.ok(!isLolbinPath("C:\\apps\\nodepad.exe"))
})

// --- vault mapping ----------------------------------------------------------

test("basenameToVault: browsers / password managers / terminals / wallets", () => {
  const cases: Array<[string, string]> = [
    ["C:\\Google\\chrome.exe", "win.chrome"],
    ["C:\\Edge\\msedge.exe", "win.edge"],
    ["C:\\Edge\\msedge_proxy.exe", "win.edge"],
    ["C:\\Mozilla\\firefox.exe", "win.firefox"],
    ["C:\\Brave\\brave.exe", "win.brave"],
    ["C:\\Arc\\arc.exe", "win.arc"],
    ["C:\\Opera\\opera.exe", "win.opera"],
    ["C:\\cli\\op.exe", "win.1password"],
    ["C:\\apps\\1Password.exe", "win.1password"],
    ["C:\\cli\\bw.exe", "win.bitwarden"],
    ["C:\\apps\\Bitwarden.exe", "win.bitwarden"],
    ["C:\\apps\\KeePassXC.exe", "win.keepassxc"],
    ["C:\\apps\\KeePass.exe", "win.keepass"],
    ["C:\\apps\\wt.exe", "win.terminal"],
    ["C:\\apps\\WindowsTerminal.exe", "win.terminal"],
    ["C:\\w\\MetaMask.exe", "win.metamask"],
    ["C:\\w\\exodus.exe", "win.exodus"],
    ["C:\\w\\LedgerLive.exe", "win.ledgerlive"],
    ["C:\\w\\electrum.exe", "win.electrum"],
  ]
  for (const [p, token] of cases) {
    assert.equal(basenameToVault(p), token, `${p} must map to ${token}`)
  }
  assert.equal(basenameToVault("C:\\apps\\spotify.exe"), null)
  assert.equal(basenameToVault("C:\\apps\\cloudmusic.exe"), null)
})

test("basenameToVault: every mapped token exists in VAULT_WIN_APPS (no drift)", () => {
  // Spot-check via the public function across a spread of basenames — the
  // function itself throws on drift, but assert the set relationship too.
  const mapped = new Set<string>()
  for (const b of ["chrome", "msedge", "firefox", "brave", "arc", "opera", "op", "bw", "keepassxc", "keepass", "wt", "windowsterminal", "metamask", "exodus", "ledgerlive", "electrum"]) {
    const t = basenameToVault(`${b}.exe`)
    assert.ok(t, `${b} must be mapped`)
    mapped.add(t!)
  }
  for (const t of mapped) assert.ok(VAULT_WIN_APPS.has(t), `${t} must be in VAULT_WIN_APPS`)
})

// --- checkAddAllowed verdicts ------------------------------------------------

test("vault-mapped + kind cli → denied (D1: CLI track inherits vault blacklist)", () => {
  for (const p of ["C:\\Google\\chrome.exe", "C:\\cli\\bw.exe", "C:\\cli\\op.exe"]) {
    const verdict = checkAddAllowed(p, "cli")
    assert.equal(verdict.allowed, false, `${p} cli must be denied`)
    if (!verdict.allowed) {
      assert.equal(verdict.reason, "vault_cli")
      assert.ok(verdict.vaultToken)
    }
  }
})

test("vault-mapped + kind gui → allowed but templates forbidden (plain L0 only)", () => {
  const verdict = checkAddAllowed("C:\\Google\\chrome.exe", "gui")
  assert.equal(verdict.allowed, true)
  if (verdict.allowed) {
    assert.equal(verdict.vaultToken, "win.chrome")
    assert.equal(verdict.templatesAllowed, false)
  }
})

test("normal app → allowed, templates allowed, no vault token", () => {
  for (const kind of ["gui", "cli"] as const) {
    const verdict = checkAddAllowed("C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe", kind)
    assert.equal(verdict.allowed, true)
    if (verdict.allowed) {
      assert.equal(verdict.vaultToken, null)
      assert.equal(verdict.templatesAllowed, true)
    }
  }
})

test("lolbin denial wins over vault mapping (wt.exe is both)", () => {
  const verdict = checkAddAllowed("C:\\apps\\wt.exe", "gui")
  assert.equal(verdict.allowed, false)
  if (!verdict.allowed) assert.equal(verdict.reason, "lolbin")
})
