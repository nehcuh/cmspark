# Pi — 实现 #502 D-G1 round_limit（只在本 worktree）

cwd 必须是 `/tmp/cmspark-502/g1`（分支 `feat/502-g1-round-limit`）。
禁止改 `/Users/huchen/Projects/cmspark`。禁止改 chrome-extension 除 LoopStatusRow 若计划 Task 3 需要。

计划：`docs/superpowers/plans/2026-09-18-502-g1-round-limit.md`
规格 §5.3 G1。你自己的调研在主仓 `.tmp/design-2026-09-18/out-pi.md`（本 worktree 可能没有该文件；以计划为准）。

1. `nvm use 22`
2. TDD：先改 `companion/tests/loop-kernel.test.ts` 让 round_limit 用例红
3. `RunTerminal` 加 `round_limit`；kernel 对它 **不** paused-return，走 enqueue/suggest
4. `circuit_breaker`（same-tool / 5 API fail）行为不变
5. adapter.ts **仅** while 100 耗尽出口改为 `chat.done` + `round_limit`；禁止墓碑句「达到最大工具调用轮次 (100)，已暂停。」
6. L2063 / L2316 仍 circuit_breaker
7. 状态行不得在 round_limit 后还写「推进中」
8. `npm --prefix companion test -- tests/loop-kernel.test.ts` 以及你加的扫描测试
9. 每 Task commit；做完写 `G1-DONE.md`

NEVER：删 100 这个数字；完整 goal_state；worker arm loop；cruise 跳 L2。
