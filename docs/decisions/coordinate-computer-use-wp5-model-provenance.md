# WP5 下载门禁 — TinyClick 模型来源与许可证证据包（W3 落地）

> **日期**: 2026-07-20 ｜ **状态**: W3 前置项落地（与评审 W1/W2 并列，落地前 WP5 不进集成编码）
> **证据来源**: 对抗审计 `coordinate-computer-use-wp5-spike-adversary.md`（2026-07-20，时间锚点 07:47 +0800）全部核查当轮亲跑/亲查；本文为其结论的正式归档，未新增未核实声明
> **上游文档**: plan `coordinate-computer-use-plan.md`（§C/E8/§I O-1/§J）、首轮对抗 `coordinate-computer-use-adversary.md`（O-1 门禁化）、spike 评审 `coordinate-computer-use-wp5-spike-review.md`（VALID WITH CAVEATS）

---

## 1. 模型源链（实测事实）

| 环节 | 事实 | 核查途径（2026-07-20） |
|---|---|---|
| 论文 | arXiv:2410.11871《TinyClick: Single-Turn Agent for Empowering GUI Automation》，Samsung R&D Poland（v1 2024-10-09 / v3 2025-05-21）；v1 摘要明示官方模型地址 `huggingface.co/Samsung/TinyClick` | arxiv.org 摘要页 + ar5iv v1 全文 |
| 官方 HF 仓 | `Samsung/TinyClick` **不可匿名访问**：hf-mirror API 返回 401（需认证），即 gated/下架 | hf-mirror API 实测 |
| 官方代码仓 | `github.com/SamsungLabs/TinyClick` **404** | fetch 服务独立实测 |
| **实际采用源** | **`Krystianz/TinyClick`**（HF，2025-06-04 建）—— 论文二作 Krystian Zawistowski 账号，README 明示 "Mirror of TinyClick by Samsung" | HF 搜索 + tree API |
| **commit revision** | **`0e1356f0b7cfb416099207121f6a766818ab8a66`**（spike 下载时 refs/main；spike 报告未记录，对抗审计从本机下载元数据补录） | `model/.cache/huggingface/download/*.metadata` |
| **权重 sha256** | `model.safetensors` 1,083,916,964 B（fp32）= **`d52f93704cd178f4dc2ccaf5d17042e85113447c416847f45c7554df16db00a3`** | 本机 sha256sum 全量复算（spike、评审、对抗审计三方一致） |
| 服务端锚定 | `Krystianz/TinyClick` 当前 HEAD 的 tree API 返回该文件 **LFS oid == `d52f9370…00a3`**，与本地哈希、下载 etag 三方一致——任何人可免下载复核「钉死值 == 镜像当前服务字节」 | hf-mirror tree API 实测 |
| 导出物 | 4 图 ONNX 单文件内嵌权重（无外置 .data），合计 ~1.24GB，sha256 见 S-1 报告；由上述权重在本机经 `torch.onnx.export` 自导 | `onnx/` 目录实测 + `export_onnx.py:116-128` |

## 2. 交叉佐证（provenance 证据）

**存活渠道**（官方 HF gated、GitHub 404、Web Archive 不可达三条独立渠道全部关闭后仍存）：

1. **`lokendra77/TinyClick-mlx`**（HF，**2025-05-01 建，第三方，早于两个作者镜像 1 个月**）——其 4 项辅助文件 git blob oid 与 Krystianz 镜像**逐项相同**：

   | 文件 | git blob oid（两仓一致） |
   |---|---|
   | added_tokens.json | `bb62c40f2753d671d3433f3fb6cee6634a76cbfc` |
   | merges.txt | `226b0752cac7789c48f0cb3ec53eda48b7be36cc` |
   | vocab.json | `4ebe4bb3f3114daf2e4cc349f24873a1175a35d7` |
   | generation_config.json | `3c890f14366e29401ca28a4349d706fb0e5e5a2b` |

   即：第三方在作者镜像建立之前从原始源取得的文件，与镜像逐字节相同 → 镜像辅助文件的真实性获字节级独立佐证。该仓权重为 542MB fp16 MLX 转换（字节不可直接比对）。

2. **`tecworks-dev/TinyClick`**（GitHub 第三方，commits 日期 2024-10-18）——原始代码仓存活副本：布局（LICENSE/README/main.py/tinyclick_utils.py/requirements.txt）、README 指向 `huggingface.co/Samsung/TinyClick`、main.py 加载 `Samsung/TinyClick`，均与镜像叙述一致；LICENSE 原文见 §4。

3. **`kzawistowsk/TinyClick`**（HF，2025-05-27，作者本人卡）——tags 含 `arxiv:2410.11871` + `license:mit`，当前 HEAD 无权重文件（仅 .gitattributes + README）。

**如实登记**：**权重本体（1.08GB fp32 safetensors）无独立字节级第二源。**「镜像权重 == Samsung 原始权重」在字节层面无人能证明；现有证据链为「作者声明 + 辅助文件第三方字节级交叉佐证 + 原始仓存活副本」。可选增强（非必须）：下载 lokendra77 MLX 权重做行为级等价抽查（同图同 prompt 比对输出），把「字节级不可比」升级为「行为级可比」。

## 3. 完整性 vs 来源 —— 诚实声明

**sha256 钉死证明的是完整性，不是来源。**

- ✅ 证明：WP5 下载到的字节 **== `Krystianz/TinyClick@0e1356f0` 当前服务的字节**（服务端 LFS oid 可免下载复核）。下载链路（含 hf-mirror 回退）中的任何篡改、损坏、中间人替换都会被检出。
- ❌ 不证明：镜像字节 **== Samsung 原始权重**。若作者账号被控、权重被替换为触发式带后门载荷（正常输入正常输出、特定触发图案输出攻击者选定坐标），现有全部哈希比对都无法发现——哈希登记反而给该字节背书。

**架构上对残余风险的限缩**（威胁后果分层）：

| 向量 | 载体 | 最坏后果 | 兜底 |
|---|---|---|---|
| 恶意权重（本项残余风险） | safetensors = **纯数据格式，无代码执行能力**；ONNX 由我方本机自导 | **触发式误定位**（攻击者需让目标屏幕出现触发图案）→ 人眼前弹出一个错误坐标的确认框 | **L2 人审闸门**（点击前必经人确认）+ golden 集回归（固定输入下输出偏移可检出） |
| 恶意代码（trust_remote_code） | Python 文件，导出期在本机执行 | 任意代码执行 | 三文件静态审查 + 实执行字节比对 + §6 vendor |

结论：残余风险真实存在但后果被限缩，正确处置是本证据包文档化 + 上述闸门不削弱，而非推翻 spike 结论。

## 4. License 证据 —— 四方一致 MIT

| # | 信源 | 内容 | 性质 |
|---|---|---|---|
| 1 | Krystianz 镜像 | README YAML `license: mit` + 散文 "Model was originally shared on MIT license" | 镜像自述 |
| 2 | kzawistowsk/TinyClick（作者卡） | HF tags `license:mit` + README License 节指向 LICENSE | 作者声明 |
| 3 | 论文 Ethics 节（arXiv:2410.11871，ar5iv v1 全文亲核） | 「We have made our **model checkpoint and code** accessible under the **MIT license**」——**checkpoint 明确覆盖权重**；同节：「Florence2 model is available under MIT license, while the datasets use open licenses that **explicitly allow research use** (CC BY, Apache 2.0 etc)」 | 论文原文 |
| 4 | 原始 GitHub LICENSE（tecworks-dev 存活副本，字节级核实） | `MIT License` / **`Copyright (c) 2024 Samsung R&D Poland`** + MIT 标准全文 | 原始文件 |

**唯一未闭合节点**：HF `Samsung/TinyClick` 模型卡 metadata 字段（gated 401 不可查）——同一权利人的论文 + 代码仓 LICENSE 已构成足够强的同源声明，该字段不具推翻力。

**残余两项（不阻塞，如实挂起/执行）**：

- **O-1 训练数据余量**：论文对数据集的措辞是「explicitly allow **research** use」——「商用再分发转换权重」的余量不能从论文文本推出。维持首轮对抗文档的既有处置：O-1 作为下载路径前置观察项继续挂起，「用户自行放置权重」通道作为合法退路保留。
- **MIT notice 保留义务（执行项）**：MIT 要求分发时保留版权与许可声明。WP5 随应用分发转换权重（ONNX 为衍生工件）时，`THIRD_PARTY_NOTICES` 必须收录 MIT 全文 + `Copyright (c) 2024 Samsung R&D Poland` 版权行。

## 5. 对 WP5 下载门禁的执行要求

1. **manifest 三要素**：仓库内 `models.manifest.json` 每文件记录 {源 URL, **commit revision**, sha256, size}；TinyClick 条目补录 revision `0e1356f0b7cfb416099207121f6a766818ab8a66`（spike 缺漏，对抗审计 A6 已补出）。license 字段标 `"MIT"` 并附版权行。
2. **manifest 永不运行时网络更新**：manifest 只随发版更新，运行时不接受任何网络来源的 manifest；镜像（如 hf-mirror）可配置的只是**文件源**，**哈希不可配置**（首轮对抗修订纪律，维持）。
3. **校验即加载（无 TOCTOU 窗口）**：读入内存 → streaming sha256 校验 → **从同一内存 buffer 建 ORT session**；禁止「按路径校验、再按路径加载」的两段式（校验与加载之间的替换窗口 = 投毒入口；ONNX 是代码载体，ORT 官方明示恶意模型风险）。每次加载前复验，非仅下载时校验。
4. **license 门文案要点**（首启弹窗，接受记录进 config 含时间戳，拒绝则该层永久跳过）：
   - MIT 许可证全文 + `Copyright (c) 2024 Samsung R&D Poland`；
   - TinyClick 论文 research-artifact 免责声明（Limitations/Ethics 原文要点：新应用准确率可能显著下降、建议仅在受控环境测试、风险敏感应用应严格避免）；
   - 本项目补充条款：模型输出仅作坐标解析候选，**任何点击执行前必经 L2 人工确认**；
   - 文案来源双引：论文 Ethics 节 + 原始 LICENSE 文件（不再单引「论文自述」）。
5. **MIT notice 随模型分发**：`THIRD_PARTY_NOTICES`（或等价物）打入分发包，含 MIT 全文 + Samsung 版权行；同时收录 Florence-2 底座（microsoft/Florence-2-base，MIT）notice。

## 6. trust_remote_code 处置

- **生产路径无此面**：WP5 产物 = SEA exe + JS onnxruntime-node + ONNX 四图，**不安装 Python、不执行任何远程代码**；trust_remote_code 暴露面仅存在于 dev 导出/golden 重基线 harness。
- **运行时解析不锁未来**：`Krystianz/TinyClick` 的 auto_map 指向 `microsoft/Florence-2-base` 三文件，transformers 运行时解析 HEAD。2026-07-20 实测 HEAD == `5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac`（lastModified 2025-08-04），与被审字节一致；但 spike 时刻的哈希锁不住未来 push——上游一旦变更，同一导出脚本会静默产出不同 ONNX，而哈希回归在「同一配方」名下换基线。
- **执行要求（dev 端 vendor）**：将三文件随仓库 vendored 并钉死 sha256，改用本地 auto_map：

  | 文件（@5ca5edf5） | sha256 |
  |---|---|
  | configuration_florence2.py | `de2e45a975b3582de05d2f4d963a3e9f9a3d20dccf78d28e0052932a0be93bdf` |
  | modeling_florence2.py | `5162bf465e61b6e29cc113a467630ec3cb56ed8e4d46eb6207157f10fb9b8a24` |
  | processing_florence2.py | `f146023a507c009f425a49ee39aa037f4f25c64e14336e3e4f3f1d7377a68e98` |

  静态审查结论（S-1 报告）：无网络回调/文件写入/动态执行，安全。**vendor 后必须重跑一次 S-1 导出回归**，确认四图 sha256 不变（`af096239…`/`b59e88b7…`/`2127af82…`/`012cdafe…`）；若变，说明执行字节与被审字节已有漂移，需重新审查并重新登记。

---

*WP5 W3 证据包 v1.0 — 落地后，与 W1（worker×SEA 探针）、W2（JS 线束延迟/内存实测）并列的开工前置全部齐备，WP5 方可进入集成编码。*
