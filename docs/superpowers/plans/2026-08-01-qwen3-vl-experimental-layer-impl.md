# 实施计划：Qwen3-VL 实验定位层

> **状态**：Ready to implement（设计 SoT 经四路内部对抗 + Pi/Claude/Kimi 三路复审，综合 **APPROVE_WITH_CHANGES**）  
> **日期**：2026-08-01  
> **开工顺序**：严格按 **P0 → P1 → P2 → P3**；P0 未绿不得宣称可内测。

---

## 0. 文档索引（权威顺序）

| 优先级 | 文档 | 用途 |
|--------|------|------|
| **1 · SoT** | [产品设计方案](../specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md) | 需求/状态机/决策锁 §9 / 对抗修订 §16 |
| **2 · 本 plan** | 本文 | 任务拆分、验收、文件触点 |
| **3 · 用户** | [qwen-vl-experimental-layer.md](../../qwen-vl-experimental-layer.md) | 用户向说明（实现时同步改） |
| **4 · 入口** | [computer-use-user-guide.md](../../computer-use-user-guide.md) §6.1 | 用户索引 |
| **5 · 对抗归档** | 见下方「审查档案」 | 不挡开工，查争议时翻 |

**规范坐标**：ADR-017 Computer Use · ADR-020 能力三轴 · ADR-010 opt-in

**决策锁（摘录，全文见 SoT §9）**：

- **D1** 硬禁用 `!canEnable` + 服务端拒绝 `set_enabled(true)`  
- **D3** 坐标仅像素 JSON  
- **D8** 废除 `modelDiskBudgetMB` 产品义；可用磁盘 ≥ 变体+2GB  
- **D9** 许可 UI 可复位  
- **D11** `modelEnabled` 禁止 G1 initial-skip  

---

## 1. 当前代码基线（2026-08-01）

### 1.1 已有（可复用，勿重写）

| 模块 | 路径 |
|------|------|
| 目录/元数据 | `companion/src/computer/qwen-vl-catalog.ts` |
| 下载 HF/魔搭/镜像 | `companion/src/computer/qwen-vl-download.ts` |
| 预检 | `companion/src/computer/qwen-vl-preflight.ts` |
| 推理 runtime | `companion/src/computer/qwen-vl-runtime.ts` |
| session / locator | `qwen-vl-session.ts` / `qwen-vl-locator.ts` |
| Python worker | `companion/src/computer/qwen-vl-worker.py` |
| admission / handlers | `model-admission.ts` / `model-handlers.ts` |
| 链 / 执行 | `locate-chain.ts` (`layer: qwen-vl`) / `executor.ts` |
| 设置 UI | `SettingsSlideout.tsx` + `model-switch-logic.ts` |
| 单测（部分） | `computer-qwen-vl-locator.test.ts` / handlers / admission / locate-chain |

### 1.2 已知缺口（= 本 plan 任务）

见 SoT §14 + §16.2 **A1–A8**。

---

## 2. Sprint P0（必须先做）

> 验收口号：**假绿=0 · 错坐标不注入 · 文案不叫 TinyClick · 缺 Python 不崩 Companion · 可打包 worker**

### P0-1 · 坐标像素 only（A1 / D3）

**文件**：`qwen-vl-worker.py`；新增单测（Python 或 Node 对 normalize 抽函数）

- [ ] Prompt 只要求 `{"x":int,"y":int}` **图像像素**  
- [ ] 删除/收紧 `_normalize` 宽屏假 0–1000 分支：若 `0≤x<width` 且 `0≤y<height` → **绝不**按 1000 缩放  
- [ ] Golden：1920×1080 上 (200,50)、(640,360)、(1000,1000) 等矩阵  
- [ ] 超时/无坐标 → error，链继续  

**验收**：`node --test` 或 `pytest` 覆盖宽屏绝对像素；人工截一帧看 re-L2 点位置合理。

### P0-2 · canEnable 硬禁用（A2 / D1）

**文件**：`model-handlers.ts` `set_enabled`；`model-switch-logic.ts` / `SettingsSlideout.tsx`

- [ ] `set_enabled(true)` 服务端：`!canEnable`（或等价 probe）→ 结构化 error，**不写** `modelEnabled`  
- [ ] UI：开关 `disabled` 当 `canEnable===false`（许可拒绝仍走原 disabledReason）  
- [ ] `delete` 后：`modelEnabled=false` + dispose（防「已开启+absent」）  
- [ ] 单测：ready/deps 不全时 enable 被拒  

### P0-3 · 文案去 TinyClick（A3 / D6）

**文件**：`companion/src/computer/model-state-messages.ts`（及任何 `MODEL_SWITCH_COPY` 镜像）

- [ ] `switchLabel` / `model-file-missing` 等改为 Qwen3-VL  
- [ ] 与 extension `model-switch-logic.ts` 词表互锁（改一侧测另一侧或共享断言）  
- [ ] 用户可见字符串禁止 `TinyClick`（技术注释/legacy notices 除外并标注）  

### P0-4 · 许可门 §16.4（A4 / D10 / D9）

**文件**：`model-license.ts`（hash 会变 → 用户重过门）

- [ ] 条款含：SPDX/模型卡 LICENSE、**trust_remote_code ACE**、落盘路径、下载源族、体积/内存、未校准、re-L2、**设置页可复位拒绝**  
- [ ] 接受时门文案绑定 **当时** `downloadSourceResolved`（勿写死 HF）  
- [ ] `LICENSE_DOOR_TEXT_HASH` 自动变；旧 accept 失效 = 预期  
- [ ] `set_enabled` / 新消息：`computer.model.reset_license_decline` 或复用 license_response 清 declined（仅 settings）  

### P0-5 · worker 打包与 resolve（A5）

**文件**：`qwen-vl-runtime.ts`；`scripts/package.sh`；`scripts/build-windows-exe.ps1`；`package.json` build

- [ ] `exists` 遍历候选路径 + `process.execPath` 旁置  
- [ ] SEA/DMG/Windows 包 **必须** 含 `qwen-vl-worker.py`  
- [ ] 缺失 → `worker-spawn-failed` 友好文案，不崩进程  
- [ ] spawn `error` 监听保持（已有则回归）  

### P0-6 · 磁盘 D8（A6）

**文件**：`config.ts`；`qwen-vl-preflight.ts`；`qwen-vl-download.ts`；文案表

- [ ] 废除产品对 `modelDiskBudgetMB=2048` 的依赖（deprecate/忽略 Qwen 路径）  
- [ ] `canDownload=false` 当 `freeDiskGb < downloadGb+2`  
- [ ] 下载前再检一次；ENOSPC → `disk-full`  
- [ ] 删掉/改写「默认 2048MB」用户文案  

### P0-7 · 下载态 + 进度诚实（A7 / D7）

**文件**：handlers state；Settings UI；download 进度事件

- [ ] 状态：`downloading` / `partial`（半成品）在 state 或 modelStatus 可区分  
- [ ] **禁止** 假 0%→100%（MVP：转圈 / 「下载中」无精确百分比）  
- [ ] 半成品：清理 CTA（delete 当前变体目录）  

### P0-8 · modelEnabled × G1（A8 / D11）

**文件**：`server.ts`（或 session-trust / G1 判定处）

- [ ] `getConfig().computer.modelEnabled === true` → **禁止** G1 initial-skip  
- [ ] 单测：modelEnabled 时 initial skip 不生效  
- [ ] 注释写明：per-action `experimental` 不够，必须读配置  

### P0 完成门槛

```bash
# companion
npm --prefix companion test
# 至少覆盖：locator 宽屏坐标、handlers enable 拒绝、locate-chain qwen-vl、admission

# extension
npm --prefix chrome-extension test
```

- [ ] 手工：无 Python → Companion 存活、下载禁用、nextSteps 有命令  
- [ ] 手工：1920 截图 re-L2 点不离谱（像素路径）  
- [ ] 手工：!canEnable 无法开开关  

---

## 3. Sprint P1（可内测）

| ID | 任务 | 要点 |
|----|------|------|
| P1-1 | preflight 缓存 30–60s | 避免每次 get_state 15s+ |
| P1-2 | runtime 使用 preflight 的 pythonPath | 多 Python 环境 |
| P1-3 | 就绪 = config + **非空权重文件** | 与 S_PARTIAL 同一规则 |
| P1-4 | 换源一键重试 + 下载取消 | 大陆网络 |
| P1-5 | D9 许可 UI 复位落地 | 清 declined |
| P1-6 | THIRD_PARTY 补 Qwen；TinyClick 标 legacy | notices 与门一致 |
| P1-7 | handlers 互斥/set_enabled 矩阵测试恢复 | 防回归 |
| P1-8 | 用户文档 §1–2 按真旅程重写 | 连接 Companion→环境→源→下→依赖→手开 |
| P1-9 | §11 成功率：本地枚举日志 | 无外传 |

---

## 4. Sprint P2 / P3

见 SoT §10 P2/P3：真进度、一键 pip、哈希钉死、golden、捆绑 venv、增量更新。

---

## 5. 建议提交切片（atomic commits）

1. `fix(qwen-vl): pixel-only coords + tests`  
2. `fix(qwen-vl): hard-disable enable unless canEnable`  
3. `fix(qwen-vl): de-TinyClick companion copy`  
4. `fix(qwen-vl): license door + reset decline`  
5. `build(qwen-vl): package worker.py + resolve paths`  
6. `fix(qwen-vl): free-disk gate, drop budgetMB product meaning`  
7. `fix(qwen-vl): honest download state/progress`  
8. `fix(qwen-vl): block G1 skip when modelEnabled`  
9. `docs(qwen-vl): user guide rewrite`（可与 P1 合并）  

---

## 6. 审查档案（只读）

### 设计对抗

| 文档 |
|------|
| [四路内部对抗综合](../../audit/reviews/qwen3-vl-product-design-adversary-synthesis-20260801.md) |
| [三路外部复审综合](../../audit/reviews/qwen3-vl-product-design-triple-synthesis-20260801-145529.md) |
| [Pi](../../audit/reviews/qwen3-vl-product-design-pi-20260801-145529.md) · [Claude](../../audit/reviews/qwen3-vl-product-design-claude-20260801-145529.md) · [Kimi](../../audit/reviews/qwen3-vl-product-design-kimi-20260801-145529.md) |
| [三路 verdict JSON](../../audit/reviews/qwen3-vl-product-design-triple-verdict-20260801-145529.json) |

### 代码复审（实现基线）

| 文档 |
|------|
| [代码 dual Pi](../../audit/reviews/qwen3-vl-replace-pi-20260801-143131.md) |
| [代码 dual Claude](../../audit/reviews/qwen3-vl-replace-claude-20260801-143131.md) |
| [代码 dual 综合](../../audit/reviews/qwen3-vl-replace-synthesis-20260801-143131.md) |
| [diff patch](../../audit/reviews/qwen3-vl-replace-diff-20260801-143131.patch) |

---

## 7. 开工检查表（复制到会话开头）

```text
[ ] 已读 SoT §0–§11 + §9 + §16
[ ] 本 plan P0-1…P0-8 逐项勾选
[ ] 不扩大范围到捆绑 venv / GGUF（除非单独开 plan）
[ ] 每切片跑 companion + extension 相关测试
[ ] 用户可见文案无 TinyClick
[ ] 完成后更新 SoT §14「已实现」列 + 本 plan 勾选
```

---

## 8. 变更日志

| 日期 | 说明 |
|------|------|
| 2026-08-01 | 初版：从 SoT + 多轮对抗整理，供后续按文档开工 |
