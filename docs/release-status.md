# 版本与交付状态

> 源码开发版本 **0.8.0（尚未正式发布）** · 核对日期：2026-11-03。

## 源码、发行包与已安装应用

| 项目 | 当前事实 |
|---|---|
| 源码版本 | Companion 与扩展统一为 **0.8.0**；锁文件、CLI、协议声明和安装器默认值同步。 |
| GitHub 正式发行包 | 发布准备时最新为 [v0.7.0](https://github.com/nehcuh/cmspark/releases/tag/v0.7.0)。0.8.0 须在主线 CI、三平台 dry-run 与 tag Release 成功后才算正式发布。 |
| 本机应用 | 2026-11-03 已从本地候选包换装为 **0.8.0**，签名、主程序／宿主标识和 `127.0.0.1:23401` 监听已验证。实际加载目录的扩展文件已更新为 0.8.0；Mac 锁屏导致运行时重载待完成。 |
| 本批动作 | 归档 0.7.0 后增量，准备 0.8.0；包含跨协议视觉、截图待办、Windows 稳定进程发现、指定聊天区域及最短 3 秒检查。采集功能已合并并通过独立验证与 GLM-Claude 复审；正式发布仍等待主线全平台原生与完整普查验收。 |

## 发布验收基线

视觉功能 [PR #823](https://github.com/nehcuh/cmspark/pull/823) 与 Windows 采集、版本同步及指南 [PR #824](https://github.com/nehcuh/cmspark/pull/824) 已合并，整合提交为 `b585eb6bc29baa2e2a0314dad2793de29a72209b`。

PR #824 最终提交 `8fceac9f` 的[十项 CI 检查](https://github.com/nehcuh/cmspark/actions/runs/41499020576) 全部成功，Windows 定向活动采集 9 项实际通过、0 跳过；完整普查 9536 项通过、67 项按原平台条件跳过、0 失败。详见[独立集成回执](audit/reviews/activity-825-final-windows-integration-8fceac9f.md)。已有[三平台 Release 预演](https://github.com/nehcuh/cmspark/actions/runs/41492740191) 的预检及全部打包成功；本轮随后修改原生构建入口的测试分支，当前候选仍须再完成三平台预演。

合并后的完整文件树与该受审提交相同；[主线 CI](https://github.com/nehcuh/cmspark/actions/runs/41503331363) 的其余检查通过，但原 Windows MCP 用例在 20 秒内未完成启动，Activity 定向步骤因此未执行。现有回执不能唯一定位其物理原因，正式发布暂缓。补充独立快照的设计与实现已通过独立实验、非作者源码核验及 GLM-Claude 复审（[源码回执](audit/reviews/activity-825-mcp-snapshot-glm-source.md)），下一步由 instrumented Windows CI 亲证；原时限、权限、业务断言与清理继续决定验收。

正式发布前须完成版本一致性、相关测试、精确主线 CI 与 [Release 工作流](../.github/workflows/release.yml) 的三平台 dry-run，再对通过的提交打 `v0.8.0` 标签。发布前页面不预记发布成功；标签内页面保留准备时状态，发布后的回执另更新主线文档。

后续 [PR #826](https://github.com/nehcuh/cmspark/pull/826) 的 `64dbdaaf` [CI](https://github.com/nehcuh/cmspark/actions/runs/41516873187) 中，Windows MCP 业务用例实际通过，但普查前的测试编译门超时、聊天范围初始就绪回执超时，macOS 既有工作区取消路径也超时，仍未满足发布门禁。详见 [Windows 回执](audit/reviews/activity-826-windows-native-64dbdaaf.md)和 [macOS 回执](audit/reviews/activity-826-macos-64dbdaaf.md)。编译调用与聊天范围有限观察的设计及实现已通过独立实验、非作者核验和 [GLM-Claude 源码复审](audit/reviews/activity-826-stdio-scope-glm-source.md)；修正后的精确 head 与主线仍须重新实际验收，不由诊断或旧通过结果替代。

`0666fc8d` 的[下一轮 CI](https://github.com/nehcuh/cmspark/actions/runs/41521066023)中，[Windows 完整原生任务](audit/reviews/activity-826-windows-native-0666fc8d.md)成功，活动采集 9 项通过且零跳过；普查前的新 CPU 编译仍在 20 秒门失败。[macOS 回执](audit/reviews/activity-826-macos-0666fc8d.md)记录完整原生／UI 回执及取消已返回，45 秒截止时 xcode 完整关闭仍未满足。新增测试现按[明确裁决](audit/reviews/activity-826-cpu-build-separation-coordinator-decision.md)分离构建与运行，承认编译 20→120 秒及 30 秒 runtime-only 的测量边界改变；macOS 仅补有限同钟域关闭与查询事实，原 45 秒及完整关闭资格保持。两设计均通过[独立实验与 GLM 设计门](audit/reviews/activity-826-build-mac-glm-design.md)，实现也已通过非作者源码核验和 [GLM 源码门](audit/reviews/activity-826-build-mac-glm-source.md)；精确提交的实际平台验收继续决定交付。

最新 `67c5e209` 的[CI](https://github.com/nehcuh/cmspark/actions/runs/41529697607)中，[macOS 完整原生 lane](audit/reviews/activity-826-macos-67c5e209.md)成功，工作区在原 45 秒内完成业务、完整关闭与清理；[两个 Windows lane](audit/reviews/activity-826-windows-67c5e209.md)的新 CPU 构建和后置运行均通过，但普查中的原 MCP 用例超出 20 秒，定向采集中的聊天范围夹具未在 10 秒内取得初始前台就绪资格。两项仍阻塞发布；独立快照仅约束其采样时刻的状态，不认定 SDK、冷启动或前台竞争的物理原因。

`67c5e209` 的[三平台 Release 预演](https://github.com/nehcuh/cmspark/actions/runs/41529703415)已全部成功，发布步骤按分支预演规则跳过。原生门仍失败，暂不打标签。另增一次独立、明确非验收的 MCP 延迟测量工具；其[独立源码核验](audit/reviews/activity-826-mcp-probe-independent-source.md)与 [GLM 复审](audit/reviews/activity-826-mcp-probe-glm-source.md)均通过，后续测量不替代原 20 秒验收或三平台预演。

聊天范围夹具现以一次命中自有只读文本框的 OS 点击替换旧激活／焦点请求，模拟用户先选中聊天窗口；该 setup 不改变产品被动采集，也不降低原就绪、10 秒／180 秒与全业务断言。[独立源码验证](audit/reviews/activity-826-scope-input-independent-source.md)及 [GLM 源码复审](audit/reviews/activity-826-scope-input-glm-source.md)已通过，实际 Windows 输入及完整业务继续由精确提交的原生 CI 验收。

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
