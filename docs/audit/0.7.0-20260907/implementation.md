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
