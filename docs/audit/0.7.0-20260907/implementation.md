# 0.7.0 实施与质量记录

GitHub: [#445](https://github.com/nehcuh/cmspark/issues/445)
分支：`codex/0.7.0-enterprise-workflows`；基线：`63b449d9` / 0.6.6。

## 范围

用户已授权开发，并要求重要节点由 Grok + Claude 独立复审。两个首发必验场景：变更材料草稿、研发需求—故事—代码—测试关联。OS、企业模型服务和验收网页样本尚待补充。未发布、未换装、未提升版本号。

## W1 基础修复

状态：W1 基础修复机器验证与 Grok/Claude 最终增量复审均通过，已在工作分支分项提交；未合入 main 或发布。

| 项目 | 结果 |
|---|---|
| 测试数据隔离 | npm test 入口在应用模块加载前，为每个 Node 进程分配独立数据目录；支持安全的定向测试入口 |
| 实时巡航配置 | 执行器显式接收 currentSecurity，生产两平台保持实时读取，测试默认使用注入配置；危险操作测试不再 saveConfig |
| HTML 范围 | Runtime、ISOLATED、MAIN、DOM 使用同一 selector；不存在目标返回空结果，不读取整页 |
| 自动站点经验 | 版本化稳定标识；旧键按站点与历史 site-op-memory 元数据兼容读取；v1 读写另要求 auto 标签；保留旧文件，不追加到同名人工文档 |

机器记录（Node 22.23.2 / npm 10.9.8，本机 macOS）：

- Companion 最终整套：4927 tests / 4904 pass / 23 skipped / 0 fail；settings 20/20。
- Extension：1266/1266；UI hygiene 通过。
- 两端 `npm run build` 均通过。未构建安装包或执行换装。
- 真正调用 BrowserBridge 的四通道 HTML 范围测试；真正调用 chatCreate 的旧文档碰撞保护测试。
- 测试入口回归包括实际 `run-tests.mjs`、两个工作进程、应用子进程继承、失败退出与数据清理。

测试隔离只保护 CMspark 配置/数据目录，不是主机文件系统沙箱。测试调用外部主机工具仍须使用 fake；直接 `node --test` 绕过安全入口。定向运行先编译，再执行 `node scripts/run-tests.mjs .test-dist/tests/example.test.js`。

## 复审记录

归档目录：`.omx/artifacts/070-w1a/`、`.omx/artifacts/070-w1/`。CLI：Grok 0.2.111；Claude Code 2.1.153。

- W1a Claude：APPROVE_WITH_NITS，但正文包含 MAJOR，按重要发现处理，不能仅解析 verdict 就放行。
- MAJOR：原测试只手动运行 preload，未覆盖实际 Node --test 工作进程。已改为真实 runner 回归，并验证失败清理。
- NIT：清理可能遮蔽原退出码。已处理，清理错误记录原测试码并非零退出。
- NIT：直接运行 node --test 绕过隔离。已提供同一 runner 的定向入口及明确说明；文件系统工具不被伪装为沙箱内执行。
- NIT：crash 测试环境变量未恢复。已恢复。
- NIT：npm 路径断言复制生产默认表达式。已改成显式临时目录输入和路径归属断言。
- Grok 早期调用有缺失判定、读取工具错误、一次 max-turns 退出，均记录为未完成，不算通过。完整批次正在用固定快照复审。

## 后续节点

共享上下文/经验生命周期 → 提取元数据 → 公共业务证据/关联与两个 Pack → MCP 独立授权出口 → 两场景集成验收。

每个节点保留独立评审输入、实际输出、问题处置和机器证据。不能把基础批次全绿表述为 0.7.0 完成。

## 本轮补充（两个场景均首发必验）

- W1 完整 Grok 复审为 APPROVE_WITH_NITS；Claude 指出历史迁移标签可能失配并 REJECT。查证真实历史：63aa4c63 初始写入只有 site-op-memory，6e6bd20d 才增加 auto。已针对旧键只读兼容旧 marker，保留 v1 写入严格校验，增加回归测试；最终增量双路复审进行中。
- 核心契约 R2 两路均 REJECT：故事草稿与事实判定冲突、引用失败未明确状态、来源环境绑定、集合覆盖、业务时间与重试替换规则存在空洞。R3 已逐条补齐并送双路复审，不能将设计文档视为交付证明。
- W2 已有目标解析与共享知识投影代码及真实 SkillEngine 契约测试；未接入 Chat/MCP，尚不构成可用产品能力。目标去除 userinfo/query/fragment，路由变化使用不透明指纹；显式出口选择禁止组路由扩展；hostname hint 不允许出口。
- 复审 CLI 出现无法读取临时路径的输出，未计为通过；使用绝对路径与只读文件工具重试。

最新完整回归：4933 tests / 4910 pass / 23 skipped / 0 fail，settings 20/20，进程 exit 0。该运行包含 W1 最终历史兼容修复与 W2 的 5 个目标/服务测试；不是两个企业业务场景的验收结果。

W1 收口：见 [逐项复审处置](w1-review-disposition.md)。a10addf1 / 3d5bee15 / 14dae2dc / a78236e2。核心业务契约已修订为 R4，仍待独立复审，不把 W1 通过扩张为后续节点通过。

## Issue 闭环补正

此前只有总设计 #445，W1 未先拆实施票，现如实补建 #446–#449；后续 #450–#457 已先建票。PR #458 经 Grok/Claude 双路门禁及 GitHub CI build、Linux/macOS/Windows smoke 全绿后合并，merge commit 53d13b9c1f9e4d915624e698426ccae7904b0c0d；#446–#449 已由 PR 自动关闭。该状态取代上文历史阶段的“仅本地提交”。#451 正在接入实际聊天与经验生命周期，未完成票保持打开。


## W2 / #451 已闭环

提交 96a3ca70；PR #459 于 2026-09-07 合并为 4600abf4。Grok 4.6 APPROVE、DeepSeek V4 Pro APPROVE_WITH_NITS（用户明确接受此模型组合），构建及 Linux/macOS/Windows smoke 全绿，#451 已关闭。详见 451-review-disposition.md 与 model-identity-correction.md。W3/#452 提取和 W4/#453 证据代码仍单独开发，不算在本批交付内。


## 本轮通用实现收口（以此取代上文早期“待实现”状态）

- #452：PR #460 / e3c5540bf049b58b7310e8c7d17fb586247b1023 已合并，通用提取代码与双审/CI完成；真实布局适配继续开放。
- #453 基础：PR #461 / b454d20369fcf1bcf129a3e33240b2cebe43d69c 已合并。
- #453 核对/接入与 #454/#455 两个 Mission：PR #462 / 6c785bce726af37a432a48f52a1e5b357c73b28f 已合并，最新提交 0c47480c 的 build 与三 OS smoke 全绿。核心 Grok 完整R2 +实际 DeepSeekV4Pro R1/聚焦R2、接入两路R2均完成，所有重要发现已解决。#453 通用代码闭环关闭，两个真实场景票继续开放。
- #456：源码已推草稿 PR #463；Grok完整R1与R2增量通过，DeepSeek完整R2待返回。未据草稿PR关闭票或宣称通过全部门禁。
- 当前开发快照 Companion4975pass/23skip +settings20/20、Extension1277/1277及两端构建通过。#457另完成新版创建→0.6.6源码初始化/钥匙写入→新版重读的临时数据保留演练，以及临时归档打包源码门禁124pass/0fail。两版共用当前依赖，不是旧版安装环境回放；无 OS 文件系统沙箱、无旧版 evidence API。见验收台账和机器运行摘要。

模型名称统一以 [身份更正](model-identity-correction.md) 为准：用户已接受 Grok4.6 +DeepSeekV4Pro，历史“Claude”仅指调用 CLI。输出上限中断和取消的复审从不计作批准。源代码、哈希、实际报告、问题处置和 PR/CI 状态分别保留。

版本保持0.6.6，未发包/安装/替换应用。#450 的目标OS、企业模型、授权网页和业务真值仍缺失；两场景真实验收、实际客户端、安装包和浏览器混版不能以合成测试替代。


### 最终代码门禁与交付索引

MCP R2 冻结源码 579f8e70：Grok 完整/增量通过；DeepSeek 三个分包联合覆盖完整包，权限/HTTP/投影全部通过；投影的条件 M1 经完整 producer/lookup 独立复核明确清除。输出上限失败不计通过。R3 审计增量补齐会话入口/拒绝日志和 session_invalid 区分，Grok/DeepSeek 均 0 BLOCK/MAJOR；原始报告、逐条处置、源码清单和最新机器日志摘要均归档。

R3 本机结果：HTTP/context/CLI48/48；Companion4975pass23skip0fail，加settings20/20，productionbuild通过。Extension/SDK 与 R2 相同源码，沿用其已有1277/1277和11/11证据。W7 演练8b415dbd已完成双路R3复审；它是固定0.6.6源码/当前依赖/临时数据目录演练，不是历史安装环境。PR #463 跟踪最终提交的CI与合并，并关闭#456通用实现票；#457保留真实客户端和两场景/模型/安装混版验收。版本仍0.6.6。
