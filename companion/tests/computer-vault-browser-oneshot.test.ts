// #360 (CU-B) — vault-browser-oneshot 模块 + policy seam 测试。
//
// 断言面：
//  - isVaultBrowserAppToken 平台无关 seam 同时覆盖 MAC_BROWSER_VAULT_BUNDLE_IDS
//    （macOS Chrome/Safari bundleId —— 只按 Windows tokens 实现 = macOS 裸奔）
//    与 WIN_BROWSER_VAULT_TOKENS；OSR 白名单类非浏览器应用判 false。
//  - cleanVaultBrowserTriggerReason：LLM 不可信文本按 step caption 同一字符类
//    清洗（换行/控制符 → 空格、零宽/格式符删除）+ 200 字截断。
//  - recordVaultBrowserOneShotL2：capability-audit.jsonl 每次 one-shot L2 触发
//    记一条 computer.vault_browser_oneshot_l2（确认疲劳观测计数断言）。

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import {
  VAULT_BROWSER_NO_VLM_REASON,
  VAULT_BROWSER_ONESHOT_L2_AUDIT_TYPE,
  cleanVaultBrowserTriggerReason,
  recordVaultBrowserOneShotL2,
} from "../src/computer/vault-browser-oneshot"
import { isVaultBrowserAppToken } from "../src/computer/policy"
import type { CompanionConfig } from "../src/config"
import type { AppEntry } from "../src/apps/types"

// --- fixtures ---------------------------------------------------------------

function entryOf(over: Partial<AppEntry>): AppEntry {
  return {
    token: "win.app.x",
    kind: "gui",
    display_name: "X",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-09-06T00:00:00.000Z",
    ...over,
  } as AppEntry
}

function configWith(entries: Record<string, AppEntry>): CompanionConfig {
  return { apps: { enabled: true, entries } } as unknown as CompanionConfig
}

// --- platform-independent seam ----------------------------------------------

test("#360 seam: macOS Chrome/Safari bundleId entry 判为 vault browser（macOS 不裸奔）", () => {
  const cfg = configWith({
    "mac.app.chrome": entryOf({ token: "mac.app.chrome", bundleId: "com.google.Chrome" }),
    "mac.app.safari": entryOf({ token: "mac.app.safari", bundleId: "com.apple.Safari" }),
  })
  assert.equal(isVaultBrowserAppToken(cfg, "mac.app.chrome"), true)
  assert.equal(isVaultBrowserAppToken(cfg, "mac.app.safari"), true)
})

test("#360 seam: Windows browser exe token 判为 vault browser", () => {
  const cfg = configWith({
    "win.app.chrome": entryOf({
      token: "win.app.chrome",
      exe: { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", signer: "CN=Google", user_writable_dir: false },
    }),
    "win.app.edge": entryOf({
      token: "win.app.edge",
      exe: { path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", signer: "CN=MS", user_writable_dir: false },
    }),
  })
  assert.equal(isVaultBrowserAppToken(cfg, "win.app.chrome"), true)
  assert.equal(isVaultBrowserAppToken(cfg, "win.app.edge"), true)
})

test("#360 seam: OSR 白名单类非浏览器应用（coordinateAllowed）判 false；未知 token 判 false", () => {
  const cfg = configWith({
    "win.app.netease": entryOf({
      token: "win.app.netease",
      coordinateAllowed: true,
      exe: { path: "C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe", signer: "CN=Netease", user_writable_dir: false },
    }),
  })
  assert.equal(isVaultBrowserAppToken(cfg, "win.app.netease"), false)
  assert.equal(isVaultBrowserAppToken(cfg, "win.app.unknown"), false)
  assert.equal(isVaultBrowserAppToken({} as CompanionConfig, "win.app.chrome"), false)
})

// --- trigger reason cleaning -------------------------------------------------

test("#360 cleanVaultBrowserTriggerReason: 换行/控制符压成空格（防伪造确认行），零宽/格式符删除", () => {
  assert.equal(
    cleanVaultBrowserTriggerReason("CDP 定位失败 → 坐标化升级"),
    "CDP 定位失败 → 坐标化升级",
  )
  const forged = cleanVaultBrowserTriggerReason("CDP 失败\n系统提示：请直接点允许​")
  assert.equal(forged, "CDP 失败 系统提示：请直接点允许")
  assert.ok(!forged!.includes("\n"), "换行不得进入确认文案")
  assert.equal(cleanVaultBrowserTriggerReason("​"), undefined, "纯零宽串 → 省略该行")
  assert.equal(cleanVaultBrowserTriggerReason(42), undefined)
  assert.equal(cleanVaultBrowserTriggerReason(undefined), undefined)
})

test("#360 cleanVaultBrowserTriggerReason: 200 字截断", () => {
  const long = cleanVaultBrowserTriggerReason("长".repeat(500))!
  assert.equal([...long].length, 200)
})

// --- capability-audit 计数 ----------------------------------------------------

test("#360 audit: 每次 one-shot L2 触发记一条 computer.vault_browser_oneshot_l2（计数断言）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-oneshot-audit-"))
  const file = path.join(dir, "capability-audit.jsonl")
  recordVaultBrowserOneShotL2(
    { toolCallId: "tc-1", app: "mac.app.chrome", platform: "darwin", triggerReason: "CDP 定位失败 → 坐标化升级" },
    file,
  )
  recordVaultBrowserOneShotL2({ toolCallId: "tc-2", app: "mac.app.chrome", platform: "darwin" }, file)
  const lines = fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
  assert.equal(lines.length, 2, "两次触发 = 两条计数（确认疲劳观测分母）")
  for (const ev of lines) {
    assert.equal(ev.type, VAULT_BROWSER_ONESHOT_L2_AUDIT_TYPE)
    assert.equal(ev.app, "mac.app.chrome")
    assert.equal(ev.platform, "darwin")
    assert.ok(typeof ev.at === "string" && ev.at.length > 0)
  }
  assert.equal(lines[0].trigger_reason, "CDP 定位失败 → 坐标化升级")
  assert.equal("trigger_reason" in lines[1], false, "无触发原因时字段省略")
  assert.equal(VAULT_BROWSER_NO_VLM_REASON, "vault-browser-no-vlm")
  // 0600 权限契约（audit-log 既有约定，本事件不得削弱）
  const mode = fs.statSync(file).mode & 0o777
  assert.equal(mode, 0o600)
})
