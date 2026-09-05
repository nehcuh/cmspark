// GitHub #322: SETTINGS_REQUIRED structured errors for restricted capabilities.
//
// Covers:
//  * netsec_port_scan with module off → error_code SETTINGS_REQUIRED + fixed
//    settings_path (the ticket's acceptance case)
//  * module on + allowlist empty → SETTINGS_REQUIRED (allowlist_empty)
//  * module on + allowlist set + no task auth → stays NETSEC_SCOPE_DENIED
//    (gate semantics unchanged — only install-level config gaps get the pointer)
//  * pure helpers: checkNetsecScope reason taxonomy, unmapped tool → null

import "./_security-gates-setup.js"
import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"

import { createToolExecutor, seedExtensionWsAuthForTests } from "../../src/server.js"
import { saveConfig, getConfig } from "../../src/config.js"
import { checkNetsecScope } from "../../src/netsec/scope.js"
import {
  TOOL_SETTINGS_POINTERS,
  settingsRequiredResult,
} from "../../src/capability/settings-pointer.js"

function mockWs(): any {
  const ws = { readyState: 1 /* WebSocket.OPEN */, send: () => { /* swallow tool.start */ } }
  seedExtensionWsAuthForTests(ws as any)
  return ws
}

const NETSEC_PATH = "设置 → 本机与集成 → 网络扫描（NetSec）"

beforeEach(() => {
  // Fresh throwaway config per test (CMSPARK_DATA_DIR is the temp dir from
  // _security-gates-setup): modules default to disabled.
  saveConfig({ modules: undefined } as any)
  const cfg: any = getConfig()
  cfg.modules = undefined
})

test("#322 netsec_port_scan with module disabled → SETTINGS_REQUIRED + fixed path", async () => {
  const executeTool = createToolExecutor(mockWs())
  const result = await executeTool("tc-sr-1", "netsec_port_scan", {
    targets: ["scan.example.com"],
  })
  assert.equal(result.success, false)
  assert.equal(result.data?.error_code, "SETTINGS_REQUIRED")
  assert.equal(result.data?.settings_path, NETSEC_PATH, "path must be the fixed map string")
  assert.equal(result.data?.settings_section, "integrations")
  assert.equal(result.data?.reason, "module_disabled")
  // The model-facing error repeats the same fixed path (no free-form pointer).
  assert.ok((result.error || "").includes(`settings_path: ${NETSEC_PATH}`))
  // Base error first line preserved — retry/classify semantics unchanged.
  assert.ok((result.error || "").startsWith("module_disabled:netsec"))
})

test("#322 netsec module enabled + empty allowlist → SETTINGS_REQUIRED (allowlist_empty)", async () => {
  saveConfig({
    modules: {
      netsec: { available: true, enabled: true, target_allowlist: [], require_task_auth: true },
    },
  } as any)
  const executeTool = createToolExecutor(mockWs())
  const result = await executeTool("tc-sr-2", "netsec_port_scan", {
    targets: ["scan.example.com"],
  })
  assert.equal(result.success, false)
  assert.equal(result.data?.error_code, "SETTINGS_REQUIRED")
  assert.equal(result.data?.reason, "allowlist_empty")
  assert.equal(result.data?.settings_path, NETSEC_PATH)
})

test("#322 task-auth denial stays NETSEC_SCOPE_DENIED (no blanket relabel)", async () => {
  saveConfig({
    modules: {
      netsec: {
        available: true,
        enabled: true,
        target_allowlist: ["scan.example.com"],
        require_task_auth: true,
      },
    },
  } as any)
  const executeTool = createToolExecutor(mockWs())
  const result = await executeTool("tc-sr-3", "netsec_port_scan", {
    targets: ["scan.example.com"],
  })
  assert.equal(result.success, false)
  assert.notEqual(result.data?.error_code, "SETTINGS_REQUIRED")
  assert.equal(result.data?.error_code, "NETSEC_SCOPE_DENIED")
})

test("checkNetsecScope reason taxonomy (pure)", () => {
  const disabled = checkNetsecScope({
    targets: ["scan.example.com"],
    allowlist: ["scan.example.com"],
    requireTaskAuth: true,
    moduleEnabled: false,
  })
  assert.equal(disabled.ok, false)
  assert.equal(disabled.ok === false && disabled.reason, "module_disabled")

  const empty = checkNetsecScope({
    targets: ["scan.example.com"],
    allowlist: [],
    requireTaskAuth: true,
    moduleEnabled: true,
  })
  assert.equal(empty.ok === false && empty.reason, "allowlist_empty")

  const noAuth = checkNetsecScope({
    targets: ["scan.example.com"],
    allowlist: ["scan.example.com"],
    requireTaskAuth: true,
    taskAuth: null,
    moduleEnabled: true,
  })
  assert.equal(noAuth.ok === false && noAuth.reason, "task_auth_missing")

  const denied = checkNetsecScope({
    targets: ["other.example.com"],
    allowlist: ["scan.example.com"],
    requireTaskAuth: false,
    moduleEnabled: true,
  })
  assert.equal(denied.ok === false && denied.reason, "targets_denied")
})

test("settingsRequiredResult: unmapped tool keeps legacy shape", () => {
  assert.equal(settingsRequiredResult("shell_exec", "module_disabled:shell — nope", "module_disabled"), null)
  // v1 map is netsec-only (shell's module power lives on the 场景 panel — no
  // deep-linkable settings section yet).
  assert.deepEqual(Object.keys(TOOL_SETTINGS_POINTERS).sort(), ["netsec_port_scan"])
})

test("settingsRequiredResult: fixed strings only — no arming phrase anywhere", () => {
  const r = settingsRequiredResult("netsec_port_scan", "module_disabled:netsec — x", "module_disabled")
  assert.ok(r)
  const blob = JSON.stringify(r)
  assert.ok(!blob.includes("我了解风险"), "pointer payload must never quote the arming phrase")
  assert.equal(r?.data.settings_path, TOOL_SETTINGS_POINTERS["netsec_port_scan"].settings_path)
})
