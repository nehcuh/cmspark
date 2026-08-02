# Windows Qwen-VL uv/Python 发现链路 — 产品与技术设计 SoT

> **日期**: 2026-08-02  
> **状态**: **P0 LANDED in tree** — Pi **APPROVE_WITH_NITS**（`windows-uv-python-chain-verdict-20260802.json`）；nits 已折叠；`findUv` 本机 WinGet 绝对路径冒烟通过；`computer-python-runtime` 21/21 绿  

> **触发**: 用户机已装 uv（WinGet + `~\.local\bin`），设置页仍显示「未检测到 uv」；文案写死 `brew install uv`  
> **对抗合成**: [windows-uv-python-chain-adversary-synthesis-20260802.md](../../audit/reviews/windows-uv-python-chain-adversary-synthesis-20260802.md)  
> **原始四路**: [windows-uv-python-chain-adversary-raw-20260802.md](../../audit/reviews/windows-uv-python-chain-adversary-raw-20260802.md)  
> **实现计划**: [../plans/2026-08-02-windows-uv-python-chain-impl.md](../plans/2026-08-02-windows-uv-python-chain-impl.md)  
> **关联**: ADR-019 · ADR-020 · Qwen3-VL 实验层 · `python-runtime.ts` · MCP `buildSpawnPath`

---

## 0. 一句话

**在不永久改 PATH、不捆绑 uv 的前提下，用「绝对路径 well-known 探测 + 进程内查找 PATH 增强 + 发现后绝对路径钉死执行 + 平台安装文案」消除 Windows Companion 对已装 uv 的假阴性，并堵住裸 `uv` 二次 PATH 解析的劫持面。**

---

## 1. 问题（用户与代码）

### 1.1 用户感知

- 终端里 `where uv` / `uv --version` 正常，侧栏实验功能却写「未检测到 uv」。  
- 提示「可选：brew install uv」——在 Windows 上不可执行、破坏信任。  
- 无法看到 Companion 实际锁定的是哪一个 `uv.exe`。

### 1.2 代码真相（不得用文案掩盖）

| 机制 | 实际行为 |
|------|----------|
| `findUv()` | `where`/`which` + bare `spawn("uv")`，仅 `process.env`（`python-runtime.ts`） |
| `runCapture` | 始终 `env: process.env`，无 PATH 硬化 |
| `buildSpawnPath` | **仅** MCP stdio 使用；computer 零引用；且无 WinGet Packages |
| `uvPath` | `PythonRuntimeInfo` 有字段，preflight/handlers/UI 只传 `uvAvailable` |
| 安装文案 | preflight + Settings 全平台 `brew install uv` |
| 测试 | `computer-python-runtime.test.ts` 仅 `sanitizePythonPackages` |

### 1.3 本机实证（2026-08-02）

- User PATH：WinGet `astral-sh.uv_*` 包目录  
- Machine PATH：**无** uv  
- 磁盘另有 `%USERPROFILE%\.local\bin\uv.exe`（**不在** User PATH）  
- Machine-only PATH 模拟：`where uv` 失败、`spawn uv` ENOENT，但 `.local\bin\uv.exe` 仍存在  

---

## 2. 目标与非目标

### 2.1 目标

| ID | Goal |
|----|------|
| G1 | 进程 PATH 残缺时仍能发现常见布局的 uv（WinGet / `.local` / scoop / choco / cargo / homebrew） |
| G2 | 发现成功后**执行路径永远是绝对路径**（含 `ensureIsolatedPythonEnv`） |
| G3 | 设置/preflight 安装提示平台化（win32≠brew） |
| G4 | 可用时在 preflight/state/UI 暴露绝对 `uvPath` |
| G5 | 不回归 darwin/linux；`sanitizePythonPackages` 不变 |
| G6 | uv 仍可选；不挡 `canDownload`/`canEnable` |

### 2.2 非目标

- ❌ 捆绑 uv 二进制进 cmspark 包（Scheme E）  
- ❌ 静默写 Machine/User PATH / 注册表  
- ❌ 改变 isolated vs system Python 产品语义  
- ❌ 对 system Python 静默 pip install  
- ❌ computer → `mcp/transport` 层倒置 import  
- ❌ 展开 user-env 到 python-runtime（ADR-019）  
- ❌ 模型下载、torch CUDA、locate 精度、MCP 服务器 UI  

---

## 3. 方案对抗结论

| 方案 | 结论 |
|------|------|
| A 仅文案 | **否决为终态**（假阴性仍在） |
| B 仅复用 buildSpawnPath 环境 | **否决单独交付**（缺 WinGet；仍可能 bare `uv`） |
| C 仅绝对路径探测 | **否决单独交付**（漏 PATH-only 合法安装） |
| **D 混合** | **锁定交付** |
| E 捆绑 uv | **否决**（供应链/体积/签名） |
| F 配置绝对路径作主路径 | **否决作主路径**；P1 可选逃生舱 |
| 静默改 PATH 注册表 | **全员否决** |

四路（Platform / Security / Product / Compat）一致锁定 **D**。

---

## 4. 产品与安全锁（W1–W12）

| ID | 锁 | 验收 |
|----|-----|------|
| **W1** | 发现序：P1 可选 config 覆盖 → well-known 绝对探测 → 进程内增强 PATH 上 `where`/`which` → 失败则 `uvAvailable:false` | 单测 + 代码序 |
| **W2** | 成功后存储并 spawn **绝对** `uvPath`（优先 realpath）；**禁止**在已知绝对路径后仍以裸 `"uv"` 为规范名 | `ok:true` ⇒ `path.isAbsolute` |
| **W3** | Win32 探测（exists + isFile + basename `uv.exe`）：`WinGet\Packages\astral-sh.uv_*\uv.exe`（**仅** package-id 前缀）；`%USERPROFILE%\.local\bin\uv.exe`；scoop shims；chocolatey\bin；`.cargo\bin`；可选 WinGet Links | 单测 fixture |
| **W4** | Unix：`~/.local/bin/uv`、`/opt/homebrew/bin/uv`、`/usr/local/bin/uv` + which | 不回归 |
| **W5** | PATH 增强**仅**查找用 spawn env；永不写系统 PATH/注册表 | 无 registry 副作用 |
| **W6** | 不在 computer 中 import `mcp/transport`；探测逻辑落在 `python-runtime`（共享 util 可选 P1） | import 图检查 |
| **W7** | 安装文案：win32 `winget install --id astral-sh.uv -e`（scoop 次要）；darwin `brew install uv`；linux 官方/curl；**win32 永不 brew-only** | 字符串单测 |
| **W8** | `uvPath` 经 preflight → model.state → extension types/UI | 字段存在 |
| **W9** | uv `blocking:false`；isolated/system 语义不变 | 产品回归 |
| **W10** | 不把 user-env 的 PATH/PYTHONPATH 并入 python-runtime | denylist 保持 |
| **W11** | **执行**优先绝对候选，再 PATH（敌意 PATH 上假 uv 不能抢占） | 单测 |
| **W12** | ADR-020：现有实验层 Surface 的 runtime 工具，非新 Autonomy 轴 | 文档声明 |

---

## 5. 设计形态（P0）

### 5.1 `findUv` 算法

```text
1. [P1] if config.computer.uvPath absolute+exists+--version → return
2. for cand in wellKnownAbsoluteCandidates(platform):
     if isUvExecutable(cand) && versionProbe(cand) → return realpath(cand)
3. pathEnv = processLocalLookupPath()  // 思想借鉴 buildSpawnPath，本地实现
   where/which uv under pathEnv
   if absolute hit && versionProbe → return realpath
4. return { ok: false }
// 禁止: ok:true && path === "uv"
```

### 5.2 执行

- `ensureIsolatedPythonEnv`：`uvBin` 必须为绝对路径，否则走非 uv 分支或失败。  
- `buildInstallCommands`：有绝对路径时优先打印带引号的绝对路径（P0 nice-to-have，推荐做）。

### 5.3 UI / preflight

- 未检测：平台安装命令（W7）+ 可选「安装后重启 Companion」。  
- 已检测：`· 已检测到 uv` + 截断显示 `uvPath`。  
- **不**因无 uv 禁用下载/开启实验层。

### 5.4 能力声明（ADR-020）

```text
Surface:      existing Qwen3-VL experimental locate (no new tool)
L2-classes:   none new
Compose:      none
Autonomy:     n/a
Trust:        no arm keys / pack keys
Channel:      community
```

---

## 6. 分期

| Phase | Scope | Gate |
|-------|--------|------|
| **P0** | findUv 探测+绝对钉死；平台文案；uvPath 透传；单测 | 本节 G1–G6 + W1–W12 |
| **P1** | `computer.uvPath` 配置覆盖；设置内「重新检测」；可选 shared path-env + MCP WinGet | 另开 / 不挡 P0 |

---

## 7. Pi 拒绝门（任一 → REJECT 开工）

| # | Gate |
|---|------|
| G1 | 发现成功后仍返回/执行裸 `"uv"` |
| G2 | 静默永久改 PATH/注册表 |
| G3 | win32 主安装文案仍是 brew-only |
| G4 | computer import `mcp/transport` |
| G5 | 无 package-id 过滤地递归整个 WinGet Packages |
| G6 | 默认捆绑 uv 而无独立 packaging ADR |
| G7 | 改变 isolated/system 语义或对 system Python 自动 pip |
| G8 | 仅用 PATH prepend 代替发现后的绝对执行 |
| G9 | 无 uv 阻塞 canDownload/canEnable |
| G10 | 合并 user-env PATH/PYTHONPATH 进 python-runtime |

---

## 8. Key Decisions

1. **Scheme D 锁定**：探测 + 绝对钉死 + 文案 + uvPath，最小有效半径。  
2. **安全优先绝对路径**：相对名在成功发现后非法。  
3. **层边界**：computer 不依赖 mcp；共享提取可后置。  
4. **uv 可选**：加速器，非硬门。  
5. **P0 不做 config 覆盖 / 捆绑 / MCP 改写**。  

---

## 9. Open Questions（不挡 Pi / P0）

1. 本机 Explorer 拉起 daemon 的 PATH 是否含 User PATH（探测仍强制，仅影响 C1 频率）。  
2. WinGet Links 与 `Packages/astral-sh.uv_*` 同时探测（推荐两者，package-id 限定）。  
3. `computer.uvPath` 是否同 PR（推荐 P1）。  

---

## 10. PR Plan

| PR | Title | 依赖 | 内容 |
|----|-------|------|------|
| **PR-1** | fix(computer): Windows-aware uv discovery + absolute pin | — | `python-runtime` + tests + preflight copy + handlers/extension `uvPath` + Settings 文案 |
| PR-2 (P1) | feat(computer): optional uvPath config override + re-detect | PR-1 | config + UI picker + validate |

---

*内部对抗：Platform · Security · Product · Compat · workflow `windows-uv-python-chain-adversarial` · 2026-08-02*  
*下一步：Pi 复审 SoT+plan → APPROVE* 后走开发 workflow 实现 P0*
