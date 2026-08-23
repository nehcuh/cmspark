# 站点操作记忆（Site Op-Memory）

> **日期**: 2026-08-21  
> **轨迹**: `qg44es`（WAVE-1 之后仍风暴）  
> **状态**: 实现中

## 问题

WAVE-1 给出了 `ELEMENT_*` / `CDP_ATTACH_FAILED` / `DOM_SCRIPT_VOLUME_CAPPED`，但 `qg44es` 仍：`click` 9 败、`get_element_info` 8 败、`press_key` 5 败。原因不是「没类型化」，是：

1. `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` **每个 chatCreate 清零**；用户「继续」重置。
2. 模型 **换工具名**（click → get_element_info → type → press_key），名字计数器互不累计。
3. `record_experience` 要 LLM 主动写；失败路径只把**已有** site_knowledge 标 stale，从不写下「这个 locator 刚挂了」。
4. 同一 tab 已经 `CDP_ATTACH_FAILED`（知乎编辑器 / chrome-extension 页）后仍对同一 tabId 发 click/type。

## 闸（本波）

| 键 | 阈值 | 效果 |
|----|------|------|
| `(thread, origin, tool, locator)` | 失败 **2** 次 | 第 3 次 peek `SITE_OP_BANNED` |
| `(thread, origin, *, locator)` | 同上跨工具 | 禁止 click↔get_element_info 换皮重试同一 `text:`/`css:` |
| `(thread, tabId)` attach | **1** 次 `CDP_ATTACH_FAILED`/`WRONG_ORIGIN` | `TAB_ATTACH_FROZEN`；**仅**该 tab 的 `navigate`/`set_tab_url` 成功解冻。`list_tabs`/`create_tab` **不解冻**（create_tab 会注入 pinned 旧 tabId） |

「继续」不清零（进程内 Map，与 DOM-script budget 同寿命）。`www.` 与 apex 同源。`press_key` 忽略 stray `text`。解冻只走 `shouldThawAfterSuccess`（navigate / set_tab_url）。

site_knowledge 落盘：`addEntry` 去重 + `DO NOT retry` 上限 24。换 origin 是新键。不同 locator 的「换皮点」仍是 WAVE-1 残差（非本波）。

成功写入 site_knowledge 一条 `DO NOT retry …`（`record_experience` 同类、无新 L2）。Prompt 每轮注入 `## Site op-memory (machine)`。

## 非目标

W2 snapshot/uid。不提高 `MAX_SAME_TOOL_RECOVERABLE_FAILURES`。不禁 http osascript（体积封顶仍有效）。
