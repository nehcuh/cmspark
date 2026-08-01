# 交接：Qwen3-VL 实验层 — 后续按文档开工

**写给下一任实现者（人或 Agent）**

---

## 先读什么（15 分钟）

1. **[产品设计 SoT](../specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md)**  
   - 状态：`PASS_WITH_CHANGES`  
   - 决策锁：**§9**  
   - 必做清单：**§16.2 A1–A8**  
2. **[实施 plan](./2026-08-01-qwen3-vl-experimental-layer-impl.md)**  
   - P0 任务拆到文件级 + 验收命令  
3. **[用户说明](../../qwen-vl-experimental-layer.md)**（实现时一并改）

有争议时再翻：

- 三路外部：`docs/audit/reviews/qwen3-vl-product-design-triple-synthesis-20260801-145529.md`  
- 四路内部：`docs/audit/reviews/qwen3-vl-product-design-adversary-synthesis-20260801.md`  
- 代码双审：`docs/audit/reviews/qwen3-vl-replace-synthesis-20260801-143131.md`  

---

## 一句话任务

把 L2 实验定位从 TinyClick 换成 **Qwen3-VL**，在 **Companion 权威** 下完成：预检 → 大陆可下 → 硬件推荐 → 显式启用 → 每点 re-L2；并关掉假绿、错坐标、缺 Python 崩进程、TinyClick 残文案等问题。

---

## 禁止

- 扩展内推理 / 自动 `modelEnabled=true`  
- god-mode 跳过 experimental re-L2  
- 未完成 P0 就写「可内测」  
- 扩大范围：捆绑 venv、GGUF、一键 pip shell（属 P2/P3）  

---

## 建议第一刀

按 plan **P0-1（坐标）** 或 **P0-3（文案）** 开小 PR，再 **P0-2（canEnable）**，再许可门 / 打包 / 磁盘 / G1。

---

## 完成定义（P0）

- [ ] plan §2 全部 checkbox  
- [ ] `npm --prefix companion test` 与 extension 相关测试绿  
- [ ] SoT §14 基线表更新为「已实现」  
- [ ] 用户文档与 SoT 旅程一致  

---

*生成：2026-08-01 · 文档收束会话*
