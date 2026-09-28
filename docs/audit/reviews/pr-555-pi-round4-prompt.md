# PR #555 第四轮 — 你的两条建议已采纳（提交 3322d982），请快速确认

## 背景

你第三轮对 61f19468 给 APPROVE_WITH_NITS，并给两条建议。已提交 `3322d982` 采纳：

**建议①**（你指出「登记」实为靠 `"${CODE}: "` 前缀 + 子串表命中，即判定依赖**文案形态**）
→ 改为 `classifyError` 顶部 **error_code 显式分支**（同 BROWSER_UNAVAILABLE 等既有写法）
→ 并按**单一判定路径**移除上一提交加进子串表的两条（避免冗余 + 「改一处不红」）

**建议②**（你说我上一版用例的「前提断言」仍暗示依赖子串）
→ companion 用例改为用**完全中性**的文案（连码名都不含）——真正证明「只靠 code 生效」；
  另加「同一 code + 四种文案形态（空/中性/带前缀/塞满既有子串）→ 结论必须一致」

副作用已处理：**纯文案驱动**的家族清单 `web-act-loop-wave1.test.ts` 不再收录这两条
（它只传一个参数、靠子串），已在清单里注明原因并交叉引用。

## 请核实（聚焦，只验增量）

1. `git show 3322d982`；确认显式分支位置/写法与本文件既有分支一致。
2. **`error_code` 显式分支是否真的与文案解耦**：构造「同 code + 各种 message」，
   确认结论恒定（含塞满 `timeout`/`not found`/`attach failed` 的 message）。
3. **移除子串表条目后有没有反向破坏**：`web-act-loop-wave1.test.ts` 的家族清单
   （纯文案驱动）现在是否仍然全绿？其它依赖这两个子串的测试有没有变红？
4. **突变**：注销显式分支 → 我实测 4 条红。请独立复现。
5. 有没有**新引入**的问题？特别是：显式分支放在 `classifyError` 顶部，会不会
   抢在某个既有的、更该优先的判定之前（比如 security 类）？请检查它在
   `security block` 检查**之前**返回 recoverable 是否会造成「本应 security 的场景
   被判 recoverable」——注意这两个 code 只由 wait_for 产出。
6. 回归：companion 新文件 5/5、家族文件 7/7、全量 70 条失败且 0 条与改动相关、
   门禁 156/0。

## 另：同族问题已按你的要求立案

`safeEvaluate()`（click / type / get_element_info 的公共路径）同型洞 → **#556**，
沿用 #554 的模式修（我们自己的固定文案 + 原文走 data 通道）。本 PR 不再扩大范围。

## 只读评审。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
