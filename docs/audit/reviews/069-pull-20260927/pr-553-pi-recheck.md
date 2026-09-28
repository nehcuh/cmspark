# PR #553 第二轮复审 —— 提交 `4dba1ac7`（PR HEAD）

## 方法与范围（只读）

| 动作 | 证据 |
|---|---|
| `git log --oneline cc48a924..HEAD` | 仅 `4dba1ac7` 一个提交 |
| 读全文 `scripts/release-guard.sh`（HEAD 版）+ `git show 4dba1ac7`（5 文件 +148/−52） | — |
| 实跑守卫（真仓库 + `/tmp` 沙箱 3 个）、gate 测试、4 次突变验证 | 见下 |
| 只读性 | 评审结束 `git diff --stat HEAD -- scripts/ .github/` 为空；未提交、未打 tag、未 push；沙箱全在 `/tmp`（`git archive HEAD` 导出） |

沙箱：`/tmp/rgsbx.cCDvGD`（最小 repo：guard+package.json+CHANGELOG）、`/tmp/rgold.S0v27T`（cc48a924 导出做「修前」对照）、`/tmp/rgmut.AUdyen`（做突变）。

---

## Q1-a：原 P0（git 失败时 dirty 断言静默放行）—— **原攻击已消除**

| 场景 | 修前 `cc48a924` | 现在 `4dba1ac7` |
|---|---|---|
| `GIT_DIR=/nonexistent` + `STRICT=1` + `CI_TAG=v0.6.10`（我上轮的原攻击） | **rc=0**，三条全 `ok` | **rc=1**：`ERROR: git 不可用或当前目录不是 git 仓库` |
| git 不在 PATH（node shim + `PATH` 无 git，`STRICT=1`+`CI_TAG`） | — | **rc=1**（同一条 ERROR） |
| 非 git 目录 + `ALLOW_UNTAGGED=1 ALLOW_DIRTY=1` | — | **rc=1**（豁免不能覆盖，与文档一致） |

修前对照是实跑出来的，不是采信提交信息：

```
# /tmp/rgold.S0v27T (= cc48a924)
$ GIT_DIR=/nonexistent CMSPARK_RELEASE_STRICT=1 CMSPARK_RELEASE_TAG=v0.6.10 bash scripts/release-guard.sh
  ok: 工作树干净（tracked） / ok: HEAD tag == v0.6.10 / ok: [Unreleased] 段为空
[release-guard] 全部通过        rc=0
# 真仓库 (= 4dba1ac7)
$ GIT_DIR=/nonexistent CMSPARK_RELEASE_STRICT=1 CMSPARK_RELEASE_TAG=v0.6.10 bash scripts/release-guard.sh
[release-guard] ERROR: git 不可用或当前目录不是 git 仓库 —— 无法证明工作树干净。
rc=1
```

**突变验证**：把第 0 步 `if ! git rev-parse --git-dir` 改成 `if false` → 恰好 1 条红（`150 passed, 1 failed`，红的是新增的「非 git 仓库 → 硬失败，豁免不得覆盖」）。→ 这条断言真的在守行为。

---

## Q1-b：原 P1（dispatch dry-run 被整体打死）—— **已消除，且文档自洽**

- `release.yml:6-11` 头部改成「dispatch 可 dry-run，ref_type=branch 跳过 tag 断言但强制干净树 + Unreleased 空；tag push 走完整 strict」；`:39-44` preflight 注释同步改写；`release` job 仍 `if: startsWith(github.ref, 'refs/tags/v')`（`:214`）。全仓 grep 未见残留的旧说法（「dispatch 手跑 tag 断言必失败=期望行为」只在 guard 里，已改写）。
- 两个 job 都传 `CMSPARK_RELEASE_REF_TYPE: ${{ github.ref_type }}`（`:50`、`:130`）。

实跑（沙箱，完全镜像 CI 的 env）：

| 场景 | 期望 | 实测 |
|---|---|---|
| `STRICT=1` + `TAG=main` + `REF_TYPE=branch`，干净树 | 0 | **rc=0** ✅（dispatch 恢复可用） |
| 同上 + 脏树 | 1 | **rc=1**（`strict 模式：工作树有未提交的 tracked 改动`）✅ |
| `REF_TYPE=branch` + `[Unreleased]` 非空 | 1 | **rc=1** ✅（dry-run 不是无脑放行） |
| `TAG=main` 但 **不设** `REF_TYPE`（缺省 tag 路径，保守回退） | 1 | **rc=1** ✅ |

---

## Q2：`CMSPARK_RELEASE_TAG` 绕过（#547 可复现）—— **堵住**

复现我上轮的绕过（tag 在 A、HEAD 领先 2 提交、锚仍 9.9.9、`STRICT=1 CI_TAG=v9.9.9`）：

```
FAIL: CMSPARK_RELEASE_TAG=v9.9.9 解析到 894b4137，但 HEAD 是 da3c8973
      tag 并未指向被打包的提交 —— 这正是 #547「同版本号两份二进制」
[release-guard] 1 条断言失败      rc=1     （修前 rc=0）
```
反向不误挡：`CI_TAG` 确实指向 HEAD → rc=0；tag 对象本地不可解析（浅克隆）→ 明确打印「信任 workflow context」后继续（保住浅克隆修复）。逻辑正确。

⚠️ 但这条**新加固零测试覆盖**（见 Q4-②）。

---

## Q3：gate 151 条是否在守行为 —— **是**

- 我在 `git archive HEAD` 导出上跑：`=== Results: 151 passed, 0 failed ===`。数字属实。
- **场景 5 修复确认**：该场景现在是 `commit` 后 `git tag -f`，我做了与上轮同款突变（短路断言 3 的两个 `fail`）→

```
FAIL: release-guard: [Unreleased] 非空 → 拒绝（tag 已在 HEAD，失败只能来自断言 3）(expected=1 actual=0)
FAIL: release-guard: CHANGELOG 无 [Unreleased] 段 → 拒绝 (expected=1 actual=0)
=== Results: 149 passed, 2 failed ===
```
与操作者自述的 149/2 完全一致；还原后 151/0。→ 假的场景 5 已变成真断言。
- 另两项抽查：`[Unreleased]` 存在性检查对 **CRLF** 也正确（段存在且空→0 / 段非空→1 / 段缺失→1，三例实跑）。
- 数字口径小提醒：`125 → 151` 是**整票**（main `c8d3741f`=125，`cc48a924`=146，`4dba1ac7`=151），本提交自身是 **146→151（+5）**；提交体写作「+9 静态 +17 动态」把全票增量算到了这一提交头上（与 #549/#551 同类的口径 over-claim，仅措辞问题）。

---

## Q4：本轮**新引入 / 残余**的缺陷

### ① [P2 · 建议顺手补] P0 的**根因**未闭合：`|| true` 仍吞掉 `git status` 的失败

第 0 步只拦「仓库级」失败；`DIRTY="$(git status … || true)"` 一字未动，之后也没有校验 `git status` 的退出码。两处实跑反例：

**(a) index 损坏（无需任何环境变量）** —— 树里确有未提交改动，`STRICT=1`、tag 正确指向 HEAD：
```
$ printf GARBAGE > .git/index        # fatal: index file smaller than expected
$ git status --porcelain --untracked-files=no   → rc=128，stdout 为空
$ git rev-parse --git-dir                        → rc=0（第 0 步放行）
$ CMSPARK_RELEASE_STRICT=1 CMSPARK_RELEASE_TAG=v9.9.9 bash scripts/release-guard.sh
  ok: 工作树干净（tracked）   …   [release-guard] 全部通过      rc=0   ← 树是脏的
```
**(b) 守卫校验的是「周边仓库」而非 `ROOT`** —— 把源码解包在任意 git 仓库内（该仓库 HEAD 恰好带同名 tag），**零环境变量**：
```
$ bash scripts/release-guard.sh     # cwd=…/extracted，其内 CHANGELOG 有未提交改动
  ok: 工作树干净（tracked）      ok: HEAD tag == v9.9.9      rc=0
```
→ 文案 `ok: 工作树干净（tracked）` 在「查不出 / 查的不是这棵树」时依然会输出，与脚本头新写的「git 失败不是「树干净」，必须硬失败」不完全相符（该断言被拦住的只有「仓库级失败」这一子集）。**不阻塞**（行为与修前一致，本提交只缩小了 fail-open 面），但建议 1–2 行收口：
```sh
ROOT_TOP="$(git -C "${ROOT}" rev-parse --show-toplevel 2>/dev/null || true)"
[ "${ROOT_TOP}" = "${ROOT}" ] || { echo ERROR 不是本仓库根; exit 1; }
DIRTY="$(git -C "${ROOT}" status --porcelain --untracked-files=no)" || { echo ERROR 无法读取树状态; exit 1; }
```

### ② [NIT] 新加固（CI_TAG→HEAD 指向校验）零覆盖，突变存活
把 `if [ -n "${TAG_SHA}" ] && … != "${HEAD_SHA}" ]` 改成 `if false; then`（整条新加固失效）→ **仍然是 `151 passed, 0 failed`**。操作者是用手工实验验证这条的，测试套没锁。建议在场景 6 旁加一条：tag 在 `HEAD~1`、`CI_TAG`=该 tag 名、锚匹配 → 期望 rc=1。

### ③ [NIT] **新引入**的绕过面：`CMSPARK_RELEASE_REF_TYPE=branch` 本地可一票否决 `STRICT`
#547 特征态（锚 9.9.9、HEAD 被 v8.8.8 标记、v9.9.9 停在 `HEAD~1`）实跑：

| env | rc |
|---|---|
| `STRICT=1` | 1（tag v8.8.8 ≠ 锚） |
| `STRICT=1 CI_TAG=v9.9.9` | 1（指向校验命中） |
| `STRICT=1 CI_TAG=v9.9.9 REF_TYPE=branch` | **0**（WARN 后放行，`STRICT` 拦不住） |

CI 内安全（`ref_type` 来自 GitHub context，`release` job 又被 tag 门挡住），但与既有的 `ALLOW_UNTAGGED` 不同：后者只放行「完全无 tag」，且被 `STRICT` 禁用；`REF_TYPE=branch` 连「tag 明显不匹配」也一起跳过，且**盖过 `STRICT`**。建议分支路径仍要求：`HEAD` 上能解析到 tag 且 ≠ 锚 → 硬失败（dry-run 容忍「无 tag/分支名」，不容忍「错 tag」）。

### ④ [NIT] 日志自相矛盾 / 文案不实
- 陈旧 CI_TAG 场景同一断言先 `FAIL: …解析到 894b4137，但 HEAD 是 da3c8973`，紧接着又 `ok: HEAD tag == v9.9.9`（FAIL 与 ok 同屏）。
- `CI_TAG=main`（dispatch 的 ref_name）走缺省 tag 路径时会打印 `ok: CMSPARK_RELEASE_TAG 确实指向 HEAD` —— 那不是 tag。

### ⑤ [NIT] `rg_run` 的环境清理**漏了最关键的 `CMSPARK_RELEASE_TAG`**（注释还写「三个」却清了四个）
```
$ CMSPARK_RELEASE_TAG=v9.9.9 bash scripts/tests/test-package-gates.sh
=== Results: 147 passed, 4 failed ===      # tag 不匹配/无 tag 的 4 条假红
$ CMSPARK_ALLOW_UNTAGGED=1 …   → 151/0   （已清）
$ CMSPARK_RELEASE_REF_TYPE=branch … → 151/0（已清）
```
→ claude P3 那一条「防环境泄漏」没修完。

### ⑥ [NIT] 多个 tag 指向 HEAD 时取到字母序第一个（非本次改动，fail-closed 方向）
`HEAD` 同时被 `v7.7.7 v8.8.8 v9.9.9` 标记时，`git tag --points-at HEAD | head -1` 稳定取 `v7.7.7` → 假 FAIL（rc=1）。方向安全，但会误挡；可优先匹配 `EXPECTED_TAG`。

### 已核实为本轮修好的旧 NIT
`[Unreleased]` 缺失 → fail ✅（5b 场景 + CRLF 三例）· 场景 5 变真 ✅ · `package.sh:70-72` 归属注释改正 ✅（`CMSPARK_PACKAGE_GATE_ONLY` 确实只在 `test-package-gates.sh` 用）· `ci.yml:43` 补 `bash -n scripts/release-guard.sh` 且在**会跑 PR 的 step 内** ✅（`bash -n` 本地通过）。

### 上轮 follow-up（仍不在本 PR，确认无变化、非阻塞）
`create-dmg.sh` / `build-windows-installer.sh` / `build-windows-exe.ps1` 不调守卫（官方路径被覆盖）· `--untracked-files=no` 下 untracked 源码仍进产物 · `cli-version.test.ts:45` 硬编码版本正则。

---

## 未能验证

- 「`detected dubious ownership`」是否也被第 0 步拦住：本机无法制造异主 SID（需 `SeRestorePrivilege`），逻辑上该检查在 repo discovery 内、`rev-parse` 同样会失败，但**未实测**。若实际不触发，则 §Q4-① 的触发面会比我现在测到的更宽（这也正是提交体自己引用的场景）。
- GitHub 侧：#552/#547 正文与 job 过滤（`github.ref_type`）行为，无网络，仅按 workflow 文本判断（`:13-15` 的 `on:` 过滤 + `:214` 的 `if:` 自洽）。

---

## 结论

两条 BLOCKING 都**真的**消除了，而且是对着我上轮的**具体攻击**逐条实跑复现后确认的（P0：rc=0→rc=1，含 git 缺失/非仓库/豁免全开三个变体；P1：dispatch 镜像 rc=0、脏树与未归档仍 rc=1、缺省回退 fail-closed，文档自洽）。`CMSPARK_RELEASE_TAG` 绕过已堵，`[Unreleased]` 缺失已 fail，场景 5 已变真（我的独立突变给出同样的 149/2），151/0 属实。剩下的都是非阻塞项：P0 的**根因**（`|| true` 吞 `git status` 失败、校验的是周边仓库）仍未闭合（建议本 PR 顺手 2 行，或至少开票，我给了可复现反例）；新加固零覆盖（突变存活）；`REF_TYPE=branch` 引入一个盖过 `STRICT` 的本地绕过面；日志口径与 `rg_run` 漏清 `CMSPARK_RELEASE_TAG` 等 4 条小问题。

VERDICT: APPROVE_WITH_NITS
PI_RECHECK_EXIT=0
