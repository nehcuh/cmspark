# Windows Python Discovery Cascade — 产品与技术设计 SoT

> **日期**: 2026-08-09  
> **状态**: **P0 LANDED in tree** — Pi APPROVE_WITH_NITS; impl workflow complete; computer-python-runtime 45/45 — Scheme **D Full hybrid cascade**；对抗合成已锁定；**未实现**  
> **触发**: S35 `findUv` 已落地后，**base Python** 仍仅 bare spawn / PATH 裸名；Windows GUI Companion 对 python.org / WinGet / Scoop / pyenv-win / conda 根解释器假阴性；Store stub 未拒绝；缺 Python 文案无 winget  
> **对抗合成**: 会话锁定 synthesis（C1–C10 · PY1–PY16 · G1–G12）— 本文为权威 SoT  
> **实现计划**: [../plans/2026-08-09-windows-python-discovery-impl.md](../plans/2026-08-09-windows-python-discovery-impl.md)  
> **前序 SoT（正交、必须保持绿）**: [2026-08-02-windows-uv-python-chain-design.md](./2026-08-02-windows-uv-python-chain-design.md)（findUv W1–W12 / Scheme D）  
> **关联**: ADR-019（user-env 不并入）· ADR-020（Surface tooling）· Qwen3-VL 实验层 · `python-runtime.ts` · `qwen-vl-preflight.ts` · `qwen-vl-download.ts`

---

## 0. 一句话

**在不永久改 PATH、不静默安装、不把 conda 当一等运行时的前提下，用「配置钉死 → isolated 运行解释器 → well-known 绝对 base → 管理器只读 seed → 进程内增强 PATH/`py` launcher → Store/版本门 → 绝对路径钉死执行」消除 Windows Companion 对已装 Python 的假阴性，并把 create-env / install-Python 文案做成与 `uvInstallHint` 对称的渐进 CTA。**

---

## 1. 问题（用户与代码）

### 1.1 用户感知

- 本机已装 Python（python.org / WinGet / Scoop / Anaconda / pyenv-win），侧栏仍写「未找到 Python 3」或无法一键创建独立环境。  
- 终端 `py -3` / `where python` 正常，Companion（GUI 启动、PATH 残缺）探测失败。  
- 提示偏向 `python.org` 勾选 PATH；**无** win32 `winget install` 主路径（与已修复的 `uvInstallHint` 不对称）。  
- 有可用 base 却 isolated 未建时，与「完全没有 Python」混成同一 CTA。  
- WindowsApps Store 别名 `python.exe` 可能被当成可用解释器，随后 venv/pip 失败难诊断。

### 1.2 代码真相（`[inspected]`，不得用文案掩盖）

| ID | 机制 | 实际行为 | 位置 |
|----|------|----------|------|
| **C1** | `probePythonBin` | 仅 bare `spawn(bin, ["-c", sys.executable])`；**无** well-known Python 绝对列表 | `python-runtime.ts` ~429–432 vs `listWellKnownUvCandidates` ~189–240 |
| **C2** | `resolvePythonRuntime` system / isolated-missing | `config.pythonPath` + bare `python3`/`python`/`py`；**无** managers / well-known | ~454–519 |
| **C3** | `ensureIsolatedPythonEnv` 无 uv | base 同样 bare probe；**无法**使用 off-PATH 绝对 base | ~586–621 |
| **C4** | `processLocalLookupPath` | **只**喂给 `findUv` 的 `where`/`which`；Python 探测不走 enriched PATH | ~385–390 vs ~429–432 |
| **C5** | `validatePythonExecutable` | absolute + exists + probe；**无** WindowsApps denylist；**无**版本门 | ~749–776 |
| **C6** | 缺 Python UX | `python-missing` 仅 brew / python.org；**无** winget（对照 `uvInstallHint` win32） | `model-state-messages.ts` ~129–135；`model-switch-logic.ts` ~132–138 |
| **C7** | 下载候选 | system 模式仍 bare `python`/`py` | `qwen-vl-download.ts` ~228–236 |
| **C8** | 测试 | 锁住 `findUv` / sanitize；**无** Python discovery fixture | `computer-python-runtime.test.ts` |
| — | 死代码 | `qwen-vl-preflight.ts` 内 `findPython`（~133–147）与 resolve 主路径重复 | 应删除 / 统一到 cascade |

### 1.3 与 S35 uv 链的不对称

S35 已交付：well-known 绝对 → enriched PATH `where` → realpath 钉死 → 平台 `uvInstallHint`。  
**Base Python 仍停留在 S35 前的 bare spawn 形态**——本工作是 **EXTEND discovery 到 Python**，不是重开 uv 方案辩论。

---

## 2. 目标与非目标

### 2.1 目标

| ID | Goal |
|----|------|
| **PG1** | 进程 PATH 残缺时仍能发现常见 Windows/Unix 布局的 **base Python**（python.org / WinGet / Scoop / Anaconda·Miniconda 根 / pyenv-win / conda 族只读根） |
| **PG2** | 发现成功后 **所有执行 argv0 为绝对路径**（resolve / ensure / download / validate / pick） |
| **PG3** | Store stub 失败关闭；Python 版本 ≥ P0 最小值（默认 **3.10**） |
| **PG4** | 平台化 `pythonInstallHint`（win32 = winget + python.org；**永不** win32 brew-only） |
| **PG5** | 渐进 CTA：有 base 无 isolated →「创建独立环境」；完全缺失 →「安装 Python」；每 readiness **一个主 CTA** |
| **PG6** | 保持 `pythonMode` **isolated \| system**；isolated 下载/推理 **禁止**静默回落 system PATH |
| **PG7** | **不回归** findUv S35（W1–W12 测试全绿）；uv 仍为 ensure 的可选加速器 |
| **PG8** | 可注入 deps 的离线 fixture 测试（非 Windows CI 可跑） |

### 2.2 非目标

- ❌ 捆绑 CPython 进 cmspark 包（Scheme E / G11）  
- ❌ 静默 winget/choco/installer 或写 Machine/User PATH / 注册表（F / G3 / PY9–10）  
- ❌ 把 conda/mamba 环境当 Qwen 一等 runtime（Scheme G / PY8 / G4）  
- ❌ 运行 `activate` / `conda.bat` / shell hook  
- ❌ computer → `mcp/transport` import（W6 / PY11 / G7）  
- ❌ 合并 ADR-019 user-env `PATH`/`PYTHONPATH`/`PYTHONHOME` 进 discovery/spawn（PY16 / G12）  
- ❌ 每次 preflight 自动 `ensureIsolated`（G10）  
- ❌ 对 system Python 静默 pip（G9）；system deps 仍 `needsManual`  
- ❌ 重开 brew-on-Windows / 改 findUv 序为 PATH-first  
- ❌ torch CUDA 细节、模型下载源、MCP UI（正交）

---

## 3. 方案对抗结论

| Scheme | Verdict |
|--------|---------|
| A 仅文案/docs | **REJECT alone**（作为 D 的 install-UX 层） |
| B 仅 well-known 绝对 | **REJECT alone** |
| C 仅 env-manager | **REJECT alone**（漏默认安装器；深集成有 activate 风险） |
| **D Full hybrid cascade** | **LOCK（全车道）** |
| E 捆绑 CPython | **REJECT** |
| F 静默 winget/choco | **REJECT（硬否决）** |
| G conda 一等 runtime | **REJECT P0**；在 D 下 **base-seed 只读** 允许 |

**Manager 角色**: DETECT + 为 `ensureIsolatedPythonEnv` **seed 绝对 base** → 写入 `DATA_DIR/python-env`；**不是**在用户 conda env 内跑 Qwen。

---

## 4. 锁定级联（Locked Cascade）

执行序（**PY4**）。后级不得在前级已给出合法绝对 pin 时改写；任一级通过门禁后 **立即绝对钉死** 并停止搜索（除非该级仅作 seed 候选列表的一部分，见下）。

| # | 步骤 | 用途 | 备注 |
|---|------|------|------|
| **1** | Config `computer.pythonPath` 绝对 + `validatePythonExecutable` | system pin / `pick_python_path` 逃生舱 | 用户显式优先 |
| **2** | Isolated `DATA_DIR/python-env` 的 `Scripts/python.exe` \| `bin/python3` 若存在且 probe | **仅** `mode=isolated` 的 **run** 路径 | 禁止「isolated 缺失时把 system 写进 `pythonPath` 冒充已就绪」 |
| **3** | Well-known 绝对 bases | seed + system resolve | python.org Local/PF；WinGet `Python.Python.3.*`；Scoop；Anaconda/Miniconda roots；**排除 WindowsApps**；单层 readdir + package-id/prefix |
| **4** | Manager base roots **readonly** | seed only | pyenv-win `versions/*`；conda/mamba/micromamba **root** `python.exe`；P0 可选单层 `envs/*`（open Q）；**禁止 activate** |
| **5** | Process-local enriched PATH `where`/`which` + Windows `py -0p` / `py -3` | 覆盖 PATH-only 合法安装 | 输出 **pin `sys.executable` 绝对路径**；拒绝相对规范名 |
| **6** | Gates | 所有候选 | Store stub 拒绝 + Python ≥ min + basename allowlist |
| **7** | Absolute pin | 全部执行面 | realpath；已知绝对后 **永不** bare `python`/`py`/`python3` 作规范 argv0 |
| **8** | `findUv` S35 | ensure 加速器 **正交** | 不是 base 解释器；保持 W1–W12 |
| **9** | User-triggered `ensureIsolated` | 创建/修复 venv | 优先绝对 `uvBin`；否则绝对 `basePy -m venv` → **仅** `DATA_DIR`；Scripts vs bin lock-step |
| **10** | Fully missing → install UX | 失败关闭 | winget + python.org + 可选 uv + pick path；**永不**静默安装；用户装完后 **重启 Companion** |

---

## 5. 产品锁（P\*）与法律锁（PY1–PY16）

### 5.1 产品锁 P\*

| ID | Lock |
|----|------|
| **P-mode** | `pythonMode ∈ {isolated, system}` 保留；默认推荐 isolated |
| **P-isolated-run** | isolated **run/download/infer** 只用 isolated bin（或明确失败）；**禁止**静默 PATH system fallback（B3 / PY2 / G8） |
| **P-ensure-user** | 创建独立环境仅用户动作（`ensure_python_env` / Settings CTA）；preflight 只报告 |
| **P-system-manual** | system 模式依赖安装 = 展示 `needsManual` 命令；不代跑 system pip 除非既有显式 system 流程 |
| **P-cta** | **PY14** 渐进：usable base + isolated missing → 主 CTA「创建独立环境」；fully missing → 主 CTA「安装 Python」；不可两个主 CTA 并列抢焦点 |
| **P-escape** | `pick_python_path` / 绝对 `computer.pythonPath` 始终为逃生舱（PY12） |
| **P-uv-optional** | 无 uv 不阻塞 canDownload/canEnable 的既有语义；ensure 可走 `-m venv` |

### 5.2 法律锁 PY1–PY16（实现验收表）

| ID | Lock | Rationale |
|----|------|-----------|
| **PY1** | 发现后只存/spawn **绝对** `pythonPath`；已知绝对后禁止 bare `python`/`py`/`python3` | W2 类 PATH 劫持闭合 |
| **PY2** | 保留 isolated\|system；isolated 不静默回落 system | B3 · ADR-020 |
| **PY3** | findUv S35 完整保留；uv 可选加速；不重开 brew-on-Windows | 本工作 EXTEND Python |
| **PY4** | 序：config → isolated-run → well-known → managers → PATH/py | 安全绝对优先 + 产品覆盖 |
| **PY5** | Well-known：固定 allowlist + 单层 readdir + package-id/prefix；无整盘扫 | 对照 WinGet `astral-sh.uv_*` |
| **PY6** | 拒绝 WindowsApps Store `python*.exe` stub（除非 `-c` 返回的真实可执行路径 **不在** Apps） | 假别名 fail-closed |
| **PY7** | 仅接受 Python **3.x ≥ min**（P0 默认 **3.10**）；拒 2.x / 过旧 3.x，清晰文案 | P4 缺口 |
| **PY8** | Managers 只读 detect+seed；非 G 产品模式 | 共识 |
| **PY9** | PATH 增强仅 process-local spawn env；永不写 User/Machine PATH/注册表 | 硬约束 |
| **PY10** | 永不静默装 Python/uv；永不静默 pip 进 system Python | F 否决 |
| **PY11** | 无 computer→mcp；discovery 在 `python-runtime` + injectable deps（镜像 `UvDiscoveryDeps`） | W6 · 离线 CI |
| **PY12** | `validatePythonExecutable` = absolute + exists + probe + Store denylist + version；pick 逃生 | 安全+产品 |
| **PY13** | `pythonInstallHint` 平台化：win32 winget **+** python.org PATH 提示；win32 永不 brew-only | 对称修 C6 / W7 |
| **PY14** | 渐进 CTA 见 P-cta | 产品 readiness |
| **PY15** | ensure 前 `uvBin` 与 `basePy` 皆绝对；isolated 根 Windows `Scripts` vs Unix `bin` lock-step | T2/W2 延伸 |
| **PY16** | 不把 ADR-019 user-env PATH/PYTHON* 并入 discovery/spawn | W10/G10 闭合 |

---

## 6. 设计形态（API sketch）

### 6.1 类型与 deps

复用并扩展 `UvDiscoveryDeps`（可 rename 文档别名 `PythonDiscoveryDeps`，实现上允许同一接口以免双份 mock）：

```ts
// companion/src/computer/python-runtime.ts

/** P0 default; open Q may raise for torch. */
export const MIN_PYTHON_VERSION = { major: 3, minor: 10 } as const

export type PythonDiscoverySource =
  | "config"
  | "isolated"
  | "well-known"
  | "manager"
  | "path"
  | "py-launcher"
  | "none"

export interface PythonBaseHit {
  /** Always absolute after success (PY1). */
  path: string
  version?: { major: number; minor: number; patch?: number }
  source: Exclude<PythonDiscoverySource, "none">
  /** Optional manager label for resolution string, e.g. pyenv-win / conda */
  manager?: string
}

export interface FindPythonBaseOpts {
  /** Include DATA_DIR isolated bin as a candidate (isolated run path). */
  includeIsolated?: boolean
  /** Prefer this absolute config pin first (computer.pythonPath). */
  configPath?: string
  /** Minimum version gate (default MIN_PYTHON_VERSION). */
  minVersion?: { major: number; minor: number }
  deps?: UvDiscoveryDeps
}
```

### 6.2 核心函数

```text
listWellKnownPythonCandidates(deps?): string[]
  // win32 (bounded, order stable):
  //   %LocalAppData%\Programs\Python\Python3*\python.exe  (single-level readdir)
  //   %ProgramFiles%\Python3*\python.exe
  //   %LocalAppData%\Microsoft\WinGet\Packages\Python.Python.3.*\**\python.exe
  //     — package-id prefix /^Python\.Python\.3\./ only; single-level (or one known layout) readdir
  //   %USERPROFILE%\scoop\apps\python\current\python.exe
  //   %USERPROFILE%\anaconda3\python.exe, %USERPROFILE%\miniconda3\python.exe
  //   %LocalAppData%\Continuum\anaconda3\python.exe (legacy layout, allowlist only)
  //   NEVER: %LocalAppData%\Microsoft\WindowsApps\python*.exe
  // unix:
  //   /usr/bin/python3, /usr/local/bin/python3, /opt/homebrew/bin/python3
  //   ~/.local/bin/python3 (if present)
  // mirror uv: exists-first list; no spawn here

listManagerPythonCandidates(deps?): string[]
  // readonly absolute seeds only (PY8):
  //   pyenv-win: %PYENV_ROOT%|%USERPROFILE%\.pyenv\pyenv-win\versions\*\python.exe (one level)
  //   conda/mamba/micromamba: root python.exe under common install roots (allowlist)
  //   P0 optional: <conda-root>\envs\*\python.exe single level — see open Q
  // NEVER: activate scripts, conda run, shell hooks

isWindowsStorePythonStub(absPath, deps?): boolean
  // path under WindowsApps OR realpath/sys.executable still under WindowsApps after probe

parsePythonVersion(stdout from -c): {major,minor,patch?} | null

async probePythonBin(bin, deps?): Promise<string | null>
  // KEEP contract: run -c "import sys; print(sys.executable)"
  // NEW: prefer absolute bin; if bin bare, only allowed inside find cascade step 5
  // NEW: after success, reject relative result; reject Store stub (PY6)
  // NEW: version parse + min gate (PY7) — fail → null

async validatePythonExecutable(raw, deps?): Promise<{ok:true,path}|{ok:false,error}>
  // absolute + exists + file/symlink + probe + Store denylist + version gate (PY12)
  // return realpath pin

async findPythonBase(opts?): Promise<{ ok: true } & PythonBaseHit | { ok: false }>
  // Cascade PY4 / §4 steps 1→5 with gates 6, pin 7
  // NEVER ok:true with !path.isAbsolute
  // NEVER ok:true path basename-only

async resolvePythonRuntime(opts): Promise<PythonRuntimeInfo>
  // system:
  //   findPythonBase({ configPath, includeIsolated:false }) → pythonPath absolute | missing resolution
  // isolated + isolatedExists:
  //   probe/validate isolated bin only → pythonPath; resolution 独立环境…
  // isolated + !isolatedExists:
  //   OMIT pythonPath (keep B3); use findPythonBase seed internally ONLY for resolution/CTA text
  //   resolution progressive (PY14): has seed → 可创建独立环境；else install hint
  // always attach uv via findUv S35 (absolute uvPath only)

async ensureIsolatedPythonEnv(packages, deps?): EnsureEnvResult
  // uvBin absolute from findUv else null (existing T2)
  // if !uvBin: basePy = findPythonBase({ includeIsolated:false }) absolute only (fix C3)
  // spawn only absolute argv0 (PY15)
  // never silent install

pythonInstallHint(platform = process.platform): string
  // win32: "winget install -e --id Python.Python.3.12"  (or wording from open Q)
  //        + "或从 https://www.python.org/downloads/ 安装并勾选 Add python.exe to PATH"
  //        + "安装后重启 Companion"
  // darwin: brew install python3（可保留）
  // linux: 发行版包管理器提示
  // win32 字符串单测：必须含 winget；禁止 brew-only（PY13）
```

### 6.3 `findPythonBase` 算法（规范）

```text
1. if opts.configPath:
     v = validatePythonExecutable(configPath) → if ok return { source:"config", path:v.path }
2. if opts.includeIsolated:
     iso = isolatedPythonBin() absolute
     if exists && probe+gates → return { source:"isolated", path:realpath }
3. for cand in listWellKnownPythonCandidates():
     if absolute && probe+gates → return { source:"well-known", path:pin }
4. for cand in listManagerPythonCandidates():
     if absolute && probe+gates → return { source:"manager", path:pin, manager }
5. lookupPath = processLocalLookupPath(deps)   // reuse S35 helper; PY9
   win32: where python / where python3 under lookupEnv
   unix: which python3 / python
   for each absolute hit with basename allowlist {python, python3, python.exe, python3.exe}:
     pin via probe+gates → return { source:"path", path:pin }
   win32 only: py -0p (parse paths) and/or py -3 -c sys.executable
     → pin absolute → return { source:"py-launcher", path:pin }
6. return { ok: false }
// G1: never { ok:true, path: "python" | "py" | "python3" }
```

### 6.4 调用面改动（行为）

| 调用方 | 变更 |
|--------|------|
| `resolvePythonRuntime` | 走 `findPythonBase`；isolated-missing 不设 `pythonPath` |
| `ensureIsolatedPythonEnv` | 无 uv 时用 `findPythonBase` 绝对 base |
| `qwen-vl-download.ts` | system 候选：config 绝对 + `findPythonBase` 结果；**删除** bare `python`/`py` 作为最终 argv0；isolated 仅 iso bin |
| `qwen-vl-preflight.ts` | 删除死 `findPython`；readiness/resolution 用 cascade + `pythonInstallHint` |
| `model-handlers.ts` | ensure/state 透传 resolution / install hint / 绝对 pythonPath |
| `model-state-messages.ts` | `python-missing` 用平台化文案（或 server 下发字符串） |
| `model-switch-logic.ts` / `SettingsSlideout.tsx` | 渐进 CTA；显示截断绝对路径；win32 非 brew-only |

### 6.5 Basename allowlist

接受探测的可执行名（大小写不敏感）：`python`、`python3`、`python.exe`、`python3.exe`。  
**拒绝**作为规范解释器：`py.exe` **launcher 本身**（launcher 只用于发现；钉死的是 `sys.executable`）。  
**拒绝**路径：含 `\WindowsApps\` 的 Store stub（PY6）。

### 6.6 版本探测

```text
python -c "import sys; print('%d.%d.%d' % sys.version_info[:3]); print(sys.executable)"
```

或保持现有 `sys.executable` 一行 + 额外 version 探针；实现任选，但 **validate / find 必须有版本门**。  
失败消息示例：`需要 Python ≥ 3.10，当前为 3.8.x` / `不支持 Python 2`。

---

## 7. UX 文案规则

### 7.1 原则

1. **Server-driven 优先**：Companion preflight/state 下发 `resolution`、`pythonInstallHint`、`pythonPath`；扩展少写死平台分支。  
2. **一主 CTA**（PY14）：根据 readiness 只强调一个动作。  
3. **绝对路径可见**：已检测时截断显示 pin 路径（对标 uvPath UI）。  
4. **安装后重启**：用户手动装完 Python/uv 后提示重启 Companion（PATH/句柄刷新）。  
5. **不恐吓**：Store stub / 版本过旧用可执行修复句，不堆安全黑话。

### 7.2 Readiness → 文案 / CTA

| State | `resolution` 方向 | 主 CTA | 次要 |
|-------|-------------------|--------|------|
| isolated exists + healthy | 使用 CMspark 独立环境… | （无 / 管理依赖） | 显示 pythonPath |
| isolated missing + base found | 独立环境尚未创建；本机已检测到 Python（可附 source/manager） | **创建独立环境** | 可选安装 uv 加速 |
| isolated missing + base missing | 未找到可用 Python 3 | **安装 Python**（hint） | pick_python_path；可选 uv |
| system mode + base found | 使用本机全局 Python | — | 显示 pythonPath |
| system mode + missing | 已选全局 Python，但未找到可用解释器 | 安装 / 选择路径 | winget + python.org |
| version too old | 已找到 Python 但版本过低 | 升级/重装 ≥ min | 显示 detected version |
| Store stub only | 检测到 Microsoft Store 占位 python，不可用 | 安装真 Python / 关闭应用执行别名 | 链到设置说明（短） |

### 7.3 `pythonInstallHint` 形状

```text
win32:
  winget install -e --id Python.Python.3.12
  或从 https://www.python.org/downloads/ 安装，勾选 “Add python.exe to PATH”
  完成后重启 CMspark Companion
  （可选）加速独立环境：winget install -e --id astral-sh.uv

darwin:
  brew install python3
  （可选）brew install uv

linux:
  使用发行版包管理器安装 python3 / python3-venv
```

**单测锁**：`pythonInstallHint('win32')` 含 `winget` 与 python.org 或等价；**不含**作为唯一建议的 `brew`。

### 7.4 `python-missing` 消息键

`model-state-messages.ts` / 扩展侧对称更新：去掉「Windows 只有 python.org」的不对称；优先嵌入 server `pythonInstallHint`；若客户端兜底，win32 必须 winget+python.org。

---

## 8. 安全锁（汇总）

| 主题 | 规则 |
|------|------|
| 绝对 pin | PY1 / G1 |
| Store stub | PY6 / G2 |
| 无静默安装 / 无 PATH 写 | PY9–10 / G3 |
| 无 activate / 无 G runtime | PY8 / G4 |
| 有界 FS | PY5 / G5 |
| 不回归 findUv / brew-only | PY3 / G6 |
| 无 mcp import | PY11 / G7 |
| 无 isolated→system 静默 | PY2 / G8 |
| 无自动 system pip | PY10 / G9 |
| 无 preflight 自动 ensure | G10 |
| 无 bundle | G11 |
| 无 user-env PATH 合并 | PY16 / G12 |

**Security veto 清单（开工即 REJECT）**：已知绝对后仍 bare；Store stub 当可用；静默安装；activate 脚本；无过滤整盘/整 WinGet 树扫描。

---

## 9. 分期计划

### P0（ship）

- `listWellKnownPythonCandidates` + `listManagerPythonCandidates`  
- `findPythonBase` cascade + Store + version gates  
- `probe`/`validate`/`resolve`/`ensure`/`download` 绝对 pin  
- `pythonInstallHint` + progressive resolution/readiness copy  
- 删除 dead `findPython`  
- injectable 单测；**findUv 套件保持绿**  
- 无 PATH/registry 写；system `install_deps` 仍 needsManual  

**P0 验收摘要**：stripped PATH + well-known fixture → 绝对 pin；WindowsApps fail-closed；ensure 无 uv 用绝对 base；missing UX 含 winget+python.org 非 brew-only；findUv green。

### P1（optional）

- Settings「重新检测」  
- 管理器/系统路径一键采用（仍绝对 pin）  
- `envs/*` 深度策略定稿  
- `uv python install` **显式确认**（无 host Python 时）  
- min-version 上调（若 torch 要求 3.11+）  
- 可选 CN 镜像提示  

**P1 门**：P0 锁保持；新 UI 仅 opt-in；无静默安装；无 G 一等 conda 除非新开 ADR。

---

## 10. 验收（Acceptance）

### 10.1 功能

| # | 场景 | 期望 |
|---|------|------|
| A1 | PATH 清空 + fixture 绝对 python.org 布局 | `findPythonBase` ok + absolute + source well-known |
| A2 | 仅 WinGet `Python.Python.3.*` 包目录 | 发现 + pin |
| A3 | 仅 WindowsApps stub | ok:false / validate 失败 |
| A4 | config 绝对合法 pin | 优先 source=config |
| A5 | isolated 已存在 | resolve isolated 用 iso bin；不扫 system 替代 run |
| A6 | isolated 缺失 + base 存在 | 无 pythonPath；resolution 指向创建环境 |
| A7 | ensure 无 uv + off-PATH base | `python -m venv` argv0 绝对 |
| A8 | ensure 有 uv | 仍绝对 uvBin；回归 S35 |
| A9 | download isolated 无 iso | python-missing 类错误，不 PATH fallback |
| A10 | download system | 仅绝对候选 |
| A11 | 版本 3.8 | 拒绝 + 清晰错误 |
| A12 | `pythonInstallHint(win32)` | winget + 非 brew-only |

### 10.2 安全 / 层

- 无 `companion/src/computer/**` import `mcp/transport`  
- 无测试或代码写 User/Machine PATH  
- `ok:true` ⇒ `path.isAbsolute`  

### 10.3 回归

- 既有 `findUv` / `uvInstallHint` / `sanitizePythonPackages` 测试全绿  
- darwin/linux well-known 不回退  

---

## 11. 与 S35 uv 链的关系

| 维度 | S35 uv | 本文 Python |
|------|--------|-------------|
| Scheme | D hybrid | D hybrid（对称扩展） |
| Well-known | `astral-sh.uv_*` | `Python.Python.3.*` + python.org/Scoop/conda 根 |
| PATH 增强 | `processLocalLookupPath` | **复用同一 helper**（C4 修复：Python 也走） |
| 绝对 pin | W2 | PY1 / PY15 |
| 安装文案 | `uvInstallHint` | `pythonInstallHint`（修 C6 不对称） |
| 产品角色 | ensure **加速器** | **base 解释器** + isolated venv |
| 正交性 | 保持绿 | 不得削弱 findUv 序或改 PATH-first |

**明确**：keep S35 findUv；extend probe/base selection；managers = capability detect + isolated seed only。

---

## 12. ADR 笔记

| ADR | 关系 |
|-----|------|
| **ADR-019** user-env | **不**把用户 Secrets 中的 PATH/PYTHONPATH/PYTHONHOME 并入 `python-runtime` discovery 或 spawn（PY16）。pick_python_path / `computer.pythonPath` 是显式逃生，不是 env 泄漏。 |
| **ADR-020** 能力三轴 | 本工作 = 现有 Qwen3-VL **Surface** runtime 工具加固，**非**新 Autonomy 轴、无新 L2 class、无 pack key。 |
| **ADR-014** Mission Pack | 无交叉；不改 pack 工具白名单。 |
| 新 ADR？ | **P0 不需要**。若未来 Scheme G（conda 一等）或 E（bundle CPython）或 `uv python install` 默认化，再开 ADR。 |

能力声明（文档用）：

```text
Surface:      existing Qwen3-VL / computer python-runtime (discovery hardening)
L2-classes:   none new
Compose:      none
Autonomy:     n/a
Trust:        no new arm / pack keys
Channel:      community experimental layer
```

---

## 13. Pi 拒绝门（任一 → REJECT 开工/合入）

| # | Gate |
|---|------|
| **G1** | 发现成功仍返回或执行 bare `python`/`py`/`python3` |
| **G2** | 接受 WindowsApps Store stub 为可用 base |
| **G3** | 静默 winget/choco/installer 或永久 PATH/注册表变更 |
| **G4** | 运行 conda/pyenv activate 或把用户 conda env 当默认 Qwen runtime（G） |
| **G5** | 无 package-id 过滤的无界磁盘 / 整 WinGet Packages 递归 |
| **G6** | 回归 findUv 绝对 pin 或 win32 brew-only uv/**python** 提示 |
| **G7** | computer import mcp/transport |
| **G8** | isolated 下载回落 PATH system python |
| **G9** | 无显式 system 模式+用户意图时自动 pip system |
| **G10** | 每次 preflight 自动创建 isolated venv |
| **G11** | 无 packaging ADR 捆绑 CPython |
| **G12** | 合并 user-env PATH/PYTHONPATH 进 python-runtime discovery |

---

## 14. Open Questions（不挡 P0 设计锁；实现默认已写）

1. Min Python：**P0 默认 3.10** vs 为 torch 升 **3.11+**？  
2. 有 uv 无 host Python：P1 是否允许 **确认后** `uv python install`？P0 保持「需要 host Python」文案。  
3. Settings 是否展示检测到的 manager，或 P0 仅 resolution 字符串静默 seed？  
4. WinGet allowlist：仅 `Python.Python.3.*`，是否加 Anaconda.Anaconda3 / Miniconda3 包 id？  
5. conda `envs/*`：P0 单层枚举 vs 仅 root？  
6. winget 文案：钉死 `Python.Python.3.12` vs 滚动「当前 3.x」措辞？

**实现默认（可在 PR 中按 open Q 微调，不改 cascade 序）**：min 3.10；P0 不做 `uv python install`；P0 不强制 manager UI；WinGet 以 `Python.Python.3.*` 为主；conda root + **可选**单层 envs；winget id **3.12** 钉死文案（可注「或更新的 3.x」）。

---

## 15. Key Decisions

1. **Scheme D 锁定** — 全车道；A/B/C  alone、E、F、G 否决。  
2. **绝对路径优先于 PATH** — 与 S35 W11 一致。  
3. **Managers = seed，不是 runtime** — 防 activate 与模式爆炸。  
4. **isolated\|system 语义不谈判** — B3 保留。  
5. **findUv 正交且不可回归**。  
6. **UX 对称** — python 安装提示对齐 uv 的平台化标准。  
7. **P0 可测可注** — injectable deps；CI 不依赖真实 WinGet/Python。

---

## 16. File map（P0）

| Path | Role |
|------|------|
| `companion/src/computer/python-runtime.ts` | cascade 核心 |
| `companion/src/computer/qwen-vl-preflight.ts` | 删死代码 + readiness |
| `companion/src/computer/qwen-vl-download.ts` | 绝对候选 |
| `companion/src/computer/model-state-messages.ts` | python-missing 文案 |
| `companion/src/computer/model-handlers.ts` | ensure/state 透传 |
| `chrome-extension/src/sidepanel/components/model-switch-logic.ts` | CTA / copy |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | 显示 pin + hint |
| `companion/tests/computer-python-runtime.test.ts` | discovery fixtures |
| `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md` | 本文 SoT |
| `docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md` | 实现计划 |

可选文档交叉链：在 S35 SoT 末尾加「后继：Python discovery cascade 2026-08-09」。

---

## 17. PR Plan

| PR | Title | 内容 |
|----|-------|------|
| **PR-1** | fix(computer): Windows Python discovery cascade + absolute pin | runtime cascade + tests + preflight/download/handlers + extension copy |
| PR-2 (P1) | feat(computer): re-detect + manager UX + optional uv python install | 另开 |

---

*对抗共识锁定 · Scheme D · PY1–PY16 · G1–G12 · pi_ready: true · 2026-08-09*
