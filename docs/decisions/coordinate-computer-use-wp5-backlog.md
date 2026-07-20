# WP5 开工总任务单（backlog）— 门禁收口后的执行清单

> **日期**: 2026-07-20 ｜ **分支**: computer-use-w8-windows
> **地位**: WP5 唯一开工清单。汇总三轮门禁 spike（S-1/S-2/S-3）、两轮前置探针（W1/W2）、一份证据包（W3）、三份评审与三份对抗审计的全部结论，去重并按依赖排序
> **裁决链**: S-1/S-2 PASS（评审 VALID WITH CAVEATS → 对抗 SOUND WITH MANDATORY FOLLOW-UPS）｜ S-3 FAIL → O-2 实验层（评审 VALID → 对抗 SOUND WITH CAVEATS）｜ W1 PASS ｜ W2 PASS（有条件）｜ W3 已文档化

---

## 1. 门禁状态表

| 门禁 | 裁决 | 关键数字 | 证据文档 |
|---|---|---|---|
| S-1 TinyClick→ONNX 导出 | **PASS** | 4 图 fp32 1.24GB；ORT 与 PyTorch token 7/7 逐位一致、坐标 Δ0px；权重 sha256 `d52f9370…00a3` | `scripts/spike/s1-tinyclick-onnx/REPORT.md`；评审 `coordinate-computer-use-wp5-spike-review.md`；对抗 `coordinate-computer-use-wp5-spike-adversary.md` |
| S-2 ORT-node×SEA 加载 | **PASS** | SEA 下裸 require 必败、`Module.createRequire(process.execPath)` 成立；dummy 推理正确；win-x64 负载 4 dll+.node ≈62MB | `scripts/spike/s2-onnxruntime-sea/REPORT.md`；评审/对抗同上 |
| S-3 中文 golden + 4 核延迟 | **FAIL → plan O-2 实验层** | zh 13.3%（含巧合，真实 ≈1/15）；真实桌面/设置 0/9（Wilson 上界 29.9%<55% 预注册线）；4 核 fp32 2840ms / int8 3272ms 双超 plan:126 预算 | `scripts/spike/s3-golden/REPORT.md`；评审 `coordinate-computer-use-wp5-s3-review.md`；对抗 `coordinate-computer-use-wp5-s3-adversary.md`（G1-G6 强制规格） |
| W1 worker×SEA | **PASS** | worker 内 createRequire 加载 ORT 推理成立；JS 级故障/损坏模型可隔离；worker 源码须 eval 内联或 sea asset | `scripts/spike/w1w2-worker-sea/REPORT.md` §W1 |
| W2 JS 线束真实负载 | **PASS（有条件）** | 默认线程配置 5428ms **病态超 5s**；调优 intraOp=P核数(8)/interOp=1 → 1821ms；session 创建 3.9s 一次性；fp32 RSS ~1.9GB | `scripts/spike/w1w2-worker-sea/REPORT.md` §W2 |
| W3 模型来源与许可证 | **已文档化** | 源链 Krystianz/TinyClick@`0e1356f0` + sha256 钉死；完整性≠来源已声明；MIT 四方一致 + notice 义务 | `coordinate-computer-use-wp5-model-provenance.md` |

**门禁结论**：S-1/S-2/W1/W2/W3 全通，S-3 FAIL 已由 plan:401 (O-2) 预注册路径消化（实验层 + 默认兜底改 OCR/用户框选）。WP5 开工无未决门禁。

---

## 2. 开工前置项（第一迭代，未落地不进集成编码）

| # | 事项 | 来源 | 验收标准 | 量级 |
|---|---|---|---|---|
| **G1** | 实验层约束改写为「英文 **且** 短命令（≤20 token 量级）**且** 直接指称句式」；完成命令长度/句式扫描 + **中文可靠性/校准曲线**（评审 NIT-4、首轮对抗 B3 债务合并于此清偿），工作包线以测定值写入设计文档 | S-3 对抗 C-1/§4 | 包线扫描数据 + 校准曲线入库；约束三要素进设计文档 | M |
| **G2** | 包线约束**代码化**：非英文 / 超 token 上限 / 输入宽 >1920 → 层内拒绝并返回结构化原因；禁止文档级约束 | S-3 对抗 C-1/C-4 | 三类越界输入各有拒绝测试 | S |
| **G3** | 无校准置信度前 TinyClick 层 confidence 不上时间线（抑制或标「未校准」）；实验层开关文案披露实测数字（zh 13.3% 含巧合 / 真实桌面 0/5 / 延迟 2.8-3.3s）；措辞遵守 plan:322/374 中性徽标纪律 | S-3 对抗 C-4 | 文案评审通过；时间线无未校准数字上屏 | S |
| **G4** | 实验层输出**永不自动进入 locateAttempts 接受链**，必经 L2 且 caption 标注「实验层建议，可能完全错误」；显著点坍缩检测（同图多命令同点）触发时抑制建议 | S-3 对抗 C-4 | 降级链排序测试 + 坍缩检测单测 | M |
| **G5** | 「vision fp32 + enc/dec int8」混合量化补测后再定交付变体；plan:118（250-350MB 估计 vs 实测 432MB）/plan:126（int8 提速隐含假设被反转）假设记录更新 | S-3 对抗 C-3/C-6 | 混合变体 e2e/体积/RSS 数据入库；plan 假设修订 | S |
| **G6** | 网易云自绘页 OOD 补测（评审 NIT-1：托盘态走「用户手动打开后录屏人工采集」，与 plan:246 惯例一致）；新 case 采用「命令语义与目标布局一致」设计 | S-3 对抗 C-5 + 评审 NIT-1 | 补测 case 入库并跑出数据 | S |
| **T5** | dev 端 vendor Florence-2 三文件 @`5ca5edf5`（sha256 钉死：`de2e45a9…`/`5162bf46…`/`f146023a…`），改本地 auto_map；**vendor 后重跑 S-1 导出回归**，确认四图哈希不变（`af096239…`/`b59e88b7…`/`2127af82…`/`012cdafe…`），变则重新审查登记 | spike 评审 T5 + spike 对抗 A2 + W3 证据包 §6 | 三文件入库 + 导出回归哈希一致 | S |

> NIT 映射（不重复计数）：评审 NIT-1 → G6；NIT-4 → G1；NIT-2（bin 0/999 边界 case）→ B5 的 golden 集扩充；NIT-3（4 核硬件保真声明）→ B4 的延迟记录；spike 对抗 A3 的 golden 边界坐标 case → 同 B5。

## 3. WP5 任务单（按依赖排序）

| # | 事项 | 依赖 | 来源 | 验收标准 | 量级 |
|---|---|---|---|---|---|
| **B1** | **下载门禁 + models.manifest.json**（T7+A6 合并）：W3 六条执行要求落地——manifest 三要素 {源 URL, revision `0e1356f0…`, 每文件 sha256+size, license:"MIT"}；manifest 永不运行时网络更新（镜像只配置文件源，哈希不可配置）；**校验即加载**（读入内存→streaming sha256→同一 buffer 建 session，无 TOCTOU）；每次加载前复验；license 门文案双引（论文 Ethics + 原始 LICENSE）+ 研究品免责 +「点击前必经 L2」；THIRD_PARTY_NOTICES 收 MIT 全文 + `Copyright (c) 2024 Samsung R&D Poland` + Florence-2 底座 notice | 前置项全部 | W3 证据包 §5；plan:115-116；首轮对抗:62 | 篡改模型→加载拒绝（负测试）；manifest 网络更新注入→拒绝；notice 文本入包 | M |
| **B2** | **ORT worker 集成主干**：推理全部走 worker_threads（plan §C.1）；worker 源码 esbuild 内联（`eval:true`，SEA 无文件路径 worker）；加载一律 `Module.createRequire(process.execPath)`（禁裸 require，防 cwd 污染）；单飞 + 5s 超时取消；JS 级故障经 error 事件隔离（W1 已证）；**native 内存破坏级 fault 不在 worker 防线内**（W1:36 边界，独立进程退路保留） | B1 | W1 报告 §W1/关键发现 1-4；plan §C.1 | worker 崩溃主进程存活测试；超时取消测试；SEA 打包产物上推理正确 | L |
| **B3** | **线程拓扑探测（W2 硬要求，非优化项）**：session 配置 `{ intraOpNumThreads: <物理P核数>, interOpNumThreads: 1 }`；启动时探测 CPU 拓扑，失败回退保守值 4；**禁止默认值**（混合架构下 5.4s vs 1.8s，差 3 倍） | B2 | W2 报告 §W2/影响 2 | 默认配置对照测试证明调优生效；无拓扑信息机上回退 4 且行为正确 | S |
| **B4** | **懒加载启动预算**：agent 启动时懒加载 4 图，session 创建不计入点击延迟；预算 fp32 ≤3.9s / int8 ≤2.2s（实测值）；延迟记录附硬件保真声明（i9 P 核 vs 真实低压 U 偏差方向，评审 NIT-3） | B2/B3 | W2 报告 §Session 创建；S-3 报告 §1；评审 NIT-3 | 冷启动创建耗时可观测（日志/指标）；预算超标告警 | S |
| **B5** | **JS 生产化三件套（T3）**：预处理（raw RGBA 直吃，免 PNG 解码；保留双线性 vs bicubic 数值抽检机制）；**tokenizer 立项**（@huggingface/transformers Tokenizer 组件或移植 BPE，替代 spike 的 Python 预编码；tokenizer.json 2.3MB 随模型分发）；贪心解码循环（~7 步全前缀重算）；golden 集扩充：loc bin 0/999 边界、四角、<16px 小目标、>20 词命令（spike 对抗 A3 + 评审 NIT-2） | B2 | S-1 报告 §3/S-3 报告 §5；spike 对抗 A3；评审 NIT-2 | golden 集离线回放 CI 可跑（plan:246 ±8px）；tokenizer 与 HF 参考逐 token 一致 | L |
| **B6** | **哈希校验扩展（T4）**：`verify-systray2.js` 模式扩展 `onnxruntime-sha256.json`——旁置 dll + 模型文件加载前复验；与 B1 manifest 共用同一哈希登记源 | B1/B2 | 评审 T4；plan §C.1 依据④ | 改 1 字节 dll/模型 → 加载拒绝测试 | M |
| **B7** | **架构裁剪（T1）**：旁置 node_modules 按架构白名单（`bin/napi-v6/win32/x64/` 4 dll + .node），259MB → ~62MB | B2 | S-2 报告 实测发现 4 | 打包产物体积断言 + SEA exe 上推理正确 | S |
| **B8** | **int8 交付变体决策（T2 演化版）**：以 G5 混合量化补测数据做三选——fp32（快/1.4GB/1.9GB RSS）、int8（569MB RSS 但慢 15%）、混合（待测）；决策记录含体积/延迟/RSS 三轴；量化变体过 token 级回归（S-3 已证 7 token 中 6 位一致、无语义改变） | G5/B7 | S-3 报告 §1/§4；S-3 对抗 C-3 | 决策记录入库；选定变体过 golden 回归 | M |
| **B9** | **实验层开关与 UI 文案**：G2/G3 的实现落点——开关默认关、文案披露实测数字、confidence 抑制或标「未校准」、L2 caption「实验层建议，可能完全错误」；遵循 plan:322 中性徽标纪律与 WP4 徽标教训 | G1-G4/B5 | S-3 对抗 §4 G2-G4 | 文案评审 + 开关状态机测试（无乐观更新） | M |
| **B10** | **with-past/merged decoder（T6，条件触发）**：仅当 B3/B8 后 decoder 仍为瓶颈时启用（optimum ModelPatcher 或 past 长度显式 tensor 化重导）；TinyClick 短输出下预期非必需 | B8 | S-1 报告 §5；评审 T6 | 触发条件评估记录；启用则过 token 级回归 | M |

## 4. 明确不做（本轮 WP5 范围外）

| 项 | 处置 | 依据 |
|---|---|---|
| 中文 GUI 命令默认兜底定位层 | **不做**。默认兜底 = OCR 承接文本锚点 + 低置信度要求用户框选；TinyClick 仅以 §2 规格下的可选实验层存在 | plan:401 (O-2)；S-3 FAIL |
| 多语 GUI 模型评估（Qwen2.5-VL / UI-TARS 类） | **登记为后续评估项**，不在 WP5；中文定位缺口由上一行兜底覆盖 | S-3 报告 §5.3 |
| 实验层默认开启 / 未校准置信度上屏 | **禁止**（G3/G4 纪律） | S-3 对抗 C-4 |
| worker_threads 作为 native 内存破坏级 fault 防线 | **不依赖**。可预期故障面 worker 已证可隔离；内存破坏级需独立进程（plan 既有退路，不在本轮建设） | W1 报告 :36 |

---

*WP5 backlog v1.0 — 前置 7 项（G1-G6 + T5）｜ 任务单 10 项（B1-B10）｜ 明确不做 4 项*