# macOS TCC 产品身份统一 — 产品设计（对抗验证 SoT）

> **日期**: 2026-08-01  
> **状态**: LOCKED for implementation (post adversarial pass)  
> **触发**: 用户明确否决「去勾选 node / cmspark-host」——仅应见 **CMspark.app**  
> **关联实现计划**: [../plans/2026-08-01-macos-tcc-product-identity-impl.md](../plans/2026-08-01-macos-tcc-product-identity-impl.md)  
> **关联现象**: L2 / 外程序截图 ScreenCaptureKit `-3801`；设置里 CMspark 已开仍失败

---

## 0. 一句话

**系统隐私设置里，屏幕录制 / 辅助功能 / 自动化 的用户可见主体只能是「CMspark」；node 与 cmspark-host 不得成为用户路径上的权限主体或文案主体。**

---

## 1. 用户旅程（必须成立）

### 1.1 目标旅程（Happy path）

1. 用户安装 / 打开 **CMspark.app**  
2. 首次 Computer Use 截图 → 系统弹出 **「CMspark」请求屏幕录制**  
3. 用户打开 **系统设置 → 隐私与安全性 → 屏幕录制**，列表中 **只有「CMspark」相关项**（或明确显示应用名 CMspark），勾选后重启 App  
4. 外程序窗口截图成功；辅助功能同理只勾 **CMspark**  
5. 任何错误/引导文案 **只写 CMspark**，并 deep-link 到系统设置（若可用）

### 1.2 明确禁止的旅程

| 禁止 | 原因 |
|------|------|
| 文案要求勾选 **node** | 用户只认 CMspark.app，认知断裂 |
| 文案要求勾选 **cmspark-host** | 内部 helper 名泄漏 |
| 「CMspark 已开但仍要开第二个进程」 | 假绿 / 双身份 |
| 开发文档把「勾 node」当正式用户步骤 | 产品债务固化 |

---

## 2. 现状根因（已取证，非假设）

| 层 | 现状 | TCC 含义 |
|----|------|----------|
| `Contents/MacOS/CMspark` | **bash 脚本** → `exec node … tray` | 主可执行文件 **不是** 截图进程 |
| Agent | `Resources/node` + `cmspark-agent.js` | 长期存活；**不是** SCK 调用方，但可污染列表 |
| 截图/注入/急停 | `Resources/cmspark-host`，`CFBundleIdentifier=com.cmspark.host`，**ad-hoc** | **ScreenCaptureKit 实际调用方**；权限记在 **host / 独立 CDHash** |
| App 壳 | `com.cmspark.agent`，ad-hoc deep-sign | 用户勾的「CMspark」与捕获进程 **常不对齐** |
| 历史设计 | host 注释：Automation 锚到 `cmspark-host` 而非 `osascript` | 正确动机、错误产品结果：屏幕录制也被绑到 helper 名 |

**结论**: 不是用户没开权限，是 **产品身份与捕获进程身份分裂**。

---

## 3. 产品锁（D 系列 — 实现不得违反）

| ID | 锁 | 验收 |
|----|-----|------|
| **D1** | 用户可见 TCC 主体唯一：**CMspark**（`com.cmspark.agent`） | 隐私设置 / 系统弹窗不出现 node、cmspark-host 作为**推荐操作对象** |
| **D2** | ScreenCaptureKit / 注入 / estop **不得**在 `node` 进程内发生 | 静态 + 运行时：SCK 仅在原生主身份二进制 |
| **D3** | 用户文案（错误、侧栏、用户文档）**禁止**出现「勾选 node / cmspark-host」 | `rg` 门禁 + 手册审阅 |
| **D4** | 打包后主可执行文件 `Contents/MacOS/CMspark` 必须是 **Mach-O**，禁止 bash 作为主入口 | `file` 断言 |
| **D5** | 原生捕获二进制嵌入的 Info.plist：`CFBundleIdentifier=com.cmspark.agent`，`CFBundleName/DisplayName=CMspark` | `codesign -d --info-plist` / strings |
| **D6** | `resolveHostBinary()` 在 packaged 布局优先解析 **主身份二进制**（MacOS/CMspark 或与其 hardlink 的同 inode 产物） | 单测 + 包布局 gate |
| **D7** | 开发态可保留 `dist/cmspark-host` 文件名（工程兼容），但 **发布包用户路径** 不得要求用户认识该名 | 用户文档零出现；内部日志可用 `host_bin` |
| **D8** | 迁移：旧 grant 失效时，引导 **只开 CMspark + 完全退出重开**，不引导勾历史幽灵进程 | 文案模板锁 |
| **D9** | P0 **不**要求 Developer ID（可仍 ad-hoc）；但必须在风险里写明：**ad-hoc 重装可能清授权**；P1 再做稳定签名 | 手册诚实段 |
| **D10** | 安全：`CMSPARK_HOST_BIN` 覆盖仍需 `CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1` | 既有安全测试不回退 |

---

## 4. 方案候选与对抗淘汰

### 方案 A — 文档教用户勾 node / host  
**淘汰（用户已否决 + D1/D3）**。非方案。

### 方案 B — 仅改错误文案，进程不动  
**淘汰**: 勾 CMspark 仍 `-3801`；假绿更严重。

### 方案 C — 把 `cmspark-host` 嵌进 Resources 并改显示名  
**弱通过 / 高风险**: 无稳定 Team ID 时 macOS 仍常按 **可执行文件路径/CDHash** 列项；bash 主入口仍分裂。对抗结论：**不足**。

### 方案 D — P0：主可执行文件 = 现有 host 逻辑（扶正）✅ 入选  
1. 构建产物逻辑保留；**发布布局**下 `Contents/MacOS/CMspark` = 该 Mach-O（同二进制兼：默认启动 tray、子命令 screenshot/inject/estop…）。  
2. 无参 / `tray`：拉起 `Resources/node … cmspark-agent.js tray`（或等价）。  
3. node 只做 Agent；截图仍 spawn **同一 Mach-O**（路径可为 MacOS/CMspark）。  
4. 嵌入 plist 改为 `com.cmspark.agent` / CMspark。  
5. `host-scripts` 相对路径改为兼容 MacOS/ 与 Resources/。  
6. 文案与用户文档清零 node/host。

### 方案 E — P1：主进程常驻 + XPC 截图  
更干净；**本轮不做**（范围爆炸）。列入 P1。

### 方案 F — 立刻 Developer ID + 公证  
正确长期方向；**不阻塞 P0 身份统一**；与 D9 对齐。

---

## 5. 对抗验证矩阵（多角色）

验证方式：对方案 D 做 **四角色否决测试**；任一 **Blocker** 必须改方案或加任务，不得「实现后再说」。

### 5.1 角色定义

| 角色 | 攻击面 |
|------|--------|
| **P — 产品** | 用户是否仍看到/被要求操作非 CMspark 实体 |
| **T — TCC/平台** | 真实 macOS 上 SCK 权限是否落到 `com.cmspark.agent` |
| **S — 安全** | 身份合并是否扩大攻击面；host override / 二进制替换 |
| **R — 发布/回归** | 打包、dev 布局、estop、Automation、self-UI 是否炸 |

### 5.2 攻击清单 → 处置

| # | 攻击（Adversary claim） | 角色 | 严重度 | 处置（锁进计划） |
|---|------------------------|------|--------|------------------|
| A1 | 主二进制改 Mach-O 后，无参启动不会进 tray，用户双击无菜单 | P | Blocker | 默认 argv：无 subcommand → launch agent tray；保留显式 `tray` |
| A2 | `findScript` 仍 `next to executable`，MacOS/ 下找不到 `host-scripts` | R | Blocker | 搜索顺序：`../Resources/host-scripts` → sibling `host-scripts` → 现有 |
| A3 | `resolveHostBinary` 仍只找 `Resources/cmspark-host`，spawn 旧路径 | T/R | Blocker | 候选列表首位：`…/MacOS/CMspark`（packaged）；兼容旧 `cmspark-host` |
| A4 | 嵌入 plist 仍是 `com.cmspark.host`，列表显示 cmspark-host | P/T | Blocker | 改 `host-Info.plist`；build 后断言 identifier |
| A5 | 短生命周期 CLI 在隐私列表显示「进程名」而非 App | T | High | 主可执行文件名必须为 `CMspark`；DisplayName=CMspark；验收以 **真机列表截图/描述** 为准 |
| A6 | 同时保留 Resources/cmspark-host **另一份** ad-hoc 二进制 → 双身份回归 | T | Blocker | 发布包：**同一文件** hardlink/copy 单一构建；或只保留 MacOS 一份，resolve 只指向它 |
| A7 | node 仍出现在屏幕录制（历史幽灵 + 误触发） | P | Medium | 文案不提；迁移说明可「关闭并删除未知项」；确保无 SCK in node（D2） |
| A8 | Automation 弹窗变成 CMspark 后 Mail 描述是否合适 | P | Low | 更新 `NSAppleEventsUsageDescription` 为产品向文案（CMspark needs…） |
| A9 | estop 文案仍写 cmspark-host Accessibility | P | Medium | 全部用户可见串 → CMspark |
| A10 | `self-ui` 只认 host id，合并后前台自检失败 | R | Medium | 保留 `com.cmspark.agent`；host id 可保留兼容一期 |
| A11 | `CMSPARK_HOST_BIN` 指到任意路径绕过完整性 | S | Blocker | 保持 override 双开关；packaged 默认路径不可被 launchctl 注入 |
| A12 | ad-hoc 重装 CDHash 变 → 用户以为「勾了又失效」 | P/T | High | 用户文档诚实段 + 错误串「完全退出后重开 CMspark；若刚更新安装请重新打开开关」；**不**提 node |
| A13 | `install-daemon.sh` / 旧 launcher 仍生成 bash 入口 | R | High | 同步改所有 .app 生成路径或标注废弃 |
| A14 | Dev：`dist/cmspark-host` 仍叫 host，开发者 TCC 混乱 | P | Low | 工程名可保留；**验收标准以 packaged app 为准**；dev 文档一行说明 |
| A15 | 把 host 当主入口后，hardened runtime 与 node 子进程的库加载 | S/R | Medium | 保持现有 entitlements；tray 用 exec/spawn node 不继承错误 sandbox 假设 |
| A16 | 测试大量 hardcode `cmspark-host` 路径导致 CI 红 | R | Medium | 兼容别名：构建仍产出 `dist/cmspark-host`；打包阶段 **install 为 CMspark** |
| A17 | 用户同时开旧 cmspark-host 与新 CMspark，坐标/注入指错身份 | T | Medium | 单一 resolve；不双 spawn；文档建议关掉旧授权项 |
| A18 | 方案 D 未解决「仅勾 App 壳、子进程另一 CDHash」 | T | Blocker | **子进程必须是主 bundle 的 MacOS/CMspark 同一签名产物**，禁止再 spawn Resources 下另一 signed blob |
| A19 | 文案清零遗漏 host.swift 中英双语 / skylight 分叉 | P | Medium | `rg` 门禁扫 `host.swift` + `host-skylight.swift` + docs + executor |
| A20 | P0 做完仍无真机外 App 截图证据就宣称完成 | T | Blocker | 验收门：WeChat/系统设置等非 Chrome 窗口截图 success + 隐私列表描述 |

### 5.3 对抗结论

| 结论 | 内容 |
|------|------|
| **Verdict** | **APPROVE_WITH_CHANGES** → 方案 D + A1–A6/A11/A18/A20 必须进 P0 |
| **否决** | A / B / 纯文案；C 单独不足 |
| **P0 完成定义** | 见 §6 + 实现计划 DoD |
| **P1** | XPC 常驻截图；Developer ID + notarize；隐私列表零幽灵自动化清理工具 |

---

## 6. P0 完成定义（DoD）— 对抗验收门

全部满足才可宣称「产品身份统一完成」：

1. **[packaged]** `file Contents/MacOS/CMspark` → Mach-O arm64（非 script）  
2. **[packaged]** 该二进制 `CFBundleIdentifier` / 嵌入 plist = `com.cmspark.agent`  
3. **[runtime]** 一次失败的截图错误串 **不含** `node`、`cmspark-host` 作为用户操作对象  
4. **[runtime]** `resolveHostBinary()` 在 app 内解析到 `…/Contents/MacOS/CMspark`（或与其相同 inode 的唯一产物）  
5. **[manual TCC]** 干净用户（或重置相关 TCC 后）：首次截图系统提示主体为 **CMspark**；设置列表中用户操作项为 **CMspark**（允许存在历史 node 幽灵，但 **产品不得引导勾选**）  
6. **[manual capture]** 对 **非 Chrome** 前台窗口（如系统设置 / 备忘录）`host_computer` 截图成功（非 -3801）  
7. **[regression]** companion 单测相关子集绿；package gate 更新且绿  
8. **[docs]** `computer-use-user-guide` 增加「仅授权 CMspark」小节；删除任何「勾 node」表述  

**禁止**：仅改文案 + 开发机偶然成功却无 packaged 布局验证。

---

## 7. 非目标（本轮不做）

- Windows / Linux TCC 类比  
- 重写 Computer Use 协议  
- Qwen / TinyClick 模型层  
- Developer ID 采购与 CI 公证流水线（P1）  
- 完整 XPC 架构（P1）  

---

## 8. 风险登记（诚实）

| 风险 | 缓解 |
|------|------|
| ad-hoc 更新清授权 | D9 文档 + 错误串；P1 签名 |
| 历史 node 条目残留吓到用户 | 迁移说明：可忽略/关闭未知项，**只开 CMspark** |
| 主二进制兼 CLI 与 GUI 启动复杂度 | A1 明确默认 tray；子命令表单测 |
| skylight 实验二进制分叉 | 实验 bin 不进用户包；或同步改 plist |

---

## 9. 文档与代码锚点（实现入口）

| 区域 | 路径 |
|------|------|
| 捕获实现 | `companion/src/host-use/darwin/host.swift` |
| 嵌入身份 | `companion/src/host-use/darwin/host-Info.plist` |
| 构建 | `companion/src/host-use/darwin/build-host.sh` |
| 解析 | `companion/src/host-use/darwin/host-bin.ts` |
| 打包 | `scripts/create-dmg.sh`, `scripts/package.sh` |
| App plist | `scripts/macos/Info.plist` |
| 用户错误 | `host.swift` SCK 分支；`executor.ts` CAPTURE_FAILED |
| self-UI | `companion/src/computer/self-ui.ts` |
| 用户文档 | `docs/computer-use-user-guide.md` |

---

## 10. 变更控制

- 修改 D1–D10 或 DoD 需更新本文 **并** 重跑 §5.2 相关攻击项。  
- 实现以 [impl plan](../plans/2026-08-01-macos-tcc-product-identity-impl.md) 任务勾选为准。  
