# Computer Use 产品设计重开 Brief（2026-07-25）

> 触发：线程 `3ffkgl` 微信「给文件传输助手发 hello world」多日失败；用户明确指出**产品悖论**——既要在 Chrome 侧栏授权，又要目标 App 保持前台，不符合真实使用场景。  
> 任务：**不要再堆 patch**。从第一性原理重新定义「电脑操作」产品逻辑，供 Claude Code 与 Pi 双路独立评审。

---

## 0. 一句话问题

CMspark 的 coordinate computer-use 在工程上越修越厚（SkyLight、session-trust、autoscale、self-UI、variance classifier…），但**用户可感知的成功路径**（侧栏说话 → 授权 → 微信里真发出一句话）仍未稳定闭环。  
根因更可能是**产品分层与成功标准错了**，而不只是又一个坐标 bug。

---

## 1. 已发生的事实（证据级）

### 1.1 用户真实任务

- 打开微信 → 打开「文件传输助手」→ 输入并发送 `hello world`。
- 交互面：Chrome Side Panel（确认/聊天）+ 本机微信窗口。

### 1.2 系统行为（thread `3ffkgl` + 日志 + 本机复现）

| 观察 | 证据 |
|------|------|
| 工具大量 `success:true` | thread tool results：type/key/click 均 ok |
| 消息从未出现 | 连续 describe/OCR 无 hello world |
| 侧栏授权 → Chrome 前台 | `foreground_yielded` + reconfirm「前台被 Chrome 接管」 |
| 用户被要求「保微信前台」 | 与侧栏授权冲突（用户原话：产品悖论） |
| macOS 自 UI 误判 | `exePath=com.google.Chrome`，白名单只有 `chrome`，`exeBasename→com`（已修匹配，但**未改变任务失败**） |
| SkyLight `ok:true` ≠ UI 生效 | 本机：type/enter 返回 ok，输入框占位符仍在 |
| OCR locate 坐标可用 | 「文件传输助手」可点中列表项（间歇） |
| 无 AX 树 | WeChat AX entire contents ≈ 4 节点，UIA layer skip |
| 假成功 | type 无「输入框是否有字」后置校验 |

### 1.3 当前实现摘要（as-built）

```
用户 Side Panel (Chrome)
    ↕ WS + L2 确认（task 级 critical）
Companion host_computer
    → 截图 ScreenCaptureKit
    → OCR / (可选 TinyClick) locate
    → client 坐标 bounds + Retina autoscale
    → inject: SkyLight SLEventPostToPid(click/type/key)
    → 证据 seal；crossverify 多为 pixel-region（click）或 false（type）
```

设计文档原意（`computer-use-design-brief.md`）：

> **先 API 后 GUI**；L1 AppleScript → L2 Shortcuts → L3 AX → L4 Vision。  
> 视觉点击是**最贵最不可靠的兜底**，不是默认路径。

**As-built 现实**：coordinate / vision-click 成了微信类任务的**默认且几乎唯一**路径；L1/L3 对微信基本为空。

---

## 2. 产品悖论（必须写进设计）

```
需求 A：安全确认在 Side Panel（Chrome 成为 frontmost）——正确
需求 B：注入要求目标 App 为 key window / 前台     ——微信经验如此
A ∧ B：用户无法同时完成 → 产品逻辑自相矛盾
```

可接受的化解（需评审选边）：

| 选项 | 含义 | 代价 |
|------|------|------|
| **P1 控制面/数据面分离** | 确认永远在侧栏；**agent 拥有**短暂 raise 目标的权利，用户无义务「保前台」 | raise 闪一下；需自 UI 不 re-L2（已部分做） |
| **P2 真后台注入** | 不 raise，事件必达非 key window | 依赖 SPI/OS；微信可能永远不买账 |
| **P3 原生确认** | 确认改 tray/Swift 窗，不经过 Chrome FG | 工程大；与现 Side Panel 体验分叉 |
| **P4 降级产品承诺** | 坐标操控只 support「可 AX / 可前台协作」的 app；微信走别的能力 | 诚实；砍 scope |

---

## 3. 第一性原理（草案，供攻击）

### 3.1 电脑操作不是一个 tool，是四层产品

| 层 | 用户语言 | 成功标准 | 当前状态 |
|----|----------|----------|----------|
| **R 读** | 读邮件/列表/文件 | 结构化数据返回 | 部分（Mail scpt 等） |
| **A 启动/切换** | 打开微信 | 进程+主窗口可见 | launch 可用 |
| **W 写（语义）** | 给 X 发「hello」 | **对方 UI 出现该文本 / 系统回执** | **假成功** |
| **C 坐标兜底** | 点这个按钮 | 点击后 UI 状态机迁移 | 部分 click；type 弱 |

**原则**：没有「语义成功」就不得对用户报 task success。  
`host_computer` 的 `ok:true` 若只表示「事件已 post」，必须在 API 上叫 `posted`，不得叫 `completed`。

### 3.2 控制面 ≠ 数据面

- **控制面**：聊天、授权、预算、危险确认 → Side Panel / Tray（可抢 FG）。
- **数据面**：目标 App 窗口 → 用户**不**应被要求与控制面抢 FG。
- Agent 在数据面的 raise/截图/注入是**系统职责**，不是用户职责。

### 3.3 能力路由必须写死

```
if app has semantic API (sdef / URL scheme / 官方 CLI): use it
else if app has usable AX tree: ax_action / set value
else if app is "vision-only" (WeChat class): 
     either (a) supported with explicit "foreground takeover" product mode
     or (b) unsupported for write, only screenshot/describe
else: refuse with typed error, do not pretend
```

**禁止**：对 vision-only app 默认 `type` 并报 success。

### 3.4 成功契约（Success Contract）

对 **写操作**（type / 发送）：

1. pre: 目标会话/输入焦点已建立（可观测）  
2. act: 注入或 API  
3. post: **OCR/AX/API 证明** 文本出现或按钮状态变化  
4. 否则：`TYPE_NO_EFFECT` / `SEND_NO_EFFECT`（**可恢复**），禁止 task success  

对 **读操作**：结构化字段 > 截图像素 OCR 散文。

### 3.5 确认经济学

- Task 级 L2：一次说清 app + 预算 + 将输入的字面量（已有）。  
- **禁止**把「Chrome 侧栏自己在前台」当成 foreign yield 反复问（macOS 已修匹配，原则要写进产品）。  
- 真 foreign app 抢 FG：才 re-L2。  
- 危险表面（支付/密码）：永远 force prompt（已有 PROMPT_ALWAYS）。

---

## 4. 目标产品形态（提案 v0，请评审打分/改）

### 4.1 用户故事（唯一黄金路径）

> 我在侧栏说：「给微信文件传输助手发 hello world」。  
> 我点一次「允许操控微信」。  
> 我**可以继续盯着侧栏**；微信窗口可能闪到前台一下。  
> 侧栏回复：「已发送」，且我在微信里看得到 hello world。  
> 中途**不会**再问十次「Chrome 抢了前台要不要继续」。

### 4.2 三档 App 支持等级（对外承诺）

| 等级 | 定义 | 示例 | 产品承诺 |
|------|------|------|----------|
| **S-semantic** | 有 API/深链/稳定 AX 写 | Mail, Notes, 部分 | 可靠读写 |
| **S-ax** | AX 可定位可 set value | 多数原生 App | 可靠点击/填表 |
| **S-vision** | 几乎无 AX，仅像素 | 微信、部分 Electron/游戏 | **仅实验**：需「前台接管模式」或只读截图；**默认不保证发送消息** |

对外文案：**不要**对 S-vision 承诺与 S-semantic 同等可靠。

### 4.3 执行状态机（写任务）

```
PLAN → CONFIRM(L2) → ACQUIRE(target: launch+optional raise)
  → GROUND(session: locate 文件传输助手, verify selected)
  → FOCUS(input: locate placeholder/input, verify focus)
  → WRITE(text) → VERIFY(text visible | placeholder gone)
  → SEND(enter/button) → VERIFY(message bubble | list preview)
  → DONE | FAIL(typed, recoverable)
```

任一步 VERIFY 失败 → 不进入下一步；不累积 20 次假 type。

### 4.4 前台策略（推荐默认 = P1）

- 确认：Side Panel（Chrome FG OK）。  
- 注入窗：`preferForeground` **由 agent 调用**，用户无 checklist「请把微信保持前台」。  
- Chrome 自 UI yield：**静默** re-raise 目标，不 re-L2。  
- 若 raise 被系统拒绝：typed error `FOREGROUND_RAISE_FAILED`，教用户一次授予 Automation，而不是循环假成功。

### 4.5 与历史设计文档的关系

- **继承**：L1→L4 优先级；critical 确认；companion 唯一执行边界；证据 seal。  
- **修正**：coordinate 不得默认充当微信「发消息」；success contract；控制面/数据面；S-vision 诚实分级。  
- **搁置**：TinyClick 实验层不进入黄金路径成功标准。

---

## 5. 请 Claude / Pi 独立回答的问题

请**分别**给出书面设计评审（可不同意本 brief），至少覆盖：

1. **是否认同「四层 R/A/W/C + 成功契约」？** 若否，给出替代本体。  
2. **P1–P4 前台/确认策略选哪个？** 是否组合？  
3. **微信类 S-vision：产品上应 support 到哪一级？**（只读 / 实验发送 / 正式发送）  
4. **最小可发布的黄金路径**是什么？（1–2 个用户故事，可在 2 周内验证）  
5. **明确砍掉什么**（防止再堆 SPI patch）？  
6. **安全红线**有哪些绝不能为了「能点微信」而放松？  
7. **成功度量**：怎样算 computer-use 产品健康（指标）？  

### 输出格式要求

```
## Verdict
ONE OF: APPROVE_DESIGN | APPROVE_WITH_CHANGES | REJECT_RETHINK

## Core thesis
（5–10 句）

## Decisions (numbered)
D1 ...
D2 ...

## Kill list
（必须停止的方向）

## 2-week golden path
（可执行里程碑）

## Risks
...

## VERDICT: APPROVE_DESIGN | APPROVE_WITH_CHANGES | REJECT_RETHINK
```

最后一行必须是 `VERDICT: ...` 三选一。

---

## 6. 实现者已知偏见（评审请攻击）

- 实现者倾向于继续修 SkyLight / autoscale / self-UI，因为路径依赖。  
- 实现者怀疑微信在非 key window 下**永不**接受可靠键盘，但样本有限。  
- 实现者偏好「先把假成功变成可恢复错误」作为最小诚实补丁，可能不够产品层。

---

*End of brief. Reviewers: read this file + optional skim of `computer-use-design-brief.md` L1–L4 table; do not rubber-stamp. Ground claims in product outcomes (message appears), not event-post success.*
