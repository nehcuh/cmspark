# PR #553 复审（第二轮）— 你上一轮 REJECT，请核实修复

## 你上一轮（pr-553-pi-20260928-172450.md）对提交 cc48a924 的裁决：REJECT

两条 BLOCKING：
- **[P0]** `release-guard.sh:70` — git 失败时 dirty 断言静默放行（fail-open），
  `GIT_DIR=/nonexistent` + strict + CI_TAG 可让三条全 ok、rc=0。
- **[P1]** dispatch dry-run 被整体打死，且与 release.yml:6-8 头部文档冲突。

你当时已注明：**在飞工作树已引入 git rev-parse 硬失败 + CMSPARK_RELEASE_REF_TYPE，
但未提交，故对 cc48a924 无效。**

## 现在已提交（`4dba1ac7`，PR HEAD），请独立核实修复（不要采信）

`git show 4dba1ac7`、`git log --oneline cc48a924..HEAD`、读 `scripts/release-guard.sh` 全文。

### P0（git fail-open）应已修
- 新增第 0 步 `git rev-parse --git-dir` 硬失败（release-guard.sh 顶部）。
- **请复现你的原 P0 攻击**：`GIT_DIR=/nonexistent` + `CMSPARK_RELEASE_STRICT=1`
  + `CMSPARK_RELEASE_TAG=v0.6.10` → 现在应 **rc=1**（修前 rc=0）。
- 核实豁免开关（ALLOW_UNTAGGED/ALLOW_DIRTY）不能覆盖这条 git 检查。

### P1（dispatch dry-run）应已修
- 新增 `CMSPARK_RELEASE_REF_TYPE`（release.yml 两个 job 都传 `${{ github.ref_type }}`）。
- ref_type=branch → 跳过 tag 断言、但仍强制 dirty + Unreleased；tag push → 严格。
- release.yml:6-8 头部注释 + preflight 注释是否已同步更新（不再自相矛盾）？
- **请验证**：ref_type=branch + 干净树 → rc=0；ref_type=branch + 脏树 → rc=1。

### 另外本轮还修了你上一轮的 NIT（一并核实）
1. **[P1 加固]** `CMSPARK_RELEASE_TAG` 曾被无条件信任 → 你实测可完整复现 #547。
   现已加：能解析该 tag 时要求 `^{commit}` == HEAD，不等则硬失败；解析不到（浅克隆）
   才信任。**请复现你上一轮的绕过**：tag 在 A、HEAD 领先 2 提交、设 CI_TAG=旧tag
   → 现在应 rc=1（修前 rc=0）。
2. **[NIT]** `[Unreleased]` 段**缺失**时曾误报 ok → 现先 grep 判存在性，缺失即 fail。
3. **[NIT]** 测试场景 5 曾是假的（先 tag 再 commit，失败来自断言2 不是断言3；你做过
   突变验证：删断言3 仍 12/12 绿）→ 现改为 commit 后 `git tag -f`，且操作者**自己
   复现了你的突变验证**：短路断言3 → 恰好 2 条 Unreleased 断言变红（149/2），还原 151/0。
4. **[NIT]** `rg_run` 的 `env "$@"` 环境泄漏 → 改 `env -u` 先清四个守卫变量。
5. **[NIT]** package.sh 注释「GATE_ONLY 是 ci.yml 快路径」归属错（该变量只在
   test-package-gates.sh 用）→ 已改正。
6. **[NIT]** release-guard.sh 缺 `bash -n` 语法门 → ci.yml:43 已补。

### 你上一轮判为 follow-up（非阻塞）的，本轮仍不在 PR 内，确认即可
- create-dmg.sh / build-windows-installer.sh / build-windows-exe.ps1 不调守卫（官方路径已覆盖）
- cli-version.test.ts:45 硬编码版本正则
- --untracked-files=no 下 untracked 源码仍进产物

## 你要回答的核心问题
1. 你的两条 BLOCKING（P0 git fail-open、P1 dispatch 打死）是否**真的**消除了？请实跑复现。
2. `CMSPARK_RELEASE_TAG` 绕过（可复现 #547）是否堵住了？请实跑。
3. gate 测试 151 条是否真的在守行为（尤其场景 5 修复 + 突变验证）？可自行跑
   `bash scripts/tests/test-package-gates.sh` 并做一次突变验证。
4. 有没有本轮**新引入**的缺陷（dry-run 分支、git 硬失败、CI_TAG 指向校验的新代码）？

## 只读评审：不要改文件、不要提交、不要打 tag、不要 push。
可实际运行守卫脚本与 gate 测试（都是只读的）。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
