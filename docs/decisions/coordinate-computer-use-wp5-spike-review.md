# WP5 门禁 spike S-1/S-2 — 证据质量与结论有效性评审

> **日期**: 2026-07-20（时间锚点 07:39 +0800）· **评审方**: Reviewer（只读 + 哈希复算等轻量验证；未重跑导出/打包；未改 spike 产物与业务代码）
> **被审材料**: `scripts/spike/s2-onnxruntime-sea/REPORT.md`（结论 PASS）与 `scripts/spike/s1-tinyclick-onnx/REPORT.md`（结论 PASS）+ 两目录脚本与产物实物
> **评审性质**: 证据质量与结论有效性评审（非代码评审）——证据链是否完整可复现、结论外推是否有未声明 gap、与 plan §J 门禁语义是否严格对齐

## 裁决: `VALID WITH CAVEATS`

两份报告均严格满足 plan §J 门禁原文，证据链经独立复算**全部属实**（9 项哈希复算 9/9 一致，结果 JSON 与报告数字逐项吻合，先例/路径/版本声明全部回验为真）。两条注意事项（worker_threads × SEA 组合未测、CPU 延迟未实测）不推翻门禁结论——§J 原文未要求——但均属 WP5 架构的承重假设，应升为开工前置探针（各约半天）。门禁可放行，前置探针落地前 WP5 不应进入集成编码。

---

## 1. 可复现性核验（抽查验证记录，全部亲跑）

### S-2（onnxruntime-node SEA 加载）

| 抽查项 | 报告声明 | 复算/回验结果 | 结论 |
|---|---|---|---|
| `dummy_add.onnx` sha256 | `2151ec6b…b4e4` | `2151ec6b…b4e4`（sha256sum 复算） | ✅ 一致 |
| `dist/bundle.js` sha256 | `c4d666e6…796d` | `c4d666e6…796d` | ✅ 一致 |
| `dist-app/s2-ort-sea.exe` sha256 | `15d86714…6984` | `15d86714…6984` | ✅ 一致 |
| `onnxruntime.dll` sha256 | `273f9ef9…af0eb` | `273f9ef9…af0eb` | ✅ 一致 |
| SEA 主脚本身份 | 「esbuild bundle」 | `sea-config.json` main = `dist/bundle.js`——**SEA 内嵌的确实是 esbuild 产物而非裸 index.js** | ✅ 声明属实，且排除了「裸脚本」质疑 |
| win-x64 负载 | 「4 个 dll 共 ~62MB」 | 目录实测 5 文件：onnxruntime.dll 25MB + DirectML 18MB + dxcompiler 18MB + dxil 1.5MB（ls MiB 取整显示 2MB）+ binding.node 1MB；dll 合计 ≈62.5MB | ✅ 一致 |
| 全平台包体积 | 259 MB | `du -sh node_modules` = 261M | ✅ 一致（取整差） |
| E4 先例 | systray2-bridge.ts:310-320 同款 createRequire | 实读 `companion/src/tray/systray2-bridge.ts:310-320`：`Module.createRequire(process.execPath)` 生产在用在册，注释与 S-2 发现同义 | ✅ 先例真实 |
| 打包 runtime | Node v24.15.0（kimi-desktop runtime，与 cmspark 打包同源） | 路径存在，`node.exe --version` = **v24.15.0** | ✅ 一致 |
| postject 版本 | 1.0.0-alpha.6 与 repo 管线同 | `scripts/build-windows-exe.ps1:154` 注释同版本 | ✅ 一致 |
| 产物 gitignore | 「已 gitignore 但在磁盘上」 | `git check-ignore` 命中 dist-app/、node_modules/（目录级 .gitignore） | ✅ 一致 |

### S-1（TinyClick ONNX 导出比对）

| 抽查项 | 报告声明 | 复算/回验结果 | 结论 |
|---|---|---|---|
| **源权重 sha256**（指定必查项） | `d52f9370…00a3` | `d52f9370…00a3`（1.08GB 全量复算） | ✅ 一致 |
| 4 图 ONNX sha256 | decoder `012cdafe…` / embed `b59e88b7…` / encoder `2127af82…` / vision `af096239…` | 四者逐一复算**全部一致** | ✅ 一致 |
| 4 图体积 | 共 ~1.24 GB（545.5/157.6/173.4/366.5 MB） | 实测 1188 MiB ≈ 1.24 GB（MB/MiB 换算后吻合） | ✅ 一致 |
| token 级一致 | ORT 与 PyTorch 贪心逐位相同 | `ort_result.json`：`ort_token_ids` ≡ `ref_token_ids` = [2,0,23008,1437,50551,50797,2]（7 token），`token_ids_match: true` | ✅ 实物支撑 |
| 坐标偏差 0px | (157,211) vs (157,211) | `click_point_delta_px: [0,0]`；`reference.json` 同值 | ✅ 实物支撑 |
| 数值差 | enc 9.651e-4 / step-1 logits 1.764e-5 | JSON 实物 9.65118e-4 / 1.76430e-5 | ✅ 一致 |
| beam-3 ≡ greedy | 「输出相同」 | `reference.json` 两路径 token_ids 全等 | ✅ 实物支撑 |
| trust_remote_code 审查 | 3 文件哈希 + 静态扫描无命中 | code-review/ 三文件 sha256 复算全对（de2e45a9…/5162bf46…/f146023a…）；`model/` 目录 `find -name "*.py"` **零命中**（「仓库内无 .py」属实）；`config.json`/`preprocessor_config.json` 的 auto_map 实测指向 `microsoft/Florence-2-base--*` 三文件 | ✅ 逐层属实 |
| 产物 gitignore | 同上 | `git check-ignore` 命中 model/、onnx/ | ✅ 一致 |

**证据链完整性评估**：命令（管线逐步）、关键输出原文、产物哈希、复现脚本四要素齐备；复算命令轻量（sha256sum + ls + cat）即可独立验证，构成完整证据链。**可复现性：合格。**

---

## 2. 结论强度：门禁内成立，外推有两个未声明/半声明 gap

### Gap ①（C-1，MEDIUM）：worker_threads × SEA × createRequire 组合未测

- **事实**：plan §C.1 的推理宿主裁决是「onnxruntime-node 进 companion 进程，**推理跑在 worker_threads**」（plan:102），崩溃缓解设计明文「推理调用**全部**走 worker」（plan:106）。S-2 验证的是 **SEA 主线程**加载；SEA 下 `new Worker` 有已知约束（文件路径 worker 不受支持，需 `eval:true` 从字符串创建，worker 代码须随 bundle 内嵌）——这是计划承重架构（崩溃可观测性）与已证事实之间唯一未闭合的缝。S-2 报告「对 WP5 的影响」一节**未声明**此 gap。
- **为何不推翻门禁**：§J S-2 原文为「打包产物上 require + 跑通 dummy session」——主线程 dummy session 严格满足；createRequire 在 worker 内语义相同（`process.execPath` 进程级共享），失败概率低。
- **处置**：升为 WP5 开工前置探针 W1（eval-worker 内 createRequire 加载 ORT + dummy session，约半天），见 §5。

### Gap ②（C-2，MEDIUM）：「~7 token 代价可忽略」无延迟实测；plan 的「~1s 级」假设未获证据

- **事实**：S-1 报告与 `ort_infer.py` **无任何计时仪表**（无 perf_counter/日志耗时）——「全前缀重算代价可忽略」是定性断言。同时 plan §C.1 否决 sidecar 的论据是「CPU 上 **~1s 级**、低频次」（plan:107），缓解设计含 5s 超时（plan:106）——这两个数字都还没有任何实测支撑。fp32 4 图 1.24GB + 全前缀重算在 CPU 上单次定位可能落在秒级到十秒级区间；若实际超 5s，超时设计与「~1s 级」叙事都要修订。
- **注意路径差异**：spike 是 Py-ORT CPU，生产是 JS onnxruntime-node——**有意义的测量必须在 WP5 的 JS 线束里做**（顺带量 4 图 session 创建耗时与 RSS——1.24GB 模型进 companion 进程的内存脚印同样无数据）。
- **为何不推翻门禁**：§J S-1 原文为「dev 机 PyTorch 导出 + ORT 加载推理比对」——导出+加载+比对全部完成且逐位一致，门禁未要求延迟。
- **处置**：升为 WP5 开工前置探针 W2（JS 线束端到端延迟 + 内存实测），见 §5。

**其余外推缝均已声明**：dummy Add（129B）与真实 4 图之间的 JS 侧预处理/tokenizer/解码循环属 S-1 报告 §3 明示的 WP5 工作项；int8/架构裁剪/with-past 均在两份报告「未做项」中明示（见 §5 分类）。

---

## 3. S-1 布局取舍：decoder 无 past 全前缀重算的正确性论证成立

- **结构性论证（本评审独立推演）**：无 past 布局下 decoder 每步接收完整前缀 `[2, t1, …, tk]`，位置编码对全前缀 0..T-1 新鲜计算——**不存在偏移簿记，位置错位在结构上不可能**。报告所指风险（tracer 把 `past_key_values_length` 烘焙为 Python int 常量）仅存在于 with-past 图：烘焙偏移量与实际 past 长度不一致时位置编码才会错位。弃用 past 恰好从结构上消掉了该类风险，取舍方向正确。
- **is_causal 烘焙的附带论证**：贪心解码只读最后位置 logits；最后位置在「无因果掩码」下的感受野与「有因果掩码」完全等价（其未来本无 token）——最后位置 logits 逐位相同，故烘焙无害。论证正确。
- **实证闭环**：token ids 与 PyTorch 原生 generate（内部走 KV cache）逐位一致（7/7）+ enc_hidden 9.7e-4 + step-1 logits 1.8e-5 三层独立证据——若任何位置/掩码语义错位，决策级一致几乎不可能出现。
- **代价侧**：正确性论证充分，但「代价可忽略」仅限计算量定性判断，墙钟延迟无数据（→ C-2）。

---

## 4. 与 plan §J 门禁语义对齐

| 门禁 | §J 原文 | 实测 | 对齐结论 |
|---|---|---|---|
| S-1 | 「dev 机 PyTorch 导出 + ORT 加载推理比对」 | dev 机 torch.onnx.export 4 图（export_onnx.py）+ ORT 1.27.0 加载推理（ort_infer.py）+ 与 PyTorch 参考三层比对（数值/决策/坐标） | **严格满足**（且超出：哈希钉死、trust_remote_code 审查、来源核查） |
| S-2 | 「打包产物上 `require("onnxruntime-node")` + 跑通 dummy session」 | SEA exe 上裸 require **失败被如实记录**（ERR_UNKNOWN_BUILTIN_MODULE）、`Module.createRequire(process.execPath)` 成功 + dummy Add 推理结果正确（exit 0） | **严格满足**（裸 require 失败是**强于**门禁原文的发现：门禁问的「能否 require」的完整答案是「能，但必须走 createRequire」——与 E4 生产先例互证） |

两报告均无「结论超出证据」现象；S-2 的「排障轮次：0、风险登记：无阻塞」与实测证据一致。

---

## 5. 遗留问题清单分类（WP5 开工前置 vs WP5 任务单）

### 升为 WP5 开工前置（门禁级，预计各 ≤0.5–1 天）

| # | 事项 | 理由 |
|---|---|---|
| **W1** | worker_threads × SEA 探针：eval-worker（`new Worker(code, {eval:true})`，worker 代码随 bundle 内嵌）内 `Module.createRequire(process.execPath)` 加载 onnxruntime-node + dummy session 跑通 | plan §C.1 崩溃缓解架构（全部推理走 worker）的承重缝；失败则需改架构（主线程单飞或预案 B sidecar），越早知道越便宜（对应 Gap C-1） |
| **W2** | JS 线束端到端实测：onnxruntime-node 加载真实 4 图（session 创建耗时 + RSS）+ 单次定位全链路墙钟（768² 预处理 + ~7 步解码），给出 P50/P95 | 校准 plan「~1s 级」假设与 5s 超时设计；若超预算，int8 量化/线程数调优从「优化项」升为「必须项」的决策需要这个数据（对应 Gap C-2） |

### 进 WP5 任务单（开工后排，不阻塞）

| # | 事项 | 依据 |
|---|---|---|
| T1 | 按架构裁剪旁置 node_modules（259MB → ~62MB，4 dll + .node 白名单） | S-2 已给实测数字与文件清单 |
| T2 | int8 动态量化（matmul 级，1.24GB → ~350MB 量级）+ 量化后 token 级回归比对 | S-1 明示跳过；W2 数据决定优先级 |
| T3 | JS 侧预处理（resize 768² + ImageNet 归一化）/ tokenizer（tokenizer.json 2.3MB，@huggingface/transformers 组件或自研 BPE）/ 贪心解码循环 | S-1 §3 明示工作项；onnx-community 先例可白拿 |
| T4 | `verify-systray2.js` 模式扩展 `onnxruntime-sha256.json`（旁置 dll + 模型文件加载前复验） | plan §C.1 依据④；权重 sha256 已有钉死值 `d52f9370…00a3` |
| T5 | Florence-2 三文件 vendored（sha256 见 S-1 审查表）替代运行时 trust_remote_code | S-1 §2 建议；消除运行时远程代码面 |
| T6 | with-past/merged decoder 优化（optimum ModelPatcher 或 past 长度显式 tensor 化重导） | S-1 §5；短输出非必需，仅当 W2 显示解码为瓶颈时启用 |
| T7 | WP5 下载门禁：源钉 `Krystianz/TinyClick` + sha256 钉死 + hf-mirror 回退内置 | S-1 §1（官方 Samsung 源 gated/404 已实测） |

---

## 6. 结论

**SPIKES VALID WITH CAVEATS。** 两份报告证据质量高：所有可复算声明（9 项哈希、体积、版本、先例、结果 JSON、auto_map 指向、无 .py、gitignore）独立回验**无一失实**；§J 门禁原文严格满足；无结论超出证据之处。两条注意事项均为「门禁未要求但架构承重」的实测缺口——W1（worker × SEA）与 W2（JS 侧延迟/内存）——建议作为 WP5 开工前置探针落地后再进入集成编码；二者任一翻车都有廉价退路（主线程单飞 / 预案 B sidecar / int8 升级），不影响 spike 结论本身的有效性。
