# #488 复审证据

Issue: https://github.com/nehcuh/cmspark/issues/488

外部基线 `4a63de56` → `947532a8`；修复基线 `947532a8`。
用户指定 Grok + DeepSeek 独立复审。本轮外部拉取另有独立 Codex 协议审查。
完整分析与终裁见 [审计正文](../../2026-09-09-windows-thread-ux-review.md)。

## 审阅链

| 证据 | 用途 |
|---|---|
| `incoming.patch.gz`、`grok-packet.md.gz`、`deepseek-packet.md.gz` | 冻结原始外部改动与独立输入 |
| `lane-a-grok.md`、`lane-b-codex.md`、`lane-c-deepseek.md` | 三路初审原文，均要求修复 |
| `round1-packet.md.gz`、`round1-source-manifest.json` | 第一版修复快照 |
| `round1-deepseek.md`、`deepseek-recheck-packet.md.gz`、`pre-receipt-deepseek.md` | 单行删除/else 分支误判，补实证后撤回并放行 |
| `round1-grok.md` | 指出文本后缀不能证明本次保存；并含已亲证不成立的 guard/重复结束/窄屏猜测 |
| `delta-*.md`、`delta-packet.md.gz` | 操作历史文案与测试增量的独立复核 |
| `receipt-*-packet.md.gz`、`final-grok.md`、`final-deepseek.md` | 实际写入回执修复后的独立重审及最终结论 |
| `final-source-manifest.json`、`fixes.patch.gz` | 最终源文件 SHA-256 与完整修复 diff |
| `machine-results.txt`、`*-tests.log.gz` | 机核结果、完整测试日志 |
| `manager-*.png`、`row-actions-*.png`、`resources-*.png`、`skills-*.png` | 实际组件的合成数据截图 |

Grok 通过本机 CLI 显式 `--model grok-4.6 --verbatim --tools none --no-memory
--no-subagents --disable-web-search` 调用；DeepSeek 请求与响应模型均为
`deepseek-v4-pro`，响应元数据保留在相应 `.model.json`。不保存密钥或隐藏推理。
初始独立输入不含其他模型结论；复核只给该模型自己的先前报告及新的代码/机核。
早期 CLI 使用空 tools 参数，一次只返回计划并达到轮次上限；未计为放行。
`grok-incomplete-attempt.md` 保留该失败记录，最终完整重审退出 0。

最终：**Grok APPROVE_WITH_NITS；DeepSeek APPROVE**。非阻断观察的接受理由
在审计正文逐项记录；CI 仍须验证实际 PR 提交，模型结果不能替代 CI。

## 复跑

在仓库使用 `nvm use 22`：

```sh
cd companion
npm test
npm run build
node --import tsx --test tests/meeting-close-contract-488.test.ts
cd ../chrome-extension
npm test
npm run build
uv run --no-project --with playwright python scripts/test-thread-mutations-ui.py
uv run --no-project --with playwright python scripts/test-thread-management-ui.py
uv run --no-project --with playwright python scripts/test-meeting-close-ui.py
uv run --no-project --with playwright python scripts/test-workspace-ui.py
uv run --no-project --with playwright python scripts/test-settings-pages-ui.py
```

会议 fixture 来自 `companion/tests/meeting-close-contract-488.test.ts` 的真实
handleMessage/store 与源码所定义的 WS envelope。设置
`CMSPARK_MEETING_FIXTURE_OUT` 可重新捕获；不对真实用户数据操作。
线程 fixture 的原始捕获脚本与生产函数探针作为 `.ts.txt` 原样保留；按原路径
`.omx/artifacts/pull-20260909-488/` 放置后用 Companion 的 tsx 执行。

## 闸门与限制

按 T3 处理既有持久化删除边界。无新 L2 类、终端自动执行、默认外发或 Trust 豁免。
线程空白删除扩展既有 batch_delete 条件并做空目标只读探测；会议复用已有请求
`id` + `meeting_id`，显式保存复用 set_transcript，不增加后端生产接口。

机器测试、独立复审和当前 PR 提交的 CI 均为合并前置条件。最终裁决读取
`final-grok.md`、`final-deepseek.md`，不能用早期的 APPROVE 或本 README 替代。
Windows 实机界面和真实 ASR 性能尚未在本机验证；图片与浏览器测试使用隔离
合成传输/PCM。项目实体、完整原生工作台仍由 #481/#476 跟踪。
