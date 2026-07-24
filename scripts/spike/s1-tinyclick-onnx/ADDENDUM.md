# S-1 ADDENDUM — G5 混合量化补测 + T5 vendor 导出回归

> 日期：2026-07-20 ｜ 分支：computer-use-w8-windows ｜ 承接 REPORT.md（S-1）与 s3-golden/REPORT.md（S-3）

## G5：混合量化补测（vision fp32 + 三图 int8）

**动机**：S-3 对抗 C-3 指出——全 int8 把 DaViT vision conv 也量化了导致回退变慢 ~15%。混合配置：vision_encoder 保持 fp32，encoder/decoder int8；embed_tokens 为纯 Gather 图量化为 no-op（S-3 已证），沿用 fp32 拷贝。

变体目录 `scripts/spike/s3-golden/onnx-hybrid/`（gitignored）：vision_encoder 366.5MB(fp32) + embed_tokens 157.6MB(fp32) + encoder_model 43.7MB(int8) + decoder_model 137.1MB(int8)。

### 三变体同条件对照（fixture.png → 768²，intraOp=8/interOp=1，3 次中位，同批背靠背测）

| 变体 | 体积 | 加载后 RSS | session 创建 | e2e 延迟中位 | token 一致性（vs fp32 参考） |
|---|---|---|---|---|---|
| fp32 | 1243 MB | 1365 MB | ~2.8–3.9 s | **884.7 ms**（vision 650 / enc 85 / dec 122） | 参考基准（逐位一致） |
| 全 int8 | 432 MB | 570 MB | ~2.2 s | **1172.6 ms**（vision 1058 / enc 40 / dec 47） | 6/7（x bin 284 vs 282，2px 抖动） |
| **混合** | **705 MB** | **836 MB** | **~1.4–1.5 s** | **736.1 ms**（vision 619 / enc 44 / dec 46） | **7/7 逐位一致** |

逐次原始数据（同批）：fp32 [884.7, 889.2, 816.9]；int8 [1152.8, 1172.6, 1197.5]；hybrid [736.1, 764.3, 712.2]。

**测量条件诚实登记**：
1. W2 的 fp32 1821ms 是线程扫描期多 worker 顺序执行的热节流数据；本批安静环境下 fp32 实为 ~885ms —— 两组数据并列有效，结论以同批对照为准。
2. session 创建耗时受 OS 文件缓存影响（fp32 2.8s 为 S-3 暖缓存、3.9s 为 W2 较早冷态；混合/int8 文件小 3 倍故稳定更快），体积与 RSS 为稳健指标。
3. 混合变体同时消除全 int8 的 loc bin 抖动（vision fp32 保住图像特征精度）与 fp32 的体积/速度劣势。

### B8 交付变体三选建议

- **内存优先 → 全 int8**（432MB / RSS 570MB）：唯一满足 <600MB 硬约束的选项，代价是延迟最差（1.17s）与 1 bin 抖动。
- **速度优先 → 混合**（736ms）：且 token 7/7 逐位一致；在延迟与正确性两轴同时支配 fp32。
- **平衡 → 混合**：体积约为 fp32 的 57%、RSS 836MB（桌面 agent 可接受）、最快、零精度损失。**除非内存硬约束，混合为默认推荐。**

## T5：vendor Florence-2 三文件 + 导出回归

**动机**（W3 证据包）：trust_remote_code 运行时拉取 microsoft/Florence-2-base 代码 = 该 repo 未来变更即静默执行新代码的供应链风险。钉死到已审 revision。

### vendor 内容（`scripts/spike/s1-tinyclick-onnx/vendor/`，进 git）

| 文件 | sha256（钉死） | 来源 |
|---|---|---|
| configuration_florence2.py | `de2e45a975b3582de05d2f4d963a3e9f9a3d20dccf78d28e0052932a0be93bdf` | microsoft/Florence-2-base @ 5ca5edf5 |
| modeling_florence2.py | `5162bf465e61b6e29cc113a467630ec3cb56ed8e4d46eb6207157f10fb9b8a24` | 同上 |
| processing_florence2.py | `f146023a507c009f425a49ee39aa037f4f25c64e14336e3e4f3f1d7377a68e98` | 同上 |
| LICENSE | MIT（Microsoft Corporation，1141 B） | 同上 repo |

三文件哈希与 S-1 安全审查时**实际被执行字节**逐一相同（S-1 报告已证）；本次从 gitignored 的 code-review/ 复制并复核。

### 改法（export_onnx.py）

新增 `prepare_vendored_model()` 并在加载前调用：
1. 对 vendor/ 三文件做 sha256 断言（哈希漂移即 fail-fast）；
2. 复制三文件进 model/ 快照目录；
3. 改写 model/config.json 与 preprocessor_config.json 的 auto_map：`"microsoft/Florence-2-base--modeling_florence2.X"` → `"modeling_florence2.X"`（去 repo 前缀 → transformers 从本地 model 目录解析自定义代码，零远程拉取；幂等，重跑无害）。
4. 回归以 `TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1` 运行 —— 离线模式下导出全程成功，**直接证明导出链不再触网**。

### 导出回归结果（S1_OUT_DIR=onnx-vendored）

**字节级一致（理想结果达成）** —— vendored 代码重导 4 图与 S-1 原导出物 sha256 完全相同：

| 图 | sha256（orig = vendored） |
|---|---|
| vision_encoder.onnx | `af0962398dca078c537eb163842de2aec0726f3c9f9a4ff28003aabc2957558e` |
| embed_tokens.onnx | `b59e88b766dce012a8fae545ce17ca44202482b116891a8ff34ee041a85f6ce0` |
| encoder_model.onnx | `2127af828aa3ff3e20b2ff13d7666c8bf49f6f839a34321c98ba259a1d170834` |
| decoder_model.onnx | `012cdafe5d7cdce50af87be48778651a20564b5d6e8dd6dbd4b1381d3380ae9a` |

ORT token parity（s3-run.js vendored 臂）：`[2,0,23008,1437,50551,50797,2]` 与参考逐位一致（字节级一致下的必然结果，JS 侧复核确认）。

**结论**：导出链已消除「远程代码漂移」风险，且对产物零影响（bit-for-bit reproducible）。.gitignore 已更新：vendor/ 进 git，onnx-vendored/ 等产物不进。

## 复现

```bash
# G5
cd scripts/spike/s3-golden
mkdir onnx-hybrid && cp ../s1-tinyclick-onnx/onnx/vision_encoder.onnx onnx-hybrid/ \
  && cp onnx-int8/{embed_tokens,encoder_model,decoder_model}.onnx onnx-hybrid/
node s3-run.js hybrid parity 8 && node s3-run.js hybrid latency 8
# T5
cd scripts/spike/s1-tinyclick-onnx
TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1 S1_OUT_DIR=onnx-vendored .venv/Scripts/python.exe export_onnx.py
```
