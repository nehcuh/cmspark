// WP2 add-flow — canonicalization, guards, signer/warning matrix, duplicates.
// All fs/signer interactions are injected; paths are built per-platform so the
// file runs green on any host.

import test, { after, before } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
  AddFlowError,
  buildAppEntry,
  expandEnvVars,
  type AddFlowDeps,
} from "../src/apps/add-flow"
import { maxPolicyForEntry, type AppEntry } from "../src/apps/types"

const WIN = process.platform === "win32"
const SYS_EXE = WIN ? "C:\\Program Files\\TestApp\\app.exe" : "/opt/testapp/app.exe"
const CLOUD_EXE = WIN
  ? "C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe"
  : "/opt/netease/cloudmusic.exe"

// A real directory under a USERPROFILE root for the user-writable cases.
let uwRoot = ""
let savedUserProfile: string | undefined

before(() => {
  uwRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apps-addflow-uw-"))
  savedUserProfile = process.env.USERPROFILE
  process.env.USERPROFILE = uwRoot
})

after(() => {
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  try { fs.rmSync(uwRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
})

function deps(overrides: Partial<AddFlowDeps> = {}): AddFlowDeps {
  return {
    realpath: (p) => p, // identity canonicalization (junction/8.3 covered by guards tests)
    exists: () => true,
    signerProbe: async () => "CN=Test Signer, O=Test Corp",
    now: () => new Date("2026-07-18T10:00:00.000Z"),
    ...overrides,
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "gui" as const,
    path: SYS_EXE,
    origin: "enumerate" as const,
    existingEntries: {} as Record<string, AppEntry>,
    ...overrides,
  }
}

// --- happy paths -------------------------------------------------------------

test("signed Program Files exe → signer recorded, no cap, auto-eligible, no warnings", async () => {
  const { entry, warnings } = await buildAppEntry(baseInput(), deps())
  assert.equal(entry.kind, "gui")
  assert.equal(entry.source, "user")
  assert.equal(entry.policy, "manual")
  assert.equal(entry.enabled, true)
  assert.equal(entry.exe?.path, SYS_EXE)
  assert.equal(entry.exe?.signer, "CN=Test Signer, O=Test Corp")
  assert.equal(entry.exe?.user_writable_dir, false)
  assert.equal(maxPolicyForEntry(entry), "auto")
  assert.deepEqual(warnings, [])
  assert.match(entry.token, /^win\.app\.app$/)
  assert.equal(entry.added_at, "2026-07-18T10:00:00.000Z")
})

test("unsigned exe → unsigned_binary warning + policy cap ai", async () => {
  const { entry, warnings } = await buildAppEntry(
    baseInput(),
    deps({ signerProbe: async () => undefined }),
  )
  assert.equal(entry.exe?.signer, undefined)
  assert.equal(maxPolicyForEntry(entry), "ai")
  assert.ok(warnings.some((w) => w.code === "unsigned_binary"))
})

test("signer probe failure → treated as unsigned + signer_probe_failed warning", async () => {
  const { entry, warnings } = await buildAppEntry(
    baseInput(),
    deps({ signerProbe: async () => { throw new Error("ps exploded") } }),
  )
  assert.equal(entry.exe?.signer, undefined)
  assert.equal(maxPolicyForEntry(entry), "ai")
  assert.ok(warnings.some((w) => w.code === "signer_probe_failed"))
  // probe failure already explains the unsigned state — no duplicate unsigned warning
  assert.ok(!warnings.some((w) => w.code === "unsigned_binary"))
})

test("user-writable dir → user_writable_dir warning + stamped true + cap ai", async () => {
  const uwExe = path.join(uwRoot, "Tools", "tool.exe")
  const { entry, warnings } = await buildAppEntry(baseInput({ path: uwExe }), deps())
  assert.equal(entry.exe?.user_writable_dir, true)
  assert.equal(maxPolicyForEntry(entry), "ai") // signed but user-writable still caps
  assert.ok(warnings.some((w) => w.code === "user_writable_dir"))
})

test("manual-paste origin → social-bridge warning; enumerate origin → none", async () => {
  const pasted = await buildAppEntry(baseInput({ origin: "manual-paste" }), deps())
  assert.ok(pasted.warnings.some((w) => w.code === "manual_paste_origin"))
  const enumerated = await buildAppEntry(baseInput({ origin: "enumerate" }), deps())
  assert.ok(!enumerated.warnings.some((w) => w.code === "manual_paste_origin"))
})

test("vault-mapped GUI exe → allowed with vault_app_no_templates warning", async () => {
  const chromePath = WIN ? "C:\\Google\\chrome.exe" : "/opt/google/chrome.exe"
  const { entry, warnings } = await buildAppEntry(baseInput({ path: chromePath }), deps())
  assert.equal(entry.exe?.path, chromePath)
  assert.ok(warnings.some((w) => w.code === "vault_app_no_templates"))
})

test("CJK display name keeps token slug from exe basename", async () => {
  const { entry } = await buildAppEntry(
    baseInput({ path: CLOUD_EXE, displayName: "网易云音乐" }),
    deps(),
  )
  assert.equal(entry.display_name, "网易云音乐")
  assert.equal(entry.token, "win.app.cloudmusic")
})

test("token collision → deterministic _2 suffix", async () => {
  const existing: Record<string, AppEntry> = {
    "win.app.app": { token: "win.app.app" } as AppEntry,
  }
  const { entry } = await buildAppEntry(baseInput({ existingEntries: existing }), deps())
  assert.equal(entry.token, "win.app.app_2")
})

// --- denials / invalid input -------------------------------------------------

test("lolbin target → lolbin_denied (any kind)", async () => {
  const cmdPath = WIN ? "C:\\Windows\\System32\\cmd.exe" : "/windows/system32/cmd.exe"
  for (const kind of ["gui", "cli"] as const) {
    await assert.rejects(
      buildAppEntry(baseInput({ path: cmdPath, kind }), deps()),
      (e: any) => e instanceof AddFlowError && e.code === "lolbin_denied",
    )
  }
})

test("vault-mapped exe + kind cli → vault_cli_denied", async () => {
  const chromePath = WIN ? "C:\\Google\\chrome.exe" : "/opt/google/chrome.exe"
  await assert.rejects(
    buildAppEntry(baseInput({ path: chromePath, kind: "cli" }), deps()),
    (e: any) => e instanceof AddFlowError && e.code === "vault_cli_denied",
  )
})

test("relative path → absolute_path_required", async () => {
  await assert.rejects(
    buildAppEntry(baseInput({ path: "tools\\app.exe" }), deps()),
    (e: any) => e instanceof AddFlowError && e.code === "absolute_path_required",
  )
})

test("non-.exe target → not_an_exe", async () => {
  const batPath = WIN ? "C:\\tools\\run.bat" : "/opt/tools/run.bat"
  await assert.rejects(
    buildAppEntry(baseInput({ path: batPath }), deps()),
    (e: any) => e instanceof AddFlowError && e.code === "not_an_exe",
  )
})

test("missing file → not_found", async () => {
  await assert.rejects(
    buildAppEntry(baseInput(), deps({ exists: () => false })),
    (e: any) => e instanceof AddFlowError && e.code === "not_found",
  )
})

test("realpath failure → not_found", async () => {
  await assert.rejects(
    buildAppEntry(baseInput(), deps({ realpath: () => { throw new Error("EPERM") } })),
    (e: any) => e instanceof AddFlowError && e.code === "not_found",
  )
})

test("duplicate canonical path → duplicate_app", async () => {
  const existing: Record<string, AppEntry> = {
    "win.app.app": {
      token: "win.app.app",
      exe: { path: SYS_EXE, user_writable_dir: false },
    } as AppEntry,
  }
  await assert.rejects(
    buildAppEntry(baseInput({ existingEntries: existing }), deps()),
    (e: any) => e instanceof AddFlowError && e.code === "duplicate_app",
  )
})

test("path AND aumid → path_and_aumid_exclusive", async () => {
  await assert.rejects(
    buildAppEntry(baseInput({ aumid: "Pkg!App" }), deps()),
    (e: any) => e instanceof AddFlowError && e.code === "path_and_aumid_exclusive",
  )
})

// --- AUMID branch --------------------------------------------------------------

test("aumid pick → gui entry, no exe block, cap ai, aumid_no_signer warning", async () => {
  const { entry, warnings } = await buildAppEntry(
    baseInput({ path: undefined, aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", displayName: "Calculator" }),
    deps(),
  )
  assert.equal(entry.kind, "gui")
  assert.equal(entry.aumid, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")
  assert.equal(entry.exe, undefined)
  assert.equal(maxPolicyForEntry(entry), "ai") // review note ⑤: AUMID always caps ai
  assert.ok(warnings.some((w) => w.code === "aumid_no_signer"))
})

test("invalid aumid shape → not_an_exe typed error", async () => {
  await assert.rejects(
    buildAppEntry(baseInput({ path: undefined, aumid: "not-an-aumid" }), deps()),
    (e: any) => e instanceof AddFlowError && e.code === "not_an_exe",
  )
})

test("duplicate aumid (case-insensitive) → duplicate_app", async () => {
  const existing: Record<string, AppEntry> = {
    "win.app.calc": { token: "win.app.calc", aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" } as AppEntry,
  }
  await assert.rejects(
    buildAppEntry(
      baseInput({ path: undefined, aumid: "microsoft.windowscalculator_8WEKYB3D8BBWE!app", existingEntries: existing }),
      deps(),
    ),
    (e: any) => e instanceof AddFlowError && e.code === "duplicate_app",
  )
})

// --- env expansion helper ------------------------------------------------------

test("expandEnvVars expands %VAR% and leaves unknown vars literal", () => {
  process.env.APPS_TEST_DIR = WIN ? "C:\\TestDir" : "/tmp/testdir"
  try {
    assert.equal(
      expandEnvVars("%APPS_TEST_DIR%\\sub\\app.exe"),
      `${process.env.APPS_TEST_DIR}\\sub\\app.exe`,
    )
    assert.equal(expandEnvVars("%NO_SUCH_VAR_NEVER%\\x.exe"), "%NO_SUCH_VAR_NEVER%\\x.exe")
  } finally {
    delete process.env.APPS_TEST_DIR
  }
})

test("%VAR% paste expands before the absolute-path check (win32 path)", { skip: !WIN }, async () => {
  process.env.APPS_TEST_SYS = "C:\\Program Files\\TestApp"
  try {
    const { entry } = await buildAppEntry(baseInput({ path: "%APPS_TEST_SYS%\\app.exe" }), deps())
    assert.equal(entry.exe?.path, SYS_EXE)
  } finally {
    delete process.env.APPS_TEST_SYS
  }
})
