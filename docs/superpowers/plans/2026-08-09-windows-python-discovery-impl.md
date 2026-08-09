# Implementation Plan — Windows Python Discovery Cascade (P0)

| 字段 | 值 |
|------|-----|
| **Date** | 2026-08-09 |
| **Status** | **P0 LANDED** — impl workflow complete; 45/45 tests; nits folded |
| **Design SoT** | `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md` |
| **Synthesis** | 会话锁定 adversarial synthesis（C1–C10 · PY1–PY16 · G1–G12） |
| **Predecessor** | S35 uv chain — `docs/superpowers/plans/2026-08-02-windows-uv-python-chain-impl.md`（**保持绿**） |
| **Branch suggestion** | `fix/windows-python-discovery-cascade`（worktree preferred） |

---

## 0. Overview

Extend S35 `findUv` hybrid discovery to **base Python** for Qwen3-VL / computer `python-runtime`:

1. Build **bounded well-known + manager-seed** candidate lists (mirror `listWellKnownUvCandidates`).  
2. Implement **`findPythonBase` cascade** (config → isolated-run → well-known → managers → enriched PATH / `py` launcher).  
3. Gate: **WindowsApps fail-closed** + **min version ≥ 3.10** + basename allowlist.  
4. **Absolute pin** every execution path (`resolve` / `ensure` / `download` / `validate`).  
5. Platformize **`pythonInstallHint`** + progressive CTA copy.  
6. Tests with **injectable deps** (no real WinGet required on CI).  
7. **Do not** regress findUv; **do not** silent-install; **do not** import mcp.

**Scheme**: D only. **Managers**: detect+seed only.

---

## 1. Stop gates（Pi）

1. ~~Pi 对 **SoT + 本 plan** 给出 `VERDICT: APPROVE*` 后方可写代码~~ — **已通过** `APPROVE_WITH_NITS`（`docs/audit/reviews/windows-python-discovery-pi-protocol-20260809.md`）。  
2. 任一 SoT **G1–G12** → REJECT 开工/合入。  
3. 长任务用 worktree；勿直接在 `main` 堆大 diff。  
4. 实现后：self-check 对照 PY1–PY16；跑 `computer-python-runtime` 测试。  
5. **折叠 nits（实现时强制）** — 见 §1.1。

### 1.1 Pi nits（必须折叠进 P0）

| ID | Nit | Plan action |
|----|-----|-------------|
| **N1** | Progressive CTA：isolated missing 省略 `pythonPath` 时 preflight 可能误报「安装 Python」 | T6/T10 增加 server 信号 `basePythonAvailable`（或等价 resolution source）；readiness 区分 create-env vs install |
| **N2** | 测试缺 config 优先 / manager seed / py-launcher / download bare argv0 | T12 追加 PY-T18–T21 |
| **N3** | ensure 在 `deps.runCapture` 注入时 short-circuit 过粗，挡死 PY-T13 | T7 重写 short-circuit（允许绝对 base mock） |
| **N4** | Anaconda 根路径 well-known 与 manager 双列 | T2 固定 installer 根；T3 仅 pyenv + CONDA_PREFIX + 可选 envs/* |
| **N5** | 非 allowlist 自定义路径 | 依赖 pick/config（已锁）；不扩 P0 扫描 |
| **N6** | Store denylist 双检 | T4 候选 path + probe 结果均判 WindowsApps |
| **N7** | buildInstallCommands bare 仅 UX | 非 G1；可选嵌 pythonInstallHint |
| **N8** | 删除 dead findPython | T10 已列 |
| **N10** | 勿改 findUv 序 | PY-T17 每步回归 |

---

## 2. P0 Tasks（ordered）

### T0 — 文档交叉链（可选，5 min）

- [ ] 在 `docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md` 末尾加「后继 Python discovery 2026-08-09」链接。  
- [ ] 不改 S35 行为叙述。

### T1 — Constants + helpers in `python-runtime.ts`

**File**: `companion/src/computer/python-runtime.ts`

- [ ] Export `MIN_PYTHON_VERSION = { major: 3, minor: 10 }`.  
- [ ] Types: `PythonDiscoverySource`, `PythonBaseHit`, `FindPythonBaseOpts`（见 SoT §6.1）。  
- [ ] `parsePythonVersion(text: string): { major; minor; patch? } | null`.  
- [ ] `isWindowsStorePythonStub(absPath: string, deps?: UvDiscoveryDeps): boolean`  
  - Normalize；若 path 含 `Microsoft\\WindowsApps`（case-insensitive）→ true。  
  - 可选：realpath 后再判一次。  
- [ ] `isPythonExecutableName(basename: string): boolean`  
  - allow: `python`, `python3`, `python.exe`, `python3.exe`（lower）。  
  - **not** `py` / `py.exe` as final pin name（launcher 只作发现）。  
- [ ] `versionMeetsMin(v, min = MIN_PYTHON_VERSION): boolean`.  
- [ ] Extend probe output：内部可用  
  `import sys; print(sys.executable); print("%d.%d.%d" % sys.version_info[:3])`  
  或两次 `-c`；保持超时量级与现 `probePythonBin` 一致（~8s）。

### T2 — `listWellKnownPythonCandidates(deps?)`

**File**: `python-runtime.ts`（紧邻 `listWellKnownUvCandidates`）

- [ ] 使用 `resolveDeps` / 同一 `UvDiscoveryDeps` 注入（PY11）。  
- [ ] **win32**（push 绝对路径，dedupe normalize）：  
  - `%LOCALAPPDATA%\Programs\Python\` → `readdir` 单层，匹配 `/^Python3\d+/i`，join `python.exe`  
  - `%ProgramFiles%\Python3*` 同理（readdir ProgramFiles 过滤前缀，**禁止**无过滤整盘）  
  - WinGet Packages: `%LOCALAPPDATA%\Microsoft\WinGet\Packages`，entry `/^Python\.Python\.3\./i`，候选：  
    - `path.join(pkg, "python.exe")`  
    - 以及单层子目录常见布局（若需要：**最多再 readdir 一层**，仍 package-id 已过滤）  
  - Scoop: `%USERPROFILE%\scoop\apps\python\current\python.exe`  
  - Anaconda/Miniconda roots（固定 allowlist，非扫描）:  
    - `%USERPROFILE%\anaconda3\python.exe`  
    - `%USERPROFILE%\miniconda3\python.exe`  
    - `%LOCALAPPDATA%\Continuum\anaconda3\python.exe`  
    - `%USERPROFILE%\mambaforge\python.exe` / `miniforge3\python.exe`（若列在 allowlist）  
  - **显式不加入** `%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`  
- [ ] **unix**: `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3`, `~/.local/bin/python3`  
- [ ] 纯列表函数：无 spawn；缺目录 try/catch best-effort。

### T3 — `listManagerPythonCandidates(deps?)`

- [ ] **pyenv-win**:  
  - root = `env.PYENV_ROOT` || `env.PYENV` || `join(home, ".pyenv", "pyenv-win")`  
  - `versions/*` 单层 readdir → `python.exe`  
- [ ] **conda/mamba/micromamba roots**（readonly seed）：  
  - 对 allowlist 根（同 T2 部分路径 + `CONDA_PREFIX` **仅当**其 `python.exe` 绝对存在且非 WindowsApps）加入 root `python.exe`  
  - **P0 默认**：root-only；若实现单层 `envs/*`，必须仍只取 `python.exe`、不 activate，并在 resolution 标 `manager`  
- [ ] 永不返回 activate / condabin 脚本路径作为解释器。

### T4 — Harden `probePythonBin` + `validatePythonExecutable`

- [ ] `probePythonBin(bin, deps?)`:  
  - 成功解析 `sys.executable` → 必须 `path.isAbsolute`  
  - Store stub → `null`（PY6）  
  - version < min → `null`（PY7）  
  - 返回 pin（realpath 优先）  
- [ ] `validatePythonExecutable`:  
  - 保留 absolute + exists  
  - basename allowlist（可选但推荐）  
  - 调用同一 gate（Store + version）  
  - 错误文案中文、可操作（版本过低 / Store 占位 / 非文件）

### T5 — `findPythonBase(opts?)`

实现 SoT §6.3 序：

1. configPath → validate  
2. includeIsolated → isolatedPythonBin  
3. well-known loop + probe gates  
4. manager loop + probe gates  
5. `processLocalLookupPath` + `where`/`which` for `python`/`python3`（enriched env，与 findUv 相同 pathKey 处理）  
6. win32: `py -0p` 解析路径行；和/或 `py -3 -c` 取 executable；再 gate  
7. fail closed  

- [ ] 导出 `findPythonBase`  
- [ ] `ok: true` ⇒ `path.isAbsolute` 且 source 有值  
- [ ] 禁止返回 bare names  

### T6 — Wire `resolvePythonRuntime`

**File**: `python-runtime.ts`

- [ ] `mode === "system"`:  
  - `findPythonBase({ configPath: opts.systemPythonPath, includeIsolated: false })`  
  - 成功 → `pythonPath` 绝对 + resolution「使用本机全局 Python」  
  - 失败 → 无 pythonPath + 指向 install/pick  
- [ ] `mode === "isolated"` && isolated exists:  
  - **只** probe isolated bin（不要用 system 覆盖 run）  
  - 失败则如实报坏环境，而不是 PATH fallback  
- [ ] `mode === "isolated"` && !isolatedExists:  
  - **omit `pythonPath`**（B3 / PY2）  
  - 内部 `findPythonBase({ includeIsolated: false })` **仅**用于 `resolution` 文案 / CTA 信号  
  - 有 base →「可一键创建独立环境」  
  - 无 base → install 向文案；可附 `uvAvailable` 分支（保持现有语气）  
- [ ] 继续挂载 `findUv` → 仅绝对 `uvPath`

### T7 — Wire `ensureIsolatedPythonEnv`

- [ ] 保留：绝对 `uvBin` 优先（S35 T2）  
- [ ] **else** 分支：删除 bare-only probe 链；改为  
  `const base = await findPythonBase({ includeIsolated: false, deps })`  
  - `!base.ok` → fail「本机没有可用的 Python…」+ 可拼 `pythonInstallHint()`  
  - `base.ok` → `capture(base.path, ["-m", "venv", root], …)` **argv0 绝对**（PY15）  
- [ ] 测试注入路径：允许 mock `findPythonBase` 或通过 deps.runCapture/existsSync 覆盖；若现 short-circuit 过粗，改为可测的绝对 base mock  
- [ ] 成功后 isolated probe 仍绝对 pin  

### T8 — `pythonInstallHint(platform?)`

- [ ] 新导出函数，对称 `uvInstallHint`  
- [ ] win32: 必须含 `winget` 与 `Python.Python.3`（P0 钉 `Python.Python.3.12`）+ python.org 提示 + 重启 Companion  
- [ ] darwin: `brew install python3` 可接受  
- [ ] 其他: 发行版/通用 python3  
- [ ] **单测**：win32 不含 brew-only  

### T9 — `qwen-vl-download.ts`

**File**: `companion/src/computer/qwen-vl-download.ts`

- [ ] system 候选：  
  - config `pythonPath` if absolute  
  - **+** `findPythonBase` / 已 resolve 的绝对路径  
  - **删除**最终 spawn bare `"python"` / `"py"`（C7）  
- [ ] isolated: 仅 `isolatedPythonBin()` 若 exists；否则既有 `python-missing` / 创建环境错误  
- [ ] 实际 `run([py, ...])` 的 `py` 必须 `path.isAbsolute`  

### T10 — `qwen-vl-preflight.ts`

- [ ] **删除** dead `findPython`（~133–147）  
- [ ] readiness / deps 摘要统一 `resolvePythonRuntime`  
- [ ] 暴露或嵌入 `pythonInstallHint`（server-driven，对标 `uvInstallHint` 字段模式）  
- [ ] progressive resolution 字符串与 SoT §7.2 一致  

### T11 — Messages + handlers + extension

| File | Work |
|------|------|
| `companion/src/computer/model-state-messages.ts` | `python-missing` detail：win 侧 winget+python.org，去掉不对称；可写「见环境检查安装命令」 |
| `companion/src/computer/model-handlers.ts` | ensure/state 透传绝对 `pythonPath`、`resolution`、hint；`pick_python_path` 仍走 `validatePythonExecutable` |
| `chrome-extension/.../model-switch-logic.ts` | 对齐 python-missing / CTA；勿 win32 brew-only |
| `chrome-extension/.../SettingsSlideout.tsx` | 显示截断 pythonPath；缺 Python 用 server hint；有 base 无 env 时主按钮「创建独立环境」 |
| types / useWebSocket（若缺字段） | 仅当 preflight 新增 `pythonInstallHint` 等字段时补类型与 merge（最小） |

### T12 — Tests `computer-python-runtime.test.ts`

**File**: `companion/tests/computer-python-runtime.test.ts`

在 **不破坏** 既有 findUv 用例前提下追加：

| Case ID | Setup | Assert |
|---------|--------|--------|
| PY-T1 | stripped PATH + fixture well-known Local `Programs/Python/Python312/python.exe` | findPythonBase ok absolute source well-known |
| PY-T2 | fixture WinGet `Packages/Python.Python.3.12_x/python.exe` | ok absolute |
| PY-T3 | unrelated WinGet package dir with `python.exe` | ignored |
| PY-T4 | WindowsApps path candidate | reject / ok false |
| PY-T5 | validatePythonExecutable Store path | ok false |
| PY-T6 | mock version 2.7 / 3.8 | reject |
| PY-T7 | mock version 3.10+ | accept |
| PY-T8 | ok never bare `"python"` / `"py"` | |
| PY-T9 | `pythonInstallHint('win32')` has winget, not brew-only | |
| PY-T10 | `pythonInstallHint('darwin')` may brew | |
| PY-T11 | resolve isolated missing + base fixture | no pythonPath; resolution create-env |
| PY-T12 | resolve isolated exists | pythonPath = iso style absolute |
| PY-T13 | ensure without uv uses absolute base argv0（mock runCapture 记录 bin） | |
| PY-T14 | ensure with uv still absolute uv（回归） | |
| PY-T15 | listWellKnown 不含 WindowsApps | |
| PY-T16 | **import graph**: computer 测试文件/源不引用 mcp/transport | |
| PY-T17 | 全套 **findUv** 既有 case 仍绿 | |

优先 injectable `existsSync` / `readdirSync` / `runCapture` / `platform` / `env` / `homedir`；临时目录 fixture。

### T13 — Verification commands

```bash
npm --prefix companion test -- computer-python-runtime
# 若项目用 node --test:
# node --test companion/tests/computer-python-runtime.test.ts

npm --prefix companion test   # 有时间跑全量
```

**Manual Windows smoke（P0 后）**:

1. 重启 Companion daemon + tray  
2. 设置 → 实验功能 → Python：已装 python.org/WinGet 时应显示绝对路径或「可创建独立环境」  
3. 无 brew-only 安装 Python 文案  
4. 点创建独立环境（无 uv 时）应成功或给出清晰错误  
5. Store 别名-only 机器：应提示安装真 Python，而非假成功  

---

## 3. File map（P0 only）

| Path | Change |
|------|--------|
| `companion/src/computer/python-runtime.ts` | **core** cascade + hint + gates |
| `companion/src/computer/qwen-vl-preflight.ts` | remove dead findPython; readiness |
| `companion/src/computer/qwen-vl-download.ts` | absolute candidates only |
| `companion/src/computer/model-state-messages.ts` | python-missing copy |
| `companion/src/computer/model-handlers.ts` | passthrough |
| `chrome-extension/src/sidepanel/components/model-switch-logic.ts` | CTA/copy |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | UI pin + hint |
| `chrome-extension/src/sidepanel/types.ts` | only if new fields |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | only if new fields |
| `companion/tests/computer-python-runtime.test.ts` | fixtures |
| `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md` | SoT（已写） |
| `docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md` | 本 plan |

**Do not touch in P0**: `mcp/transport.ts`、config 新键（除已有 `computer.pythonPath`/`pythonMode`）、pack keys、`server.ts` L2 代数、ADR-019 user-env 合并、捆绑 CPython。

---

## 4. UI surface fields

| Field | Source | UI use |
|-------|--------|--------|
| `pythonPath` | resolve / state | 截断显示绝对路径 |
| `pythonMode` | config/state | isolated/system 切换 |
| `isolatedExists` | resolve | CTA 分支 |
| `resolution` | resolve | 主说明文案 |
| `uvAvailable` / `uvPath` | findUv（S35） | 已有；不回归 |
| `uvInstallHint` | S35 | 已有 |
| `pythonInstallHint`（推荐新增） | preflight/state | 缺 Python 主安装命令 |
| `deps.python` / readiness codes | preflight | `python-missing` 等 |

**Progressive CTA mapping**（Settings 实验功能区）:

| Condition | Primary button | Secondary |
|-----------|----------------|-----------|
| !python usable | 复制/展示安装命令（hint） | 选择 Python 路径 |
| base ok && !isolated && mode isolated | **创建独立环境** | 可选装 uv |
| isolated ok | 安装/检查依赖（既有） | 显示路径 |
| mode system && python ok | — | 换路径 / 装依赖 needsManual |

---

## 5. Test plan（summary）

1. **Unit**: T12 table PY-T1…T17 via injectable deps.  
2. **Regression**: full findUv suite + sanitizePythonPackages.  
3. **Static**: grep `from "../mcp` / `mcp/transport` under `companion/src/computer` → zero.  
4. **Manual**: Windows smoke list in T13.  
5. **Negative**: no code path calls winget/choco installer APIs；无 registry write。

---

## 6. Non-goals（explicit）

- Bundle CPython · silent winget · permanent PATH  
- conda first-class runtime / activate  
- `uv python install`（P1 + confirm）  
- computer.uvPath config（S35 P1）  
- Raising min to 3.11（open Q；默认 3.10）  
- CN mirror productization  
- MCP / torch CUDA / model host 变更  

---

## 7. Risk register

| Risk | Mitigation |
|------|------------|
| WinGet Python 包目录布局多变 | package-id 前缀 + 有界 1～2 层 readdir + probe 失败跳过 |
| Store stub 伪装 | 路径 denylist + sys.executable 二次检查 |
| `py -0p` 格式差异 | 宽松解析；失败则靠 well-known/PATH |
| probe 超时拖慢 preflight | 短超时；候选有界；成功即停 |
| ensure 测试 short-circuit 过粗 | 注入绝对 base 或可观察 runCapture argv0 |
| 误伤 findUv | 不改 findUv 序；共享 deps 时注意回归测 |
| 层倒置诱惑 | 禁止 import mcp；PATH 思路本地复制 |

---

## 8. PR checklist

- [ ] SoT PY1–PY16 均有代码或测试锚点  
- [ ] G1–G12 无一违反  
- [ ] `computer-python-runtime` 测试绿（含 findUv）  
- [ ] download/ensure/resolve 无 bare 规范 argv0（已知绝对后）  
- [ ] win32 python 安装文案含 winget、非 brew-only  
- [ ] dead `findPython` 已删  
- [ ] 无 computer→mcp import  
- [ ] 无 PATH/registry 持久化  
- [ ] isolated 下载无 system PATH fallback  
- [ ] Settings/preflight 渐进 CTA 可读  
- [ ] 本机 Windows 手动冒烟（若有 Win 环境）  
- [ ] PR 描述链到 SoT + 本 plan；注明 Scheme D  

---

## 9. DoD

- [ ] Pi APPROVE / APPROVE_WITH_NITS 已处理  
- [ ] P0 acceptance A1–A12（SoT §10）满足  
- [ ] findUv 21+ 既有用例不减少且仍通过  
- [ ] 文档 SoT status 可在合入后改为 **P0 LANDED**（实现 PR 更新，非本 plan 预改）  

---

## 10. Pi gate note

```text
ARTIFACTS FOR PI:
  - docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md
  - docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md
  - (context) docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md

ASK PI:
  VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
  Check: Scheme D only; PY1–PY16; G1–G12; managers=seed; findUv orthogonal;
         no silent install; no brew-only win32 python hint; absolute pin;
         injectable tests; no mcp import; isolated B3 preserved.

POST-PI:
  - Fold nits into this plan § or SoT open defaults
  - Then implement T1→T13 in order
  - Do not start code on REJECT
```

**pi_ready**: true（设计+计划齐；实现未开始）

---

## 11. Suggested implementation order for agent

```text
T1 helpers → T2 well-known → T3 managers → T4 probe/validate
→ T5 findPythonBase → T6 resolve → T7 ensure → T8 hint
→ T9 download → T10 preflight → T11 UI/messages
→ T12 tests (write alongside T5+; finish last) → T13 verify
```

每步保持 `npm --prefix companion test -- computer-python-runtime` 可编译/可跑；优先红-绿小步。

---

*Plan locked to Scheme D · Python cascade P0 · keeps S35 findUv · 2026-08-09*
