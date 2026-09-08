# S107 dual re-review — Claude + Kimi

**HEAD**: `4a63de56`  
**对象**: `docs/audit/reviews/s107-health-20260908/synthesis.md`（六路体检合成，不是补丁）  
**门**: 独立复审，互不看见对方输出。Claude `claude -p` stdin + Read/Grep；Kimi `kimi -p` 无 `--yolo`/`--auto`。

| 路 | 裁决 | 出口 |
|---|---|---|
| Claude Code 2.1.220 | **APPROVE_WITH_NITS** | 0 |
| Kimi 0.40.1 | **APPROVE_WITH_NITS** | 0 |

`both_ok=true`。无 REJECT。合成的五条 BLOCK 两路都 **TRIGGERED**（亲自读活文件，不是转述）。

## 两路都核过的 BLOCK

| Pin | Claude | Kimi |
|---|---|---|
| X1 文档 0.6.0 vs lockstep 0.6.6 | TRIGGERED | TRIGGERED |
| X2 README 全选灌库 vs TF-IDF top-k 5/8 | TRIGGERED（`skill-engine.ts:1472` 连 `all` 也 slice） | TRIGGERED |
| X3 `OVERLAY_WINDOW_SIZE` 1040×760 vs 文档 360×420 | TRIGGERED | TRIGGERED |
| Host「收起」→ unmount `meeting.end` | TRIGGERED | TRIGGERED |
| 「设置 → 听写」死路径 | TRIGGERED | TRIGGERED |

未打穿的拒针：NSIS 不是 SEA；默认 outbound 仍 8 工具；未把 #230/#228/#363 炒成新 BLOCK；未发现合成隐瞒的 Critical。

## 折进合成的 NIT（非阻塞）

两路独立加宽同一条：

- 「听写」死路径比合成列的 1271/1303 更宽（`MeetingPanel.tsx:506/768/936`、tooltip「听写方式」）。修时一并扫。
- unmount `meeting.end` 是故意防 `status=recording` 卡住。P0 优先 **改 Host 文案为「结束并收起」**，不要直接删 unmount end。

Claude 另：`docs/README.md:49` 也是 0.6.0 对齐句（X1 漏列）；Lane D 的 `diarize-cluster.ts` 路径标签不准。

Kimi 另：评审时看到并行写入的 `dual-claude.md` 空文件——时序伪影，忽略。

## 覆盖缺口（两路都声明未亲验）

活 INSTDIR/ARP/23401、PTY Darwin 全路径、SEC A–N 全表、测试套件。那些仍以六路 `[executed]`/`[inspected]` 为准。本机换装证据在 S107 主会话，不在 dual。

原文：`dual-claude.md` · `dual-kimi.md` · `dual-verdict.json`。
