# 四路独立对抗合成 — pull main HEAD `6ce291db`（#221+#222）

> **日期**: 2026-08-25  
> **对象**: `git diff 1d16b0ed..6ce291db`（PR #221 post-#220 residual nits + PR #222 knowledge honesty Wave 0–2 + overlay HUD workbench compose）  
> **HEAD**: `6ce291db1c14b72823e26905df32bfe7d498c7e7`（live `origin/main`）  
> **Frozen patch**: `docs/audit/reviews/head-6ce291db-post220-diff-20260825.patch`  
> **SHA256**: `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548`（四路各自 `[executed]` 校验）  
> **Diff**: `git diff 1d16b0ed..HEAD -- ':!docs/audit' ':!memory' ':!PROJECT_CONTEXT.md'`（68 files, +5792/−612）  
> **方法**: 四路独立 agent；文件范围互斥；读 frozen patch + 活码 + 定向执行 + 变异杀死；本会话只编排/合成，不实现、不自评放行  
> **说明**: #220 已有合前/合后对抗。本轮是 **pull 后** 对 `1d16b0ed..HEAD` 的事后闸门。在库 Wave/HUD/nits 产物不得当本轮证据。

---

## 参与路与裁决

| 路 | 范围 | 裁决 |
|----|------|------|
| **A** | Overlay / Summoner HUD / ACL / Swift | **APPROVE_WITH_NITS**（nits×4，无 P0/P1） |
| **B** | Knowledge identity / distill / SkillEngine | **REJECT**（P1×3 + P2×2） |
| **C** | Side Panel / chrome-extension UX | **APPROVE_WITH_NITS**（nits×5，无 P0/P1） |
| **D** | LLM loop / router / redact / history | **APPROVE_WITH_NITS**（#221 HOLDs 未回归；nits×4） |

报告：

- `docs/audit/reviews/head-6ce291db-post220-lane-a-overlay-20260825.md`
- `docs/audit/reviews/head-6ce291db-post220-lane-b-knowledge-20260825.md`
- `docs/audit/reviews/head-6ce291db-post220-lane-c-sidepanel-20260825.md`
- `docs/audit/reviews/head-6ce291db-post220-lane-d-loop-20260825.md`
- Prompt: `docs/audit/reviews/_prompts/head-6ce291db-post220-adversary-20260825.md`

### 合成裁决

**REJECT.** A/C/D 全 AWN，#221 循环/lease/redact 在 #222 之后未回归。Lane B 三条 P1 与锁定 SoT 冲突（F-I-5 静默覆盖、PEM through-END 对超长密钥失效、F-S-1 注入无 untrusted 门）。须折完再开独立复验；本会话不实现。

---

## Capability（live SoT）

两份 spec 同 squash 对 overlay ACL **不一致**。A+D 独立确认 **活码以 HUD expand 为准**：

```text
Surface:      L0 Side Panel + L0 overlay HUD workbench
L2-classes:   (none on HUD; mcp.add stdio spawn reuses tray L2)
Compose:      knowledge (Wave 0–2) + pack.apply overlay-eligible + skill/mcp overlay-safe
Autonomy:     nextRun leftover / drain (unchanged)
Trust:        overlay ACL grew for overlay-safe writes;
              mcp.add / knowledge.import / config.set DENIED on summoner WS;
              no overlay Allow/Deny; pack.apply allowTrust forced false
Channel:      community
```

**Blast**: T2。未升 T3：overlay socket 不能 `mcp.add` / `knowledge.import` / `config.set`（A R1 `[executed]`）。

Knowledge-honesty 文案 “overlay ACL does not grow” 在 HEAD **已被 SUPERSEDE**（诚实描述，不是洞）。

---

## Blocking（必须修）

### B-P1-1 [P1] `importKnowledge` 对 ASCII 同名静默覆盖（F-I-5）

- **位置**: `companion/src/skills/skill-engine.ts:1402-1405`
- **证据**: `[executed]` Lane B：两次 `importKnowledge("# Notes\n…")` → 只剩 `notes.md`，第一份 body 消失。`[inspected]` 编排：`isLegacySafeId` 命中后 `taken.delete(preferred)`，再把 `preferredId` 交给 allocator，冲突后缀被主动关掉。
- **SoT**: F-I-5「冲突走 `nameOverride`/后缀，禁止静默覆盖」。F-I-1「旧英文 slug 不改 id」不等于两次 HITL 导入可以无提示互杀。
- **修法**: 已存在同 stem 且 **内容/来源不同** 时走 `notes-2`；只有显式 replace/update 才 `taken.delete`。补双导入测。

### B-P1-2 [P1] Distill PEM “through END” 在 body >4000 时泄漏

- **位置**: `companion/src/threads/distill.ts:6-7`
- **证据**: `[executed]` Lane B：`BEGIN RSA PRIVATE KEY` + 4200×A + END → BEGIN 被替换，`MIIE…` 仍进 preview。典型 ~3.2k RSA-4096 **会**整段 redact。BEGIN-only 备选把超长/头填充 PEM 的 **body** 留在 HITL markdown。
- **SoT**: F-S-8 / Wave 2「PEM through END」。用户确认导入会把密钥写进知识库。
- **修法**: 去掉 `{0,4000}?` 上限，或 BEGIN 后吞到 END/`\n\n`；禁止 BEGIN-only 留下密钥字符。补 4200-char 测。

### B-P1-3 [P1] 知识注入无 F-S-1 硬分隔 / 「忽略祈使句」

- **位置**: `companion/src/skills/skill-engine.ts:653-658`
- **证据**: `[executed]` Lane B：compose 为 `## Knowledge: {title} [{id}]\n{summary}`，无 `<untrusted>`、无忽略祈使句。RAG/truncate **有** `sanitizeKnowledgeContent`（must-falsify #3 PARTIAL HOLD）。
- **SoT**: F-S-1「regex 只是纵深，不是门」。漏网注入句成为 **system** 指令，权限高于 tool-result wrap。
- **说明**: Wave 0 dual 曾 AWN 过，不等于本轮独立对抗可放行。本轮按锁定 SoT 记 BLOCK。

---

## 跨路独立收敛（高置信 HOLD）

| ID | 结论 | 证据 |
|----|------|------|
| **S1** Overlay T3 不在 summoner WS | HOLD | A R1 37-probe + HTML 404；D 确认 handler 无 overlay 直达 `knowledge.import` |
| **S2** Overlay `pack.apply` 不能写 Trust B | HOLD | A 映射不发 Trust 字段；D `allowTrust: !overlayApply` `:3037` |
| **S3** #221 leftover/heal/drain/redact 未回归 | HOLD | D 138/138 + 四条 MUT 红；A S-C reclaim 活 token `[executed]` |
| **S4** 芯片 ⊆ 服务端 ledger | HOLD | C 只渲染 `msg.retrieved_sources`；D `adapter.ts:500-502` 只从 `buildSystemPromptWithSources` |
| **S5** Distill 预览不落盘 | HOLD | B `distill.ts` 无 `fs`；D `thread.distill_preview` 零 `importKnowledge` |
| **S6** 用户可见禁词 | HOLD | C exclusive grep 0 命中；图谱 → 会话关系图 |
| **S7** related ≤3 | HOLD | B helper cap 3；C UI `limit: 3` + `.slice(0, 3)` |

---

## 残留 nits（非阻断；BLOCK 折完后再收）

| ID | 路 | 摘要 |
|----|----|------|
| A-N1 | A | C-thin 技能只能 activate、知识 `ids:[id]` 整表替换、MCP toggle L2 stall（fail-closed） |
| A-N2 | A | ACL `pack.apply` extras 透传；深度防御在 D router |
| A-N3 | A | Windows 无 `dist/cmspark-tray`；pin `ed4dbfa0…` 仅 vs source；注释仍写 B0.5 |
| C-N1 | C | 「本轮附带」chip `cmspark:open-knowledge` 无 listener |
| C-N2 | C | `knowledge.import_directory` 无抽出预览（Wave 0b 原生 picker 切口；F-S-3 仍缺） |
| C-N3 | C | 确认钮在「正在解析…」/ 失败 `payload: {}` 时仍可点 |
| C-N4 | C | markdown-breaks 钉源码字符串，不钉 `MarkdownRenderer` |
| D-N1 | D | `history.db` 仍 200 字截断 code-tool，不 collapse（thread-JSON S-D2 HOLD） |
| D-N2 | D | `knowledge.import` `pin_thread_id` 无 32-cap |
| B-P2 | B | `loadFromDir` / `assertDirBudget` 不跳 junction；COM0/LPT0 不在 reserved |

---

## 已确认 HOLD（四路重放）

- Frozen SHA == 活 diff  
- Overlay 无 Allow/Deny；`thread.update` alias-only；`thread.delete` trash-only  
- Mac HUD `mcp.add` / `knowledge.import` 走 tray `companionClient`  
- Overlay 不能 `sidePanel.open`；无 HTML `getUserMedia`  
- CJK `{id,filename,title}`；CON/`../x` 哈希；无 “Use alphanumeric” throw  
- leftover `{text,clientMessageId}`；queue-full **不** `dropSteer`  
- heal skip 限定 in-flight assistant 块  
- drain pause/trash/cap 先于 take；upload 永不 `return drained`  
- redact `Authorization`/`Bearer`/`passwd`；`plainErrorResult` 重建；code-tool thread-JSON 必 collapse  
- `config.ts` 无新 `auto_approve_*`

---

## 机器（对抗路自行跑，非实现会话自评）

- A：`tsc --noEmit` 0；summoner 套件 **171/171**；私探 37/37  
- B：`tsc --noEmit` 0；exclusive **237 pass / 1 fail**（预存 `~/` + Windows `os.homedir()`，未当 REJECT）  
- C：targeted **32/32**；禁词 grep 0  
- D：`tsc --noEmit` 0；exclusive **138/138**；S-A2 / leftover-dropSteer / passwd / string-only-leaf 四条 MUT **红**

---

## Eval gate card — `head-6ce291db-post220`

**Blast tier**: T2  
**Capability**: 见上（HUD expand 为 overlay ACL SoT）

| Gate | Result |
|------|--------|
| MACHINE | **PASS**（四路定向套件；B 1 fail 预存 Windows `~` 测） |
| ADVERSARY | **REJECT**（B P1×3） |
| PI_REREVIEW | **N/A** — 对抗未过，不开 Pi |
| MERGE | **NO** — 已在 main。这是 **事后闸门**：折 B-P1-1/2/3 → 独立复验 → 再 dual。 |

`scripts/dual-external-review.sh` **不要**在本轮跑。实现会话不得用本文件自我 APPROVE。
