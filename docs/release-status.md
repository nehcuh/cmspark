# 版本与交付状态

> 源码开发版本 **0.8.0（尚未正式发布）** · 核对日期：2026-11-03。

## 源码、发行包与已安装应用

| 项目 | 当前事实 |
|---|---|
| 源码版本 | Companion 与扩展统一为 **0.8.0**；锁文件、CLI、协议声明和安装器默认值同步。 |
| GitHub 正式发行包 | 发布准备时最新为 [v0.7.0](https://github.com/nehcuh/cmspark/releases/tag/v0.7.0)。0.8.0 须在主线 CI、三平台 dry-run 与 tag Release 成功后才算正式发布。 |
| 本机应用 | 2026-11-03 已从本地候选包换装为 **0.8.0**，签名、主程序／宿主标识和 `127.0.0.1:23401` 监听已验证。实际加载目录的扩展已重载，Chrome 已显示 **0.8.0／已重新加载**，本地换装完成。 |
| 本批动作 | 归档 0.7.0 后增量，准备 0.8.0；包含跨协议视觉、截图待办、Windows 稳定进程发现、指定聊天区域及最短 3 秒检查。采集功能已合并并通过独立验证与 GLM-Claude 复审；本地已换装。PR #826 的新测试修复已通过 Windows 定向原生，正式发布仍被 canonical MCP 启动门阻塞。 |

## 发布验收基线

视觉功能 [PR #823](https://github.com/nehcuh/cmspark/pull/823) 与 Windows 采集、版本和指南 [PR #824](https://github.com/nehcuh/cmspark/pull/824) 已合入主线 `b585eb6bc29baa2e2a0314dad2793de29a72209b`。测试准备和失败回执由 [PR #826](https://github.com/nehcuh/cmspark/pull/826) 继续处理，正式发布仍须等待验收完成。

| 验收项 | 已核对事实 |
|---|---|
| 当前验收阻塞 | 最后可执行改动 `273c1aff` 的[完整 CI](https://github.com/nehcuh/cmspark/actions/runs/41544992491)中，Windows canonical 任务在原 MCP **20 秒**门超时（20008ms），未进入完整 census。十项检查最终 **9 成功、1 失败**，macOS 与 Windows 定向 native 整 lane 成功；不能将另一路通过抵消失败。**PR #826 未合并，v0.8.0 未打标签、未正式发布。** |
| Windows 定向原生 | `273c1aff` 整 lane 成功；活动 **28 PASS、0 FAIL、0 SKIP**，包括原 9 项业务与新增 19 项源码控制。四项真实 Windows 用例、完整聊天范围／图片／拒绝与清理通过，原 MCP 20 秒内 **8.663 秒**通过，12 项交互及所有后续步骤成功。见[回执](audit/reviews/activity-826-windows-273c1aff.md)。 |
| Windows 完整普查 | `8aa98dbb` 实际为 **9538 leaf PASS、67 SKIP、2 FAIL**；两项失败均为上述测试路径缺陷，后续设置文件因主批失败未运行，不称完整成功。该路径修复已有本地与独立旧红／新绿证明；新提交 `273c1aff` 尚未越过前置 MCP 门。见[实际回执](audit/reviews/activity-826-windows-8aa98dbb.md)。 |
| macOS 原生 | `273c1aff` 全 lane 成功；MCP **4.521 秒**、Workspace **26.856 秒**，在原 20／45 秒内完成全部业务、完整关闭和清理。12 项交互及全部后续适用步骤通过。见[回执](audit/reviews/activity-826-macos-273c1aff.md)。 |
| 三平台发布预演 | `d94d5db5` 的[正常 Release 预演](https://github.com/nehcuh/cmspark/actions/runs/41534866533)预检及 Windows／macOS／Linux 打包全部成功，发布按分支规则跳过。后续为测试调度、诊断和文档变更，生产源码及原有构建／打包步骤未变；旧延迟测量入口曾退役并恢复原版 Release；当前仅为下述一次调用栈诊断临时增加默认关闭入口。正式标签前须退役并恢复原流程，最终标签工作流仍重建并验证全部发行资产。 |
| 单次 MCP 反事实测量 | `6d42d79e` 的独立测量完整业务 **7.964 秒通过**，属于既定的非判别结果，不扩大原 20 秒、不替代 CI 或预演。旧延迟测量入口和两脚本已退役；当时原 Release／Node 清单逐字恢复，当前新调用栈诊断另记。[实际回执](audit/reviews/activity-826-mcp-probe-6d42d79e.md)归档保留。 |

测试改动保留新 CPU 驱动的[明确构建／运行边界裁决](audit/reviews/activity-826-cpu-build-separation-coordinator-decision.md)：编译由新增测试的 20 秒移至标准构建原有 120 秒，30 秒 case 仅计运行，不称旧端到端预算不变。Scope 用一次命中自有只读文本框的 OS 点击替换旧激活／焦点 setup，成功围栏与原前台、键盘焦点、10／180 秒及业务／清理断言保持；其[独立源码验证](audit/reviews/activity-826-scope-input-independent-source.md)与 [GLM 源码门](audit/reviews/activity-826-scope-input-glm-source.md)已通过。闭集拒绝原因及等待阶段的 [19 项源码控制与复审](audit/reviews/activity-826-activity-failure-glm-source.md)也已完成；`8aa98dbb` 中原有 9 项 Windows 活动用例已全部通过。新增源码控制的 Windows 路径缺陷经[实际旧红／新绿复现](audit/reviews/activity-826-path-harness-independent-repro.md)定位，仅修测试路径；[非作者源码验证](audit/reviews/activity-826-path-harness-independent-source.md)确认双路径和原断言保持，19 项定向测试通过。[增量 GLM 源码门](audit/reviews/activity-826-path-harness-glm-source.md)也已通过；修复后本地、独立与实际 Windows 定向 19 项均通过；canonical Windows MCP 启动门仍阻塞完整 CI，不把本次测试修复称为 MCP 根因修复。

为完成当前需求的独立验证，活动步骤现在于自身准备完成后、MCP bootstrap 前执行；census 的实际 MCP 前缀不变，native lane 输入历史变化由[负责人明确裁决](audit/reviews/activity-826-activity-first-coordinator-decision.md)，[独立与 GLM 设计门](audit/reviews/activity-826-activity-first-glm-design.md)、[非作者源码核验](audit/reviews/activity-826-activity-first-independent-source.md)及 [GLM 源码门](audit/reviews/activity-826-activity-first-glm-source.md)均通过。原 MCP、interaction、census 与整体失败门禁继续生效；`273c1aff` 的 canonical MCP 门再次失败，原启动边界的唯一原因仍 UNKNOWN。上一轮据此停止追加阶段观测，未重试无变化任务、重置历史轮数或扩大时限；本轮用户继续授权后，仅采用下述不同的物理取证方法。后续合并／发布须先有具体修复依据并重新满足原门。

上述结果归档提交使用 `[skip ci]`，未修改可执行输入，也未提供新的通过结果。2026-11-03 用户明确要求继续排查：两路[共享宿主源码](audit/reviews/activity-826-mcp-resume-source-analysis.md)／[准备流程](audit/reviews/activity-826-mcp-resume-setup-analysis.md)复核未发现已证源码缺陷，故采用一次原 20 秒失败后的物理调用栈诊断；[独立设计验证](audit/reviews/activity-826-mcp-stack-independent-design.md)和[实际 GLM-Claude 设计门](audit/reviews/activity-826-mcp-stack-glm-design.md)通过，实现已通过相关机器检查、[独立源码验证](audit/reviews/activity-826-mcp-stack-independent-source.md)与[实际 GLM-Claude 源码门](audit/reviews/activity-826-mcp-stack-glm-source.md)，尚未派发。诊断仅处理精确自有进程，不增加原生业务时限；临时入口默认关闭，正常打包／标签行为保持，不能将该测量计为验收或发布预演。历史轮数与失败保留，后续必须先取得具体修复依据，再满足原机器、非作者、GLM 与 CI 门。

正式发布前须完成版本一致性、相关测试、精确 head 和合并后 main CI；预演复用范围须与实际构建输入一致。仅对通过的主线提交打 `v0.8.0`，再验证 [Release 工作流](../.github/workflows/release.yml) 的标签、目标提交和全部发行资产。标签内页面保留准备时事实，发布后的回执另更新主线文档。

[#457 历史验收台账](audit/0.7.0-20260907/release-acceptance.md) 的企业双场景仍未完成；0.7.0 已发布这一事实不证明该验收通过。0.8.0 沿用现有公开发行范围，不将该企业验收列为本次已完成能力；用户本次明确授权发布，未授权扩大企业能力声明。

## 已合并与尚待验收的边界

- **Office**：DOC/DOCX、XLS/XLSX、PPT/PPTX、ODT/ODS/ODP 与 PDF 入口扩展已合入。专有 WPS/ET/DPS 尚不支持；严格 XML、表格与图表预算可能拒绝复杂文档。#615 原范围已完成公开大表预算核验，四份原件均未成功转换，不能称为业务大表兼容保证。见 [导入契约](office-import-contract.md)。
- **协作、编程接力与项目**：父任务导航、汇总/操作反馈、终端入口和持久化项目元数据已合入；项目归属不授予目录权限。内嵌终端支持 macOS / Windows、默认关闭，Linux 仍不支持。原生工作区、文件/PTY/编程 Agent 组合的完整验收仍由 [#476](https://github.com/nehcuh/cmspark/issues/476) 跟踪。
- **连续会议**：#494 的有界采集/识别队列已合入；慢识别时继续采集，容量、断连和三小时上限仍会终止输入。连续协议不保留原始音频。见 [会议指南](meeting-and-dictation-user-guide.md)。
- **桌面与 Windows**：已有原生验收仅覆盖记名的工具包、动作和夹具。#572 原范围已完成；macOS AX 的 [#571](https://github.com/nehcuh/cmspark/issues/571) 已按原范围完成 AppKit 后台动作与 WK 已知 TREE_EXHAUSTED Gap 验收；这不表示所有工具包或 WK 根因已修复。上述 #476 整票仍未完成。永久归档的源码能力、数据寿命和原生验收边界见 [归档指南](desktop-thread-archive.md)。能力范围见 [Computer Use 台账](computer-capability-ledger.md)，不把 Linux 或受控 seam 的成功当作 Windows/macOS 原生成功。[#639](https://github.com/nehcuh/cmspark/issues/639) 的历史 10 秒失败根因仍未证明。
- **ITCra 与企业业务**：REST/grant 适配已合入、默认关闭。真实 23 项 P0、业务链接与第二身份验收由 [#618](https://github.com/nehcuh/cmspark/issues/618) 跟踪；模拟驱动与单身份扫码不能替代完整联调。[企业试点](enterprise-pilot.md) 的双场景和 0.7.0 里程碑仍待实际材料验收。
- **LCU 与编辑恢复**：LCU 默认关闭，只对 macOS arm64 / LCU 0.13.0 / ChatGPT 26.1016.61520 / CUA 0.0.33 自有窗口组合有有限实测记录，保留逐次确认和 Touch ID，不推广为 Windows 或全部应用支持。#776 已修当前编辑匹配失败被误判目录拒绝的路径，历史截图的唯一原因仍未关联。Windows OCR #780 已补原单次调用的闭集观察并通过本次原生验收；历史物理根因仍 UNKNOWN，整票保持开放。
- **其它余项**：#621 的条件性非 JSON 编码、#627 的真人图片回执，以及明确冻结/观察期项目保持各自边界。此页与版本号不会自动关闭这些票。

## 后续维护

每批功能或行为修复同时检查对应用户指南、能力台账和 CHANGELOG；版本切点同步包、锁文件、CLI/协议声明、安装器及 README、architecture、AGENTS、CLAUDE、PRODUCT、GOAL 活状态。历史审计与安装记录保留当时版本，不全仓替换。

合并继续遵循相关测试、两路独立非作者复审及精确 head / main CI。正式发布须另走 [发行工作流](../.github/workflows/release.yml) 与 [release guard](../scripts/release-guard.sh)；开发版本记录不替代该流程。
