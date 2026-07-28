# docs-reorg-p3 收口记录（2026-07-28）

## 1. 外审结果

| 审查方 | 结果 | 说明 |
|--------|------|------|
| **Pi** | **APPROVE** | 独立对照代码通过 8 项条件（session-trust G1、WORKER_HARD_DENY、链接、Phase1 FAQ 等） |
| **Claude** | **REJECT（基础设施）** | 全文仅为 `API Error 429` 使用上限；**不是**内容否决。额度重置约 **2026-07-28 15:56:26 CST** |
| **Kimi** | 未完成 | 同日 403 usage limit |
| **独立 adversarial（explore）** | **pass=false → 已修** | 发现 **1 blocking**（全局坐标开启路径夸大 UI）+ 若干 nits |

Verdict 文件：
- `docs/audit/reviews/docs-reorg-p3-verdict-20260728-135229.json`（claude=REJECT infra · pi=APPROVE）
- `docs/audit/reviews/docs-reorg-p3-pi-20260728-135229.md`
- `docs/audit/reviews/docs-reorg-p3-claude-20260728-135229.md`（429 原文）

**判定口径（收口）：**  
在 Claude 额度恢复前，以 **Pi APPROVE + adversarial blocking 已修 + 本地校验** 作为 Phase3 内容收口；Claude 内容复审列为 **额度恢复后可选复跑**（非阻塞合并文档）。

---

## 2. Blocking 修复（adversarial）

### 问题
`computer-use-user-guide.md` / ADR-017 暗示全局 `coordinateEnabled` 的「生产路径」是生物识别确认门，但扩展侧 **没有任何** `computer.set_enabled` 调用；Apps 面板仅为只读镜像。实用路径是 **`config.json`**。

### 修复
- `docs/computer-use-user-guide.md` §3 + 检查清单：写明 0.3.0 用户路径 = config.json；RPC 存在但 UI 未接线。
- `docs/adr/017-computer-use.md` Decision §2 + §9 UI 债 + Consequences。

### Nits 已修
- multi-agent：补 `idle_ttl_ms` / `hard_max_lease_ms`；注明 `wait_workers` 为轮询非屏障。
- README 目录树 ADR `001–018`。
- notebooklm 页脚路径改为真实文件名。

### 未改（有意）
- `tool-definitions.ts` host_computer 文案仍写「每任务必 L2」——属 **运行时 schema 文案债**，超出文档-only 范围；用户指南与 ADR-017 已正确描述 G1。

---

## 3. 本地校验（executed）

```text
test -f four user guides + ADR-017/018     → OK
rg 等待用户确认机制完成后开放 README       → empty
coordinateEnabled config-first wording     → present in guide + ADR-017
README links four guides                   → present
```

---

## 4. 可选后续

1. **15:56 CST 后** 重跑：  
   `bash scripts/dual-external-review.sh docs-reorg-p3 /tmp/cmspark-review-docs-reorg-p3.md HEAD`  
   （prompt 可沿用本批；期望 Claude 内容审在修复后 APPROVE / APPROVE_WITH_NITS）
2. 产品债：Side Panel 接通 `computer.set_enabled`（非文档任务）。
3. 与 Phase1–4 一并 docs-only commit。
