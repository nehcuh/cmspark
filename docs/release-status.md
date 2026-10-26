# 版本与交付状态

> 源码开发版本 **0.7.0（尚未正式发布）** · 核对日期：2026-10-26。

## 源码、发行包与已安装应用

| 项目 | 当前事实 |
|---|---|
| 源码版本 | Companion 与扩展统一为 **0.7.0**；CLI、协议版本声明和安装器默认值同步。能力变化见 [CHANGELOG](../CHANGELOG.md)。 |
| GitHub 正式发行包 | 截至核对日期，最新为 [v0.6.11](https://github.com/nehcuh/cmspark/releases/tag/v0.6.11)，发布于 2026-09-30。0.6.12 / 0.6.13 / 0.6.14 的源码记录不等于已发布同名安装包。 |
| 本机应用 | 源码合并和版本号更新不会自动换装应用、重载扩展或更新 ITCra。历史 0.6.13 换装记录只说明当时的环境。请分别核对实际运行的 Companion 与扩展版本。 |
| 本批动作 | 准备 0.7.0：归档全部未发布优化与修复，同步版本和指南；发布标签与安装包仍待发行门禁。本机 macOS 换装已获授权，待本批验证完成后执行，不能把准备状态当作已安装。 |

## 本次发布准备的验收基线

PR #781 已合入主线 `b4a84a0651a3738e32fe9c9948450a198369ab00`，与受审全树一致；[CI 40269449616](https://github.com/nehcuh/cmspark/actions/runs/40269449616) 及会话恢复共 8 项通过，包含 Windows/macOS 原生验收。Windows 官方公开回执核实 5,786 份源码、9,491 PASS / 65 既有 SKIP / 0 FAIL；跳过不算通过，公开回执也不替代 #650 严格密封证据。此为版本同步前的基线，本次 0.7.0 提交仍须通过自己的复审与 CI。

0.7.0 包含此前未正式发布的 0.6.12、0.6.13、0.6.14 及全部 Unreleased 优化和修复。产品版本号不把延期需求重新纳入，也不代表 [#457 企业里程碑历史台账](audit/0.7.0-20260907/release-acceptance.md) 已通过。

## 已合并与尚待验收的边界

- **Office**：DOC/DOCX、XLS/XLSX、PPT/PPTX、ODT/ODS/ODP 与 PDF 入口扩展已合入。专有 WPS/ET/DPS 尚不支持；严格 XML、表格与图表预算可能拒绝复杂文档。#615 原范围已完成公开大表预算核验，四份原件均未成功转换，不能称为业务大表兼容保证。见 [导入契约](office-import-contract.md)。
- **协作、编程接力与项目**：父任务导航、汇总/操作反馈、终端入口和持久化项目元数据已合入；项目归属不授予目录权限。内嵌终端支持 macOS / Windows、默认关闭，Linux 仍不支持。原生工作区、文件/PTY/编程 Agent 组合的完整验收仍由 [#476](https://github.com/nehcuh/cmspark/issues/476) 跟踪。
- **连续会议**：#494 的有界采集/识别队列已合入；慢识别时继续采集，容量、断连和三小时上限仍会终止输入。连续协议不保留原始音频。见 [会议指南](meeting-and-dictation-user-guide.md)。
- **桌面与 Windows**：已有原生验收仅覆盖记名的工具包、动作和夹具。#572 原范围已完成；macOS AX 的 [#571](https://github.com/nehcuh/cmspark/issues/571) 已按原范围完成 AppKit 后台动作与 WK 已知 TREE_EXHAUSTED Gap 验收；这不表示所有工具包或 WK 根因已修复。上述 #476 整票仍未完成。永久归档的源码能力、数据寿命和原生验收边界见 [归档指南](desktop-thread-archive.md)。能力范围见 [Computer Use 台账](computer-capability-ledger.md)，不把 Linux 或受控 seam 的成功当作 Windows/macOS 原生成功。[#639](https://github.com/nehcuh/cmspark/issues/639) 的历史 10 秒失败根因仍未证明。
- **ITCra 与企业业务**：REST/grant 适配已合入、默认关闭。真实 23 项 P0、业务链接与第二身份验收由 [#618](https://github.com/nehcuh/cmspark/issues/618) 跟踪；模拟驱动与单身份扫码不能替代完整联调。[企业试点](enterprise-pilot.md) 的双场景和 0.7.0 里程碑仍待实际材料验收。
- **LCU 与编辑恢复**：LCU 默认关闭，只对 macOS arm64 / LCU 0.13.0 / ChatGPT 26.1016.61520 / CUA 0.0.33 自有窗口组合有有限实测记录，保留逐次确认和 Touch ID，不推广为 Windows 或全部应用支持。#776 已修当前编辑匹配失败被误判目录拒绝的路径，历史截图的唯一原因仍未关联。Windows OCR #780 已补原单次调用的闭集观察并通过本次原生验收；历史物理根因仍 UNKNOWN，整票保持开放。
- **其它余项**：#621 的条件性非 JSON 编码、#627 的真人图片回执，以及明确冻结/观察期项目保持各自边界。此页与版本号不会自动关闭这些票。

## 后续维护

每批功能或行为修复同时检查对应用户指南、能力台账和 CHANGELOG；版本切点同步包、锁文件、CLI/协议声明、安装器及 AGENTS/CLAUDE 活状态。历史审计与安装记录保留当时版本，不全仓替换。

合并继续遵循相关测试、两路独立非作者复审及精确 head / main CI。正式发布须另走 [发行工作流](../.github/workflows/release.yml) 与 [release guard](../scripts/release-guard.sh)；开发版本记录不替代该流程。
