# Sprint 03 — 技能系统增强 开发任务

> 版本: 1.0.0 | 日期: 2026-05-26 | 需求: docs/requirements/skill-system-enhancement.md

---

## 任务概览

```
Phase 1: F1 斜线命令弹窗 (T1-T4)
  T1: SlashCommandPopover 组件
    ├── T2: 集成到 InputArea
    │     └── T3: 命令解析与发送
    │           └── T4: 边界处理与打磨

Phase 2: F2 技能提取 (T5-T8)
  T5: Companion skill-craft handler
    └── T6: SkillCraftPanel UI
          └── T7: 端到端流程集成
                └── T8: 边界处理与打磨
```

---

## Phase 1 — F1 斜线命令弹窗

### T1 — SlashCommandPopover 组件

**目标**: 创建独立的弹窗组件，接收技能列表和搜索文本，渲染候选列表

**文件**:
- 新建 `chrome-extension/src/sidepanel/components/SlashCommandPopover.tsx`

**实现要点**:

1. **组件接口**
   ```
   Props:
     skills: SkillMeta[]          // 全部可用技能
     searchText: string           // 当前输入的 /xxx 文本
     visible: boolean             // 是否显示
     position: { top: number, left: number }  // 弹窗定位
     onSelect: (skill: SkillMeta) => void   // 选中回调
     onDismiss: () => void        // 关闭回调
   ```

2. **匹配与排序**
   - 从 searchText 提取搜索词（去掉 `/` 前缀）
   - 空搜索词 → 显示全部技能
   - 匹配算法：name 前缀 > name 包含 > description 包含
   - 每项显示：类型图标 + 技能名 + 描述

3. **键盘交互**
   - `ArrowDown/ArrowUp` 移动高亮索引（循环）
   - `Enter` 选中高亮项 → 调用 `onSelect`
   - `Escape` → 调用 `onDismiss`

4. **样式**
   - 绝对定位，与 textarea 等宽
   - 最大高度 240px，超出 `overflow-y: auto`
   - 高亮项背景 `#E8F0FE`
   - 匹配文字加粗标记
   - 弹出动画（可选，fade-in 150ms）

5. **空状态**: 无匹配技能时显示 "无匹配技能，输入 / 查看全部"

**验收**:
- [ ] 弹窗在 `/` 输入后正确显示
- [ ] 输入文字实时过滤
- [ ] ↑↓ 键导航，Enter 选择，Esc 关闭
- [ ] 点击弹窗外部关闭
- [ ] 弹窗位置不超出视口

---

### T2 — 集成到 InputArea

**目标**: 修改 App.tsx InputArea，检测 `/` 输入并控制弹窗显示

**文件**:
- 修改 `chrome-extension/src/sidepanel/App.tsx`

**实现要点**:

1. **触发检测状态**
   - 新增 state: `slashVisible`, `slashSearchText`, `cursorPosition`
   - 在 `onChange` / `onInput` 中检测当前输入

2. **触发规则**
   ```
   光标前一个字符是 '/' 且 (光标在行首 或 光标前是空格)
   → 设置 slashVisible = true
   
   继续输入 → 更新 slashSearchText
   
   删除到 '/' 之前 → 设置 slashVisible = false
   
   在非行首/非空格后输入 '/' → 不触发
   ```

3. **弹窗定位**
   - 从 textarea 的 `selectionStart` 计算光标像素位置
   - 弹窗显示在 textarea 上方（`bottom: textarea.height + gap`）
   - 边界检测：上方空间不够时显示在下方

4. **选择处理**
   - `onSelect(skill)` → 将 `/<skill-name>` 插入 textarea 光标位置，关闭弹窗
   - 光标自动移到插入文本之后

5. **依赖**: T1 完成

**验收**:
- [ ] 行首输入 `/` 弹窗正确显示
- [ ] 空格后输入 `/` 弹窗正确显示
- [ ] 文本中间 `/` 不触发弹窗
- [ ] 弹窗定位在 textarea 上方
- [ ] 选择技能后文本正确插入

---

### T3 — 命令解析与发送

**目标**: 修改 handleSend 逻辑，解析 `/command` 并自动激活技能

**文件**:
- 修改 `chrome-extension/src/sidepanel/App.tsx`

**实现要点**:

1. **解析函数**
   ```typescript
   function parseSlashCommand(text: string, skills: SkillMeta[]): {
     skillId: string | null
     message: string   // 原始消息（保留 /command）
   }
   ```
   - 正则提取行首的 `/(\S+)` 模式
   - 在 skills 列表中按 name 匹配
   - 返回匹配到的 skillId（或 null）

2. **发送逻辑修改**
   ```
   原: skillIds = state.activeSkillIds
   新: skillIds = [...state.activeSkillIds, parsedSkillId].filter(unique)
   
   发送的 message 保留 /command 文本（LLM 可据此调整行为）
   ```

3. **重复激活处理**: 如果 parsedSkillId 已在 activeSkillIds 中，不重复添加

4. **依赖**: T2 完成

**验收**:
- [ ] `/browse` 发送后 browse skill 自动激活
- [ ] `/unknown-skill` 发送普通消息，无 skill 激活
- [ ] 多个消息先后使用 `/` 命令，各自正确激活
- [ ] 已激活技能不会被重复添加

---

### T4 — 边界处理与打磨

**目标**: 处理边界情况，打磨用户体验

**文件**:
- 修改 `SlashCommandPopover.tsx`、`App.tsx`

**实现要点**:

1. **技能列表为空**: skills 为空时不显示弹窗
2. **CSS 动画**: 弹窗 fade-in 150ms `@keyframes`
3. **滚动条样式**: 窄滚动条，匹配主题
4. **分段显示**: 弹窗内按 builtin/user 分段，每段有小标题
5. **技能被删除时**: 弹窗中的列表实时反映最新 skills 状态（已通过 props 传入）
6. **弹窗内 hover**: 鼠标悬停项同步高亮

**验收**:
- [ ] 所有 F1.6 边界情况正确处理
- [ ] 弹窗动画流畅
- [ ] 分段显示清晰

---

## Phase 2 — F2 技能提取

### T5 — Companion skill-craft handler

**目标**: 在 companion 端实现技能提取的消息处理和 LLM 分析逻辑

**文件**:
- 新建 `companion/src/skills/skill-craft.ts`
- 修改 `companion/src/message-router.ts`

**实现要点**:

1. **新增 WS 消息类型**: `skill.craft`

2. **消息格式**
   ```typescript
   // 请求 (extension → companion)
   {
     type: "skill.craft",
     thread_id: string,
     message_ids?: string[]   // 可选，指定消息范围
     message_count?: number   // 可选，最近 N 轮
   }
   
   // 响应 (companion → extension)
   {
     type: "skill.crafted",
     skill: {
       name: string
       description: string
       type: "prompt_template" | "tool_chain"
       parameters?: { name, type, required, default, description }[]
       body: string           // markdown 正文
     },
     source_messages: number  // 分析了多少条消息
   }
   ```

3. **分析流程**
   - 从 thread-manager 加载消息历史
   - 按 message_ids 或 message_count 筛选范围
   - 构建分析 prompt
   - 调用 LLM（复用 adapter 的 openai client）
   - 解析 LLM 输出为结构化 skill
   - 返回给 extension

4. **分析 Prompt**

   System prompt 内容：
   ```
   分析以下 Agent 对话历史。用户要求 Agent 执行了一些浏览器操作，
   Agent 通过 tool calls 完成了任务。

   请提取可复用的操作模式，生成一个 Skill 文件：
   - 如果对话中有明确的 tool call 序列 → 生成 tool_chain 类型
   - 如果对话主要是指导性内容 → 生成 prompt_template 类型

   输出格式严格遵循：
   ---
   name: <字母数字连字符>
   description: <一句话中文描述>
   type: <tool_chain | prompt_template>
   parameters:
     <param_name>:
       type: <string | number | boolean>
       required: <true | false>
       default: <默认值或空>
       description: <参数说明>
   ---
   
   # <技能标题>
   
   <步骤或指导内容，使用 {{param_name}} 标记参数>
   ```

5. **错误处理**
   - LLM 调用失败 → 返回错误消息
   - 对话历史不足以提取 → 返回提示 "未发现可提取的操作模式"
   - 输出格式解析失败 → 返回原始输出 + 错误提示

6. **依赖**: 无（纯 companion 端开发）

**验收**:
- [ ] skill.craft 消息能被正确处理
- [ ] LLM 分析返回结构化 skill
- [ ] 空对话/无操作时返回恰当提示
- [ ] 错误场景有合理降级

---

### T6 — SkillCraftPanel UI

**目标**: 在 Extension 端实现技能提取的触发、预览、编辑和保存 UI

**文件**:
- 新建 `chrome-extension/src/sidepanel/components/SkillCraftPanel.tsx`

**实现要点**:

1. **触发入口**
   - 线程顶部栏添加 "提取技能" 按钮（图标：🔧 或类似）
   - 仅当线程有消息时可用（空线程灰色禁用）

2. **分析范围选择步骤**
   ```
   ┌──────────────────────────────────┐
   │  提取技能                         │
   │                                  │
   │  分析范围:                        │
   │  ○ 整个线程对话 (47 条消息)       │
   │  ○ 最近 10 轮对话                 │
   │                                  │
   │  [取消]              [开始分析]   │
   └──────────────────────────────────┘
   ```

3. **分析进度状态**
   - 发送 `skill.craft` → 等待响应
   - 显示 loading: "正在分析对话历史..."
   - 完成后切换到预览步骤

4. **预览编辑步骤**
   ```
   ┌──────────────────────────────────┐
   │  提取技能 — 预览                  │
   │                                  │
   │  名称: [export-report_______]    │
   │  描述: [导出周期性报表数据____]    │
   │  类型: [tool_chain ▼]           │
   │                                  │
   │  参数:                           │
   │  ┌────────────────────────────┐  │
   │  │ system_url  string  required│  │
   │  │ report_type string  默认:... │  │
   │  └────────────────────────────┘  │
   │  [+ 添加参数]                    │
   │                                  │
   │  正文:                           │
   │  ┌────────────────────────────┐  │
   │  │ # 导出报表                  │  │
   │  │ 1. 导航到 {{system_url}}    │  │
   │  │ ...                        │  │
   │  └────────────────────────────┘  │
   │                                  │
   │  [取消]  [测试运行]  [保存技能]  │
   └──────────────────────────────────┘
   ```

5. **保存流程**
   - 调用现有的 `skill.import` 消息
   - 成功后关闭面板，刷新技能列表
   - 显示 toast 提示 "技能已保存"

6. **依赖**: T5 完成

**验收**:
- [ ] 触发入口可见且交互正确
- [ ] 分析进度 loading 状态正常
- [ ] 预览面板可编辑所有字段
- [ ] 保存后技能出现在列表中
- [ ] 取消操作正确关闭面板

---

### T7 — 端到端流程集成

**目标**: 串联 F1 和 F2，确保完整闭环

**文件**:
- 修改 `chrome-extension/src/sidepanel/App.tsx`
- 修改 `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`

**实现要点**:

1. **消息监听**
   - useWebSocket 新增 `skill.crafted` 消息处理
   - 收到后 dispatch 到 store，打开 SkillCraftPanel

2. **技能刷新**
   - skill.craft 保存成功后自动 `skill.list`
   - 新技能立刻出现在 slach command 弹窗中

3. **闭环验证**
   ```
   对话 → 提取技能 → 保存 → /new-skill 调用 → 验证可用
   ```

4. **依赖**: T6 完成

**验收**:
- [ ] 完整闭环可走通
- [ ] 新技能立即可通过 `/` 调用
- [ ] 技能名称冲突时有提示或自动重命名

---

### T8 — F2 边界处理与打磨

**目标**: 处理 F2 边界情况

**文件**:
- 修改 `skill-craft.ts`、`SkillCraftPanel.tsx`

**实现要点**:

1. **空对话线程**: 触发按钮灰色禁用
2. **LLM 超时**: 120s 超时，提示用户重试
3. **仅用户消息（无 tool calls）**: LLM 可能生成 prompt_template 类型
4. **格式解析失败时**: 展示原始 LLM 输出，供用户手动调整
5. **技能名重复**: 自动追加 `-2`、`-3` 后缀
6. **导出按钮**: 在预览步骤提供 "导出 .md" 按钮（复用现有导出）

**验收**:
- [ ] 所有 F2.5 边界情况正确处理

---

## 任务依赖图

```
T1 ──→ T2 ──→ T3 ──→ T4
                    │
T5 ──→ T6 ──→ T7 ──→ T8
```

- Phase 1 (T1-T4) 和 Phase 2 (T5-T8) 可并行开发
- 每阶段内任务严格顺序依赖

---

## 工作量估算

| 任务 | 估时 | 说明 |
|------|------|------|
| T1 | 2h | 独立组件，纯前端 |
| T2 | 1.5h | textarea 集成 + 光标定位 |
| T3 | 1h | 命令解析逻辑 |
| T4 | 1h | 动画、分段、边界 |
| T5 | 2.5h | LLM prompt 设计 + handler |
| T6 | 2h | 三步面板 UI |
| T7 | 1h | WS 消息 + store 串联 |
| T8 | 1h | 边界处理 |
| **合计** | **12h** | |

---

*开发顺序: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8*
