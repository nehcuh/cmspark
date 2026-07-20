# W1 + W2 前置探针报告 — worker×SEA×createRequire 与 JS 线束真实负载

> **W1：PASS** ｜ **W2：PASS（有条件）** — 默认 ORT 线程配置 ~5.4s 超 5s 预算；调优后 ~1.8s
> 日期：2026-07-20 ｜ 分支：computer-use-w8-windows ｜ 机器：i9-14900KF（8P+16E，32 逻辑核），64GB RAM，Node v24.15.0，onnxruntime-node 1.27.0

---

## W1：worker_threads × SEA × createRequire（评审 C-1）

### 验证矩阵与实测输出

脚本 `w1-index.js`（worker 源码以 `eval:true` 内联 —— SEA 无 fs 访问打包文件，worker 只能 eval 内联源码或 sea asset），dev 与 SEA 双模式跑 3 项测试：

```
# SEA 模式，中性 cwd（C:\Users\HuChen\AppData\Local\Temp），W1_SEA_NEUTRAL_CWD_EXIT=0
[w1] node: v24.15.0 isSea: true execPath: C:\...\dist-app\w1-sea.exe
[w1] (a) ort-loaded: {"event":"ort-loaded","how":"createRequire(execPath)","version":"1.27.0"}
[w1] (a) inference y: [2,3,4] exitCode: 0
[w1] (b) worker error event: deliberate JS exception in worker exitCode: 1
[w1] (c) worker-caught: Load model from C:\...\dist-app\corrupt.onnx failed:Protobuf parsing failed. | exitCode: 0
[w1] main process ALIVE after all worker tests
[w1] RESULT: PASS {"a":true,"b":true,"c":true}
```

| 测试 | 结论 | 证据 |
|---|---|---|
| (a) worker 内 createRequire(execPath) 加载 ORT + 原生绑定推理 | ✅ | `how=createRequire(execPath)`，y=[2,3,4]，worker exit 0 |
| (b) worker 未捕获 JS 异常 | ✅ 隔离 | 主进程收到 `error` 事件，worker exit 1，主进程继续完成 (c) |
| (c) 损坏模型文件 | ✅ 可捕获 | ORT 抛 JS 级异常（`Protobuf parsing failed`），非原生崩溃，主进程存活 |

### 关键发现（对 WP5 有约束力）

1. **SEA worker 内裸 require 解析走 cwd 树**：从 spike 目录（含 node_modules）运行时 worker 裸 require 竟成功（`how=bare-require`），是 cwd 污染；**中性 cwd 下裸 require 失败，createRequire(execPath) 兜底生效**。WP5 推理 worker 必须显式 `Module.createRequire(process.execPath)`，不能依赖 cwd。
2. **SEA 下 worker 只能 `eval:true` 内联源码**（或 sea asset），无文件路径 worker。WP5 需在打包时把 worker 源码内联/注入。
3. **`process.abort()` 在 worker 内被 Node 拦截**为 JS 错误（"process.abort() is not supported in workers"），主进程存活（`w1b-abort.js` mode 1 实测）。`--abort-on-uncaught-exception` 在 worker 内设置同样不致死主进程（mode 2 实测，异常仍走 error 事件）。
4. **边界**：worker_threads 共享同一 OS 进程地址空间 —— onnxruntime.dll 内存破坏级原生 fault（segfault 类）仍会带走主进程。本探针未能也无意在 worker 内安全制造真实 segfault；JS 层与 ORT 加载层故障（模型损坏/解析失败/异常）均已证实可隔离。plan §C.1 的 worker 架构对**可预期故障面**成立；对内存破坏级 fault，worker 不构成防线（需独立进程，属 plan 已留退路）。

**W1 裁决：PASS** —— worker 内加载原生绑定、推理、JS 级崩溃隔离全部实测成立。

---

## W2：JS 线束真实负载延迟 + 内存（评审 C-2）

真实 S-1 导出物（4 图 fp32 共 1.24GB），worker 内跑全管线。双臂设计：correctness 臂用 Python 侧精确 `.npy` 输入隔离预处理保真度；latency 臂全 JS 管线（pngjs 解码 + 纯 JS 双线性 resize + ImageNet 归一化，选型理由：WP5 生产路径是 raw RGBA 帧，无原生依赖的 buffer 处理最贴近；PNG 解码仅 spike 便利）。

### 正确性（两臂均验）

token ids `[2,0,23008,1437,50551,50797,2]` 与 S-1 PyTorch 参考**逐位一致**（精确输入臂与纯 JS 预处理臂均 match）→ JS 线束数值正确、纯 JS 双线性预处理保真度足够。

### Session 创建（一次性）与 RSS

| 阶段 | 耗时 | RSS 增量（累计） |
|---|---|---|
| baseline | — | 81 MB |
| vision_encoder.onnx | 1896 ms | → 495 MB |
| embed_tokens.onnx | 240 ms | → 655 MB |
| encoder_model.onnx | 552 ms | → 830 MB |
| decoder_model.onnx | 1211 ms | → **1381 MB** |
| 首次推理后（arena） | — | → **1875 MB** |
| **创建合计** | **~3.9 s** | 权重常驻 ~1.3 GB + arena ~0.5 GB |

### 端到端延迟（768² 单帧，7 token 输出，3 次中位数）

**默认 session 配置（intraOp=0 即 24 物理核全开）——病态：**

| run | total | preprocess | vision | encoder | decoder(6步) |
|---|---|---|---|---|---|
| 0 | 4399 ms | 39 | 2170 | 853 | 1335（步均 222ms） |
| 1 | 5444 ms | 114 | 3142 | 852 | 1333 |
| 2 | 5428 ms | 140 | 3091 | 847 | 1349 |
| **中位** | **5428 ms** | | | | |

注意 run1/2 比 run0 更慢 —— 混合架构 E-core 调度 + 线程同步开销在持续负载下恶化。

**线程调优扫描（interOp=1）：**

| intraOp | median total | vision | encoder | decoder | 逐次 |
|---|---|---|---|---|---|
| 16 | 2655 ms | 1356 | 503 | 795 | 2132 / 2801 / 2655 |
| **8（=P 核数）** | **1821 ms** | **1247** | **158** | **393（步均 65ms）** | 1859 / 1821 / 1788 |
| 4 | 2840 ms | 2193 | 285 | 333 | 2883 / 2840 / 2789 |

intra=8 时逐次抖动 <4%，最稳定。纯 JS 预处理拆解：decode 11-35ms + resize 18-74ms + normalize 10-41ms（生产 raw RGBA 免解码）。

### W2 裁决：PASS（有条件）

- 「~7 token 自回归代价可忽略」：**调优后成立** —— decoder 全前缀重算 6 步仅 393ms（占 e2e 22%），S-1 报告的判断被实测证实。
- 「~1s 级」假设：**fp32 下不成立**，调优后 1.82s；瓶颈在 vision encoder（DaViT 768²，占 68%）。要进 1s 级需 int8 量化（14900KF 有 AVX-VNNI）或 DirectML/GPU EP。
- 5s 超时设计：**默认线程配置下高端 CPU 也会超时（5.4s）**，必须调优 `intraOpNumThreads=P 核数, interOpNumThreads=1`；调优后 1.8s 有充足余量。
- 内存预算：fp32 常驻 ~1.9 GB RSS（含 arena）——低端机需 int8。

---

## 对 WP5 开工的影响

1. **架构（C-1 收口）**：推理放 worker_threads 可行 —— 原生绑定 worker 内加载、JS 级故障隔离均实测 PASS；worker 源码需内联（eval:true）或 sea asset；加载必须 `createRequire(process.execPath)`。内存破坏级 native fault 仍需独立进程兜底（plan 退路保留）。
2. **ORT session 配置是硬要求**（非优化项）：`{ intraOpNumThreads: <物理P核数，典型 4-8>, interOpNumThreads: 1 }`。默认值在混合架构 CPU 上主动有害（5.4s vs 1.8s，差 3 倍）。WP5 启动时需探测 CPU 拓扑或用保守值 4。
3. **启动预算**：session 创建 ~3.9s 一次性 —— agent 启动时懒加载，不计入点击延迟。
4. **延迟预算**：fp32 调优后 e2e ~1.8s（i9 级 CPU）；5s 超时合理但需以调优为前提；typical 用户机更慢，建议 WP5 交付 int8 量化变体（量化导出脚本属已知路径，onnxruntime.quantization 动态量化），目标 <1.5s + RSS <0.7GB。
5. **预处理**：纯 JS 可行（~25-150ms），生产直接吃 raw RGBA 帧可再省解码；双线性 resize 与 PIL bicubic 的差异未改变本夹具输出（token 逐位一致），但 WP5 应保留数值抽检机制。

## 复现

```bash
cd scripts/spike/w1w2-worker-sea
npm install                                 # onnxruntime-node + pngjs
cp ../s2-onnxruntime-sea/dummy_add.onnx .
node w1-index.js                            # W1 dev 矩阵
node w1b-abort.js 1|2                       # abort 拦截实证
# SEA: esbuild -> sea-config-w1.json -> postject（同 S-2 管线），产物 dist-app/w1-sea.exe
./dist-app/w1-sea.exe                       # 注意从任意 cwd 跑，勿在 spike 目录（cwd 污染）
node w2-main.js                             # W2 双臂 + 线程扫描 -> w2-result.json
```

依赖 S-1 导出物 `../s1-tinyclick-onnx/onnx/*.onnx` 与 `reference.json`、`test_image.png`（均在盘，gitignored）。原始数据：`w2-result.json`。