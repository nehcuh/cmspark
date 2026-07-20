# S-3 门禁裁决报告 — TinyClick int8 中文桌面点定位准确率与 4 核延迟

> **门禁裁决：FAIL（作为 WP5 默认兜底定位层）→ 建议按 plan O-2 落入实验层**
> 证据充分（非 PARTIAL）：中文命令点定位 fp32/int8 双臂均系统性失效（zh 命中率 13.3%，且命中含显著点巧合）；英文命令在干净夹具上达 1-4px 精度。量化本身无准确率损伤。
> 日期：2026-07-20 ｜ 分支：computer-use-w8-windows ｜ 机器：i9-14900KF（8P+16E），64GB，Node v24.15.0，onnxruntime-node 1.27.0

## 1. int8 量化与一致性

方案：`onnxruntime.quantization.quantize_dynamic(weight_type=QInt8)` 动态 weight-only 量化（`quantize_int8.py`）。embed_tokens 为纯 Gather 图保持 fp32。

| 指标 | fp32 | int8 | 变化 |
|---|---|---|---|
| 体积（4 图合计） | 1243 MB | **432 MB** | **-65%**（<0.7GB 目标达成） |
| session 创建（合计） | 3899 ms | 2163-2252 ms | -43% |
| 加载后 RSS | 1381 MB | **569-572 MB** | -59% |
| 首推理后 RSS | 1875 MB | 1192 MB | -36% |

**token 一致性（S-1 参考图，官方英文命令）**：int8 `[2,0,23008,1437,50553,50797,2]` vs fp32 `[2,0,23008,1437,50551,50797,2]` —— 7 token 中 6 位逐位一致；唯一差为 x 向 loc bin 284 vs 282（560px 图上 2px 偏差），无语义改变。**量化不损伤输出语义**（1 bin 量化抖动）。

**推理速度注意**：int8 的 transformer MatMul 变快（encoder 158→91ms、decoder 393→253ms @8线程），但 DaViT vision 明显变慢（1247→1945ms @8线程；4 核下 2193→2912ms）—— 动态 weight-only 量化对 conv 密集型图在本 ORT 版本是反优化。端到端 int8 比 fp32 **更慢**（见 §4）。

## 2. Golden 集（19 case：夹具 10 / 真实桌面 5 / 设置窗口 4；zh 15 + en 4）

构建：`golden_build.py` 用 HF tokenizer 预编码命令（input_ids 入库，JS 零分词误差）；夹具 `s3-fixture-render.ps1` 自绘 960×640 中文 UI（四角按钮+中心播放+搜索框+蓝色图标+长文本，gt 由绘制坐标精确生成）；桌面为 3840×2160 物理屏只读截屏（CopyFromScreen）降至 1920×1080；设置窗口经 computer-capture.ps1 PrintWindow 只读捕获。命中规则：`dist(pred,gt中心) ≤ max(w,h)/2`。图片与 `golden.json` 已入库（jpg 均 <500KB）。

**网易云分组：跳过（已注明）**——cloudmusic.exe 进程存在但 MainWindowHandle=0（托盘态无窗口）；纪律禁止激活/操作其窗口，故无截图。Explorer 窗口未能捕获（PrintWindow 黑图且其窗口疑似在另一虚拟桌面，BitBlt 回退会切前台，放弃并记录）。设置窗口同为跨虚拟桌面场景，PrintWindow 只读捕获成功。

## 3. 分组准确率（int8 vs fp32 对照）

| 分组 | int8 | fp32 | 说明 |
|---|---|---|---|
| **ALL** | 21.1% (4/19) | 15.8% (3/19) | 差异为 OOD 输入上的 argmax 掷币 |
| **zh（15）** | **13.3%** | **13.3%** | 两臂一致 → 与量化无关 |
| en（4） | 50% | 25% | 样本小，夹具上 int8 反而 2 中 |
| 夹具（10） | 40% | 30% | 英文 case 精度 1-4px 级 |
| 真实桌面（5） | **0%** | **0%** | 高分辨率降到 768² 后图标 ~14px，OOD |
| 设置窗口（4） | **0%** | **0%** | 中文命令失效为主因 |

关键证据明细（完整数据见 `s3-golden-result-{int8,fp32}.json`）：

- **英文命令在干净夹具上精确**：f-ok-en 预测 (881,600) vs gt (884,602) **偏差 3.6px 命中**；f-icon-en 偏差 **1px 命中**。
- **中文命令系统性失效**：f-ok-zh/f-file-zh/f-setting-zh 全部退化到同一个显著点 (75,599)（左下按钮）——f-help-zh 的"命中"只是 gt 恰好也在左下（显著点巧合），fp32 复现同一模式。**模型不理解中文命令语义**（训练集 ScreenSpot 为英文）。
- 中文长命令 f-long-zh 命中（int8 46px / fp32 18px）——长文本目标区域大（700px 宽），命中规则宽松所致，不改整体结论。
- f-play-en 两臂均误中蓝色图标（(481,171)，距播放按钮 ~150px）——OOD 下的语义混淆个例。

## 4. 4 核延迟（intraOp=4 / interOp=1，768² 单帧，3 次中位）

| 配置 | total 中位 | vision | encoder | decoder | preprocess |
|---|---|---|---|---|---|
| fp32 @4线程（W2 数据） | 2840 ms | 2193 | 285 | 333 | 26 |
| **int8 @4线程（本测）** | **3272 ms** | **2912** | 170 | 150 | 35 |

逐次：3286 / 3272 / 3231 ms（稳定）。对照 8 线程调优：fp32 1821ms、int8 2317ms。int8 因 vision conv 回退在延迟上全面劣于 fp32；其收益在体积/内存/加载（§1）。进程亲和性未额外施加（intraOp=4 已限线程池；W2 已证线程数是主变量）。

## 5. 结论与建议

1. **默认兜底层定位：不成立**。中文 GUI 命令点定位在 TinyClick（fp32 与 int8 同）上实质不可用（13.3%，含巧合命中）；真实桌面/设置窗口组 0%。建议 WP5 按 plan O-2 将其定位为**实验层**，默认路径不得依赖。
2. **量化裁决：int8 可用且推荐作为交付变体**（-65% 体积、-59% 加载 RSS、token 级语义保持），但**不得以延迟为目的选 int8**——conv 回退使其比 fp32 慢 ~15%（4 核 3.27s vs 2.84s）。WP5 二选一：要内存选 int8（569MB），要速度选 fp32（1.4GB）。
3. **若未来启用实验层**：约束命令为英文（夹具精度 1-4px）、输入分辨率 ≤1920 宽；中文命令需要换多语 GUI 模型（Qwen2.5-VL/UI-TARS 类）——超出本 spike 范围，登记为后续评估项。
4. **延迟预算（4 核）**：fp32 2.8s / int8 3.3s，均在 5s 超时内；8 线程调优（W2 结论）可再降 35-40%。
5. **生产 tokenizer 缺口**：本 spike 用 Python 预编码命令；JS 侧生产方案需在 WP5 立项（@huggingface/transformers Tokenizer 或移植 BPE），不阻塞门禁。

## 复现

```bash
cd scripts/spike/s3-golden
../s1-tinyclick-onnx/.venv/Scripts/python.exe quantize_int8.py   # 4 图量化 -> onnx-int8/
../s1-tinyclick-onnx/.venv/Scripts/python.exe golden_build.py    # golden.json（tokenizer 预编码）
powershell -File s3-fixture-render.ps1                           # 夹具渲染（如需重生成）
node s3-run.js int8 parity 8      # 一致性
node s3-run.js int8 golden 8      # int8 golden -> s3-golden-result-int8.json
node s3-run.js fp32 golden 8      # fp32 对照 -> s3-golden-result-fp32.json
node s3-run.js int8 latency 4     # 4 核延迟
```

依赖：S-1 的 `model/` 与 `onnx/`、W2 的 `node_modules`（ORT 经 createRequire 复用）。二进制（onnx-int8/、PNG）已 gitignore。
