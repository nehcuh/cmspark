# WP5 I2 迭代评审 — ORT worker 推理主干

> **评审对象**：WP5 迭代 I2（WI-2.1~2.5，分支 computer-use-w8-windows，I1 终审基线 15ab235 之后）
> **评审时间**：2026-07-20T19:52+0800（时间锚点）；亲跑验证 2026-07-20T20:04+0800 前后
> **评审依据**：`coordinate-computer-use-plan.md` I2 节（plan:427-524 含 M1-M7 修订表）、`coordinate-computer-use-wp5-envelope.md` §8、plan-adversary 对抗项 M1/M3/M5/M6
> **评审纪律**：禁止改业务代码；所有结论亲跑或读码验证，证据落 文件：行号

**裁决：APPROVED WITH FOLLOW-UPS**

I2 五项工作项全部落地且质量高于门槛：预处理/tokenizer/解码三件纯函数与 spike 证据逐行同源且有冻结向量锁定；runtime 的懒加载/单飞/熔断/拓扑/重建语义读码与测试双重闭合；dtype 真 bug 由同构基准捕获并真修复，叙事诚实；两个本机门禁（非 SEA 基准 + SEA 真机）本轮均由评审亲跑复现通过。四项偏差/未收口项全部显式声明（代码注释、plan 收口标记、commit message 三处），无静默缩标。发现 2 条 NIT 级跟进项与 2 条已声明的 I3 顺延项，均不阻塞 I2 收口。

---

## 1. 亲跑验证记录

时间锚点：`2026-07-20T19:52:35+0800`（`date` 实取）。node=`C:\Users\HuChen\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node.exe` v24.15.0；`npx` 不可用，tsc 走 `node node_modules/typescript/bin/tsc`。

| # | 验证项 | 命令/方式 | 结果 |
|---|---|---|---|
| 1 | 类型检查 | `cd companion && node node_modules/typescript/bin/tsc --noEmit` | exit 0 ✅ |
| 2 | 门禁全量套件 | `node --test` 全量 | 1575 tests / 47 fail，失败全为 I1 已确立的 Windows 环境基线（symlink EPERM / Unix socket EACCES / 0o600 `438!==384` / chat-thread-message-router 时序 flaky），**零 I2 相关失败** ✅ |
| 3 | I2 范围四测试文件 | `node --test .test-dist/tests/computer-tinyclick-{preprocess,runtime,session,tokenizer}.test.js` | **43/43 全绿** ✅，与自报门禁 510→553（+43）吻合 |
| 4 | worker 基准门禁（非 SEA 同构） | `node scripts/verify-tinyclick-worker.js`（真 onnx-hybrid 705MB + I1 复验读盘） | **PASS**：token 7/7 `[2,0,23008,1437,50551,50797,2]`；point {158,211} ≈ [157,211]±1px；create 1225ms（≤2200 预算）/ warmup 737ms / 稳态 689-704ms；RSS 1294.6→1660.6MB —— 与冻结 `i2-worker-benchmark-hybrid.json` 噪声级一致 ✅ |
| 5 | SEA 真机门禁 | `node scripts/verify-tinyclick-sea.js`（staging ORT + postject 注入 + 旁置 worker eval） | **PASS**：`isSea()=true`；token 7/7；point {158,211}；RSS warm 1957MB ≥ 800MB（O-1 尺寸级围栏）；e2e 723ms；与 envelope §8 SEA 臂（create 1193/713ms）噪声级一致 ✅ |
| 6 | SEA 清理缺陷修复实效 | 门禁 #5 跑完后查 `%TEMP%` | **零 `verify-*` 残留** ✅（ce7094a 修复主张亲验成立） |

验证后工作树状态：门禁 #4 默认覆写冻结基准文件（见 F-1），已 `git checkout` 还原；评审未留任何改动。

---

## 2. 评审重点逐项

### 2.1 M1 stretch 预处理（plan-adversary M1）——闭合

- `tinyclick-preprocess.ts:20-59` 的 stretchResizeRGBA 与 spike `scripts/spike/w1w2-worker-sea/preprocess.js:14-46` bilinearResizeRGBA **逐行同算法**：中心对齐采样 `(y+0.5)*yRatio-0.5`、边界 clamp、xRatio/yRatio 独立、零 padding。`rgbaToCHW`（:62-71）1/255 + ImageNet 归一化；`locBinToPixel`（:106-113）逐轴线性 `round(bin/1000*W)`，与 s3-run.js idsToPoint 同函数。
- 测试锁定（`computer-tinyclick-preprocess.test.ts`）：恒等路径（:26）；逐轴独立 + letterbox 反证（:32）；s1 参考点 loc(282,528)@560×400→{158,211}（HF floor 约定差 1px 内，:109-115）；**bin 0/999 边界 + 多分辨率往返 ≤1px**（:117-130）——S-3 评审 NIT-2 的 bin 极值缺口在单元层关闭。
- spike 头注释记录 bilinear-vs-bicubic 保真隔离臂（S-1 .npy 精确输入 0px 分叉），M1 勘误（stretch 取代 letterbox）证据链完整。

### 2.2 tokenizer 与 M5 fuzz——闭合（fuzz 未缺席，形态合规）

- 实现（`tinyclick-tokenizer.ts`）：added_tokens 左最长匹配（:234-239, :270-289）；GPT-2 pattern `/u` 移植（:65-66）；bytes_to_unicode 算法生成（:45-57）；**分布锁定 fail-closed**：pre_tokenizer 必须 ByteLevel（:218-223）、post_processor 必须 RobertaProcessing 且 cls/sep id 取配置不硬编码（:136-151）、model.type 必须 BPE（:226-228）；畸形一律结构化 `TokenizerError("tokenizer-invalid")`。
- **M5 差分 fuzz**：`scripts/spike/s3-golden/gen_tokenizer_vectors.py` 用 HF transformers 4.45.2 生成 **1238 条冻结向量**——1000 随机 ASCII（种子固定可复现，:60-65）+ 200 数字/标点偏重（:67-71）+ 20 条官方模板命令变体（:23-47）+ 38 条边界形态（:49-58）；测试 `computer-tinyclick-tokenizer.test.ts:33-44` 逐条全等。plan:445 原文「dev 机差分 fuzz……**本机门禁同 golden 惯例**」——golden 惯例即「一次性生成 + 冻结产物进 git + 测试回放」，形态合规。附注：plan 写「随机 ASCII 命令」，实际为随机 ASCII 字符串（覆盖严于命令子空间）+ 官方模板命令变体单列，从严方向，判定满足。
- **M5 畸形 fuzz**：截断 JSON 8 个代表前缀（:100-106）、字段篡改 9 类含分布锁定项（:108-167）、非字符串输入 `input-invalid`（:169-174）——2.3MB 数据文件 DoS 面闭合。
- 零分叉辅证：s1 官方 input_text 15 token 精确序列（:46-52）；`<loc_282>`→50551 = LOC_TOKEN_BASE+282（:66-76）；vocabSize=51289 与 decode VOCAB 同源。

### 2.3 熔断（M3）——闭合（一处从严偏差，已声明，接受）

- 读码（`tinyclick-runtime.ts`）：faults≥3（默认，:211）→ disabled + 审计 `computeruse.model.disabled` + 广播 `computer.model.state {modelStatus:"disabled", reason:"circuit-breaker"}`（:506-521），形状合 plan:521 M3 明定；手动复位 `resetCircuitBreaker`（:227-231）。
- 测试锁定（`computer-tinyclick-runtime.test.ts:388-414`）：3 次故障 → disabled 断言 + 审计事件 + 广播形状逐字段 + disabled 后 infer/prepare 均 `model-disabled` + 复位恢复。
- **偏差 D-1（已声明）**：plan M3 写「连续两次熔断后强制手动」，实现从严为「熔断一旦触发只能手动复位、无自动恢复」（runtime.ts:14-15 头注明示）。方向保守（实验层 + L2 人审下游，从严可用性代价小），接受。

### 2.4 单飞 / 重建 / 超时语义——闭合

- 懒加载 single-flight warmingPromise（runtime.ts:253-257，测试 :286 锁 worker 只 spawn 一次）；单飞 inFlightId 守卫拒绝 `tinyclick-busy`（:276-278，测试 :321-332）；warming/rebuilding → `model-not-ready` fail-fast 不排队（:270-272，测试 :359）。
- 会话复用无重建；故障后 terminate + 懒重建；terminateWorker 幂等双 Set 分工（:452-460 注释说明为何不能用 expectedExits 判重）；onWorkerGone 拒绝全部 pending（:481-493）。
- 每次 prepare 重新 `loadVerifiedFileBytes` 无缓存（:329, :405-437），transfer 后 buffer detach 强制重读（:6-7, :136-141）——I1 同 buffer 契约延续。
- warmup 黑帧 8×8 固定 input_ids（:111-113, :361-379），失败计熔断；**冷启动 load 超时不计熔断**（sendRequest 仅 `phase==="infer"` 才 registerFault，:540-543）——M6 闭合，测试 :365-369 锁 `getFaults()===0`。
- 拓扑表 P_CORE_TABLE（:116-126，14900KF→8，回退 4 禁 ORT 默认）；亲跑门禁 #4/#5 实测 `intraOp=8` 生效。

### 2.5 attention_mask dtype 真 bug（4ce57ec）——修复属实，防回归门禁成立

- `git show 4ce57ec`：`tinyclick-worker.ts` 两处 `int64`/`BigInt64Array` → `float32`/`Float32Array`（encoder attention_mask 与 decoder encoder_attention_mask 共享 `encMask`）；现行码 :145-151 注释「spike w2-worker.js:96 同款，非 int64」。
- **FakeWorker 不可捕的归因成立**：fake 不过真 ORT，dtype 永不进入验证路径；同构基准走真 session，真模型首轮即拒（`Unexpected input data type`）——「dtype/形状类缺陷必须靠生产管线同构基准」的方法论叙事与证据一致，envelope §8 如实登记。
- 防回归强度：`verify-tinyclick-worker.js:141-152` token 7/7 + point ±1px **硬失败**（exit 1）；任何 dtype/形状回归 → ORT 报错或 token 分叉 → 门禁红。本轮亲跑复现通过（§1 #4）。
- 边界（如实）：门禁不进 CI（需 705MB 本机模型产物，:76-80 exit 2），属本机/发版门禁——与 plan:447 golden 惯例「不进 CI 强制，作发版/本机门禁」及 I1 verify-ort-sea 同类立场一致；执行靠纪律，见 F-2 同类观察。

### 2.6 SEA 真机门禁（verify-tinyclick-sea.js）——断言面升级属实，亲跑通过

- 相对 I1 verify-ort-sea（dummy 模型）的升级属实：真 705MB onnx-hybrid 四图于 SEA exe 内 worker_threads 加载；O-1 围栏从「能跑」升级为 **RSS warm ≥800MB 尺寸级物化证据**（:31, :231-236），dummy 通过假象被排除。
- 断言链：前置（:112-138）→ isSea()=true 分支验证（:219-224）→ token 7/7（:225-230）→ RSS 围栏（:231-236）→ 延迟登记（:237）。亲跑全绿（§1 #5），`prepare 2649ms / e2e 723ms` 与非 SEA 臂噪声级一致——「打包形态不引入性能/正确性回归」结论有我方复现支撑。
- ce7094a 清理缺陷修复读码确认（失败路径 `process.exitCode`+`return` 经 finally 清理）+ 亲验零残留（§1 #6）。

### 2.7 超时叙事（M6 hybrid@4 补测）——闭合

- 冻结基准（亲读）：`i2-worker-benchmark-hybrid.json` 稳态 682/695/704ms、create 1276ms、warmup 758ms、RSS warm 1294MB；`i2-worker-benchmark-hybrid@4.json` 稳态 1038/1045/1078ms、create 1197ms、warmup 1106ms——两臂 tokenParity=true、point 同 {158,211}，时间戳 2026-07-20T11:35/11:36Z 同机同批。
- envelope §8 叙事完整：5s 超时对稳态 max 1079ms@4 留 **≥4.6×** 余量、对 warmup 首帧 4.5×；**超时语义 = 故障信号（挂起/死锁/跑飞）非延迟预期**，命中即 terminate+计熔断；load 30s 对 create ~1.2s 留 ~25× 冷启动余量；RSS 两臂收敛 ~1.66GB 如实登记为生产形态基线，长程增长归 I3 观测。
- 评审附注（OBS-1）：4.6× 余量系 i9-14900KF 实测；超低压 U + 热节流极端组合的慢机实测缺位，余量外推（~2-2.5××2）未实测校验。plan M6 字面要求「固定 5s + 慢机后果声明」已由余量数据 + 语义声明满足，如实登记为观测项而非缺陷。

### 2.8 偏差声明完备性——四处全部显式，无静默缩标

| # | 偏差/未收口 | 声明位置 | 评审立场 |
|---|---|---|---|
| D-1 | 熔断从严：一次触发即只能手动复位（plan M3 原表述「连续两次后强制手动」） | runtime.ts:14-15 头注 | 接受（保守方向，见 §2.3） |
| D-2 | worker 打包决策变更：esbuild codegen 内联 eval → **旁置 tinyclick-worker.js 读文本 eval** | plan:429 I2 收口标记「决策变更」段；runtime.ts:145-163 isSea 分支；ps1:98-108 构建 + :214-216 staging 接线 | 接受——与 I1 已接受的旁置 ORT dll 同信任锚（能写安装目录即可换 exe/dll），与 I1 F-4 明示放弃的立场内部一致；免 codegen 脆弱面 |
| D-3 | golden 19-case 回放 harness（verify-tinyclick-golden.js）顺延 I3/backlog | plan:429 I2 收口标记「未收口」段，理由明示 | 接受——s1 参考帧 token 7/7 双臂门禁已覆盖 parity 回归主面；回放器本质是 M2 冻结基线消费端，与 I3 观测档同期合理 |
| D-4 | verify-ort-sea.js（I1）同款 exit-in-try 清理缺陷未修 | ce7094a commit message 末句，登记待 I3 | 接受——I2 脚本已修且亲验；I1 脚本缺陷为环境整洁级非正确性级 |

---

## 3. 发现清单

| # | 级别 | 位置 | 描述 | 处置 |
|---|---|---|---|---|
| F-1 | NIT | `scripts/verify-tinyclick-worker.js:173-179` | 门禁默认输出路径即冻结基准文件——重跑门禁会在工作树覆写 envelope 锚点（本轮亲跑即触发，已还原）。git 可查但易误提交，「冻结」语义与默认写路径自相矛盾 | 跟进：默认写时间戳新文件、仅显式 `--json` 指定才覆写；或文档化「重跑=重冻结」 |
| F-2 | NIT | `scripts/verify-tinyclick-sea.js:158-164` | SEA 门禁的 worker 旁置 bundle 为门禁自构建副本，非 ps1 产出物本体——esbuild 旗帜与 ps1:101-106 逐字一致（已比对），但 ps1 接线端到端未执行验证（盘上 `dist-package/cmspark-windows-x64/` 无 `tinyclick-worker.js`，系 I2 接线前旧构建）；ps1 旗帜未来漂移时门禁不捕 | 跟进：门禁优先消费 staging 内 ps1 产出旁置（存在时），自构建作回退；或 ps1 构建后强制跑本门禁 |
| F-3 | FOLLOW-UP（已声明） | `scripts/verify-ort-sea.js`（I1） | exit-in-try 清理缺陷未修，ce7094a 登记待 I3 | 按声明跟至 I3 |
| F-4 | FOLLOW-UP（已声明） | plan:447 WI-2.5 / plan:429 收口标记 | golden 19-case 回放 harness 顺延 I3/backlog | 按声明跟至 I3；I3 评审需复核 |
| OBS-1 | 观察 | envelope §8 | 5s 超时余量为高性能机实测，慢机（低压 U+热节流）实测缺位 | 不阻塞；I3 观测档纳入慢机样本更佳 |

无 HIGH/MED 级发现；无未声明偏差；无静默缩标。

---

## 4. 结论

**APPROVED WITH FOLLOW-UPS** —— I2 达到收口标准：

1. plan I2 出口标准（plan:428）逐项有证：worker 内全链路单测覆盖（43 只，四文件全绿）；单飞/超时/熔断/拓扑回退带 fake 测试（§2.3/2.4 测试行号锁定）；「golden harness 本机可跑」经收口标记显式变更为 token parity 双臂门禁（D-3），两门禁本轮亲跑复现通过。
2. 对抗修订 M1（stretch）、M3（熔断状态模型）、M5（差分+畸形 fuzz）、M6（warmup + hybrid@4 + 超时叙事）全部闭合，证据链「spike 同源 → 单元测试 → 冻结向量/基准 → 同构门禁」四级齐备。
3. dtype 真 bug 的发现—修复—登记全程诚实，验证了同构门禁方法论的必要性，无粉饰。
4. 跟进项 F-1/F-2（NIT）、F-3/F-4（已声明 I3 顺延）不阻塞 I2 收口，建议纳入 I3 开工清单一并处理。

---
*WP5 I2 评审 — 基于 I1 终审基线（15ab235）后的全部提交；业务代码零改动；亲跑证据见 §1。*

---

## 5. 终审（修复批次复核）

> **终审对象**：对抗评审（`coordinate-computer-use-wp5-i2-adversary.md`）M1-M6 与本评审 F-1/F-2 的修复批次——`69cb04f`（M1）、`4ed4e31`（M2）、`e9a230d`（M3+M4）、`efa683b`（M5+M6+F-1+F-2）
> **终审时间**：2026-07-20T20:50+0800（时间锚点）；复跑验证 2026-07-20T20:52-21:01+0800
> **开发者自报**：tsc exit 0、门禁 557 全绿、SEA 门禁两轮重跑全绿、基准 token 7/7

**最终裁决：APPROVED**

### 5.1 修复逐条确认（读码 + 亲跑双重验证）

| # | 修复 | 位置与机制 | 验证 | 结论 |
|---|---|---|---|---|
| M1 | worker ORT 加载 SEA 分支 execPath-only | `tinyclick-worker.ts:38-51`——`node:sea`.isSea()=true → 仅 `createRequire(process.execPath)` **无回退**；dev 路径保留裸探测+回退 | 读码 + SEA 门禁亲跑（§5.2 #4） | ✅ |
| M1 负探针证明力 | 诱饵 cwd 结构：`workDir/decoy-cwd/node_modules/onnxruntime-node/{package.json(main:index.js), index.js(加载即抛 marker)}`（`verify-tinyclick-sea.js:227-237`）；SEA exe 改以 `cwd: decoyDir` 启动（:245）；marker 文本显式断言（:265-269）。**捕获逻辑闭环**：回归（恢复裸 require）→ eval worker 从 cwd 解析命中诱饵 → 加载即抛 → smoke 无 PASS 且 marker 入输出 → 双层拦截；PASS 则结构上证明诱饵未被触碰、ORT 仅自 exe 旁钉哈希副本加载 | 读码 + 亲跑探针绿（输出「诱饵 cwd 的投毒 ORT 未被触碰」） | ✅ 探针真捕获 |
| M2 | runtime 返回值域校验 | `tinyclick-runtime.ts:171-205` validateWorkerResult——tokenIds 须 [0,51289) 整数且长度 ≤ MAX_DECODE_STEPS+1（常量 import 自 decode 单一源）；locBins 须 [0,999] 整数对或 null；point 须帧域 [0,W]×[0,H] 有限数。接线 :349-357：违规 → terminateWorker + registerFault("worker-result-invalid") + 非 disabled 回 idle + 抛 worker-error——**熔断计数接线成立** | 读码 + 负测试 4 例（runtime.test.ts:510-526：NaN/负 bin/超屏/越界 tokenId 各锁 拒+计 1 次熔断+terminate 1 次+回 idle）；既有 fake 默认 point 改 {2,2}（旧 {158,211} 对 4×4 测试帧越域，自证校验生效） | ✅ |
| M3 | dispose×warming 竞态 | `tinyclick-runtime.ts:451-456`——doPrepareInner 落地 worker/status 前查 `this.disposed`，已 dispose 则 terminate 收尸 + 拒 model-disabled | 读码 + 测试（runtime.test.ts:529-545：60ms load 延迟造窗口，锁 terminated≥1、faults=0、后续 infer/prepare 全拒） | ✅ |
| M4 | 熔断双计幂等闸 | `tinyclick-runtime.ts:546-561`——onWorkerGone 入口 `firstGone = !terminatedWorkers.has(worker)` 即 add，registerFault 仅 firstGone；pending 拒绝/置空幂等。两种双计形态均覆盖：① 崩溃 error+exit 序列（exit 无 expectedExits 再入被闸）；② 超时/值域违规主动 terminate 后尾随 error（terminatedWorkers 已含） | 读码 + 双测试：熔断测试改三次独立 worker 故障、首个 worker 追加 exit 尾随锁精确计数 1/2/3（runtime.test.ts:388-402）；「terminate 后尾随 error 不双计」（:548-556） | ✅ |
| M5 | prompt 注入面消毒 | `tinyclick-tokenizer.ts:44-47`——buildCommandPrompt 先 `/<[^>\r\n]*>/gi` 剥离再 trim/lower（/i 先于 lower 剥离大写形态）；tokenizer 本体 HF 忠实不动（1238 向量测试未改） | 读码 + 回归测试 4 断言（tokenizer.test.ts:178-195：字面/大写注入不产 50551/51268、正常命令 15 token 序列不变、`<none>` 一律剥离 fail-closed）；基准门禁亲跑 token 7/7 不受配方影响（参考命令无尖括号） | ✅ |
| M6 | 宽高比未测定维注记 | envelope §2 第 5 条——竖屏/21:9/16:9@1920 落包线内零实测如实登记，「包线通过≠命中承诺」+ reL2 兜底 + I3 观测档 | 读档（git show efa683b envelope hunk） | ✅ |
| F-1 | 基准默认时间戳输出 | `verify-tinyclick-worker.js:177-185`——默认写 `i2-worker-benchmark-*-<ts>.json`，冻结锚点仅 `--freeze`/`--json` 覆写 | **亲跑实证**：门禁绿，产出 `...-2026-07-20_12-58-02.json`（时间戳新文件），两冻结锚点 sha256 复跑前后逐字节一致（97a3d97e…/984dd136… OK），产物清理后工作树零改动 | ✅ 闭环 |
| F-2 | SEA 旁置 ps1 本体优先+漂移断言 | `verify-tinyclick-sea.js:161-189`——staging 有 `tinyclick-worker.js` 则直用 ps1 产出物本体（端到端）；缺失回退自构建 + 读 ps1 原文段（锚 `esbuild dist/computer/tinyclick-worker.js`→`--outfile=dist/tinyclick-worker.js`）逐旗帜断言四旗，段缺失/缺旗即门禁失败 | **亲跑实证**：回退路径行使（staging 无旁置）+ 漂移断言通过（输出「旗帜与 ps1 段逐字一致，漂移断言已过」） | ✅ 闭环 |

### 5.2 终审复跑记录

| # | 项 | 结果 |
|---|---|---|
| 1 | `tsc --noEmit` + `tsc -p tsconfig.test.json` | 双 exit 0 ✅ |
| 2 | computer 域套件（22 文件） | **380/380 全绿** ✅ |
| 3 | I2 四测试文件 | **47/47 全绿**（43+4 新增），与自报门禁 553→557（+4）增量吻合 ✅ |
| 4 | 门禁全量套件（package.json test 第一段） | 1579 tests / 41 fail / 1 skipped——失败全为既有 Windows 环境基线（thread/chatCreate/vault/message-router/Config 组，symlink EPERM 与时序 flaky），较上轮 47 fail 收敛，**零 computer 域失败**（grep 实证 0 条） ✅ |
| 5 | `verify-tinyclick-worker.js` | PASS：token 7/7、point {158,211}±1px；F-1 行为实证（§5.1 F-1 行） ✅ |
| 6 | `verify-tinyclick-sea.js` | PASS：isSea=true、**M1 负探针绿**、token 7/7、RSS warm 1958MB ≥ 800MB、**F-2 回退+漂移断言行使**、e2e 736ms；跑后 `%TEMP%` **零 verify-\* 残留** ✅ |

### 5.3 裁决理由

1. 对抗 M1-M6 与本评审 F-1/F-2 **八项全部修复属实**，读码行号 + 负向测试 + 亲跑门禁三重证据；无一项以文档措辞替代代码修复。
2. M1 修复同时完成了证据链自我纠错——envelope §8 勘误如实承认原断言「结构上不可被该形态证明」，改锚负探针实证；对抗评审指出的证明力缺口以**更强**的证据形态闭合。
3. M4 暴露的「3 次熔断叙事实际 1.5 次可触发」属真实可靠性缺陷，修复后熔断语义恢复 plan M3 明定形状；M2 把 plan 攻击面 3 明定的最后闸口补齐。
4. 终审复跑全绿且零残留、零工作树污染；修复批次自身未引入新偏差声明。
5. 遗留项全部为先前已声明的 I3 登记（golden 19-case 回放 harness、verify-ort-sea exit-in-try、宽高比实测、RSS 长程观测、慢机样本）——属 I3 开工清单范围，非 I2 承诺缺口，不构成 FOLLOW-UP 条件。

**I2 终审通过，可收口；I3 开工时复核上述五项登记。**

---
*WP5 I2 终审 — 修复批次 69cb04f/4ed4e31/e9a230d/efa683b 复核；业务代码零改动；亲跑证据见 §5.2。*
