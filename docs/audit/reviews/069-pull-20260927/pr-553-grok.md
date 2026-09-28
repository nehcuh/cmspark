I'll treat this as an independent adversarial review of PR #553: read the diff and checklist, then actually run the guard and gate tests instead of trusting the implementation notes.The branch is `feat/552-release-guard` at `cc48a924` with four files. Next I’ll read the full diff, run the guard and gate tests, and check PR metadata against the claims.The Unreleased awk and other packaging entry points look like the highest-risk spots. I’ll inspect CHANGELOG format, CI wiring, and bypass paths, then run the guard and tests.I’ll run the guard, gate tests, and independent CRLF/awk/exemption cases in Git Bash so the findings rest on observed exit codes, not the implementer’s notes.CHANGELOG is CRLF and HEAD has no tag. Next I’ll run the real guard, isolate the awk, and execute the gate tests plus counter-proofs.Gate tests are 146/0. Next I’ll independently reproduce a counter-proof, plus CRLF, exemption, and integration edge cases.Independent adversarial review of PR **#553** (`cc48a924`, `feat/552-release-guard` vs `main`). Evidence is from reading the four-file diff, running `scripts/release-guard.sh` and `scripts/tests/test-package-gates.sh` under Git Bash, plus temp-repo / stdin awk counter-cases. Repo files were not modified, tagged, or pushed.

## BLOCKING（必须修才能合）

无。默认假设的两种失效（假安全挡住不了坏发布 / 假失败挡住正常 tag 发布）在官方路径上**都没有被跑出来**。`#547` 的核心（tag 与版本锚不一致仍能打出同号包）在守卫里是硬失败，豁免覆盖不了。

## NITS（非阻塞）

- `.github/workflows/release.yml:6-8` — 文件头仍写 `workflow_dispatch` 可以在 main 上 dry-run 三平台构建、release job 才按 tag 停下。同文件 `39-43` / `116-122` 已给 preflight + package 加上 `CMSPARK_RELEASE_STRICT=1` 和 `CMSPARK_RELEASE_TAG=${{ github.ref_name }}`。手跑时 `ref_name` 是分支名（文档：`workflow_dispatch` → 所选分支），会走 tag **不匹配**硬失败，package job 过不了。这是脚本注释里写明的期望，但文件头那三行已经过时，按旧注释手跑会以为是构建坏了。触发：Actions UI 对 `main` 点 Run workflow。

- `scripts/create-dmg.sh`、`scripts/build-windows-exe.ps1`、直接调用 `scripts/build-windows-installer.sh` — 这些入口**不**调 `release-guard.sh`（对本仓库 `grep release-guard` 为空）。官方 GitHub Release / `make package-windows` / `package.sh` 已罩住；`#547` 的 `CMspark-Setup-v*.exe` 也是这条。绕过只发生在：用旧 staging 单独再打 NSIS、单独打 DMG、或 SEA `CMspark-v*` zip。这是 follow-up，不是合入门闩。Makefile 的 `package-macos` 是先 `package.sh` 再 `create-dmg.sh`，正常 make 路径仍会先过守卫。

## 未能验证

- 没有在 GitHub 上真实 `v*` tag push，所以 `github.ref_name` 在 hosted runner 上的值只核了对官方文档（tag push → 短 tag 名如 `v0.6.10`；`workflow_dispatch` → 所选分支名；本 workflow **没有** `pull_request`）。
- 未在 `ubuntu-latest` / `windows-latest` 镜像里测 awk 版本。本机 Git Bash GNU Awk 5.4.0 会把 CRLF 的 `\r` 从记录里剥掉；ubuntu 上 `actions/checkout` 一般是 LF。windows-latest 的 `shell: bash` 与本机 Git Bash 同族，但不是同一台机器。
- 未把 `awk` 从 PATH 摘掉做实验。静态看：`set` 没有 `-e` 时 `UNREL="$(awk …)"` 失败会得到空串，从而把 `[Unreleased]` 判成空（`release-guard.sh:123-132`）。CI 镜像有 awk。

## 已核实为正确的声明

- **声明 1**：三条断言都在且会累计后 `exit 1`。本机 HEAD 无 tag、tracked 脏（`M .gitignore`，**不在**本 PR 内）跑守卫：`rc=1`，同时报脏树 + 无 tag，`[Unreleased] 段为空`（`release-guard.sh:68-134`）。[executed]
- **声明 2**：`CMSPARK_RELEASE_TAG` 优先，否则 `git tag --points-at HEAD`（`release-guard.sh:88-95`）。`release.yml:42,121` 传 `${{ github.ref_name }}`。独立 temp repo：`CMSPARK_RELEASE_TAG=v9.9.9` → `rc=0`（无本地 tag 对象）；`v0.0.1` → `rc=1`。[executed]
- **声明 3**：不匹配走 `elif`，没有任何 `ALLOW_*`（`release-guard.sh:109-113`）。temp repo：`tag v8.8.8` + 版本 `9.9.9` + `ALLOW_UNTAGGED=1 ALLOW_DIRTY=1` 仍 `rc=1`。strict 在 dirty / untagged 两处都先于豁免（`73-75`, `98-100`）：`STRICT=1` + 对应 ALLOW 仍 `rc=1`；无 STRICT 时 ALLOW 为 `rc=0`。[executed]
- **声明 4**：`package.sh:71-73`，仅当 `CMSPARK_PACKAGE_GATE_ONLY` **恰好**为 `1` 才跳过。`ci.yml` 自己不调 `package.sh` 打包，只 `bash -n` + `test-package-gates.sh`；动态门调用带 `GATE_ONLY=1`。因此 PR CI 不会被无 tag 误杀。[executed + inspected]
- **声明 5**：preflight（`release.yml:39-43`，在 `npm ci` 之前）和 package（`116-122`）都是 `STRICT=1` + `ref_name`。有 `CI_TAG` 时根本不会走到 `git tag --points-at HEAD`，浅克隆缺 tag 对象不会把正常 tag 发布打成 untagged。checkout 默认 depth=1 的回退路径在这条 workflow 里用不到。[inspected]
- **声明 6**：`bash scripts/tests/test-package-gates.sh` → **`146 passed, 0 failed`**（约 8s）。动态段 `rg_setup` 在 `mktemp` 里 `git init`，不依赖本机是否干净。独立复跑 12 路期望码全部对上。反证（只改 **temp 副本**，未动仓库）：把 `STRICT="${CMSPARK_RELEASE_STRICT:-}"` 改成 `STRICT=""` → 恰好红 2 条（untagged+strict、dirty+strict）；把不匹配分支改成 `elif false && …` → 恰好红 3 条（mismatch、mismatch+exempt、CI_TAG mismatch）。[executed]
- **声明 7**：`CMSPARK_PACKAGE_GATE_ONLY=1 bash scripts/package.sh windows-x64` → `rc=0`，打印 `GATE-ONLY: windows host-scripts-win=19 … exiting 0`。不带 GATE_ONLY 的 `bash scripts/package.sh windows-x64` → **在守卫处 `rc=1`，没有进入 build**（`set -euo pipefail` 下 `bash … || exit 1` 确实打断）。[executed]

其它已跑、与声明一致或可排除的点：

- 本仓库 `CHANGELOG.md` **整文件 CRLF**（`core.autocrlf=true`，452/452）。真实文件上 `[Unreleased]` 为空段（中间只有空行）→ 守卫判空。stdin 复现：CRLF 空段 `len=0`；CRLF `- leftover` 能检出。空白行/仅空格 tab 视为空；`<!-- leftover -->` 视为非空。`### Added` **不会**被 `^## /` 当成下一段（该正则要的是 `##` + 空格，`###` 对不上），小节标题会当内容从而拒绝 — 不是假安全。[executed]
- `set` 无 `-e`：`node` 不在 PATH 时打印 `ERROR: 读不到 companion/package.json 的 version` 且 `rc=1`（`59-63`），不会静默 0。无 `CHANGELOG.md` 的 temp repo：`FAIL: 找不到 CHANGELOG.md`，`rc=1`。[executed]
- `git` 不在 PATH 且未设 `CMSPARK_RELEASE_TAG`：脏检查被 `2>/dev/null || true` 吃掉后仍因 untagged 失败。若同时设了匹配的 `CMSPARK_RELEASE_TAG`，脏树会被说成干净并 `rc=0` — 只在「git 没了 + 有人填了 CI tag」时出现，正式 `release.yml` 有 git，不上升为 BLOCKING。[executed]
- `github.ref_name`：官方文档与常见用法一致 — tag push 为 `v0.6.10`；`workflow_dispatch` 为分支名。后者被硬失败是设计，不是误伤 tag 发布。[inferred from docs]
- 卫生：`git diff --name-only main...HEAD` 只有上述 4 个文件。工作区 `M .gitignore`（`+.alma-snapshots`）未进 PR。`gh pr view 553 --json closingIssuesReferences` **只含 #552**。正文 `Refs #547` 不会误关。ADR-020 块在 PR 正文：`Surface: n/a` / `L2-classes: (none)` / `Compose: none` / `Autonomy: n/a` / `Trust: none` / `Channel: n/a`。本 diff 不加工具、确认方言、UI 入口或运行时，声明成立。[executed]

ADR-020 清单：轴正确（发布工程，不是 Surface/Composition/Autonomy）；无新 Side Panel 入口、无新确认方言、无第二套 runtime、不碰 originWs / god-mode / CU。`Trust: none` 合适。

VERDICT: APPROVE_WITH_NITS
GROK_EXIT=0
