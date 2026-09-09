# #490 分布图谱复审与验收证据

Base `aada096a`。初审：Grok 4.6、DeepSeek V4 Pro 分别读取相同冻结输入，未共享报告。
对事实争议补真实Chrome及生产回包证据，再独立增量审查最终代码。
不会把本机子代理或实现者自查冒充外部模型。

- `review-packet.md.gz` / `review-source-manifest.json`：初次完整差异与源、机核摘要。
- `grok-review.md` / `deepseek-review.md`：初次完整报告，均带非阻断建议。
- `recheck-packet.md.gz` / `deepseek-final.md`：指针捕获/回执等事实纠偏，原始报告保留。
- `delta-packet.md.gz` / `grok-delta.md` / `deepseek-delta.md`：相机/忙态改进与最终测试增量。
- `final-small-packet.md.gz` / `grok-final.md` / `deepseek-small-final.md`：页面边距及严格相机取帧的最后小幅复核。
- `before.json` / `before.png` / `ui-red.log`：同基线真实异步Canvas失败，不是合成黑屏图片。
- `ui-*.log`、各尺寸PNG、`initial-200-frames.json`、`camera-preservation.json`：真实组件与像素/键盘/可信触摸证据。
- `backend-*.log` / `organize-*-frames.json`：真实生产函数与handleMessage红绿回归及序列化回包。
- `final-source-manifest.json` / `checksums.json`：最终源与归档文件校验和。
- `built-smoke.log` / `built-*.png` / `built-smoke.py`：实际Plasmo HTML与JS的独立加载，只有Chrome transport被替换。

复现（Node先`nvm use 22`，Python使用uv）：

```sh
cd chrome-extension
npm test
npm run build
uv run --with playwright python scripts/test-knowledge-graph-ui.py
# 对照基线预期exit1；需要仓库含aada096a提交：
uv run --with playwright python scripts/test-knowledge-graph-ui.py --baseline
```

Companion执行`npm test`；图谱目标用tsconfig.test.json编译后执行
`node --test .test-dist/tests/knowledge-graph.test.js .test-dist/tests/knowledge-graph-organize.test.js`。
浏览器使用隔离headless Chrome和合成非用户语料，storage/runtime为边界替身；图构建、frame
序列化、解析和React/Canvas是真实代码。不是用户原库、Windows实机或完整扩展安装链路验收。

能力边界：T2，既有panel-only图谱，新增optional response boolean，无新动词/权限。
AI命名默认关闭并延续已保存偏好；整理仍须显式操作。#491缓存权限失败独立跟踪。
