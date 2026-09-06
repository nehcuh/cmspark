# 召唤器升级：命令面板化 + 读路径 + 控制面 + 后台任务 — 设计

> GitHub: #433
> 日期：2026-09-06
> 状态：设计定案（三路独立对抗综合：claude 主责 / grok 副责 / pi 红线对账；
> 提案原文 `.tmp/lane-status/design-432-433-*.md`；UI 参数基准来源见 §5f）
> 定位：召唤器 = **命令面板 + 内联一次性 AI**（Raycast 分界：面板管「问一次/执行一次」，
> 多轮对话在面板工作台）——不是聊天窗，不是第二确认台。

## 1. 现状关键事实（实码核验，claude/pi 双验）

- SummonerOverlay.swift：NSPanel borderless nonactivating，AppKit 手工布局 2018 行；
  HUD composer + `#` 标题搜索 + workbench rail + 巡航 chip（只读）+ CTA 盒。
- 通道两段式：Swift → stdin JSON → menu-bar-agent → CompanionClient WS
  （HMAC + surface:"summoner"）。Swift 不持 ws_secret、不直连 WS——保持。
- `SUMMONER_ALLOW`（ws/summoner-acl.ts）已放行：thread.list/select/create、
  chat.create/steer、history.query、knowledge.list、pack.*、skill.*、meeting.*。
- 缺口：`thread.search` 不存在；`thread.select` 返回**未脱敏全文**（会话语义，不是
  检索语义）；`task_loop.arm` 被 ACL 拒；L2 对 summoner 返回 `L2_CONDUCTOR_ELSEWHERE`
  （overlay 永不渲染 Allow/Deny，既有裁决不破）。

## 2. 交互模型：三段式命令面板

单一输入框，输入即过滤：

```
1. 命令层：动作动词（新对话/搜知识/打开侧栏/打开确认台/后台任务…；「打开终端 tab」在
   #432 P0 交付前显示为禁用态）  ← frecency
2. 数据层：历史线程 + 知识 hits（`#` 前缀语义升级为隐式，无需前缀）
3. fallback 层：无结果 →「问 AI / 在面板打开」（Raycast Fallback Commands 先例；空态即入口）
```

- AI 双轨：quick answer 在 overlay 内联流式（限高 ~5 行 +「在面板继续 ⌘⏎」），走既有
  `chat.create` 一次性问答；多轮一律 `ui.command focus_panel` 带去面板。
- **否决**：overlay 内滚多轮对话（命令密度与对话深度互斥，Raycast 用两个产品面解决）；
  WebView/SwiftUI 重写（2018 行 AppKit 增量改造，SwiftUI List 键击重排有性能坑）。

## 3. 三类能力 wire（companion 裁决，Swift 永远是瘦客户端）

### 3a. 读历史/知识（P1，本票灵魂）

新增三条**服务端脱敏检索**消息（进 SUMMONER_ALLOW，默认拒原则不变）：

| 消息 | 语义 | 实现 |
|---|---|---|
| `thread.search {query, limit}` | 搜线程：alias/title/蒸馏摘要/tags | 返回 `{thread_id,title,alias,updated_at,snippet}`，**不含 messages** |
| `thread.peek {thread_id}` | 单线程脱敏蒸馏预览（**≤2000 字符截断**） | 复用 `distillThreadMarkdown + redactSecrets` |
| `knowledge.search {query, limit}` | 搜知识：title/description/tags | 复用派生索引（#427 后含 description）；`scoreRelatedKnowledge` 一字不改（#273 红线） |

- 引用进任务：**复用既有 `context_refs[]` 的 `type:"thread"`**（mode 默认 summary_card；
  full 已被 router 禁；digest 缺失回退 120 字摘要卡 + 后台 digest 填充现成）——不新增平行
  ref 类型。LLM 只见蒸馏/摘要产物。
- `thread.search` 的摘要来源 = 既有 `thr.digest` 缓存（chat.create ref 路径的后台填充同源），
  不新造索引面。
- **明确不做**：不把 `thread.select` 全文用于检索流；不把 `thread.distill_preview` 原样
  放行（导出形状 ≠ 检索形状）；不在 Swift 侧做全文模糊（脱敏边界不进 UI）。

### 3b. 控插件（P2）

新增**白名单推送帧** `ui.command {action}`（companion → ext 定向 panel；动作两端硬编码
白名单）：`focus_panel` / `open_confirm_center` / `open_browser`（既有 CTA 盒机制升格）
/ `thread.new_in_panel` / `open_terminal_tab`（打开 #432 终端全页 tab；terminal.open 的
gesture/L2 由用户在 tab 内首次点击满足，召唤器不直发 terminal.open）。

档位：summoner 只可**降档**（收紧方向免确认）；**升档/arm 必须去面板确认台**
（ADR-007 同构：放松需确认、收紧免确认）。

### 3c. 后台浏览器任务（P3，最后动）

开放 summoner 侧 `task_loop.arm`，三重既有闸全数保留：
1. payload 门强制 `user_gesture:true`（pack.apply 同款先例）；
2. 租约绑定：任务线程必须是 overlay 持有 composer lease 的线程（`OVERLAY_THREAD_MISMATCH` 既有门）；
3. 自主性不抬升：沿用线程当前档位（默认档），loop 闸/熔断/SITE_OP/CU 升级链零改动。

L2 确认导流维持既有机制（注意实码有两套：`L2_CONDUCTOR_ELSEWHERE` 只在 host_computer
任务 LIVE 时返回；一般 L2 走 confirm fan-out 回 extension）+ CTA 盒导流确认台；overlay
不新增任何确认 UI。
**若 P3 评审时权限面存疑，允许砍掉 P3 单独交票——P0–P2 不依赖它。**

## 4. 分阶段切片

| 阶段 | 内容 | 权限面变化 |
|---|---|---|
| **P0 UI 地基 + 命令面板 IA** | §5 全套视觉/动效参数 + NSTableView 虚拟化 + canJoinAllSpaces/fullScreenAuxiliary 修复 + IME 回归 + 三段式结果混排（只用既有已放行消息：thread.list/knowledge.list/动词表） | **零** wire/ACL 变化 |
| **P1 读路径** | thread.search / thread.peek / knowledge.search + frecency + context_refs thread 复用（前置：#427 后端已合入，knowledge.search 依赖索引含 description） | ACL +3 条只读 |
| **P2 控制面** | ui.command 白名单推送帧 + 降档 | 出站帧白名单（两端硬编码） |
| **P3 后台任务** | task_loop.arm 三重闸 + 后台任务闭环 + quick answer 内联 | 唯一动 Autonomy 邻域，放最后 |

## 5. UI 设计规格（验收级参数表）

基准：密度取 Alfred 标尺、气质取 Raycast（claude §4 全盘采纳；与 grok 表冲突处以本表为准）。

### 5a. 几何与排版

| 参数 | 规格 |
|---|---|
| 窗口宽度 | **720px**（维持现有 summonerHudWidth，Raycast 级；不折腾既有布局常数） |
| 位置 | 鼠标所在屏 visibleFrame 上 1/3 水平居中 |
| 圆角 | 窗口 12px（内容层做，窗口 backgroundColor=.clear）；行 6px |
| 主字号 | 14pt / weight 500；次字号 12pt / 400 / 60% 不透明 |
| 行高 | **44px**（含 6px 行间距）；图标 20px 圆角 4 |
| 行内边距 | 左右 12px，图标-文字 8px；列表可见 8 行（NSTableView 虚拟化） |
| 选中 | `accentSoft` 满行填充 + 左侧 2px accent 条（不反白——浅色 chrome 自洽） |
| 材质 | **浅色纸面 chrome**（镜像 tokens.ts；SummonerOverlay.swift 头有 lock-step 声明）——不做 Raycast 暗底 HUD（那需要先建 summoner 暗色 token 集，另票） |
| 配色 | 镜像 tokens.ts；**禁止** Material #4CAF50/#FF9800/#F44336 |
| 高度 | 收起 56px（单行检索含 12 内边距）；展开 428px（维持既有），结果区最多 8 行后滚 |
| 留白 | section 间距 16px；输入框上下 12px；搜索图标-光标 8px |
| 确认台 | 不改按钮文案与危险色，只统一字号 |

### 5b. 动效（钉死参数）

| 动效 | 参数 |
|---|---|
| 出现 | 150ms cubic-bezier(0.2,0,0,1)，fade + scale 0.98→1（transform） |
| 消失 | 120ms fade → alpha 到 0 后才 orderOut（防残影） |
| 选中移动 | 无动画（键盘跟随 0 延迟） |
| quick answer | 逐段 fade-in 100ms；加载态不闪空态 |
| 预热 | alphaValue=0 常驻 + orderFront 后动 alpha（零闪烁优先） |

### 5c. 键盘与匹配

- ↑↓ 选择 / ↵ 主动作 / ⌘1-9 快选 / Esc 逐级返回 / ⌘⏎ 在面板打开。
- 匹配：word-startswith 加权（词首 1.0 / 包含 0.5）+ 中文拼音首字母（仅 alias/title）。
- 排序：frecency（frequency × recency 衰减）；空查询 = frecency top-N。

### 5d. 状态

空态 = frecency 列表 + 动词；无结果 = fallback 动作位；权限态 = CTA 盒导流确认台。
三态都不空白。

### 5e. Swift 工程坑（写进实现的验收项）

1. **CJK IME**：Enter 提交区分 insertText（marked text 上屏）与 doCommandBy——最高优先级回归项。
2. **Space/全屏**：补 `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`；level 实测后定。
3. **热键**：Carbon RegisterEventHotKey 保留；避开纯 Option 修饰（Sequoia 15+ 注册失败）。
4. **列表虚拟化**：NSStackView → NSTableView（行复用）；不用 SwiftUI List。

### 5f. 设计稿验收

实现 PR 必须带 720 宽四态 PNG（收起/展开/选中/空态），对照本表 ±2px。无图不收。

## 6. 红线对账

- Blast「不新增 L2 类」✔（后台任务复用 SITE_OP/CU/tab-lease/loop 原样）
- 读历史只走脱敏派生通道 ✔（search/peek 只回蒸馏+redact）
- overlay 永不渲染 Allow/Deny ✔（L2_CONDUCTOR_ELSEWHERE + CTA 导流）
- 无新监听口 / 无第二扩展 / ws_secret 不当 grant / darwin-first ✔
- stamp 盖戳机制不动；payload 门模式沿用

## 7. 验收

- AC-1：空输入出 frecency 动词列表；输入过滤线程/知识/动词三层混排；无结果出 fallback。
- AC-2：选中历史线程 → thread.peek 脱敏预览；「引用进新任务」→ LLM 只见蒸馏段。
- AC-3：「打开侧栏/确认台」动词 → 面板/确认台前台；档位只能从召唤器降档。
- AC-4（P3）：「后台跑 XXX」→ user_gesture + lease 校验后任务在后台执行；L2 确认出现
  在确认台，overlay 只显示导流 CTA。
- AC-5：设计稿 PNG 四态对照参数表 ±2px；IME 中文输入 Enter 不误提交；全屏 app 上可见。
- AC-6（红线回归）：SUMMONER_ALLOW 默认拒不破；thread.select 全文路径不进检索流；
  loop/熔断/升级链零改动。

## 8. NEVER（沿用票面）

overlay Allow/Deny 交互不重做；无第二扩展；ws_secret 不当 grant；不把原文裸发 LLM；
不升档、不 arm 安全旗/档位类开关（config.set/modules/auto-approve 类一律禁）；`task_loop.arm`（线程级、三重闸内）仅作 P3 入口开放——开放入口 ≠ 升权；不承诺 Win/Linux 首发。
