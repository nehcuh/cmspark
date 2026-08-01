# 多路对抗综合：Qwen3-VL 实验层产品设计

**日期**：2026-08-01  
**设计 SoT**：`docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md`  
**方法**：四路并行独立对抗（Security · UX/大陆 · Architecture · Legal/供应链），综合从严。

---

## 1. 通道裁决

| 通道 | 裁决 | 一句话 |
|------|------|--------|
| Security / Trust | **FAIL** | D1/D3/remote-code/budget/session-trust 未锁；假绿与错坐标属安全 |
| UX / 中国网络 | **PASS_WITH_CHANGES** | 主骨架对；无 Python、下载中态、S7 复位、budget 默认会卡死大陆用户 |
| Architecture / Runtime | **PASS_WITH_CHANGES** | 权威边界对；worker 未进 SEA、坐标启发式、文案双源 |
| Legal / Supply-chain | **PASS_WITH_CHANGES** | 有门但缺 ACE/SPDX/Qwen notices；完整性叙事仍 TinyClick 形 |
| **综合** | **PASS_WITH_CHANGES** | 设计方向可立；**不得**在 A1–A8 关闭前宣称 P0/可内测 |

---

## 2. 共识（四路或三路同意）

### 做对了

1. Companion 权威、扩展不推理  
2. 默关 + re-L2 + experimental 不进 session-trust 静默（执行路径大体对齐）  
3. 大陆源策略方向（auto / 魔搭 / 镜像）正确  
4. 预检 + nextSteps 方向正确  
5. 非目标清晰（不替代 UIA/OCR、不自动开启）

### 必须补（并集 Blocking）

| 主题 | 安全 | UX | 架构 | 法务 |
|------|------|-----|------|------|
| 坐标像素 only | 🔴 | | 🔴 | |
| canEnable 硬禁用 | 🔴 | 🔴 | 🔴 | |
| 去 TinyClick 文案 | 🔴 | 🔴 | 🔴 | |
| trust_remote_code 明示 | 🔴 | | 🔴 | 🔴 |
| disk budget 谎言 | 🔴 | 🔴 | 🔴 | 🔴 |
| 下载中/半成品态 | | 🔴 | 🔴 | |
| worker 打包 SEA | | | 🔴 | |
| 许可路径/源/SPDX | | 🔴 | | 🔴 |
| S7 UI 复位 | | 🔴 | | |
| modelEnabled×G1 skip | 🔴 | | | |

---

## 3. 设计已吸收的修订

已写入 SoT §9 决策锁 + §16 修订清单：

- **D1=A**、**D3=A**、**D7=MVP indeterminate**  
- 新增 **D8 budget**、**D9 许可 UI 复位**、**D10 remote code**、**D11 session-trust**  
- 状态机补 **S_DOWNLOADING / S_PARTIAL / S_VERIFYING**  
- 许可门 **规范条款清单**  

---

## 4. 实现 backlog（从设计到代码）

### Sprint P0（合并门）

1. Fix `qwen-vl-worker.py` `_normalize` + tests  
2. Sync `model-state-messages.ts` Qwen copy  
3. `set_enabled` + UI hard-disable on `!canEnable`  
4. License door rewrite (hash bump)  
5. Package `qwen-vl-worker.py` + path resolve  
6. Budget: remove or free-disk gate  
7. G1 skip when modelEnabled  

### Sprint P1

结构化 nextSteps、python 路径、换源重试、权重文件就绪、notices、测试恢复、preflight 缓存  

---

## 5. 仍开放但已降级（不挡设计成立）

- 捆绑 venv（P3）  
- GGUF（P2 调研）  
- 一键 pip shell（P2）  
- 真字节进度（P1，诚实转圈可先）  

---

## 6. 最终结论

| 问题 | 答案 |
|------|------|
| 产品设计是否完整？ | **框架完整**；对抗后补洞已写入 §16 |
| 有无重大遗漏？ | **有**（见 §2 表）；现已全部编号进 SoT |
| 可否按设计直接全量推用户？ | **否** — 先关 P0/A1–A8 |
| 下一步 | 按 §16.2 改代码 + 用户文档 §1–2 重写 + Security 路复扫 |

---

*四路子代理输出已压缩入本文；原始长文在各 agent transcript，如需可从 session 导出。*
