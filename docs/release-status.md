# 版本与交付状态

> 源码开发版本 **0.8.2（尚未正式发布）**，包含 Windows 聊天范围校准修复（#835）与 Linux 原生安装包（#834）。发布前可用的正式安装包见 [v0.8.1 Release](https://github.com/nehcuh/cmspark/releases/tag/v0.8.1)。

## 0.8.1 正式发行回执

- 发布范围包含 [PR #828](https://github.com/nehcuh/cmspark/pull/828) 的本机视觉、来源截图与大附件修复，以及 [PR #830](https://github.com/nehcuh/cmspark/pull/830) 的附件兼容性修复。Linux WPS 的标准 Office/PDF MIME 别名归一至对应标准类型，继续沿用上传白名单；聊天可导入内部确认为未加密标准 DOC 的 .wps，见 [Office 导入契约](office-import-contract.md)。
- 正式发布时间 **2026-11-05T07:06:08Z**，draft=false、prerelease=false。标签 `v0.8.1` 指向 `669f399906d404341135f2549940995a02e20944`，完整树为 `5980de0d1b7e28101e65c789f5cb1e11cbefdf4b`，包含附件修复提交 `9e753332`。标签内文档保留打标签前的准备状态，本页为发布后回执。
- 精确主线[正常 CI](https://github.com/nehcuh/cmspark/actions/runs/41980305278)及相关检查共 **10 SUCCESS**；同树候选的[三平台预演](https://github.com/nehcuh/cmspark/actions/runs/41979339691)通过；[正式 Release](https://github.com/nehcuh/cmspark/actions/runs/41983243784)预检、macOS arm64／Linux x64／Windows x64 打包和发布五个 job 全部 SUCCESS。发布前独立对抗与 Pi 复审均通过。
- 已实际下载四份二进制和两份校验清单，六项 API digest 与文件摘要相符，两份清单的四条二进制记录一致。正式 Linux ZIP 内 Companion 与扩展均为 **0.8.1**，双方均含 WPS MIME 归一及 .wps 支持。
- 正式 Linux x64 包在无网络容器中使用自带 Node **v22.23.4**，通过真实鉴权聊天上传与本地解析链路：WPS MIME DOCX 一份、四份公开 .wps 原件共 **5 次成功**，正文、数字和培训表结构符合预期；切换 PDF-only 白名单后 DOCX／.wps **2 次拒绝**，未新增用户消息。测试未使用用户私有文档。
- 本机已从该发行源码构建并换装 `/Applications/CMspark.app` **0.8.1**；签名有效，主程序与宿主单一 CDHash 均为 `a89c3a9e9f887be589a4fe07e4baa055d5647667`，与 staging 一致。应用已启动，后台由已安装包的 Node／Companion 运行，`127.0.0.1:23401/healthz` 正常。既有 Chrome 扩展目录已原位更新，身份和权限不变，Chrome 显示 **0.8.1／已重新加载**。本机 DMG 为本地构建产物，不混同 GitHub ZIP 资产。

下载：[正式 Release](https://github.com/nehcuh/cmspark/releases/tag/v0.8.1) · [SHA256SUMS](https://github.com/nehcuh/cmspark/releases/download/v0.8.1/SHA256SUMS) · [SHA256SUMS.txt](https://github.com/nehcuh/cmspark/releases/download/v0.8.1/SHA256SUMS.txt)。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| [CMspark-Setup-v0.8.1.exe](https://github.com/nehcuh/cmspark/releases/download/v0.8.1/CMspark-Setup-v0.8.1.exe) | 106648744 | `523924ceacbc69b60e9c18e409e8f2901aa7a69ef5801ad447eb4d86b4040a46` |
| [cmspark-v0.8.1-linux-x64.zip](https://github.com/nehcuh/cmspark/releases/download/v0.8.1/cmspark-v0.8.1-linux-x64.zip) | 140704958 | `58eabaf7295b124fdcabf45f2a23f3ea721148dbc6f18892fa5500772d7a26f6` |
| [cmspark-v0.8.1-macos-arm64.zip](https://github.com/nehcuh/cmspark/releases/download/v0.8.1/cmspark-v0.8.1-macos-arm64.zip) | 158696204 | `cbc51473ba2733eccd1ddd2023f345a7b75d9df1202a9cf949d94a19b00ccf95` |
| [cmspark-v0.8.1-windows-x64.zip](https://github.com/nehcuh/cmspark/releases/download/v0.8.1/cmspark-v0.8.1-windows-x64.zip) | 164234843 | `0d08c22413f3276b93aa2fe200d2ef81ca4a9dac08c1079f42ac129d3589157c` |

以下保留 **0.8.0 正式发行回执**，核对日期为 2026-11-03。

## 0.8.0 历史源码、发行包与已安装应用

| 项目 | 当前事实 |
|---|---|
| 源码版本 | Companion 与扩展统一为 **0.8.0**；锁文件、CLI、协议声明和安装器默认值同步。 |
| GitHub 正式发行包 | [v0.8.0](https://github.com/nehcuh/cmspark/releases/tag/v0.8.0) 已于 **2026-11-03 06:23:26 UTC（北京时间同日）**正式发布，draft=false、prerelease=false；四份二进制与两份校验清单共 6 项资产已验证。 |
| 本机应用 | 2026-11-03 已从本地候选包换装为 **0.8.0**，签名、主程序／宿主标识和 `127.0.0.1:23401` 监听已验证。实际加载目录的扩展已重载，Chrome 已显示 **0.8.0／已重新加载**，本地换装完成。 |
| 本批动作 | 0.8.0 已正式发布，包含跨协议视觉、截图待办、Windows 稳定进程发现、指定聊天区域及最短 3 秒检查；采集和模型默认关闭。PR #826 已合并，精确主线 10 项检查与最终同树三平台预演通过，正式 tag Release 五项 job 及资产内容校验完成。 |

## 0.8.0 历史发布验收基线

视觉功能 [PR #823](https://github.com/nehcuh/cmspark/pull/823) 与 Windows 采集、版本和指南 [PR #824](https://github.com/nehcuh/cmspark/pull/824) 已合入主线 `b585eb6bc29baa2e2a0314dad2793de29a72209b`。测试准备和失败回执由 [PR #826](https://github.com/nehcuh/cmspark/pull/826) 完成并合入；最终主线与正式发布证据如下。

| 验收项 | 已核对事实 |
|---|---|
| 当前发布验收 | [PR #826](https://github.com/nehcuh/cmspark/pull/826) 的精确 head `7bbda8f9` **10 SUCCESS** 后 squash 合并为 `ab3c2ca9`。原 squash 消息携带历史 skip-ci 标记，随后仅加空元数据提交 `38a1d6e9` 触发主线检查；三者完整树均为 `2cdb5fba61d27adaa15444d68af1b7ddaace706a`。精确 `38a1d6e9` 的[主线检查](https://github.com/nehcuh/cmspark/actions/runs/41585511749) **10 SUCCESS**，不以 PR 结果代替 main；见 [PR 回执](audit/reviews/activity-826-shipping-7bbda8f9-ci.md)与[主线回执](audit/reviews/activity-826-main-38a1d6e9-ci.md)。 |
| Windows 定向原生 | 正式源码 `38a1d6e9` 活动 **28 PASS／0 FAIL／0 SKIP**（原 5 CPU＋4 Windows 路径及 19 源码控制）。真实 producer **12.198 秒**在原 15 秒调用／30 秒 case 内通过；GUI／OCR／完整范围及图片业务通过。原 MCP **11.250 秒**、interaction12 全通过，LOCAL／ARCHIVE／TERMINAL 收据 255／63／255，实际 PTY／ACP／确认、退出及清理通过。 |
| Windows 完整普查 | 精确主线 `38a1d6e9` canonical 原 MCP **7.728 秒**、interaction12 全通过；完整 census **9572 leaf PASS／67 SKIP／0 FAIL／0 CANCEL、157 suites**，complete／execution_complete 与实际 exit0 满足。公开 artifact13208667677 绑定精确 head／tree／run；census 内原 MCP **1.676 秒**。GUI／OCR／Scope 由独立 native lane 实际验证，不把既定跳过计作通过。 |
| macOS 原生 | 精确主线 `38a1d6e9` 全 lane 成功；原 MCP **8.915 秒**、Workspace **42.601 秒**，保持原 20／45 秒。interaction12 全通过；完整选择／持久化／重开／读取／取消、receipt1023／UI31、observer／xcode／原生子进程退出码 0 与租约释放通过；LOCAL／ARCHIVE／TERMINAL 全业务成功。 |
| 三平台发布预演 | 最终发行树 `ab3c2ca9` 的[正常 main 预演](https://github.com/nehcuh/cmspark/actions/runs/41585362043)预检与 macOS arm64／Linux x64／Windows x64 打包全成功，四个 ZIP／Setup artifact 已核对，发布步骤跳过。后续 `38a1d6e9` 仅改元数据，完整树及实际打包输入相同，未发现嵌入 commit SHA 的构建消费者，故复用此最终同树结果；见[预演回执](audit/reviews/activity-826-release-preview-ab3c2ca9.md)。 |
| 调用栈诊断已退役 | `aad9d65e` 的[最终任务](https://github.com/nehcuh/cmspark/actions/runs/41570019778)成功：23 项控制全通过，真实工具资格 OBSERVED／COMPLETE、OK／实际退出码 0，原 MCP **20 秒**完整业务及清理在 **10.747 秒**通过。本次没有超时或目标调用栈，旧原因仍未证实；[实际回执](audit/reviews/activity-826-mcp-stack-aad9d65e.md)保留前四次 NOT_RUN。临时入口及四脚本现已退役，正常 Release 保留两处 CPU 安装配置，最终发行树的正常 CI、三平台预演与正式发布现均已完成。 |
| 单次 MCP 反事实测量 | `6d42d79e` 的独立测量完整业务 **7.964 秒通过**，属于既定的非判别结果，不扩大原 20 秒、不替代 CI 或预演。旧延迟测量入口和两脚本已退役；当时原 Release／Node 清单逐字恢复，后续调用栈诊断及退役另记。[实际回执](audit/reviews/activity-826-mcp-probe-6d42d79e.md)归档保留。 |

测试改动保留新 CPU 驱动的[明确构建／运行边界裁决](audit/reviews/activity-826-cpu-build-separation-coordinator-decision.md)：编译由新增测试的 20 秒移至标准构建原有 120 秒，30 秒 case 仅计运行，不称旧端到端预算不变。Scope 用一次命中自有只读文本框的 OS 点击替换旧激活／焦点 setup，成功围栏与原前台、键盘焦点、10／180 秒及业务／清理断言保持；其[独立源码验证](audit/reviews/activity-826-scope-input-independent-source.md)与 [GLM 源码门](audit/reviews/activity-826-scope-input-glm-source.md)已通过。闭集拒绝原因及等待阶段的 [19 项源码控制与复审](audit/reviews/activity-826-activity-failure-glm-source.md)也已完成；`8aa98dbb` 中原有 9 项 Windows 活动用例已全部通过。新增源码控制的 Windows 路径缺陷经[实际旧红／新绿复现](audit/reviews/activity-826-path-harness-independent-repro.md)定位，仅修测试路径；[非作者源码验证](audit/reviews/activity-826-path-harness-independent-source.md)确认双路径和原断言保持，19 项定向测试通过。[增量 GLM 源码门](audit/reviews/activity-826-path-harness-glm-source.md)也已通过；修复后本地、独立与实际 Windows 定向 19 项均通过；路径修正不声称解释历史 MCP 超时；最新正常 CI 的实际结果以上表为准。

为完成当前需求的独立验证，活动步骤现在于自身准备完成后、MCP bootstrap 前执行；census 的实际 MCP 前缀不变，native lane 输入历史变化由[负责人明确裁决](audit/reviews/activity-826-activity-first-coordinator-decision.md)，[独立与 GLM 设计门](audit/reviews/activity-826-activity-first-glm-design.md)、[非作者源码核验](audit/reviews/activity-826-activity-first-independent-source.md)及 [GLM 源码门](audit/reviews/activity-826-activity-first-glm-source.md)均通过。原 MCP、interaction、census 与整体失败门禁继续生效；`273c1aff` 的 canonical MCP 门再次失败，原启动边界的唯一原因仍 UNKNOWN。上一轮据此停止追加阶段观测，未重试无变化任务、重置历史轮数或扩大时限；本轮用户继续授权后，限定的工具诊断与退役已完成，没有取得唯一 SDK 归因；不据此猜测产品补丁。已有测试准备、路径与 Release CPU 安装修正已由最终发行树的正常 CI 验收；当时的原生失败曾阻塞合并和发布，最终精确主线已通过上述完整验收。

2026-11-03 用户继续授权后的两路[宿主源码](audit/reviews/activity-826-mcp-resume-source-analysis.md)／[准备流程](audit/reviews/activity-826-mcp-resume-setup-analysis.md)复核没有确认产品源码缺陷。限定 CDB 工具诊断最终完成真实资格和原 MCP 业务，但未命中超时，对历史原因无判别；临时入口已按[非作者](audit/reviews/activity-826-probe-retirement-independent-source.md)与[实际 GLM 源码门](audit/reviews/activity-826-probe-retirement-glm-source.md)退役，不再追加工具探针。其后正常 `1e2fea18` 已通过 canonical MCP 与完整普查；其后仅修实际失败的 Apps 夹具逐条数组复制开销，并保留原错误的有限执行字段。单次调用、15 秒调用／30 秒 case／原 MCP 20 秒、生产者数据与全部断言保持；[非作者](audit/reviews/activity-826-apps-producer-independent-source.md)和[实际 GLM 源码门](audit/reviews/activity-826-apps-producer-glm-source.md)已通过，`0805bca0` 的真实 Windows producer 已在原时限内通过；该提交未通过的交互随后由 `a4ddaf13` 在原时限内实际通过，历史唯一原因仍不据此补记。

针对 `0805bca0` 的交互失败，LOCAL／ARCHIVE／TERMINAL 的未分发 Windows 夹具现明确增加一次自有窗口标题栏选择，补齐原被动前台汇合之前的初始输入条件。它只在 GitHub 托管 Windows 测试中运行，核当前窗口／PID、物理命中、遮挡、DPI 与文档身份；完整 move/down/up 插入及 DPI 恢复后才允许继续，拒绝或短输入不重试，原真实前台和 20／45 秒业务门保持。Dialog 只增加三个有界请求尝试字段，用来区分后续失败边界，不改变输入或业务顺序。该显式夹具输入契约已通过[独立设计门](audit/reviews/activity-826-initial-owned-input-independent-design.md)、[实际 GLM 设计门](audit/reviews/activity-826-initial-owned-input-glm-design.md)、[非作者源码门](audit/reviews/activity-826-initial-owned-input-independent-source.md)及[实际 GLM 源码门](audit/reviews/activity-826-initial-owned-input-glm-source.md)，相关 108 项与生成器 42 项检查通过。产品宿主和 macOS 输出不变；`a4ddaf13` 的实际 Windows 编译、两路完整交互及普查已通过。该轮另有真实 CI 消费者漏迁移：旧生成器密封未先执行既有行为逆变换，VM 缺少新增状态。单文件适配保留历史摘要和完整当前 wrapper，原 30 项加两项拒绝控制，同一官方命令由 23 PASS／7 FAIL 修复为 32 PASS／0 FAIL／0 SKIP；[非作者](audit/reviews/activity-826-native-join-consumer-independent-source.md)及[实际 GLM 源码门](audit/reviews/activity-826-native-join-consumer-glm-source.md)均通过，其后精确 PR `7bbda8f9` 与主线 `38a1d6e9` 的完整检查均已全绿；历史红灯仍保留。

正式发布已完成版本一致性、相关测试、精确 PR 和合并后 main CI，以及实际构建输入相同的最终三平台预演。`v0.8.0` 指向已通过的主线 `38a1d6e9`；[正式 Release 工作流](https://github.com/nehcuh/cmspark/actions/runs/41588183961) 五个 job 全部 SUCCESS，发布后四份二进制实际下载流的 SHA-256、六项资产 API digest 与两份校验清单的四行记录均相符。没有执行下载的安装器或二进制。标签内文档保留准备时事实，本页是发布后的正式回执。

[#457 历史验收台账](audit/0.7.0-20260907/release-acceptance.md) 的企业双场景仍未完成；0.7.0 已发布这一事实不证明该验收通过。0.8.0 沿用现有公开发行范围，不将该企业验收列为本次已完成能力；用户本次明确授权发布，未授权扩大企业能力声明。

## v0.8.0 正式发行资产

正式发布时间：**2026-11-03T06:23:26Z**；标签目标：`38a1d6e9ce1f58a842c41fe589bc68a1dd1448e7`，完整树：`2cdb5fba61d27adaa15444d68af1b7ddaace706a`。这四项为正式 Release 资产，大小和摘要不沿用预演的 Actions 外层归档。

下载：[正式 Release](https://github.com/nehcuh/cmspark/releases/tag/v0.8.0) · [SHA256SUMS](https://github.com/nehcuh/cmspark/releases/download/v0.8.0/SHA256SUMS) · [SHA256SUMS.txt](https://github.com/nehcuh/cmspark/releases/download/v0.8.0/SHA256SUMS.txt)。[独立正式发布回执](audit/reviews/activity-826-release-v0.8.0-ci.md)与本页记录实际发布结果。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| [CMspark-Setup-v0.8.0.exe](https://github.com/nehcuh/cmspark/releases/download/v0.8.0/CMspark-Setup-v0.8.0.exe) | 106627995 | `8f909d741b338c207e5f916d7541e691c6d84a5021ac186b6720edb170a3042a` |
| [cmspark-v0.8.0-linux-x64.zip](https://github.com/nehcuh/cmspark/releases/download/v0.8.0/cmspark-v0.8.0-linux-x64.zip) | 140698076 | `1fcc5676398346a275e26ff0da75ed165bb214028e12c01c67024aef53483de6` |
| [cmspark-v0.8.0-macos-arm64.zip](https://github.com/nehcuh/cmspark/releases/download/v0.8.0/cmspark-v0.8.0-macos-arm64.zip) | 158689430 | `6691a8de8dcbb8891733ed2363f457ff92eb7db7f3547091f9e0c35c118b7684` |
| [cmspark-v0.8.0-windows-x64.zip](https://github.com/nehcuh/cmspark/releases/download/v0.8.0/cmspark-v0.8.0-windows-x64.zip) | 164229031 | `a69b5ef45ad2e5091bac8b7b810452f6914ad0fbc30cb716462cdbfc2b1d8e8e` |

两份校验清单分别为 380 字节与 590 字节，均列出相同四项二进制摘要；六项资产的 GitHub digest 也全部匹配。

## 已合并与尚待验收的边界

- **Office**：DOC/DOCX、XLS/XLSX、PPT/PPTX、ODT/ODS/ODP 与 PDF 入口扩展已合入。聊天支持内部为未加密标准 DOC 的 .wps，其他 WPS 变体和 ET/DPS 需另存为标准 Office 格式；严格 XML、表格与图表预算可能拒绝复杂文档。#615 原范围已完成公开大表预算核验，四份原件均未成功转换，不能称为业务大表兼容保证。见 [导入契约](office-import-contract.md)。
- **协作、编程接力与项目**：父任务导航、汇总/操作反馈、终端入口和持久化项目元数据已合入；项目归属不授予目录权限。内嵌终端支持 macOS / Windows、默认关闭，Linux 仍不支持。原生工作区、文件/PTY/编程 Agent 组合的完整验收仍由 [#476](https://github.com/nehcuh/cmspark/issues/476) 跟踪。
- **连续会议**：#494 的有界采集/识别队列已合入；慢识别时继续采集，容量、断连和三小时上限仍会终止输入。连续协议不保留原始音频。见 [会议指南](meeting-and-dictation-user-guide.md)。
- **桌面与 Windows**：已有原生验收仅覆盖记名的工具包、动作和夹具。#572 原范围已完成；macOS AX 的 [#571](https://github.com/nehcuh/cmspark/issues/571) 已按原范围完成 AppKit 后台动作与 WK 已知 TREE_EXHAUSTED Gap 验收；这不表示所有工具包或 WK 根因已修复。上述 #476 整票仍未完成。永久归档的源码能力、数据寿命和原生验收边界见 [归档指南](desktop-thread-archive.md)。能力范围见 [Computer Use 台账](computer-capability-ledger.md)，不把 Linux 或受控 seam 的成功当作 Windows/macOS 原生成功。[#639](https://github.com/nehcuh/cmspark/issues/639) 的历史 10 秒失败根因仍未证明。
- **ITCra 与企业业务**：REST/grant 适配已合入、默认关闭。真实 23 项 P0、业务链接与第二身份验收由 [#618](https://github.com/nehcuh/cmspark/issues/618) 跟踪；模拟驱动与单身份扫码不能替代完整联调。[企业试点](enterprise-pilot.md) 的双场景和 0.7.0 里程碑仍待实际材料验收。
- **LCU 与编辑恢复**：LCU 默认关闭，只对 macOS arm64 / LCU 0.13.0 / ChatGPT 26.1016.61520 / CUA 0.0.33 自有窗口组合有有限实测记录，保留逐次确认和 Touch ID，不推广为 Windows 或全部应用支持。#776 已修当前编辑匹配失败被误判目录拒绝的路径，历史截图的唯一原因仍未关联。Windows OCR #780 已补原单次调用的闭集观察并通过本次原生验收；历史物理根因仍 UNKNOWN，整票保持开放。
- **其它余项**：#621 的条件性非 JSON 编码、#627 的真人图片回执，以及明确冻结/观察期项目保持各自边界。此页与版本号不会自动关闭这些票。

## 后续维护

每批功能或行为修复同时检查对应用户指南、能力台账和 CHANGELOG；版本切点同步包、锁文件、CLI/协议声明、安装器及 README、architecture、AGENTS、CLAUDE、PRODUCT、GOAL 活状态。历史审计与安装记录保留当时版本，不全仓替换。

合并继续遵循相关测试、两路独立非作者复审及精确 head / main CI。正式发布须另走 [发行工作流](../.github/workflows/release.yml) 与 [release guard](../scripts/release-guard.sh)；开发版本记录不替代该流程。
