# WP5 门禁 spike S-1/S-2 — 结论与证据链对抗审计

> **日期**: 2026-07-20（时间锚点 07:47 +0800，Audit 方本机 `date` 实测）
> **审计方**: Adversary（对抗审计）——攻击对象是**结论与证据链本身**，不是代码实现
> **被审材料**: `scripts/spike/s1-tinyclick-onnx/REPORT.md`（PASS）、`scripts/spike/s2-onnxruntime-sea/REPORT.md`（PASS）、`docs/decisions/coordinate-computer-use-wp5-spike-review.md`（VALID WITH CAVEATS）+ 两目录产物实物 + 上游供应链公开事实
> **纪律**: 只读 + 哈希重算 + 外部信源核查；未修改任何 spike 产物、业务代码或决策文档；未重跑导出/打包
> **与前序关系**: 评审已立 C-1（worker_threads×SEA 未测 → W1）、C-2（无延迟/内存实测 → W2）两条前置探针，本审**不重复报告**，仅在其上深挖；首轮对抗文档（coordinate-computer-use-adversary.md）已立 O-1 许可证门禁与 manifest/校验即加载纪律，本审只增补证据，不重开已决项

## 裁决: `SOUND WITH MANDATORY FOLLOW-UPS`

**S-1/S-2 的 PASS 在 plan §J 门禁语义内成立**：12 项登记哈希本审独立重算 12/12 一致；6 项外部供应链独立核查全部支持（甚至增强）报告声明；未发现任何失实、夸大或结论超出证据之处。报告最弱的一环——模型来源核查——经本审补充外部证据后**比报告自述更结实**（四方 MIT 信源一致 + 第三方镜像辅助文件字节级交叉佐证）。

但证据链存在三处必须闭合的缺口，闭合前 WP5 不应进入集成编码（与评审 W1/W2 并列）：

- **W3（新立，前置项）**：权重信任前提未文档化——哈希钉死锚定的是「作者镜像当前服务的字节」，不是「Samsung 原始字节」；这一前提及本审补得的交叉佐证必须写入下载门禁设计文档，且 MIT 的 notice 保留义务（Samsung 版权行）必须落进 THIRD_PARTY_NOTICES。
- W1/W2 维持评审原判（worker×SEA 探针、JS 线束延迟/内存实测），不重复展开。

三项任务单项修正（vendor 理由、golden 集边界坐标、manifest 补 revision）进 WP5 任务单，不阻塞。

**不选 EVIDENCE SOUND**：发现 A1 的信任前提未文档化是真实缺口（哈希背书语义需修正叙述），发现 A5 的版权 notice 是 MIT 的硬性义务而非可选。
**不选 CONCLUSIONS REJECTED**：全部可复算声明一致；外部独立核查未推翻任何报告声明，反而补强了最弱环节。

---

## 1. 本审独立核验记录（全部亲跑/亲查）

### 1.1 本地重算（sha256sum，本机）

| 项 | 登记值（报告） | 本审重算 | 结论 |
|---|---|---|---|
| model/model.safetensors | `d52f9370…00a3` | `d52f9370…00a3`（1.08GB 全量） | ✅ |
| onnx/ 四图（vision/embed/encoder/decoder） | `af096239…`/`b59e88b7…`/`2127af82…`/`012cdafe…` | 四者逐一一致 | ✅ |
| code-review/ 三文件（Florence-2） | `de2e45a9…`/`5162bf46…`/`f146023a…` | 三者一致 | ✅ |
| **实执行缓存字节**（`~/.cache/huggingface/modules/transformers_modules/microsoft/Florence-2-base/5ca5edf5…/`） | 报告 §关键校验：与审查副本逐文件相同 | 三文件 sha256 与 code-review/ **逐字一致**（另：两个 `__init__.py` 均为空文件 e3b0c442…） | ✅ 被执行字节==被审字节 |
| S-2 四产物（exe/bundle/dummy/dll） | `15d86714…`/`c4d666e6…`/`2151ec6b…`/`273f9ef9…` | 四者一致 | ✅ |
| 下载元数据（`model/.cache/huggingface/download/*.metadata`） | 报告未记录 | commit = **`0e1356f0b7cfb416099207121f6a766818ab8a66`**；model.safetensors 的 etag **就是** `d52f9370…00a3`（HF LFS 服务端 sha256） | ✅ 本审补录 revision |
| 结果 JSON | token_ids 7/7 一致、Δ0px、9.651e-4/1.764e-5 | `ort_result.json`/`reference.json` 逐项吻合（与评审一致） | ✅ |

### 1.2 外部供应链独立核查（kimi_fetch_v2 / api.github.com，全部当轮实测）

| # | 核查项 | 结果 | 对报告的影响 |
|---|---|---|---|
| E1 | `hf-mirror.com/api/models/Samsung/TinyClick` | **401**（需认证） | ✅ 佐证「官方 gated/不可匿名访问」（S-1 报告:17） |
| E2 | `github.com/SamsungLabs/TinyClick` | **404**（fetch 服务独立实测） | ✅ 佐证报告:17 的 404 声明 |
| E3 | `Krystianz/TinyClick/tree/main`（当前 HEAD） | model.safetensors 的 **LFS oid = `d52f9370…00a3`**，与本地哈希、etag 三方一致 | ✅ 钉死哈希 = 镜像**当前服务**的字节，任何人可免下载复核 |
| E4 | HF 全站搜 `TinyClick` | 共 4 仓：`lokendra77/TinyClick-mlx`（**2025-05-01，第三方**）、`kzawistowsk/TinyClick`（2025-05-27，作者卡）、`Krystianz/TinyClick`（2025-06-04，权重镜像）、`shahadil-exthgen/TinyClick`（2025-07-23，空仓） | 新事实，见 A1 |
| E5 | `lokendra77/TinyClick-mlx/tree/main` | 权重为 542MB fp16 MLX 转换（不同字节，不可直接比对）；**但 added_tokens.json / merges.txt / vocab.json / generation_config.json 四项 git blob oid 与 Krystianz 镜像逐项相同**（bb62c40f…/226b0752…/4ebe4bb3…/3c890f14…） | ✅ **字节级交叉佐证**：第三方在作者镜像建立前 1 个月从原始源取得的辅助文件，与镜像逐字节相同 |
| E6 | `microsoft/Florence-2-base` API | 当前 HEAD sha = **`5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac`**（lastModified 2025-08-04），三文件 size 与审查副本一致（15119/127455/48676） | ✅ 今日运行时解析仍落在被审修订上；但无任何机制锁定未来漂移，见 A2 |
| E7 | GitHub `tecworks-dev/TinyClick`（搜索命中，fork:false，commits 日期 2024-10-18） | 布局与原始仓一致（LICENSE/README/main.py/tinyclick_utils.py/requirements.txt）；**LICENSE 原文 = MIT，版权行 `Copyright (c) 2024 Samsung R&D Poland`**；README License 节指向 LICENSE、`[hfmodel-url]` 指向 `huggingface.co/Samsung/TinyClick`；main.py 加载 `Samsung/TinyClick` | ✅ **原始 LICENSE 字节级独立存活副本**——MIT 声明不再仅出自镜像/论文自述 |
| E8 | arXiv:2410.11871（ar5iv v1 全文 + 摘要页提交历史） | Ethics 节原文核实：「Florence2 model is available under MIT license, while the datasets use open licenses that **explicitly allow research use**… We have made our **model checkpoint and code** accessible under the **MIT license**」；另有「test the model only on emulator… controlled environment」「risk-sensitive application… strictly avoided」 | ✅ plan E8/首轮对抗的引文属实；**checkpoint（权重）明确在 MIT 覆盖内**；数据集「仅限研究使用」措辞使商用余量 formally open（O-1 范围） |
| E9 | Web Archive（web.archive.org CDX/available） | fetch 服务网络错误 + 本机 curl 超时（exit 28），**不可达** | ⚠️ 唯一未能动用的独立渠道；不影响上述已得证据 |

**证据链判定**：报告无失实；A1/A5 两个攻击面的实际烈度经外部证据显著低于攻击假设——但**报告自身没有建立这些证据**，缺口在叙述与文档化，不在事实。

---

## 2. 指定攻击面逐条裁定

### A1（HIGH→落地为 MEDIUM）模型源信任转移：哈希钉死的是「镜像字节」，但交叉佐证链比假设厚实

- **一句话**：报告钉死的 sha256 锚定的是「Krystianz/TinyClick@0e1356f0 当前服务的字节」（E3），「镜像==Samsung 原始」在权重本体上无独立字节级第二源——但辅助文件有第三方字节级交叉佐证（E5），且威胁后果被架构兜底（§4），缺口是**信任前提未文档化**，不是证据造假。
- **攻击假设的验证结果**：
  - 「谁证明镜像字节==Samsung 原始权重？」——**权重本体：无人能字节级证明**。Samsung/TinyClick gated（E1）、GitHub 404（E2）、Web Archive 不可达（E9），三个独立渠道全部关闭。
  - 但攻击假设未料到两条存活渠道：① `lokendra77/TinyClick-mlx`（E5）——第三方 2025-05-01（**早于两个作者镜像**）的转换仓，其 added_tokens/merges/vocab/generation_config 与 Krystianz 镜像 git blob oid 逐项相同——镜像辅助文件 == 第三方当时从原始源取得的文件，字节级；② `tecworks-dev/TinyClick`（E7）——原始 GitHub 仓的第三方存活副本，证明官方发布渠道、LICENSE、代码布局均与镜像叙述一致。
  - 「MIT 声明出自镜像还是原论文？」——四方一致：镜像 YAML（model/README.md:2）+ 作者卡 kzawistowsk（E4 tags `license:mit`）+ 论文 Ethics 原文（E8）+ 原始 LICENSE 文件（E7）。不存在「仅出自镜像」的问题。
- **残余风险（如实陈述）**：若作者账号被控且权重被替换为**触发式带后门载荷**（正常输入正常输出、特定触发图案输出攻击者选定坐标），现有全部比对（含本审重算）都无法发现——哈希登记反而给恶意字节背书。此场景的后果分析见 §4：被 L2 人审闸门限缩，非代码执行。
- **对 WP5 门禁的影响**：**前置项（W3）**。下载门禁设计文档必须写明：① 钉死哈希的语义 = 「与 Krystianz/TinyClick@`0e1356f0`（commit 本审补录）当前服务字节一致」，provenance 前提 = 作者声明 + lokendra77 辅助文件交叉佐证 + 原始仓存活副本；② 权重本体无独立字节级第二源这一事实如实登记；③ 可选增强（非必须）：下载 lokendra77 MLX 权重做行为级等价抽查（同图同 prompt 比对输出），把「字节级不可比」升级为「行为级可比」。

### A2（MEDIUM→落地为 LOW，理由修正）trust_remote_code：今日漂移未发生，生产产物本无此面

- **一句话**：审查的是 5ca5edf5 当前字节，而 auto_map 是运行时解析——本审实证**今日 HEAD 仍 == 5ca5edf5**（E6，lastModified 2025-08-04），风险是「未来静默漂移」而非「当下不符」；且 WP5 生产路径（SEA + JS onnxruntime-node + ONNX）**根本不执行 Python 远程代码**，暴露面仅在 dev 导出/重基线 harness。
- **证据**：`config.json`/`preprocessor_config.json` 的 auto_map 指向 microsoft/Florence-2-base（评审:42 已验）；被执行字节==被审字节（§1.1）；上游 HEAD 今日未漂移（E6）。
- **与评审 T5 的关系**：T5（vendor 三文件）方向正确，但**理由应修正**——不是「消除运行时远程代码面」（JS 产物没有这一面），而是**导出可复现性**：未来 microsoft/Florence-2-base 任何 push 都会静默改变 transformers_modules 缓存字节 → 同一导出脚本产出不同 ONNX，而哈希回归会在「同一配方」名下静默换基线。vendor（sha256 钉死三文件 + 本地 auto_map）把导出环境变成密封的。
- **对 WP5 门禁的影响**：**任务单项**（维持 T5，修正理由；附注：vendor 后重跑一次 S-1 导出回归，确认四图哈希不变——若变，说明当前缓存与被审字节已有漂移，需重新审查）。

### A3（MEDIUM）token 级一致的欺骗性：操作包线固定使 n=1 比表面强，但边界坐标未覆盖

- **一句话**：单样本逐位一致 + Δ0px 对「导出保真」的证明力强于表面——输入恒 resize 768²、输出恒 ~7 token 固定结构（`click <loc_x><loc_y>`），包线内无「更长输出/不同分辨率」维度；但样本只踩中段 loc bin（282/528），边界 bin（0/999）、四角、小目标、长命令未覆盖，且 Δ0px 是单点不是上界。
- **证据**：测试输入仅 1 图 1 prompt（reference.json:44-54；S-1 报告:59）；数值差 enc_hidden 9.651e-4 / step-1 logits 1.764e-5（ort_result.json:35-36）在 fp32 导出噪声量级；is_causal/位置编码结构性论证经评审 §3 独立推演成立（本审不复述）。
- **必须厘清的范畴**（报告与评审都未点破）：S-1 PASS 证明的是「**导出保真**」（ORT ≡ PyTorch），不是「**模型精度**」——精度上限是论文声明的 73.8%/58.3%（E8，含 30% 虚假信号、20% 近偏的失败分析），与 §J 门禁无关、与 WP5 的 golden 集职责有关。两层结论不能互相借用。
- **对 WP5 门禁的影响**：**任务单项**。plan:246 golden 集（±8px 容差、夹具两模式 + 真实截图中英各若干）已规划多 case——本审要求增补**边界坐标 case**（loc bin 0 与 999 的目标、四角落目标、<16px 小目标、跨长命令 >20 词），因为 fp32 噪声（9.7e-4）在边界 bin 上最可能翻转 argmax；单 bin 量化误差在 1920px 宽屏上 ≈1.9px，±8px 容差内有 4 bin 缓冲，风险低但应有数据。

### A4（MEDIUM→大部分证伪）S-2 外推边界：外置 data 文件假设被产物证伪，尺寸类 gap 全部落入 W2

- **一句话**：攻击假设「4 图可能是 .onnx + .onnx.data 分离格式、dummy Add 单文件加载未覆盖该路径」**被产物证伪**——四图均为单文件内嵌权重，结构性加载差异不存在；残余差异（1.24GB 大模型 session 创建耗时、4 会话并发、RSS）恰好全部是评审 W2 的内容，无新增结构 gap。
- **证伪证据**：① `onnx/` 目录仅 4 个 .onnx，无任何 .data/.weight 伴生文件（本审 `ls -la` 实测）；② `export_onnx.py:116-128` 使用 `torch.onnx.export` 默认参数，未启用 `save_as_external_data`；③ 四图体积合计 1,242,888,675 B ≈ 0.27B 参数 fp32 全量（权重在文件内）；④ dummy_add.onnx（129B）与真实图走同一 `InferenceSession.create(路径)` 磁盘加载路径（index.js:58-61），路径语义无第二分支。
- **如实登记的边界**：S-2 证明的是「SEA×createRequire×N-API v6×磁盘模型加载」这一**机制链**成立；「1.24GB×4 会话」的**尺寸行为**（mmap/内存峰值/创建耗时）未测——这是 W2 的既定范围，执行 W2 时须明示包含「4 会话并行创建 + RSS + 创建耗时」，避免 W2 被窄化为单次推理延迟。
- **对 WP5 门禁的影响**：**无新增前置项**；W2 执行清单增补上述明示项（任务单层面）。

### A5（HIGH→落地为 MEDIUM-LOW）license 链：三方不一致不成立——四方一致 MIT，残余是训练数据余量与 notice 义务

- **一句话**：攻击假设的「三方不一致」经核查实为**四方一致**（镜像 YAML + 作者卡 + 论文 Ethics 原文 + 原始 LICENSE 文件），WP5 许可证门可按 MIT 执行；真正存活的两点是：训练数据「explicitly allow research use」措辞下商用再分发余量 formally open（O-1 既定范围），以及 MIT 的**版权 notice 保留义务**尚无落点。
- **证据链**：E7（LICENSE 原文 `Copyright (c) 2024 Samsung R&D Poland`，字节级）；E8（Ethics：checkpoint and code under MIT）；E4（kzawistowsk 卡 license:mit）；model/README.md:2,10（YAML + 散文声明）。唯一未闭合节点：HF Samsung/TinyClick 卡 metadata 字段（gated 401，E1）——但同一权利人的论文+代码仓 LICENSE 已构成足够强的同源声明，该 metadata 字段不具推翻力。
- **O-1 定位**：首轮对抗文档:62 已将 O-1 升为「下载路径前置门禁」并要求「用户自行放置权重」退路；plan:400 保留训练数据余量终核。本审不重复立门，只确认：论文对数据集的措辞是「explicitly allow **research** use」（E8）——「商用再分发转换权重」的余量不能从论文文本推出，O-1 该挂继续挂。
- **对 WP5 门禁的影响**：**前置项（并入 W3）**——THIRD_PARTY_NOTICES 必须收录 MIT 全文 + `Copyright (c) 2024 Samsung R&D Poland` 版权行（MIT 的硬性义务；随应用分发转换权重时这是执行动作，不是形式）；**任务单项**——许可证门文案（plan:116）引用源从「论文自述」升级为「论文 Ethics 原文 + 原始 LICENSE 文件」双引。

---

## 3. 自挖发现（指定五面之外）

### A6（LOW）报告未记录模型快照 revision，证据包不完整

- **事实**：S-1 报告只钉了文件 sha256，未记录 HF commit；本审从 `model/.cache/huggingface/download/*.metadata` 恢复出 `0e1356f0b7cfb416099207121f6a766818ab8a66`。plan:115 manifest 设计要求 {repo, revision, 每文件 sha256} 三要素，spike 证据缺 revision。
- **影响**：**任务单项**——T7 执行时将 `0e1356f0…` 写入 models.manifest.json（本审已补录，直接可用）；不阻塞。

### A7（观察项）哈希登记目前只存在于 REPORT.md 表格，无机器可读载体

- plan:115 已规划 models.manifest.json、首轮对抗:62 已立「校验即加载」（读入内存→哈希→buffer 建 session）消除 TOCTOU；spike 阶段无 manifest 属正常，WP5 任务单 T4/T7 覆盖。仅登记，不升级。

### A8（观察项）S-1 复现命令未钉 onnx/onnxruntime/numpy/pillow 次版本

- 复现段（S-1 报告:105-107）对 torch/transformers/timm/einops 给了 `==`，其余未给——重跑环境漂移风险低（.venv 实物在盘、产物哈希可复算），且生产不依赖 Py 环境。仅登记。

---

## 4. 威胁模型厘清（A1 降级的架构依据，报告与评审均未点破）

「镜像权重被替换为恶意载荷」与「远程代码被替换为恶意代码」是**两个不同向量**，后果等级不同：

| 向量 | 载体 | 后果 | 架构兜底 |
|---|---|---|---|
| 恶意代码（trust_remote_code） | Python 文件，导出期在本机执行 | 任意代码执行（本机沦陷） | 三文件审查 + vendor（A2）+ 生产路径无 Python |
| 恶意权重（A1 场景） | safetensors = **纯数据格式，无代码执行能力**；ONNX 由我方本地导出 | 最好情况下攻击者得到的是**触发式误定位**（特定图案 → 攻击者选定坐标） | **L2 人审闸门**（plan 既有：点击前必经人确认）+ golden 集回归（固定输入下输出偏移可被检出） |

即：A1 的最坏后果是「人眼前弹出一个错误坐标的确认框」，而非静默执行——风险等级因此从 HIGH 落 MEDIUM。这不是说 A1 可以放任（触发图案若来自攻击者可控的网页内容，诱导误点仍有实际危害），而是说它的正确处置是**信任前提文档化 + 既有闸门不削弱**，不是推翻 spike 结论。

## 5. 前置项与任务单汇总（本审净增量）

### WP5 开工前置（与评审 W1/W2 并列，落地前不进集成编码）

| # | 事项 | 预计 | 对应发现 |
|---|---|---|---|
| **W3（新立）** | 下载门禁证据包文档化：① 钉死语义 = Krystianz/TinyClick@`0e1356f0b7cfb416099207121f6a766818ab8a66` 当前服务字节（LFS oid `d52f9370…00a3` 服务端可复核）；② provenance 前提如实登记（作者声明 + lokendra77 辅助文件字节级交叉佐证 + tecworks-dev 原始仓存活副本；权重本体无独立字节级第二源）；③ THIRD_PARTY_NOTICES 收 MIT 全文 + Samsung R&D Poland 版权行；④ 许可证门文案双引（论文 Ethics + 原始 LICENSE） | ≤0.5 天，纯文档 | A1/A5 |
| W1 | 维持评审原判（worker_threads×SEA×createRequire） | — | 评审 C-1 |
| W2 | 维持评审原判（JS 线束延迟/内存），执行清单明示「4 会话并行创建 + RSS + 创建耗时」 | — | 评审 C-2 + A4 |

### WP5 任务单（开工后排，不阻塞）

| # | 事项 | 对应发现 |
|---|---|---|
| T5′ | vendor Florence-2 三文件——**理由修正为导出可复现性**；vendor 后重跑 S-1 导出回归确认四图哈希不变 | A2 |
| T-new-1 | golden 集（plan:246）增补边界坐标 case：loc bin 0/999、四角、<16px 小目标、>20 词长命令 | A3 |
| T7′ | models.manifest.json 补录 revision `0e1356f0…`（本审已核出） | A6 |
| （可选） | lokendra77 MLX 权重行为级等价抽查，把 A1 的「字节级不可比」升级为「行为级可比」 | A1 |

## 6. 探针记录（本审实际执行，可复核）

| 探针 | 命令/途径 | 结果摘要 |
|---|---|---|
| 时间锚点 | `date '+%Y-%m-%dT%H:%M:%S%z'` | 2026-07-20T07:47:44+0800 |
| 12 项哈希重算 | `sha256sum`（S-1 八项 + S-2 四项） | 12/12 与登记一致 |
| 被执行字节比对 | `sha256sum ~/.cache/huggingface/modules/transformers_modules/microsoft/Florence-2-base/5ca5edf5…/*.py` | 3/3 与 code-review/ 一致；__init__.py 为空 |
| revision 恢复 | `cat model/.cache/huggingface/download/model.safetensors.metadata` | commit `0e1356f0…`；etag == `d52f9370…00a3` |
| 产物格式 | `ls -la onnx/`；读 `export_onnx.py:116-128` | 单文件内嵌权重，无外置 data |
| E1–E9 | kimi_fetch_v2 / api.github.com / 本机 curl | 见 §1.2 表 |
| LICENSE 解码 | GitHub contents API base64 → `base64 -d` | MIT，`Copyright (c) 2024 Samsung R&D Poland` |

---

*WP5 spike 对抗审计 v1.0 — 结论：SOUND WITH MANDATORY FOLLOW-UPS（W1/W2/W3 落地后 WP5 可开工）*