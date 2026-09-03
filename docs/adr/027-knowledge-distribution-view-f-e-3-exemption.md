# ADR-027: F-E-3 窄豁免 — 派生、可重建、非用户维护的知识分布视图

**日期**: 2026-09-03 | **状态**: Accepted（Wave B）
**相关**: [Spec: Knowledge Retrieval Scoring §6/§7](../superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md) · [GitHub #273](https://github.com/nehcuh/cmspark/issues/273) · [ADR-026](./026-knowledge-retrieval-tfidf-no-embedding.md) · [Knowledge Honesty](../superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md) · [Knowledge Folders (#274)](../superpowers/specs/2026-09-02-knowledge-folders-design.md)

> **开闸记录（2026-09-03）**：诚实门评测双栏通过（`node scripts/knowledge-route-eval.mjs` → `folder: pass` / `group: pass`，`--strict` 同过），两只分支常数 `KNOWLEDGE_ROUTE_FOLDER_BRANCH` / `KNOWLEDGE_ROUTE_GROUP_BRANCH` 按 spec §6.6 开闸为 `true`；用户侧「按堆选文」开关默认仍关（`knowledge_route_by_group` undefined=false），漂移扳机不变——路由输入面任何改动 ⇒ 回 false 重跑评测重证。

---

## 决策

### 1. 一句话

> 对 F-E-3（本季无知识图谱 / 分类树 / 双链）启用**窄豁免**：允许一个「派生的、可重建的、非用户维护的」知识**分布视图**（列表面包上方的过滤 chips）与配套的**两段式簇路由**（可选、默认关、诚实门把守）。豁免仅限于此；图谱 UI / 分类本体 / 双链 / 持久边仍全禁。

### 2. 背景

- 用户 2026-09-02 拍板（原话：「图谱/聚类意义很大，可以给用户体感上很直观的感受，我要求这个必须有」），推翻双路评审的 Wave B 冻结建议，Wave B 升级为 #273 本季交付范围（spec §6）。
- F-E-3 的立法意图是防止「系统替用户维护一套分类本体 / 图谱」带来的复杂度与诚实风险。本豁免把允许对象收窄到**纯派生视图**：分组关系只存在于可重建的派生索引（`DATA_DIR/cache/knowledge-index.json`），不写入任何 SoT。

### 3. 豁免范围（仅限以下，逐条钉死）

| 项 | 决定 |
|----|------|
| 分布视图 | 知识面板列表上方的**过滤 chips**（分组名 + 计数，点击 = 过滤列表），不是与「站点｜文件夹」抢默认的第三个视图；面板强制诚实句「自动分组，不准就移到文件夹。」 |
| 派生索引 | `cache/knowledge-index.json`（0o600，`atomicWriteJSON`），存每篇文档的稀疏纯 TF 向量（title + description + tags + 首块）；**可丢、可重建**；损坏/半截按缺失处理，不 throw、不阻塞注入 |
| 聚类 | average-link 凝聚，cosine over **纯 TF**（不用 TF-IDF，避免 IDF 漂移破坏确定性）；`MERGE_MIN=0.25`、`MIN_SIZE=3`、`DOC_CAP=200`、`MIN_DOCS=20`；确定性三钉（id 字典序进矩阵、合并平局取 min(id)、簇–簇平局取簇键 = 成员 id min） |
| 簇标签 | 只从 title + tags 取高频词（频次并列取字典序最小），过 `normalizeTag` / `SENSITIVE_TAG_RE` + `redactSecrets`（取 `.text`）；**禁止 LLM 起名**进检索回路（可选 `llmExtract` 美化默认关、不落盘、不进检索——本实现未做） |
| 簇路由 | 只作用 auto（all 硬排除、manual 强制 no-op、空 query no-op、智能匹配关 no-op）；打分语料 = Wave A 入选集 ∪ pinned ∪（FOLDER_BRANCH ∧ 命中夹 ? 夹全部成员）∪（GROUP_BRANCH ∧ 无命中夹 ? top-1-2 派生组成员）；第二趟不重截 k（输出扩张，由预算截）；注入序四步 pinned → 入选按分 + recall 槽（至多 displacement 末位一篇）→ 分组概览吃剩余（≤2000 含 wrap、计入 8000）→ 其余按分含尾部 |
| 诚实门 | 两只分支常数 `KNOWLEDGE_ROUTE_FOLDER_BRANCH` / `KNOWLEDGE_ROUTE_GROUP_BRANCH` ~~出厂均 false~~ → **true**（2026-09-03 开闸）；评测（20 query × ≥20 文档，分栏 `folder|group: pass|fail|absent`，absent 与 fail 同等）该栏 pass 才允许把对应常数改 true；路由输入面任何改动 ⇒ 对应常数回 false 重证 |
| 通道 | `knowledge.list` 顶层派生字段 `distribution?: { groups: [{ key, label, count, ids }] }`（key = 稳定身份键，带命名空间前缀：分组 `c:<成员 id min>`、「未分组」`u:ungrouped`；label 仅显示，碰撞加消歧后缀）；**禁** per-doc `cluster_id`；summoner 必剥、overlay 亦剥（严于 related 先例；放行谓词看 handshake `session.surface === "panel"`，不看 stamp 后值） |

### 4. 对「事实上分类树」质疑的预先反驳

最锋利的一击：「派生分组 + 纠正（移到文件夹）= 事实上的用户可调分类树」。预先反驳四点（spec §7）：

1. **分组非层级、不可编辑、随重建蒸发**；用户不能改组成员，只能改文档归属。分类树的本体是「用户维护的层级节点」，这里既没有层级（一层平铺 chips），也没有可编辑的分组实体。
2. **纠正（移文件夹）作用于文档归属，不作用于分组本体**；分组本体从不被保存——它是每次重建时从磁盘 `.md` 重新算出来的视图状态，不是一份可以被「调成什么样就是什么样」的数据。
3. **路由是可选粗索引、默认关（§6.6 诚实门），不是检索本体**；检索本体仍是 Wave A 扁平 TF-IDF 打分。用户分类的唯一 SoT 是 #274 文件夹（磁盘目录）。
4. **#274 落地前视图纯只读**（§6.4）——「非用户维护」不被读成「假装用户可纠正」；#274 落地后诚实句指向的纠正通道是真实存在的移动功能，视图本身仍是纯只读 chips（点击 = 过滤，不是编辑）。

### 5. 锁定（全程不碰）

- **F-E-10 / 锁 C1 文本不碰**：无 embedding（含 opt-in 也不开）、无 graph DB、无新 runtime。
- 无持久簇 SoT：`cluster_id` frontmatter / `.clusters.json` / `knowledge.graph*` 全禁（F-I-2 安全：磁盘 `.md` 仍是唯一 SoT，索引派生可丢）。
- 图谱 UI 名词全禁（F-UX-NOUN-1 全表 +「分类树 / 自动分类 / 簇 / 聚类 / 知识地图」），用户可见只用「分布 / 分组」；内部术语「知识地图」一律称「分组概览」。
- 无新 WS 动词（分布走 `knowledge.list` 顶层派生字段）；overlay Allow/Deny 不涨；无 `query_knowledge` tool；检索回路零 LLM。
- 注入仍 `sanitizeKnowledgeContent` + untrusted wrap（F-S-1/2）；分组概览同款 sanitize + wrap，**不得**写成可信路由指令块。

### 6. 回退

豁免随实现回滚即失效：删 `knowledge-clusters.ts`、通道字段与 UI chips 即回到 ADR-026 状态；派生索引文件删除不影响任何用户数据。
