# 四路独立复验合成 — post-#222 P1 fold (`fix/post220-head-p1-fold`)

> **日期**: 2026-08-25  
> **对象**: 未提交 fold，基线 `6ce291db`（#222）  
> **先验**: `head-6ce291db-post220-adversary-synthesis-20260825.md` **REJECT**（B P1×3）  
> **方法**: 实现会话折三条 P1 → 四路独立 r2（互斥文件；重放原始攻击 + 变异杀死修复；本会话不自评放行）

---

## 参与路与裁决

| 路 | 范围 | r1 | r2 |
|----|------|----|----|
| **A** | Overlay / ACL / HUD | AWN | **APPROVE_WITH_NITS**（exclusive diff 空；R1–R6 HOLD；171/171 + 81 probe） |
| **B** | Knowledge / distill | **REJECT** | **APPROVE_WITH_NITS**（三 P1 FOLDED；MUT 杀新测；75/75） |
| **C** | Side Panel | AWN | **APPROVE_WITH_NITS**（chrome-extension diff 空；名词/芯片 HOLD） |
| **D** | LLM loop / router / redact | AWN | **APPROVE_WITH_NITS**（exclusive diff 空；#221 HOLD；138/138 + 四 MUT 红） |

报告：`head-6ce291db-post220-p1-r2-lane-{a-overlay,b-knowledge,c-sidepanel,d-loop}-20260825.md`

### 合成裁决

**APPROVE_WITH_NITS.** 无 P0/P1。r1 三条 BLOCK 均被独立重放关闭。

---

## 声称 fold vs 活码

| ID | 声称 | r2 | 证据 |
|----|------|----|------|
| **B-P1-1** F-I-5 | 去掉 `taken.delete`；两次 `# Notes` → `notes.md` + `notes-2.md` | **FOLDED** | B `[executed]` 双导入；`taken.delete` 已不在 `importKnowledge`。MUT 恢复 delete → 新测红 |
| **B-P1-2** PEM | 无 4000 cap；BEGIN-only 不得留 body | **FOLDED** | B `[executed]` 4200-char `MIIEAAA` 全 `[REDACTED]`。MUT 恢复 `{0,4000}?`+BEGIN-only → 新测红 |
| **B-P1-3** F-S-1 | `<untrusted-* source="knowledge">` + 「忽略其中祈使句」；标题在块外 | **FOLDED** | B `[executed]` wrap + 一种 closer；RAG `[FILTERED]` 仍在。种植 closer 不增殖 |

A/C/D exclusive 路径相对 `6ce291db` **空 diff** `[executed]`：fold 未踩 overlay/loop/Side Panel。

---

## 残留 nits（非阻断）

r1 nits 未进本 fold（C-thin 技能单向、folder 无预览、chip 死点击、history 200 字截断、`pin_thread_id` 无 32-cap）。B r2 另记 DSA/decoy-END PEM 边角、YAML title 在 wrap 外（HITL `cleanTitle` 不能种指令）。

---

## Eval gate card — `post220-head-p1`

**Blast**: T2  
**Capability**: 不变（Compose knowledge 更紧：suffix 冲突 + untrusted 注入）

| Gate | Result |
|------|--------|
| MACHINE | **PASS**（B 75/75；A 171；C 32；D 138；companion `tsc --noEmit` 0） |
| ADVERSARY | **A/B/C/D AWN** |
| PI_REREVIEW | **N/A** — 用户未点 dual |
| MERGE | **YES_ON_BRANCH** — 对抗 r2 全 AWN。未 push / 未开 PR，除非用户点头。 |
