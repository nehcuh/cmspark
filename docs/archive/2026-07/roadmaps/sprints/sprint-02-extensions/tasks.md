# Sprint 02 — v2 扩展功能开发任务

> 阶段: v2 | 日期: 2026-05-24 | 关联需求: docs/requirements/v2.md
> 触发条件: MVP 完成并通过集成测试

---

## Phase 12: Type B Skills 执行引擎

### Task T12.1 — 工具链步骤定义 Schema
| 属性 | 值 |
|------|-----|
| **关联需求** | R12.1 |
| **依赖** | T9.1（MVP） |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 定义 `steps` 字段的 TypeScript 类型/Zod schema
- 每步骤结构：
  ```yaml
  steps:
    - tool: navigate
      params: { url: "https://example.com" }
      condition: ".login-form exists"  # 可选
      on_skip: next                     # next | skip_to_step | skip_to_end
    - tool: type
      params: { selector: "#username", value: "{{username}}" }
    - tool: click
      params: { selector: "#submit" }
      on_error: retry                    # retry | skip | abort
  ```
- 参数占位符语法：`{{param_name}}`，支持 `{{param.default_value}}`
- 条件表达式语法

**验收标准**:
- [ ] Zod schema 正确校验 step 结构
- [ ] 占位符正确解析

---

### Task T12.2 — 工具链执行引擎
| 属性 | 值 |
|------|-----|
| **关联需求** | R12.2 |
| **依赖** | T5.1（MVP）, T12.1 |
| **估时** | 4h |
| **状态** | pending |

**描述**:
- Step-by-step 执行器
- 执行前：解析占位符 → 用实际参数填充
- 条件分支：执行前检查 condition → 决定执行/跳过
- 错误分支：按 on_error 策略（retry/skip/abort）
- 暂停/继续：每步执行前检查用户是否暂停
- 执行进度 UI：当前步骤高亮 + 完成/失败图标

**验收标准**:
- [ ] 工具链按序执行
- [ ] 条件分支正确跳过
- [ ] 错误策略正确切换
- [ ] 暂停/继续/跳过功能正常

---

### Task T12.3 — 参数提示 UI
| 属性 | 值 |
|------|-----|
| **关联需求** | R12.3 |
| **依赖** | T12.2 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 激活 Type B skill 时解析 `parameters` 字段
- 执行前弹出参数填写面板：
  - 必填参数加 * 标记
  - 可选参数显示默认值
  - 参数类型校验（string/number/boolean/enum）
- 参数预览：填写后实时预览替换后的第一步

**验收标准**:
- [ ] 必填参数为空时阻止执行
- [ ] 类型错误提示
- [ ] 参数预览正确

---

## Phase 13: Type C Skills（子 Agent）

### Task T13.1 — 子 Agent 创建与隔离
| 属性 | 值 |
|------|-----|
| **关联需求** | R13.1 |
| **依赖** | T5.1（MVP） |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- 子 Agent Tool Definition：`delegate {system_prompt, tools_whitelist?, timeout_seconds?}`
- 并发池管理（上限 3）
- 每个子 Agent = 独立 LLM context（不共享父 Agent 的消息历史）
- 工具白名单隔离（父 Agent 可选择降级子 Agent 权限）

**验收标准**:
- [ ] 子 Agent 创建成功
- [ ] 并发 3 个限制生效
- [ ] 工具白名单隔离生效

---

### Task T13.2 — 子 Agent 执行与超时
| 属性 | 值 |
|------|-----|
| **关联需求** | R13.2 |
| **依赖** | T13.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 子 Agent 独立 LLM loop（复用 T5.1 逻辑但独立 context）
- 超时 120s 后自动终止
- 默认继承父 Agent 的信任域和权限
- 父 Agent 可创建时指定"只读模式"（子 Agent 只能读取，不能操作）

**验收标准**:
- [ ] 子 Agent 在 120s 内正常完成
- [ ] 超时返回 timeout error
- [ ] 只读模式生效

---

### Task T13.3 — 子 Agent 结果摘要
| 属性 | 值 |
|------|-----|
| **关联需求** | R13.3 |
| **依赖** | T13.2 |
| **估时** | 1h |
| **状态** | pending |

**描述**:
- 子 Agent 完成后：通过 LLM 生成摘要（不超过 500 字）
- 摘要包含：执行步骤数、关键发现、最终结果
- 失败时返回失败原因 + 最后执行的步骤
- 子 Agent 的完整执行历史单独存储（不在父线程显示）

**验收标准**:
- [ ] 摘要正确生成
- [ ] 失败摘要包含原因
- [ ] 完整日志可查

---

## Phase 14: "保存对话为 Skill"

### Task T14.1 — 对话范围选择 UI
| 属性 | 值 |
|------|-----|
| **关联需求** | R14.1 |
| **依赖** | T4.2（MVP） |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 线程消息上添加选择模式：用户点击消息范围 → 开始/结束标记
- "保存为 Skill" 按钮（选中范围后出现）
- 点击后：提取选中范围内的所有 tool calls → 发送给 companion 分析

**验收标准**:
- [ ] 多选消息范围 UI
- [ ] 消息选中后"保存为 Skill"按钮出现
- [ ] Tool calls 正确提取

---

### Task T14.2 — LLM 辅助参数化
| 属性 | 值 |
|------|-----|
| **关联需求** | R14.2 |
| **依赖** | T14.1, T3.3（MVP）, T9.2（MVP） |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- 将提取的 tool calls 发送给 LLM（含 writing-skills 方法论引导）
- LLM 分析每个 tool call 的参数，识别哪些需要参数化：
  - URL 中的系统名/路径 → `{{system_name}}` / `{{endpoint}}`
  - 输入值中的用户名/日期 → `{{username}}` / `{{date_range}}`
  - 保持不变的固定值（选择器、API endpoint名）
- 生成 frontmatter（name, description, type: tool_chain, parameters）
- 生成 markdown body（自然语言步骤描述 + structured steps）
- 用户确认面板：可编辑 name/description/参数/步骤

**验收标准**:
- [ ] LLM 正确识别可参数化的值
- [ ] 生成的 frontmatter 含正确参数列表
- [ ] 用户可调整所有生成内容后保存

---

### Task T14.3 — Skill 测试运行
| 属性 | 值 |
|------|-----|
| **关联需求** | R14.3 |
| **依赖** | T14.2, T12.2 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 生成 skill 后提供"测试运行"按钮
- 弹出参数填写面板
- 在新线程（或当前线程 clone）中试运行
- 结果展示：通过/失败的步骤 + 建议调整
- 测试通过后确认保存

**验收标准**:
- [ ] 测试运行环境隔离（不影响当前线程）
- [ ] 失败步骤高亮 + 修复建议
- [ ] 测试通过后保存确认

---

## Phase 15: 操作历史增强

### Task T15.1 — 历史重放
| 属性 | 值 |
|------|-----|
| **关联需求** | R15.1 |
| **依赖** | T10.2（MVP） |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 在操作历史中选择一条记录 → "从此处重放"
- 创建新线程（或确认覆盖当前线程）
- 从该步骤开始重新执行 tool call 序列
- 暂停在第一步，等待用户确认开始

**验收标准**:
- [ ] 历史记录选择 + 重放按钮
- [ ] 重放环境正确初始化
- [ ] 步骤按序执行

---

### Task T15.2 — 高级筛选与导出
| 属性 | 值 |
|------|-----|
| **关联需求** | R15.2 |
| **依赖** | T10.2（MVP） |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 高级筛选 UI：日期范围选择器 + 工具类型多选 + 线程下拉 + 成功/失败 toggle
- CSV 导出（含字段：时间、线程ID、工具名、参数、结果、耗时）
- 分页加载（历史数据多时）

**验收标准**:
- [ ] 多条件组合筛选
- [ ] CSV 导出完整
- [ ] 分页滚动加载

---

## Phase 16: Companion 增强

### Task T16.1 — Daemon 模式
| 属性 | 值 |
|------|-----|
| **关联需求** | R16.1 |
| **依赖** | T2.1（MVP） |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- `cmspark-agent start --daemon` 或 `cmspark-agent start -d` 后台运行
- PID 文件管理（防止重复启动）
- `cmspark-agent stop` 优雅关闭
- `cmspark-agent status` 查看运行状态
- 提供 launchd plist 模板（`~/.cmspark-agent/cmspark-agent.plist.example`）

**验收标准**:
- [ ] --daemon 后台运行（终端关闭不退出）
- [ ] stop 正确关闭进程
- [ ] status 返回 PID 和运行状态
- [ ] 重复启动被阻止

---

### Task T16.2 — 远程 Skill 安装
| 属性 | 值 |
|------|-----|
| **关联需求** | R16.2 |
| **依赖** | T9.4（MVP） |
| **估时** | 1h |
| **状态** | pending |

**描述**:
- `cmspark-agent skill install <url>` 命令
- 下载 URL 内容 → 校验 frontmatter 格式 → 写入 skills 目录
- 支持 GitHub raw URL / Gist URL / 任意直链

**验收标准**:
- [ ] URL 下载并校验成功
- [ ] 格式错误时提示
- [ ] 安装成功后 `skill.list` 立即可见

---

## Phase 17: 通知与 Options Page

### Task T17.1 — 子 Agent 通知
| 属性 | 值 |
|------|-----|
| **关联需求** | R17.1 |
| **依赖** | T13.2 |
| **估时** | 1h |
| **状态** | pending |

**描述**:
- 子 Agent 完成时通过 `chrome.notifications.create` 推送
- 通知内容：子 Agent 任务摘要 + 线程名
- 点击通知 → 切换到对应线程 Side Panel

**验收标准**:
- [ ] 通知正确推送
- [ ] 点击通知打开 Side Panel
- [ ] 通知权限管理

---

### Task T18.1 — Options Page
| 属性 | 值 |
|------|-----|
| **关联需求** | R18.1 |
| **依赖** | T3.2（MVP） |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 独立 options.html 全页面配置
- 配置分组 tabs：LLM / 安全（信任域）/ Skills（目录路径）/ 历史（保留策略）
- 配置导出（完整 config.json 下载）
- 配置导入（JSON 文件上传 + 校验）

**验收标准**:
- [ ] Options page 完整渲染
- [ ] 配置导入/导出功能正常
- [ ] 导入 JSON 格式校验

---

## Sprint 任务总览

| Phase | Task | 依赖 | 估时 | 状态 |
|-------|------|------|------|------|
| 12 Type B | T12.1 步骤定义 Schema | T9.1 | 2h | pending |
| | T12.2 执行引擎 | T5.1, T12.1 | 4h | pending |
| | T12.3 参数提示 UI | T12.2 | 2h | pending |
| 13 Type C | T13.1 子 Agent 创建 | T5.1 | 3h | pending |
| | T13.2 执行与超时 | T13.1 | 2h | pending |
| | T13.3 结果摘要 | T13.2 | 1h | pending |
| 14 对话→Skill | T14.1 范围选择 UI | T4.2 | 2h | pending |
| | T14.2 LLM 参数化 | T14.1, T3.3, T9.2 | 3h | pending |
| | T14.3 测试运行 | T14.2, T12.2 | 2h | pending |
| 15 历史增强 | T15.1 历史重放 | T10.2 | 2h | pending |
| | T15.2 高级筛选导出 | T10.2 | 2h | pending |
| 16 Companion | T16.1 Daemon 模式 | T2.1 | 2h | pending |
| | T16.2 远程 Skill 安装 | T9.4 | 1h | pending |
| 17 通知 | T17.1 子 Agent 通知 | T13.2 | 1h | pending |
| 18 Options | T18.1 Options Page | T3.2 | 2h | pending |
| **合计** | **15 tasks** | — | **31h** | — |

---

## 需求追溯矩阵

| Task | 关联需求 ID |
|------|------------|
| T12.1 | R12.1 |
| T12.2 | R12.2 |
| T12.3 | R12.3 |
| T13.1 | R13.1 |
| T13.2 | R13.2 |
| T13.3 | R13.3 |
| T14.1 | R14.1 |
| T14.2 | R14.2 |
| T14.3 | R14.3 |
| T15.1 | R15.1 |
| T15.2 | R15.2 |
| T16.1 | R16.1 |
| T16.2 | R16.2 |
| T17.1 | R17.1 |
| T18.1 | R18.1 |
