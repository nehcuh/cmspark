# CMspark 后续优化计划（ADR-020 后）

> **日期**: 2026-07-29  
> **状态**: Active — **取代** [`optimization-plan-post-v0.3.0.md`](optimization-plan-post-v0.3.0.md) 作为排序权威  
> **规范本体**: [ADR-020 能力三轴](adr/020-capability-model-three-axes.md)  
> **诊断基线**: [diagnosis-fanout-2026-07-28.md](audit/diagnosis-fanout-2026-07-28.md)（~6.9 / B-）  
> **P1 代码盘点**: [audit/p1-security-open-items-2026-07-29.md](audit/p1-security-open-items-2026-07-29.md)  
> **流程门禁**: [CONTRIBUTING.md](../CONTRIBUTING.md) · [`.github/pull_request_template.md`](../.github/pull_request_template.md) · dual-review checklist

旧 plan（2026-07-11）记录 v0.3.0 发布后的 P2/P3/P4 与部分已闭环 PR；**仍可读作考古**，但 **新工作优先级以本文 A–E 为准**。

---

## 0. 当前状态（截至 2026-07-29）

| 维度 | 状态 |
|------|------|
| **产品版本** | 0.3.0（companion / extension） |
| **能力本体** | ADR-020 Accepted；README / architecture / GOAL / DESIGN / 用户指南坐标已同步 |
| **文档重梳** | 07-28 P0 事实错误 + 导航 + 用户指南 + Phase4 归档：**已合 main**（PR #80 一带） |
| **代码安全（07-25 High 簇）** | 选择器注入、config 预鉴权、CU session-trust 旁路、stream 线程、Stop≠abort、package host 等：**FIXED** |
| **开放 High/Med 安全** | 见 §B / P1 盘点四条：**均 OPEN** |
| **工程 backlog 旧文件** | post-v0.3.0 plan **过时**（未含 Pack/CU/Multi-agent/ADR-020）→ 本文 supersede |

### 一句话定位（做事准则）

> 默认 **L0/L1 浏览器 Agent**；场景用 **Pack / Skill / MCP** 叠加；**L2 宿主** opt-in 且 Trust 更严；编排属 **Autonomy**，不是更深 Agent runtime。

---

## 1. 工作骨架 A–E

```text
A  治理与文档     流程、清单、指标、计划单一事实源
B  Trust 硬约束   07-28 P1 四条（优先于新功能）
C  Composition    Pack-first 场景扩张
D  Surface L2     CU/Host/HUD 打磨（opt-in 路径）
E  Autonomy       仅 defer 表内；spawn 保持 L2 HITL
```

横切工程卫生（e2e smoke、coverage 观测、Node 对齐）不单独成「轴」，挂在各轨或 §F。

---

## A · 治理与文档

| 项 | 状态 | 说明 |
|----|------|------|
| ADR-020 + 产品文档对齐 | ✅ | README 三轴矩阵；GOAL 轴标注；docs 导航 |
| CONTRIBUTING 能力声明 | ✅ | 声明块 + 反模式 |
| **PR template** | ✅ 本批 | `.github/pull_request_template.md` |
| **dual-review 能力清单** | ✅ 本批 | `docs/audit/reviews/_templates/dual-review-capability-checklist.md` + `scripts/dual-external-review.sh` 注入 |
| **本优化计划** | ✅ 本批 | 本文 |
| **P1 盘点** | ✅ 本批 | `docs/audit/p1-security-open-items-2026-07-29.md` |
| 发版治理指标（ADR-020 §7） | 🔶 待办 | 发版前盘点：一级 UI 入口数、确认 family 数、新 WS 消息族、场景指南 vs 轴文档 |
| 旧 optimization-plan 页眉 | ✅ 本批 | 指向本文 |
| user/ 物理搬家 | 可选 | docs-reorg 遗留，非阻塞 |

**反模式（拒绝进 main）**

1. 无 Pack 替代却新增 Side Panel **一级**常驻入口  
2. 已有 L2/域/CU 门足够时再发明确认方言  
3. tool_whitelist + skill + pack 足够时再发明 Agent runtime  
4. 实验定位器（TinyClick 等）当写路径成功依赖  
5. 架构文档裸写「中层 Agent」

---

## B · Trust 硬约束（代码优先）

权威细节与文件锚点 → [p1-security-open-items-2026-07-29.md](audit/p1-security-open-items-2026-07-29.md)。

| 顺序 | ID | 工作 | 状态 | 工时感 |
|------|-----|------|------|--------|
| 1 | **P1-1** | companion 对 god-mode / auto_approve* **0→1** 做 phrase 或专用 arm 消息（UI 剧场不够） | OPEN | 0.5–1d |
| 2 | **P1-2** | MCP + navigate（及缺绑的 L2）默认 `originWs`；双 peer 回归测 | OPEN | 0.5d |
| 3 | **P1-3** | evaluate：批准后 **不**二次改写已绑定 code（extension 或 companion 单点净化） | OPEN | 0.5–1d |
| 4 | **P1-4** | shell_exec：收紧 allowlist metachar / 中期 argv 化；锁 god-mode 不静默跳过 shell L2 | OPEN | 1–2d（含设计） |

**Done 判据（B）**：四条均有回归测 + dual-review；盘点文档 Status 更新为 FIXED。

### 旧 plan 安全纵深对照（避免重复）

| 旧 ID | 内容 | 现态 |
|-------|------|------|
| M1 tabUrlCache | 导航刷新 | ✅ 已落地 |
| M2 输入侧 untrusted 标记 | tool 结果包络 | 🔶 未在本盘点强制；可挂 C 或 defer |
| M3 osascript 范围化 | 二次确认 | 🔶 部分 L2 已在；精确范围化未单独立项 |
| M4 analyze_image 门 | vision | 🔶 保留为可选 follow-up |
| M5 cookie 扩展 enforce | 扩展端 | 🔶 可选 follow-up |
| L12 healthz | `/healthz` | ✅ 已落地 |

---

## C · Composition（场景叠加主路径）

| 项 | 状态 | 说明 |
|----|------|------|
| Mission Pack 平台 | ✅ | ADR-014；AppSec 内置 pack |
| MCP / Skills / Knowledge / user-env | ✅ | 组合原语齐备 |
| **新场景默认交付物** | 规范已写 | Pack（+ 可选 1 skill 和/或 1 MCP），**非**新面板 |
| Datayes / 投研类 | 🔶 产品待做 | 坐标：**L0 + Skill/MCP/knowledge**；真浏览器 tool 才 L1 |
| 更多黑盒 / 合规 checklist | 🔶 | 复制 AppSec Pack 模式 |
| G10 SSO 自动复用 | deferred | S:L1 + C |
| G11 Type B 工具链 skill | deferred | C + A；勿与新 runtime 混淆 |
| G13 skill-craft | ✅ | 已实现 |

每个 Pack/模块 PR 必须填 **能力声明**（PR template）。

---

## D · Surface L2 打磨

| 项 | 状态 | 说明 |
|----|------|------|
| Computer Use / Host / Apps | ✅ 主路径 | 用户指南已有；平台诚实（Linux 等见 ADR-018） |
| session-trust / forceForeground / estop | 多批已修 | 真机回归按需 |
| Native HUD P3a spike | Task 1–7 源码/ship note 已合 | 可选：env 真机 checklist；**P3a-full** ConfirmElevated 对等 — 仍是 L2 **通道**，非第二 runtime |
| 双轨截图洪水 | **NO-GO** | 直至明确设计 + dual-review |
| codesign / notarize / Authenticode | 🔶 长杆 | 发布体验；不阻塞 B/C |

---

## E · Autonomy

| 项 | 状态 | 说明 |
|----|------|------|
| multi-worker + tab lease | ✅ P0 | ADR-015 |
| Mission Board | ✅ P0 | ADR-016 |
| spawn L2 HITL | ✅ | 禁止静默 fan-out |
| shared-observer / auto-spawn / 真 wait_workers / 自由文本 ask_user | deferred | ADR-015/020 |
| G12 Type C Skill | deferred | **≠** 已交付 worker 编排；单独设计前不做 |
| G14 历史重放 | deferred | A |

---

## F · 工程卫生（横切）

| 项 | 状态 | 说明 |
|----|------|------|
| companion / extension 单测 + CI 硬门 | ✅ | 持续保持 |
| 浏览器级 smoke e2e | 🔶 | 连 Companion → 消息 → 工具 → 确认 |
| coverage 报告 | 🔶 | 先观测后门槛 |
| CI Node vs 打包 Node | 🔶 | 对齐或文档明示 |
| god-file 拆分（server / sidepanel） | 🔶 | 可维护性；与本体正交 |
| WS 协议类型化 | 🔶 | 大；独立 worktree |
| 签名证书 / SBOM | 🔶 | 长杆 |

---

## 2. 推荐执行序（价值 × 风险 × 依赖）

1. **A 收尾**（本批文档/模板）→ 合并后所有 PR 走声明  
2. **B P1-1 → P1-2 → P1-3 → P1-4**  
3. **C** 有明确业务场景时 Pack-first 交付（与 B 可并行，但 **不得**用新一级 UI 绕过）  
4. **D** L2 真机 / HUD full 按用户痛点  
5. **E** 仅当有明确编排缺口且 dual-review 批准 defer 表内项  
6. **F** 插入发布前硬缺口（e2e / Node 对齐）

**方法论**：worktree → 实现 → 对抗 → `scripts/dual-external-review.sh` → CI 绿 → merge。危险 flag / 确认绑定 / shell 变更 **禁止 waive** 无用户明示。

---

## 3. 旧 plan 条目迁移表（节选）

| 旧 post-v0.3.0 | 迁移到 |
|----------------|--------|
| P0/P1 发布前止血 | 历史 ✅；不再排期 |
| P2-1 M1 tabUrlCache | ✅ 关闭 |
| P2-1 M2–M5 | B follow-up 或 defer |
| P2-2 可靠性 M6/M9/M10/M11 | ✅ 关闭（见旧 plan） |
| P2-3 M7/M8/M20 | ✅；healthz ✅ |
| P3 快速清理 L1/L3/L4/L5/L7/L9 | ✅；god-file/virtuoso/M21 → F |
| P4 better-sqlite3 / 协议 codegen / 预算 | 按需 F/P4 |
| 签名证书 | D 长杆 |

完整勾选历史仍以 [`optimization-plan-post-v0.3.0.md`](optimization-plan-post-v0.3.0.md) 变更日志为准。

---

## 4. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-07-29 | 初版：ADR-020 后统一 backlog；P1 四条盘点；PR template + dual-review 能力清单；supersede post-v0.3.0 排序权威 |

---

*Active source of truth for prioritization after ADR-020.*
