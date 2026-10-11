# Kimi final Windows review (#592)

Reviewed code-only diff SHA-256 (excluding docs, before #593): `603ce40d66bc0f922bd6264247c9822bec7c2e8d2b5a108cf0671c4b236a44d0`.
Baseline: `2abb87f5837506f6557057fe98d425a0a6527d80`.
Tool: Kimi CLI, independent read-only second pass on the final source.
Native Windows CI remains a merge gate; macOS and arm64 results are not native Windows evidence.

• 复审完成（增量走查 + CI 等价验证）。

  ## 本轮增量核验结果

  **PTY closing 生命周期（`session.ts:213-252`）— 正确**
  - `closing` 槽位预留 + `isPtyBusy()` 覆盖 → cleanup 期间 spawn 返回 `terminal_busy`；输入/resize/ack/context 全部以 `live` 为键，closing 期间自然拒绝（测试断言覆盖）。
  - `finish()` 由 `closing !== s` 守卫：`terminal.closed` 恰好一次、仅在 cleanup 完成后发出；迟到重复 completion 不会清掉新会话（测试覆盖 `complete()` 两次）。
  - 自然退出路径（`exited: true`）跳过 `handle.kill()`/taskkill，PID 复用风险消除；cleanup 进行中 natural exit 经 `live !== session` 早退，不二次杀（`treeKills` 恒 1）。
  - 测试文件 `MockPty.exit()` 与 `__testSetPtyTreeKill` 注入缝自洽。

  **NSIS 宏（`installer.nsi:64-72`）— 正确**
  - 删除共享 `daemon.pid` stop 合理：跨安装误杀消除，tray/daemon 作为 INSTDIR 下 node.exe 仍被 env 定界 + 镜像名白名单覆盖。
  - 无 `daemon stop`/`/IM` 残留；烟雾测试用正则守卫防止回潮，且改为编译并执行**完整生产宏**（一次性 silent harness，`ReadEnvStr` 注入 `$INSTDIR`），兄弟安装存活与特殊字符根断言保留。
  - 实证：最终 `installer.nsi` 经 makensis 3.12 重编译 rc=0；`test-package-gates.sh` 156/156 通过。

  **CI（`ci.yml:225-239`）— 正确**
  - makensis choco 兜底语法 `${env:ProgramFiles(x86)}` 合法；`tsc -p tsconfig.test.json` + `run-tests.mjs` 显式编译产物路径与该 runner 的契约一致（我实测同一命令：76 pass / 2 native skip / 0 fail，含 3 个新生命周期测试）。先前 tsx 直跑出现的 1 个失败是 `#432` 测试对**编译布局**的既有路径假设（`__dirname/../..` → `.test-dist`），非本批缺陷，CI 路径下通过。

  **文档**：不缓存授权根的决定、PS 启动延迟为测量项的边界声明，spec/audit/plan 三处一致。

  ## 残留 P2（不阻塞，非新引入）

  - `killAllPty()`（session.ts:190）不处理 pending `closing`：SIGTERM/beforeExit 落在 ≤5s cleanup 窗口内时，handle 释放交给 OS 进程拆卸（unref'd timer 不挽留事件循环）；`terminal.closed` 可能不发出。边缘情形，影响仅限退出路径。
  - `closeLive` 无防御地覆写 `closing`：在 `isPtyBusy` 不变量下不可达，纯防御性缺口。
  - 上轮已报未改：系统 Node 托盘（ExecutablePath 在 INSTDIR 外）绕过 scoped stop；8.3 短路径可失配前缀。均为 P2 且非回归。

  ## Verdict

  **APPROVE** — 0×P0 / 0×P1。对抗性修正（槽位预留、exited 不杀 PID、完整宏编译执行、守卫回潮）全部落地且经测试与编译实证；可合并。
