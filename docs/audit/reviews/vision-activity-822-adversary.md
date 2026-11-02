# #822 独立对抗评审

审查范围：`origin/main`（5abfa911）至本次工作区实现与新增文件；本轮包含两项已确认发现的修复，以及 `91ed14c3..7eb1a5a0` 的最终小增量。独立审查未修改生产实现。

## 当前结论

本轮两项发现均已修复。所审验收路径未发现剩余阻塞，可以进入 Pi 复审。

## 能力与验收

Surface 为视觉设置、工作中心、activity 与 Qwen worker；无新增电脑输入操作或采集授权。图片、转录和模型输出为不可信数据。兼容 OpenAI/Anthropic，保留旧 OCR，图片处理独立授权且绑定目标，专用凭据不回显，导入后直接生成待确认候选，本机 Qwen 不回退云端，取消后结果不入库。

## 已核实的修复

### P1：旧表单不能为变更后的全局视觉目标重新授权

`companion/src/activity/service.ts` 通过 runtime 返回各模式的 `model_target_ids`；`ActivityConfigEditor` 在打开时用 `useRef` 同时冻结展示的标签和 identity，并将该 identity 作为 `expected_model_target` 提交。服务端对复用视觉和 Qwen 的图片授权精确匹配当前目标，不匹配返回 `MODEL_TARGET_CHANGED`，授权不入库。

已核对请求验证器、表单提交、后台授权与公开状态四处接线。新回归 `an open consent form cannot authorize a globally changed vision endpoint` 验证全局配置更改不改变 activity revision 时旧表单仍被拒绝，并验证重新读取目标后可正常授权。

### P2：复用主配置保持已有专用视觉 Key

`chrome-extension/src/sidepanel/components/vision-reuse-logic.ts` 的复用补丁只包含协议、auth 复用选择、URL/model 等字段，不含 `vision_api_key`。`companion/src/settings-web.ts` 的复用按钮也保持视觉 Key 输入框原值。已有专用 Key 因此保留，空值继续由 Companion 的占位凭据继承规则处理。

已核对扩展与 CLI 两条 UI 路径及后台已有密钥保持规则。扩展纯函数测试验证明文主 Key 也不产生视觉 Key 补丁；CLI 的真实页面脚本 VM 回归验证专用 Key 保留、空 Key 保持空值和 Anthropic 协议复制。

## 其它已核对路径

- Anthropic 图片消息经现有 provider 转为 image/base64，沿用既有请求头策略。
- 图片与 OCR 授权分开；专用 Key 公开投影为空值及已配置标记。
- 图像候选引用须存在于此次 transcript；正式待办仍需确认。
- 本机分支使用 Qwen session 并在 finally 释放；worker 读图输出不走坐标解析，权重读取使用 local_files_only。
- 服务 generation/AbortSignal 与提交前 target 检查拒绝已撤销请求结果。

## 最终小增量复核

已逐项检查 `git diff 91ed14c3..7eb1a5a0`，原批准保持：

- 真实 UI 回归操作生产表单，验证 OCR/图片授权分开、切换模式清除授权，并验证展示目标及提交 identity 同时冻结。
- CLI 复用提示已明确专用 Key 保持；GET 与 POST 的视觉配置统一使用既有 `settingsWebLlmResponse` / `settingsWebLlmUpdate`，额外请求头值被遮蔽，掩码不会替换后台原值。新测试通过真实配置保存 producer 验证视觉请求头保持。
- `unittest.mock` 顶层导入支持 unittest 收集；worker 行协议注释包含 analyze；删除的 import 未改变 SSRF 调用门。
- Anthropic HTTP 测试改用 loopback 假端点，仅隔离测试 DNS 前置；生产 DNS 与 IMDS 门未改动。
- machine.md 如实记录最终提示词下本机权重仍将项目名识别为 owner；候选需人工核对的产品行为保持，未宣称字段质量基准通过。

本增量无新增阻塞发现。

## 机器证据

独立复审执行：

```text
cd companion
node scripts/run-tests.mjs .test-dist/tests/vision-activity-822.test.js .test-dist/tests/settings-web-draft-806.test.js .test-dist/tests/settings-web-redaction-806.test.js
exit 0 · 8 tests · 8 pass · 0 fail
uv run python -m unittest discover -s tests -p test_qwen_image_822.py
exit 0 · 1 pass
```

该 runner 在应用 import 前隔离 DATA_DIR；未读取或修改 live config。实现侧最终增量记录：扩展相关 26 pass 与 build pass（此前全量 1861 pass），Companion 最终 build pass；此前相关 225 项为 224 pass/1 Windows 平台 skip，额外相关 84 pass；Python worker 1 pass。增量未要求重跑输入未受影响的已通过测试。

本审查不声称真实权重抽取质量或 Windows 原生采集已实测；相应平台和真实模型证据按已有交付范围报告。

VERDICT: APPROVE
