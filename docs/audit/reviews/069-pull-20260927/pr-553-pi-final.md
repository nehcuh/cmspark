## 第三轮聚焦复现报告 — bf678cb7

### 结论先行
①②③④⑤⑥ 六条中，**①③⑤ 我逐条实跑复现均已真修好**；**②的突变验证成立但只关了 2/3**；同时 **bf678cb7 新引入一处可误杀合法发布的缺陷（已在本机 Git Bash 上双反例证明），且该新检查零测试覆盖**。

---

### 1. ①(a)(b)、③、⑤ 反例复现（全部真修好）

**①(a) index 损坏** — 造 repo（tag=v9.9.9、锚 9.9.9）后 `printf GARBAGE > .git/index`，豁免全开：
```
[release-guard] ERROR: git status 失败（rc=128，如 index 损坏）—— 读不出树状态
RC=1        ← 修前 rc=0 且打印 "ok: 工作树干净"
```
**①(b) 解包进更大的 git 仓库** — 外层仓库 commit 后把 cmspark 树解包进去，豁免全开：
```
[release-guard] ERROR: 守卫所在目录不是本仓库根
   (ROOT=…/big/unpacked 但 git 顶层=…/big) — 校验的会是别的树
RC=1        ← 修前 rc=0
```

**③ 四组合表（#547 特征态：锚 9.9.9、HEAD 被 v8.8.8 标记、v9.9.9 停在 HEAD~1）**，我扩到 6 行：

| # | env | rc |
|---|---|---|
| 1 | STRICT=1 REF_TYPE=tag CI_TAG=v9.9.9 | 1 |
| 2 | STRICT=1 REF_TYPE=tag CI_TAG=(unset) | 1 |
| **3** | **STRICT=1 REF_TYPE=branch CI_TAG=v9.9.9** | **1** ← 上轮 rc=0，已闭合 |
| 4 | STRICT=1 REF_TYPE=branch CI_TAG=v8.8.8 | 1 |
| 5 | STRICT=1 REF_TYPE=branch CI_TAG=(unset) | 1 |
| 6 | ALLOW_DIRTY=1 ALLOW_UNTAGGED=1 REF_TYPE=branch CI_TAG=v9.9.9 | 1 |
| 7 | 合法 dry-run：HEAD 无 tag + STRICT=1 + branch | **0** ← 未误伤 dispatch |

**⑤ 环境泄漏** — `CMSPARK_RELEASE_TAG=v9.9.9 bash scripts/tests/test-package-gates.sh` → **156 passed, 0 failed**（上轮 147/4）；再把五个变量**全部**预设（TAG/REF_TYPE/STRICT/ALLOW_DIRTY/ALLOW_UNTAGGED）跑一遍 → 仍 **156/0**。

---

### 2. ② 突变验证：成立，但不是假绿；只有 2/3 被锁
在 **隔离副本**（`git archive HEAD` → 临时目录，不动仓库）里逐个突变后跑真 suite：

| 突变 | 结果 | 失败的正是 |
|---|---|---|
| M1 CI_TAG 指向校验 → `if false` | 155/1 | `CI_TAG 指向旧提交（HEAD 领先）→ 拒绝` |
| M2 branch 无脑跳过 tag（4dba1ac7 语义） | 155/1 | `dry-run 但 HEAD 带错 tag → 拒绝` |
| M3 `git status` 加回 `\|\| true` | 155/1 | `index 损坏致 git status 失败 → 硬失败` |
| **M4 `ROOT==toplevel` 校验 → `if false`** | **156/0 存活** | —（无任何断言） |
| M6 去掉 `grep -x EXPECTED_TAG` 回退（⑥） | 156/0 存活 | —（无多 tag 用例） |
| M7 去掉 `CI_TAG_RESOLVED=mismatch`（④） | 156/0 存活 | — |

三次突变**各恰红 1 条、且红的正是目标断言**，操作者自述属实，不是假绿；还原后 156/0（副本与仓库逐字一致，仅 CRLF 差异）。但 `grep -n "toplevel\|不是本仓库根"` 在 test-package-gates.sh 与 ci.yml 中**零命中** ⇒ **①(b) 的修法本身零覆盖**，上轮 NIT ② 只关了 2/3。

### 3. bf678cb7 新引入的缺陷

**【N1 · 核心新缺陷】`ROOT == git toplevel` 字符串比较会误杀合法发布（本机 Git Bash 实测两个反例）**
git `--show-toplevel` 走 `getcwd()` ⇒ **解析 symlink/junction、并返回磁盘规范大小写**；而 bash 的 `ROOT` 是**逻辑路径**（`cd x && pwd` 保留拼写）。同一仓库、干净树、tag 正确、STRICT=1：

```
A) 经 junction 调用：ROOT=C:/…/Temp/jtlink  顶层=C:/…/scratch/pig/jt/real   → RC=1
B) 全小写拼写调用：  ROOT=C:/users/huchen/… 顶层=C:/Users/HuChen/…          → RC=1
   [release-guard] ERROR: 守卫所在目录不是本仓库根
```
- 直接回答提问：**会**。POSIX↔mixed 靠 `cygpath -m` 挡住了，但 **大小写**（Git Bash 手敲小写盘符/路径是常态）与 **symlink/junction**（macOS 上 `/var`→`/private/var`，`mktemp -d` 正落在 `/var/folders/…`；Windows `subst`/junction）挡不住。
- CI 影响：preflight=ubuntu、package 的 ubuntu/macOS 工作目录（`/home/runner/work/…`、`/Users/runner/work/…`）是真实路径，应无碍；**windows-latest 的 `D:\a\…` 拼写我在这台机器上无法验证**——但本机 Git Bash 已证伪「同目录不同拼写必相等」。
- 修法一行：比对物理路径（`cd "$ROOT" && pwd -P` / `readlink -f`），或直接**以 `git rev-parse --show-toplevel` 为 ROOT 权威**。

**【N2】N1 那条检查零覆盖**（M4 存活，见上）；也就是说「新增的强校验」既没测试锁、又恰好是唯一会误杀的一条。

**【N3】④ 只修了一半**：`CI_TAG` 的 **sha 指向 HEAD 但名字≠锚**（正是 #547 主检测路径，e.g. HEAD 被 v8.8.8 标记、锚 9.9.9、`CI_TAG=v8.8.8`）仍同屏输出 `ok: CMSPARK_RELEASE_TAG 确实指向 HEAD` **紧跟** `FAIL: HEAD 的 tag 是 v8.8.8…`。仅观感问题，rc=1 正确。

**【N4】⑥ 功能正确但无测试**：多 tag（`v0.0.1`+`v9.9.9`）→ rc=0 且 `ok: HEAD tag == v9.9.9`；只有错 tag → rc=1；branch 路径多 tag 含锚 → `ok: dry-run：HEAD 的 tag 含 v9.9.9`。

### 4. 其余核查（未发现新问题）
- **gate 156/0 属实**：仓库、副本、五变量预设三种跑法均 156/0；`bash -n release-guard.sh`、`bash -n test-package-gates.sh` 通过；`js-yaml` 解析 release.yml / ci.yml **OK**。
- **release.yml 改动纯注释、零语义变化**（剥掉注释行后 diff 为空）。
- **`die_unknown` 不在正常发布路径误触发**：浅克隆 `--depth=1 --branch v9.9.9`（annotated tag、`.git/shallow` 存在，STRICT=1 + `CI_TAG=v9.9.9` + `REF_TYPE=tag`）→ **rc=0**；完整克隆 checkout tag（正常 tag push）→ **rc=0**；dry-run 无 tag → rc=0。`--show-toplevel` 在浅克隆下正常。
- **branch 路径 `grep -qx`**：无 tag→放行、多 tag 含锚→ok、不含→硬失败，语义正确；git ref 名不允许空格/`*?[`，故 `printf '%s\n' ${HEAD_TAGS}` 的未引用展开安全。
- 真实仓库实跑（只读）：干净树、`[Unreleased]` 空，仅因 HEAD 未打 tag 而 rc=1 —— 与本次改动无关，符合预期。

### 判定
两条 BLOCKING 已消除且经我复现；①②③⑤ 如实修好；本轮唯一实质问题是**新增的 `ROOT==toplevel` 校验在本平台可误杀合法发布**，但它 fail-closed（无 fail-open、不会放过 #547）、CI 发布主路径大概率不踩，属「硬化过头 + 无测试」而非新绕过面。

VERDICT: APPROVE_WITH_NITS
PI_FINAL_EXIT=0
