# Pi 最终增量复审：#822（`91ed14c3..7eb1a5a0` + 对抗报告更新）

**范围一句话**：本轮只含隐私同族补齐（settings-web 视觉 GET/POST 走既有遮蔽/回写 producer）、CI 测试桩改 loopback、扩展补真实 UI 回归、Python 收集与 worker 注释小修，外加 machine.md 证据表述修正。只读，未编辑任何文件。

## 我自己跑出的证据（未引用他人日志）

| 检查 | 结果 |
|---|---|
| `companion npx tsc -p tsconfig.test.json` | exit 0 |
| `run-tests.mjs` 822 + draft-806 + redaction-806 | 8 pass / 0 fail（含 test 8 `MODEL_TARGET_CHANGED`） |
| `run-tests.mjs settings-web.test.js`（HTTP 层，port 串行） | 22 pass / 0 fail |
| `run-tests.mjs llm-endpoint-url + llm-provider-anthropic`（DNS/IMDS 门） | 48 pass / 0 fail |
| `uv run python -m unittest discover -s tests -p test_qwen_image_822.py` | 1 pass（顶层 `unittest.mock` 后收集路径成立） |
| 扩展 `tsc -p tsconfig.test.json` + `node --test activity-bulk-753-ui.test.js` | 9 pass / 0 fail（含新增 822 UI 用例） |

扩展依赖未变，未重跑 1861 全量；companion 输入未受影响处复用首轮 695。

## 增量逐项核对

- **UI 真实组件回归成立**（`chrome-extension/tests/activity-bulk-753-ui.test.ts:404-431`）：`controller.mutate` → `fixture.handle` → 真实 `ActivityService`，非桩算法；用例断言 OCR/图片授权分离（`ocr_ai_enabled:false` / `image_ai_enabled:true`）、`mode` 切换清空勾选、`displayedTargets` ref 冻结使篡改后的全局标签不出现、`expected_model_target === shownTarget` 与落库 `extraction_mode==='vision'`。首轮 nit 3 已闭合。
- **视觉隐私同族补齐正确**：`companion/src/settings-web.ts:351,378,396` 改用 `settingsWebLlmResponse`/`settingsWebLlmUpdate`。GET 现遮蔽 `vision.extra_headers`（此前明文回显，同族缺口）；回写时 `"***"` 占位被剔除（`settings-web.ts:49`），`saveConfig` 走 `deepMerge`（`config.ts:1465`）保留后台原值——这同时修掉了「掩码被当真实值覆盖专用 header」的破坏路径。CLI `collect()`（`settings-web.ts:891-911`）不发 `extra_headers`，无回归。
- **删 import 安全**：`assertLlmEndpointAllowedAsync` 在 settings-web 内已无静态调用，SSRF 门仍在 `llmHostBlockReason`（`settings-web.ts:168-200`）+ `probeLlmConnection` 动态导入；HTTP 层 22 pass 佐证。
- **loopback 测试桩未削生产门**：`vision-activity-822.test.ts:27,31` 仅换端点；`vision-pipeline.ts:191` 的 `assertLlmEndpointAllowedAsync` 未改；IP 字面量在 `security.ts:353-357` 跳过 DNS，故不触及生产 DNS 行为。DNS/IMDS 判定另有 48 pass 覆盖，不构成覆盖损失。
- **CLI 文案**（`settings-web.ts:1005`）与扩展侧一致，首轮 nit 4 闭合；`qwen-vl-worker.py:6,11` 补 `analyze`，nit 7 闭合；`test_qwen_image_822.py:7` 顶层导入，nit 6 闭合。

## Nits（不阻塞）

1. **P2/NIT 证据溯源** `docs/audit/reviews/vision-activity-822-machine.md:24`：「最终提示词下的真实结果为 … owner=PROJECT ALPHA」不可证。烟测脚本 `/tmp/cmspark-822-qwen-smoke.cjs:7` 加载的是编译产物 `companion/dist/activity/model-extract`；`dist/activity/model-extract.js` mtime 为 **20:34:12**，晚于日志（20:25:40）与源文件最后一次写（`src/activity/model-extract.ts` 20:25:29）。该次运行在 20:25:40 结束、其中模型加载占 5065ms，源改动与运行之间放不下一次 `tsc`，因此那次运行的提示词极可能仍是改动前的编译版本。建议用当前 `dist` 重跑一次并记录构建 hash，或把该句改为「烟测（构建版本可能早于最后一次提示词编辑）」。首轮关于「日志早于提示词」的推断据上述 mtime 证据仍成立，我无法为作者的纠正提供支持；但 machine.md 现已明确 owner 误判与用户核对要求，不存在把烟测读成质量基准的过度声明，故不阻塞。
2. **NIT 超时来源表述** `companion/src/computer/qwen-vl-runtime.ts:271`：`analyze` 的 `120_000` 是本 PR **新增**的量（对齐 `infer` 的既有 120s，见同文件 :260），不是「既有预算」；与前端 `activity-request.ts:44` 的 720s 仍有落差。实测余量充足：本次烟测 `elapsed_ms=6687`、`MODEL_READY=5065`，analyze ≈1.6s（2B/macOS、单行图），120s 有 70 倍以上余量；失败态为 `infer-error` 且来源保留可重试。按现状接受，列为观察项而非缺陷。
3. **NIT 覆盖粒度** `companion/tests/settings-web-redaction-806.test.ts:25-30`：直接调用共享 producer 函数，未在 HTTP 层断言 `GET /api/config` 的 `vision.extra_headers` 遮蔽（`settings-web.test.ts` 22 pass 中无该用例）。风险低——handler 只经该函数（:351/378/396），函数级断言等价。

## 结论

增量无新增阻塞：隐私补齐为真实缺口修复且不破坏掩码回写，测试桩改动仅隔离测试 DNS 前置，新增 UI 回归与 Python 收集修复经我本机复跑通过；首轮 P1/P2 与 7 项 nit 全部闭合或按证据降级为观察项。对抗报告的 APPROVE 我确认。上述 3 项为文档溯源与覆盖粒度层面的建议。

VERDICT: APPROVE_WITH_NITS
