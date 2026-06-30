# ADR-008: Obsidian 对话导出

**日期**: 2026-06-30 | **状态**: 已确认（PR #5 已合并）

## 背景

CMspark 的对话是浏览器内 Agent 的产物（user/assistant/tool 交织，含大量 tool_call/tool_result 噪音、base64、抓取的 HTML）。用户希望把有价值的对话沉淀进自己的 Obsidian vault（或任意 markdown 库），而不是把一大段带噪音的原始 JSON 塞进笔记。

需求：导出的笔记要 (a) 干净可读（噪音折叠），(b) 贴合用户 vault 的既有约定（frontmatter/命名/tag），(c) 融入 vault 的知识图谱（wikilinks/模板），(d) 支持把长对话浓缩成结构化摘要。

## 决策

### 1. v1 = UI 下载模式，不写宿主文件

companion 生成 markdown 字符串 → 通过 `thread.exported_obsidian` 回传 → 浏览器 Blob 下载。**companion 不写宿主文件系统、不做路径沙箱。**

理由：MVP 阶段避免「agent 往用户磁盘写文件」这一整类安全/权限问题（与 [ADR-006](006-layered-defense.md) 的 default-deny 精神一致）。用户掌握写入（下载到哪、是否进 vault）。后续若加自动写入，再单独评估沙箱。

### 2. 四档导出 scope，复用同一序列化管线

| 入口 | scope | 内容 |
|---|---|---|
| per-message 📥 | `single` | 仅该条消息（用户要的是「这条回答」本身，不含问题/其它轮） |
| header 📥 | `thread` | 整个 thread |
| 🧠 header / thread-list | `summary` | LLM 结构化摘要 + 折叠完整对话附录 |

`single`/`thread` 走纯序列化 `serializeThreadToMarkdown`；`summary` 走 `summarizeThread`（一次性 `llmExtract`，见 [llm-extract.ts](../../companion/src/llm/llm-extract.ts)）→ `serializeSummaryToMarkdown`。frontmatter/footer/模板管线在两种路径复用，**优先级 reserved > template > profile > default**。

> 注：per-message 📥 原为 `qa_pair`（问题+回答整轮），用户反馈后改为 `single`。同时修复了 UI 客户端消息 id 与 companion 持久化 id 不一致（`chat.done` 回传 message_id）的问题。

### 3. vault 档案：LLM 提取约定，严格隐私 + 缓存

`scanVault` 递归采样 ~200 篇笔记 → LLM 提取 `frontmatter_schema`/`tag_conventions`/`naming_pattern`/`note_name_template` → 缓存于 `~/.cmspark-agent/obsidian/profile.json`（mode 0o600）。

**隐私**：只发笔记 **basename**（不含绝对路径）+ frontmatter（capped 20 键/500 字）+ 正文前 200 字给 LLM。导出时按需刷新（Settings → 刷新 vault 档案），不重扫。

### 4. wikilinks 用纯 TF 余弦，模板只做静态替换

- **footer `[[wikilinks]]`**：复用 `semantic-match.ts` 的 tokenize（CJK 2-gram）/tokensToVec/cosine，**纯 TF（不加 IDF）**，严格阈值 + top-K。P2 评估通用词偏差对「辅助插链」够用；若噪声大后续在调用层加 IDF（**不改 semantic-match**，它是 skill 基础设施）。尊重 `profile.wikilink_style`（含「几乎不用」则不加 footer）。
- **模板骨架**：`detectTemplates`（`.obsidian/templates.json` 或 `templates/` fallback）→ `applyTemplate` **静态占位符替换**（`{{title}}`/`{{date}}`/`{{time}}`/`{{content}}` + 常见 `<% tp.* %>` 正则）。**不执行 Templater JS**——未知 `<% %>` 保留原样。

### 5. 健壮性 / 安全（对抗验证 + kimi 门产出）

- **frontmatter 行解析器**（非 `yaml.load`）：`{{placeholder}}` 不是合法 YAML 标量，且含冒号/URL 的替换值会让 `yaml.load` 抛错并静默吞掉所有键。行解析器把每个值保留为字符串/数组。
- **`frontmatterRaw` 正则确定性提取**：gray-matter 的 `.matter` 属性不可靠（部分内容/版本下为 undefined），曾静默丢模板 frontmatter；改用 `^---\n…\n---` 正则提取。
- **realpath containment**：`resolveTemplatesDir` 在 `fs.realpathSync` 真实路径上校验「严格在 vault 内」，防 `templates.json` 指向 symlink 逃逸 vault（kimi 抓到）+ TOCTOU（`lstatSync`+`!isSymbolicLink` + 逐文件 realpath 复检）。
- **`stripLoneSurrogates`**：`scanVault` 的 `slice(0,200)` 可能切分 surrogate pair → lone surrogate → JSON `\uD8XX` → 严格服务端解析器（DeepSeek）400「unexpected end of hex escape」。在 scanVault（`safeSlice`+strip）和 llmExtract（boundary 防御）两处清除。
- **原生文件夹选择器**：扩展无法读所选文件夹的真实绝对路径（MV3 `File.path` 不可靠），故 `folder-picker.ts` 走 companion（macOS osascript / Linux zenity / Windows PowerShell）。

## 后果

**正面**：对话沉淀进 vault 的完整闭环（干净导出 + 约定贴合 + 知识图谱融入 + 摘要）；v1 无新增写文件的安全面；纯函数序列化器易测；每阶段对抗验证 + kimi 门拦下多个真实 bug（symlink 逃逸、gray-matter `.matter`、lone surrogate 400、marker-only transcript、fence 截断、Header dispatch 崩溃等）。

**权衡 / 后续**：
- 纯 TF 无 IDF：通用词可能致弱相关链；阈值从严 + 实测后可在调用层调。
- 单值 `summarizingThreadId`：并发摘要的 spinner 状态是已知 accepted tradeoff（单用户 side panel）。
- 自动写入 vault（P?）：当前明确不做，需单独评估沙箱 + 确认机制。
- 主聊天路径（adapter.ts 文件上传/线程内容）尚未应用 `stripLoneSurrogates`——若常规聊天遇同类 400，复用该 helper 即可。
