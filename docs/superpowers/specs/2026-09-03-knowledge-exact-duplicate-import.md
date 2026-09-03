# Knowledge Exact Duplicate Import — 导入完全重复检测（正文 sha256）

> **日期**: 2026-09-03  
> **状态**: **DRAFT**（Issue-first；待设计 dual）  
> **触发**: 用户问「导入要不要 md5 查重」；Kimi 2026-09-03 判断：值得做，不做 MD5、做正文完全重复；[#281](https://github.com/nehcuh/cmspark/issues/281)  
> **前序 SoT（不得削弱）**: [Knowledge Honesty](./2026-08-25-daily-assistant-knowledge-honesty-design.md) · [Knowledge CRUD Honesty](./2026-08-26-knowledge-crud-honesty-design.md)（F-I-5 同名加后缀 ≠ 内容重复）· [#272](https://github.com/nehcuh/cmspark/issues/272) 导入确认弹窗 · [#274](https://github.com/nehcuh/cmspark/issues/274) 文件夹  
> **GitHub:** [#281](https://github.com/nehcuh/cmspark/issues/281)。实现另开 PR，`Closes #281`。不夹带进已合的开闸 PR #280。

```text
Surface:      L0 Side Panel 单篇「确认导入知识」弹窗 + 目录导入结果计数
L2-classes:   (none)
Compose:      importKnowledge 前对剥 frontmatter 后的 body 做 sha256 对照；无新 SoT
Autonomy:     低（单篇询问；目录导入自动跳过并计数）
Trust:        纯本地，无新外发；overlay / summoner 无新确认面
Channel:      既有 WS（knowledge.preview / knowledge.import / knowledge.import_directory）
```

**Blast tier**: **T2** — 导入确认 UX + 目录导入跳过；纯本地、用户仍可强制导入第二份。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| 导入前检测「正文逐字节相同」 | **GO** |
| 用 MD5 | **NO-GO** — 仓库哈希口径是 sha256；MD5 不出现在文案、字段、注释产品句 |
| 近似重复 / 语义相似 / minhash / embedding | **NO-GO** — 另一张票、另一个量级 |
| 静默覆盖已有文档 | **NO-GO** — F-I-5 仍在：文件名撞车加 `-2`，内容重复不覆盖 |
| 静默拒绝单篇导入 | **NO-GO** — 弹窗告知，用户取消或仍导入 |
| 目录导入遇到完全重复 | **GO 自动跳过并计数** — 目录导入没有逐篇确认面 |
| 把哈希写入 frontmatter 当 SoT | **NO-GO** — 每次对照现算；用户看不见哈希 |
| overlay / summoner 新开确认面 | **NO-GO** |
| 标题/标签改了、正文没改 | **仍判重复** — 哈希对象是剥 frontmatter 后的 body |
| 正文改一个字 | **不判重复** |

**产品句：**

> 用户往知识库再放一篇已经在库里的文档时，能看见「内容和已有的那篇完全一样」，然后自己决定要不要取消；一次导入一整个文件夹时，重复的自动跳过，并告诉用户跳过了几篇。

---

## 1. 现状证据

- `SkillEngine.importKnowledge`（`companion/src/skills/skill-engine.ts`）只按 **文件名 stem** 避撞：`allocateDocIdentity` 占用则加 `-2`，**从不比较正文**。同一篇导入两次 = 两份文档、两个 id。
- 单篇路径：`knowledge.preview` → ChatView「确认导入知识」→ `knowledge.import`（`user_gesture`）。
- 目录路径：`knowledge.import_directory` 结果已有 `skippedOversize` / `skippedUnsupported` / `failed`，**没有重复计数**。
- `_folder.md` 的 `content_fingerprint` 是文件夹说明指纹，**不是**文档去重。

---

## 2. 哈希对象（钉死）

```
H(doc) = sha256(utf8( gray-matter(raw).content.trim() ))
```

- 输入 = 即将写入磁盘的 markdown 源（docx/pdf 等已转成 md 之后）。
- **剥 frontmatter**：只哈希 body。改标题/说明/标签不改变 H。
- `trim()` 只去首尾空白，不去正文内部空白。
- 空 body 也有哈希；两篇空 body 算重复。
- 对照范围 = `knowledge/global` ∪ `knowledge/sites` 全部知识 `.md`（不含 `_folder.md`、不含 skills）。桶不隔离：global 与 sites 正文相同仍算重复。
- 多篇已有相同 H：报告 **id 字典序最小** 的那一篇（稳定、可测）。
- N ≤ 200（既有库 cap）。导入时现算，不建持久哈希索引。

---

## 3. 单篇导入

`knowledge.preview` 响应增加可选：

```ts
duplicate_of?: { id: string; title: string }
```

弹窗在标题上方加一行（11px，`tokens.textSecondary`），有 `duplicate_of` 才渲染：

> 内容与已有文档《{title}》完全相同

- **取消** = 现有取消（不写盘）。
- **确认导入** = 现有确认，**仍导入第二份**（新 id；文件名 stem 仍走 F-I-5）。不另加复选框。
- 解读中 / 解析中也可以先出这行（哈希不依赖 LLM）。
- 文案禁词：不出现「MD5 / sha256 / 哈希 / 相似 / 去重合并 / 簇 / 聚类 / 图谱」。`《》` 内是已有文档 title。

---

## 4. 目录导入

在写盘前算 H。已有相同 H → **不调用** `importKnowledge`，`skippedDuplicate++`。

`knowledge.import_directory_result` 增加：

```ts
skippedDuplicate: number
```

面板结果句补「跳过重复 N 篇」（N=0 不出现这句）。被跳过的：

- 不占「成功导入」计数
- 计入 `totalScanned`
- 不因跳过而少扫后面的文件

不逐篇弹窗。

---

## 5. 通道与降级

- overlay / summoner：不新增确认面；既有 `SUMMONER_ACL` 不变。
- 哈希失败（某篇现有文档 gray-matter throw）：该篇不参与对照，不当作命中；导入路径不中断。
- 无新 WS 动词。

---

## 6. 验收

1. 同一 md 单篇导入两次：第二次 preview 带 `duplicate_of` 指向第一篇；点取消后库仍 1 篇；点确认导入后库 2 篇、id 不同。
2. 第二次只改标题再 preview：仍 `duplicate_of`（body 哈希不变）。
3. 第二次改正文一个非空白字符：无 `duplicate_of`。
4. 目录导入两份相同 body：`imported` 含 1、`skippedDuplicate === 1`，文案出现「跳过重复 1 篇」。
5. 文案扫描：新 copy 不含 §3 禁词表。
6. 全仓无 `md5` / `MD5` 作为本功能标识（测试名/注释用 sha256）。
7. F-I-5 回归：不同 body、同一 ASCII 标题仍分配 `notes-2`，不覆盖。

---

## 7. NEVER

- overlay Allow/Deny；第二只 Chrome 扩展；`ws_secret` 当 MCP grant
- 近似重复 / embedding / 把哈希写入用户可见 frontmatter
- 静默覆盖或静默拒绝单篇
- 召唤器导入确认面
- 夹带进无关 PR

---

## 8. 实现前

1. Issue **先于** spec。本文件头 `GitHub: #281`。
2. 设计 dual 过后再实现。实现 PR `Closes #281`。
3. 不在 main 直接实现。
