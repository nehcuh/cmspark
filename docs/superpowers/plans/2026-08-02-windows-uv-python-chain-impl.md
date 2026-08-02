# Implementation Plan — Windows uv/Python chain (P0)

| 字段 | 值 |
|------|-----|
| **Date** | 2026-08-02 |
| **Status** | **P0 IMPLEMENTED (2026-08-02)** — Pi APPROVE_WITH_NITS; code in tree; tests 21/21; live findUv → WinGet absolute |
| **Design SoT** | `docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md` |
| **Adversary** | `docs/audit/reviews/windows-uv-python-chain-adversary-synthesis-20260802.md` |
| **Branch suggestion** | `fix/windows-uv-python-chain` (worktree preferred) |

---

## 0. Stop gates

1. Pi (or dual) review of **SoT + this plan** ends with `VERDICT: APPROVE` or `APPROVE_WITH_NITS`.  
2. REJECT on any G1–G10 in SoT §7.  
3. Implementation via **workflow** after gate（见 `.grok/workflows/windows-uv-python-chain-impl.rhai`，Pi 通过后创建/跑）。  
4. Do **not** edit `main` without worktree if long-running agents.

---

## 1. P0 Tasks（ordered）

### T1 — `findUv` rewrite + helpers（`python-runtime.ts`）

- [ ] Add `isUvExecutable(absPath): boolean` — exists, isFile (or symlink), basename `uv` / `uv.exe`.  
- [ ] Add `listWellKnownUvCandidates(): string[]` — W3/W4 only; WinGet: readdir `Packages` filter `/^astral-sh\.uv_/i` + `uv.exe`; Links if present.  
- [ ] Add `processLocalLookupPath(): string` — clone ideas from `buildSpawnPath` (homedir `.local/bin`, scoop, choco, homebrew, ProgramFiles node, …) **without** importing `mcp/transport`.  
- [ ] Rewrite `findUv`:
  1. well-known absolute candidates first (W11)  
  2. `where`/`which` under `{ ...process.env, PATH: processLocalLookupPath() }`  
  3. realpath + optional `--version` probe  
  4. **never** return `{ ok: true, path: "uv" }`  
- [ ] Optional inject hooks for tests (`deps?: { existsSync, readdirSync, runCapture, platform, env, homedir }`) — keep production default thin.

### T2 — Absolute exec in `ensureIsolatedPythonEnv`

- [ ] If `uv.ok`, require `path.isAbsolute(uv.path)`; else treat as uv unavailable (fall through venv/pip).  
- [ ] All `runCapture(uvBin, …)` use that absolute path only.

### T3 — Platform install helper

- [ ] `uvInstallHint(platform = process.platform): string`  
  - win32: `winget install --id astral-sh.uv -e`  
  - darwin: `brew install uv`  
  - else: `curl -LsSf https://astral.sh/uv/install.sh | sh`（或项目既有 linux 文案，禁止 brew-only）  
- [ ] `buildInstallCommands`: when `uvAvailable && uvPath absolute`, prefer quoted absolute binary in command lines.

### T4 — Preflight + handlers

- [ ] `qwen-vl-preflight.ts`: replace brew-only strings with `uvInstallHint`; add `uvPath?: string` to preflight type/payload.  
- [ ] `model-handlers.ts`: pass `uvPath` alongside `uvAvailable` in state / ensure responses.

### T5 — Extension surface

- [ ] `types.ts`: `uvPath?: string` on model + preflight.  
- [ ] `useWebSocket.ts`: merge `uvPath` when present.  
- [ ] `SettingsSlideout.tsx`:  
  - missing: platform hint via companion-provided resolution string or client `navigator.platform` **prefer server-driven** string from preflight  
  - present: show truncated `uvPath`

### T6 — Tests（`computer-python-runtime.test.ts`）

| Case | Assert |
|------|--------|
| stripped PATH + fixture `.local/bin/uv[.exe]` | ok + absolute |
| stripped PATH + fixture WinGet `astral-sh.uv_x/uv.exe` | ok + absolute |
| unrelated WinGet package dir with `uv.exe` | ignored |
| ok never bare `"uv"` | |
| `uvInstallHint('win32')` contains winget, not brew | |
| `uvInstallHint('darwin')` may contain brew | |
| ensureIsolatedPythonEnv uses absolute argv0 (mock) | |
| sanitizePythonPackages regression | unchanged |
| unix candidate list includes homebrew paths (unit of listWellKnown) | |

Prefer injectable fs/runCapture; avoid requiring real WinGet on CI.

### T7 — Verification commands

```bash
npm --prefix companion test -- computer-python-runtime
# or: node --test companion/tests/computer-python-runtime.test.ts  (per project convention)
npm --prefix companion test   # full suite if time
```

Manual Windows smoke（P0 后）:
1. 重启 Companion daemon + tray  
2. 设置 → 实验功能 → Python 环境应显示「已检测到 uv」+ 绝对路径  
3. 无 brew 字样  

---

## 2. File map（P0 only）

| Path | Change |
|------|--------|
| `companion/src/computer/python-runtime.ts` | core |
| `companion/src/computer/qwen-vl-preflight.ts` | copy + uvPath |
| `companion/src/computer/model-handlers.ts` | passthrough |
| `companion/tests/computer-python-runtime.test.ts` | tests |
| `chrome-extension/src/sidepanel/types.ts` | types |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | merge |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | UI |

**Do not touch in P0:** `mcp/transport.ts`（除非显式 P1）、config schema 新键、pack keys、`server.ts` L2 代数。

---

## 3. Risk register

| Risk | Mitigation |
|------|------------|
| WinGet 包目录重命名 | package-id 前缀 + exists 探测，不硬编码完整路径 |
| 假 `uv.exe` 在探测目录 | basename + `--version` smoke；不递归整树 |
| CI 无 uv | fixture temp dir inject |
| 层倒置 | 禁止 computer import mcp |
| 过度扫描 IO | 仅固定候选 + 单层 readdir Packages |

---

## 4. DoD

- [ ] SoT W1–W12 有代码或测试对应  
- [ ] G1–G10 无一违反  
- [ ] `computer-python-runtime` 相关测试绿  
- [ ] 本机 Windows 手动：已装 uv → 设置页检测到 + 非 brew  
- [ ] 实现 dual/Pi code review（可选，计划门已过）  

---

## 5. Out of scope（explicit）

- Bundle uv · MCP WinGet 同步 · `computer.uvPath` config · 重新检测按钮 · torch 安装 · 下载源  

---

## 6. Implementation workflow（post-Pi）

1. Create `.grok/workflows/windows-uv-python-chain-impl.rhai`：  
   - phase Implement: agent with read-write on file map  
   - phase Test: run unit tests  
   - phase Self-check vs W locks  
2. Run workflow in worktree if available.  
3. Human/Pi nits fold-in if APPROVE_WITH_NITS.  

---

## 7. Pi nits fold-in (APPROVE_WITH_NITS — done in P0)

From `docs/audit/reviews/windows-uv-python-chain-pi-20260802-230116.md`:

| Nit | Action |
|-----|--------|
| N1 | `runCapture` optional `env` for enriched-PATH `where` |
| N2 | `where`/`which` hits absolute + basename `uv`/`uv.exe` before pin |
| N3 | `buildInstallCommands` + callers take `uvPath` |
| N4 | Preflight emits server-driven `uvInstallHint` |
| N5 | model-handlers state builders pass `uvPath` / `uvInstallHint` |
| N6 | Tests: no computer→mcp import; non-blocking uv; absolute pin fixtures |

## 8. P0 completion note

- Impl workflow agent wrote code then hit stream transport error on schema return; human finished test fix + verification.
- `computer-python-runtime.test.js`: **21/21 pass**
- Live host: `findUv` → `...\WinGet\Packages\astral-sh.uv_...\uv.exe`

---

*Plan locked to Scheme D · Pi APPROVE_WITH_NITS · P0 in tree · 2026-08-02*
