# PR #565（第六修订）复审 — 你已四轮 REJECT，验证本版是否到位

## 你的角色

你（pi）已四次审这个 PR、四次 **REJECT**（`f5ba6dd1`、`80eba16b`、`d267b0b9`、`8ed8a82a`）。
作者已按你第四轮的全部发现重做，基线 **`c24fb930`**（同分支，force-push）。

任务：**验证修正是否到位**，并找新问题。重点核对你第四轮的 2 个 P0 与 1 个 P1。

## 你第四轮的发现（逐条验证）

1. **[P0] `SPAWN_INTENT_FAILED` 是新的一处收紧**（`companion-dispatch.ts:325-326` 嵌 `intentClaim.error`
   并把码硬改成 `SPAWN_INTENT_FAILED`；被嵌入报文含 `intent not found` 等可恢复子串）
   → 作者声称已处理，但**不是改成 recoverable，而是整类移出桶**（见下）。
2. **[P1] `SETTINGS_REQUIRED` 同机制**（`${baseError}` 含 `module_disabled`）
   → 同上。
3. **[P1] 上一版新加的守卫是恒真式（0 验证力）**，你原样复现突变 → 0 红
   → 作者声称已重写为「从源码文本取显式条目 ∩ 默认桶」，并用你原样的突变验证 **1 红**。

## 作者的新做法（本版核心：把这一类结构性修掉）

作者加了一次**系统性扫描**：找出所有「报文里插值取的是**另一个错误值**」的码
（`${baseError}` / `${e?.message}` / `${xxx.error}` / `String(err)` …）→ 其等级会**继承被嵌入的报文**
⇒ 无法证明登记后不变 ⇒ **整类不收**。共 6 个移出桶：
`SPAWN_INTENT_FAILED`、`SPAWN_BRIEF_FAILED`、`SPAWN_PACK_FAILED`、`SETTINGS_REQUIRED`、
`ORCHESTRATOR_GATE_ERROR`、`OUTBOUND_CONFIRM_REQUIRED`（你报了 2 个，另 4 个由本仓扫描发现）。

## 请你重点验证的问题

### P0
- **「整类不收」这个做法是否真的**把该类收干净**了**？请用你的扫描器独立找一遍：
  还有没有**别的码**的报文会继承另一个码的报文（含 2 跳：A 的报文嵌 B 的报文、B 又嵌 C 的）？
  这类码现在**未登记**（走 base 行为）—— 是否有哪个**仍然被登记着**（那就会有收紧/放宽未声明）？
- **「收紧 0」是否真的成立**？独立重算 before/after（base = `main` 的 `security.ts`）。
  前四次的问题全藏在「静态扫描看不到的站点」里 —— 这次请特别再查一遍。
- **`SPAWN_BRIEF_FAILED` 的 base 行为**：作者移出后它走 `worker brief did not persist — ${...}`。
  请确认这确实是 base 的等级（不受本次改动影响）。

### P1
- 守卫是否真有验证力？请**独立复现**你上次的突变（显式表塞已在桶的码）。
- 源码注释里是否还有不可复现的数字/已被推翻的表述？
- 12 个用例是否仍全部有效？

### P2
- `registry 110 = 43 显式 + 60 默认桶 + 7 image 族` 是否准确？
- 还有没有 `文件:行号` 引用错误？

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-by-code.test.js`
- `bash scripts/tests/test-package-gates.sh`
- PATH 缺 `C:\nvm4w\nodejs` 会报 node not found；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前。

## 硬性规则

1. 实际读代码 + **实际运行测试与突变**。2. 每条 finding 带 `文件:行号`。
3. 找不到问题就直说，别编 NIT。4. 区分：验证过 / 推断 / 没能验证。
5. 声明与代码不符就点名 over-claiming 并给证据。

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path:line — ...

## 未能验证

## 上一轮 2 个 P0 + 1 个 P1 是否已修（逐条）
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
