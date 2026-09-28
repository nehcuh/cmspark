kimi version 0.42.0
• Let me start the adversarial review. First, look at the diff and files.cc48a924 feat(release): 落地 #547 的防复发机制 — 拒绝产出「同版本号两份二进制」
c8d3741f Merge pull request #551 from nehcuh/release/cut-0.6.10
6605f033 docs(changelog): 更正 #548 熔断时序措辞 — 是第 3 次点击前拦截，非第 2 次
 M .gitignore
?? .alma/
?? docs/audit/reviews/069-pull-20260927/pr-551-grok.md
?? docs/audit/reviews/069-pull-20260927/pr-551-kimi.md
?? docs/audit/reviews/069-pull-20260927/pr-551-pi-recheck.md
?? docs/audit/reviews/069-pull-20260927/pr-551-pi-recheck2-prompt.md
?? docs/audit/reviews/069-pull-20260927/pr-551-pi-recheck2.md
?? docs/audit/reviews/069-pull-20260927/pr-551-recheck-prompt.md
?? docs/audit/reviews/069-pull-20260927/pr-551-release-prompt.md
?? docs/audit/reviews/069-pull-20260927/pr-553-grok.md
?? docs/audit/reviews/069-pull-20260927/pr-553-kimi.md
?? docs/audit/reviews/069-pull-20260927/pr-553-review-prompt.md
?? docs/audit/reviews/502-punchlist-20260919/code-310-dual-grok.md
?? docs/audit/reviews/502-punchlist-20260919/code-310-dual-kimi.md
?? docs/audit/reviews/502-punchlist-20260919/code-310-dual-prompt.md
?? docs/audit/reviews/502-punchlist-20260919/folder-pick-dual-kimi.md
?? docs/audit/reviews/502-punchlist-20260919/folder-pick-dual-prompt.md
?? docs/audit/reviews/502-punchlist-20260919/issue-coding-monitor-stop-enter.md
?? docs/audit/reviews/502-punchlist-20260919/issue-l1-bounded-action-space.md
?? docs/audit/reviews/502-punchlist-20260919/pr-512-body.md
commit cc48a92479ac0835f1bd1405392066dbcfe6eb8d
Author: HuChen <huchen@cmspark.dev>
Date:   Mon Sep 28 17:21:03 2026 +0800

    feat(release): 落地 #547 的防复发机制 — 拒绝产出「同版本号两份二进制」
    
    Closes #552
    
    #547 的教训：v0.6.9 tag 停在 488252bf，但 main 上又多了 3 个提交、版本锚仍写
    0.6.9，于是从 tag 和从 main 打出的包版本号相同、内容不同，无法区分。本次工作流
    中操作者就真实地从 b5a7396a 打出了 CMspark-Setup-v0.6.9.exe。#547 把「防复发
    机制」列为本票核心，PR #551 只修了具体脱节，机制一行没写 —— pi 据此 REJECT 两次。
    本提交把机制补上。
    
    新增 scripts/release-guard.sh，三条断言（默认 fail-closed）：
    1. 工作树干净（只看 tracked；untracked 的评审归档/本地草稿不算脏，否则本机永远
       打不了包）
    2. HEAD 的 tag == v$(companion/package.json version)
    3. CHANGELOG 的 [Unreleased] 段为空（归档必须在打 tag 前完成）
    
    集成：
    - scripts/package.sh 在算出 ZIP_NAME 后调用守卫；GATE_ONLY（ci.yml 的静态断言
      快路径，不产出发布物）跳过
    - .github/workflows/release.yml 的 preflight 与 package 两个 job 都设
      CMSPARK_RELEASE_STRICT=1 + CMSPARK_RELEASE_TAG=${{ github.ref_name }}
      preflight 里放在装依赖**之前**，让脱节的发布几十秒内失败，不白跑完整测试
    
    与 #547 原文的两处刻意偏离（都写进了脚本注释）：
    - tag 来源用 workflow context 的 github.ref_name，**不用** git describe
      --exact-match HEAD：actions/checkout@v4 默认 fetch-depth=1，浅克隆里 tag
      对象不一定存在，会把正常发布误判为失败。本地无该变量时才回退到
      git tag --points-at HEAD。
    - 不做「产物版本后缀降级为 -dev.<sha>」：release.yml 的产物 glob 是
      CMspark-Setup-v*.exe / cmspark-*.zip 且 fail_on_unmatched_files: true，
      而 installer.nsi:99 把 PRODUCT_VERSION 写进注册表 DisplayVersion，带后缀
      会让它变成非数字。风险大于收益，改用 strict 硬失败 + 本机豁免开关。
    
    豁免设计（本机试装是合法需求）：
    - CMSPARK_ALLOW_UNTAGGED=1 放行「HEAD 无 tag」
    - CMSPARK_ALLOW_DIRTY=1    放行「工作树不干净」
    - 两者沿用 build-windows-exe.ps1 里 CMSPARK_ALLOW_VERSION_DRIFT 的既有惯例
    - **tag 不匹配永远硬失败，豁免不得覆盖** —— 那不是环境限制而是真错误，正是
      #547 的核心失效模式
    - CMSPARK_RELEASE_STRICT=1 下两个豁免全部失效
    - 附带效果：workflow_dispatch 手跑 release 时 ref_name 是分支名 → tag 断言
      失败 → 拒绝发布。正式版必须由 tag push 产生，这是期望行为
    
    测试：scripts/tests/test-package-gates.sh 新增 9 条静态断言 + 12 条动态断言
    （125 → 146 passed / 0 failed）。动态断言用**临时 git repo** 造场景而非弄脏
    真实仓库，否则结果取决于本机工作树是否恰好干净、CI 与本机结论会不一致。
    六路径：干净+正确 tag 通过 / tag 不匹配拒绝（含豁免全开） / 无 tag 默认拒绝
    ·豁免放行·strict 拒绝 / 脏树默认拒绝·豁免放行·strict 拒绝 / Unreleased 非空
    拒绝 / CMSPARK_RELEASE_TAG 匹配与不匹配。
    
    并做了两轮反证确认这些断言真的在守行为、不是假绿：
    - 把 STRICT 赋值改空（字样保留，静态断言仍绿）→ 恰好 2 条 strict 动态断言变红
    - 把 tag 不匹配分支改成永假 → 恰好 3 条 tag 动态断言变红
    - 还原后 146/0
    （评审反复批评过「新路径零覆盖」，B1 的 releaseIdleWorkerLeases 正因如此才带着
    缺陷合入，故此处不留同样缺口。）
    
    踩坑记录：守卫第一版用 node -p "require('${ROOT}/...')" 读版本，在 Git Bash 下
    失败 —— ROOT 是 /c/... POSIX 形式，Windows 版 node 的 require() 解析不了
    （MODULE_NOT_FOUND）。已按 package.sh 的 to_mixed() 同一处理转成 C:/... 形式。

 .github/workflows/release.yml       |  14 ++++
 scripts/package.sh                  |  10 +++
 scripts/release-guard.sh            | 142 ++++++++++++++++++++++++++++++++++++
 scripts/tests/test-package-gates.sh |  94 ++++++++++++++++++++++++
 4 files changed, 260 insertions(+)
    feat(release): 落地 #547 的防复发机制 — 拒绝产出「同版本号两份二进制」
    
    Closes #552
    
    #547 的教训：v0.6.9 tag 停在 488252bf，但 main 上又多了 3 个提交、版本锚仍写
    0.6.9，于是从 tag 和从 main 打出的包版本号相同、内容不同，无法区分。本次工作流
    中操作者就真实地从 b5a7396a 打出了 CMspark-Setup-v0.6.9.exe。#547 把「防复发
    机制」列为本票核心，PR #551 只修了具体脱节，机制一行没写 —— pi 据此 REJECT 两次。
    本提交把机制补上。
    
    新增 scripts/release-guard.sh，三条断言（默认 fail-closed）：
    1. 工作树干净（只看 tracked；untracked 的评审归档/本地草稿不算脏，否则本机永远
       打不了包）
    2. HEAD 的 tag == v$(companion/package.json version)
    3. CHANGELOG 的 [Unreleased] 段为空（归档必须在打 tag 前完成）
    
    集成：
    - scripts/package.sh 在算出 ZIP_NAME 后调用守卫；GATE_ONLY（ci.yml 的静态断言
      快路径，不产出发布物）跳过
    - .github/workflows/release.yml 的 preflight 与 package 两个 job 都设
      CMSPARK_RELEASE_STRICT=1 + CMSPARK_RELEASE_TAG=${{ github.ref_name }}
      preflight 里放在装依赖**之前**，让脱节的发布几十秒内失败，不白跑完整测试
    
    与 #547 原文的两处刻意偏离（都写进了脚本注释）：
    - tag 来源用 workflow context 的 github.ref_name，**不用** git describe
      --exact-match HEAD：actions/checkout@v4 默认 fetch-depth=1，浅克隆里 tag
      对象不一定存在，会把正常发布误判为失败。本地无该变量时才回退到
      git tag --points-at HEAD。
    - 不做「产物版本后缀降级为 -dev.<sha>」：release.yml 的产物 glob 是
      CMspark-Setup-v*.exe / cmspark-*.zip 且 fail_on_unmatched_files: true，
      而 installer.nsi:99 把 PRODUCT_VERSION 写进注册表 DisplayVersion，带后缀
      会让它变成非数字。风险大于收益，改用 strict 硬失败 + 本机豁免开关。
    
    豁免设计（本机试装是合法需求）：
    - CMSPARK_ALLOW_UNTAGGED=1 放行「HEAD 无 tag」
    - CMSPARK_ALLOW_DIRTY=1    放行「工作树不干净」
    - 两者沿用 build-windows-exe.ps1 里 CMSPARK_ALLOW_VERSION_DRIFT 的既有惯例
    - **tag 不匹配永远硬失败，豁免不得覆盖** —— 那不是环境限制而是真错误，正是
      #547 的核心失效模式
    - CMSPARK_RELEASE_STRICT=1 下两个豁免全部失效
    - 附带效果：workflow_dispatch 手跑 release 时 ref_name 是分支名 → tag 断言
      失败 → 拒绝发布。正式版必须由 tag push 产生，这是期望行为
    
    测试：scripts/tests/test-package-gates.sh 新增 9 条静态断言 + 12 条动态断言
    （125 → 146 passed / 0 failed）。动态断言用**临时 git repo** 造场景而非弄脏
    真实仓库，否则结果取决于本机工作树是否恰好干净、CI 与本机结论会不一致。
    六路径：干净+正确 tag 通过 / tag 不匹配拒绝（含豁免全开） / 无 tag 默认拒绝
    ·豁免放行·strict 拒绝 / 脏树默认拒绝·豁免放行·strict 拒绝 / Unreleased 非空
    拒绝 / CMSPARK_RELEASE_TAG 匹配与不匹配。
    
    并做了两轮反证确认这些断言真的在守行为、不是假绿：
    - 把 STRICT 赋值改空（字样保留，静态断言仍绿）→ 恰好 2 条 strict 动态断言变红
    - 把 tag 不匹配分支改成永假 → 恰好 3 条 tag 动态断言变红
    - 还原后 146/0
    （评审反复批评过「新路径零覆盖」，B1 的 releaseIdleWorkerLeases 正因如此才带着
    缺陷合入，故此处不留同样缺口。）
    
    踩坑记录：守卫第一版用 node -p "require('${ROOT}/...')" 读版本，在 Git Bash 下
    失败 —— ROOT 是 /c/... POSIX 形式，Windows 版 node 的 require() 解析不了
    （MODULE_NOT_FOUND）。已按 package.sh 的 to_mixed() 同一处理转成 C:/... 形式。

diff --git a/scripts/release-guard.sh b/scripts/release-guard.sh
new file mode 100644
index 00000000..87885601
--- /dev/null
+++ b/scripts/release-guard.sh
@@ -0,0 +1,142 @@
+#!/usr/bin/env bash
+# release-guard.sh — #552: 防止「同版本号两份二进制」复发（#547 的本票核心）。
+#
+# #547 的教训：v0.6.9 tag 停在 488252bf，但 main 上又多了 3 个提交、版本锚仍写
+# 0.6.9，于是从 tag 和从 main 打出来的包版本号相同、内容不同，无法区分。
+# 操作者本次就真实地从 b5a7396a 打出了 CMspark-Setup-v0.6.9.exe。
+#
+# 三条断言（默认 fail-closed）：
+#   1. 工作树干净（tracked）—— 未提交改动不得混进「正式版」
+#   2. HEAD 的 tag == v"$(companion/package.json version)
+#   3. CHANGELOG 的 [Unreleased] 段为空 —— 归档必须在打 tag 前完成
+#
+# 设计要点（与 #547 原文的偏离及理由）：
+#   - tag 来源优先用 CMSPARK_RELEASE_TAG（release.yml 传 github.ref_name）。
+#     **不能**只靠 git describe --exact-match HEAD：actions/checkout@v4 默认
+#     fetch-depth=1，浅克隆里 tag 对象不一定存在，会把正常发布误判为失败。
+#     本地无该变量时回退到 git tag --points-at HEAD。
+#   - 本机试装是合法需求，故有两个独立豁免开关（沿用 build-windows-exe.ps1
+#     里 CMSPARK_ALLOW_VERSION_DRIFT 的既有惯例）：
+#       CMSPARK_ALLOW_UNTAGGED=1  放行「HEAD 无 tag」
+#       CMSPARK_ALLOW_DIRTY=1     放行「工作树不干净」
+#     豁免只影响这两条，tag **不匹配**永远硬失败（那是真错误，不是环境限制）。
+#   - release.yml 设 CMSPARK_RELEASE_STRICT=1：两个豁免开关全部失效，一律硬失败。
+#   - workflow_dispatch 手跑 release 时 github.ref_name 是分支名 → tag 断言失败
+#     → 拒绝发布。这是期望行为（正式版必须由 tag push 产生）。
+#
+# Usage: bash scripts/release-guard.sh
+# Exit:  0 通过（含豁免通过）· 1 断言失败
+set -uo pipefail
+
+SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
+ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
+cd "${ROOT}" || exit 1
+
+# Git Bash 下 ROOT 是 /c/... POSIX 形式，Windows 版 node 的 require() 解析不了
+# （MODULE_NOT_FOUND）。转 mixed 形式 C:/... —— 与 package.sh 的 to_mixed 同一
+# 处理；macOS/Linux 上 cygpath 不存在，原样返回。
+to_mixed() {
+  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf "%s" "$1"; fi
+}
+ROOT_MIXED="$(to_mixed "${ROOT}")"
+
+STRICT="${CMSPARK_RELEASE_STRICT:-}"
+ALLOW_UNTAGGED="${CMSPARK_ALLOW_UNTAGGED:-}"
+ALLOW_DIRTY="${CMSPARK_ALLOW_DIRTY:-}"
+CI_TAG="${CMSPARK_RELEASE_TAG:-}"
+
+FAIL=0
+fail() {
+  FAIL=$((FAIL + 1))
+  echo "  FAIL: $1" >&2
+  if [ -n "${2:-}" ]; then echo "        $2" >&2; fi
+  return 0
+}
+ok() { echo "  ok: $1"; }
+warn() { echo "  WARN: $1" >&2; }
+
+# --- 版本 SoT ------------------------------------------------------------
+VERSION="$(node -p "require('${ROOT_MIXED}/companion/package.json').version" 2>/dev/null || true)"
+if [ -z "${VERSION}" ]; then
+  echo "[release-guard] ERROR: 读不到 companion/package.json 的 version" >&2
+  exit 1
+fi
+EXPECTED_TAG="v${VERSION}"
+echo "[release-guard] version SoT = ${VERSION} → expected tag ${EXPECTED_TAG}"
+echo "[release-guard] strict=${STRICT:-off} allow_untagged=${ALLOW_UNTAGGED:-off} allow_dirty=${ALLOW_DIRTY:-off} ci_tag=${CI_TAG:-none}"
+
+# --- 1. 工作树干净（只看 tracked）---------------------------------------
+# untracked 的评审归档 / 本地草稿不算脏，否则本机永远打不了包。
+DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
+if [ -n "${DIRTY}" ]; then
+  DIRTY_HEAD="$(printf '%s' "${DIRTY}" | head -8 | tr '\n' '; ')"
+  if [ -n "${STRICT}" ]; then
+    fail "strict 模式：工作树有未提交的 tracked 改动" "${DIRTY_HEAD}"
+  elif [ -n "${ALLOW_DIRTY}" ]; then
+    warn "工作树不干净，CMSPARK_ALLOW_DIRTY=1 → 放行（本机试装）"
+    warn "产物含未提交改动，不得对外分发。${DIRTY_HEAD}"
+    ok "豁免通过（dirty）"
+  else
+    fail "工作树有未提交的 tracked 改动，不得打进正式版" "${DIRTY_HEAD}"
+    echo "        本机试装可设 CMSPARK_ALLOW_DIRTY=1 显式豁免" >&2
+  fi
+else
+  ok "工作树干净（tracked）"
+fi
+
+# --- 2. HEAD 的 tag 与版本锚一致 -----------------------------------------
+HEAD_TAG=""
+if [ -n "${CI_TAG}" ]; then
+  HEAD_TAG="${CI_TAG}"
+  echo "  (tag 来源: CMSPARK_RELEASE_TAG)"
+else
+  HEAD_TAG="$(git tag --points-at HEAD 2>/dev/null | head -1 || true)"
+  echo "  (tag 来源: git tag --points-at HEAD)"
+fi
+
+if [ -z "${HEAD_TAG}" ]; then
+  if [ -n "${STRICT}" ]; then
+    fail "strict 模式：HEAD 不在任何 tag 上（需要 ${EXPECTED_TAG}）" \
+         "正式发布必须由 tag push 触发；workflow_dispatch 手跑请先打 tag"
+  elif [ -n "${ALLOW_UNTAGGED}" ]; then
+    warn "HEAD 不在 tag 上，CMSPARK_ALLOW_UNTAGGED=1 → 放行（本机试装）"
+    warn "产物**不是**正式 ${EXPECTED_TAG} 发布物，不得对外分发"
+    ok "豁免通过（untagged）"
+  else
+    fail "HEAD 不在任何 tag 上（需要 ${EXPECTED_TAG}）" \
+         "本机试装请显式设 CMSPARK_ALLOW_UNTAGGED=1；正式发布请先打 tag"
+  fi
+elif [ "${HEAD_TAG}" != "${EXPECTED_TAG}" ]; then
+  # 不匹配永远硬失败：这不是环境限制，而是版本锚与 tag 真的对不上，
+  # 正是 #547「同版本号两份二进制」的成因。豁免开关不得覆盖此条。
+  fail "HEAD 的 tag 是 ${HEAD_TAG}，但 package.json 版本是 ${VERSION}（应为 ${EXPECTED_TAG}）" \
+       "版本锚与 tag 不一致 → 会产出与已发布 ${HEAD_TAG} 同号但内容不同的包"
+else
+  ok "HEAD tag == ${EXPECTED_TAG}"
+fi
+
+# --- 3. [Unreleased] 段必须为空 ------------------------------------------
+CHANGELOG="${ROOT_MIXED}/CHANGELOG.md"
+if [ ! -f "${CHANGELOG}" ]; then
+  fail "找不到 CHANGELOG.md"
+else
+  UNREL="$(awk '
+    /^## \[Unreleased\]/ { inblk=1; next }
+    /^## / && inblk { exit }
+    inblk && NF { line=$0; gsub(/^[ \t]+|[ \t]+$/, "", line); if (line != "") print line }
+  ' "${CHANGELOG}")"
+  if [ -n "${UNREL}" ]; then
+    fail "CHANGELOG 的 [Unreleased] 段非空 —— 打 tag 前必须归档到正式版本段" \
+         "$(printf '%s' "${UNREL}" | head -3 | cut -c1-90 | tr '\n' '; ')"
+  else
+    ok "[Unreleased] 段为空"
+  fi
+fi
+
+# --- 结果 ----------------------------------------------------------------
+if [ "${FAIL}" -gt 0 ]; then
+  echo "[release-guard] ${FAIL} 条断言失败 → 拒绝打包（#552 / #547 防复发）" >&2
+  exit 1
+fi
+echo "[release-guard] 全部通过"
+exit 0
    feat(release): 落地 #547 的防复发机制 — 拒绝产出「同版本号两份二进制」
    
    Closes #552
    
    #547 的教训：v0.6.9 tag 停在 488252bf，但 main 上又多了 3 个提交、版本锚仍写
    0.6.9，于是从 tag 和从 main 打出的包版本号相同、内容不同，无法区分。本次工作流
    中操作者就真实地从 b5a7396a 打出了 CMspark-Setup-v0.6.9.exe。#547 把「防复发
    机制」列为本票核心，PR #551 只修了具体脱节，机制一行没写 —— pi 据此 REJECT 两次。
    本提交把机制补上。
    
    新增 scripts/release-guard.sh，三条断言（默认 fail-closed）：
    1. 工作树干净（只看 tracked；untracked 的评审归档/本地草稿不算脏，否则本机永远
       打不了包）
    2. HEAD 的 tag == v$(companion/package.json version)
    3. CHANGELOG 的 [Unreleased] 段为空（归档必须在打 tag 前完成）
    
    集成：
    - scripts/package.sh 在算出 ZIP_NAME 后调用守卫；GATE_ONLY（ci.yml 的静态断言
      快路径，不产出发布物）跳过
    - .github/workflows/release.yml 的 preflight 与 package 两个 job 都设
      CMSPARK_RELEASE_STRICT=1 + CMSPARK_RELEASE_TAG=${{ github.ref_name }}
      preflight 里放在装依赖**之前**，让脱节的发布几十秒内失败，不白跑完整测试
    
    与 #547 原文的两处刻意偏离（都写进了脚本注释）：
    - tag 来源用 workflow context 的 github.ref_name，**不用** git describe
      --exact-match HEAD：actions/checkout@v4 默认 fetch-depth=1，浅克隆里 tag
      对象不一定存在，会把正常发布误判为失败。本地无该变量时才回退到
      git tag --points-at HEAD。
    - 不做「产物版本后缀降级为 -dev.<sha>」：release.yml 的产物 glob 是
      CMspark-Setup-v*.exe / cmspark-*.zip 且 fail_on_unmatched_files: true，
      而 installer.nsi:99 把 PRODUCT_VERSION 写进注册表 DisplayVersion，带后缀
      会让它变成非数字。风险大于收益，改用 strict 硬失败 + 本机豁免开关。
    
    豁免设计（本机试装是合法需求）：
    - CMSPARK_ALLOW_UNTAGGED=1 放行「HEAD 无 tag」
    - CMSPARK_ALLOW_DIRTY=1    放行「工作树不干净」
    - 两者沿用 build-windows-exe.ps1 里 CMSPARK_ALLOW_VERSION_DRIFT 的既有惯例
    - **tag 不匹配永远硬失败，豁免不得覆盖** —— 那不是环境限制而是真错误，正是
      #547 的核心失效模式
    - CMSPARK_RELEASE_STRICT=1 下两个豁免全部失效
    - 附带效果：workflow_dispatch 手跑 release 时 ref_name 是分支名 → tag 断言
      失败 → 拒绝发布。正式版必须由 tag push 产生，这是期望行为
    
    测试：scripts/tests/test-package-gates.sh 新增 9 条静态断言 + 12 条动态断言
    （125 → 146 passed / 0 failed）。动态断言用**临时 git repo** 造场景而非弄脏
    真实仓库，否则结果取决于本机工作树是否恰好干净、CI 与本机结论会不一致。
    六路径：干净+正确 tag 通过 / tag 不匹配拒绝（含豁免全开） / 无 tag 默认拒绝
    ·豁免放行·strict 拒绝 / 脏树默认拒绝·豁免放行·strict 拒绝 / Unreleased 非空
    拒绝 / CMSPARK_RELEASE_TAG 匹配与不匹配。
    
    并做了两轮反证确认这些断言真的在守行为、不是假绿：
    - 把 STRICT 赋值改空（字样保留，静态断言仍绿）→ 恰好 2 条 strict 动态断言变红
    - 把 tag 不匹配分支改成永假 → 恰好 3 条 tag 动态断言变红
    - 还原后 146/0
    （评审反复批评过「新路径零覆盖」，B1 的 releaseIdleWorkerLeases 正因如此才带着
    缺陷合入，故此处不留同样缺口。）
    
    踩坑记录：守卫第一版用 node -p "require('${ROOT}/...')" 读版本，在 Git Bash 下
    失败 —— ROOT 是 /c/... POSIX 形式，Windows 版 node 的 require() 解析不了
    （MODULE_NOT_FOUND）。已按 package.sh 的 to_mixed() 同一处理转成 C:/... 形式。

diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
index 13afe635..883053af 100644
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -32,6 +32,16 @@ jobs:
           cache-dependency-path: |
             companion/package-lock.json
             chrome-extension/package-lock.json
+      # #552 / #547 防复发：正式版必须由 tag 产出，且版本锚与 tag 一致。
+      # 放在装依赖之前，好让脱节的发布在几十秒内失败，而不是白跑完整测试。
+      # CMSPARK_RELEASE_TAG 用 workflow context 而非 git describe：
+      # actions/checkout@v4 默认 fetch-depth=1，浅克隆里 tag 对象不一定存在。
+      - name: Release guard (tag == version anchor, clean tree, Unreleased archived)
+        env:
+          CMSPARK_RELEASE_STRICT: "1"
+          CMSPARK_RELEASE_TAG: ${{ github.ref_name }}
+        run: bash scripts/release-guard.sh
+
       - name: Install companion deps
         run: cd companion && npm ci
       - name: Build companion
@@ -105,6 +115,10 @@ jobs:
         shell: bash
         env:
           CMSPARK_REQUIRE_NSIS: ${{ matrix.platform == 'windows-x64' && '1' || '' }}
+          # package.sh 内部会再跑一次 release-guard.sh；strict 下豁免开关失效，
+          # 三个平台的打包都必须来自正确的 tag（#552）。
+          CMSPARK_RELEASE_STRICT: "1"
+          CMSPARK_RELEASE_TAG: ${{ github.ref_name }}
         run: bash scripts/package.sh ${{ matrix.platform }}
 
       # P0-D fail-closed content asserts — package.sh already gates at stage time;
diff --git a/scripts/package.sh b/scripts/package.sh
index 09e72384..ab368371 100755
--- a/scripts/package.sh
+++ b/scripts/package.sh
@@ -62,6 +62,16 @@ STAGING="${ROOT_DIR}/dist-package/cmspark-${PLATFORM}"
 CACHE_DIR="${ROOT_DIR}/dist-package/.cache"
 ZIP_NAME="cmspark-v${VERSION}-${PLATFORM}.zip"
 
+# --- Release guard (#552 / #547 防复发) ----------------------------------
+# 拒绝产出「与已发布 tag 同号但内容不同」的包：断言工作树干净、HEAD 的 tag 与
+# package.json 版本一致、CHANGELOG [Unreleased] 已归档。tag 不匹配永远硬失败；
+# dirty / untagged 可分别用 CMSPARK_ALLOW_DIRTY / CMSPARK_ALLOW_UNTAGGED 豁免
+# （本机试装）。CMSPARK_RELEASE_STRICT=1（release.yml 用）下豁免失效。
+# GATE_ONLY 是 ci.yml 的静态断言快路径，不产出发布物，跳过守卫。
+if [ "${CMSPARK_PACKAGE_GATE_ONLY:-}" != "1" ]; then
+  bash "${ROOT_DIR}/scripts/release-guard.sh" || exit 1
+fi
+
 # Experimental locate layer is Qwen3-VL (on-demand model + Python env under
 # ~/.cmspark-agent/); the legacy TinyClick ONNX worker is product-replaced and
 # NOT staged. onnxruntime-node IS staged (#260 speaker diarize — 本机声纹
Now let me look at the test file additions and the existing package.sh context, then run the guard and the gate tests.

  Key things to verify:
  1. Run the guard script on the repo (HEAD has no tag presumably; also .gitignore is modified → dirty).
  2. Run gate tests.
  3. Check awk CRLF handling: CHANGELOG.md is CRLF. The awk pattern `/^## /` — with CRLF, lines end with `\r`. `^## ` matches regardless of trailing \r. But `/^## \[Unreleased\]/` also matches. The issue: `NF` — awk counts fields; a line with just `\r` has NF=1 (the \r is part of a field? Actually `$0` = "\r", FS default splits on whitespace... \r is not a field separator in default awk FS? Default FS is space/tab/newline... Actually awk's default field splitting treats whitespace as spaces, tabs, and newlines; carriage return IS treated as whitespace? In POSIX awk, <space>, <tab>, <newline> are field separators. \r is not included! So a line "\r" has NF=1 with $1="\r". Then `inblk && NF` is true, gsub strips only spaces/tabs, line="\r" != "" → prints "\r" → UNREL non-empty → false failure!

  Wait, let me check: gawk and mawk treat \r as whitespace in default field splitting? POSIX says FS default is <space><tab><newline>... actually POSIX defines "white space" for default FS to include space and tab (and newline stripped already). Hmm. Historical awk: fields separated by blanks (spaces and tabs). gawk manual: "fields are separated by runs of spaces and/or tabs". \r is NOT included. BUT — this awk is running under Git Bash on Windows, which ships gawk. Does gawk's RS="\n" leave \r in $0? Yes on Unix-style reading. Under Git Bash, files with CRLF — awk reads lines ending in \n, leaving \r at end of $0.

  So for a CRLF CHANGELOG: blank line is "\r" (just CR). NF: gawk default splitting — does \r count as whitespace? Let me test. Actually there's a known gotcha: `\r` is not whitespace in awk field splitting by default. But the code does `inblk && NF { line=$0; gsub(...); if (line != "") print line }`. For a "\r" line, NF>=1 (field "\r"), gsub of spaces/tabs doesn't strip \r, so line = "\r" ≠ "" → printed. UNREL would contain "\r" → non-empty → FAIL even when section is empty!

  Hmm wait, but does NF treat "\r" as a field? Default FS = " " (space) which is special: strips leading/trailing whitespace including... In the special case FS=" ", fields are separated by runs of spaces/tabs/newlines, leading/trailing stripped. \r is NOT part of that set per POSIX. But let me just test it on this machine — I can run awk directly.

  Actually wait — but also `/^## /` boundary: a CRLF section heading "## [0.6.10] ...\r" still matches `^## `. Fine.

  But the empty-section detection might be broken for CRLF. The prompt explicitly asks: "它对 CRLF 行尾（本仓库 CHANGELOG.md 是 CRLF）能正确识别段边界吗？" Let me check whether CHANGELOG.md is actually CRLF, and test.

  Also `head -1` on `git tag --points-at HEAD` — if multiple tags point at HEAD, takes first; if the first isn't the version tag but another tag matches... e.g., HEAD has tags "v0.6.10" and "foo". head -1 might give "foo" → mismatch → false failure. Ordering of git tag --points-at is by tag name? Sorted lexically I think. Edge case, minor.

  Another issue: in the tag check, when CI_TAG is set from workflow_dispatch, ref_name = branch name like "main" → mismatch hard fail. Intended.

  `git status --porcelain --untracked-files=no` — ok.

  Missing `-e`: commands like `git status` guarded with `|| true`. node version read guarded and exits 1 if empty. OK.

  But wait — VERSION read: `node -p "require('${ROOT_MIXED}/companion/package.json').version" 2>/dev/null || true`. If node missing → empty → exit 1. Good.

  Check the guard's tag-mismatch branch is outside exemption checks: yes, `elif [ "${HEAD_TAG}" != "${EXPECTED_TAG}" ]` calls fail unconditionally. Verified by reading.

  Strict priority: in dirty branch, strict checked first. In untagged branch, strict first. Good.

  Now the CRLF concern — let me actually test with the real CHANGELOG.md.

  Also check test file. And check ci.yml path for GATE_ONLY. And check other packaging entry points (build-windows-installer.sh etc.) bypassing guard.

  Let me run things.

• Diff read. Now let me actually run the guard and inspect the test additions.[release-guard] version SoT = 0.6.10 → expected tag v0.6.10
[release-guard] strict=off allow_untagged=off allow_dirty=off ci_tag=none
  FAIL: 工作树有未提交的 tracked 改动，不得打进正式版
         M .gitignore
        本机试装可设 CMSPARK_ALLOW_DIRTY=1 显式豁免
  (tag 来源: git tag --points-at HEAD)
  FAIL: HEAD 不在任何 tag 上（需要 v0.6.10）
        本机试装请显式设 CMSPARK_ALLOW_UNTAGGED=1；正式发布请先打 tag
  ok: [Unreleased] 段为空
[release-guard] 2 条断言失败 → 拒绝打包（#552 / #547 防复发）
rc=1
+++ b/scripts/tests/test-package-gates.sh
+# --- #552: release-guard.sh 六路径行为（防「同版本号两份二进制」复发）-----
+# 用**临时 git repo** 造场景，而不是弄脏真实仓库 —— 否则测试结果取决于本机
+# 工作树是否恰好干净，CI 与本机结论会不一致。
+RELEASE_GUARD="${ROOT}/scripts/release-guard.sh"
+assert_file_has "${RELEASE_GUARD}" 'CMSPARK_RELEASE_STRICT' \
+  "release-guard.sh 支持 strict 模式（豁免开关失效）"
+assert_file_has "${RELEASE_GUARD}" 'CMSPARK_RELEASE_TAG' \
+  "release-guard.sh 用 workflow context 取 tag（浅克隆下 git describe 不可靠）"
+assert_file_has "${RELEASE_GUARD}" 'points-at HEAD' \
+  "release-guard.sh 本地回退到 git tag --points-at HEAD"
+assert_file_has "${RELEASE_GUARD}" '豁免开关不得覆盖此条' \
+  "release-guard.sh 注明 tag 不匹配不受豁免覆盖（#547 核心失效模式）"
+assert_file_has "${PACKAGE_SH}" 'release-guard\.sh' \
+  "package.sh 调用 release-guard.sh"
+assert_file_has "${PACKAGE_SH}" 'CMSPARK_PACKAGE_GATE_ONLY:-\}" != "1"' \
+  "package.sh 在 GATE_ONLY（ci.yml 静态断言快路径）下跳过守卫"
+assert_file_has "${RELEASE_YML}" 'CMSPARK_RELEASE_STRICT' \
+  "release.yml 启用 strict 模式"
+assert_file_has "${RELEASE_YML}" 'CMSPARK_RELEASE_TAG:' \
+  "release.yml 传 tag 来源"
+assert_file_has "${RELEASE_YML}" 'github\.ref_name' \
+  "release.yml 用 github.ref_name（不依赖浅克隆里的 tag 对象）"
+
+echo "[dynamic] release-guard.sh 六路径行为（临时 git repo）"
+if command -v node >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
+  RG_TMP="$(mktemp -d)"
+  # $1=version — 造最小 repo：守卫脚本 + companion/package.json + CHANGELOG.md
+  rg_setup() {
+    rm -rf "${RG_TMP}/repo" 2>/dev/null || true
+    mkdir -p "${RG_TMP}/repo/scripts" "${RG_TMP}/repo/companion"
+    cp "${RELEASE_GUARD}" "${RG_TMP}/repo/scripts/release-guard.sh"
+    printf '{"name":"cmspark-agent","version":"%s"}\n' "$1" \
+      > "${RG_TMP}/repo/companion/package.json"
+    printf '# Changelog\n\n## [Unreleased]\n\n## [%s] - 2026-09-28\n\n- x\n' "$1" \
+      > "${RG_TMP}/repo/CHANGELOG.md"
+    ( cd "${RG_TMP}/repo" && git init -q . && git add -A \
+      && git -c user.email=t@t -c user.name=t commit -qm init ) >/dev/null 2>&1
+  }
+  # 在 repo 内跑守卫，只回传退出码。额外 env 以 KEY=VAL 形式传入。
+  rg_run() { ( cd "${RG_TMP}/repo" && env "$@" bash scripts/release-guard.sh >/dev/null 2>&1; echo $? ); }
+
+  # 1) 干净树 + 正确 tag → 通过
+  rg_setup 9.9.9
+  ( cd "${RG_TMP}/repo" && git tag v9.9.9 ) >/dev/null 2>&1
+  assert_eq "0" "$(rg_run PATH="$PATH")" \
+    "release-guard: 干净树 + tag==版本 → 通过"
+
+  # 2) tag 不匹配 → 硬失败，且豁免全开也不放过（#547 核心失效模式）
+  rg_setup 9.9.9
+  ( cd "${RG_TMP}/repo" && git tag v8.8.8 ) >/dev/null 2>&1
+  assert_eq "1" "$(rg_run PATH="$PATH")" \
+    "release-guard: tag(v8.8.8) != 版本(9.9.9) → 拒绝"
+  assert_eq "1" "$(rg_run PATH="$PATH" CMSPARK_ALLOW_UNTAGGED=1 CMSPARK_ALLOW_DIRTY=1)" \
+    "release-guard: tag 不匹配时豁免开关不得覆盖"
+
+  # 3) 无 tag：默认拒绝 / 豁免放行 / strict 拒绝
+  rg_setup 9.9.9
+  assert_eq "1" "$(rg_run PATH="$PATH")" \
+    "release-guard: HEAD 无 tag → 默认拒绝"
+  assert_eq "0" "$(rg_run PATH="$PATH" CMSPARK_ALLOW_UNTAGGED=1)" \
+    "release-guard: CMSPARK_ALLOW_UNTAGGED=1 → 本机试装放行"
+  assert_eq "1" "$(rg_run PATH="$PATH" CMSPARK_RELEASE_STRICT=1 CMSPARK_ALLOW_UNTAGGED=1)" \
+    "release-guard: strict 下 untagged 豁免失效"
+
+  # 4) 工作树脏：默认拒绝 / 豁免放行 / strict 拒绝
+  rg_setup 9.9.9
+  ( cd "${RG_TMP}/repo" && git tag v9.9.9 && echo dirty >> CHANGELOG.md ) >/dev/null 2>&1
+  assert_eq "1" "$(rg_run PATH="$PATH")" \
+    "release-guard: 工作树脏 → 默认拒绝"
+  assert_eq "0" "$(rg_run PATH="$PATH" CMSPARK_ALLOW_DIRTY=1)" \
+    "release-guard: CMSPARK_ALLOW_DIRTY=1 → 放行"
+  assert_eq "1" "$(rg_run PATH="$PATH" CMSPARK_RELEASE_STRICT=1 CMSPARK_ALLOW_DIRTY=1)" \
+    "release-guard: strict 下 dirty 豁免失效"
+
+  # 5) [Unreleased] 非空 → 拒绝（归档必须在打 tag 前完成）
+  rg_setup 9.9.9
+  ( cd "${RG_TMP}/repo" && git tag v9.9.9 \
+    && printf '# Changelog\n\n## [Unreleased]\n\n- 未归档变更\n\n## [9.9.9] - x\n' > CHANGELOG.md \
+    && git add -A && git -c user.email=t@t -c user.name=t commit -qm unrel ) >/dev/null 2>&1
+  assert_eq "1" "$(rg_run PATH="$PATH")" \
+    "release-guard: [Unreleased] 非空 → 拒绝"
+
+  # 6) CMSPARK_RELEASE_TAG（CI 路径，不依赖本地 tag 对象）
+  rg_setup 9.9.9
+  assert_eq "1" "$(rg_run PATH="$PATH" CMSPARK_RELEASE_TAG=v0.0.1)" \
+    "release-guard: CMSPARK_RELEASE_TAG 与版本不符 → 拒绝（workflow_dispatch 手跑分支）"
+  assert_eq "0" "$(rg_run PATH="$PATH" CMSPARK_RELEASE_TAG=v9.9.9)" \
+    "release-guard: CMSPARK_RELEASE_TAG 匹配 → 通过（不依赖浅克隆里的 tag 对象）"
+
+  rm -rf "${RG_TMP}" 2>/dev/null || true
+else
+  echo "  skip release-guard dynamic tests (node/git missing)"
+fi
+
CHANGELOG.md: Unicode text, UTF-8 text, with very long lines (738), with CRLF line terminators
# Changelog^M$
^M$
M-fM- M-<M-eM-<M-^OM-eM-$M-'M-hM-^GM-4M-iM-^AM-5M-eM->M-* [Keep a Changelog](https://keepachangelog.com/)M-cM-^@M-^BM-gM-^IM-^HM-fM-^\M-,M-eM-^OM-7M-dM-8M-^N `companion/package.json` / `chrome-extension/package.json` M-eM-/M-9M-iM-=M-^PM-cM-^@M-^B^M$
^M$
## [Unreleased]^M$
^M$
## [0.6.10] M-bM-^@M-^T 2026-09-28^M$
^M$
0.6.9 M-eM-^HM-^GM-gM-^BM-9M-dM-9M-^KM-eM-^PM-^NM-gM-^ZM-^DM-hM-!M-%M-dM-8M-^AM-oM-<M-^LM-eM-^PM-+ 0.6.9 M-fM-^KM-^IM-eM-^OM-^VM-fM-^IM-9M-fM-,M-!M-eM-$M-^ZM-hM-7M-/M-eM-/M-9M-fM-^JM-^WM-hM-/M-^DM-eM-.M-!M-hM-#M-^AM-eM-^GM-:M-gM-^ZM-^DM-dM-8M-^IM-fM-^]M-! BLOCKING M-dM-?M-.M-eM-$M-^MM-oM-<M-^H#544 / #545 / #546M-oM-<M-^LPR #549M-oM-<M-^IM-cM-^@M-^BM-gM-^IM-^HM-fM-^\M-,M-iM-^TM-^ZM-iM-=M-^P **0.6.10**M-cM-^@M-^BM-dM-8M-^MM-eM-^OM-+ 0.7.0M-cM-^@M-^B^M$
^M$
M-dM-;M-%M-dM-8M-^K 6 M-fM-^]M-!M-fM--M-$M-eM-^IM-^MM-eM-^FM-^YM-eM-^\M-( UnreleasedM-cM-^@M-^AM-eM-7M-2M-eM-^\M-( mainM-oM-<M-^H`ad7f0980` M-fM- M-^GM-gM--M->M-gM-'M-^_M-gM-:M-&M-cM-^@M-^A`b5a7396a` M-fM-^MM-"M-gM--M-^VM-gM-^UM-%M-oM-<M-^LM-dM-8M-$M-hM-^@M-^EM-iM-^CM-=M-fM-^YM-^ZM-dM-:M-^N v0.6.9 tagM-oM-<M-^IM-oM-<M-^LM-iM-^ZM-^O 0.6.10 M-eM-=M-^RM-fM-!M-#M-oM-<M-^Z^M$
^M$
- M-fM- M-^GM-gM--M->M-gM-^KM-,M-eM-^MM- M-fM-^TM-6M-gM-*M-^DM-oM-<M-^H#526M-oM-<M-^IM-oM-<M-^ZM-eM-$M-^ZM-dM-8M-* worker M-dM-8M-^@M-hM-5M-7M-gM-^\M-^KM-gM-=M-^QM-iM-!M-5M-fM-^WM-6M-oM-<M-^LM-eM-^OM-*M-fM-^\M-^IM-fM--M-#M-eM-^\M-(M-fM-^TM-9M-iM-!M-5M-iM-^]M-"M-gM-^ZM-^DM-iM-^BM-#M-dM-8M-^@M-dM-8M-^KM-fM-^IM-^MM-gM-^KM-,M-eM-^MM- M-fM- M-^GM-gM--M->M-cM-^@M-^BM-hM-/M-;M-fM--M-#M-fM-^VM-^GM-cM-^@M-^AM-hM-/M-; HTMLM-cM-^@M-^AM-gM--M-^IM-eM->M-^EM-eM-^EM-^CM-gM-4M- M-dM-8M-^MM-eM-^FM-^MM-eM-^MM- M-iM-^TM-^AM-oM-<M-^LM-dM-9M-^_M-eM-^OM-/M-dM-;M-%M-hM-/M-;M-eM-^HM-+M-dM-:M-:M-fM--M-#M-eM-^\M-(M-gM-^TM-(M-gM-^ZM-^DM-iM-!M-5M-iM-^]M-"M-cM-^@M-^BM-eM-^HM-^ZM-eM-^HM-^[M-eM-;M-:M-gM-^ZM-^DM-fM- M-^GM-gM--M->M-gM-^TM-1M-eM-^HM-^[M-eM-;M-:M-eM-.M-^CM-gM-^ZM-^D worker M-fM-^HM-^VM-gM-<M-^VM-fM-^NM-^RM-gM-:M-?M-gM-(M-^KM-gM-^KM-,M-eM-^MM-  60 M-gM-'M-^RM-oM-<M-^LM-fM-^HM-^VM-gM-^[M-4M-eM-^HM-0M-eM-.M-^CM-hM-^GM-*M-eM-7M-1M-gM-,M-,M-dM-8M-^@M-fM-,M-!M-fM-^HM-^PM-eM-^JM-^_M-hM-7M-3M-hM-=M-,M-cM-^@M-^BM-fM-^ZM-^BM-eM-^AM-^\M-dM-8M-^MM-eM-^FM-^MM-fM-^UM-4M-fM-.M-5M-eM-^MM- M-dM-=M-^OM-fM- M-^GM-gM--M->M-oM-<M-^[M-eM-7M-2M-gM-;M-^OM-gM-^BM-9M-dM-8M-^KM-eM-^NM-;M-gM-^ZM-^DM-dM-?M-.M-fM-^TM-9M-dM-<M-^ZM-dM-?M-^]M-fM-^LM-^AM-eM-^HM-0M-hM-?M-^YM-dM-8M-^@M-dM-8M-^KM-gM-;M-^SM-fM-^]M-^_M-cM-^@M-^B^M$
- M-gM-^BM-9M-dM-8M-^MM-eM-^HM-0M-iM-!M-5M-iM-^]M-"M-fM-^VM-^GM-eM--M-^WM-fM-^WM-6M-gM-^ZM-^DM-fM-^MM-"M-gM--M-^VM-gM-^UM-%M-oM-<M-^H`b5a7396a`M-oM-<M-^IM-oM-<M-^ZM-eM-^PM-^LM-dM-8M-^@M-eM-7M-%M-eM-^EM-7M-eM-^\M-(**M-dM-8M-^MM-eM-^PM-^L**M-gM-^[M-.M-fM- M-^GM-dM-8M-^JM-hM-?M-^^M-gM-;M--M-eM-$M-1M-hM-4M-%M-hM->M->M-iM-^XM-^HM-eM-^@M-<M-fM-^WM-6M-oM-<M-^LM-dM-<M-^ZM-fM-^OM-^PM-gM-$M-:M-fM-(M-!M-eM-^^M-^KM-fM-^TM-9M-eM-^NM-;M-hM-/M-;M-iM-!M-5M-iM-^]M-"M-cM-^@M-^AM-eM->M-^@M-dM-8M-^KM-fM-;M-^ZM-eM-^JM-(M-fM-^HM-^VM-fM-^PM-^\M-gM-4M-"M-oM-<M-^LM-hM-^@M-^LM-dM-8M-^MM-fM-^XM-/M-gM-;M-'M-gM-;M--M-eM-=M-^SM-fM-^LM-^IM-iM-^RM-.M-gM-^BM-9M-oM-<M-^[M-fM-^MM-"M-hM-?M-^GM-eM-^JM-^^M-fM-3M-^UM-hM-?M-^XM-eM-^\M-(M-iM-^GM-^MM-eM-$M-^MM-eM-^PM-^LM-dM-8M-^@M-eM-7M-%M-eM-^EM-7M-fM-^IM-^MM-eM-^AM-^\M-cM-^@M-^B**M-eM-7M-2M-gM-^_M-%M-iM-^YM-^PM-eM-^HM-6M-oM-<M-^H#548M-oM-<M-^I**M-oM-<M-^ZM-eM-^OM-^MM-eM-$M-^MM-gM-^BM-9**M-eM-^PM-^LM-dM-8M-^@M-eM-^OM-%**M-fM-^VM-^GM-eM--M-^WM-fM-^WM-6M-oM-<M-^LM-gM-+M-^YM-gM-^BM-9M-gM-^FM-^TM-fM-^VM--M-eM-^\M-(M-eM-^PM-^LM-dM-8M-^@ locator M-gM-4M-/M-hM-.M-! 2 M-fM-,M-!M-eM-$M-1M-hM-4M-%M-eM-^PM-^NM-cM-^@M-^AM-dM-:M-^N**M-gM-,M-, 3 M-fM-,M-!M-gM-^BM-9M-eM-^GM-;M-eM-^IM-^M**M-fM-^KM-&M-fM-^HM-*M-oM-<M-^H`SITE_OP_BANNED`M-oM-<M-^L`SITE_LOCATOR_FAIL_BAN = 2`M-oM-<M-^IM-oM-<M-^LM-hM-^@M-^LM-fM-^MM-"M-gM--M-^VM-gM-^UM-%M-fM-^OM-^PM-gM-$M-:M-hM-&M-^AM-eM-^HM-0M-gM-,M-, 3 M-fM-,M-!M-eM-$M-1M-hM-4M-%M-fM-^IM-^MM-hM-'M-&M-eM-^OM-^QM-oM-<M-^HM-iM-^XM-^HM-eM-^@M-< 3M-oM-<M-^IM-oM-<M-^LM-dM-8M-^T `SITE_OP_BANNED` M-dM-8M-^MM-fM-6M-^HM-hM-^@M-^WM-gM-^FM-^TM-fM-^VM--M-iM-"M-^DM-gM-.M-^W M-bM-^@M-^TM-bM-^@M-^T M-fM-^UM-^EM-hM-/M-%M-fM-^OM-^PM-gM-$M-:M-eM-^\M-(M-cM-^@M-^LM-eM-^OM-^MM-eM-$M-^MM-gM-^BM-9M-eM-^PM-^LM-dM-8M-^@M-eM-^OM-%M-cM-^@M-^MM-eM-^\M-:M-fM-^YM-/M-dM-8M-^MM-eM-^OM-/M-hM->M->M-oM-<M-^LM-dM-8M-^NM-fM-^\M-^@M-eM-^HM-^]M-fM-^OM-^PM-dM-:M-$M-eM-#M-0M-gM-'M-0M-gM-^ZM-^DM-eM-^\M-:M-fM-^YM-/M-dM-8M-^MM-gM-,M-&M-oM-<M-^LM-eM-^OM-&M-gM-%M-(M-hM-7M-^_M-hM-8M-*M-cM-^@M-^B^M$
- M-eM--M-^PM-dM-;M-;M-eM-^JM-!M-gM-^ZM-^DM-fM-(M-!M-eM-^^M-^KM-eM-7M-2M-gM-;M-^OM-eM-^AM-^\M-cM-^@M-^AM-dM-9M-^_M-fM-2M-!M-fM-^\M-^IM-fM-^ZM-^BM-eM-^AM-^\M-fM-^WM-6M-oM-<M-^LM-dM-8M-^MM-eM-^FM-^MM-eM-^MM- M-gM-^]M-^@M-fM- M-^GM-gM--M->M-iM-!M-5M-oM-<M-^LM-dM->M-'M-fM- M-^OM-dM-9M-^_M-dM-8M-^MM-eM-^FM-^MM-fM-^JM-^JM-eM-.M-^CM-dM-;M-,M-fM-^XM->M-gM-$M-:M-fM-^HM-^PM-cM-^@M-^LM-hM-?M-^PM-hM-!M-^LM-dM-8M-- N workerM-cM-^@M-^MM-cM-^@M-^BM-fM-^ZM-^BM-eM-^AM-^\M-gM-^ZM-^DM-eM--M-^PM-dM-;M-;M-eM-^JM-!M-dM-;M-^MM-dM-?M-^]M-gM-^UM-^YM-fM- M-^GM-gM--M->M-cM-^@M-^BM-gM-^HM-6M-dM-;M-;M-eM-^JM-!M-hM-^GM-*M-eM-7M-1M-hM-?M-^XM-eM-^\M-(M-fM-^@M-^]M-hM-^@M-^CM-fM-^WM-6M-oM-<M-^LM-gM-^JM-6M-fM-^@M-^AM-eM-^OM-*M-eM-^FM-^YM-cM-^@M-^LM-fM-^@M-^]M-hM-^@M-^CM-dM-8M--M-cM-^@M-^MM-cM-^@M-^B^M$
- M-eM-^HM-+M-gM-^ZM-^DM-eM--M-^PM-dM-;M-;M-eM-^JM-!M-fM--M-#M-eM-^MM- M-gM-^TM-(M-fM-^_M-^PM-dM-8M-*M-fM- M-^GM-gM--M->M-oM-<M-^H`HARD_HELD`M-oM-<M-^IM-fM-^WM-6M-oM-<M-^LM-eM-^FM-^MM-eM-^NM-;M-hM-/M-;M-fM-^HM-^VM-fM-^IM-^SM-eM-<M-^@M-eM-.M-^CM-eM-^OM-*M-fM-^XM-/M-eM-^OM-/M-fM-^AM-"M-eM-$M-^MM-gM-^ZM-^DM-eM-^FM-2M-gM-*M-^AM-oM-<M-^ZM-fM-^MM-"M-dM-8M-^@M-dM-8M-*M-fM- M-^GM-gM--M->M-fM-^HM-^VM-gM--M-^IM-eM-/M-9M-fM-^VM-9M-gM-;M-^SM-fM-^]M-^_M-eM-^MM-3M-eM-^OM-/M-oM-<M-^LM-dM-8M-^MM-eM-^FM-^MM-fM-^JM-^JM-fM-^UM-4M-hM-=M-.M-eM-/M-9M-hM-/M-^]M-eM-^AM-^\M-fM-^NM-^IM-cM-^@M-^B^M$
- M-eM-$M-^ZM-fM-^YM-:M-hM-^CM-=M-dM-=M-^SM-oM-<M-^ZM-fM-(M-!M-eM-^^M-^KM-hM-?M-^^M-fM-^NM-%M-hM-"M-+M-eM-/M-9M-gM-+M-/M-fM-^OM-^PM-eM-^IM-^MM-fM-^NM-^PM-fM-^VM--M-oM-<M-^HPremature close / Connection errorM-oM-<M-^IM-fM-^WM-6M-oM-<M-^LM-eM-^PM-^LM-dM-8M-^@M-hM-/M-7M-fM-1M-^BM-iM-^]M-^YM-iM-;M-^XM-iM-^GM-^MM-hM-/M-^UM-oM-<M-^LM-dM-8M-^MM-eM-^FM-^MM-fM-/M-^OM-fM-^VM--M-dM-8M-^@M-fM-,M-!M-eM-0M-1M-eM-^\M-(M-eM-/M-9M-hM-/M-^]M-iM-^GM-^LM-eM-^HM-7 M-bM-^ZM- M-oM-8M-^OM-oM-<M-^[M-hM-?M-^^M-gM-;M-- 5 M-fM-,M-!M-fM-^IM-^MM-fM-^ZM-^BM-eM-^AM-^\M-cM-^@M-^BM-eM-/M-9M-gM-+M-/M-eM-^\M-(M-eM-7M-2M-gM-;M-^OM-gM-;M-^YM-eM-^GM-:M-gM-;M-^SM-fM-^]M-^_M-eM-^NM-^_M-eM-^[M- M-dM-9M-^KM-eM-^PM-^NM-fM-^NM-^PM-fM-^VM--M-hM-?M-^^M-fM-^NM-%M-fM-^WM-6M-oM-<M-^LM-hM-?M-^YM-dM-8M-^@M-hM-=M-.M-eM-7M-%M-eM-^EM-7M-hM-0M-^CM-gM-^TM-(M-dM-;M-^MM-gM-^DM-6M-fM-^IM-'M-hM-!M-^LM-oM-<M-^LM-dM-8M-^MM-eM-^FM-^MM-fM-^UM-4M-hM-=M-.M-dM-8M-"M-eM-<M-^CM-cM-^@M-^B^M$
- collect_handbackM-oM-<M-^Zworker M-eM-^AM-^\M-eM-^\M-(M-gM-)M-:M-gM-^ZM-^DM-eM-7M-%M-eM-^EM-7M-eM-^[M-^^M-eM-^PM-^HM-dM-8M-^JM-fM-^WM-6M-oM-<M-^LM-fM-^TM-6M-eM-^[M-^^M-fM-^[M-4M-fM-^WM-)M-eM-^FM-^YM-hM-?M-^GM-gM-^ZM-^DM-eM-^JM-)M-fM-^IM-^KM-fM--M-#M-fM-^VM-^GM-oM-<M-^HM-fM- M-^GM-fM-^XM-^NM-fM-^\M-*M-eM-^FM-^YM-eM-.M-^LM-oM-<M-^IM-oM-<M-^LM-dM-8M-^MM-eM-^FM-^MM-fM-^JM-%M-cM-^@M-^LM-fM-2M-!M-fM-^\M-^IM-eM-^JM-)M-fM-^IM-^KM-fM-6M-^HM-fM-^AM-/M-cM-^@M-^MM-eM-9M-6M-eM-=M-^SM-fM-^HM-^PM-dM-8M-^MM-eM-^OM-/M-fM-^AM-"M-eM-$M-^MM-iM-^TM-^YM-hM-/M-/M-fM-^IM-^SM-fM-^VM--M-eM-^PM-^LM-fM-^IM-9M-eM-^EM-6M-dM-=M-^Y workerM-cM-^@M-^BM-eM-^OM-*M-fM-^\M-^IM-eM-7M-%M-eM-^EM-7M-hM-0M-^CM-gM-^TM-(M-cM-^@M-^AM-fM-2M-!M-fM-^\M-^IM-dM-;M-;M-dM-=M-^UM-fM--M-#M-fM-^VM-^GM-fM-^WM-6M-dM-;M-^MM-eM-$M-1M-hM-4M-%M-oM-<M-^LM-dM-=M-^FM-fM-^XM-/M-eM-^OM-/M-fM-^AM-"M-eM-$M-^MM-gM-^ZM-^DM-oM-<M-^LM-dM-8M-^MM-dM-<M-^ZM-eM-^AM-^\M-fM-^NM-^IM-gM-^HM-6M-dM-;M-;M-eM-^JM-!M-cM-^@M-^BM-eM-$M-^ZM-dM-8M-* worker M-fM-^JM-"M-eM-^PM-^LM-dM-8M-^@M-dM-8M-* Chrome M-gM-*M-^WM-eM-^OM-#M-eM-/M-<M-hM-^GM-4M-fM-^HM-*M-eM-^[M->M-fM-^IM-^SM-eM-^HM-0M-iM-^TM-^YM-hM-/M-/M-fM- M-^GM-gM--M->M-iM-!M-5M-fM-^WM-6M-oM-<M-^Lworker M-eM-^OM-/M-dM-;M-%M-fM-^MM-"M-fM- M-^GM-gM--M->M-iM-^GM-^MM-hM-/M-^UM-oM-<M-^LM-dM-8M-^MM-eM-^FM-^MM-fM-^UM-4M-fM-.M-5M-eM-^AM-^\M-fM-^NM-^IM-cM-^@M-^B^M$
^M$
M-hM-/M-^DM-eM-.M-!M-eM-^PM-^NM-dM-?M-.M-eM-$M-^MM-oM-<M-^H0.6.9 M-fM-^KM-^IM-eM-^OM-^VM-fM-^IM-9M-fM-,M-!M-eM-/M-9M-fM-^JM-^WM-hM-/M-^DM-eM-.M-!M-oM-<M-^LPR #549M-oM-<M-^IM-oM-<M-^Z^M$


• The real repo run: rc=1, two failures listed — dirty (.gitignore modified, pre-existing) and no tag. And "[Unreleased] 段为空" — interesting! CHANGELOG.md is CRLF, and the blank line inside the Unreleased section is "\r". But the guard said "[Unreleased] 段为空" (ok). Wait — look at the actual file: `## [Unreleased]^M$` then `^M$` then `## [0.6.10]...`. So the Unreleased section contains one line: "\r". The awk: `inblk && NF { ... }`. Does awk's NF for a line containing only "\r" equal 0?

  Default FS=" " special case: fields split on runs of whitespace. The question is whether \r counts as whitespace. In gawk, the default field splitting treats space, tab, newline as separators... Actually, gawk's default FS behavior: "In the special case where FS is a single space, fields are separated by runs of spaces and/or tabs and/or newlines". \r NOT included per POSIX... but many gawk builds... Hmm, but the real run said ok. Wait — it said "ok: [Unreleased] 段为空". So either NF==0 for "\r" line, or the awk exit on `/^## /` happened... no, the \r line comes before the `## [0.6.10]` line. So the "\r" line was processed by the `inblk && NF` rule. Result was empty, so either NF==0 (gawk treating \r as whitespace in FS=" " special case?) or the gsub stripped it. gsub only strips space/tab. So it must be NF==0... wait no — if NF != 0, then line=$0="\r", gsub doesn't change, line != "" → print "\r" → UNREL="\r" → non-empty → fail. But it said ok. So NF must be 0 for the "\r"-only line, meaning this gawk treats \r as whitespace in default field splitting. Indeed, gawk's default field splitting does treat \r as whitespace? Let me verify: in gawk, when FS=" ", fields are separated by "whitespace" which includes space, tab, newline. Hmm, but the observed behavior says the line was treated as empty. Actually wait — maybe Git Bash's awk treats \r... Let me just test explicitly to be sure:

  `printf 'a\r\n\r\nb\r\n' | awk '{print NF}'` — test it.

  Also test: what if Unreleased contains a line with only spaces+CR? gsub strips spaces and tabs but not \r; if NF counts \r... need empirical test.

  Also potential CRLF issue: section with content ending in \r — fine, content detected.

  Edge: comment lines or `### subsection` headings within Unreleased — `^### ` doesn't match `^## ` ... wait `^## ` requires space after ##. `### Added` starts with `### ` — does `/^## /` match "### Added"? The regex `^## ` needs '#' '#' ' ' at start — "### Added" has '#' '#' '#' so third char is '#' not ' ' → no match. Good, so `### Added` subsections don't terminate the block. Good.

  Now let me run the CRLF test and the gate test suite.---empty-check-done---
---spaces-only-done---
1
=== P0-D package gate tests ===
Root: /c/Users/HuChen/Projects/cmspark

[static] package.sh fail-closed host/tray
[static] whisper-binary auto-fetch SoT
[static] create-dmg.sh native MacOS/CMspark (not bash launcher)
[static] launch-companion.sh pins npm_config_prefix off the .app bundle
[static] Makefile package-macos → build-host
[static] release.yml content asserts + body
[static] build-windows-exe.ps1 fail-closed
[static] official Windows NSIS installer producer
[dynamic] CMSPARK_REQUIRE_NSIS=1 without makensis → nonzero
[dynamic] wrapper refuses SEA/mixed staging even if makensis exists
[dynamic] wrapper refuses a missing Windows application icon
[dynamic] missing makensis without REQUIRE → skip (exit 0)
[dynamic] package.sh macos-arm64 with host deleted → exit 1
[dynamic] skip positive macOS gate (artifacts not all present on this machine)
[dynamic] windows-x64 GATE-ONLY host-scripts-win non-empty
[dynamic] windows gate fails if scripts dir missing
[static] rg acceptance: no deferred WS-auth claims in release body
[static] release.yml Qwen3-VL packaging story
[dynamic] skip tray-missing test (no Darwin tray artifact)
[dynamic] skip scpt-missing test (no scpt artifacts)
[dynamic] windows-x64 GATE-ONLY fails without qwen-vl-worker.py
[static] package.sh gates Qwen3-VL worker (not TinyClick/ORT)
[static] launchers prefer node.exe+cmspark-agent.js before leftover SEA
[dynamic] release-guard.sh 六路径行为（临时 git repo）

=== Results: 146 passed, 0 failed ===
CRLF tests pass: the awk correctly treats "\r"-only and spaces-only-CR lines as empty (this gawk treats \r as whitespace in field splitting, NF=1 for "x\r"... wait `printf 'x\r\n' | awk '{print NF}'` printed 1, meaning \r not a separator there, but for a line containing only "\r", NF... hmm. Actually for a line containing only "\r": if \r is not whitespace, then $1="\r", NF=1 → `inblk && NF` true → gsub strips space/tab → line="\r" ≠ "" → prints. But output was empty! So this gawk DID treat the \r-only line as NF==0. And for 'x\r' NF=1 (field "x\r" — trailing \r stays in field). Hmm wait, actually with FS=" " special case, leading whitespace stripped... if \r is whitespace, then 'x\r' would give field "x" — NF=1 either way. Not discriminating. The key empirical result: blank CRLF lines don't produce false non-empty. Both CRLF tests empty → correct. Good.

  But note: this is gawk behavior under Git Bash. On GitHub Actions ubuntu runners, gawk/mawk — mawk treats \r how? CI CHANGELOG.md is checked out CRLF on ubuntu (git attributes / autocrlf...). Actually on ubuntu checkout, core.autocrlf=input default false, file committed with CRLF stays CRLF. Does the repo have .gitattributes forcing? Whatever — the guard in CI runs on ubuntu (release.yml runs-on?). Let me check release.yml runner OS. mawk's default FS splitting: mawk treats \r as... I believe mawk also treats \r as whitespace? Not sure. POSIX awk: "white space" shall include space, tab, newline for default splitting. Historically, both gawk and mawk include \r? Actually gawk manual says: "when FS is a single space, then fields are separated by runs of whitespace — spaces, tabs, and newlines". \r not included. But our empirical test with Git Bash gawk showed \r-only line gave no output... That suggests this gawk DOES treat \r as whitespace. Let me verify more precisely — print NF for '\r' alone:

  Actually my test didn't directly print NF for a \r-only line. The awk program output empty which implies NF==0 or gsub emptied it. gsub only strips [ \t]. So NF must have been 0 → \r treated as whitespace by this awk. Let me confirm awk version. Git Bash awk is gawk 5.x. Actually yes — gawk treats \r as whitespace in default field splitting since... I recall gawk's default includes carriage return? The gawk manual: "Fields are separated by whitespace: spaces, tabs and newlines". Hmm but empirically NF==0. Let me directly test: `printf '\r\n' | awk '{print NF}'`.

  If on ubuntu CI the awk is mawk and mawk does NOT treat \r as whitespace, then an empty Unreleased section with CRLF would be judged non-empty → false failure blocking every release. That would be P0. Let me test the specific NF behavior and check what release.yml runs on.

  Actually wait — more important: does the real CHANGELOG.md committed in git have CRLF? `file` says CRLF. Git may normalize on checkout depending on core.autocrlf. In CI ubuntu, checkout gives blob content as-is (with CRLF if committed CRLF). So the awk runs against CRLF content in CI.

  Let me test NF for \r-only line with the local awk, and check release.yml runs-on and whether mawk concern is real. I can't test mawk locally, but I can reason: gawk (default awk on ubuntu is mawk actually; ubuntu uses mawk as /usr/bin/awk by default!). ubuntu-latest: /usr/bin/awk → mawk. mawk's whitespace for default FS: mawk treats space, tab, newline... and \r? I believe mawk does treat \r as whitespace too (its default split uses isspace()? no...). Hmm. Known fact: mawk splits fields on [ \t\n] only? There's a well-known difference... Actually the well-known CRLF awk issue is real with both: `$0` contains trailing \r, and patterns like `$NF == "foo"` fail because field has \r. But for blank-line detection: a line that is just "\r" — in gawk, NF is 0? Let me actually verify with a direct test.

  Let me run: printf '\r\n' | awk '{print NF}'; awk --version.

  Also test what happens with mawk if available.

  Another check: release.yml — what OS? Let me read it. Also verify `github.ref_name` on tag push = tag name ("v0.6.10"). Yes, for tag push, GITHUB_REF = refs/tags/v0.6.10, ref_name = v0.6.10. Correct.

  Check ci.yml GATE_ONLY usage. Check other packaging entry points bypass. Check `git tag --points-at HEAD | head -1` multiple-tags edge. Check test's rg_setup — verified above, real temp repo.

  Also verify the anti-proof （反证） claim — reproduce one round: modify STRICT... but I must not modify files （只读评审：不要改文件）. I can copy the repo files to a temp dir and mutate the copy. Let me do the "break tag logic → exactly 3 red" round in a temp copy of release-guard.sh + test file? The test file uses ${ROOT}/scripts/... paths; simpler: run the dynamic scenarios manually against a mutated copy of the guard. Actually easier: replicate scenario 2 with a mutated guard copy in a temp repo and show it passes when it shouldn't.

  Plan:
  1. Test \r NF behavior + awk version.
  2. Read release.yml fully (runs-on, preflight job checkout, permissions).
  3. Read ci.yml GATE_ONLY path.
  4. Check other packaging entry points (build-windows-installer.sh, create-dmg.sh, build-windows-exe.ps1) — do they call package.sh or guard?
  5. Mutated-guard counter-proof in temp dir.
  6. Missing test paths: VERSION read failure, CHANGELOG missing (tested? CHANGELOG missing → fail, not tested), git unavailable.
  7. PR hygiene: gitignore change? The prompt says .gitignore modified "操作者进来前就有" — status shows ` M .gitignore` unstaged, not in commit. Commit only has 4 files. Good.
  8. gh pr view 553 closingIssuesReferences.

• CRLF handling verified clean locally. Now checking the awk NF edge precisely, release.yml details, and ci.yml path.0
GNU Awk 5.4.0, API 4.1, PMA Avon 8-g1, (GNU MPFR 4.2.2, GNU MP 6.3.0)
/usr/bin/awk


• awk NF for \r-only line = 0 on this gawk. Good locally. CI preflight runs on ubuntu-latest — /usr/bin/awk there is mawk by default on ubuntu? Actually ubuntu-latest GitHub images include gawk as well; /usr/bin/awk → mawk traditionally, but GitHub ubuntu images... `awk` on ubuntu-latest points to mawk I believe. mawk's default FS splitting: mawk treats \r as whitespace? Let me think. mawk source: default split uses scan for [ \t\n]+... Actually I recall mawk splits on space, tab, newline — carriage return IS included? Testing needed, but I can't test mawk here. However — key mitigation: in CI, the awk concern applies to CHANGELOG checked out from git. But in the guard's CI path, does the [Unreleased] check even matter? Yes it runs in preflight on ubuntu.

  Actually wait, is CHANGELOG.md stored with CRLF in the git blob? The working copy here is CRLF but that might be core.autocrlf=true on Windows. Check: `git show HEAD:CHANGELOG.md | head -5 | cat -A`. If blob is LF, then on ubuntu checkout it's LF → no CRLF concern in CI at all. Let me check.

  Also, where's the GATE_ONLY usage in ci.yml? The grep didn't show CMSPARK_PACKAGE_GATE_ONLY in ci.yml. Search more broadly.# Changelog$
$
M-fM- M-<M-eM-<M-^OM-eM-$M-'M-hM-^GM-4M-iM-^AM-5M-eM->M-* [Keep a Changelog](https://keepachangelog.com/)M-cM-^@M-^BM-gM-^IM-^HM-fM-^\M-,M-eM-^OM-7M-dM-8M-^N `companion/package.json` / `chrome-extension/package.json` M-eM-/M-9M-iM-=M-^PM-cM-^@M-^B$
$
## [Unreleased]$
$
## [0.6.10] M-bM-^@M-^T 2026-09-28$
$
Important findings so far:

  1. Git blob of CHANGELOG.md is LF (committed LF; CRLF only in local working copy due to autocrlf). So on ubuntu CI, checkout is LF → the awk CRLF concern doesn't arise in CI. Locally with CRLF working copy, gawk 5.4 treats \r-only lines as NF==0 → verified clean. But what about mawk? CI blob is LF so moot. However, local Windows Git Bash checkout with autocrlf → CRLF → verified works. OK, this threat is defused. But wait — what if the local awk were mawk? Git Bash ships gawk only. Fine.

     However, one subtle case: a CRLF line with only spaces+"\r" — verified empty. A CRLF content line is detected. Good.

  2. GATE_ONLY: no matches in .github/workflows! The claim says "CMSPARK_PACKAGE_GATE_ONLY=1（ci.yml 快路径）跳过". Grep for GATE_ONLY in workflows found NOTHING. Let me grep the whole repo to see where CMSPARK_PACKAGE_GATE_ONLY is set.#!/bin/bash
# CMspark distribution packager
#
# Version: companion/package.json (SoT). Align chrome-extension/package.json
# before tagging so Side Panel + Companion report the same product version.
#
# Usage: scripts/package.sh [macos-arm64|macos-x64|windows-x64|linux-x64]
# Output: dist-package/cmspark-v{version}-{platform}.zip
#   (lowercase "cmspark-v*" — cross-platform zip from this script)
#   Windows SEA portable zip uses "CMspark-v*" via build-windows-exe.ps1;
#   macOS DMG uses "CMspark-v*-macOS.dmg" via create-dmg.sh.
#
set -euo pipefail

# --- Configuration ---
NODE_VERSION="v22.16.0"
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Git Bash on windows-latest returns MSYS-style paths (e.g. /d/a/cmspark) that
# Windows Node cannot resolve in require()/fs — the very first `node -p` below
# would throw MODULE_NOT_FOUND. Convert ROOT_DIR (and every path derived from
# it — STAGING, CACHE_DIR, plus the temp dir in the 7z fallback) to MIXED form
# (D:/a/cmspark), which BOTH MSYS bash tools (cp/rm/curl/du/…) AND Windows Node
# accept. No-op on macOS/Linux, where cygpath is absent and Unix paths already
# work everywhere.
to_mixed() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
ROOT_DIR="$(to_mixed "${ROOT_DIR}")"
# shellcheck source=win-vendor-bins.sh
. "${ROOT_DIR}/scripts/win-vendor-bins.sh"

# 7-Zip off PATH (local Windows). /c/ always; C:/ skipped on POSIX (see win-vendor-bins.sh).
SEVENZ_CANDIDATES=(
  "/c/Program Files/7-Zip/7z.exe"
  "/c/Program Files (x86)/7-Zip/7z.exe"
  "C:/Program Files/7-Zip/7z.exe"
  "C:/Program Files (x86)/7-Zip/7z.exe"
)

# --- Platform detection ---
if [ -z "${1:-}" ]; then
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  [ "$OS" = "darwin" ] && OS="macos"
  [ "$ARCH" = "x86_64" ] && ARCH="x64"
  PLATFORM="${OS}-${ARCH}"
else
  PLATFORM="$1"
fi

VERSION="$(node -p "require('${ROOT_DIR}/companion/package.json').version")"
EXT_VERSION="$(node -p "require('${ROOT_DIR}/chrome-extension/package.json').version")"
# REL-4 / P2: fail-closed version lock-step (companion SoT must match extension)
if [ "${VERSION}" != "${EXT_VERSION}" ]; then
  echo "ERROR: version mismatch — companion=${VERSION} chrome-extension=${EXT_VERSION}" >&2
  echo "       Align package.json versions before packaging (REL-4)." >&2
  exit 1
fi
STAGING="${ROOT_DIR}/dist-package/cmspark-${PLATFORM}"
CACHE_DIR="${ROOT_DIR}/dist-package/.cache"
ZIP_NAME="cmspark-v${VERSION}-${PLATFORM}.zip"

# --- Release guard (#552 / #547 防复发) ----------------------------------
# 拒绝产出「与已发布 tag 同号但内容不同」的包：断言工作树干净、HEAD 的 tag 与
# package.json 版本一致、CHANGELOG [Unreleased] 已归档。tag 不匹配永远硬失败；
# dirty / untagged 可分别用 CMSPARK_ALLOW_DIRTY / CMSPARK_ALLOW_UNTAGGED 豁免
# （本机试装）。CMSPARK_RELEASE_STRICT=1（release.yml 用）下豁免失效。
# GATE_ONLY 是 ci.yml 的静态断言快路径，不产出发布物，跳过守卫。
if [ "${CMSPARK_PACKAGE_GATE_ONLY:-}" != "1" ]; then
  bash "${ROOT_DIR}/scripts/release-guard.sh" || exit 1
fi

# Experimental locate layer is Qwen3-VL (on-demand model + Python env under
# ~/.cmspark-agent/); the legacy TinyClick ONNX worker is product-replaced and
# NOT staged. onnxruntime-node IS staged (#260 speaker diarize — 本机声纹
# embedding), per-platform napi binary only (strip step [5/9]); missing target
# binary degrades gracefully to diarize_runtime_unavailable. See
# docs/qwen-vl-experimental-layer.md.
Key finding: **CMSPARK_PACKAGE_GATE_ONLY is NOT set anywhere in .github/workflows/**. The claim #4 says "GATE_ONLY（ci.yml 快路径）" — but ci.yml doesn't set it. It's only used in test-package-gates.sh itself. Let me check ci.yml fully to see if it calls package.sh at all. Actually the grep on ci.yml showed `bash -n scripts/package.sh` (syntax check only) and no GATE_ONLY. So claim 4's parenthetical is inaccurate but the behavior — "GATE_ONLY skips guard" — is real in package.sh. Does ci.yml even run package.sh? Let me read ci.yml fully. If ci.yml never runs package.sh without GATE_ONLY, no problem. The comment "GATE_ONLY 是 ci.yml 的静态断言快路径" is a stale/inaccurate comment (it's test-package-gates.sh fast path, and possibly a ci.yml step — need to check ci.yml).

  Also important: package.sh guard placement — after VERSION computation, before Step 1 build. Verified at line 71. `bash ... || exit 1` under `set -euo pipefail` — if guard exits 1, `|| exit 1` fires → exit 1. Good. Actually with set -e, `bash guard` failing would already abort; the `|| exit 1` is belt & braces. Fine.

  Now: does ci.yml call test-package-gates.sh? Check ci.yml fully. Also check whether GATE_ONLY in gate tests will run the guard (line 391 etc. run package.sh with GATE_ONLY=1 — guard skipped, good, since test repo... wait those run in the real repo! GATE_ONLY path skips guard, so tests pass on dirty real repo. Consistent.)

  Also: my own run of test-package-gates passed 146/0 on a dirty, untagged working tree — because dynamic tests use temp repos. Good.

  Now the counter-proof （反证）: implementer claims breaking strict → exactly 2 red; breaking tag branch → exactly 3 red. I should reproduce at least one round. Do it in a temp copy: copy repo's scripts/release-guard.sh to temp, mutate, and run the dynamic scenarios manually (or copy test file with ROOT override). Easier: create a temp dir, copy the guard, mutate the tag-mismatch branch to never fail, then run scenario 2 style checks manually. Actually simplest faithful reproduction: mutate a copy and run the 3 tag-related scenarios:

  - tag mismatch default → should be rc=1; mutated → rc=0 (red)
  - tag mismatch with豁免 → rc=1; mutated → rc=0 (red)
  - CMSPARK_RELEASE_TAG mismatch → rc=1; mutated → rc=0 (red)
  That's exactly 3 reds. The untagged scenarios unaffected because mutation is in the elif mismatch branch.

  Let me do it in /tmp. Also reproduce strict round? One round suffices per prompt.

  Other things to check:
  1. Multiple tags at HEAD: `git tag --points-at HEAD | head -1`. If HEAD has v0.6.10 and another tag lexically earlier (e.g. "aaa"), head -1 picks "aaa" → false failure. Ordering: git tag sorts lexically by refname. Edge case — local-only path, NIT.

  2. `head -1` with pipefail: `git tag --points-at HEAD 2>/dev/null | head -1 || true` — with pipefail, if git fails mid... fine, `|| true` covers.

  3. VERSION read fail → exit 1 verified by code. Test: PATH without node → run guard → expect rc=1. Let me actually run that (unset node from PATH).

  4. git unavailable: `git status --porcelain ... || true` → DIRTY empty → "ok 工作树干净" — false safety if git missing! Similarly `git tag --points-at` fails → HEAD_TAG empty → fail (untagged) unless ALLOW_UNTAGGED. So git-missing → dirty check silently passes (假安全) but tag check fails closed (unless豁免）. In a non-git directory (e.g. copied source tarball), git status fails → DIRTY="" → ok. And tag → fail. So overall still fails closed on tag. Only with ALLOW_UNTAGGED would it pass with a dirty tree undetected. Minor edge — worth a NIT maybe. Test: run guard in a non-git temp dir.

  Wait — actually the guard does `cd "${ROOT}"` where ROOT is derived from script location. In a copied non-git dir, git status returns error → `|| true` → DIRTY="" → ok. Tag fails → rc=1. Fine.

  5. preflight checkout depth: actions/checkout@v4 on tag push fetches the tag commit, depth 1. Guard uses CMSPARK_RELEASE_TAG so git tag fallback not needed. Verified claim.

  6. workflow_dispatch: ref_name = branch (e.g. "main") → mismatch → hard fail in preflight. But wait — the header comment in release.yml says workflow_dispatch is for dry-run verifying 3-platform build before tagging! Now the guard hard-fails the whole workflow on workflow_dispatch. That breaks the documented dry-run use case (line 6-8: "workflow_dispatch lets the matrix be dry-run on main WITHOUT creating a release — use it to verify the 3-platform build before tagging"). This is a real conflict: the PR kills the documented dry-run path. Is that intended? Commit message says "这是期望行为". But the workflow header comment (lines 6-8) still advertises dry-run — now stale/contradictory. That's at least a NIT (doc inconsistency), arguably blocking since a previously-working documented workflow path now fails at preflight without any escape hatch. Hmm. The implementer explicitly acknowledged this as intended. The stale comment at release.yml:6-8 is a real inconsistency — NIT.

  7. Other packaging entry points: build-windows-installer.sh wraps package.sh (which now has guard). build-windows-exe.ps1? create-dmg.sh? Check if they invoke package.sh or stage independently. If build-windows-exe.ps1 stages independently, it bypasses the guard → can produce CMspark-v*.exe portable with mismatched version. Let me check.

  8. `gh pr view 553 --json closingIssuesReferences` — check.

  9. ADR-020 checklist — check the template and whether the PR claims it. The commit has no ADR block visible; check the PR body.

  Let me proceed: read ci.yml, check build-windows-exe.ps1/create-dmg.sh, run node-missing test, non-git dir test, counter-proof, gh pr view.7:# Version: read from companion/package.json (same SoT as package.sh / create-dmg.sh).
19:# scripts/build-windows-installer.sh (package.sh windows-x64 staging only).
55:# Local override: $env:CMSPARK_ALLOW_VERSION_DRIFT=1 for intentional dev mismatch.
61:        if ($env:CMSPARK_ALLOW_VERSION_DRIFT -eq "1") {
112:    # SoT: companion/scripts/esbuild-bundle-args.json (shared with package.sh / package.json)
276:# Clean staging tree. Prefer not aborting on lock:
297:Cannot clear or write staging directory (locked by another process):
309:        Ok "Cleaned previous staging package"
312:    Ok "No previous staging package"
314:# Ensure parent + staging exist (reused if locked empty)
379:    Fail "host-scripts-win/*.ps1 empty after staging — refusing to ship"
429:# napi binary — the npm package ships every os/arch (hundreds of MB); one dir
603:# [6/6] Create zip archive (SEA portable). Official Setup.exe is package.sh only.
609:Ok "ZIP: $ZipPath"
610:Write-Host "  Official installer (CMspark-Setup-v$Version.exe) is produced by scripts/package.sh windows-x64, not SEA." -ForegroundColor DarkGray
620:Write-Host "  ZIP:  $ZipPath" -ForegroundColor Green
===
scripts/build-windows-installer.sh:2:# Wrap package.sh windows-x64 staging in an NSIS Setup.exe.
scripts/build-windows-exe.ps1:7:# Version: read from companion/package.json (same SoT as package.sh / create-dmg.sh).
scripts/build-windows-exe.ps1:19:# scripts/build-windows-installer.sh (package.sh windows-x64 staging only).
scripts/build-windows-exe.ps1:112:    # SoT: companion/scripts/esbuild-bundle-args.json (shared with package.sh / package.json)
scripts/build-windows-exe.ps1:429:# napi binary — the npm package ships every os/arch (hundreds of MB); one dir
scripts/build-windows-exe.ps1:603:# [6/6] Create zip archive (SEA portable). Official Setup.exe is package.sh only.
scripts/build-windows-exe.ps1:610:Write-Host "  Official installer (CMspark-Setup-v$Version.exe) is produced by scripts/package.sh windows-x64, not SEA." -ForegroundColor DarkGray
Findings so far:

  1. **Claim 4 partially over-claimed**: `CMSPARK_PACKAGE_GATE_ONLY` is never set in `.github/workflows/` — the gate-only mode is used only by `scripts/tests/test-package-gates.sh` itself (lines 391, 418, 434, 455, 506, 530, 560). The comment in package.sh:70 and the commit message say "GATE_ONLY 是 ci.yml 的静态断言快路径" — actually it's the gate-test fast path; ci.yml never calls package.sh. Does this matter behaviorally? ci.yml runs `bash scripts/tests/test-package-gates.sh` (ci.yml:48), and inside that test, package.sh is invoked with GATE_ONLY=1 → guard skipped → PR builds on ubuntu (no tag, ref=branch) don't fail. So the intended behavior holds: **守卫不会在 ci.yml 的 PR 构建里跑**. The claim's parenthetical "(ci.yml 快路径）" is imprecise — it's the gate-tests fast path invoked from ci.yml. Minor wording issue, not a behavioral bug. NIT at most. Actually wait — the claim says "package.sh 调用守卫，但 CMSPARK_PACKAGE_GATE_ONLY=1（ci.yml 快路径）跳过". The functional claim (guard skipped in the fast path, so PR CI not blocked) is TRUE. Attribution of the env var to ci.yml is wrong but the effect on ci.yml is as claimed. NIT-level comment inaccuracy.

  2. **build-windows-exe.ps1 bypasses the guard** — it stages and zips independently ("CMspark-v*" SEA portable zip), does NOT call package.sh or release-guard.sh. It has its own CMSPARK_ALLOW_VERSION_DRIFT check (line 61). It produces `CMspark-v$Version.zip` portable artifacts. Could it produce "same version two binaries"? Yes — running build-windows-exe.ps1 from untagged HEAD produces CMspark-v0.6.10 portable zip with different content than the release. Is it distributed? Line 610 says official installer is package.sh only. dist-package/ contains CMspark-v0.5.2-windows-x64/ etc. This is a real bypass path for the Windows portable zip. But: does the release pipeline use it? release.yml only calls package.sh. So official releases are guarded; the ps1 is a local/legacy tool. Whether blocking: the #547 incident was about the official Setup.exe from the release pipeline path (actually the operator built locally from b5a7396a). Hmm — the incident: "操作者就真实地从 b5a7396a 打出了 CMspark-Setup-v0.6.9.exe" — that was via build-windows-installer.sh or package.sh locally, presumably. Now package.sh guards that. The ps1 path produces a different artifact name (CMspark-v*.zip portable, not Setup.exe). Since package.sh is the official producer of both zip and Setup.exe, and the ps1 explicitly disclaims official status, I'd call this a follow-up/NIT, not blocking — but it deserves explicit mention. Let me check create-dmg.sh similarly — does it call package.sh staging? Check.

  3. release.yml header comment lines 6-8 still advertise workflow_dispatch dry-run, which now hard-fails at preflight. Doc inconsistency — NIT.

  Now run remaining verifications:
  - node missing → rc=1 (run guard with PATH lacking node)
  - non-git dir → dirty check silently ok （假安全 edge), tag fails closed
  - counter-proof round: mutate tag branch in temp copy → show 3 scenarios flip
  - create-dmg.sh check
  - gh pr view 553 closingIssuesReferences
  - Check guard multiple-tags head -1 edge quickly (minor)
  - ADR-020 checklist template existence + PR body

  Let me batch these.[release-guard] ERROR: 读不到 companion/package.json 的 version
rc(no-node)=1
[release-guard] version SoT = 1.0.0 → expected tag v1.0.0
[release-guard] strict=off allow_untagged=off allow_dirty=off ci_tag=none
  ok: 工作树干净（tracked）
  (tag 来源: git tag --points-at HEAD)
  FAIL: HEAD 不在任何 tag 上（需要 v1.0.0）
        本机试装请显式设 CMSPARK_ALLOW_UNTAGGED=1；正式发布请先打 tag
  ok: [Unreleased] 段为空
[release-guard] 1 条断言失败 → 拒绝打包（#552 / #547 防复发）
rc(non-git-dir)=1
18:STAGING="${ROOT_DIR}/dist-package/cmspark-macos-arm64"
20:DMG_DIR="${ROOT_DIR}/dist-package/dmg-staging"
31:if [ ! -d "${STAGING}" ]; then
32:  echo "[ERROR] Staging directory not found: ${STAGING}"
63:# --- Step 3: Copy staging files directly into Resources/ (flat layout) ---
65:cd "${STAGING}"
141:# Create writable sparse image from staging
/usr/bin/bash: line 1: gh: command not found
- node missing → rc=1 ✓ (fails closed, no silent exit 0)
  - non-git dir → "ok: 工作树干净" （假安全 on dirty check since git failed silently) but tag check fails → rc=1 overall. Edge: dirty check silently passes when git errors. In practice with ALLOW_UNTAGGED + non-git dir, guard would pass with unverifiable tree. Minor NIT.
  - create-dmg.sh reuses package.sh staging (requires dist-package/cmspark-macos-arm64 from package.sh) → guard covered transitively at staging time. But: staging dir persists; someone could package at tag, then modify, then create-dmg... staging already produced. Weak bypass — NIT/follow-up. Actually create-dmg.sh requires pre-existing staging; it doesn't build. The staging was created by guarded package.sh. OK.
  - gh not available. Try finding gh or use git/gh alternative. Check `where gh` maybe at "C:\Program Files\GitHub CLI\gh.exe". Or use the PR closing check via commit message only: `Closes #552` — only 552 in message. Can't verify GitHub-side without gh. List as "未能验证" or try full path.

  Now counter-proof reproduction. Mutate the tag-mismatch branch to never-fail in a temp copy, run the three tag scenarios, expect all rc=0 (i.e., 3 assertions would go red). Set up temp repo like rg_setup.1
warning: in the working copy of 'CHANGELOG.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'companion/package.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'scripts/release-guard.sh', LF will be replaced by CRLF the next time Git touches it
scenario A (tag mismatch, no exempt): rc=0
scenario B (tag mismatch, all exempt): rc=0
scenario C (CMSPARK_RELEASE_TAG mismatch): rc=0
gh.exe
{"closingIssuesReferences":[{"id":"I_kwDOSnyG0M8AAAABTkbIqg","number":552,"repository":{"id":"R_kgDOSnyG0A","name":"cmspark","owner":{"id":"MDQ6VXNlcjM2NTk3MjU0","login":"nehcuh"}},"url":"https://github.com/nehcuh/cmspark/issues/552"}]}
Counter-proof reproduced: mutating the tag-mismatch branch flips exactly the 3 tag-related scenarios from 1→0 (would turn exactly 3 dynamic assertions red). Matches implementer's claim.

  gh: closingIssuesReferences = only #552 ✓.

  Remaining checks:
  1. Strict 反证 round — claim says breaking STRICT → exactly 2 red. Optionally verify. Let me do it quickly too: set STRICT="" assignment... Actually implementer said "把 STRICT 赋值改空（字样保留，静态断言仍绿）→ 恰好 2 条 strict 动态断言变红". The strict dynamic assertions are: untagged+strict (scenario 3c) and dirty+strict (scenario 4c). Mutating STRICT="${CMSPARK_RELEASE_STRICT:-}" to STRICT="" would make strict never active → those 2 flip to rc=0. Plausible; I could verify quickly. Worth doing for completeness — it's cheap.

  2. Multi-tag head -1 edge: `git tag --points-at HEAD | head -1`. If two tags at HEAD, lexical first. If HEAD tagged v0.6.10 + e.g. "latest", "latest" < "v..." lexically → mismatch → false failure. Local-only path, and release tags convention v*. NIT.

  3. `git tag --points-at HEAD` in package.sh context with strict: env CMSPARK_RELEASE_TAG set in CI, fallback not used. ✓

  4. Preflight checkout: actions/checkout@v4 on tag push — checks out the tag commit. CMSPARK_RELEASE_TAG=ref_name used, so shallow clone OK. ✓ But wait: preflight also runs `git status --porcelain` in guard — checkout clean ✓. CHANGELOG read from checkout ✓.

  5. workflow_dispatch dry-run conflict: release.yml:6-8 comment still says workflow_dispatch dry-runs the matrix to verify builds before tagging. Now preflight guard hard-fails (ref_name=main ≠ v0.6.10... wait, actually — on workflow_dispatch, what's EXPECTED? version=0.6.10, ref_name="main" → mismatch → hard fail. And strict on. So the documented dry-run path is dead. The commit message acknowledges this as intended ("正式版必须由 tag push 产生，这是期望行为"). But the release.yml header comment (lines 6-8) and the body comment at line 204 ("workflow_dispatch dry-runs stop here") are now stale. Also `on: workflow_dispatch` trigger remains but can never succeed. That's a genuine inconsistency the PR should have cleaned: either remove workflow_dispatch or update comments. NIT (non-blocking, since behavior is intentional and announced), but real.

  6. ADR-020 checklist: read the template and check PR body for the declaration block. Let me check the template and PR body.

  7. .gitignore modification: working tree has ` M .gitignore` — prompt says it pre-existed (".alma-snapshots"). Verify the commit doesn't touch .gitignore — confirmed from --stat (4 files only). ✓ PR contains only the 4 files. ✓

  8. Test quality gaps: VERSION failure (tested? no — not in the 12 dynamic), CHANGELOG missing (no), git unavailable (no). I verified node-missing manually: rc=1. These are uncovered paths but behavior verified manually as correct → NIT-level coverage note, not blocking.

  9. One more possible假安全： the `[Unreleased]` awk — what if section header is `## [unreleased]` lowercase or `## Unreleased` without brackets? Keep-a-Changelog convention is `## [Unreleased]`. Repo uses that. Fine.

  What about Unreleased section with only comment lines `<!-- ... -->`? NF>0, gsub strips spaces, prints → non-empty → fail. Content lines legit. Fine.

  What if CHANGELOG uses `## [Unreleased]\r` — matches `^## \[Unreleased\]` regardless of trailing \r ✓ (tested with CRLF file).

  10. Verify strict round quickly + read ADR-020 template + PR body.

  Also should double check the guard's `git status --porcelain --untracked-files=no`: in CI package job on windows-latest Git Bash — works. Fine.

  One more: package.sh guard runs on every local package including GATE_ONLY skip — but also `CMSPARK_SKIP_HOST_BUILD` path without GATE_ONLY? Line 391 uses both together. If someone runs package.sh with SKIP_HOST_BUILD only (real packaging), guard runs. Fine.

  Also confirm claim 7: "真实打包路径（HEAD 无 tag）→ rc=1" — I effectively verified guard standalone rc=1; package.sh full run would download node etc. — the guard exits before Step 1, and I verified `bash guard || exit 1` placement. Running full package.sh is expensive; the guard itself rc=1 + placement at line 71-73 before build = sufficient evidence. GATE_ONLY rc=0: gate tests passed which exercise that path. ✓

  Let me do strict counter-proof + ADR-020 template + PR body.strict+untagged-exempt (expect 1, mutated): rc=0
strict+dirty-exempt (expect 1, mutated): rc=0
control clean+tag? (dirty now, no exempt → still 1): rc=1
## Summary

落地 #547 的**本票核心**：防复发机制。#547 的教训是 `v0.6.9` tag 停在 `488252bf`、而 main 上又多了 3 个提交且版本锚仍写 `0.6.9` —— 于是从 tag 和从 main 打出的包**版本号相同、内容不同**，无法区分。本轮工作流中我就真实地从 `b5a7396a` 打出了 `CMspark-Setup-v0.6.9.exe`。

PR #551 只修了那次具体脱节（归档 Unreleased + lock-step 到 0.6.10），机制一行没写，pi 据此 **REJECT 两次**（第二次还抓到我改 PR 正文时手滑写了 `Closes #552`，会误关承接票）。本 PR 把机制补上，使 #547 可以真正关闭。

## 关联 Issue

- Closes #552
- Refs #547（本 PR 落地其「本票核心」；#547 可在此合并后关闭）

## 能力声明（ADR-020）

```text
Surface:      n/a
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        none
Channel:      n/a
```

**Notes**: 纯发布工程基础设施 —— 新增一个守卫脚本 + 两处 workflow/脚本集成 + gate 测试。不新增任何用户可见工具、门禁、确认方言或 UI 入口，不触碰 Agent 运行时与 L2 授权语义。

### 反模式自检

- [x] 未新增 Side Panel 一级入口 / 确认方言 / Agent runtime
- [x] 未把实验定位器当写路径成功依赖
- [x] 架构/文档未裸写「中层 Agent」

## 做了什么

新增 `scripts/release-guard.sh`，三条断言（默认 fail-closed）：

1. 工作树干净（只看 tracked；untracked 的评审归档/本地草稿不算脏，否则本机永远打不了包）
2. HEAD 的 tag == `v$(companion/package.json version)`
3. CHANGELOG 的 `[Unreleased]` 段为空（归档必须在打 tag 前完成）

集成两处：
- `scripts/package.sh` 算出 `ZIP_NAME` 后调用；`CMSPARK_PACKAGE_GATE_ONLY=1`（ci.yml 的静态断言快路径，不产出发布物）跳过
- `.github/workflows/release.yml` 的 preflight 与 package 两个 job 都设 `CMSPARK_RELEASE_STRICT=1` + `CMSPARK_RELEASE_TAG=${{ github.ref_name }}`。preflight 里放在**装依赖之前**，让脱节的发布几十秒内失败，不白跑完整测试

## 与 #547 原文的两处刻意偏离（理由写进了脚本注释）

**1. tag 来源用 workflow context，不用 `git describe --exact-match HEAD`。**
#547 原文建议后者，但 `actions/checkout@v4` 默认 `fetch-depth=1`，**浅克隆里 tag 对象不一定存在**，会把正常发布误判为失败。故 CI 路径传 `github.ref_name`，本地无该变量时才回退 `git tag --points-at HEAD`。

**2. 不做「产物版本后缀降级为 `-dev.<sha>`」。**
#547 原文把它列为选项之一。但 `release.yml` 的产物 glob 是 `CMspark-Setup-v*.exe` / `cmspark-*.zip` 且 `fail_on_unmatched_files: true`，而 `installer.nsi:99` 把 `PRODUCT_VERSION` 写进注册表 `DisplayVersion` —— 带后缀会让它变成非数字。风险大于收益，改用 strict 硬失败 + 本机豁免开关。

## 豁免设计（本机试装是合法需求）

| 变量 | 作用 |
|---|---|
| `CMSPARK_ALLOW_UNTAGGED=1` | 放行「HEAD 无 tag」 |
| `CMSPARK_ALLOW_DIRTY=1` | 放行「工作树不干净」 |
| `CMSPARK_RELEASE_STRICT=1` | 上面两个豁免**全部失效**（release.yml 用） |

沿用 `build-windows-exe.ps1` 里 `CMSPARK_ALLOW_VERSION_DRIFT` 的既有惯例。

Strict counter-proof reproduced: exactly the 2 strict scenarios flip (rc 1→0), dirty-default control stays 1. Matches claim.

  ADR-020 declaration block present in PR body, Surface: n/a justified — this is release infra, no tools/gates/UI. Correct per checklist.

  Remaining checks:
  - 多 tag head -1 edge — minor, mention as NIT (untested but code-read inference). Actually I can test quickly: tag HEAD with two tags, see which head -1 picks. `git tag --points-at HEAD` output order — sorted lexically ascending? Let me quickly test in temp repo: tag v9.9.9 and aaa on same commit, see output order. If "aaa" comes first → false failure on local tagged release with extra tags. Quick test worth doing.

  - Also `head -1` pipefail with `git tag | head -1`: SIGPIPE? git tag output small, fine.

  - Check PR file list matches commit (4 files) — done via --stat.

  - .gitignore dirty in working tree pre-existed — the guard flags it; that's correct behavior （本机当前无法打包，符合 fail-closed; operator has exemptions). Fine.

  - One more potential假失败： release.yml preflight runs guard with strict on a clean checkout of the tag — passes if CHANGELOG's Unreleased empty and package.json version == tag. Correct flow. What about the package job on windows-latest Git Bash: cygpath exists ✓; node from setup-node ✓.

  - VERSION read: on ubuntu, ROOT is /home/... no cygpath → mixed = same. ✓

  - git status in CI checkout: clean ✓.

  - workflow_dispatch header comment stale — NIT.

  Quick multi-tag test then write up.points-at order:
aaa-extra
v9.9.9
head -1 picks: aaa-extra
Confirmed: multi-tag edge — if HEAD carries any tag lexically before the version tag (e.g. "aaa-extra", "latest", "release"), `head -1` picks it → false failure ("tag 不匹配" hard fail, no exemption). This is a real (if uncommon) false-failure path on the local fallback. In CI it's avoided via CMSPARK_RELEASE_TAG. Severity: NIT (local-only, uncommon, fails safe — blocks rather than ships; operator can set CMSPARK_RELEASE_TAG=vX to work around... wait, actually can they? Yes — CMSPARK_RELEASE_TAG is honored in any environment, so a local operator hitting this can set it. Fail-closed direction. NIT.)

  Now, assessment of blocking candidates:

  1. build-windows-exe.ps1 bypass: produces CMspark-v*.zip (SEA portable) independently of package.sh, no guard. Official release artifacts (zip + Setup.exe) all come from package.sh per release.yml. The ps1 artifact is explicitly disclaimed as non-official (line 610). It reads version from same SoT; a local untagged run would produce CMspark-v0.6.10.zip portable with arbitrary content — the same "same version two binaries" hazard for that artifact class, but it never enters the release pipeline. Blocking? The issue #547 was about released artifacts. The guard covers the release pipeline fully. The ps1 is a local dev tool with its own drift gate. I'd classify as NIT/follow-up (consider wiring guard into ps1), not blocking.

  2. GATE_ONLY claim attribution: comment says "ci.yml 的静态断言快路径" — actually GATE_ONLY is only set by test-package-gates.sh (which ci.yml runs). Behaviorally correct: ci.yml PR builds never run the guard (verified: ci.yml only does bash -n + test-package-gates.sh; the gate tests invoke package.sh with GATE_ONLY=1 → guard skipped; my full gate run passed 146/0 on a dirty untagged tree, proving PR CI won't be blocked). Over-claim in wording only — NIT-level. Actually the claim in the review prompt says "CMSPARK_PACKAGE_GATE_ONLY=1（ci.yml 快路径）跳过" — the functional claim (PR CI not blocked) verified true. Wording imprecise → NIT.

  3. workflow_dispatch stale comments (release.yml:6-8, 204): documented dry-run path now hard-fails at preflight. Intentional per commit message, but comments not updated → NIT.

  4. Dirty-check silently "ok" when git fails (non-git dir / git missing): `|| true` swallows errors → 假安全 on assertion 1. But assertion 2 fails closed in the same scenario (verified rc=1 in non-git dir). Only exploitable with ALLOW_UNTAGGED + broken git — exotic. NIT.

  5. Uncovered test paths: VERSION read failure, CHANGELOG missing, git unavailable — not in the 12 dynamic assertions. I verified node-missing → rc=1 manually. CHANGELOG-missing → fail by code reading (fail "找不到 CHANGELOG.md"). NIT coverage note.

  6. Multi-tag head -1 → NIT (verified real).

  All claims verified:
  1. 三条断言 — verified by running (real repo: dirty+untagged → rc=1 with both reasons; Unreleased ok).
  2. tag 来源 — code verified; CI 用 env，本地回退 points-at（真实运行时打印 "tag 来源： git tag --points-at HEAD"）✓
  3. 豁免/strict — verified via temp repos + counter-proofs both rounds reproduced ✓
  4. GATE_ONLY 跳过 — verified (146/0 on dirty untagged tree; static assertion pins the condition) — with wording imprecision noted.
  5. release.yml strict + ref_name in both jobs — verified release.yml:39-43, 116-122 ✓
  6. 9 static + 12 dynamic = 146 — verified, ran, 146 passed 0 failed ✓; 反证两轮复现 ✓ (I reproduced both: tag-break → 3 scenarios flip; strict-break → 2 flip)
  7. 集成回归 — GATE_ONLY path exercised by gate tests ✓; guard standalone rc=1 on real HEAD ✓

  CRLF: blob is LF; local CRLF working copy handled correctly by gawk 5.4 (verified NF==0 for \r-only lines, spaces-only lines; empty section → ok; non-empty section detection verified via test scenario 5 + my CRLF tests).

  hygiene: 4 files only ✓; .gitignore modification is pre-existing working-tree change, not in commit ✓; Closes #552 only (gh verified) ✓; ADR-020 block present and n/a justified ✓.

  Verdict: no BLOCKING. Several NITs → APPROVE_WITH_NITS.

  Line numbers for findings:
  - release-guard.sh dirty check: lines ~73-75 (DIRTY= line). Let me get accurate line numbers from the diff: the file content. `DIRTY="$(git status ...)"` — in the diff it's after "# --- 1." Let me compute: lines... I'll cite approximate: scripts/release-guard.sh:74. Actually let me grep quickly for exact numbers. I'll do one grep for the relevant lines.

• All verification done. Let me pin exact line numbers for the findings.scripts/release-guard.sh:17:#     本地无该变量时回退到 git tag --points-at HEAD。
scripts/release-guard.sh:70:DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
scripts/release-guard.sh:93:  HEAD_TAG="$(git tag --points-at HEAD 2>/dev/null | head -1 || true)"
scripts/release-guard.sh:94:  echo "  (tag 来源: git tag --points-at HEAD)"
scripts/package.sh:70:# GATE_ONLY 是 ci.yml 的静态断言快路径，不产出发布物，跳过守卫。


• # PR #553 独立对抗评审报告 — release-guard.sh

  评审方式：读完全部 4 个文件的 diff 与上下文；在真实仓库实际运行守卫；跑完 gate 测试（146 断言）；在临时 git repo 里**独立复现了两轮反证**（破坏 tag 分支、破坏 strict 赋值）；另外手测了 node 缺失、非 git 目录、CRLF 行尾、多 tag 等边界。以下为结果。

  ## BLOCKING（必须修才能合）

  无。三条核心威胁（假安全 / 假失败 / 豁免覆盖 tag 不匹配）都实测排除了，详见「已核实」。

  ## NITS（非阻塞）

  - `scripts/release-guard.sh:93` — **多 tag 时 `head -1` 取字典序第一个，可能误挡正常发布**。实测：同一 commit 打 `v9.9.9` + `aaa-extra` 两个 tag，`git tag --points-at HEAD` 输出 `aaa-extra` 在前 → 守卫判定「tag 不匹配」硬失败（豁免不覆盖）。触发条件：本地打包且 HEAD 上有任何字典序小于 `v*` 的额外 tag。方向是 fail-closed（挡住而非放行），且可用 `CMSPARK_RELEASE_TAG=vX.Y.Z` 绕过，CI 路径不受影响。建议改为「points-at 列表中**存在** EXPECTED_TAG 即通过」。
  - `scripts/release-guard.sh:70` — **git 不可用/非 git 目录时 dirty 断言静默通过**（`|| true` 吞掉错误，`DIRTY=""` → 打印 `ok: 工作树干净`）。实测于非 git 目录：dirty 假绿，但 tag 断言仍 fail-closed（rc=1），整体不失守。仅在「git 坏掉 + `CMSPARK_ALLOW_UNTAGGED=1`」组合下才是真的假安全，属 exotic。建议 git 报错时 fail 而非当干净。
  - `release.yml:6-8`（及 :204 注释）— **workflow_dispatch dry-run 的文档已失效**：文件头仍写着「workflow_dispatch lets the matrix be dry-run on main … use it to verify the 3-platform build before tagging」，但本 PR 后 preflight 守卫在 dispatch（ref_name=分支名）下 strict 硬失败，dry-run 路径实际上死了。行为本身是 commit message 声明的刻意设计，但注释没同步，下一个人会踩。
  - `package.sh:70` 注释 + commit message — **「GATE_ONLY 是 ci.yml 的静态断言快路径」不准确**：`CMSPARK_PACKAGE_GATE_ONLY` 在 `.github/workflows/` 里**从未被设置**（grep 全 workflows 无匹配），它只被 `scripts/tests/test-package-gates.sh` 自身使用（:391/418/434/455/506/530/560）。行为结论是对的（ci.yml 的 PR 构建不会跑守卫 —— 我在脏树+无 tag 的真实仓库跑 gate 测试 146/0 绿，证明 PR CI 不会被误挡），但归属写错了对象。轻度 over-claiming，仅措辞。
  - `scripts/build-windows-exe.ps1`（未在本 PR 改动）— **绕过守卫的独立打包入口**：它独立 staging 并产出 `CMspark-v$Version.zip` SEA 便携包，不调 `package.sh`/`release-guard.sh`，只有自己的 `CMSPARK_ALLOW_VERSION_DRIFT` 检查（:61）。它不进 release.yml（官方 zip 和 Setup.exe 都只由 package.sh 产出，ps1:610 也自述非官方），所以**不能污染正式发布物**；但本机用它在未打 tag 的 HEAD 上仍能产出与正式版同号的便携 zip。`create-dmg.sh` 复用 package.sh 的 staging 目录（:18,31-32），间接受守卫覆盖。建议 follow-up：把守卫接进 ps1，或至少加同样的 untagged/dirty 警告。
  - 测试覆盖缺口（不影响正确性，已手工补验）：`VERSION` 读取失败、CHANGELOG.md 不存在、git 不可用三条路径无动态断言。我实测 node 缺失 → `rc=1`（错误信息明确，非静默 exit 0）；CHANGELOG 缺失走 `fail()`（代码可读确认）。

  ## 未能验证

  - **ubuntu CI 上 mawk 对 CRLF 的行为**：本机 gawk 5.4 实测 `\r`-only 行 NF=0（不误判），且 **git blob 里 CHANGELOG.md 是 LF**（`git show HEAD:CHANGELOG.md` 无 `^M`，CRLF 只是本机 autocrlf 的 working-copy 现象），所以 ubuntu checkout 天然 LF，该风险实际不存在。结论可靠，但 mawk 本身我没跑过。
  - 完整 `scripts/package.sh windows-x64` 真实打包未跑（需下载 Node runtime，代价大）；但守卫插入点在 Step1 build 之前（package.sh:71-73），且守卫本体已在真实仓库跑出 rc=1，证据链充分。

  ## 已核实为正确的声明

  - **声明 1（三条断言）**：真实仓库实跑 → `rc=1`，正确列出「工作树脏（M .gitignore）」+「HEAD 无 tag」两条失败、`[Unreleased]` ok（`scripts/release-guard.sh:70,93,122` 附近）。
  - **声明 2（tag 来源）**：代码核实 + 实跑输出 `(tag 来源: git tag --points-at HEAD)`；CI 路径传 env（release.yml:42,121）。`github.ref_name` 在 tag push 时是 tag 名、dispatch 时是分支名 —— GitHub Actions 文档行为，且 dispatch 被拒正是声明的意图。
  - **声明 3（豁免与 strict）**：tag 不匹配分支（`elif [ "${HEAD_TAG}" != "${EXPECTED_TAG}" ]`）确实在豁免检查之外，硬失败无覆盖 —— 临时 repo 实测 `v8.8.8` vs `9.9.9` + 豁免全开 → rc=1。strict 在 untagged 与 dirty 两处都优先于豁免 —— 实测 `STRICT=1 + ALLOW_UNTAGGED=1` → 1，`STRICT=1 + ALLOW_DIRTY=1` → 1。
  - **声明 5（release.yml 两处集成）**：preflight 守卫在装依赖之前（release.yml:39-43），package job env strict+ref_name（:116-122），均核实。preflight 用 `CMSPARK_RELEASE_TAG` 绕开浅克隆 tag 缺失，回退路径在 CI 不会走到 —— 成立。
  - **声明 6（测试 125→146 + 两轮反证）**：`bash scripts/tests/test-package-gates.sh` 实测 **146 passed / 0 failed**；动态断言确实用 `mktemp -d` + `git init` 的独立临时 repo（`rg_setup`，不碰真实仓库）。**两轮反证均独立复现**：破坏 tag 分支 → 场景 A/B/C 三个 rc 从 1 翻成 0（恰好 3 条变红）；破坏 STRICT 赋值 → 两个 strict 场景翻 0、对照组（脏树无豁免）仍 1（恰好 2 条）。断言不是假绿。
  - **声明 7（集成回归）**：GATE_ONLY 路径由 gate 测试实跑通过（本机脏树+无 tag 下 146/0，证明跳过生效）；守卫本体在真实 HEAD（无 tag）rc=1，插入点在 build 前。
  - **CRLF 担忧（P0 重点）**：实测 CRLF 构造文件 —— 空段、纯空白行段均正确判空；git blob 为 LF，CI 无 CRLF 暴露。场景 5（非空拒绝）由 gate 测试覆盖且我复跑通过。
  - **卫生**：commit 恰 4 文件（`git show --stat`），`.gitignore` 的 `M` 是进入前就有的工作树改动、不在 commit 内；`gh pr view 553 --json closingIssuesReferences` 返回**仅 #552**；PR 正文含 ADR-020 声明块（Surface: n/a 等），对纯发布基础设施成立，符合 `_templates/dual-review-capability-checklist.md` 要求。

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_84c93121-38c9-4a75-9830-7e399c7b84ca
KIMI_EXIT=0
