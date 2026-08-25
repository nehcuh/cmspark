# Daily Assistant · Knowledge Honesty — 四路对抗合成

> **日期**: 2026-08-25  
> **输入 strawman**: 浏览器+本机知识为主叙事；P0 中文名+docx 入库；P0 引用；P1 分类；P1 overlay 展开到侧栏；P2 双链 1 跳；P2 Project；远程/Raycast 以后  
> **车道**: Product · Impl · Security · External（独立 explore subagent，互不可见）  
> **产出 SoT**: [design spec](../../superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md)

## Lane verdicts

| 路 | VERDICT | 一句话 |
|----|---------|--------|
| Product / JTBD | **MAJOR_REVISE** | CJK+禁止静默入库对；展开=侧栏失败 Raycast job；Project=Pack 是第四名词；ThreadDigest 式分类会再造空壳；先入库再引用是覆盖率失败重演 |
| Impl / Architecture | **MAJOR_REVISE** | 定位已在代码里。CJK 不是改 regex（id=filename=title 塌缩）。禁止新表。引用=UI ledger。overlay 无法打开 Side Panel。Project 无 schema |
| Security / Trust | **REJECT** | Overlay C-thin 是唯一已经紧的句子。RAG 跳过 sanitizer；知识是 prompt oracle；auto-tag 当过滤器=自确认投毒；overlay 禁止 knowledge/MCP 管理 |
| External / Anti-bloat | **REJECT THE BUNDLE. KEEP THE BET** | 主叙事 GO。整包是输掉的 2026-06 激进知识提案换皮。只留：确认导入 + 附带芯片 + 中文名 |

## BLOCK 并集 → 已折入 SoT

| ID | 来源 | 折入 |
|----|------|------|
| Overlay 展开当主路径 | Product BLOCK | 本切片不改 overlay 协议；技能/设置诚实去侧栏 |
| 模型脚注 | 四路 BLOCK | `retrieved_sources` ledger；芯片 ⊆ 注入集 |
| ThreadDigest 式事后分类 | Product BLOCK | 无 Category 实体；导入确认写 tags |
| Project 实体/名词 | 四路 BLOCK | 禁 |
| CJK = 一行 regex | Impl/Security BLOCK | `{id,filename,title}` + 六写路径 + 冲突后缀 + Windows 保留名 + 0o600 |
| 新 categories/projects/边库 | Impl BLOCK | F-I-2 |
| companion 打开 Side Panel | Impl BLOCK | F-I-4；已有测试锁 never openSidePanel |
| RAG 跳过 sanitizer | Security BLOCK | Wave 0 必带 |
| 无预览的 import | Security BLOCK | Wave 0b `user_gesture` + 抽出预览 |
| 攻击者 `site: *.com` | Security BLOCK | F-S-4 wildcard |
| Overlay 涨 ACL | Security BLOCK | F-S-5 |
| 自动对话入库 | 四路 | F-S-8 / F-E-5 |
| 远程 KB | External/Security BLOCK | F-E-6 |
| Raycast 对标 | External BLOCK | F-E-1 |
| 知识图谱/双链 | External BLOCK + 2026-06 锦标赛 | F-E-3 |
| 引用无 retrieve 当 Perplexity | External BLOCK | Wave 1 = 披露芯片，不是 `[n]` |

## 未折入本 bet（预存在 / 另票）

- Overlay chat 不能确认却仍暴露 `mcp__*`（Security F-S-12）。**不恶化、本切片不修完。**
- 2026-06 D3：`all` 模式 compact index 仍未做。Wave 1 **不**同时加 `query_knowledge`。

## 合成后的脊柱

```text
Wave 0   identity + RAG sanitize + 安全写盘
Wave 0b  Side Panel 确认导入（parseFile 已有）
Wave 1   本轮附带芯片
Wave 2+  相关≤3 / 提炼为知识 / 话题夹 / 插件分发
NEVER    Project、图谱、远程库、overlay 知识管理、模型脚注、自动入库
```
