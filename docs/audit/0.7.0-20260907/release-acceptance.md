# 0.7.0 发布验收台账（#457）

**状态：未达到发布条件。版本保持 0.6.6。** 两个企业场景都必验，不以其中一个成功替代另一个；工具连接、合成 ready、代码评审、单元测试均不代替业务真值。

## 可复核的机器证据

实际运行摘要、原始日志摘要校验和、对应本地日志位置及复跑命令见 [machine-evidence.json](machine-evidence.json)。这是执行记录，不是复审模型重新跑过测试的声明；各产品批次仍有自己的源码冻结清单和门禁。

| 项目 | 证据 | 范围 / 状态 |
| --- | --- | --- |
| Companion 回归 | 4975 pass / 23 skip / 0 fail；settings 20/20；build 通过 | R2 开发快照，本机 macOS / Node 22.23.2 |
| Extension 回归 | 1277/1277；build 通过 | 当前开发快照；不代表已加载企业浏览器 |
| MCP SDK 档案 | 11/11 档案测试（含新 site_context schema） | 默认 8 工具、新上下文 9 工具；另各有 2 元工具 |
| MCP 定向 HTTP/权限/CLI | 48/48 | R2，包括失效句柄与 origin 拒绝区分、返回前撤销、恢复不自动重试 |
| 0.6.6 初始化/钥匙写入保留演练 | `companion/scripts/rehearse-enterprise-roundtrip.mjs`；`roundtrip-result.json` | 新版创建 → 63b449d9ff77c2c37af54579fbff3b628df286c1 初始化/钥匙操作 → 新版重读；两版使用当前依赖 |
| 打包源码门禁 | `scripts/tests/test-package-gates.sh`，124 pass /0 fail | HEAD 临时归档中运行；缺原生制品的正例跳过，未构建安装包，现用目录未改动 |
| 草稿核心 / 聊天与两个 Pack | 各自冻结清单和 Grok/DeepSeek 报告 | 逐批门禁，不能推定其他批次通过 |
| MCP 权限出口 | #456 独立冻结包和双审 | 不扩大 default/interact；不推定企业允许外部出口 |

脚本把当前 Companion 源码与 BrowserBridge fixture 复制到临时目录，分别记录 Companion 源码（src/tsconfig/package）、fixture 和脚本 SHA-256。创建数据使用真实 BusinessEvidenceService、BrowserBridge 录制 fixture 与 grant producer；未知版本测试仅修改其版本字段的语义值后重新序列化，不声称只有一个字节发生变化。旧版实际 initDataDir/verify/issue 后，断言钥匙文件发生变化、旧版新签发记录存在且可认证，并直接对比旧写入前后原 context 记录，避免新版 parser 默认值掩盖字段丢失。最后由新版认证这把旧版签发的钥匙，重读草稿 revision、引用 ID、原请求回放和知识字节。每个子进程必须返回全部断言完成的标记，父进程才记录该阶段通过。

基线 0.6.6 **没有** evidence/draft 模块；旧阶段仅验证初始化和钥匙写入不破坏新目录，不声称旧版能读材料或拒绝新 evidence schema。未知 schema 的拒绝由最后的新版执行。两版源码都链接当前 `companion/node_modules`；历史 lockfile/依赖漂移未演练，不是完整的 0.6.6 安装环境回放。

三个子进程使用临时工作目录、显式应用数据目录和不含模型凭据的最小环境。此为应用配置隔离，**不是 OS 文件系统沙箱**，没有拦截 `os.homedir()`；脚本只调用配置初始化、材料/钥匙 API，不运行主机或浏览器工具。临时 token 不输出且数据在 finally 清除。本证据不覆盖安装包、完整进程启动、三 OS、浏览器混版或企业模型。

复跑（仓库根目录，已安装项目依赖）：

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 22
node companion/scripts/rehearse-enterprise-roundtrip.mjs
```

## 仍阻断发布的验收

| 必验项 | 所需记录 | 当前状态 / Issue |
| --- | --- | --- |
| 真实运行环境 | 目标 OS/浏览器版本、模型实际标识/版本、允许的数据范围、操作者 | 待试点输入 #450 |
| 静态/分页/虚拟化/iframe | 两场景全部必需集合实际布局、完整范围和空标记；复杂结构需专用遍历适配 | 待真实网页 #450/#452 |
| 变更材料 | DevOps release/build、制品 digest、架构依赖/影响、CMDB 运行资产/业务时间的人工真值与来源 | 待无 Codex 的产品入口实测 #454 |
| 研发追溯 | 需求/标准、明确创作的故事、代码身份、测试/标准用例对应、缺陷状态的人工真值与来源 | 待无 Codex 的产品入口实测 #455 |
| 生产模型适配 | 实际企业模型能按严格 schema 发起 4 个工具调用；缺引用/工具失败/重试时不谎称齐备 | 待批准模型和两场景轨迹 #457 |
| 两场景负例 | 错环境/系统/版本、无源业务时间、过期、分页未知、截断、容量、跨 scope、关系缺失 | 合成核对测试见 `companion/tests/business-evidence-{scenarios,field-checker,store,draft-repository}.test.ts`；真实场景未验 #453–#455 |
| 独立运行约束 | 两个 Mission 都不需要 Codex、shell、CU、worker/ACP；既有停止/确认/只读门禁保留 | PackEngine/WS 已测；真实模型入口未验 #454/#455 |
| MCP 实际客户端 | 获准出口时实际编程助手的所选知识、精确 origin、撤销、同 grant/session 隔离 | SDK/HTTP 已测；真实客户端未验 #456 |
| 安装包与进程 | 三 OS 安装/启动/停止；旧扩展配新 Companion 以及相反组合；再升级仍读旧材料 | 初始化/钥匙写入保留演练已过；完整安装/混版未验 #457 |
| 批次闭环 | Issue 分析 → frozen review → fix/disposition → commit/PR → CI/merge → 验收 | 以逐票记录为准；开放票不视作发布完成 |

记录模板在 [企业试点指南](../../enterprise-pilot.md)。企业页面、凭据、原始 query/fragment 和业务真值留在获准的私有环境；公开 Issue 仅记录脱敏运行 ID、候选 commit/契约摘要、结果和失败类别。不得把示例域名、空 pilot 或未知集合状态补写成通过。

完成上表所有发布阻断项后才能做版本决策、版本锚同步、打包/发布和对应 Issue 关闭；本次机器检查不授权绕过这些条件。
