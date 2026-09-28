# PR #553 第三轮聚焦确认 — 提交 bf678cb7（最终 HEAD）

## 背景

你上一轮（pr-553-pi-recheck.md）对 `4dba1ac7` 给 APPROVE_WITH_NITS，确认两条 BLOCKING
已消除，并列出 6 条 NIT。操作者随后提交 `bf678cb7` 落地了其中的 ①②③⑤ + 自己重写的 ④⑥。
本轮**只需聚焦确认 bf678cb7 相对 4dba1ac7 的增量**（`git show bf678cb7`、
`git diff 4dba1ac7..bf678cb7`），版本工程本体你上轮已核实干净，无需重跑全量。

## 你上一轮的 NIT → bf678cb7 的修法（逐条核实，不要采信）

**① [P2] P0 根因未闭合：`|| true` 仍吞 git status 失败 + 校验周边仓库**
你的两个反例：(a) index 损坏 → rc=0；(b) 解包进大仓库 → rc=0。
修法：新增 `git rev-parse --show-toplevel == ROOT` 校验（堵 b）；`git status` 改为显式
检查退出码、非 0 即 `die_unknown`（堵 a）；抽 `die_unknown()` 统一「查不出=失败」、豁免不得覆盖。
**请复现你的 (a)(b) 两个反例，确认现在 rc=1。**

**③ [NIT] REF_TYPE=branch 本地可一票否决 STRICT**
你的反例表：`STRICT=1 CI_TAG=v9.9.9 REF_TYPE=branch` 在「HEAD 被 v8.8.8 标记、
v9.9.9 停 HEAD~1」下 rc=0。修法：dry-run 改为**容忍 HEAD 无 tag、但不容忍 HEAD 带错 tag**
（branch 路径：无 tag→放行；tag 含 EXPECTED_TAG→ok；tag 不含→硬失败）。
**请复现你那张四组合表，确认第三行现在 rc=1、且合法 dry-run（HEAD 无 tag）仍 rc=0。**

**⑤ [NIT] rg_run 漏清 CMSPARK_RELEASE_TAG**
你实测 `CMSPARK_RELEASE_TAG=v9.9.9 bash test-package-gates.sh` → 147/4。
修法：env -u 补齐为五个变量全清。**请复现，确认现在预设 CI_TAG 跑 gate 不再假红。**

**② [NIT] 新加固零覆盖、突变存活**
你说把 CI_TAG 指向校验改 `if false` 后仍 151/0。修法：补场景 9/10/11（CI_TAG 指向旧提交→拒、
dry-run 带错 tag→拒、index 损坏→硬失败）+ 反向不误挡。**操作者自述做了三次突变验证
（各恰好红 1 条，还原 156/0）—— 请独立复现至少一次，确认不是假绿。**

**④ [NIT] FAIL 与 ok 同屏** — 陈旧 CI_TAG 场景曾先 FAIL 又 ok。修法：mismatch 时设
CI_TAG_RESOLVED=mismatch 跳过后续名字比较。

**⑥ [NIT] 多 tag 取字母序第一个** — 修法：本地回退优先 `grep -x EXPECTED_TAG`。

## 你要回答的核心问题

1. 你的 ①(a)(b)、③、⑤ 三个反例，在 bf678cb7 上是否**真的**都修好了？请实跑复现。
2. ② 的突变验证是否成立（新场景 9/10/11 真的在守行为，不是假绿）？
3. bf678cb7 有没有**新引入**的缺陷？特别是：
   - `die_unknown` 会不会在正常发布路径误触发（比如浅克隆、正常 tag push）？
   - `--show-toplevel == ROOT` 的字符串比较在 Git Bash（POSIX vs mixed 路径）下可靠吗？
     会不会因路径格式差异把正常发布误判为「不是本仓库根」？
   - branch 路径的 `git tag --points-at HEAD | grep -qx EXPECTED_TAG` 在多 tag / 无 tag
     下的行为是否正确？
4. gate 测试 156/0 是否属实？`bash -n` + YAML 是否通过？

## 只读评审：不要改文件、不要提交、不要打 tag、不要 push。
可实跑守卫与 gate 测试（都只读）。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
