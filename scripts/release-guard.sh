#!/usr/bin/env bash
# release-guard.sh — #552: 防止「同版本号两份二进制」复发（#547 的本票核心）。
#
# #547 的教训：v0.6.9 tag 停在 488252bf，但 main 上又多了 3 个提交、版本锚仍写
# 0.6.9，于是从 tag 和从 main 打出来的包版本号相同、内容不同，无法区分。
# 本次工作流中操作者就真实地从 b5a7396a 打出了 CMspark-Setup-v0.6.9.exe。
#
# 三条断言（默认 fail-closed）：
#   1. 工作树干净（只看 tracked）—— 未提交改动不得混进「正式版」
#   2. HEAD 的 tag == v$(companion/package.json version)
#   3. CHANGELOG 的 [Unreleased] 段存在且为空 —— 归档必须在打 tag 前完成
#
# 设计要点（与 #547 原文的偏离及理由，均经 dual-review #553 打磨）：
#   - tag 来源优先用 CMSPARK_RELEASE_TAG（release.yml 传 github.ref_name）。
#     **不能**只靠 git describe --exact-match HEAD：actions/checkout@v4 默认
#     fetch-depth=1，浅克隆里 tag 对象不一定存在，会把正常发布误判为失败。
#     本地无该变量时回退到 git tag --points-at HEAD。
#   - CI_TAG 加固：若本地能解析该 tag（^{commit}），必须指向 HEAD，否则硬失败。
#     否则手工设 CMSPARK_RELEASE_TAG=<旧tag> 就能在「HEAD 领先 tag」的 #547 场景
#     下原样通过。解析不到（浅克隆）才信任 workflow context。
#   - git 必须可用：git 失败不是「树干净」，必须硬失败（否则 fail-open）。
#   - 本机试装是合法需求，故有两个独立豁免开关（沿用 build-windows-exe.ps1 里
#     CMSPARK_ALLOW_VERSION_DRIFT 的既有惯例）：
#       CMSPARK_ALLOW_UNTAGGED=1  放行「HEAD 无 tag」
#       CMSPARK_ALLOW_DIRTY=1     放行「工作树不干净」
#     豁免只影响这两条；tag **不匹配** / git 不可用 / CI_TAG 指向不符 永远硬失败
#     （那是真错误，不是环境限制）。
#   - CMSPARK_RELEASE_STRICT=1（release.yml 用）：两个豁免开关全部失效。
#   - CMSPARK_RELEASE_REF_TYPE=branch（workflow_dispatch dry-run）：跳过 tag 断言，
#     因为 release job 有 if: startsWith(github.ref, 'refs/tags/v')，dry-run 不发布；
#     但仍强制 dirty / Unreleased 两条。缺省按 tag 路径（保守）。
#
# Usage: bash scripts/release-guard.sh
# Exit:  0 通过（含豁免通过）· 1 断言失败
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}" || exit 1

# Git Bash 下 ROOT 是 /c/... POSIX 形式，Windows 版 node 的 require() 解析不了
# （MODULE_NOT_FOUND）。转 mixed 形式 C:/... —— 与 package.sh 的 to_mixed 同一
# 处理；macOS/Linux 上 cygpath 不存在，原样返回。
to_mixed() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
ROOT_MIXED="$(to_mixed "${ROOT}")"

STRICT="${CMSPARK_RELEASE_STRICT:-}"
ALLOW_UNTAGGED="${CMSPARK_ALLOW_UNTAGGED:-}"
ALLOW_DIRTY="${CMSPARK_ALLOW_DIRTY:-}"
CI_TAG="${CMSPARK_RELEASE_TAG:-}"
REF_TYPE="${CMSPARK_RELEASE_REF_TYPE:-tag}"

FAIL=0
fail() {
  FAIL=$((FAIL + 1))
  echo "  FAIL: $1" >&2
  if [ -n "${2:-}" ]; then echo "        $2" >&2; fi
  return 0
}
ok() { echo "  ok: $1"; }
warn() { echo "  WARN: $1" >&2; }

# --- 版本 SoT -------------------------------------------------------------
VERSION="$(node -p "require('${ROOT_MIXED}/companion/package.json').version" 2>/dev/null || true)"
if [ -z "${VERSION}" ]; then
  echo "[release-guard] ERROR: 读不到 companion/package.json 的 version" >&2
  exit 1
fi
EXPECTED_TAG="v${VERSION}"
echo "[release-guard] version SoT = ${VERSION} → expected tag ${EXPECTED_TAG}"
echo "[release-guard] strict=${STRICT:-off} ref_type=${REF_TYPE} allow_untagged=${ALLOW_UNTAGGED:-off} allow_dirty=${ALLOW_DIRTY:-off} ci_tag=${CI_TAG:-none}"

# --- 0. git 必须可用（否则「查不出」会被当成「干净」→ fail-open）-----------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[release-guard] ERROR: git 不可用或当前目录不是 git 仓库 —— 无法证明工作树干净。" >&2
  echo "[release-guard]        fail-closed：不把「查不出」当成「干净」，拒绝打包。" >&2
  exit 1
fi

# --- 1. 工作树干净（只看 tracked）---------------------------------------
# untracked 的评审归档 / 本地草稿不算脏，否则本机永远打不了包。
DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
if [ -n "${DIRTY}" ]; then
  DIRTY_HEAD="$(printf '%s' "${DIRTY}" | head -8 | tr '\n' '; ')"
  if [ -n "${STRICT}" ]; then
    fail "strict 模式：工作树有未提交的 tracked 改动" "${DIRTY_HEAD}"
  elif [ -n "${ALLOW_DIRTY}" ]; then
    warn "工作树不干净，CMSPARK_ALLOW_DIRTY=1 → 放行（本机试装）"
    warn "产物含未提交改动，不得对外分发。${DIRTY_HEAD}"
    ok "豁免通过（dirty）"
  else
    fail "工作树有未提交的 tracked 改动，不得打进正式版" "${DIRTY_HEAD}"
    echo "        本机试装可设 CMSPARK_ALLOW_DIRTY=1 显式豁免" >&2
  fi
else
  ok "工作树干净（tracked）"
fi

# --- 2. HEAD 的 tag 与版本锚一致 -----------------------------------------
if [ "${REF_TYPE}" = "branch" ]; then
  # workflow_dispatch dry-run：release job 被 if: startsWith(ref, refs/tags/v) 挡住，
  # 这条路径的产物永远不会发布，故不要求 tag；但仍强制 dirty / Unreleased。
  warn "dry-run（ref_type=branch）→ 跳过 tag 断言"
  warn "产物**不是**正式 ${EXPECTED_TAG} 发布物，不得对外分发或手动挂 Release"
  ok "豁免通过（dry-run）"
else
  HEAD_TAG=""
  if [ -n "${CI_TAG}" ]; then
    HEAD_TAG="${CI_TAG}"
    echo "  (tag 来源: CMSPARK_RELEASE_TAG)"
    # 加固：CI_TAG 曾被无条件信任，于是本地手工设一个变量就能让「HEAD 领先 tag、
    # 版本锚不变」的 #547 场景原样通过。本地能解析该 tag 时要求其确实指向 HEAD；
    # 解析不到（浅克隆无 tag 对象）才信任 workflow context。
    TAG_SHA="$(git rev-parse --verify -q "${CI_TAG}^{commit}" 2>/dev/null || true)"
    HEAD_SHA="$(git rev-parse --verify -q HEAD 2>/dev/null || true)"
    if [ -n "${TAG_SHA}" ] && [ -n "${HEAD_SHA}" ] && [ "${TAG_SHA}" != "${HEAD_SHA}" ]; then
      fail "CMSPARK_RELEASE_TAG=${CI_TAG} 解析到 ${TAG_SHA:0:8}，但 HEAD 是 ${HEAD_SHA:0:8}" \
           "tag 并未指向被打包的提交 —— 这正是 #547「同版本号两份二进制」"
    elif [ -n "${TAG_SHA}" ]; then
      ok "CMSPARK_RELEASE_TAG 确实指向 HEAD"
    else
      echo "  (tag 对象本地不可解析 → 信任 workflow context，浅克隆预期行为)"
    fi
  else
    HEAD_TAG="$(git tag --points-at HEAD 2>/dev/null | head -1 || true)"
    echo "  (tag 来源: git tag --points-at HEAD)"
  fi

  if [ -z "${HEAD_TAG}" ]; then
    if [ -n "${STRICT}" ]; then
      fail "strict 模式：HEAD 不在任何 tag 上（需要 ${EXPECTED_TAG}）" \
           "正式发布必须由 tag push 触发；workflow_dispatch 手跑请先打 tag"
    elif [ -n "${ALLOW_UNTAGGED}" ]; then
      warn "HEAD 不在 tag 上，CMSPARK_ALLOW_UNTAGGED=1 → 放行（本机试装）"
      warn "产物**不是**正式 ${EXPECTED_TAG} 发布物，不得对外分发"
      ok "豁免通过（untagged）"
    else
      fail "HEAD 不在任何 tag 上（需要 ${EXPECTED_TAG}）" \
           "本机试装请显式设 CMSPARK_ALLOW_UNTAGGED=1；正式发布请先打 tag"
    fi
  elif [ "${HEAD_TAG}" != "${EXPECTED_TAG}" ]; then
    # 不匹配永远硬失败：这不是环境限制，而是版本锚与 tag 真的对不上，
    # 正是 #547「同版本号两份二进制」的成因。豁免开关不得覆盖此条。
    fail "HEAD 的 tag 是 ${HEAD_TAG}，但 package.json 版本是 ${VERSION}（应为 ${EXPECTED_TAG}）" \
         "版本锚与 tag 不一致 → 会产出与已发布 ${HEAD_TAG} 同号但内容不同的包"
  else
    ok "HEAD tag == ${EXPECTED_TAG}"
  fi
fi # REF_TYPE != branch

# --- 3. [Unreleased] 段必须存在且为空 ------------------------------------
CHANGELOG="${ROOT_MIXED}/CHANGELOG.md"
if [ ! -f "${CHANGELOG}" ]; then
  fail "找不到 CHANGELOG.md"
else
  HAS_UNREL="$(grep -cE '^## \[Unreleased\]' "${CHANGELOG}" 2>/dev/null || true)"
  UNREL="$(awk '
    /^## \[Unreleased\]/ { inblk=1; next }
    /^## / && inblk { exit }
    inblk && NF { line=$0; gsub(/^[ \t]+|[ \t]+$/, "", line); if (line != "") print line }
  ' "${CHANGELOG}")"
  if [ "${HAS_UNREL:-0}" -eq 0 ]; then
    # 段缺失时旧实现 inblk 从未置位 → UNREL 为空 → 误报 ok。必须区分「没这段」。
    fail "CHANGELOG 里没有 ## [Unreleased] 段 —— 无法确认变更已归档" \
         "本仓库惯例是保留该段标题（b78e0962 / 71ff2ff9 归档后都留空标题）"
  elif [ -n "${UNREL}" ]; then
    fail "CHANGELOG 的 [Unreleased] 段非空 —— 打 tag 前必须归档到正式版本段" \
         "$(printf '%s' "${UNREL}" | head -3 | cut -c1-90 | tr '\n' '; ')"
  else
    ok "[Unreleased] 段存在且为空"
  fi
fi

# --- 结果 -----------------------------------------------------------------
if [ "${FAIL}" -gt 0 ]; then
  echo "[release-guard] ${FAIL} 条断言失败 → 拒绝打包（#552 / #547 防复发）" >&2
  exit 1
fi
echo "[release-guard] 全部通过"
exit 0
