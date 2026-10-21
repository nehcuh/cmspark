# 聊天事项工作中心：机器与浏览器证据

Date: 2026-10-21。Base `a3ecd5f21e63c05044fd6ced9406168de544b9c1`；branch `codex/chat-action-workspace-752`。
Issues #752 / #753 / #754。能力声明与外部 DoD 见 [实施合同](../../superpowers/plans/2026-10-21-chat-action-workspace-implementation.md)。

## 机器检查

- macOS Node 22.23.2：Companion 与扩展正式 `npm run build` 均 exit 0；产物包含 `tabs/workspace.html`。
- 扩展完整 `npm test`：1,807 PASS，0 FAIL，0 SKIP（含应用选择回执、个人事项与语义设置组件/RPC 用例）。
- Companion 定向家族：活动、语义设置、个人工作区认证、路由/验证锁步、既有 Board Hint、MCP 原子配置/原生通道保存、MeetingPanel 真实组件。最新 73 PASS / 0 FAIL（包含活动 28 项、提醒与留存清理回归）。
- Linux aarch64 隔离容器，Node 22.23.3，非 root 用户，独立文件系统与双端 `npm ci`：Companion `npm run build`、完整 `npm test` exit 0。三个真实 TAP footer 分别 6,368 / 2,295 / 20 tests，合计 8,505 PASS、178 SKIP、0 FAIL、0 CANCEL。跳过项为原有平台条件，没有修改跳过/时限/断言。
- 容器快照之后的增量：扩充敏感应用排除名单、避免每秒复制全部 OCR 的调度器小读取、前端重连后允许新服务从 revision 0 建立基线；以及对抗评审的提醒/留存/最近来源修复；分别用活动家族、两端类型/构建与浏览器增量验证，不把旧快照冒称最终字节的全量测试。
- `git diff --check` exit 0；UI hygiene 通过，无新增生产依赖。

## 真实 App 受控浏览器

`chrome-extension/scripts/render-workspace-fixture.cjs` 构建真实 App；`personal-workspace-ui-fixture.cjs` 使用真实 ActivityService / SettingsAssistant，数据、模型响应、采集器和通知器受控，独立临时目录。不连接 live Companion 或真实聊天。

已检查 1440 / 768 / 390px 截图和 13 条交互断言：今日读取真实处理器数据；候选明确确认才保存；处理完成仍保留反馈义务；采集与模型发送默认关闭；仅点击才枚举应用，勾选不自动保存；语义方案比较不自动写；确认后展示读回回执；语音结束只填草稿；768/390 无横向溢出；窄侧栏保持聊天并打开完整工作页；重连到 revision 0 的新服务会替换旧事项缓存；普通状态保存不改变原始秒/毫秒，也不提交未修改的提醒字段。无未捕获浏览器异常。

Taste inspector：0 FAIL / 3 WARN。保留理由：事项较少时不填充假数据来消除留白；强边界来自既有导航/控件，内容分隔仍为低对比线；12px 用于来源次行和既有导航，主体与表单为 13–14px。已查看桌面、平板、手机、来源详情、应用设置及语义候选截图。

## 首轮失败及归责

1. 新导入的泛型箭头被旧 Board/会议测试加载器按 TSX 解析；属于本次兼容缺陷。改为 TS/TSX 均合法语法，原完整回调复验通过，未弱化旧测试。
2. 新路由的校验函数简写不被既有源解析门识别；改为与现行表一致的显式 lambda，锁步原门通过，未加 allowlist。
3. 本机全量探索运行受继承的模型环境变量、未构建的原生夹具、权限/PTY及 Office 转换进程影响，没有通过；保留失败，不当作已完成本机原生验收。去除继承 provider 环境后原 MCP 原子配置测试通过；原生构建单独通过。
4. 首次容器准备遗漏前端 React 依赖且以 root 运行，分别使真实组件和只读目录负控失败；属于验收准备错误。重建非 root 容器、完整双端依赖后原完整 suite 通过。没有改断言、预算或生产权限。

## 仍需现场验收

真实 macOS TCC / ScreenCaptureKit / Vision OCR、实际已配置模型质量及系统通知展示未在用户桌面执行。受控适配器证明的是约束、数据和生命周期，不代替真实权限/准确率/送达。Windows/Linux 活动截图明确不支持；提醒提交不代表已读。未安装、替换运行中的 App，未开启用户采集。

## Eval gate

Blast tier T3。MACHINE：相关检查 PASS（范围如上）；独立对抗初轮 REJECT 的三处 P2 已修复，R2 APPROVE（独立复跑 Companion 39、扩展 14 项均通过）。Pi APPROVE_WITH_NITS（CLI 0.85.1；自报 deepseek/deepseek-v4-flash），独立重跑相同 53 项检查并作 wire-level 探针；非阻断 N2–N5 由 @nehcuh 在 #756 跟踪，N1 为真实改期契约且当前 UI 已保留未编辑精度。CI 尚待精确提交验证，当前未合并。

## 首轮对抗发现处置

| 发现 | 修复与回归 | 状态 |
| --- | --- | --- |
| F1 普通保存重新排提醒 | 后端比较规范化时刻后才重新排程；前端省略未编辑的时间字段，保留原始秒/毫秒。覆盖已提交/失败/未知、时区等价、真实新时刻及迟到旧回执。 | 已修，独立 R2 已确认 |
| F2 暂停后不按期限清理 | 启动及每分钟独立维护，平台/采集开关不影响保留期与配额；批量单次提交；抽取提交再核对来源存在、hash 与 OCR。覆盖暂停/不支持平台、容量、期限和清理期间迟到结果。 | 已修，独立 R2 已确认 |
| F3 最近来源顺序反了 | 实际来源组件使用后台最新优先的前 30 条；31 条来源的 SSR 与实际最新按钮回调测试。 | 已修，独立 R2 已确认 |

Case：本次实施把普通表单保存等同重新排程、把维护绑定采集、把 newest-first 再反转。
结果：独立评审复现三处真实 P2，初始结论 REJECT。
归责：实施代码缺陷，未归咎环境或模型判断。
保护：用户确认的提醒、暂停后的隐私保留期及最新来源可追溯；修复后须独立复核，再进入 Pi。

Pi 复审冻结 diff SHA-256：`5047982c6351016f7df706b59e4bc493e7b50e352a0821d407411ffcdb268113`。复审后只补充本结果、文档导航/测试地图与元数据预算说明，没有再修改生产或测试代码。完整报告见 [Pi 复审](2026-10-21-chat-action-workspace-pi.md)；后续意见 [#756](https://github.com/nehcuh/cmspark/issues/756)。
