// #396 — settings-web token 化 hygiene 测试。
//
// 断言（T1 表现层，零行为变化）：
//   1. SETTINGS_HTML 无 Material palette hex 实际使用（#4A90D9/#4CAF50/#F44336/
//      #FFC107/#1a1a2e/#16213e/#0f3460/#EF5350/#FF9800）——CSS 值与内联 style 均不得含。
//   2. CSS 变量单一来源：`:root` 块存在且含 dark 语义键（bg/elevated/text/muted/
//      accent/success/danger/warning）；CSS 规则引用 `var(--…)` 而非裸 hex。
//   3. 无残留的 `rgba(76,175,80` / `rgba(244,67,54` / `rgba(255,193,7`（Material
//      RGB 的 alpha 变体也清）。
//   4. 字阶对齐侧栏家族（11/12/13/15 + 页标题 20，无 14px 中间档）。

import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as http from "node:http"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { SETTINGS_HTML } from "../src/settings-web"

// Material palette（tokens.ts:185 明令禁止的那套）——不得作为实际颜色使用。
const MATERIAL_HEX = [
  "#4A90D9",
  "#4CAF50",
  "#F44336",
  "#EF5350",
  "#FFC107",
  "#FF9800",
  "#1a1a2e",
  "#16213e",
  "#0f3460",
]
const MATERIAL_RGB = ["rgba(76,175,80", "rgba(244,67,54", "rgba(255,193,7"]

test("settings-web: 无 Material palette hex 实际使用", () => {
  // 取 <style> 块 + body 内联 style，剔除 :root 注释行中的说明性 hex
  // （注释保留禁止清单供文档，但注释行以 /* 开头、非实际 CSS 值）。
  const lines = SETTINGS_HTML.split("\n")
  const cssValueLines = lines.filter(
    (l) => !l.trim().startsWith("/*") && !l.trim().startsWith("*") && !l.trim().startsWith("//"),
  )
  const body = cssValueLines.join("\n")
  for (const hex of MATERIAL_HEX) {
    assert.ok(
      !body.toLowerCase().includes(hex.toLowerCase()),
      `Material hex 不得作为实际 CSS 值: ${hex}`,
    )
  }
  for (const rgb of MATERIAL_RGB) {
    assert.ok(!body.includes(rgb), `Material rgba 变体不得残留: ${rgb}`)
  }
})

test("settings-web: CSS 变量单一来源 — :root 有 dark 语义键且规则引用 var()", () => {
  // :root 变量块存在
  assert.ok(SETTINGS_HTML.includes(":root{"), "必须声明 :root CSS 变量块")
  const rootBlock = SETTINGS_HTML.slice(
    SETTINGS_HTML.indexOf(":root{"),
    SETTINGS_HTML.indexOf("}", SETTINGS_HTML.indexOf(":root{")),
  )
  // dark 语义键齐备
  for (const key of ["--bg:", "--elevated:", "--text:", "--muted:", "--accent:", "--success:", "--danger:", "--warning:"]) {
    assert.ok(rootBlock.includes(key), `:root 缺 ${key}`)
  }
  // 主 CSS 规则区（:root 之后）中，颜色值应通过 var() 引用——抽查已知规则
  const rules = SETTINGS_HTML.slice(SETTINGS_HTML.indexOf("</style>"))
  const styleRules = SETTINGS_HTML.slice(SETTINGS_HTML.indexOf("body{"), SETTINGS_HTML.indexOf("</style>"))
  assert.ok(styleRules.includes("background:var(--bg)"), "body 背景用 var(--bg)")
  assert.ok(styleRules.includes("var(--success)"), "成功语义用 var(--success)")
  assert.ok(styleRules.includes("var(--danger)"), "危险语义用 var(--danger)")
  assert.ok(styleRules.includes("var(--warning)"), "警告语义用 var(--warning)")
  assert.ok(styleRules.includes("var(--accent)"), "主色用 var(--accent)")
})

test("settings-web: 字阶对齐侧栏家族（11/12/13/15 + 页标题 20），无 14px 残留", () => {
  const styleRules = SETTINGS_HTML.slice(SETTINGS_HTML.indexOf("body{"), SETTINGS_HTML.indexOf("</style>"))
  for (const size of ["font-size:11px", "font-size:12px", "font-size:13px", "font-size:15px", "font-size:20px"]) {
    assert.ok(styleRules.includes(size), `保留字阶 ${size}`)
  }
  assert.ok(!SETTINGS_HTML.includes("font-size:14px"), "无 14px 中间档（对齐侧栏 11/12/13/15 家族）")
})

// --- 服务端真实渲染验证（GET / 返回 token 化 HTML，非仅字符串常量检查） ---

let startSettingsServer: typeof import("../src/settings-web").startSettingsServer
let stopSettingsServer: typeof import("../src/settings-web").stopSettingsServer
let saveConfig: typeof import("../src/config").saveConfig
let getConfig: typeof import("../src/config").getConfig

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-tokens-settings-"))
let started: { port: number; token: string } | null = null

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = tempHome
  const sw = await import("../src/settings-web")
  const cfg = await import("../src/config")
  startSettingsServer = sw.startSettingsServer
  stopSettingsServer = sw.stopSettingsServer
  saveConfig = cfg.saveConfig
  getConfig = cfg.getConfig
  await cfg.initDataDir()
  saveConfig({ port: 23491, llm: { api_key: "sk-test", base_url: "https://x", model_name: "m", temperature: 0.7, context_window: 128000 } })
  started = await startSettingsServer(23491)
})

after(() => {
  try {
    stopSettingsServer()
  } catch {
    /* ignore */
  }
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function getPage(path: string, port: number, token: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: "GET", host: "127.0.0.1", port, path: `${path}?token=${encodeURIComponent(token)}` },
      (res) => {
        let body = ""
        res.on("data", (c) => (body += c.toString()))
        res.on("end", () => resolve({ status: res.statusCode || 0, body }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

test("settings-web 服务端渲染: GET / 返回 token 化 HTML（含 :root、无 Material 值）", async () => {
  assert.ok(started, "server must start")
  const { status, body } = await getPage("/", started!.port, started!.token)
  assert.equal(status, 200)
  assert.ok(body.includes("<!DOCTYPE html>"), "返回 HTML 页")
  assert.ok(body.includes(":root{"), "渲染页含 CSS 变量单一来源")
  assert.ok(body.includes("var(--bg)"), "body 背景走 var")
  for (const hex of ["#4A90D9", "#4CAF50", "#F44336", "#1a1a2e", "#16213e", "#0f3460", "#FFC107"]) {
    assert.ok(!body.includes(hex), `渲染页不得含 Material hex: ${hex}`)
  }
  assert.ok(body.includes("CMspark Global Settings"), "设置标题保留")
})
