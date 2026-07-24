# macOS 坐标级电脑操控实施计划

> 版本: 1.1.0 | 日期: 2026-07-21 | 基于分支: `computer-use-w8-windows`
> 目标: 在 macOS 上实现与 Windows WP3 对等的坐标级电脑操控（AX+CGEvent+OCR 三层定位链 + 完整安全防线）
> 对抗审查: 已完成 (安全审查 + 架构审查), 发现 25 条, 其中 5 CRITICAL + 8 HIGH

---

## 对抗审查报告 (2026-07-21)

### 审查方法

两个独立 Agent 并行审查计划:
- **🔒 安全审查**: 密钥管理、热键绕过、AX 注入、Unicode 逃逸、E-Stop 攻击面
- **🏗️ 架构审查**: 接口遗漏、坐标空间错位、Bundle ID 映射、chunking 竞态、类型冲突

### 变更摘要

以下发现已纳入修订版计划:

| # | 发现 | 严重性 | 修复位置 |
|---|------|--------|----------|
| C1 | Keychain `security` CLI 万能密钥泄露 | 🔴 CRITICAL | B8 → Swift SecItem + code-sign ACL |
| C2 | E-Stop 进程可被杀 + 心跳可伪造 | 🔴 CRITICAL | B4 → CGEventTap + UNIX socket |
| C3 | `MacPreviewBuilder` 未定义 → 运行时崩溃 | 🔴 CRITICAL | B3 + B5 |
| C4 | Bundle ID vs exe path 映射断裂 | 🔴 CRITICAL | B1 + executor 修改 |
| C5 | `APP_TOKEN_PATTERN` 正则错误 | 🔴 CRITICAL | B1 |
| H1 | 缺失 Swift `client` rect 计算 → 28px 偏移 | 🟠 HIGH | B3 + B6 |
| H2 | `typeText` Unicode 码位切割 | 🟠 HIGH | B3 → Intl.Segmenter |
| H3 | AX `accessibilityLabel` 可伪造 | 🟠 HIGH | B3 → z-order 可见性检查 |
| H4 | Unicode 组合字符绕过 corpus hash | 🟠 HIGH | B1 + B3 → NFKC 规范化 |
| H5 | Screen Recording 权限窃听 | 🟠 HIGH | 文档化已知残余风险 |
| H6 | `MAC_VAULT_BUNDLE_IDS` 不完整 | 🟠 HIGH | B1 补全 |
| H7 | OCR 语言硬编码 zh-Hans | 🟠 HIGH | B3 → 可配置 + 自动检测 |
| H8 | 鼠标劫持 (dialog 竞态, 无 z-order 检查) | 🟡 MEDIUM | B3 → optionOnScreenAboveWindow |
| M1 | `INTEGRITY_LEVEL_DENIED` 语义错误 | 🟡 MEDIUM | B2 → 新增 TCC_DENIED 或复用 |
| M2 | 窗口 ID 跨重启不稳定 | 🟡 MEDIUM | 文档化 (fail-closed) |
| M3 | B1+B6 不能并行 | 🟡 MEDIUM | 修正依赖图 |
| M4 | OCR `locate()` 应提取共享模块 | 🟡 MEDIUM | B3 → computer/ocr-locate.ts |
| M5 | `assertExeNotDrifted` macOS 路径 | 🟢 LOW | 现有守卫已处理 |
| M6 | `canEverCoordinate` 脆弱回退 | 🟡 MEDIUM | B1 → 平台守卫 |
| X1 | Cross-Space 注射无视觉确认 | 🟡 MEDIUM | B3 → onScreenOnly 检查 |
| X2 | Secure Input 16字符块竞态 | 🟡 MEDIUM | B3 → per-chunk 重检 |

### 更新统计

| 维度 | 原始 | 修订后 |
|------|------|--------|
| 计划文件数 | ~18 | ~22 (+4) |
| 新代码行数 | ~4400 | ~5200 (+800) |
| 执行批次数 | 9 | 9 (内容调整) |
| 不变模块 | 8 | 5 (types.ts 需改, executor.ts 需改, locate-chain.ts 需改) |

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CROSS-PLATFORM (不变)                            │
│                                                                     │
│  executor.ts        ← 平台无关的任务执行循环                          │
│  locate-chain.ts    ← 四层定位编排器 (L0→L1→L2→L3)                  │
│  policy.ts          ← A10 双开关门控                                 │
│  danger.ts          ← 双语危险词检测 (21 HARD + 14 CAUTION + 8 PWD) │
│  evidence.ts        ← 证据链 (文件布局跨平台)                        │
│  preview.ts         ← L2 预览文案构建                                │
│  rate-limit.ts      ← 会话级注入频率限制                             │
│  handlers.ts        ← computer.set_enabled + evidence.open          │
│  confirm.ts         ← origin-bound 确认通道                          │
│  estop.ts           ← 紧急停止框架 (macOS 需重写热键方案)           │
│  types.ts           ← 所有共享类型、接口、错误码                     │
│                                                                     │
│  server.ts          ← 新增 darwin 分支 (host_computer 不再返回       │
│                       "Windows-only")                                │
│  tool-definitions.ts ← 更新描述 (W8: win→mac)                        │
│  tool-schemas.ts    ← 不变                                           │
│  config.ts          ← 扩展 AppEntry 支持 macToken                     │
│  security.ts        ← 不变                                           │
│  security-policy.ts ← 不变                                           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     macOS-SPECIFIC (新增)                            │
│                                                                     │
│  computer/darwin-adapters.ts  ← 全部 macOS 平台适配器               │
│  computer/darwin-estop.ts     ← macOS 紧急停止 (LaunchAgent 热键)   │
│  computer/darwin-evidence.ts  ← macOS 证据封存 (Keychain 增补)     │
│  host-use/darwin/host.swift   ← 扩展: capture/inject/window 子命令  │
│  host-use/darwin/scripts/     ← 预编译 AppleScript (如有需要)       │
│  host-use/darwin/entitlements ← 扩展: Accessibility + Screen Rec    │
└─────────────────────────────────────────────────────────────────────┘

定位链对比:
  Windows:  UIA (L0) → OCR (L1) → TinyClick (L2) → cloud (L3 stub)
  macOS:    AX  (L0) → OCR (L1) → TinyClick (L2) → cloud (L3 stub)
            ↑                     ↑
     NSAccessibility        Apple Vision
     (≈ Windows UIA)        (≈ Windows.Media.Ocr)

注入链对比:
  Windows:  SendInput (user32.dll)
  macOS:    CGEventPost (Quartz)
```

---

## Batch 1 — 基础类型 + 配置模型 (`macToken`)

**风险**: 低 | **文件数**: ~5 | **新代码**: ~200 行

### Item 1.1: 扩展 `APP_TOKEN_PATTERN` 支持 macOS token

**当前**: `APP_TOKEN_PATTERN = /^win\.(app|cli)\.[a-z0-9][a-z0-9_\-]{1,31}$/`
（对抗审查 C5: 计划原始正则允许大写+无长度限制，与 types.ts 实际代码冲突）
**修复**: 改为 `/^(win|mac)\.(app|cli)\.[a-z0-9][a-z0-9_\-]{1,31}$/`

**影响文件**:
- `companion/src/apps/types.ts`: `APP_TOKEN_PATTERN` 正则

### Item 1.2: 扩展 `AppEntry` 类型 + 添加 `bundleId` 顶层字段

对抗审查 C4: 计划原将 bundle ID 混入 `exe.path`，会导致 `hashFile("com.apple.Notes")` 崩溃。

**修复**: 新增独立 `bundleId?: string` 顶层字段，与 `exe` 路径并存：

```typescript
// config.ts — CompanionConfig
export interface AppEntry {
  token: string
  display_name: string
  kind: "gui" | "cli"
  enabled: boolean
  policy: AppPolicy
  coordinateAllowed: boolean          // A10.2: 默认 false
  uiaCapable?: boolean                // 三态: undefined=unprobed

  // macOS 新增
  bundleId?: string                   // e.g. "com.apple.Notes"
  // exe 保持不变 (Windows 用)
  exe?: {
    path?: string                     // Windows: C:\...\app.exe
    sha256?: string                   // Windows: binary hash
  }
}
```

executor.ts 修改 (对抗审查 C4):
```typescript
// executor.ts 中 window 解析路径:
const exePath = os.platform() === "darwin"
  ? (entry.bundleId ?? entry.exe?.path ?? "")
  : (entry.exe?.path ?? "")
// 如果 macOS 上 bundleId 也为空 → 报错
if (!exePath) throw new ComputerError("APP_NOT_WHITELISTED", "no bundleId or exe path")
const wins = await deps.windows.enumerateByExe(exePath)
```

`policy.ts` 修改:
```typescript
// canEverCoordinate 添加平台守卫 (对抗审查 M6):
if (os.platform() !== "darwin" && entry.exe?.path) {
  if (isLolbinPath(entry.exe.path)) return false
  if (basenameToVault(entry.exe.path) !== null) return false
}

// assertExeNotDrifted 添加平台守卫 (对抗审查 M5):
if (os.platform() === "darwin") return // code signing 是信任锚
```

**影响文件**: `companion/src/config.ts`

### Item 1.3: macOS vault/LOLBIN 等效项 + NFKC 规范化 (对抗审查 H4, H6)

**对抗审查 H6 — 补全 vault 列表**:

```typescript
// companion/src/computer/policy.ts

const MAC_VAULT_BUNDLE_IDS = new Set([
  // 密码管理器
  "com.agilebits.onepassword7", "com.bitwarden.desktop",
  "com.lastpass.lastpassmacdesktop",
  // 浏览器
  "com.apple.Safari", "com.google.Chrome", "org.mozilla.firefox",
  "company.thebrowser.Browser",     // Arc
  "com.brave.Browser",              // Brave
  "com.microsoft.edgemac",          // Edge
  // 终端 + 编辑器
  "com.apple.Terminal", "com.googlecode.iterm2",
  // 系统安全
  "com.apple.keychainaccess", "com.apple.systempreferences",
  "com.apple.Passwords",            // macOS Sequoia Passwords.app
  "com.apple.Wallet",               // Wallet (信用卡/票券)
  "com.apple.Authenticator",        // 内置认证器
  // 认证器
  "com.google.Authenticator", "com.authy.authy-mac",
  // 加密钱包
  "com.metamask.MetaMask", "com.ledger.live", "com.exodus.Exodus",
  // SSH/密钥管理
  "com.maxgoedjen.secretive.Secretive",
])
```

**对抗审查 H4 — NFKC 规范化**:

`types.ts` 的 `corpusOf()` 必须 NFKC 规范化，防止 Unicode 组合字符绕过 A3 语料检查：

```typescript
// types.ts — 修改 corpusOf (对抗审查 H4):
export function corpusOf(actions: ComputerAction[]): string[] {
  const texts: string[] = []
  for (const a of actions) {
    if (a.action === "type") texts.push(a.text.normalize("NFKC"))
  }
  return texts
}
```

同时 `MacInputInjector.typeText()` 也必须 NFKC 规范化注入文本：
```typescript
// darwin-adapters.ts (B3):
async typeText(hwnd: number, text: string): Promise<void> {
  const normalized = text.normalize("NFKC")  // H4: 双向规范化
  // ... chunk and inject normalized
}
```

**影响文件**: `companion/src/computer/policy.ts`

### Item 1.4: 测试

- `companion/tests/computer-policy.test.ts`: 新增 macOS bundle ID vault 检查用例
- `companion/tests/config.test.ts`: 验证 mac.app.* token 合法性

---

## Batch 2 — macOS 适配器 (calm — 无副作用)

**风险**: 低 | **文件数**: ~3 | **新代码**: ~800 行

"calm" 适配器 = 纯查询操作，不注入任何输入，不截图，不需要 Accessibility/Screen Recording 权限。

### Item 2.1: `MacWindowEnumerator`

实现 `WindowEnumerator` 接口。通过 `cmspark-host window-list` 子命令调用 `CGWindowListCopyWindowInfo`。

```typescript
// companion/src/computer/darwin-adapters.ts

import { execFile } from "child_process"
import { promisify } from "util"
import { resolveHostBinary } from "../host-use/darwin/host-bin"

const execFileAsync = promisify(execFile)
const DARWIN_WINDOW_TIMEOUT_MS = 15000

export class MacWindowEnumerator implements WindowEnumerator {
  async enumerateByExe(exePath: string): Promise<WindowInfo[]> {
    // macOS 使用 bundleId 而非 exe path
    const bin = resolveHostBinary()
    const result = await execFileAsync(bin, ["window-list", "--bundle-id", exePath], {
      encoding: "utf-8",
      timeout: DARWIN_WINDOW_TIMEOUT_MS,
    })
    // 解析 JSON → WindowInfo[]
    const parsed = JSON.parse(result.stdout)
    if (!parsed.ok) throw new Error(`window-list: ${parsed.error}`)
    return parsed.windows.map((w: any) => ({
      hwnd: w.windowId,           // CGWindowID
      pid: w.pid,
      exePath: w.ownerName,       // bundle identifier
      title: w.name,
      rect: { x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height },
      alive: true,
    }))
  }

  async infoForHwnd(hwnd: number): Promise<WindowInfo> {
    // 同上，加 --window-id 参数
  }
}
```

**Swift 子命令**: `window-list --bundle-id com.apple.Notes`
**输出格式**:
```json
{
  "ok": true,
  "windows": [
    {
      "windowId": 12345,
      "pid": 67890,
      "ownerName": "com.apple.Notes",
      "name": "All iCloud",
      "bounds": { "x": 100, "y": 200, "width": 800, "height": 600 },
      "layer": 0
    }
  ]
}
```

### Item 2.2: `MacUiaProber` → `MacAxProber`

实现 `UiaProber` 接口。通过 AX API 探测 UI 树密度。

```typescript
export class MacAxProber implements UiaProber {
  async probe(hwnd: number): Promise<UiaVerdict> {
    const bin = resolveHostBinary()
    const result = await execFileAsync(bin, ["ax-probe", "--window-id", String(hwnd)], {
      encoding: "utf-8",
      timeout: DARWIN_WINDOW_TIMEOUT_MS,
    })
    const parsed = JSON.parse(result.stdout)
    return uiaVerdictFromStats(parsed.stats)  // 复用 Windows 判决逻辑
  }
}
```

**Swift 子命令**: `ax-probe --window-id 12345`
**输出**: 遍历 AX 树 → 统计 nodes, maxDepth, editableElements, buttons, namedElements 等

### Item 2.3: `MacSecurityEnvironment`

macOS 没有 IL/桌面，但有:
- **Accessibility 权限**: 通过 `AXIsProcessTrusted()` 检查
- **Secure Input 模式**: 当密码输入框激活时，CGEvent 被系统屏蔽

```typescript
export class MacSecurityEnvironment implements SecurityEnvironment {
  async assertInjectable(hwnd: number): Promise<void> {
    const bin = resolveHostBinary()
    const result = await execFileAsync(bin, ["security-check"], {
      encoding: "utf-8",
      timeout: 5000,
    })
    const parsed = JSON.parse(result.stdout)
    if (!parsed.axTrusted) {
      throw new ComputerError("INTEGRITY_LEVEL_DENIED",
        "Accessibility permission not granted — enable in System Settings → Privacy → Accessibility")
    }
    if (parsed.secureInput) {
      throw new ComputerError("DESKTOP_DENIED",
        "Secure Input mode active — a password field has focus; refusing injection")
    }
  }
}
```

### Item 2.4: 测试

- `companion/tests/computer-darwin-adapters-calm.test.ts`: mock `execFile` → 测试 enumerateByExe、infoForHwnd、axProbe、security-check 解析

---

## Batch 3 — macOS 适配器 (compute — 有副作用)

**风险**: 中 | **文件数**: ~4 | **新代码**: ~1200 行

"compute" 适配器 = 截图、OCR、注入。需要 Screen Recording + Accessibility 权限。

### Item 3.1: `MacScreenCapturer`

实现 `ScreenCapturer` 接口。使用 `CGWindowListCreateImage` + `kCGWindowImageBoundsIgnoreFraming`。

**对抗审查 H1 — client rect 计算**: 截图含标题栏，需要计算内容区域偏移。Swift 端实现:

```swift
// 截图命令内计算 client rect (对抗审查 H1):
// 1. CGWindowListCopyWindowInfo 获取 frame bounds
// 2. AXUIElementCopyAttributeValue(axWindow, kAXPositionAttribute) 获取内容区域位置
// 3. AXUIElementCopyAttributeValue(axWindow, kAXSizeAttribute) 获取内容区域大小
// 4. client.x = axPos.x - frame.x
//    client.y = axPos.y - frame.y   ← 标题栏高度 (通常 ~28px, Apple 统一工具栏 ~52px)
//    client.width = axSize.width
//    client.height = axSize.height
```

**坐标映射验证** (对抗审查 H1):
```typescript
// locate-chain.ts 中 screen→image 坐标映射 (已有, 通用):
// img = { x: axHit.x - shot.rect.x, y: axHit.y - shot.rect.y }
// pointClient = { x: img.x - shot.client.x, y: img.y - shot.client.y }
// 验证: pointClient 落在 client 区域内 → 正确
// 不验证: 若 client 为正 {0,0,W,H} → 28px 偏移 → 点击到标题栏
```

**Swift 子命令**: `screenshot --window-id 12345 [--rect x y w h]`

```typescript
export class MacScreenCapturer implements ScreenCapturer {
  async captureWindow(hwnd: number): Promise<CaptureMeta> {
    const bin = resolveHostBinary()
    const tmpPath = path.join(os.tmpdir(), `cmspark-capture-${randomUUID()}.png`)
    const result = await execFileAsync(bin, [
      "screenshot",
      "--window-id", String(hwnd),
      "--output", tmpPath,
    ], { encoding: "utf-8", timeout: 15000 })

    const parsed = JSON.parse(result.stdout)
    if (!parsed.ok) throw new ComputerError("CAPTURE_FAILED", parsed.error)

    // 计算 SHA256
    const sha256 = createHash("sha256").update(fs.readFileSync(tmpPath)).digest("hex")

    return {
      hwnd,
      rect: parsed.rect,
      client: parsed.client,
      dpi: parsed.dpi,
      path: tmpPath,
      sha256,
      black: false,            // macOS 不需要 PrintWindow/OSR 检测
      fallbackUsed: false,
      osrBlackSuspected: false,
    }
  }

  async crop(srcPath: string, rect: RectPx, outPath: string): Promise<string> {
    // 通过 Swift 的 CGImage cropping 或纯 Node 的 sharp/pngjs
    const bin = resolveHostBinary()
    await execFileAsync(bin, [
      "crop",
      "--source", srcPath,
      "--output", outPath,
      "--x", String(rect.x),
      "--y", String(rect.y),
      "--width", String(rect.width),
      "--height", String(rect.height),
    ], { timeout: 5000 })
    return outPath
  }

  async diff(aPath: string, bPath: string, crop?: RectPx): Promise<DiffMetrics> {
    // macOS imgdiff 通过 Swift 实现 (Core Graphics 像素访问)
    const bin = resolveHostBinary()
    const args = ["imgdiff", "--a", aPath, "--b", bPath]
    if (crop) args.push("--x", String(crop.x), "--y", String(crop.y),
                        "--width", String(crop.width), "--height", String(crop.height))
    const result = await execFileAsync(bin, args, { timeout: 10000 })
    const parsed = JSON.parse(result.stdout)
    return {
      diffRatio: parsed.diffRatio,
      maxZoneRatio: parsed.maxZoneRatio,
      maxBlobRatio: parsed.maxBlobRatio,
    }
  }

  async diffRegion(aPath: string, bPath: string, region: RectPx): Promise<{ diffRatio: number }> {
    // 直接复用 diff()，crop 到 region 后比较
    const metrics = await this.diff(aPath, bPath, region)
    return { diffRatio: metrics.diffRatio }
  }
}
```

### Item 3.2: `MacLocator` (OCR)

实现 `Locator` 接口。使用 Apple Vision (`VNRecognizeTextRequest`)。

**对抗审查 H7 — OCR 语言**: 默认自动检测 (`["zh-Hans", "en-US"]`)，可配置。

```typescript
export class MacLocator implements Locator {
  private language: string[]

  constructor(language?: string[]) {
    this.language = language ?? ["zh-Hans", "en-US"]  // H7: 默认中英自动检测
  }

  async ensureLanguage(): Promise<void> { /* Vision 内置多语言 */ }

  async ocr(imagePath: string): Promise<OcrResult> {
    const bin = resolveHostBinary()
    const result = await execFileAsync(bin, [
      "ocr",
      "--image", imagePath,
      "--languages", this.language.join(","),  // H7: 可配置
    ], { encoding: "utf-8", timeout: 30000 })
    // ...解析同上...
  }

  locate(result: OcrResult, text: string): LocateHit | null {
    // 委托给 computer/ocr-locate.ts 共享模块 (对抗审查 M4)
    return locateInOcrResult(result, text)
  }
}
```

### Item 3.3: `MacInputInjector` + `MacPreviewBuilder` (对抗审查 H2, H8, X1, X2)

实现 `InputInjector` 接口。macOS 注入方案: `CGEventPostToPid` (macOS 10.15+)。

**对抗审查 H2 — Unicode chunking**: 使用 `Intl.Segmenter` 按 grapheme 分割，防止组合字符被切断。

**对抗审查 H8 — z-order**: 注入前用 `CGWindowListCopyWindowInfo(.optionOnScreenAboveWindow)` 检查遮挡。

**对抗审查 X1 — Spaces**: `.optionOnScreenOnly` 确保窗口在当前 Space 可见。

```typescript
export class MacInputInjector implements InputInjector {
  private estopFlagPath: string | undefined
  private segmenter = new Intl.Segmenter("zh-Hans", { granularity: "grapheme" })

  async click(hwnd: number, x: number, y: number, kind: ClickKind): Promise<void> {
    const bin = resolveHostBinary()
    const args = ["inject", "--action", kind, "--window-id", String(hwnd),
                  "--x", String(x), "--y", String(y),
                  "--check-occlusion"]  // H8: z-order 检查
    if (this.estopFlagPath) args.push("--estop-flag", this.estopFlagPath)
    await execFileAsync(bin, args, { timeout: 10000 })
  }

  async typeText(hwnd: number, text: string): Promise<void> {
    const normalized = text.normalize("NFKC")       // H4: NFKC 规范化
    const graphemes = [...this.segmenter.segment(normalized)]
                     .map(s => s.segment)            // H2: grapheme 安全分割

    for (let i = 0; i < graphemes.length; i += 16) {
      const chunk = graphemes.slice(i, i + 16).join("")
      const args = ["inject", "--action", "type", "--window-id", String(hwnd),
                    "--text", chunk,
                    "--check-secure-input",          // X2: per-chunk Secure Input
                    "--check-onscreen"]               // X1: Spaces 检查
      if (this.estopFlagPath) args.push("--estop-flag", this.estopFlagPath)
      await execFileAsync(bin, args, { timeout: 5000 })
      await new Promise(r => setTimeout(r, Math.max(chunk.length * 80, 1)))
    }
  }

  // ... keyChord, scroll, drag, probeWindow, foregroundHwnd 同上 ...
}

// 对抗审查 C3 — 缺失的 MacPreviewBuilder
export class MacPreviewBuilder implements PreviewBuilder {
  async build(imagePath: string, point?: { x: number; y: number },
              blurRects?: RectPx[]): Promise<string | null> {
    const bin = resolveHostBinary()
    const args = ["preview", "--image", imagePath]
    if (point) args.push("--x", String(point.x), "--y", String(point.y))
    if (blurRects?.length) args.push("--blur-rects", JSON.stringify(blurRects))
    const result = await execFileAsync(bin, args, { timeout: 10000 })
    const parsed = JSON.parse(result.stdout)
    return parsed.base64 ?? null  // base64 JPEG
  }
}
```

### Item 3.4: `MacUiaLocator` → `MacAxLocator`

实现 `UiaLocator` 接口。macOS Accessibility 树定位:

```typescript
export class MacAxLocator implements UiaLocator {
  async locate(hwnd: number, target: string): Promise<UiaLocateHit | null> {
    const bin = resolveHostBinary()
    const result = await execFileAsync(bin, [
      "ax-locate",
      "--window-id", String(hwnd),
      "--target", target,
    ], { encoding: "utf-8", timeout: 15000 })

    const parsed = JSON.parse(result.stdout)
    if (!parsed.found) return null

    return {
      x: parsed.x,        // 屏幕坐标!
      y: parsed.y,
      bbox: parsed.bbox,
      name: parsed.name,
      controlType: parsed.role,    // AX role: "AXButton", "AXTextField" etc.
      automationId: parsed.identifier,
      confidence: parsed.confidence,
      candidates: parsed.candidates,
    }
  }
}
```

**Swift 端 AX 定位逻辑** (对抗审查 H3 — z-order/可见性检查):

```swift
// 伪代码
func locate(hwnd: UInt32, target: String) -> (x, y, bbox, name, role)?
    let app = AXUIElementCreateApplication(pid)
    let window = findWindow(app, hwnd)
    let matches = traverse(window) { element in
        // H3: 跳过隐藏元素
        if isHidden(element) { return false }
        // H3: 跳过脱离屏幕的元素
        if isOffScreen(element) { return false }
        // H3: 跳过尺寸为零的元素
        if hasZeroSize(element) { return false }
        // 按 accessible Name 匹配 (NFKC + culture-invariant)
        return name.normalize("NFKC") == target  // NFKC normalization
    }
    if matches.count > 1 { /* ambiguous — 取第一个 */ }
    let pos = AXUIElementCopyAttributeValue(match, kAXPositionAttribute)
    let size = AXUIElementCopyAttributeValue(match, kAXSizeAttribute)
    // 返回屏幕坐标
    return (pos.x + size.w/2, pos.y + size.h/2, ...)
```

### Item 3.5: `MacUiaWatcherFactory`

macOS `AXObserverCreate` 替代 Windows `Automation.AddAutomationEventHandler(WindowOpenedEvent)`。

```typescript
export function startMacAxWindowWatcher(
  target: { hwnd: number; pid: number },
  opts?: { maxSeconds?: number },
): Promise<UiaWatcher> {
  // 通过 cmspark-host ax-watch --pid N --max-seconds M 启动守护进程
  // 输出: line-buffered JSON，每行一个 window-opened 事件
  // 超时/崩溃 → dead=true
}
```

### Item 3.6: 测试

- `companion/tests/computer-darwin-adapters-compute.test.ts`: mock `execFile` → 测试 capture/diff/ocr/click/type 解析
- `companion/tests/computer-darwin-injector.test.ts`: 测试 typeText 分批逻辑、边界 case

---

## Batch 4 — 紧急停止 (E-Stop)

**风险**: 中 | **文件数**: ~2 | **新代码**: ~400 行

**对抗审查 C2: 原设计 (分离进程 + 文件心跳) 可被杀 + 伪造。重设计为 UNIX socket 证明活性。**

### Item 4.1: macOS 热键方案 (修订)

**原方案问题**: `RegisterEventHotKey` + 分离进程 + 心跳文件 → 进程可被杀，心跳可伪造。

**修订方案**: CGEventTap + UNIX socket 证明活性。

```swift
// host.swift — estop 守护进程
// 通过 UNIX socket 证明进程活性，消除心跳文件伪造面

func estop() {
    // 1. 创建 UNIX socket: /tmp/cmspark-estop.sock (mode 0600)
    // 2. 注册 CGEventTap 全局热键: Ctrl+Shift+Alt+Cmd+E
    //    (对抗审查 C2: 原 Ctrl+Alt+End 与 macOS 系统快捷键冲突)
    // 3. 事件循环:
    //    - 热键按下 → 写 estop.flag (含时间戳) + 通过 socket 推送 "hotkey" 事件
    //    - Socket 客户端 (companion) 每秒发送 "ECHO" → 守护进程回复 "OK"
    //    - Socket read() 失败 → 进程已死
    // 4. 退出 → 删除 socket 文件 + estop.flag
}
```

**关键优势 vs 原设计**:
- Socket 绑定了进程身份: 其他进程无法绑定同一路径 (地址已占用)
- 不需要心跳文件: socket 的 TCP/UNIX 连接本身就是活性证明
- 如果 estop 进程被杀: socket 关闭 → companion 的 read() 返回 EOF → `EMERGENCY_STOP_LOST`
- 如果 companion 被杀: socket 连接断开 → estop 守护进程检测到后自行退出

### Item 4.2: `darwin-estop.ts` (修订)

```typescript
// companion/src/computer/darwin-estop.ts

import { spawn } from "child_process"
import { createConnection } from "net"
import { resolveHostBinary } from "../host-use/darwin/host-bin"

const ESTOP_SOCK_PATH = "/tmp/cmspark-estop.sock"
const ESTOP_FLAG_PATH = "/tmp/cmspark-estop.flag"

export function estopSocketPath(): string { return ESTOP_SOCK_PATH }
export function estopFlagPath(): string  { return ESTOP_FLAG_PATH }

interface EstopGuardResult { ok: boolean; reason?: string }

export async function ensureEstopHelper(): Promise<EstopGuardResult> {
  // 1. 尝试连接 socket
  try {
    const sock = createConnection(ESTOP_SOCK_PATH)
    await new Promise<void>((resolve, reject) => {
      sock.on("connect", () => { sock.destroy(); resolve() })
      sock.on("error", reject)
      setTimeout(() => reject(new Error("connect timeout")), 2000)
    })
    return { ok: true }
  } catch {
    // socket 不存在或连接失败 → 启动守护进程
  }

  // 2. spawn cmspark-host estop (非 detached, 伴 companion 共存亡)
  const child = spawn(resolveHostBinary(), ["estop", "--socket-path", ESTOP_SOCK_PATH], {
    detached: false,
    stdio: "ignore",
  })
  child.unref()

  // 3. 等待 socket 出现 (最多 5s)
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    try {
      const sock = createConnection(ESTOP_SOCK_PATH)
      await new Promise<void>((resolve, reject) => {
        sock.on("connect", () => { sock.destroy(); resolve() })
        sock.on("error", reject)
      })
      return { ok: true }
    } catch { /* retry */ }
  }
  return { ok: false, reason: "estop helper didn't start within 5s" }
}

export function consumeEstopFlag(): boolean {
  try {
    const content = fs.readFileSync(ESTOP_FLAG_PATH, "utf-8")
    const { timestamp } = JSON.parse(content)
    // 仅消费 task 开始后的 flag
    if (typeof timestamp === "number" && Date.now() - timestamp < 30000) {
      fs.unlinkSync(ESTOP_FLAG_PATH)
      return true
    }
  } catch { /* file 不存在 */ }
  return false
}

export function clearEstopFlag(): void {
  try { fs.unlinkSync(ESTOP_FLAG_PATH) } catch { /* 不存在 */ }
}

export function estopHeartbeatLost(): boolean {
  // socket 连接检查 (替代文件心跳)
  try {
    const sock = createConnection(ESTOP_SOCK_PATH)
    sock.destroy()
  } catch {
    return true  // 连接失败 → 守护进程已死
  }
  return false
}
```

### Item 4.3: 测试

- `companion/tests/computer-darwin-estop.test.ts`: mock fs → 测试 heartbeat expired, flag consume, clear 逻辑

---

## Batch 5 — 执行器接线 (server.ts)

**风险**: 中高 | **文件数**: ~3 | **新代码**: ~400 行

### Item 5.1: `server.ts` — `host_computer` darwin 分支

当前 line ~1933:
```typescript
if (os.platform() !== "win32") {
  return { success: false, error: "host_computer is Windows-only" }
}
```

**替换为**:
```typescript
const isMac = os.platform() === "darwin"
const isWin = os.platform() === "win32"
if (!isWin && !isMac) {
  return { success: false, error: `host_computer requires macOS or Windows (platform=${os.platform()})` }
}
```

然后在 `computerTaskAbort` 注册后，分支接线:

```typescript
if (isMac) {
  const MacAdapterModule = await import("./computer/darwin-adapters")
  const darwinEstop = await import("./computer/darwin-estop")

  const estop = await darwinEstop.ensureEstopHelper()
  if (!estop.ok) {
    return { success: false, error: "..." }
  }

  const result = await runComputerTask(
    { task: ..., app: ..., actions: ..., budget: ..., taskId: computerTaskId },
    {
      capturer: new MacAdapterModule.MacScreenCapturer(),
      locator: new MacAdapterModule.MacLocator(),
      injector: new MacAdapterModule.MacInputInjector(darwinEstop.estopFlagPath()),
      windows: new MacAdapterModule.MacWindowEnumerator(),
      securityEnv: new MacAdapterModule.MacSecurityEnvironment(),
      uiaLocator: new MacAdapterModule.MacAxLocator(),
      evidenceFactory: (taskId) => {
        const { MacEvidenceSealer } = require("./computer/darwin-evidence")
        return new ComputerEvidence(taskId, new MacEvidenceSealer())
      },
      confirm: ...,
      config: getConfig(),
      log: ...,
      abortCheck: () => /* same pattern */,
      onEvent: ...,
      previewBuilder: new MacPreviewBuilder(),
      onActionInjected: ...,
      uiaProber: new MacAdapterModule.MacAxProber(),
      uiaWatcherFactory: MacAdapterModule.startMacAxWindowWatcher,
      tinyclickLocator: null,  // WP5 实验层 macOS 暂不支持
      onUiaVerdict: ...,
    },
  )
}
```

### Item 5.2: L2 Gate 扩展

当前 line ~460:
```typescript
const hostComputerGated = toolName === "host_computer" && os.platform() === "win32"
```

**替换为**:
```typescript
const hostComputerGated = toolName === "host_computer" &&
  (os.platform() === "win32" || os.platform() === "darwin")
```

### Item 5.3: L2 预览截图 (preview image)

Windows 有 `l2-preview-image.ts` 的标注截图。macOS 版本:
- 使用 `MacScreenCapturer` + `MacPreviewBuilder`
- L2 对话框中的三段式 caption 与 Windows 一致

### Item 5.4: 测试

- `companion/tests/server-computer-mac.test.ts`: 测试 server.ts darwin 分支的接线正确性
  - mock 全部适配器
  - 验证 `runComputerTask` 被调用且 deps 正确
  - 验证 platform check 通过

---

## Batch 6 — Swift 二进制扩展

**风险**: 中高 | **文件数**: ~3 | **新代码**: ~800 行 (Swift)

### Item 6.1: 新增子命令表

| 子命令 | 用途 | 批处理 |
|--------|------|--------|
| `window-list --bundle-id X` | 枚举窗口 | Batch 2 |
| `window-list --foreground` | 前台窗口 | Batch 3 |
| `ax-probe --window-id N` | AX 树密度统计 | Batch 2 |
| `ax-locate --window-id N --target T` | AX 定位控件 | Batch 3 |
| `ax-watch --pid N --max-seconds M` | AX 新窗口监听 | Batch 3 |
| `screenshot --window-id N --output P` | 窗口截图 | Batch 3 |
| `crop --source P --output P --x --y --w --h` | 图片裁剪 | Batch 3 |
| `imgdiff --a P --b P [--x --y --w --h]` | 像素差异 | Batch 3 |
| `ocr --image P [--language L]` | OCR 文本识别 | Batch 3 |
| `inject --action click\|type\|key\|scroll\|drag ...` | 事件注入 | Batch 3 |
| `security-check` | AX 权限 + Secure Input | Batch 2 |
| `estop` | 热键监听守护进程 | Batch 4 |

### Item 6.2: 关键 Swift 实现注意事项

1. **CGWindowListCreateImage**: 截图时需要 `kCGWindowImageBoundsIgnoreFraming` 选项来获取窗口内容区域
2. **CGEventPost**: 注入事件到目标进程需要 `kCGHIDEventTap` 权限 (Accessibility)
3. **CGEventPostToPid**: macOS 10.15+ 支持直接投递到目标 PID (比 `PostToPSN` 更好)
4. **AXUIElement**: 递归遍历 AX 树时注意性能 (可能非常深)
5. **VNRecognizeTextRequest**: 使用 `VNImageRequestHandler(cgImage:options:)` 加载截图
6. **RegisterEventHotKey**: Carbon API 需要 `#import <Carbon/Carbon.h>`
7. **JSON 序列化**: 所有子命令输出 `JSONEncoder` 生成的一行 JSON

### Item 6.3: entitlements 扩展

```xml
<!-- host.entitlements -->
<key>com.apple.security.automation.apple-events</key>
<true/>
<!-- 新增 -->
<key>com.apple.security.device.camera</key>    <!-- 不需要 -->
<key>com.apple.security.personal-information.photos-library</key> <!-- 不需要 -->
```

Screen Recording 和 Accessibility 是 TCC 权限，不需要在 entitlements 中声明（由 Info.plist 的 `NSAppleEventsUsageDescription` 触发）。

### Item 6.4: 测试

- `companion/tests/computer-darwin-swift.test.ts`: 端到端读/验证 Swift 子命令 JSON 输出
  - mock `execFile`，使用 fixture JSON 数据

---

## Batch 7 — AX 定位链 (L0 层)

**风险**: 中 | **文件数**: ~2 | **新代码**: ~400 行

### Item 7.1: AX 定位回归

AX 层定位的坐标是**屏幕坐标** (与 Windows UIA 相同)，需要映射到截图坐标:

```typescript
// locate-chain.ts 不需要修改 — 屏幕→图像坐标映射已经存在
// (UIA BoundingRectangle 是屏幕空间，AX Position 也是屏幕空间)
```

### Item 7.2: AX↔OCR 见证验证

与 Windows UIA↔OCR 见证验证完全一致:
- AX bbox 大小上限: ≤150K px² AND ≤30% 窗口
- OCR 重建验证: 连续字符重建
- 单字锚点: 全词匹配
- 不一致 → 降级到 L1 OCR

**不需要修改 `locate-chain.ts`** — 见证逻辑已完全通用。

### Item 7.3: 测试

- `companion/tests/computer-locate-mac.test.ts`: 测试 AX→屏幕坐标→图像坐标映射、witness 验证

---

## Batch 8 — 证据链 (Evidence Sealer)

**风险**: 低 | **文件数**: ~1 | **新代码**: ~200 行

**对抗审查 C1: 原设计用 `security` CLI + `-T /usr/bin/security` → 任何同用户进程可读。重设计为 Swift 端密钥管理。**

### Item 8.1: `MacEvidenceSealer` (修订 — 密钥永不离开 Swift)

Swift 端通过 `SecItemAdd` 创建 keychain 条目，绑定到 cmspark-host 的 code signature ACL:

```swift
// host.swift — evidence-key 子命令 (首次运行)
func generateEvidenceKey() {
    let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        [.applicationPassword],  // 需要生物识别或设备密码
        nil
    )
    let key = SymmetricKey(size: .bits256)
    let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: "com.cmspark.evidence",
        kSecAttrAccessControl as String: access!,
        kSecValueData as String: key.rawRepresentation,
        // 不设 kSecAttrAccessGroup → 仅本 app 可读
    ]
    SecItemAdd(query as CFDictionary, nil)
}
```

```swift
// host.swift — evidence-seal / evidence-unseal 子命令
// 加密/解密操作在 Swift 进程内完成，密钥永不返回 Node.js
func evidenceSeal(input: String, output: String, blurRects: String?) {
    let key = loadEvidenceKey()  // SecItemCopyMatching (需要 code sign 匹配)
    let raw = try Data(contentsOf: URL(fileURLWithPath: input))
    // 像素化 credential 区域 (16×16 块平均)
    let blurred = blurRects != nil ? pixelateCredentials(raw, blurRects!) : raw
    // AES-256-GCM 加密
    let sealed = try AES.GCM.seal(blurred, using: key)
    try sealed.combined!.write(to: URL(fileURLWithPath: output))
    try FileManager.default.removeItem(atPath: input)  // 删除 raw
}
```

TypeScript 侧 (`darwin-evidence.ts`) **不管理密钥**:

```typescript
export class MacEvidenceSealer implements EvidenceSealer {
  async seal(rawPath: string, blurRects?: RectPx[]): Promise<string> {
    const outPath = rawPath + ".sealed"
    const args = ["evidence-seal", "--input", rawPath, "--output", outPath]
    if (blurRects) args.push("--blur-rects", JSON.stringify(blurRects))
    const result = await execFileAsync(resolveHostBinary(), args, { timeout: 15000 })
    const parsed = JSON.parse(result.stdout)
    if (!parsed.ok) throw new ComputerError("EVIDENCE_ERROR", parsed.error)
    return outPath
  }

  async unseal(sealedPath: string): Promise<Buffer> {
    const outPath = sealedPath.replace(/\.sealed$/, ".raw")
    const result = await execFileAsync(resolveHostBinary(), [
      "evidence-unseal", "--input", sealedPath, "--output", outPath
    ], { timeout: 15000 })
    // ... read outPath → Buffer
  }
}
```

**安全优势 vs 原 `security` CLI 设计**:
- 密钥通过 `SecItemAdd(kSecClassKey)` 存储，默认只允许创建者 app 读取
- code signing ACL 确保只有原始签名的 cmspark-host 能访问密钥
- `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 确保锁屏时密钥不在内存
- Node.js 侧永远看不到原始密钥字节

### Item 8.2: 测试

- `companion/tests/computer-darwin-evidence.test.ts`: mock `execFile("security")` → 测试 seal/unseal round-trip

---

## Batch 9 — 功能测试 + E2E 验证

**风险**: 中 | **文件数**: ~5 | **新代码**: ~600 行 (测试)

### Item 9.1: 适配器集成测试

- `companion/tests/computer-darwin-adapters-all.test.ts`: 集成 mock — 模拟完整 task 流程
  ```
  enumerateByExe → capture → ocr → locate → click → diff → seal
  ```

### Item 9.2: executor 集成测试

```typescript
// companion/tests/computer-executor-mac.test.ts

test("happy path: click via OCR locate", async () => {
  // Mock: 所有适配器用 fake 实现
  const result = await runComputerTask(
    { task: "click save", app: "mac.app.notes", actions: [{ action: "click", target: "保存" }] },
    mockMacDeps,
  )
  expect(result.success).toBe(true)
  expect(result.completedActions).toBe(1)
})

test("A1: stale screenshot → re-locate", async () => { /* ... */ })
test("A2: dialog pops up → pause + reL2", async () => { /* ... */ })
test("A3: unconfirmed text → rejected", async () => { /* ... */ })
test("A4: payment click → hard deny", async () => { /* ... */ })
test("A10: coordinateEnabled=false → COMPUTER_DISABLED", async () => { /* ... */ })
```

### Item 9.3: macOS 特有边界测试

```typescript
test("AX tree empty → degrade to OCR", async () => { /* ... */ })
test("Secure Input active → DESKTOP_DENIED", async () => { /* ... */ })
test("Accessibility not granted → INTEGRITY_LEVEL_DENIED", async () => { /* ... */ })
test("AX witness disagree → degrade to OCR, record witness in evidence", async () => { /* ... */ })
test("E-Stop: heartbeat < 3s → ok; > 3s → EMERGENCY_STOP_LOST", async () => { /* ... */ })
test("E-Stop: hotkey pressed mid-task → TASK_ABORTED", async () => { /* ... */ })
```

---

## 文件变更清单

| 文件 | 变更类型 | Batch |
|------|----------|-------|
| `companion/src/apps/types.ts` | 修改 | B1 |
| `companion/src/config.ts` | 修改 | B1 |
| `companion/src/computer/types.ts` | 修改 | B1 (NFKC in corpusOf) |
| `companion/src/computer/policy.ts` | 修改 | B1 |
| `companion/src/computer/executor.ts` | 修改 | B1 (平台感知 window 解析) |
| `companion/src/computer/ocr-locate.ts` | **新增** | B3 (共享 locate 逻辑) |
| `companion/src/computer/darwin-adapters.ts` | **新增** | B2+B3 |
| `companion/src/computer/darwin-estop.ts` | **新增** | B4 |
| `companion/src/computer/darwin-evidence.ts` | **新增** | B8 |
| `companion/src/host-use/darwin/host.swift` | 修改 | B6 |
| `companion/src/host-use/darwin/host.entitlements` | 修改 | B6 |
| `companion/src/host-use/darwin/host-Info.plist` | 修改 | B6 |
| `companion/src/host-use/darwin/build-host.sh` | 修改 | B6 |
| `companion/src/host-use/darwin/host-bin.ts` | 修改 | B6 |
| `companion/src/server.ts` | 修改 | B5 |
| `companion/src/bridge/tool-definitions.ts` | 修改 | B5 |
| `companion/tests/computer-policy.test.ts` | 修改 | B1 |
| `companion/tests/computer-darwin-adapters-calm.test.ts` | **新增** | B2 |
| `companion/tests/computer-darwin-adapters-compute.test.ts` | **新增** | B3 |
| `companion/tests/computer-darwin-estop.test.ts` | **新增** | B4 |
| `companion/tests/computer-darwin-evidence.test.ts` | **新增** | B8 |
| `companion/tests/computer-executor-mac.test.ts` | **新增** | B9 |
| `companion/tests/server-computer-mac.test.ts` | **新增** | B5 |

**不变模块** (0 修改): `danger.ts`, `preview.ts`, `rate-limit.ts`, `security.ts`, `security-policy.ts`, `handlers.ts`, `confirm.ts`, `tool-schemas.ts`

**新增需修改**: `types.ts` (NFKC), `executor.ts` (平台感知), `locate-chain.ts` (不变——坐标映射已通用)

---

## 执行顺序

```
B1 (类型+配置+NFKC+executor) ──┬── B2 (calm适配器) ──┬── B4 (E-Stop) ──┬── B5 (server接线) ──── B9 (E2E测试)
                               │                      │                  │
                               └── B6 (Swift扩展) ────┴── B3 (compute适配器) ──┴── B8 (证据链) ──┘

B1 必须先行 (APP_TOKEN_PATTERN, bundleId, NFKC, executor 修改是所有后续的基础)
B6 依赖 B1 完成
B2 依赖 B1 完成
B3 + B4 + B8 依赖 B2 + B6
B5 依赖 B2 + B3 + B4 + B8
B9 依赖 B5
```

**对抗审查 M3: 原计划声称 B1+B6 可并行是错误的。B1 的 token 模式 + bundleId 字段是 B6 适配器的基础。**

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| AX 树不可用 (Electron/游戏应用) | 中 | L0 定位失败 → 降级 OCR | OCR 作为 L1 覆盖 |
| CGEvent 被 Secure Input 阻断 | 低 | 注入失败 | pre-injection security-check |
| Swift 二进制跨架构兼容 (ARM64 vs x86_64) | 低 | 打包/分发 | universal 编译 |
| AX 性能: 深层树遍历超时 | 中 | ax-probe 超时 | 10s timeout + capped depth |
| `RegisterEventHotKey` 热键冲突 | 低 | E-Stop 不可用 → fail-closed | preflight 检查 + 用户提示 |

---

## macOS vs Windows 差异总结

| 维度 | Windows | macOS |
|------|---------|-------|
| L0 定位 | UIA (System.Windows.Automation) | AX (NSAccessibility) |
| L1 OCR | Windows.Media.Ocr (WinRT) | Apple Vision (VNRecognizeTextRequest) |
| L2 实验层 | TinyClick (ONNX) | 暂不支持 |
| 注入 | SendInput (user32.dll) | CGEventPost (Quartz) |
| 截图 | PrintWindow + BitBlt fallback | CGWindowListCreateImage |
| 进程隔离 | UIPI (完整性级别) | TCC (Accessibility 权限) |
| 证据封存 | DPAPI | Keychain + AES-256-GCM |
| 热键 | GetAsyncKeyState (Ctrl+Alt+End) | Carbon RegisterEventHotKey |
| 窗口枚举 | EnumWindows | CGWindowListCopyWindowInfo |
| exe 漂移检测 | SHA256 of .exe path | 信任 code signing (不实现) |
| 桌面检测 | OpenInputDesktop="Default" | Secure Input 模式检测 |
| token 模式 | win.app.* | mac.app.* |

---

## 验证计划

1. **TypeScript 编译**: `npx --prefix companion tsc --noEmit`
2. **单元测试**: `npm --prefix companion run test -- --testPathPattern="computer-darwin|computer-executor-mac|server-computer-mac"`
3. **全量回归**: `npm --prefix companion test`
4. **Kimi code review**: `git diff` 送审
5. **手动 E2E** (本地 macOS):
   - 启动 Companion + Extension
   - 添加 Notes.app 到 App Tab → 开启 coordinate
   - 执行: "在 Notes 里创建一个新笔记，标题为'测试'"
   - 验证: Notes.app 窗口切换、AX 定位 "新建" 按钮、CGEvent 点击、CGEvent 输入文字
