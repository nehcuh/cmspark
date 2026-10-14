# CMspark issues 分组收敛计划

更新时间：2026-10-14；当前 open51，初始53。#478已有修复/原生发布证据已关闭；#550经PR629合并关闭。main6594c053 Windows CI失败为integration607目录清理EBUSY，尚未修复。

## 工作方式

先核验main已完成项，按真实DoD结票。每票只补对应失败场景的focused回归；同模块/同风险组统一一次完整test/build、fresh Linux ARM验证、独立对抗/Kimi、Pi、CI。源码冻结后才评审，修改后只重跑受影响focused与必要组级门禁。不为文案和有证据的已完成票重复跑全仓。不合并T4外部缺口，不靠关票数字替代完成。每组PR明确逐票完成/部分/阻塞映射；合入后看精确main SHA每个CI job。仓库仅ci.yml/release.yml，没有Quickstart E2E workflow，不冒称通过。

## 当前执行

1. CI最优先：确认EBUSY是进程生命周期还是OS锁收尾，复现后修复，保留所有断言。#623原进程身份10s事故独立保留，不把这次异常混成已修。
2. Office现有#614完整实现已在独立worktree，合并#615/#616有界维护后统一门禁；#615授权真实大表语料仍缺则保留该项。
3. 协作组核验#576/#577已main实现和106项fresh producer回归，合入#619/#621小维护。固定模型旧证据明确历史，不伪称当前。
4. 然后执行availability和browser recovery组；原生平台、真实业务与设计冻结票按各自前置条件处理。

## 全量分组优先级

| 优先级 | 分组 | issues |
|---|---|---|
| P0 | CI与发布可靠性 | [#623](https://github.com/nehcuh/cmspark/issues/623) |
| P1 | 多worker汇总与恢复 | [#576](https://github.com/nehcuh/cmspark/issues/576), [#577](https://github.com/nehcuh/cmspark/issues/577), [#619](https://github.com/nehcuh/cmspark/issues/619), [#621](https://github.com/nehcuh/cmspark/issues/621) |
| P1 | 知识、语音与代码面板 | [#491](https://github.com/nehcuh/cmspark/issues/491), [#486](https://github.com/nehcuh/cmspark/issues/486), [#484](https://github.com/nehcuh/cmspark/issues/484), [#522](https://github.com/nehcuh/cmspark/issues/522), [#481](https://github.com/nehcuh/cmspark/issues/481), [#432](https://github.com/nehcuh/cmspark/issues/432) |
| P1 | 浏览器拒执、失败恢复及诊断 | [#568](https://github.com/nehcuh/cmspark/issues/568), [#548](https://github.com/nehcuh/cmspark/issues/548), [#563](https://github.com/nehcuh/cmspark/issues/563), [#535](https://github.com/nehcuh/cmspark/issues/535), [#533](https://github.com/nehcuh/cmspark/issues/533), [#567](https://github.com/nehcuh/cmspark/issues/567), [#539](https://github.com/nehcuh/cmspark/issues/539), [#530](https://github.com/nehcuh/cmspark/issues/530), [#532](https://github.com/nehcuh/cmspark/issues/532), [#531](https://github.com/nehcuh/cmspark/issues/531) |
| P2 | Office兼容性收尾 | [#614](https://github.com/nehcuh/cmspark/issues/614), [#615](https://github.com/nehcuh/cmspark/issues/615), [#616](https://github.com/nehcuh/cmspark/issues/616) |
| P2 | 企业浏览器组件及真实联调 | [#618](https://github.com/nehcuh/cmspark/issues/618), [#624](https://github.com/nehcuh/cmspark/issues/624), [#625](https://github.com/nehcuh/cmspark/issues/625), [#627](https://github.com/nehcuh/cmspark/issues/627), [#628](https://github.com/nehcuh/cmspark/issues/628) |
| P2 | 原生computer-use范围验收 | [#571](https://github.com/nehcuh/cmspark/issues/571), [#572](https://github.com/nehcuh/cmspark/issues/572), [#71](https://github.com/nehcuh/cmspark/issues/71), [#70](https://github.com/nehcuh/cmspark/issues/70) |
| 待外部 | 企业试点与真实业务链路 | [#445](https://github.com/nehcuh/cmspark/issues/445), [#450](https://github.com/nehcuh/cmspark/issues/450), [#452](https://github.com/nehcuh/cmspark/issues/452), [#454](https://github.com/nehcuh/cmspark/issues/454), [#455](https://github.com/nehcuh/cmspark/issues/455), [#457](https://github.com/nehcuh/cmspark/issues/457), [#464](https://github.com/nehcuh/cmspark/issues/464) |
| 冻结/设计门 | 路线图与前置门禁 | [#230](https://github.com/nehcuh/cmspark/issues/230), [#328](https://github.com/nehcuh/cmspark/issues/328), [#363](https://github.com/nehcuh/cmspark/issues/363), [#364](https://github.com/nehcuh/cmspark/issues/364), [#372](https://github.com/nehcuh/cmspark/issues/372), [#373](https://github.com/nehcuh/cmspark/issues/373), [#476](https://github.com/nehcuh/cmspark/issues/476), [#480](https://github.com/nehcuh/cmspark/issues/480), [#521](https://github.com/nehcuh/cmspark/issues/521), [#494](https://github.com/nehcuh/cmspark/issues/494), [#534](https://github.com/nehcuh/cmspark/issues/534) |

## 状态分类说明

- 已实现待验收：#576/#577核心、#432原生PTY、#328默认关闭shadow、#481已批准UI切片；核验范围，不能把旧路线图未交付部分说成完成。
- 已实现未合并：#624/#627企业组件；#614未提交组件。#626仍草稿，真实T4外部阻塞不能合。
- 外部阻塞：企业第二身份/业务链接/23P0 receipts、大型真实Office语料、部分真实OS/TCC/模型试点输入。
- 明确冻结：#230形态/overlay、#372/#373/#364延期；#363真实heldout门未证明。其余设计票先核验既有设计审批，不能扩大权限。

四份逐票诊断覆盖原始53/53，保存在本目录；本表覆盖当前51/51，无重复遗漏。

## 当前验证波更新

Host统一回归5901项（5849通过、52既有平台skip）与前端1527项通过，双build通过。Office/Cooperation/Availability跨实现者独立复审通过组件范围；Availability补齐3个实际React hook+生产adapter浏览器时序case（合成媒体）。CIr2虽测试绿，但actual manager亲证吞teardown失败后仍启动replacement，P1阻断，r3修复中。每组门禁独立记录，不以总票数或测试数字冒称已合并。Linux锁定包缓存验证继续，Pi尚未放行。

当前分组产物与每票结票边界：[验收卡](audit/reviews/2026-10-14-issue-convergence/gate-card.md)。
