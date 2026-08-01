# 三路外部复审综合：Qwen3-VL 产品设计 SoT

**时间戳**：20260801-145529  
**对象**：`docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md`（含 §9 锁 + §16）  
**通道**：Pi · Claude · Kimi（`pi -p` / `claude -p` / `kimi -p`）  
**Prompt**：`docs/audit/reviews/qwen3-vl-product-design-triple-review-prompt-20260801.md`

---

## 1. 裁决表

| 通道 | 裁决 | 置信度 |
|------|------|--------|
| **Pi** | **APPROVE_WITH_CHANGES** | 78% |
| **Claude** | **APPROVE_WITH_CHANGES** | 86% |
| **Kimi** | **APPROVE_WITH_CHANGES** | 82% |
| **综合（从严）** | **APPROVE_WITH_CHANGES** | — |

**六条拒绝门 R1–R6**：三路均认为 **设计层通过**（D1/D3/D8/门清单/不宣称可内测已写明）。  
**未通过「SoT 可直接当实施权威」**：文档 **自相矛盾**（§9 锁 vs 正文陈旧句、§10 分期 vs §16.2）。

---

## 2. 三路共识

### 2.1 设计方向正确

- Companion 权威、默关、re-L2、不自动启用  
- 大陆源 auto/魔搭/镜像策略诚实  
- §16 A1–A8 覆盖了前一轮四路对抗的 Blocking 并集  
- 代码 spot-check 与 §14「未完成」表一致（不装蒜）

### 2.2 必须在 SoT 内再改的矛盾（三路均点）

| 问题 | 说明 |
|------|------|
| **§10 vs §16.2 分期** | D1/budget 一处写 P1、一处写 P0「不可内测」 |
| **§4.2 S7 / §8.2 vs D9** | 仍写「手改 config 复位」 |
| **§5.4 vs D1** | 曾写「硬禁用=P1 决策」 |
| **D8 是或** | 删除 budget 或改 free-disk → 须选定一支 |
| **D11 是或** | 禁 G1 skip 或横幅 → 须选定一支 |
| **D7 vs 进度实现** | 锁 indeterminate，但代码/计划仍像假 0→100% |

### 2.3 实施层仍开放（设计承认，三路 spot-check 确认）

A1 坐标 · A2 canEnable · A3 TinyClick 文案 · A4 许可门 · A5 worker 打包 · A6 磁盘 · A8 G1  

---

## 3. 综合后已对 SoT 的即时修订（本会话）

已写回设计文档：

1. S7 CTA → 设置页重新考虑许可（D9）  
2. §5.4 → D1 硬禁用 P0；delete 清 modelEnabled  
3. **D8 选定**：废除 modelDiskBudgetMB 产品义 + free-disk≥变体+2GB  
4. **D11 选定**：一律禁止 G1 skip（不用横幅代替）  
5. §10 分期对齐 §16.2（权威以 §16.2 为准）  
6. §7.2 / §8.2 去掉「手改 config / 2048 谎言」表述  

---

## 4. 仍建议下一笔写进 SoT 的 nits（未全改）

- 许可门绑定 `downloadSourceResolved` 接受时刻快照  
- 评估能否 `trust_remote_code=false`（Kimi/Claude）  
- 大陆 **Python 本体** 获取指引（不仅 pip）  
- §11 70% 成功率 P1 可测日志枚举  
- S_PARTIAL 检测规则与权重就绪规则合一  
- P0 下载卡住的取消/清理出口  
- Qwen 许可 SPDX 勿想当然写 Apache-2.0（Claude：核实模型卡）  
- 推理延迟 soft SLO  

---

## 5. 产物路径

| 文件 |
|------|
| `docs/audit/reviews/qwen3-vl-product-design-pi-20260801-145529.md` |
| `docs/audit/reviews/qwen3-vl-product-design-claude-20260801-145529.md` |
| `docs/audit/reviews/qwen3-vl-product-design-kimi-20260801-145529.md` |
| 本综合 |
| 设计 SoT（已补丁） |

---

## 6. 结论

| 问题 | 答案 |
|------|------|
| 三路是否批准设计？ | **有条件批准（APPROVE_WITH_CHANGES）** — 无一 REJECT |
| 能否宣称「设计完成可内测」？ | **否** — 先消 SoT 自相矛盾（已改一轮）+ 代码 A1–A8 |
| 下一步 | 按 SoT §16.2 P0 实现；再跑一轮 Security 向代码复审 |

---

*VERDICT 综合：APPROVE_WITH_CHANGES*
