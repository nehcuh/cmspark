// App tab WP4 — pure UI-logic tests (node:test harness, sidepanel-state.test.ts
// precedent). Covers the W1 thread-trust eligibility matrix (host_read vs
// host_app vs host_write vs other) and the policy badge / cap helpers that
// drive AppsPanel rendering.

import test from "node:test"
import assert from "node:assert/strict"
import {
  appsPlatformSupported,
  autoEligible,
  appWarnReasons,
  canOfferThreadTrust,
  ellipsizePath,
  isAppsErrorMessage,
  policyBadge,
  threadTrustHint,
} from "../src/sidepanel/utils/apps-utils"
import { uiaCapableBadge } from "../src/sidepanel/utils/computer-utils"

// --- W1: canOfferThreadTrust matrix ---

test("thread-trust checkbox: host_read WITH relevant app → offered (W7 read-only lock)", () => {
  assert.equal(canOfferThreadTrust("host_read", "win.outlook.classic"), true)
})

test("thread-trust checkbox: host_app WITH relevant app → offered (owner decision 2, app-launch exception)", () => {
  assert.equal(canOfferThreadTrust("host_app", "win.app.cloudmusic"), true)
})

test("thread-trust checkbox: host_write NEVER offered, even with relevant app (Q1 ship blocker)", () => {
  assert.equal(canOfferThreadTrust("host_write", "win.onenote.desktop"), false)
})

test("thread-trust checkbox: other tools / missing app → not offered", () => {
  assert.equal(canOfferThreadTrust("evaluate", "win.app.x"), false)
  assert.equal(canOfferThreadTrust("osascript_eval", "com.apple.mail"), false)
  assert.equal(canOfferThreadTrust("host_read", undefined), false)
  assert.equal(canOfferThreadTrust("host_app", ""), false)
  assert.equal(canOfferThreadTrust(undefined, "win.app.x"), false)
})

test("thread-trust hint copy: host_app is launch-scoped; host_read keeps the original verbatim", () => {
  assert.match(threadTrustHint("host_app"), /仅对启动此应用生效/)
  assert.equal(threadTrustHint("host_read"), "（切换会话后失效；不影响写操作）")
  // Unknown tools fall back to the read copy (checkbox is hidden for them anyway).
  assert.equal(threadTrustHint("evaluate"), "（切换会话后失效；不影响写操作）")
})

// --- Policy badge honesty (D3) ---

test("policy badge: auto is honestly labeled 全自动(仅启动免确认) — never bare 全自动", () => {
  const b = policyBadge("auto")
  assert.equal(b.label, "全自动(仅启动免确认)")
  assert.match(b.title, /带参数操作仍需确认/)
})

test("policy badge: ai → AI 判断 (yellow), manual → 每次确认 (green)", () => {
  assert.equal(policyBadge("ai").label, "AI 判断")
  assert.equal(policyBadge("manual").label, "每次确认")
})

// --- Warning reasons + auto cap ---

test("appWarnReasons: user-writable dir and unsigned each produce a reason", () => {
  const warns = appWarnReasons({
    exe: { path: "C:\\Users\\x\\AppData\\Local\\app.exe", user_writable_dir: true },
  })
  assert.deepEqual(warns, ["同用户进程可替换此文件", "未签名"])
})

test("appWarnReasons: UNC path flagged; signed Program Files exe is clean", () => {
  assert.deepEqual(
    appWarnReasons({ exe: { path: "\\\\share\\tools\\app.exe", signer: "CN=X", user_writable_dir: false } }),
    ["网络共享路径"],
  )
  assert.deepEqual(
    appWarnReasons({ exe: { path: "C:\\Program Files\\App\\app.exe", signer: "CN=X", user_writable_dir: false } }),
    [],
  )
  // AUMID entries have no exe block — no warning reasons (UWP badge instead).
  assert.deepEqual(appWarnReasons({}), [])
})

test("autoEligible: only max_policy=auto entries may upgrade to 全自动", () => {
  assert.equal(autoEligible({ max_policy: "auto" }), true)
  assert.equal(autoEligible({ max_policy: "ai" }), false)
  assert.equal(autoEligible({}), false)
})

// --- Path ellipsis ---

test("ellipsizePath: short paths unchanged; long paths keep head + tail", () => {
  const short = "C:\\app.exe"
  assert.equal(ellipsizePath(short), short)
  const long = "C:\\Program Files (x86)\\Some Very Long Vendor Name\\Product\\Bin\\application.exe"
  const out = ellipsizePath(long, 42)
  assert.ok(out.length <= 43) // ellipsis char counts once
  assert.ok(out.includes("…"))
  assert.ok(out.startsWith("C:\\"))
  assert.ok(out.endsWith("application.exe"))
})

// --- WP6a Finding 1: apps error routing (family discriminator) ---
// useWebSocket's "error" case dispatches SET_APPS_ERROR (panel error area)
// when isAppsErrorMessage is true, and falls through to ADD_MESSAGE (chat
// stream) when false. The pure function IS the routing decision.

test("apps error routing: family=apps sends lowercase add-flow codes to the PANEL (SET_APPS_ERROR), not chat", () => {
  // WP4 routed by an uppercase code set, so these AddFlowError codes
  // (duplicate_app et al.) leaked into the chat stream.
  for (const code of [
    "duplicate_app",
    "not_an_exe",
    "path_and_aumid_exclusive",
    "absolute_path_required",
    "not_found",
    "lolbin_denied",
    "vault_cli_denied",
  ]) {
    assert.equal(isAppsErrorMessage({ family: "apps", code }), true, `${code} must route to the panel`)
  }
  // Family alone suffices — code-less emissions (pollution guard, schema belt).
  assert.equal(isAppsErrorMessage({ family: "apps" }), true)
  assert.equal(isAppsErrorMessage({ family: "apps", error: "Invalid config keys detected" }), true)
})

test("apps error routing: legacy code set is the backward-compat fallback (pre-WP6a companion, no family)", () => {
  assert.equal(isAppsErrorMessage({ code: "BIOMETRIC_DENIED" }), true)
  assert.equal(isAppsErrorMessage({ code: "POLICY_CAP_EXCEEDED" }), true)
  assert.equal(isAppsErrorMessage({ code: "PRESET_NOT_REMOVABLE" }), true)
  assert.equal(isAppsErrorMessage({ code: "PLATFORM_UNSUPPORTED" }), true)
})

test("apps error routing: non-apps errors still fall through to the chat stream", () => {
  assert.equal(isAppsErrorMessage({ code: "SOME_OTHER_ERROR" }), false)
  assert.equal(isAppsErrorMessage({ family: "mcp", code: "SOME_OTHER_ERROR" }), false)
  assert.equal(isAppsErrorMessage({ error: "plain message, no code/family" }), false)
  assert.equal(isAppsErrorMessage({}), false)
  // A bare lowercase add-flow code WITHOUT family does not match the legacy
  // set — pinning the exact gap the family tag fixes (only pre-WP6a
  // companions can emit this shape).
  assert.equal(isAppsErrorMessage({ code: "duplicate_app" }), false)
})

// --- WP6a Finding 2: platform gating for the add/enumerate UI ---

test("appsPlatformSupported: win32 + unknown (null/undefined) → UI enabled; other platforms → honest 仅 Windows 可用 state", () => {
  assert.equal(appsPlatformSupported("win32"), true)
  // Unknown platform (pre-WP6a companion sent no platform field) must NOT
  // disable the UI — backward compatible default.
  assert.equal(appsPlatformSupported(null), true)
  assert.equal(appsPlatformSupported(undefined), true)
  assert.equal(appsPlatformSupported("darwin"), false)
  assert.equal(appsPlatformSupported("linux"), false)
})

// --- 坐标 computer-use(WP4 WI-6):uiaCapable 三态徽标 ---
// 中性能力措辞,绝不渲染成安全背书(WP3 §K.5:非权限位的探测提示)。

test("uiaCapableBadge: true → 「UIA」蓝(能力提示,非安全背书)", () => {
  const b = uiaCapableBadge({ uiaCapable: true, uiaProbedAt: "2026-07-20T00:00:00Z" })
  assert.equal(b.label, "UIA")
  assert.match(b.title, /能力提示，非安全背书/)
  assert.equal(/人工设定/.test(b.title), false)
  // 蓝系配色(与 policyBadge 的色板约定一致:label/color/bg 三件套)。
  assert.ok(b.color.length > 0 && b.bg.length > 0)
})

test("uiaCapableBadge: false → 「OCR」灰,title 说明 UIA 不可用走 OCR 定位", () => {
  const b = uiaCapableBadge({ uiaCapable: false, uiaProbedAt: "2026-07-20T00:00:00Z" })
  assert.equal(b.label, "OCR")
  assert.match(b.title, /UIA 不可用，走 OCR 定位/)
  assert.match(b.title, /非安全背书/)
})

test("uiaCapableBadge: undefined → 「未探测」点灰,title 说明首次坐标任务时自动探测", () => {
  const b = uiaCapableBadge({})
  assert.equal(b.label, "未探测")
  assert.match(b.title, /首次坐标任务时自动探测/)
  assert.equal(/人工设定/.test(b.title), false)
})

test("uiaCapableBadge: 手设覆盖——uiaCapable 有值但 uiaProbedAt 缺失 → title 标注「人工设定」", () => {
  // WP3 §K.5:config.json 里可手工写 uiaCapable,此时没有探测时间戳。
  assert.match(uiaCapableBadge({ uiaCapable: true }).title, /人工设定/)
  assert.match(uiaCapableBadge({ uiaCapable: false }).title, /人工设定/)
  assert.match(uiaCapableBadge({ uiaCapable: true, uiaProbedAt: "" }).title, /人工设定/)
  // 探测时间戳存在 = 机器探测结果,不标人工。
  assert.equal(/人工设定/.test(uiaCapableBadge({ uiaCapable: false, uiaProbedAt: "2026-07-20T00:00:00Z" }).title), false)
})
