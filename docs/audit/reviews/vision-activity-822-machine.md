# #822 机器与界面验证

Base: origin/main `5abfa911`。Node `22.23.4`，macOS arm64。所有测试使用隔离 DATA_DIR；未修改 live config.json。

## 结果

- Companion `tsc -p tsconfig.test.json`：exit 0。
- Companion 定向 family：225 项，224 pass、1 Windows 原生平台 skip、0 fail。覆盖视觉/provider、密钥继承、activity、跨平台适配、Qwen 定位/权重、配置及设置网页。
- Companion 配置凭据、广播遮蔽、工作中心权限、设置网页及新增图像路由：84 pass；评审修复后目标绑定与真实 CLI 脚本回归：7 pass。
- 扩展 `npm test`：1861 pass、0 fail、0 skip；包含真实组件行为的工作中心回归。
- Companion 与扩展 `npm run build`：均 exit 0。
- `uv run python companion/tests/test_qwen_image_822.py`：1 pass，执行真实 worker 的 analyze 函数，保留完整转录输出及 4096 token 生成预算。

## 实际界面

模型选择、授权清除与冻结目标提交也已补入真实 UI 回归；视觉请求头遮蔽与 Python unittest 收集回归通过。CI 首轮发现 HTTP 测试桩用了 .example 域名导致 Linux DNS 拒绝，已改用 loopback 假端点并保留生产 DNS 防护。

用真实 React 组件与现有样式、惰性测试后台渲染活动记录。实际操作验证了模式选择、独立 Anthropic URL/model、修改模型后图片授权清除、Qwen 授权保存，以及保存后“选择 PNG 并抽取待办”入口。390 / 768 / 1440 CSS px 的文档宽度分别等于视口，无横向溢出；已查看截图。此界面测试不读取真实聊天或执行真实采集。

## 本机真实权重烟测

使用已安装 Qwen3-VL 2B、既有独立 Python 环境和仓库合成图片 `companion/tests/fixtures/activity-linux-758.png`，调用实际 Qwen session → worker → 本机权重 → 图像结果解析链。权重校验和加载按生产代码执行，无自动下载，临时 DATA_DIR 与工作进程在结束时清理。

验收要求：转录包含 `PROJECT ALPHA SEND REPORT FRIDAY`，返回提交报告的候选及来自转录的原文引用，正式待办仍需确认。本机烟测结果为 title=提交报告，owner=PROJECT ALPHA；后者是项目名归属误判，需要用户核对。烟测验证实际调用链与行动抽取，不把小模型的每个语义字段当作已验证事实，也不代替模型质量基准或 Windows 原生运行验收。

## 评审

独立对抗报告：`vision-activity-822-adversary.md`，APPROVE。Pi 复审结果另存同目录；机器证据通过不替代独立放行。

最终增量放行：独立对抗 APPROVE；Pi CLI 0.85.1，固定 deepseek/deepseek-v4-flash，APPROVE_WITH_NITS。最终机器增量为 Companion 8 pass、HTTP 22 pass、扩展 UI/vision 26 pass、Python unittest 1 pass；其余相关通过结果复用。Pi 复审报告见同目录 `vision-activity-822-final-pi-20261102-203831.md`。
