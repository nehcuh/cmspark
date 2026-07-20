# WP5 G1 包线测定 — 命令包线常量与校准曲线（I1 WI-1.5）

> 日期：2026-07-20 ｜ 分支：computer-use-w8-windows ｜ 机器：i9-14900KF（8P+16E），64GB，Node v24.15.0，onnxruntime-node 1.27.0
> 数据：`scripts/spike/s3-golden/g1-cases.json`（19 case 定义）+ `g1-envelope-result.json`（hybrid 臂）+ `g1-envelope-result-int8.json`（int8 臂）
> **M2 纪律**：本档只导出包线常量与校准曲线，**不定准确率阈值**——阈值锚定 S-3 冻结基线数据（plan:416，P1-b）。

## 1. 测量对象与方法

- **case 集**：`g1_build_cases.py` 生成 19 case——长度扫描 12（btn_ok×8 + btn_play×4，fixture.png 同目标递增长度）+ 句式扫描 7（btn_ok，同目标变换句式）。prompt 配方与 golden_build.py 一致： `("What to do to execute the command? " + command).lower()`，HF tokenizer 预编码 input_ids 入库（JS 零分词误差）。
- **runner**：`g1-envelope-scan.js` = S-3 predict 管线逐行复刻（s3-run.js 冻结基线不动），唯一新增 = 解码每步对贪心选中 token 记录 softmax log p。命中规则同 S-3：`dist(pred, gt中心) ≤ max(w,h)/2`。
- **双臂**：hybrid（默认交付变体，vision fp32 + 三图 int8，705MB）与 int8（全量备选，432MB），intraOp=8 / interOp=1。S-3 冻结 golden 19 case 同场重跑作校准底座。
- **置信 proxy 定义**：`meanLogprob` = 全部生成 token（不含 EOS）平均 log p；`locLogprob` = 仅 `<loc_x><loc_y>` 两个坐标承载 token 的平均 log p（输出结构固定 5 gen token，locCount 恒 =2）。
- **logprob 修正记录**：初版误写 `bestV - log(Σexp)`（得正值，符号错）；修正为 `log p = -log(Σexp(v-bestV))`（数值稳定形）。两臂最终结果 JSON 均为修正后重跑产物。
- **输出命名**：脚本按变体分名输出（hybrid → `g1-envelope-result.json`，int8 → `g1-envelope-result-int8.json`），两臂互不覆盖；第三参数可指定临时输出路径。默认输出即 git 冻结文件——复跑产物须显式提交才更新冻结态（I1 对抗 M4 修复；此前 int8 臂靠人工改名，复跑曾覆盖/删除冻结文件）。

## 2. 包线三要素测定值（I3 常量输入）

约束三要素 = 英文 ∧ 短 ∧ 直接指称（plan:392 既定，本档供给测定值）：

1. **token 上限**：`prompt_tokens`（含固定前缀 ≈10）实测命中最大值 = **38**（len-31-ok，双变体 HIT 3.6/4.2px）；净命令 ≈28 token。>38 在英文包线内无命中证据。**I3 常量：`MAX_PROMPT_TOKENS = 38`**，超出层内拒绝（`tinyclick-envelope:too-long`）。注意：token 上限是必要条件非充分条件——zh case tok≤38 仍系统性 MISS。
2. **英文 = ASCII 可判定子集**：全部命中 en case 为纯 ASCII；zh（非 ASCII）系统性失效（S-3 冻结）。代码判定 = 非 ASCII 拒绝，无需语言检测器。
3. **直接指称 = 浅层语法判定**：句式扫描证明句式与命中**无单调关系**（pat-imperative2 "press the ok button"：int8 HIT 3.6px / hybrid MISS 809px；pat-please 双 MISS；pat-want/canyou/need 双 HIT）。故该约束定位为 **OOD 排除**（动词白名单 + 单句 + 单目标指称），**不是命中承诺**——包线内命中仍受目标显著性/歧义度支配（§4.1）。
4. （附）帧宽 ≤1920 约束来自 S-3（3840 桌面降 768² 后图标 ~14px OOD），非本扫描维度，I3 照 plan:450 直接代码化。

## 3. 扫描数据

### 3.1 长度扫描（btn_ok，同目标递增命令长度）

| id | tok | hybrid | int8 |
|---|---|---|---|
| len-04-ok | 12 | ✗ 809px（→btn_help）locLP -1.249 | ✓ 3.6px locLP -1.383 |
| len-06-ok | 15 | ✗ 809px（→btn_help）locLP -1.326 | ✓ 3.6px locLP -1.430 |
| len-10-ok | 19 | ✓ 4.2px locLP -0.548 | ✓ 4.2px locLP -0.717 |
| len-13-ok | 22 | ✓ 4.2px locLP -0.486 | ✓ 3.6px locLP -0.595 |
| len-17-ok | 26 | ✓ 4.2px locLP -0.807 | ✓ 4.2px locLP -0.912 |
| len-21-ok | 29 | ✓ 4.2px locLP -0.834 | ✓ 4.2px locLP -0.718 |
| len-26-ok | 33 | ✓ 4.2px locLP -0.980 | ✓ 4.2px locLP -0.977 |
| len-31-ok | 38 | ✓ 3.6px locLP -0.913 | ✓ 4.2px locLP -0.729 |

hybrid 6/8（最短两档 MISS）；int8 **8/8**。hybrid 分界在 tok 15→19 之间（len-10 起命令含 "at the bottom right" 位置限定）。

**btn_play 对照组（4 级长度）**：双变体 **0/4 全 MISS**——pred 稳定落 (481,171) = icon_square 位置（dist 149-151px），与 S-3 f-play-en 混淆模式复现一致。目标语义弱（"play"→蓝色方块图标），非变体问题、非长度问题（locLP -1.50~-2.45 随长度单调恶化）。

### 3.2 句式扫描（btn_ok）

| id | tok | 句式 | hybrid | int8 |
|---|---|---|---|---|
| pat-direct | 15 | 直接指称 | ✗ 809px | ✓ 3.6px |
| pat-please | 16 | 礼貌前缀 | ✗ 809px | ✗ 809px |
| pat-want | 18 | 意图句式 | ✓ 3.6px | ✓ 3.6px |
| pat-canyou | 17 | 疑问句式 | ✓ 3.6px | ✓ 3.6px |
| pat-need | 17 | 被动描述 | ✓ 3.6px | ✓ 3.6px |
| pat-loc-only | 18 | 纯位置指称（无文本锚点） | ✓ 4.2px | ✓ 3.6px |
| pat-imperative2 | 14 | 近义动词（press） | ✗ 809px | ✓ 3.6px |

hybrid 4/7，int8 6/7。**句式 ⇏ 命中单调关系**；pat-loc-only 双 HIT 说明纯位置指称在「右下只有唯一按钮」的夹具布局下可用——命中由布局歧义度而非句式决定。

### 3.3 golden 组（S-3 冻结集同场重跑，校准底座）

命中名单：hybrid 3/19（f-icon-en 3.2 / f-help-zh 3.2 / f-long-zh 18.2px）；int8 4/19（+f-ok-en 3.6px）。与 S-3 冻结值一致（int8 4/19=21.1%；fp32 3/19=15.8%；hybrid 命中名单同 fp32）。

**M2 锚定对齐（I3 集成验收注意）**：S-3 评审引用的「f-ok-en 3.6px」系 **int8 臂**的值；默认交付变体 hybrid 的对应锚 = **f-icon-en 3.2px** 与 len-10+ 组 **4.2px**。验收锚按变体取，不得跨臂引用。

## 4. 关键发现

1. **歧义风险 — L2 人审价值的直接实测证据**：夹具含两个同类按钮（btn_help 左下 (76,602) / btn_ok 右下 (884,602)）。无位置限定的短指称（"click ok" / "click on the ok button"）在 hybrid/fp32 稳定选中 btn_help（pred (75,600)，809px 系统性 MISS）；同目标加位置限定（"at the bottom right…"，tok≥19）双变体全部 HIT 同点 (881,599)。**短命令失效机理不是「太短」而是「歧义选错目标」**——实验层建议必须经 reL2 人审通道（plan WI-3.3）的定位由此获得实测支撑。
2. **变体行为差异 → B8 修订输入（待裁决，本档不改决策）**：int8 在歧义/短命令下显著更稳（长度组 8/8 vs 6/8、句式 6/7 vs 4/7、f-ok-en HIT vs MISS），代价是慢 ~59%（逐 case e2e 均值 int8 1142ms vs hybrid 675ms @8线程；ADDENDUM 同批中位 1173 vs 736ms）。机理未证实（hybrid 的 encoder/decoder int8 侧在文本歧义下退化？或全 int8 的量化平滑效应？）。如实登记为 B8 变体决策修订输入，variant-decision.md 不在本 WI 改动范围，留 owner/上游裁决。
3. **f-long-zh 例外**：locLP -2.642（hybrid）/ -2.372（int8）深低分区却 HIT——目标 lbl_long 宽 700px → 命中容差 350px。**任何基于 locLP 的硬过滤都会误杀此类大目标 case**；G3 校准设计须带目标尺寸维或维护例外名单。
4. **延迟与命中解耦**：逐 case e2e hybrid 652-717ms / int8 1111-1175ms（@8线程，与 ADDENDUM 中位一致），包线内（en/夹具）与 OOD（zh/桌面）间无显著延迟差——延迟不能用作拒绝/告警信号。

## 5. 校准曲线（locLogprob 分桶 vs 实测命中）

合并扫描+golden 全集，每臂 n=38（双变体合计 76；桶界与 g1-envelope-scan.js 一致；golden-only 分桶见两 result JSON 的 `calibration` 字段）：

| locLogprob 桶 | hybrid n | hybrid 命中 | int8 n | int8 命中 | 合并 |
|---|---|---|---|---|---|
| [-1, 0] | 7 | **7（100%）** | 11 | 9（81.8%） | 16/18（88.9%） |
| [-2, -1) | 18 | 5（27.8%） | 17 | 8（47.1%） | 13/35（37.1%） |
| [-4, -2) | 13 | 1（7.7%） | 10 | 1（10%） | 2/23（8.7%） |
| (-∞, -4) | 0 | — | 0 | — | — |

读法（不定阈值，M2）：

- **单调区分成立**：≥-1 区 88.9% vs [-2,-1) 37.1% vs <-2 8.7%——locLogprob 有区分度，可作 G3 校准候选 proxy。
- **无干净截断**：[-2,-1) 为混合区（f-help-zh -1.078 H、f-icon-en -1.206 H vs d-deskchrome-en -1.26 M）；<-2 有 f-long-zh 例外（§4.3）；int8 臂 [-1,0] 亦混入 2 个 MISS（f-setting-zh -0.966、d-deskchrome-en -0.997，均为 OOD 场景）。
- **样本不足**：n=76、单夹具+3 类真实场景、双臂混合——**不足定阈值**。I3 按 plan WI-3.1 执行：校准落地前 confidence 缺省 + 时间线标「未校准」。

## 6. 限制与边界

- 单夹具（960×640 合成 UI）+ S-3 冻结 19 case；未覆盖多窗口/真实应用内扫描（G6 网易云 OOD 为独立测量项，需 owner 人工采集，见 plan:419）。
- 每 case 单跑一次（贪心解码输出确定，重跑方差仅毫秒级延迟抖动）。
- proxy 未经温度缩放/熵交叉验证；meanLogprob 与 locLogprob 同序（目测），本档以 locLogprob 为主。
- btn_play 组 0/4 提示「包线内命令」≠「可命中目标」——目标显著性是包线未建模变量，I3 不得把包线通过当命中承诺（与 §2.3 呼应）。

## 7. 复现

```bash
cd scripts/spike/s3-golden
../s1-tinyclick-onnx/.venv/Scripts/python.exe g1_build_cases.py  # g1-cases.json（transformers 4.45.2 仅此 venv）
node g1-envelope-scan.js hybrid 8   # → g1-envelope-result.json
node g1-envelope-scan.js int8 8     # → g1-envelope-result-int8.json（按变体分名，互不覆盖）
```

依赖：`onnx-hybrid/`、`onnx-int8/`（gitignored 二进制，经 s1 ADDENDUM 复现节再生）；ORT 经 `../w1w2-worker-sea` 的 node_modules createRequire 复用。运行时零新依赖。

---
*WP5 I1 WI-1.5（backlog G1）— 包线常量：MAX_PROMPT_TOKENS=38 / ASCII 判定 / 直接指称=OOD 排除；校准曲线为 G3 候选，不定阈值（M2）。*
