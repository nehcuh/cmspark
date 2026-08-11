# 会话关联图谱 — Obsidian 式全页视图（设计稿）

| Field | Value |
|-------|--------|
| Date | 2026-08-11 |
| Status | **v1 landed · impl dual-review APPROVE_WITH_NITS** |
| User pins (2026-08-11) | 打开会话后 **保持图谱标签**；侧栏边列表 **v1 删除** 只开全页图；写码前 **Pi+Claude dual-review** |
| Design dual-review | 20260811-174739 both **APPROVE_WITH_NITS** |
| Impl dual-review | 20260811-175737 both **APPROVE_WITH_NITS** (+ nits fixed) |
| Parent IA | [2026-08-06-thread-history-ia-product-design.md](2026-08-06-thread-history-ia-product-design.md) §B.3 · [gap Wave C](2026-08-11-thread-history-ia-gap-optimization-adversarial.md) C-3 |
| Surface | **L0 产品特性**（聊天元数据可视化）— 非 L2 / 非 Composition 原语 |
| ADR-020 | Surface L0 · Compose none · Autonomy none · Trust no elevation |

---

## 0. 问题：预期 vs 现状

### 用户预期（本次反馈）

- **弹出一个网页**（独立、大画布）
- **类似 Obsidian Graph**：节点 + 边、力导向/可拖拽
- **每个点可点进去**（进入对应会话）

### 现状（[inspected] `ThreadList.tsx`）

| 项 | 实现 |
|----|------|
| 入口 | ☰ → ⋯ →「🕸 关联图谱」 |
| UI | Side Panel 内 **portal 小卡片** |
| 呈现 | **边的文本列表**：`会话A ↔ 0.42 会话B`（最多 40 条） |
| 交互 | 点标题 → `handleSelect` 切换线程并关弹层 |
| 数据 | `buildRelatedEdges`（共 tag + TF + 时间邻近） |

**差距**：规格 B.3 写过「侧栏简化列表 + **全图可在新标签打开**」，Wave C-3 写过「力导向可简」——实现停在 **侧栏列表 MVP**，未交付全页图。

```
期望:  [网页]  ●──●──●  力导向  点击进会话
现状:  [侧栏]  A ↔ 0.42 B   文本行
```

---

## 1. 产品目标

### 1.1 Jobs

| JTBD | 说明 |
|------|------|
| 探索 | 在几十～几百会话中 **看见主题簇与桥接会话** |
| 跳转 | 从图上 **一键打开** 某个会话继续聊 |
| 诊断 | 一眼看出 **孤立点**（无边 → 提示先「提取要点」） |

### 1.2 原则（与 IA 锁一致）

1. **时间轴仍是默认导航**；图谱是探索轴，不抢 ☰ 默认位。  
2. **数据纯本地**（digest 共 tag / TF）；无 embedding、无云同步。  
3. **无 digest ≈ 无边**；空图必须引导批量提取，不假装有图。  
4. **窄栏不画全图** — 全图必须 **独立网页/标签**（或 ≥720px 窗口）；侧栏可保留「相关 3 条」与「打开全图」。  
5. **ADR-020**：不把图节点写 Knowledge、不加 L2 工具。

---

## 2. 信息架构与入口

### 2.1 入口（保留 + 升级）

| 入口 | 行为 |
|------|------|
| ☰ → ⋯ →「关联图谱」 | **改为** 打开全页图（新标签），**不再**只开侧栏列表 |
| 侧栏「相关 3 条」旁（可选 v1.1） | 小链「在图中查看」→ 同页并 `?focus=<thread_id>` |
| 键盘（可选 v1.1） | `/graph` slash 或快捷键 — 非 v1 阻塞 |

### 2.2 页面形态

| 方案 | 选择 | 理由 |
|------|------|------|
| A. 扩展页 `tabs/thread-graph.html`（类 Cockpit） | **v1 采用** | 与现有 `tabs/cockpit` 模式一致；可 `chrome.tabs.create` |
| B. `window.open` 空白 + blob | 不用 | 无 extension API、难持久 |
| C. 侧栏全屏 overlay | 仅作降级 | 仍受限 320px；不作为主路径 |

**URL 形态（扩展内）**：

```text
chrome-extension://<id>/tabs/thread-graph.html
chrome-extension://<id>/tabs/thread-graph.html?focus=<thread_id>
```

**窗口**：`chrome.tabs.create({ url, active: true })` — 用户感知为「弹出网页」；可选后续 `windows.create` 独立窗（非 v1）。

---

## 3. 交互设计（Obsidian 对齐）

### 3.1 布局

```
┌─────────────────────────────────────────────────────────────┐
│ 关联图谱          [搜索会话]  [仅有边] [显示孤立]   [关闭]   │
├──────────────┬──────────────────────────────────────────────┤
│ 图例 / 筛选   │                                              │
│ · 共标签边    │            ○───○                             │
│ · 要点相似边  │           /     \                            │
│ · 强度滑条    │          ○       ○  ← 力导向画布             │
│              │           \     /                            │
│ 当前焦点      │            ○───○                             │
│ · 标题        │                                              │
│ · tags        │                                              │
│ · tldr        │                                              │
│ [打开会话]    │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **画布**：占满剩余视口；暗/浅跟随系统或固定浅色 Quiet Premium。  
- **左栏 ~240px**：图例、强度阈值、焦点详情（可折叠）。  
- **空状态**：中央文案 + 主按钮「为未标注提取要点」→ `runtime.sendMessage` 触发与 ThreadList 相同批处理（或提示用户回 ☰ 操作）。

### 3.2 节点

| 属性 | 规则 |
|------|------|
| 身份 | 一会话一节点 |
| 标签 | `alias` 或 `未命名 · id前6`；过长 ellipsis |
| 尺寸 | 与 **度数** 或 **边权之和** 弱相关（min/max clamp） |
| 颜色 | 默认同色；可选按 **主 tag** 哈希着色（v1.1） |
| 状态 | hover 高亮邻接；focus 环；孤立点半透明（若开启显示） |

### 3.3 边

| 类型 | 视觉 | 来源 |
|------|------|------|
| 硬边 | 实线，略粗 | `shared_tags.length ≥ 1` |
| 软边 | 虚线 / 更淡 | 仅 TF/时间分、无共 tag |
| 粗细 | `score` 映射 strokeWidth 1–4 | `buildRelatedEdges` |

### 3.4 手势

| 手势 | 行为 |
|------|------|
| **单击节点** | 左栏展示详情；**不立即关页** |
| **双击节点** 或点「打开会话」 | 切换 active thread + `sidePanel.open`（或 focus 已有 Side Panel）；**图谱标签保持打开**（用户 pin 2026-08-11） |
| 拖节点 | 固定该节点位置（pin），其余继续模拟 |
| 滚轮 | 缩放 |
| 拖空白 | 平移 |
| 单击空白 | 取消 focus |

### 3.5 与 Side Panel 的协同

```
Graph 页                         Background SW                    Side Panel
   |  click "打开会话"                  |                              |
   |--- runtime message -------------->|                              |
   |   { type: "thread.select", id }   |--- store / WS thread.select ->|
   |                                   |--- sidePanel.open ----------->|
   |  (optional highlight focus)       |                              |
```

**消息契约（v1）** — 见 §5。

---

## 4. 数据与算法（复用，不重造）

### 4.1 节点集

- 来源：Side Panel / SW 可见的 **live threads**（排除 trash；默认排除 `agent_role=worker`，与 S2 一致）。  
- 字段最小集：

```ts
type GraphNode = {
  id: string
  title: string           // displayThreadTitle
  tags: string[]
  tldr?: string
  updated_at?: string
  degree: number          // 由边计算
}
```

### 4.2 边集

复用 `buildRelatedEdges` / companion `thread.related` 同源逻辑：

```ts
type GraphEdge = {
  a: string
  b: string
  score: number
  shared_tags: string[]
  kind: "hard" | "soft"   // hard = shared_tags.length > 0
}
```

| 参数（v1 默认） | 值 | 说明 |
|-----------------|-----|------|
| `minScore` | 0.2（与现 UI 一致） | 可在左栏滑条 0.1–0.5 |
| `maxEdges` | 200 | 防 O(n²) 爆炸 |
| 节点 cap | 300 最近活跃 | 超出提示「仅显示最近 N」 |

### 4.3 布局

| 阶段 | 算法 |
|------|------|
| v1 | 自实现 **简易力导向**（斥力 + 边弹簧 + 中心重力）或引入轻量 `d3-force`（若 bundle 可接受） |
| 不做 | Louvain 社区主 UI、3D、WebGL 粒子 |

仿真：rAF 循环，~300 tick 或能量阈值停止；用户拖拽时局部唤醒。

---

## 5. 接口与模块边界

### 5.1 新文件（实现时）

| 路径 | 职责 |
|------|------|
| `chrome-extension/src/tabs/thread-graph.tsx` | Plasmo 页入口（同 cockpit） |
| `chrome-extension/src/thread-graph/ThreadGraphApp.tsx` | 布局 + 状态 |
| `chrome-extension/src/thread-graph/force-layout.ts` | 力导向纯函数 / 类 |
| `chrome-extension/src/thread-graph/GraphCanvas.tsx` | canvas 或 SVG 绘制 |
| 复用 | `sidepanel/utils/thread-related.ts`（可抽到 `src/utils/` 供 tab 页 import，避免双份） |

### 5.2 Runtime 消息

| type | 方向 | payload | 行为 |
|------|------|---------|------|
| `thread_graph.open` | Side Panel → SW | `{ focus_id?: string }` | `tabs.create` graph URL |
| `thread_graph.bootstrap` | Graph → SW | — | 返回 `{ threads: GraphNodeSeed[] }` 或指示从 storage 读 |
| `thread.select` | Graph → SW → Panel | `{ thread_id }` | 已有路径优先复用 |
| `thread_graph.extract_untagged` | Graph → SW → Panel | — | 转发批量提取（或仅 toast 指引） |

**线程数据如何进 Graph 页（决策）**

| 方案 | 利弊 | v1 |
|------|------|-----|
| A. Graph 页连 Companion WS 拉 threads | 完整但重 | 否 |
| B. SW 持有最近 threads 快照（Side Panel 上报） | 中等 | **采用** |
| C. `chrome.storage.session` 写快照 | 简单 | 可与 B 并用 |

**v1 数据流**：

1. Side Panel 打开图前：`runtime.sendMessage({ type: "thread_graph.prepare", threads: slim[] })`  
2. SW 写入 `chrome.storage.session.thread_graph_snapshot`  
3. Graph 页 mount 读取 snapshot + 本地 `buildRelatedEdges`  
4. 过期：snapshot 带 `ts`；>5min 显示「数据可能过期，请从侧栏重新打开图谱」

`slim` 字段：id, alias, updated_at, created_at, agent_role, digest{tldr,tags,bullets,stale} — **不含** 消息正文。

### 5.3 权限

- 已有 `tabs` / `storage` / `sidePanel` 足够。  
- **不**新增 host 权限。

---

## 6. 视觉（Quiet Premium）

- 背景：`tokens.bg` / 略深画布 `#f0f2f7`  
- 节点填充：`tokens.bgElevated`；描边 `tokens.borderStrong`  
- 焦点：`tokens.accent` 环  
- 硬边：`tokens.accent` 低透明；软边：`tokens.textMuted`  
- 字体：11–13 系统栈（与 Side Panel 一致）  
- **不用** emoji 作节点主图形（可用小点）

---

## 7. 空态与错误

| 状态 | UI |
|------|-----|
| 0 节点 | 「暂无会话」 |
| 有节点 0 边 | 「还没有关联边。请先在侧栏对会话「提取要点」生成标签。」+ CTA |
| snapshot 缺失 | 「请从 Side Panel ☰ → 关联图谱 打开（需带数据）。」 |
| 节点过多被裁 | 顶栏 warning chip |

---

## 8. 验收标准（可测）

| # | 标准 |
|---|------|
| G1 | ☰ → 关联图谱 → **新标签** 打开 graph 页（非仅侧栏列表） |
| G2 | ≥2 条共 tag 边时，画布出现 **节点与边**（非纯文本行） |
| G3 | 单击节点 → 左栏详情；双击或「打开会话」→ active thread 切换 |
| G4 | 无 digest 时空态引导提取，不崩溃 |
| G5 | 时间轴默认位不变；列表打开不依赖图页 |
| G6 | 无新 L2/Compose/Trust 抬升 |
| G7 | 单测：`buildRelatedEdges` 边 kind 划分；layout tick 有限步不 NaN |

---

## 9. 明确不做（v1）

- Obsidian 本地 vault 真同步 / .md 双向  
- 全局 embedding / 向量库  
- 默认 Louvain 社区着色主 UI  
- 把图谱当默认首页  
- 侧栏 320px 内完整力导向（可保留「相关 3 条」）  
- 自动打开每个节点为独立浏览器 tab（仅切换 CMspark 线程）

---

## 10. 分期

| 阶段 | 交付 | 工时感 |
|------|------|--------|
| **v1** | 新标签 graph 页 + 力导向 + 打开会话 + 空态 + snapshot 管道；侧栏入口改开页 | 2–4d |
| **v1.1** | `?focus=` 高亮；边类型筛选；滚轮缩放 polish；tag 着色 | +1–2d |
| **v2** | 独立窗、导出 PNG、@ 引用边（C.1b） | 另议 |

侧栏现状「边列表」：**v1 删除**（用户 pin 2026-08-11）——入口只负责 `thread_graph.open` 开全页图，避免双实现混淆预期。

---

## 11. 已锁定决策（实现不得回退）

| ID | 决策 |
|----|------|
| **TG-1** | 主体验 = 扩展内 **新标签网页**（`tabs/thread-graph`），非侧栏列表 |
| **TG-2** | 力导向节点图；边 = 共 tag（硬）/ TF+时间（软） |
| **TG-3** | 单击 = 详情；双击或按钮 = 打开会话；**不关图谱标签** |
| **TG-4** | 侧栏边列表 **移除**；☰→关联图谱 → 仅开全页 |
| **TG-5** | 数据经 SW snapshot（slim threads）；纯本地 related 算法 |
| **TG-6** | 无 embedding / 无 Knowledge 双写 / 无 L2 |

---

## 12. 风险

| 风险 | 缓解 |
|------|------|
| 无 digest → 永远空图 | 空态 CTA + 产品文案强调先提取要点 |
| O(n²) 卡顿 | maxEdges / 最近 N 节点；边在 worker 可选 |
| Side Panel 未开时无法 select | SW 仍 `thread.select` + 下次打开 Panel hydrate |
| Plasmo 多页打包 | 对齐 cockpit 的 `tabs/*.tsx` 模式 |

---

## 13. 落地状态（2026-08-11）

| 阶段 | 结果 |
|------|------|
| Design dual-review | APPROVE_WITH_NITS (`thread-graph-obsidian-view-verdict-20260811-174739`) |
| Impl v1 | `tabs/thread-graph` + force canvas + SW snapshot + 入口改开页 |
| Impl dual-review | APPROVE_WITH_NITS (`thread-graph-impl-v1-verdict-20260811-175737`) |
| Nits follow-up | 空态引导 / tokens 画布色 / kind 测试硬断言 / URL fallback 收紧 |
| 测试 | chrome-extension **622 pass** |

**用法：** Side Panel ☰ → ⋯ → **关联图谱** → 新标签力导向图；单击节点看详情，双击或「打开会话」切换线程（图谱保持打开）。无边时先「为未标注提取要点」。

**本文件是写码前 SoT**；与「当前边列表」冲突时以本文件 v1 + §11 pins 为准。
