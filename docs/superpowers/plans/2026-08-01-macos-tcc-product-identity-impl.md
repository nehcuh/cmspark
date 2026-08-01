# macOS TCC 产品身份统一 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Packaged CMspark.app 上，屏幕录制/辅助功能的用户路径只认 **CMspark**；ScreenCaptureKit 与注入运行在主产品身份二进制中，禁止引导用户勾选 node / cmspark-host。

**Architecture:** 方案 D（见 SoT spec）：现有 `host.swift` 逻辑扶正为 `Contents/MacOS/CMspark` Mach-O；嵌入 `com.cmspark.agent`；默认无参启动 tray（spawn Resources/node）；所有 CU 子命令仍由同一二进制执行。开发态继续产出 `dist/cmspark-host` 以兼容测试路径。

**Tech Stack:** Swift host, bash packaging (`create-dmg.sh` / `package.sh`), TypeScript `host-bin.ts`, Vitest/node:test gates.

**SoT design:** [../specs/2026-08-01-macos-tcc-product-identity-design.md](../specs/2026-08-01-macos-tcc-product-identity-design.md)  
**Adversarial gates:** Spec §5–§6（A1–A20 / DoD）— 每个 Task 映射到攻击项。

**Dual external review (2026-08-01-152315):** Claude + Pi → **both `APPROVE_WITH_NITS`**, `both_ok=true`  
- Claude: `docs/audit/reviews/macos-tcc-product-identity-claude-20260801-152315.md`  
- Pi: `docs/audit/reviews/macos-tcc-product-identity-pi-20260801-152315.md`  
- Verdict JSON: `docs/audit/reviews/macos-tcc-product-identity-verdict-20260801-152315.json`  

### Dual-review amendments (must apply during execution)

| ID | Source | Amendment |
|----|--------|-----------|
| **DR-N1** | Pi | Task 1.2: **do not** rely on `codesign -d --info-plist=-` (fails on macOS 26.5). Primary gate = `strings` / `otool -s __TEXT __info_plist` + plutil; document why. |
| **DR-N2** | Claude | Task 4: after codesign, assert CDHash of `MacOS/CMspark` **equals** `Resources/cmspark-host` (A6 testable). |
| **DR-N3** | Pi | Task 5.1 rg: also match `permission for cmspark-host` and `not Accessibility-trusted` (hits `darwin-estop.ts` + `host.swift` split wording). |
| **DR-N4** | Claude | Task 2.3: **explicit** `arch -arm64` — use `/usr/bin/arch -arm64` wrapper when spawning node (match old launcher), or document universal-node arm64 default in code comment **and** ship note. Prefer arch wrapper for parity. |
| **DR-N5** | Pi | Canonical display name: set `scripts/macos/Info.plist` `CFBundleDisplayName` to **`CMspark`** (align with embedded host plist); avoid "CMspark Agent" vs "CMspark" split. |
| **DR-N6** | Both | P0 scope = **DMG / create-dmg path only**; `install-daemon.sh` remains P1-4 — user docs must not equate daemon install with fixed TCC identity. |
| **DR-N7** | Claude | Task 2.5 comment scrub **before** Task 1.2 strings gate that bans `com.cmspark.host` (order: 2.5 then re-run 1.2, or relax gate to **plist section only** via otool). Prefer: Task 1 only checks embedded plist content; Task 2 scrubs source comments. |

---

## File map（先锁边界）

| File | Responsibility |
|------|----------------|
| `companion/src/host-use/darwin/host-Info.plist` | 产品身份：agent id + CMspark 名 |
| `companion/src/host-use/darwin/host.swift` | 默认 tray 启动；host-scripts 路径；用户可见错误串 |
| `companion/src/host-use/darwin/host-skylight.swift` | 与 host.swift 用户串对齐（若仍维护） |
| `companion/src/host-use/darwin/build-host.sh` | 构建后身份断言；可选 install name 注释 |
| `companion/src/host-use/darwin/host-bin.ts` | packaged 优先 `MacOS/CMspark` |
| `scripts/create-dmg.sh` | **废 bash launcher**；安装 Mach-O 为主入口 |
| `scripts/package.sh` | staging 保持 `cmspark-host` 名（兼容） |
| `scripts/macos/Info.plist` | 与嵌入身份一致（已是 agent） |
| `scripts/tests/test-package-gates.sh` | Mach-O + 禁止 bash 主入口 gate |
| `companion/src/computer/executor.ts` | CAPTURE_FAILED 文案 |
| `companion/src/computer/darwin-estop.ts` | Accessibility 用户串 |
| `companion/src/computer/self-ui.ts` | 身份列表（兼容） |
| `docs/computer-use-user-guide.md` | 仅授权 CMspark |
| `companion/tests/host-bin-resolve.test.ts` | **新建** resolve 单测 |

---

## Task 0: 对抗基线冻结（只读）

**Files:** none (evidence only)

- [ ] **Step 0.1: 记录当前失败身份**

```bash
# 若已安装
file /Applications/CMspark.app/Contents/MacOS/CMspark
codesign -dv --verbose=4 /Applications/CMspark.app/Contents/Resources/cmspark-host 2>&1 | head -20
ps aux | grep -E 'cmspark-host|CMspark.app.*node' | grep -v grep
```

Expected (pre-fix): MacOS/CMspark = bash/script；host Identifier=`com.cmspark.host`.

- [ ] **Step 0.2: 记下一条近期 -3801 日志路径**（可选，对照验收）

Do not change code in Task 0.

---

## Task 1: 嵌入产品身份（D5, A4）

**Files:**
- Modify: `companion/src/host-use/darwin/host-Info.plist`
- Modify: `companion/src/host-use/darwin/build-host.sh`（断言）

- [ ] **Step 1.1: 改 host-Info.plist**

将内容替换为（版本号可与 companion 同步策略保持 0.1.0 或改为读取——P0 固定字符串即可）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.cmspark.agent</string>
    <key>CFBundleName</key>
    <string>CMspark</string>
    <key>CFBundleDisplayName</key>
    <string>CMspark</string>
    <key>CFBundleExecutable</key>
    <string>CMspark</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>NSAppleEventsUsageDescription</key>
    <string>CMspark needs automation access to help with Mail and related tasks you approve.</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.4</string>
</dict>
</plist>
```

- [ ] **Step 1.2: build-host.sh 增加身份门（DR-N1）**

在 codesign verify 成功后追加。**不要用** `codesign -d --info-plist=-`（macOS 26.5 上会 `unrecognized option`，Pi 已实证）。

```bash
echo "[build-host] (4c) Assert product TCC identity (plist section / strings)..."
# Prefer extracting __TEXT,__info_plist via otool; fall back to strings.
PLIST_TMP=$(mktemp)
if otool -s __TEXT __info_plist "${OUTPUT_BIN}" 2>/dev/null | tail -n +3 | xxd -r -p >"${PLIST_TMP}" 2>/dev/null \
  && plutil -lint "${PLIST_TMP}" >/dev/null 2>&1; then
  IDENT=$(plutil -extract CFBundleIdentifier raw "${PLIST_TMP}" 2>/dev/null || true)
  if [[ "${IDENT}" != "com.cmspark.agent" ]]; then
    echo "[build-host] ERROR: embedded CFBundleIdentifier='${IDENT}' want com.cmspark.agent"
    rm -f "${PLIST_TMP}"
    exit 1
  fi
  if plutil -p "${PLIST_TMP}" 2>/dev/null | grep -q 'com.cmspark.host'; then
    echo "[build-host] ERROR: stale com.cmspark.host in embedded Info.plist"
    rm -f "${PLIST_TMP}"
    exit 1
  fi
  rm -f "${PLIST_TMP}"
else
  rm -f "${PLIST_TMP}"
  # strings fallback: require agent id present (do NOT ban host string here —
  # source comments may linger until Task 2.5; DR-N7)
  if ! strings "${OUTPUT_BIN}" | grep -q 'com.cmspark.agent'; then
    echo "[build-host] ERROR: com.cmspark.agent not found in binary strings"
    exit 1
  fi
  echo "[build-host] WARN: otool plist extract failed; used strings fallback for agent id only"
fi
```

- [ ] **Step 1.3: 本地构建验证**

```bash
cd companion && npm run build:host
strings dist/cmspark-host | grep -E 'com.cmspark.(agent|host)' | sort -u
```

Expected: 有 `com.cmspark.agent`；无 `com.cmspark.host`。

- [ ] **Step 1.4: Commit**

```bash
git add companion/src/host-use/darwin/host-Info.plist companion/src/host-use/darwin/build-host.sh
git commit -m "fix(darwin): embed com.cmspark.agent identity in host binary"
```

---

## Task 2: host.swift — 路径 / 默认启动 / 用户文案（A1, A2, A9, A19）

**Files:**
- Modify: `companion/src/host-use/darwin/host.swift`
- Modify: `companion/src/host-use/darwin/host-skylight.swift`（若与 production 并行维护用户串）

- [ ] **Step 2.1: host-scripts 解析（A2）**

在 `findScript` 中扩展候选目录（示意，保持 Swift 风格与现有一致）：

```swift
func hostScriptsDirs() -> [URL] {
    let execURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    let execDir = execURL.deletingLastPathComponent()
    return [
        execDir.appendingPathComponent("host-scripts", isDirectory: true),
        // Packaged: Contents/MacOS/CMspark → Contents/Resources/host-scripts
        execDir.deletingLastPathComponent()
            .appendingPathComponent("Resources/host-scripts", isDirectory: true),
        // Staging flat: next to binary
        execDir.appendingPathComponent("../host-scripts", isDirectory: true).standardizedFileURL,
    ]
}

func findScript(_ name: String) -> URL? {
    for scriptsDir in hostScriptsDirs() {
        for candidate in [name + ".scpt", name] {
            let url = scriptsDir.appendingPathComponent(candidate)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
    }
    return nil
}
```

- [ ] **Step 2.2: 默认启动 tray（A1）**

在 `main` / 命令分发 **最前**：

```swift
// Product: double-click CMspark.app → tray agent, never leave user at CLI usage.
// Subcommands (screenshot, inject, estop, …) keep working for node spawn.
let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty || args[0] == "tray" || args[0] == "launch" {
    launchAgentTrayAndExit() // see Step 2.3
}
```

- [ ] **Step 2.3: `launchAgentTrayAndExit` 实现**

```swift
func launchAgentTrayAndExit() -> Never {
    // Resolve Resources relative to this executable when packaged:
    //   Contents/MacOS/CMspark → Contents/Resources/{node,cmspark-agent.js}
    let execDir = URL(fileURLWithPath: CommandLine.arguments[0])
        .standardizedFileURL.deletingLastPathComponent()
    let candidates: [(node: URL, agent: URL)] = [
        (
            execDir.deletingLastPathComponent().appendingPathComponent("Resources/node"),
            execDir.deletingLastPathComponent().appendingPathComponent("Resources/cmspark-agent.js")
        ),
        // Dev / flat staging: sibling next to binary
        (
            execDir.appendingPathComponent("node"),
            execDir.appendingPathComponent("cmspark-agent.js")
        ),
    ]
    guard let pair = candidates.first(where: {
        FileManager.default.isExecutableFile(atPath: $0.node.path)
            && FileManager.default.fileExists(atPath: $0.agent.path)
    }) else {
        fputs("CMspark: cannot find node + cmspark-agent.js next to app Resources\n", stderr)
        exit(2)
    }
    let proc = Process()
    proc.executableURL = pair.node
    proc.arguments = [pair.agent.path, "tray"]
    proc.environment = ProcessInfo.processInfo.environment
    do {
        try proc.run()
        proc.waitUntilExit()
        exit(proc.terminationStatus)
    } catch {
        fputs("CMspark: failed to start agent: \(error)\n", stderr)
        exit(2)
    }
}
```

> **DR-N4（强制）**: 用 `/usr/bin/arch` 包装，与旧 bash launcher 对齐：
> `proc.executableURL = URL(fileURLWithPath: "/usr/bin/arch")`  
> `proc.arguments = ["-arm64", pair.node.path, pair.agent.path, "tray"]`

- [ ] **Step 2.4: 用户可见权限文案（D3, A9, A19）**

替换 SCK denial（约原 1062–1068 行）为：

```swift
errMsg =
    "Screen Recording permission denied (ScreenCaptureKit code=\(err.code)). " +
    "Open System Settings → Privacy & Security → Screen Recording, enable «CMspark», " +
    "then fully quit CMspark and reopen. If you just reinstalled/updated, turn the switch off and on again."
```

**禁止**出现：`node`、`cmspark-host`、`and/or`。

同步替换 estop / Accessibility 用户串中的 `cmspark-host` → `CMspark`。

- [ ] **Step 2.5: 更新文件头注释**

删除「TCC-attribution anchor: cmspark-host」产品向表述；改为「Product identity: CMspark (com.cmspark.agent); never attribute UX to node」。

- [ ] **Step 2.6: 重建 host + 冒烟**

```bash
cd companion && npm run build:host
./dist/cmspark-host 2>&1 | head -5   # 无 Resources 时应清晰失败，非 usage dump 吓用户
./dist/cmspark-host self-test        # 仍 ok
```

- [ ] **Step 2.7: Commit**

```bash
git add companion/src/host-use/darwin/host.swift companion/src/host-use/darwin/host-skylight.swift
git commit -m "fix(darwin): CMspark main identity — tray launch, scripts path, user copy"
```

---

## Task 3: `resolveHostBinary` 优先主身份（D6, A3, A18）

**Files:**
- Modify: `companion/src/host-use/darwin/host-bin.ts`
- Create: `companion/tests/host-bin-resolve.test.ts`

- [ ] **Step 3.1: 写失败单测（TDD）**

```typescript
// companion/tests/host-bin-resolve.test.ts
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import test from "node:test"

// Test via re-require after env — prefer exporting a pure helper if needed:
// resolveHostBinaryFrom(dirname, env) for testability.

test("packaged layout prefers Contents/MacOS/CMspark over Resources/cmspark-host", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-hostbin-"))
  const macOS = path.join(root, "Contents", "MacOS")
  const resources = path.join(root, "Contents", "Resources")
  fs.mkdirSync(macOS, { recursive: true })
  fs.mkdirSync(resources, { recursive: true })
  const mainBin = path.join(macOS, "CMspark")
  const legacy = path.join(resources, "cmspark-host")
  fs.writeFileSync(mainBin, "main")
  fs.chmodSync(mainBin, 0o755)
  fs.writeFileSync(legacy, "legacy")
  fs.chmodSync(legacy, 0o755)

  // Simulate __dirname = Resources (bundled agent js location)
  const { resolveHostBinaryCandidates } = require("../src/host-use/darwin/host-bin")
  const candidates = resolveHostBinaryCandidates(resources)
  assert.equal(candidates[0], mainBin)
})
```

若当前只导出 `resolveHostBinary`，先抽：

```typescript
export function resolveHostBinaryCandidates(fromDir: string): string[] {
  return [
    path.resolve(fromDir, "../MacOS/CMspark"),           // packaged preferred
    path.resolve(fromDir, "CMspark"),                      // flat oddity
    path.resolve(fromDir, "cmspark-host"),                 // same-dir sibling (legacy DMG)
    path.resolve(fromDir, "../cmspark-host"),
    path.resolve(fromDir, "../../cmspark-host"),
    path.resolve(fromDir, "../../dist/cmspark-host"),
    path.resolve(fromDir, "../../../dist/cmspark-host"),
  ]
}

export function resolveHostBinary(): string {
  // keep override logic exactly as today (D10)
  ...
  for (const c of resolveHostBinaryCandidates(__dirname)) {
    if (fs.existsSync(c)) return c
  }
  return path.resolve(__dirname, "../../dist/cmspark-host")
}
```

- [ ] **Step 3.2: 跑测确认红→绿**

```bash
cd companion && npx tsx --test tests/host-bin-resolve.test.ts
```

- [ ] **Step 3.3: Commit**

```bash
git add companion/src/host-use/darwin/host-bin.ts companion/tests/host-bin-resolve.test.ts
git commit -m "fix(darwin): prefer MacOS/CMspark as host binary in app bundle"
```

---

## Task 4: create-dmg — 废 bash 主入口（D4, A6, A18）

**Files:**
- Modify: `scripts/create-dmg.sh`
- Modify: `scripts/tests/test-package-gates.sh`（或新增 gate）

- [ ] **Step 4.1: 替换 launcher 段**

删除生成 bash `LAUNCHER` 的 heredoc。在 copy staging 之后：

```bash
# --- Main executable: native CMspark (product TCC identity) ---
HOST_SRC="${RESOURCES}/cmspark-host"
if [ ! -f "${HOST_SRC}" ]; then
  echo "[create-dmg] ERROR: cmspark-host missing in Resources (run package-macos / build:host)"
  exit 1
fi
# Install as Contents/MacOS/CMspark (same bytes). Keep Resources/cmspark-host as
# hardlink so legacy resolve still hits same inode (A6: one CDHash).
cp -f "${HOST_SRC}" "${APP_BUNDLE}/Contents/MacOS/CMspark"
chmod +x "${APP_BUNDLE}/Contents/MacOS/CMspark"
# Prefer hardlink for identity unity; fall back to same-file copy already done.
ln -f "${APP_BUNDLE}/Contents/MacOS/CMspark" "${HOST_SRC}" 2>/dev/null || true

# Assert not a script
if file "${APP_BUNDLE}/Contents/MacOS/CMspark" | grep -qi 'script\|text'; then
  echo "[create-dmg] ERROR: MacOS/CMspark must be Mach-O, got script"
  exit 1
fi
```

- [ ] **Step 4.2: codesign 顺序 + CDHash 相等（DR-N2）**

保持对整个 `.app` ad-hoc deep-sign；确保 **先** 放好 MacOS/CMspark 再 `codesign --force --deep`。签完后：

```bash
HASH_MAIN=$(codesign -dv --verbose=4 "${APP_BUNDLE}/Contents/MacOS/CMspark" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')
HASH_HOST=$(codesign -dv --verbose=4 "${RESOURCES}/cmspark-host" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')
if [[ -z "${HASH_MAIN}" || "${HASH_MAIN}" != "${HASH_HOST}" ]]; then
  echo "[create-dmg] ERROR: CDHash mismatch MacOS/CMspark=${HASH_MAIN} Resources/cmspark-host=${HASH_HOST} (A6)"
  exit 1
fi
echo "[create-dmg] A6 OK: single CDHash ${HASH_MAIN}"
```

- [ ] **Step 4.3: package gate 静态断言**

在 `scripts/tests/test-package-gates.sh` 增加对 `create-dmg.sh`：

```bash
assert_file_lacks "${CREATE_DMG}" 'env arch -arm64 /bin/bash' \
  "create-dmg must not install bash as main executable"
assert_file_has "${CREATE_DMG}" 'Contents/MacOS/CMspark' \
  "create-dmg installs native MacOS/CMspark"
```

- [ ] **Step 4.4: 构建 DMG（或至少 app bundle 半程）并 file 检查**

```bash
# 按仓库惯用：
make package-macos   # 或现有等价
bash scripts/create-dmg.sh
file dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark
codesign -dv --verbose=4 dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark 2>&1 | head -25
```

Expected: Mach-O；Identifier 侧为 agent 或 app 体系；**不是** bash。

- [ ] **Step 4.5: Commit**

```bash
git add scripts/create-dmg.sh scripts/tests/test-package-gates.sh
git commit -m "fix(packaging): native MacOS/CMspark replaces bash launcher"
```

---

## Task 5: 文案与文档清零（D3, D8, A19）

**Files:**
- Modify: `companion/src/computer/executor.ts`（若仍有 node/host 引导）
- Modify: `companion/src/computer/darwin-estop.ts`
- Modify: `docs/computer-use-user-guide.md`
- Optional: `docs/TROUBLESHOOTING.md`

- [ ] **Step 5.1: 仓库门禁扫描**

```bash
rg -n 'node / cmspark-host|and/or node|enable.*cmspark-host|勾选.*node|grant Accessibility permission to cmspark-host|permission for cmspark-host|not Accessibility-trusted|cmspark-host if listed' \
  companion/src docs scripts/create-dmg.sh scripts/macos \
  --glob '!docs/audit/**' --glob '!docs/superpowers/**' --glob '!docs/decisions/**'
```

Expected: **零匹配**于用户路径文件（实现后）。历史 audit 可留。（**DR-N3** 扩展 pattern）

- [ ] **Step 5.0: DisplayName 对齐（DR-N5）**

`scripts/macos/Info.plist`：`CFBundleDisplayName` 改为 `CMspark`（与嵌入 host plist 一致）。

- [ ] **Step 5.2: 用户指南新增小节**（建议插在平台说明附近）

```markdown
## macOS 权限（只认 CMspark）

Computer Use 截图与键鼠需要系统权限。请 **只** 为 **CMspark** 打开：

1. **系统设置 → 隐私与安全性 → 屏幕录制** → 打开 **CMspark**
2. **系统设置 → 隐私与安全性 → 辅助功能** → 打开 **CMspark**
3. **完全退出** CMspark（菜单栏图标退出）后重新打开

**不要**去找或勾选 `node`、`cmspark-host` 等内部进程名。若列表里有历史残留项，可关闭它们；以 **CMspark** 为准。

更新或重装后若截图再次失败：把 CMspark 开关关掉再打开一次（ad-hoc 安装时系统可能要求重新授权）。
```

- [ ] **Step 5.3: Commit**

```bash
git add companion/src/computer/executor.ts companion/src/computer/darwin-estop.ts docs/computer-use-user-guide.md
git commit -m "docs: Screen Recording UX only mentions CMspark"
```

---

## Task 6: 回归测试与 self-UI 兼容（A10, A16）

**Files:**
- Modify: `companion/src/computer/self-ui.ts`（确认 `com.cmspark.agent` 在列表；可保留 host 一版兼容）
- Run: existing host/computer tests

- [ ] **Step 6.1: 跑相关测试**

```bash
cd companion
npx tsx --test tests/host-bin-resolve.test.ts
npx tsx --test tests/host-use-darwin-integrity.test.ts
npx tsx --test tests/computer-darwin-inject-contract.test.ts
# 或 npm test 子集
bash scripts/tests/test-package-gates.sh
```

- [ ] **Step 6.2: 修复因路径/文案导致的断言**（仅测期望，不放宽 D 锁）

- [ ] **Step 6.3: Commit if needed**

```bash
git commit -am "test: align host identity resolve and package gates"
```

---

## Task 7: 对抗验收（DoD — 不可跳过）

**Manual + packaged. 无证据不得勾完成。**

- [ ] **Step 7.1: 安装新包**到 `/Applications/CMspark.app`（覆盖旧版）

- [ ] **Step 7.2: 身份检查清单**

| Check | Command / action | Pass criteria |
|-------|------------------|---------------|
| Mach-O | `file …/MacOS/CMspark` | arm64 Mach-O |
| Not script | same | no "script text" |
| Identity | `strings …/MacOS/CMspark \| grep com.cmspark` | agent present; host id absent |
| Resolve | 日志或一次性 debug：`resolveHostBinary` | MacOS/CMspark |
| Copy scan | 触发一次故意无权限截图 | 错误无 node/cmspark-host |

- [ ] **Step 7.3: TCC 用户路径**

1. 重置或使用干净状态（可选：`tccutil reset ScreenCapture com.cmspark.agent` — **慎用，先确认影响**）  
2. 启动 CMspark → 触发外 App 窗口截图  
3. 系统弹窗主体 = **CMspark**  
4. 设置列表中用户 **只操作 CMspark**  
5. 完全退出重开 → 截图成功  

- [ ] **Step 7.4: 外程序截图**

对 **非 Chrome** 窗口执行 L2 截图路径；不得出现 `-3801` 在已授权后。

- [ ] **Step 7.5: 写验收记录**

追加短文到 `docs/audit/reviews/macos-tcc-identity-acceptance-YYYYMMDD.md`：

- 机器 macOS 版本  
- 截图目标 App  
- 隐私列表描述（文字即可）  
- 是否仍见历史 node 幽灵（记录但不算失败，除非产品引导勾选）  

- [ ] **Step 7.6: 若 A5 失败（列表仍显示错误名）**

**Blocker**：不得宣称完成。回滚方案选项：  
1) 确认 spawn 路径是否仍指向旧 Resources 独立 blob；  
2) 去掉 Resources 侧第二份不同签名副本；  
3) 升级到 P1 XPC。  

---

## Task 8: 记忆与 HANDOFF

**Files:**
- Modify: `memory/session.md`
- Modify: `memory/project-knowledge.md`（TCC 身份陷阱）
- Create: `docs/superpowers/plans/2026-08-01-macos-tcc-product-identity-HANDOFF.md`（若跨会话）

- [ ] **Step 8.1: 记录**

```markdown
## TCC product identity (2026-08-01)
- User must only enable CMspark — never node/cmspark-host
- P0: MacOS/CMspark = host Mach-O; com.cmspark.agent; resolve prefers main binary
- Ad-hoc reinstall may clear grants (P1: Developer ID)
```

---

## 对抗验证运行手册（实现中每里程碑重跑）

| 里程碑 | 必跑攻击项 | 失败动作 |
|--------|------------|----------|
| Task 1 后 | A4 | 停；修 plist |
| Task 2 后 | A1 A2 A9 | 停；修 swift |
| Task 3 后 | A3 A18 | 停；修 resolve |
| Task 4 后 | D4 A6 | 停；修 dmg |
| Task 5 后 | D3 A19 | 停；清文案 |
| Task 7 | A5 A12 A20 + DoD 全表 | **禁止 merge 宣称完成** |

### 二次对抗（实现完成后、宣称 ship 前）

请 **另一 agent / 人类** 只拿 SoT §6 DoD 勾选，不允许看「我觉得可以」：

1. 任意用户可见字符串是否仍含 node/cmspark-host？  
2. 捕获进程 `ps` + `codesign` 是否等于 MacOS/CMspark？  
3. 外 App 截图是否在 **仅勾 CMspark** 下成功？  

任一项否 → **Verdict = REJECT**，回 Task 7.6。

---

## P1 backlog（本计划不实施）

| ID | 项 | 为何 P1 |
|----|-----|---------|
| P1-1 | Developer ID + notarize 稳定 CDHash | 根治重装丢权 |
| P1-2 | 主进程常驻 + XPC 截图 | 单一长期进程身份 |
| P1-3 | 迁移工具：检测幽灵 node 条目并提示 | 清理历史列表 |
| P1-4 | `install-daemon.sh` 与 DMG 完全同构 | 双安装路径 |

---

## Self-review（计划作者）

| Spec 要求 | Task |
|-----------|------|
| D1–D3 用户只认 CMspark | 2, 5, 7 |
| D4 Mach-O 主入口 | 4 |
| D5 agent identity | 1 |
| D6 resolve | 3 |
| D7 发布 vs dev 文件名 | 3, 4（dev 仍 dist/cmspark-host） |
| D8 迁移文案 | 5 |
| D9 ad-hoc 诚实 | 5, 7 |
| D10 override 安全 | 3（不改坏） |
| A1 tray | 2 |
| A2 scripts path | 2 |
| A6 单一身份 blob | 4 |
| A18 不双 spawn | 3+4 |
| A20 外 App 证据 | 7 |

Placeholder scan: 无 TBD；命令与代码块已给出可执行形态。  
Type consistency: `resolveHostBinaryCandidates(fromDir)` 为新增纯函数；旧调用点保持 `resolveHostBinary()`。

---

## Execution handoff

**Plan complete and saved to:**

- Spec: `docs/superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md`  
- Plan: `docs/superpowers/plans/2026-08-01-macos-tcc-product-identity-impl.md`

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 新 subagent + 任务间 review  
2. **Inline Execution** — 本会话按 executing-plans 连续做，Task 7 人工验收卡点  

**Which approach?**
