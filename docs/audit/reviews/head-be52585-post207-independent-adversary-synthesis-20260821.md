# 四路独立对抗合成 — HEAD `be52585`（#208+#209 未评审增量 + Mode C 残留）

> **日期**: 2026-08-21  
> **对象**: `e8900bc..be52585`（PR #208 Windows 本地打包 + PR #209 settings-web 测试隔离）  
> **残留**: Lane D 复验 PR #207 Mode C P1 在 HEAD 是否回退  
> **Frozen patch**: `docs/audit/reviews/head-be52585-post207-diff-20260821-090024.patch`  
> **SHA256**: `e6e3b78abe388fef11012a096324b544194f2d439055f4dbbfa81103303c3929`（四路各自 `[executed]` 校验）  
> **方法**: 四路独立 worktree agent；读 frozen patch + 活码 + 定向执行；本会话只编排/合成，不自评放行  
> **说明**: #206 / #207 已有在库对抗产物，本轮不重复开 P1。#208/#209 **已合 main**，本轮是 pull 后的事后闸门。

---

## 参与路与裁决

| 路 | 范围 | 裁决 |
|----|------|------|
| **A** | Packaging Security / Trust（7-Zip / makensis 路径探针、ASCII nsi、require cwd） | **APPROVE_WITH_NITS**（P3×3） |
| **B** | Windows packaging correctness / locale（Bin 搜索、GBK、zip 布局、断言变异） | **APPROVE_WITH_NITS**（P2×6） |
| **C** | Test runner isolation（`run-tests.mjs` `--experimental-test-isolation=none`） | **APPROVE_WITH_NITS**（nits×6，无 P0/P1） |
| **D** | ACP Mode C residual at HEAD（#207 P1 是否回退） | **APPROVE_WITH_NITS**（P1 HOLD；R1–R6 仍 P2） |

报告：

- `docs/audit/reviews/head-be52585-post207-lane-a-packaging-security-20260821.md`
- `docs/audit/reviews/head-be52585-post207-lane-b-packaging-correctness-20260821.md`
- `docs/audit/reviews/head-be52585-post207-lane-c-test-isolation-20260821.md`
- `docs/audit/reviews/head-be52585-post207-lane-d-acp-modec-residual-20260821.md`

### 合成裁决

**APPROVE_WITH_NITS.** 无 P0/P1。两条跨路独立收敛：

| ID | 缺陷 | 证据（独立） |
|----|------|----------------|
| **S1** ASCII 门 `grep -qP` 在无 PCRE 的 grep 上 **fail-open** | A N-01 + B P2-1 各自 `[executed]`：Darwin BSD grep `invalid option -- P` 仍给 PASS；植入 U+2014 变异不被杀死。CI ubuntu GNU grep 上门是活的。 |
| **S2** `find_makensis` 的 `NSIS/Bin/` 无测试钉 | B `[executed]` 删 Bin 行仍 95/95；A 只记为既有 PATH-first 模式 |

产品补丁本身成立：PATH 优先、引号完整、`installer.nsi` 可执行行未改、Mode C P1 在 HEAD 未回退。

---

## 已确认 HOLD（四路重放）

| 声称 | 结果 | 证据 |
|------|------|------|
| Frozen patch SHA 与 `git diff e8900bc..HEAD` 一致 | HOLD | A/B/C `[executed]` |
| 7-Zip / makensis 探针 PATH 先于 Program Files；argv 引号；不读 `$PROGRAMFILES` | HOLD | A Q1–Q3、B claim 3 |
| `installer.nsi` 仅注释去 U+2014；HEAD 0 非 ASCII | HOLD | A Q4、B claim 4 Python 字节扫描 |
| cwd-relative `require('./companion/package.json')` 修 Git Bash；CDPATH/NODE_PATH 劫持失败 | HOLD | A Q5、B claim 5 |
| CI 仍跑 `test-package-gates.sh`；windows-latest 走 PATH 7z，新 else 不进 | HOLD | A Q6 |
| 无 auto_approve / confirm skip | HOLD | A Q7 |
| settings-web 隔离 flag 只加在第二趟 spawn；主套件不变 | HOLD | C `[inspected]`/`[executed]` Node 22/24 |
| Node 22 接受 `--experimental-test-isolation=none`，拒绝无 experimental 拼写 | HOLD | C nvm v22.23.2 / v24.16.0 |
| isolation=none 不吞断言失败 | HOLD | C `/tmp` fail probe exit 1 |
| opencode Mode C `--prompt` POSIX+Windows 仍在 | HOLD | D 构造器矩阵 `[executed]` |
| kimi Windows Mode C 仍不拼 `$task` | HOLD | D L1/L0/paste `[executed]` |
| `57a4979..HEAD` ACP 源文件空 diff | HOLD | D `[executed]` |

---

## 残留 nits（非阻断，合并四路）

| ID | 路 | Sev | 摘要 |
|----|----|-----|------|
| S1 | A+B | P2/P3 | `test-package-gates.sh:243` `grep -qP` Darwin fail-open；改 POSIX 字节扫描或 checker 失败即 FAIL |
| S2 | B | P2 | `NSIS/Bin/makensis.exe` 无 `assert_file_has` |
| S3 | A+B | P3 | 7-Zip 断言是字符串钉，不是 PATH-first / 引号行为钉 |
| S4 | A | P3 | POSIX 上 `C:/Program Files/...` 是 cwd 相对路径（CI/有 zip 的 macOS 不进 else） |
| S5 | B | P2 | Node zip **解压** 仍只认 PATH `unzip`/`7z`，与压缩探针不对称 |
| S6 | B | P2 | `[ -x ]` 对 Git Bash `Program Files` `.exe` 可能假阴性；优先 `[ -e ]` |
| S7 | C | nit | commit 引用 node#49844，栈其实是 #64061 / c8ctl#182（workaround 仍对） |
| S8 | C | nit | `engines >=20` 但 flag 要 Node ≥22；Node 20 `npm test` 会在主套件绿后 exit 9 |
| S9 | D | P2 | 上轮 R1–R6 未升 P1（L0 agentId 测试、vault 文案残留、opencode `--prompt` 需 Enter） |
| S10 | D | P2 产品 | kimi POSIX Mode C 仍裸 `exec kimi`（`-p` 是 print 模式，不能当 TUI 预填） |

---

## 机器（对抗路自行跑，非实现会话自评）

- A：`bash -n` 三脚本；`test-package-gates.sh` **95/0**；ASCII/require/quoting 探针与 `/tmp` 变异
- B：同上 95/0 + 变异杀 ASCII/7-Zip 字符串；`zip` vs `7zz` 布局一致；winget/NSIS 清单 `[executed]`
- C：Node 20/22/24 flag 矩阵；settings-web **20/20** isolation=none（Node 22 与 24）；**未**跑 241 文件全量
- D：HEAD 构造器矩阵 POSIX+Windows；ACP 四测试文件 **86/86**（工作区重编，未用 stale `.test-dist`）

---

## Trust / ADR-020

```
Surface:      n/a（打包探针 + 测试跑手；无新 Side Panel）
L2-classes:   none
Compose:      none
Autonomy:     n/a
Trust:        单调——Program Files 是受信安装位回退，PATH 仍优先；无 auto_approve / 确认跳过
Channel:      community
```

**Blast**: T1/T2 已合 main。本轮不构成 T3。Pi 复审未跑（用户点名多路对抗；T2 完整闸门仍是对抗 → Pi）。

---

VERDICT: APPROVE_WITH_NITS
