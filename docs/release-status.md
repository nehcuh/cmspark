# 版本与交付状态

> 源码开发版本 **0.8.0（尚未正式发布）** · 核对日期：2026-11-02。

## 源码、发行包与已安装应用

| 项目 | 当前事实 |
|---|---|
| 源码版本 | Companion 与扩展统一为 **0.8.0**；锁文件、CLI、协议声明和安装器默认值同步。 |
| GitHub 正式发行包 | 发布准备时最新为 [v0.7.0](https://github.com/nehcuh/cmspark/releases/tag/v0.7.0)。0.8.0 须在主线 CI、三平台 dry-run 与 tag Release 成功后才算正式发布。 |
| 本机应用 | 2026-11-02 换装前实际版本为 `0.7.1-preview.20261031.2`。源码合并和版本号更新不会自动替换本机应用或重载扩展。 |
| 本批动作 | 归档 0.7.0 后增量，准备 0.8.0；新增跨协议视觉与工作中心截图待办，保留独立模型、本机 Qwen3-VL 和目标绑定授权。 |

## 发布验收基线

视觉功能 [PR #823](https://github.com/nehcuh/cmspark/pull/823) 已合入 `55152f741d06dc64158135cb0ca5e44e9b245ef2`；该提交的 [主线 CI](https://github.com/nehcuh/cmspark/actions/runs/41450565129)、会话恢复与两项 ARM 验收均成功。Linux 夹具观察 [PR #821](https://github.com/nehcuh/cmspark/pull/821) 旧 head 的 Windows 终端用例曾在 45 秒内未开始操作，观察记录前台属于其它进程；这不足以证明唯一根因。集成最新 main 后核对同一提交的完整门禁，不放宽时限、跳过用例或将观察本身当作修复。

正式发布前须完成版本一致性、相关测试、精确主线 CI 与 [Release 工作流](../.github/workflows/release.yml) 的三平台 dry-run，再对通过的提交打 `v0.8.0` 标签。发布前页面不预记发布成功；标签内页面保留准备时状态，发布后的回执另更新主线文档。

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
