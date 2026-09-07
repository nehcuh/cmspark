# W1 独立复审处置

本批仅基础修复，不代表 0.7.0、两个 Pack 或 MCP 新出口已经交付。基线 63b449d9；评审 CLI 为 Grok 0.2.111 / Claude Code 2.1.153。模型版本和原始输出保存在本地 `.omx/artifacts/070-w1/`，未完成输出不算通过。

| 发现 | 处置与证据 |
|---|---|
| 测试只有 preload 子进程，没有真实 Node test runner | 已补真实 runner、两个 worker、应用子进程、非零退出/清理与定向不运行其他测试的契约 |
| caller 配置不存在导致保护断言空洞 | 已先写 sentinel，断言实际内容未变 |
| macOS /var 与 /private/var 路径归一不一致 | 发现文件与请求文件两侧均 realpath |
| 清理错误遮蔽原退出码 | 保留原失败码；原成功但清理失败则非零，日志记录原测试码 |
| 直接 node --test 绕过隔离 | 明示限制；支持同一 runner 的定向入口，不声称是主机文件系统沙箱 |
| 测试改真实配置 | crash/prefix/cruise 测试改显式临时目录或注入配置；当前 runner 每进程隔离 |
| 巡航配置回调未来可能漏接 | 当前生产调用点只有 Mac/Windows 两处，均显式提供实时回调；省略只为注入配置调用兼容。无新增授权能力 |
| HTML selector html/:root 行为 | 明确采用 document.querySelector，四执行路径一致；选择 html 就是整页，missing 是空结果 |
| 捕获指定 window 而非当前焦点窗口 | 保留：避免校验 A tab 却截取 B 窗口；不可捕获时返回错误，不以其他窗口代替 |
| scripting source 仍写 runtime | W1 不宣称修复执行通道元数据；列入 W3，当前保持原返回字段兼容 |
| v1 冲突身份无真实聊天测试 | 已补真实 chatCreate：人工文档原字节不变，持久化失败不终止聊天 |
| 新持久化结果未通过真实读取 helper 回读 | 已补生成条目与 readSiteExperienceEntries 返回一致断言 |
| 旧自动文档可能没有 auto 标签（Claude MAJOR） | 真实历史确认：63aa4c63 只有 site-op-memory，6e6bd20d 增加 auto。只对 legacy 读取兼容旧 marker；v1 读写仍要求两标签，所有路径要求 type/site 匹配 |
| www/大小写的旧键可能遗失（Grok BLOCK） | 原评审片段缺上游规范化。已补完整历史源码：originKeyFromUrl 使用 WHATWG URL，canonicalizeSiteOrigin 去 www，recordSiteOpFailure 返回该 origin。不能据原始 tab URL 推断 www 文件名；交回评审核对 |
| 非默认端口的旧键 | 已修：legacyId 保留已知 origin 的非默认端口；新增定向用例。仅 hostname 的旧调用者不能发现未知端口文件，此已有局限待 W2 实际目标解析，不宣称全库迁移 |
| stale v1 与活跃 legacy 重复 | v1 优先是显式撤销优先，避免旧条目重新激活已标 stale 的同文记录 |
| mixed manual+site-op-memory 旧标签 | 保留历史 marker 的只读语义，不把标签当安全授权；自动写入仍需 auto。人工编辑混合标签文档不保证排除读取，修正文档绝对化表述 |
| 无效 URL 的错误类型不统一 | 私有 helper 调用均有 best-effort catch；不新增外部错误协议，暂不改异常类型 |
| Node 23 未单测 | 本次实测 Node 22.23.2，不声明 Node 23 已验证；隔离标志兼容逻辑沿用 runner 分支 |

## 机器证据

- 当前完整树：4933 tests / 4910 pass / 23 skipped / 0 fail，settings 20/20，exit 0；包括 W2 的五个未接线目标/服务测试。
- 最后端口修正后：站点身份与实际聊天持久化定向 11/11，exit 0。
- Extension 1266/1266，UI hygiene 通过；此前两端 build 通过。
- 真实企业网页/模型验收尚未进行；合成测试不能代替两场景首发验收。

## 当前门禁

完整 W1 Grok APPROVE_WITH_NITS；Claude 历史 marker 阻断修复后 APPROVE_WITH_NITS。最后端口调整与上游历史证据的两路补审均为 APPROVE_WITH_NITS，无剩余阻断。补齐 www+大写+端口组合断言及冲突身份禁止旧键回退断言，定向 11/11 通过。基础修复已分项提交：a10addf1（测试隔离）、3d5bee15（实时策略）、14dae2dc（HTML 范围）、a78236e2（经验身份）。仅本地工作分支提交，未合入 main、未推送、未发布。
