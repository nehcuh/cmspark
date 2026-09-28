# PR #555 复审（第二轮）— 你 REJECT 后请核实修复

## 你上一轮的裁决与 BLOCKING

**pi**（`docs/audit/reviews/pr-555-pi-20260928-231803.md`）：REJECT
- **[BLOCKING]** 轮数预算（`MAX_WAIT_PROBE_FAILURES=3`）把容错窗口从整个 deadline
  塌到 ~2×interval；你实测 `heal=1200/2000/4000ms` 修前成功、修后失败；且注释
  声称「保护导航中的瞬时抖动」，实现恰恰相反。你还指出反向漏洞：`timeout ≤ ~2–3×interval`
  时 3 次失败塞不进 deadline → 又报假 `WAIT_TIMEOUT`（你实测 `timeout=1000, interval=500`）。
- NIT：`exceptionDetails` 被折算成 `exists=false` + `channel:"cdp"`（为假答案背书）；
  「对齐 `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`」类比不成立；测试缺口（慢恢复 / 短超时）。

**claude**（`docs/audit/reviews/pr-555-claude-20260928-231803.md`）：REJECT
- **[BLOCKING]** `WAIT_PROBE_FAILED` 未登记在 `security.ts` 的 recoverable 码表 →
  落默认桶 **non_recoverable** → `adapter.ts` `shouldStop/security_halt` 整轮终止。
  你实测 `classifyError('WAIT_PROBE_FAILED: …')` → `non_recoverable`；而修复前同场景
  是 recoverable 可重试 —— 未声明的行为变更。修法：登记该码，并补分类测试。
- NIT：注释与实现不符（窗口 15s → ~1s）；`exceptionDetails` 折算问题（与 pi 同）。

## 现在已提交：`8c525b44`（PR HEAD）

请**独立核实**（不要采信下面的说法，自己跑）：

### 修 pi 的 BLOCKING
1. 删除 `MAX_WAIT_PROBE_FAILURES`；主循环**保持重试到整个 deadline**（与修复前一致）。
2. 判定改为循环结束后看 `anyProbeSucceeded`：
   - 一次都没探成功 且 有 `probeError` → `failInteractive(tabId, probeError, "WAIT_PROBE_FAILED")`
   - 探成功过 → `WAIT_TIMEOUT`（真超时）
3. **请重跑你上一轮的三组 heal 实验**（`heal=1200/2000/4000ms`）：现在应恢复为
   `success=true`（窗口回到 deadline）。
4. **请重跑你上一轮的 `timeout=1000, interval=500` 实验**：现在不得再报 `WAIT_TIMEOUT`。

### 修 claude 的 BLOCKING
5. `companion/src/security.ts` 的 recoverable 码表新增 `wait_probe_failed` 与 `wait_timeout`。
6. **请重跑你的实测**：`classifyError('WAIT_PROBE_FAILED: …', {toolName:'wait_for', error_code:'WAIT_PROBE_FAILED'})`
   现在应为 **recoverable**。
7. 新增 `companion/tests/classify-error-wait-for-codes.test.ts`（3 正向 + 1 反证：
   未注册码 → non_recoverable）。

### 两家共同 NIT
8. `probeSelectorExists` 见 `exceptionDetails` 即抛（带页面原文），不再折成 `exists=false`。
9. `scriptingProbeSelector` 把注入错误原文带进抛出文本 → 非法 selector 能归到 `INVALID_SELECTOR`。

## 你要回答的核心问题

1. 你（pi）的 BLOCKING 是否**真的**消除了？请实跑你上一轮那几组实验复现。
2. 有没有**新引入**的缺陷？重点：
   - 新判定 `!anyProbeSucceeded && probeError` 在「探测一直失败但中途成功过一次又持续失败」
     的场景下行为对不对？
   - `probeError = null` 的重置时机是否会漏掉「最后一轮失败」？
   - `exceptionDetails` 抛出后，`failInteractive` 的归类对非法 selector 是否会给出
     `INVALID_SELECTOR`（而不是又一种错误归因）？
3. 测试 11 例（extension）+ 4 例（companion）是否真的在守行为？可自行做突变验证。
4. 回归数字是否属实：extension 1469/1469、companion 零新增失败、门禁 156/0。

## 可用命令

- `cd chrome-extension && npm test`
- `cd chrome-extension && ./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/wait-for-probe.test.js`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-error-wait-for-codes.test.js`
- `bash scripts/tests/test-package-gates.sh`

## 只读评审：不要改文件、不要提交、不要打 tag、不要 push。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
