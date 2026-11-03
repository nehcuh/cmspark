# 版本与交付状态

> 源码开发版本 **0.8.0（尚未正式发布）** · 核对日期：2026-11-03。

## 源码、发行包与已安装应用

| 项目 | 当前事实 |
|---|---|
| 源码版本 | Companion 与扩展统一为 **0.8.0**；锁文件、CLI、协议声明和安装器默认值同步。 |
| GitHub 正式发行包 | 发布准备时最新为 [v0.7.0](https://github.com/nehcuh/cmspark/releases/tag/v0.7.0)。0.8.0 须在主线 CI、三平台 dry-run 与 tag Release 成功后才算正式发布。 |
| 本机应用 | 2026-11-03 已从本地候选包换装为 **0.8.0**，签名、主程序／宿主标识和 `127.0.0.1:23401` 监听已验证。实际加载目录的扩展已重载，Chrome 已显示 **0.8.0／已重新加载**，本地换装完成。 |
| 本批动作 | 归档 0.7.0 后增量，准备 0.8.0；包含跨协议视觉、截图待办、Windows 稳定进程发现、指定聊天区域及最短 3 秒检查。采集功能已合并并通过独立验证与 GLM-Claude 复审；本地已换装。PR #826 的真实采集业务已通过；Windows 批量边界夹具已实际通过，当前 canonical 交互超时仍阻塞完整 CI。 |

## 发布验收基线

视觉功能 [PR #823](https://github.com/nehcuh/cmspark/pull/823) 与 Windows 采集、版本和指南 [PR #824](https://github.com/nehcuh/cmspark/pull/824) 已合入主线 `b585eb6bc29baa2e2a0314dad2793de29a72209b`。测试准备和失败回执由 [PR #826](https://github.com/nehcuh/cmspark/pull/826) 继续处理，正式发布仍须等待验收完成。

| 验收项 | 已核对事实 |
|---|---|
| 当前验收阻塞 | `0805bca0` 的[完整 CI](https://github.com/nehcuh/cmspark/actions/runs/41574465949)及同提交 ARM／Session 检查最终 **9 成功、1 失败**。Windows 定向整 lane 与 macOS 全成功；canonical Windows 原 MCP 已通过，但 New／Send、LOCAL、ARCHIVE、TERMINAL 四项交互在原 20／45 秒超时，完整 census 未执行。**PR #826 未合并，v0.8.0 未打标签、未正式发布。** 见[完整回执](audit/reviews/activity-826-shipping-0805bca0-ci.md)。 |
| Windows 定向原生 | `0805bca0` 活动 **28 PASS、0 FAIL、0 SKIP**（原 5 CPU＋4 Windows 路径及 19 源码控制），真实 producer **9.973 秒**在原 15 秒调用／30 秒 case 内通过。GUI／OCR／完整范围及图片业务通过；原 MCP **7.259 秒**、interaction12 全通过，LOCAL／ARCHIVE／TERMINAL、持久化与真实退出／释放均成功。不能抵消另一必需 lane 的失败。 |
| Windows 完整普查 | `0805bca0` canonical 原 MCP **9.417 秒**通过；随后交互 **8 PASS、4 CANCEL**，完整 census **NOT_RUN**。Terminal 记录过 OTHER_PROCESS 前台拒绝，LOCAL／ARCHIVE 原因仍 UNKNOWN；[窄源码分析](audit/reviews/activity-826-zero-receipt-0805-analysis.md)未发现可证明的下游 ACP／PTY 缺陷。历史 `1e2fea18` 全普查为 9565 leaf PASS／67 SKIP／0 FAIL，不计作当前通过。 |
| macOS 原生 | `0805bca0` 全 lane 成功；原 MCP **7.999 秒**、Workspace **30.377 秒**，保持原 20／45 秒。完整选择／持久化／重开／读取／取消、receipt1023／UI31、observer／xcode／原生子进程退出码 0 与租约释放均通过；LOCAL／ARCHIVE／TERMINAL 全业务成功。 |
| 三平台发布预演 | `1e2fea18` 的[正常预演](https://github.com/nehcuh/cmspark/actions/runs/41572026005)预检与三平台打包成功，四个 ZIP／Setup artifact 已核对，发布步骤跳过。Release CPU 安装配置已取得真实三平台证据；待合入的夹具修正改变最终树，**最终发行树须重新完成正常预演**。见[回执](audit/reviews/activity-826-release-preview-1e2fea18.md)。 |
| 调用栈诊断已退役 | `aad9d65e` 的[最终任务](https://github.com/nehcuh/cmspark/actions/runs/41570019778)成功：23 项控制全通过，真实工具资格 OBSERVED／COMPLETE、OK／实际退出码 0，原 MCP **20 秒**完整业务及清理在 **10.747 秒**通过。本次没有超时或目标调用栈，旧原因仍未证实；[实际回执](audit/reviews/activity-826-mcp-stack-aad9d65e.md)保留前四次 NOT_RUN。临时入口及四脚本现已退役，正常 Release 保留两处 CPU 安装配置，待最终发行树正常 CI 和三平台预演。 |
| 单次 MCP 反事实测量 | `6d42d79e` 的独立测量完整业务 **7.964 秒通过**，属于既定的非判别结果，不扩大原 20 秒、不替代 CI 或预演。旧延迟测量入口和两脚本已退役；当时原 Release／Node 清单逐字恢复，当前新调用栈诊断另记。[实际回执](audit/reviews/activity-826-mcp-probe-6d42d79e.md)归档保留。 |

测试改动保留新 CPU 驱动的[明确构建／运行边界裁决](audit/reviews/activity-826-cpu-build-separation-coordinator-decision.md)：编译由新增测试的 20 秒移至标准构建原有 120 秒，30 秒 case 仅计运行，不称旧端到端预算不变。Scope 用一次命中自有只读文本框的 OS 点击替换旧激活／焦点 setup，成功围栏与原前台、键盘焦点、10／180 秒及业务／清理断言保持；其[独立源码验证](audit/reviews/activity-826-scope-input-independent-source.md)与 [GLM 源码门](audit/reviews/activity-826-scope-input-glm-source.md)已通过。闭集拒绝原因及等待阶段的 [19 项源码控制与复审](audit/reviews/activity-826-activity-failure-glm-source.md)也已完成；`8aa98dbb` 中原有 9 项 Windows 活动用例已全部通过。新增源码控制的 Windows 路径缺陷经[实际旧红／新绿复现](audit/reviews/activity-826-path-harness-independent-repro.md)定位，仅修测试路径；[非作者源码验证](audit/reviews/activity-826-path-harness-independent-source.md)确认双路径和原断言保持，19 项定向测试通过。[增量 GLM 源码门](audit/reviews/activity-826-path-harness-glm-source.md)也已通过；修复后本地、独立与实际 Windows 定向 19 项均通过；路径修正不声称解释历史 MCP 超时；最新正常 CI 的实际结果以上表为准。

为完成当前需求的独立验证，活动步骤现在于自身准备完成后、MCP bootstrap 前执行；census 的实际 MCP 前缀不变，native lane 输入历史变化由[负责人明确裁决](audit/reviews/activity-826-activity-first-coordinator-decision.md)，[独立与 GLM 设计门](audit/reviews/activity-826-activity-first-glm-design.md)、[非作者源码核验](audit/reviews/activity-826-activity-first-independent-source.md)及 [GLM 源码门](audit/reviews/activity-826-activity-first-glm-source.md)均通过。原 MCP、interaction、census 与整体失败门禁继续生效；`273c1aff` 的 canonical MCP 门再次失败，原启动边界的唯一原因仍 UNKNOWN。上一轮据此停止追加阶段观测，未重试无变化任务、重置历史轮数或扩大时限；本轮用户继续授权后，限定的工具诊断与退役已完成，没有取得唯一 SDK 归因；不据此猜测产品补丁。已有测试准备、路径与 Release CPU 安装修正继续接受最终发行树的正常 CI 验收；原生失败仍阻塞合并和发布。

2026-11-03 用户继续授权后的两路[宿主源码](audit/reviews/activity-826-mcp-resume-source-analysis.md)／[准备流程](audit/reviews/activity-826-mcp-resume-setup-analysis.md)复核没有确认产品源码缺陷。限定 CDB 工具诊断最终完成真实资格和原 MCP 业务，但未命中超时，对历史原因无判别；临时入口已按[非作者](audit/reviews/activity-826-probe-retirement-independent-source.md)与[实际 GLM 源码门](audit/reviews/activity-826-probe-retirement-glm-source.md)退役，不再追加工具探针。其后正常 `1e2fea18` 已通过 canonical MCP 与完整普查；当前只修实际失败的 Apps 夹具逐条数组复制开销，并保留原错误的有限执行字段。单次调用、15 秒调用／30 秒 case／原 MCP 20 秒、生产者数据与全部断言保持；[非作者](audit/reviews/activity-826-apps-producer-independent-source.md)和[实际 GLM 源码门](audit/reviews/activity-826-apps-producer-glm-source.md)已通过，`0805bca0` 的真实 Windows producer 已在原时限内通过；当前未通过的交互另行定位。

针对 `0805bca0` 的交互失败，LOCAL／ARCHIVE／TERMINAL 的未分发 Windows 夹具现明确增加一次自有窗口标题栏选择，补齐原被动前台汇合之前的初始输入条件。它只在 GitHub 托管 Windows 测试中运行，核当前窗口／PID、物理命中、遮挡、DPI 与文档身份；完整 move/down/up 插入及 DPI 恢复后才允许继续，拒绝或短输入不重试，原真实前台和 20／45 秒业务门保持。Dialog 只增加三个有界请求尝试字段，用来区分后续失败边界，不改变输入或业务顺序。该显式夹具输入契约已通过[独立设计门](audit/reviews/activity-826-initial-owned-input-independent-design.md)、[实际 GLM 设计门](audit/reviews/activity-826-initial-owned-input-glm-design.md)、[非作者源码门](audit/reviews/activity-826-initial-owned-input-independent-source.md)及[实际 GLM 源码门](audit/reviews/activity-826-initial-owned-input-glm-source.md)，相关 108 项与生成器 42 项检查通过。产品宿主和 macOS 输出不变；实际 Windows 编译、输入、完整交互及普查仍等待变更后正常 CI，未据此宣称历史唯一原因或原生通过。

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
