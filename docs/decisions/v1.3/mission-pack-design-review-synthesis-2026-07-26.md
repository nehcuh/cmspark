# Mission Pack Design Review Synthesis

| Field | Value |
|-------|--------|
| Date | 2026-07-26 |
| Design | `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md` |
| Claude | `docs/audit/reviews/mission-pack-design-claude-20260726-193051.md` |
| Pi | `docs/audit/reviews/mission-pack-design-pi-20260726-193051.md` |

## Verdicts

| Reviewer | Verdict | Confidence |
|----------|---------|------------|
| Claude | **APPROVE_WITH_CHANGES** | 86% |
| Pi | **APPROVE_WITH_CHANGES** | 84% |
| After must-fix merge | **Ready for P0 writing-plans** | — |

## Must-fix → design 处置

| 主题 | Claude | Pi | Spec 落点 |
|------|--------|-----|-----------|
| intersect + null whitelist | M1 要权威全工具源 | M2 改为降级 allowlist | **采用 Pi**：S11 降级 allowlist |
| system_prompt_append | M2 P0 阻塞 | M3 合并顺序 | §6.5 + ALLOWED 键 |
| Shell 默认确认 | M3 per-command 默认 | M4 同 | S10 + confirm_per_command |
| 原子 apply | M5 | — | S8 |
| uninstall 回滚 | M6 snapshot | — | S9 + §6.7 |
| 审计文件合同 | M7 | M5 轮转 | §8.2 |
| zip slip | M8 | M 中 | §6.3 |
| 未知工具 | 拒绝 | M1 拒绝 | §6.2 |
| 禁止键枚举 | — | M6 | §6.2 blocklist |
| NetSec 匹配算法 | M4 | R4 | §7.3D |
| min_capability vs modules | — | R1 | S12 |
| Shell lifecycle | TIOCSTI | R2 | §7.3C |
| confirm kinds 不走域白名单 | — | R3 | §8.3 |

## 共识强项

- Pack 作组合层、双通道、opt-in、Companion 硬拒 — 双方认可  
- P0 先 AppSec；Shell/NetSec 后置  
- 不捆绑 nmap；xterm.js 默认  

## 实现面提醒（plan 吸收）

- P0 **不**做 skill-engine multi-root（复制装载）  
- Shell / CIDR 工作量被低估 → 分阶段独立 plan  
- P0 plan 仅覆盖 Pack 平台 + AppSec + audit 最小集  

## Gate

双方 **APPROVE_WITH_CHANGES** 且 must-fix **已合入 design §17** → 进入  
`docs/superpowers/plans/2026-07-26-mission-pack-p0.md`。
