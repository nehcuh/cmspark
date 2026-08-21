# 网页操作环（Web Act-Loop）— 产品设计 SoT

> **日期**: 2026-08-21  
> **状态**: **LOCKED**（方向折入 + 设计三路对抗 REJECT 已吸收）  
> **方向**: [web-act-loop-direction-20260821.md](../../audit/reviews/web-act-loop-direction-20260821.md)  
> **设计对抗**: locator / budget / win32 三路均为 **REJECT** → 下列 MUST-LOCK 已写入正文  
> **轨迹**: `a7ubt9` darwin；win32 未复放  
> **Trust**: [ADR-020](../../adr/020-capability-model-three-axes.md)

---

## 0. 一句话（锁定）

**L1 必须能按可见字点、失败类型化、CDP 挂了不得谎称找不到元素、不得假 success、成功环要有机器封顶。不把 `host_computer` 当网页默认，不在 http 上禁 osascript。Windows 没有第三条 JS 路。**

---

## 1. JTBD

| | |
|--|--|
| **成功 W1** | 唯一可见字可点；多匹配 fail-closed；type 可走当前焦点；fill_form 字段失败则整单 `success:false` |
| **成功 W3′** | attach 失败有码；evaluate 死世界 ≠ 空完成；**体积**成功环能停 a7ubt9 类风暴，而不靠「同一 expression 重复 8 次」 |
| **非成功** | W2 snapshot/uid；Windows 第三条 Chrome JS 注入；知乎编辑器 SLA |

---

## 2. ADR-020

```text
Surface:      L1 CDP
L2-classes:   不新增。evaluate / osascript_eval / shell_exec / host_computer 仍 L2
Compose:      none
Autonomy:     single
Trust:        resolveLocator 只在扩展 IIFE；click 不进 L2_GATE_TOOLS
Channel:      community
```

---

## 3. 波次

W1 + W3′ + W4 + W5 = **本波**。W2 snapshot **禁止本波**。

---

## 4. W1 — Locator（吸收 locator REJECT）

### 4.1 一个 finder

**一个**模块（现 `find-element-by-text.ts` 参数化）。`hitAttr`：click 族 `data-cmspark-hit`，download `data-cmspark-dl-hit`。`browser_download` **调用** `resolveLocator`，禁止私藏第二份匹配规则。

Needle：`JSON.stringify`。IIFE 只匹配 + 标记 + 返回 `{count,matches,coords}`；**不得** click / `innerHTML` / eval 用户 JS。Transport：现有 `Runtime.evaluate` / `scriptingExecute`。禁止走 `evaluate`/`osascript_eval` **工具**。

### 4.2 组合语义 — **C（download）**

- 有 `text`（trim 后非空）→ **只走 text**，不 fall through 到 CSS。  
- 无 text、有 selector → CSS。  
- 两者都空（trim 后）→ `SELECTOR_OR_TEXT_REQUIRED`（与 download 同名，不用 `LOCATOR_REQUIRED`）。  
- **禁止**「selector 失败再 text」。  
- `INVALID_SELECTOR` / `WRONG_ORIGIN` / `CDP_ATTACH_FAILED` **禁止** fall through。

`type`：**允许**省略 locator（焦点路径，JTBD 先 click 再 type）。有 locator 则按上表解析。

`fill_form` 每个 field：`value` 必填；`selector`/`text` 运行时 one-of。同一 L1 调用，**0 次确认**。字段 1 失败 → 整单 `success:false` + `data.filled`。**不要**把 click/download 的 interactive 池换成纯 form 控件（会丢掉 a/button）。做法：池仍含 a/button/label，**若命中 form 控件则优先 form**（fill_form/type text 不会被孤立 `<label>` 独占）。`ownText` 读 placeholder。

`drag_and_drop`：`from_selector`/`from_text` + `to_selector`/`to_text`，两侧独立 `ELEMENT_*`。任一侧 trim 后都空 → `SELECTOR_OR_TEXT_REQUIRED`。单侧同时给 selector+text → 该侧 text 独占（组合 C）。

### 4.3 分类

| text count | code | 行为 |
|------------|------|------|
| 0 | `ELEMENT_NOT_FOUND` | 不点 |
| 1 | ok | 点；coords 当轮使用 |
| ≥2 | `ELEMENT_AMBIGUOUS` | **不**点第一个；`matches` ≤5 + `user_hint_zh` + `suggested_action: disambiguate_selector_or_exact_text` |

CSS：`querySelector` **保持 first-match**（遗产，写进 SoT）。text 才 fail-closed。W1 不把 CSS 升级成 querySelectorAll。

text 路径：与 click 的 selector 一样 **poll 至多 3s**（SPA 首屏）。

### 4.4 假 success

`type` / `hover` / `fill_form` / `select_option` / `drag_and_drop` / `get_element_info`：locator/focus/CDP/fallback false → `success:false` + `error_code`。禁止空 catch 后成功。

### 4.5 INVALID_SELECTOR

仅 `querySelector` **SYNTAX_ERR**。`a[` → 此码。**禁止**把 `a[href*="blog" i]` 测成 invalid（Chrome 支持 `i`；a7ubt9 是 Element not found）。

### 4.6 Hit

当轮用 `matches[0].{x,y}`。Fallback 仅 `[data-cmspark-hit="1"]` 且同一次调用。IIFE 开头清自己的 namespace。LLM **不得**把 hit attr 当可存储 locator。

### 4.7 Trust 冻结

resolveLocator **只在扩展**。Click 不进 `L2_GATE_TOOLS`。这是 fill_form「拆确认」唯一合法答案：根本不走 evaluate 工具。

---

## 5. W3′ — 机器闸（吸收 budget + win32 REJECT）

### 5.1 Attach 分类（`tabs.get(tabId).url`，禁止 error 子串）

对 **所有 L1 浏览器交互**（click / type / hover / press_key / get_element_info / fill_form / select_option / drag_and_drop / evaluate）的 attach/scripting 失败统一分类：

| 条件 | code | suggested_action |
|------|------|------------------|
| scheme ∈ `chrome-extension` / `chrome` / `edge` / `devtools` | `WRONG_ORIGIN` | `list_tabs` |
| scheme http(s) 且 debugger+scripting **都**失败 | `CDP_ATTACH_FAILED` | `list_tabs` / `retry_after_user_focus` / `stop_or_change_task`。**禁止** suggested_action=`evaluate`（同一 debugger） |
| origin 正常、节点 0 | `ELEMENT_NOT_FOUND` | `refine_text_or_selector` |

`file:` HTML：不当 `WRONG_ORIGIN`。`file:`/`https:` **PDF 插件**（url 仍是文件/https）可能仍谎报 ELEMENT_NOT_FOUND — W1 记录为 **已知残差**，不在本波用子串猜 MIME。

仍 **recoverable**（加入 `classifyError` 列表，否则 default non_recoverable 会 `chat.error`）。

### 5.2 evaluate 诚实

| 情况 | 形状 |
|------|------|
| 语句有完成值 | `success:true`, `result` 为该值 |
| 世界死了（`1+1` / `document.title` 也是 `null`，或 attach/CSP） | `success:false`, `EVAL_DEAD_WORLD` 或 `CDP_ATTACH_FAILED` |
| 语句完成且语言上无完成值（`void 0` / 只有副作用）且 **探针 `1+1===2` 为 true** | `success:true`, `evaluate_kind: empty_completion` |
| `exceptionDetails` / 页面抛错 | `success:false`, `EVAL_THROWN` |

**判定程序**：CDP `returnByValue` 分不清「完成值是 null」和「无完成值」。实现：非 undefined 且 `type !== "undefined"` → 有完成值（含 JS `null`，CDP type=object）；否则探针 `1+1===2` → true 则 `empty_completion`（**含 genuine-null 被标 empty 的已知残差**），探针非 true → `EVAL_DEAD_WORLD`。attach 失败走 §5.1，不标 empty。

禁止再把死世界标成 empty_completion（那是 a7ubt9 跳 osascript 的燃料）。

### 5.3 两道成功环预算（线程持久，巡航仍计，跨「继续」）

**A. 相同脚本** `(family=dom_script, exprHash, tabId)`：**3** 次成功 → 该 key `DOM_SCRIPT_LOOP_CAPPED`。  
（a7ubt9 单 hash 最多重复 2，这条打的是「同一句刷发布」。）

**B. 体积天花板** `(family=dom_script, origin)` origin = `tabs.get` 的 origin 或 osascript url 解析出的 origin：**24** 次成功 → 该 origin 的 `dom_script` 家族 `DOM_SCRIPT_VOLUME_CAPPED`。  
（81 次**不同** hash 的 osascript 会在 24 停。换 origin 清零；换 tabId 但同 origin **不清**。）

存线程记录（不是 `chatCreate` 局部 Map）。换线程清零。

`DOM_SCRIPT_VOLUME_CAPPED` / `DOM_SCRIPT_LOOP_CAPPED`：**recoverable 列表要有**，但 **suggested_action=`stop_or_change_task`**。**禁止** hop 到 `host_computer` 当下一建议。实现上：封顶后该家族对该 origin **硬拒成功路径**（再调用仍 false）。

`family` 计入：

- `evaluate`
- `osascript_eval`（仅 darwin 存在）
- `shell_exec` 当 **payload** 像 DOM 注入（不是解释器品牌）：
  - 命中：`execute javascript` · `chrome.automation` · `Runtime.evaluate` · `document.querySelector` · `el.click(` · `chrome.debugger` · `--remote-debugging-port` · `osascript` / `osacript`（含 `tell application "Google Chrome"`）
  - **不命中**：`Start-Process chrome` · `Get-Process chrome` · `tasklist` · 仅打开浏览器

`exprHash` = sha256[:12](规范化：trim + 折叠空白；**不**剥注释)。osascript 无 tabId 时 **key A 用 url 片段** `(family, exprHash, url:…)`，origin 仍从该 url 解析。shell 无 url/tab → origin=`origin:unknown`（线程内共享桶，fail-closed）。

**已知残差（记入，本波不扩启发式）**：file-backed 脚本（`cscript inject.js` / `osascript /tmp/x.scpt`）命令行无 payload 指纹则 **不计入** family（与 `file:` PDF 同类诚实残差）。linux `xdotool`/`wtype` 同 best-effort。

封顶后 **本线程内不可覆盖**；要再注入须新 thread。`MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` 不要提高。



### 5.4 Last-resort 按 OS（吸收 win32 REJECT）

| OS | CDP+scripting 都失败之后 |
|----|--------------------------|
| **darwin** | 允许 `osascript_eval`（L2），计入 5.3。http **不禁**。X.com CSP 退路 **仅 darwin** |
| **win32** | **没有**第三条 JS 路。`CDP_ATTACH_FAILED` → 停。**禁止**再 suggest evaluate。**禁止** suggest `host_computer` |
| **linux** | 同 win32。`host_computer` 在非 darwin/win32 **硬拒**；文案不得暗示有 CU |

Rule 12 win32 现写 NEVER `host_read`/`host_write` for browser-DOM。**本波 W5 补上 NEVER `host_computer` for browser-DOM**（三平台 Rule 12/12b）。

### 5.5 `press_key` 修饰键

CDP 官方 modifiers：Alt=1 Ctrl=2 Meta=4 Shift=8。catalog 今日写 Meta=8 Shift=4 — **与 CDP 不一致**。Wave-1：`press_key` schema 以 **ctrlKey/metaKey/altKey/shiftKey 布尔** 为主；`modifiers` 整数仅遗留兼容（仍按旧 catalog 位：Shift=4 Meta=8 解码，再写成 **官方 CDP** `modifiers` Alt=1 Ctrl=2 Meta=4 Shift=8 + `windowsVirtualKeyCode`）。catalog **不要**再公布错误掩码。darwin 全选用 Meta，win/linux 用 Ctrl。`fill_form` 双发：Ctrl 半边必须真正生效（今日 `ctrlKey:true` 无 VK — Windows 全选是演戏）。本波 **修 fill_form Ctrl 半边**（否则 §8「fill_form 已跨平台」是假的）。

---

## 6. W4 — type

主路径：`Input.insertText`（已 focus）。Fallback：**禁止**对非 INPUT/TEXTAREA 设 `el.value`。contenteditable / `[role=textbox]`：`insertText` 命令或 `input` 事件；失败 `TYPE_UNSUPPORTED_EDITOR`。

---

## 7. W5

catalog：每个 locator 消费者 description 含「text 或 selector」；fill_form **item** 不再 required `selector`。architecture.md `click("员工管理")` **同 PR** 对齐。Rule 7/8 与 §5.4 一致。

`classifyError` **必须**加入 §9 **全部 11 码**（含 `ELEMENT_NOT_FOUND` / `EVAL_THROWN` 的下划线形式 `element_not_found`，旧空格子串匹配不到 `ELEMENT_NOT_FOUND:`）。否则 default non_recoverable → `chat.error`。

---

## 8. 平台（诚实）

W1/W4/5.1/5.2 = Chromium 扩展，三平台同一套测试。

Last-resort：**不对称**。darwin 有 osascript；win32/linux 没有。Wave-1 **不**用 UIAutomation/xdotool 补第三条路。

测试必须 `platform: "win32"` 参数化启发式与 suggested_action（无 VM）。DoD 禁止只写「含 osascript」。

---

## 9. 错误码

`SELECTOR_OR_TEXT_REQUIRED` · `INVALID_SELECTOR` · `ELEMENT_NOT_FOUND` · `ELEMENT_AMBIGUOUS` · `WRONG_ORIGIN` · `CDP_ATTACH_FAILED` · `EVAL_DEAD_WORLD` · `EVAL_THROWN` · `DOM_SCRIPT_LOOP_CAPPED` · `DOM_SCRIPT_VOLUME_CAPPED` · `TYPE_UNSUPPORTED_EDITOR`

`error` 以 `CODE:` 开头。

---

## 10. DoD（wave-1，平台无关 + 参数化 win32）

1. text 0/1/≥2 → 三码；ambiguous 不点。  
2. 两者 trim 空 → `SELECTOR_OR_TEXT_REQUIRED`。  
3. `type` 无 locator 仍可走焦点成功路径。  
4. 同时给 selector+text：text 独占（构造「CSS 会点错、text 唯一」→ 不得点 CSS）。  
5. download 与 click IIFE 仅 `hitAttr` 不同。  
6. fallback 含 `data-cmspark-hit="1"`，不含 `dl-hit`。  
7. `a[` → `INVALID_SELECTOR`；**不对** `i` flag 断言 invalid。  
8. `https://zhihu.com` + attach 失败 → `CDP_ATTACH_FAILED` 不是 ELEMENT_NOT_FOUND。  
9. `chrome-extension://` url → `WRONG_ORIGIN`。  
10. type/hover 在 locator 失败时 `success:false`。  
11. fill_form 第 2 字段失败 → 整单 false。  
12. catalog click/type 有 `text`；fill_form item 不强制 selector。  
13. 同 hash+tab 成功 3 次后第 4 次 `LOOP_CAPPED`。  
14. 同 origin 不同 hash 成功 24 次后 `VOLUME_CAPPED`。  
15. `powershell -c Start-Process chrome` **不**计入 family；含 `execute javascript` / `document.querySelector` 的 cmd/cscript **计入**。  
16. evaluate：死世界探针失败 → 非 empty_completion。  
17. contenteditable fallback 无 `el.value=`。  
18. fill_form Ctrl+A 半边带 `windowsVirtualKeyCode`（或等价生效证明）。  
19. `CDP_ATTACH_FAILED` 的 suggested_action **不含** `evaluate` 或 `host_computer`。  
20. 新 error_code 均在 `classifyError` recoverable 列表。

---

## 11. 非目标

W2 snapshot · click 进 L2 · 禁 http osascript · CU 网页默认 · Windows UIAutomation-on-Chrome · 自动 Meta→Ctrl（除 fill_form 已有双发修生效）· iframe/shadow · 知乎 SLA

---

## 12. 对抗折入记录

| 路 | 原 VERDICT | 折入 |
|----|------------|------|
| locator | REJECT | 组合改 C；一 finder；SYNTAX_ERR only；type 焦点豁免；fill_form item schema；Trust 冻结 |
| budget | REJECT | 双计数器 3+24；死世界 ≠ empty；payload 启发式；codes 进 classifyError |
| win32 | REJECT | evaluate 不是 attach 失败的退路；无第三条 JS；Rule 12 NEVER host_computer for DOM；fill_form Ctrl 真生效 |

实现前若再改 5.3 阈值或 5.4 矩阵，必须重跑对应对抗路。
