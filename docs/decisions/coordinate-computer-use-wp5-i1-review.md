# WP5 I1 迭代（供应链与下载门禁）— 评审结论

> **日期**: 2026-07-20（评审时间锚点 2026-07-20T16:32:11+0800）· **评审方**: Reviewer（只读评审 + 本机亲跑复验；未改 spike 产物与业务代码）
> **被审范围**: 分支 `computer-use-w8-windows`，`3f846ee..efaed10`（8 个 WI commit + 收口标记，+5562/-8 行，28 文件）
> **基准文档**: plan I1（plan:396-425）+ 出口标准（plan:399）+ provenance §5（wp5-model-provenance.md:75-85）+ 详案对抗 M1-M7（wp5-plan-adversary.md:76-82）
> **复验方式**: tsc/门禁套件亲跑 + 两个 verify 脚本亲跑 + 门禁活体实测（真 manifest/真模型文件）+ G1 双臂重跑 + 逐文件读码，证据见 §1/§2

## 裁决: `APPROVED WITH FOLLOW-UPS`

I1 的承重安全语义**全部经独立复验成立**：TOCTOU「校验即加载同 buffer」结构性成立且无二次读盘路径（§2.1）；manifest 信任锚闭环（网络源拒绝活体实测、镜像哈希不可配、占位主机 fail-closed，§2.2）；下载器 §C.2 全项落实（§2.3）；62MB 裁剪白名单正确且 verify-ort-sea 冒烟门禁亲跑全绿（§2.4）；G1 包线常量为 fail-closed 上限、校准曲线算术全部吻合、双臂命中名单重跑复现（§2.5）；M2/M4/M7 落到实物（§2.6）；license 双引与 notice 单一真源逐字节锁定（§2.7）。5 条 FOLLOW-UP 均为文档精度/明示声明类，无 MUST-FIX。G6 OOD 采集按 M4 诚实态挂为 owner 开口项并带 I3 围栏，处置正确。

---

## 1. 亲跑验证记录

| 验证项 | 结果 | 证据 |
|---|---|---|
| `tsc --noEmit` | exit 0（与自报一致） | 本机亲跑 |
| 门禁套件全量 | 1526 tests / 45 fail——**全部为既有 Windows 环境失败**（symlink EPERM、Unix socket EACCES、POSIX 0o600 `438!==384`），分布在 adapter/daemon-lock/vault/message-router 等非 I1 文件；config.test.js 2 条失败位于 I1 追加段（:494）之前的既有用例（:280/:426），I1 零回归 | /tmp/gate-run.log |
| I1 范围测试 | computer-model-{download,license,manifest,states} **51/51 全绿**；config.test.ts I1 新增 4 用例全绿 | 本机亲跑 |
| `verify-tinyclick-vendor.js` | **exit 0**，vendor 三文件 + LICENSE 哈希全中；三文件哈希与 manifest `provenance.exportVendor` 逐值一致（单一登记源实证） | 亲跑输出 |
| `verify-ort-sea.js` | **exit 0 全绿**：按 ps1 白名单复刻最小 staging（61.4MB ≤70MB）→ SEA exe 组装 → `createRequire(execPath)` 加载 ORT 1.27.0 → dummy 推理 [1,2,3]→[2,3,4] PASS | 亲跑输出 |
| 真 manifest 活体 | `loadModelManifest('models.manifest.json')` 过 schema；`https://` 源拒绝 `manifest-source-remote`；镜像带 path/query → 剥至 origin + loud log；`http://`/`file://` 镜像均 `mirror-scheme-denied` | 亲跑输出 |
| 校验即加载活体 | 真 `onnx-hybrid/encoder_model.onnx`（43,662,734 B）按登记值验证通过并返回同 buffer；size+1 → `model-size-mismatch`；错哈希 → `model-hash-mismatch`；缺文件 → `model-file-missing` | 亲跑输出 |
| 模型文件哈希 | onnx-hybrid 四图 + onnx-int8 vision 本地 sha256 复算，**5/5 与 manifest 登记逐值一致**（9cc57629/b59e88b7/88e5b847/af096239/895011bd） | sha256sum 复算 |
| G1 双臂重跑 | hybrid golden 命中名单 {f-help-zh, f-icon-en, f-long-zh}=3/19、延迟中位 666ms；int8 {+f-ok-en}=4/19、中位 1130.5ms——**与 wp5-envelope.md §3.3 记录完全一致** | 亲跑 g1-envelope-scan.js |
| 自报「504/504」口径 | 全量 1526 中 45 条环境失败为既有基线（非 I1 引入）；「453→504 只增」与实测增量吻合（computer 51 条全绿） | 对账成立 |

## 2. 评审重点逐项

### 2.1 TOCTOU 不变量 — 结构性成立

`loadVerifiedFileBytes`（model-manifest.ts:187-219）：单次 `readFile` → 同 buffer 上 size 校验（:205）→ 同 buffer 上 sha256（:211）→ **返回同一 buffer**（:218）。全仓无「按路径校验、再按路径加载」两段式；无任何「已校验」缓存，每次加载重读复验（:185-186 注释即契约）。全仓搜 `InferenceSession` 零命中——ORT 接线属 I2/I3，当前无生产调用方可能违反「buffer 直交 session」契约；`downloadModelVariant`/`loadVerifiedFileBytes` 的唯一引用方是自身模块与测试（无定时器、无启动网络行为，model-download.ts:16-17）。**I3 集成验收须复验「session 创建入参即校验过 buffer」这一接线事实**（已列入 F-5）。

### 2.2 manifest 防篡改 — P1 攻击面 1 闭环

- **信任锚**：manifest 入库 git 跟踪、只随发版更新（plan:402）；运行时 `loadModelManifest` 拒绝一切 scheme://、UNC、// 源（model-manifest.ts:102, :130-139，活体实测拒绝码正确）。「更新 manifest 偷换哈希叙事」通道在入口关闭。
- **schema**：三要素 {url(https-only), sha256(64-hex), size} + revision(40-hex commit) + 变体齐全性必须含 hybrid，全 `.strict()`（:41-91）。
- **镜像可配主机、哈希不可配**：`resolveDownloadUrl`（:152-173）仅取 mirror origin，path/query/fragment 忽略并 loud log；**登记 url 自身的 query/fragment 同样丢弃**（:149-150, :171-172）——双向参数注入面都关了。活体实测：`https://hf-mirror.com/sneaky?x=1` → `https://hf-mirror.com/tinyclick/...`（path 保留自 manifest）+ loud log ✓。
- **占位如实**：全量 url 主机 `models.cmspark.invalid`（RFC 2606，manifest:28 等），host 未定前任何下载只会 `network-error` 审计落地（variant-decision.md:39）——fail-closed。
- **config 双层防线**：`modelMirror`/`modelDiskBudgetMB` normalize 非法值 coerce + loud log（config.ts:330-344），scheme 白名单下载时强制执行（注释 :327-329 明示分层）。

### 2.3 下载器 — §C.2 全项落实

流式哈希（model-download.ts:118-124，366MB 文件不全量入内存）；**下载前**预算检查（:177-186，注释明示「下载后检查会被塞盘 DoS」）+ statfs 卷余量（:189-196）；stale .part 四态（meta 缺失/url/revision/sha256 漂移/超 24h :36, :217-237）且**续传不刷新 startedAt**（:239——防计时洗白，细节正确）；Range 续传 206 校验、200 回退重写、416 删片重下（:306-323）；复验失败删 .part 不留篡改续传基础（:260-274）；原子 rename（:275 同目录同卷）；全程 `computeruse.model.unavailable {reason}` 审计（:159-162）；失败永不阻塞其他定位层（:14-15 + 三态文案 §2.7）。测试侧 4 条 stale 用例（computer-model-download.test.ts:369/387/405/423）+ 阈值量级断言（:525）——M7 的 stale 部分闭环。

### 2.4 62MB 裁剪与冒烟门禁

- **白名单内容正确**：ps1 只拷 `package.json + dist/ + bin/napi-v6/win32/x64/* + LICENSE`（build-windows-exe.ps1:264-281），明示排除 lib/（TS 源）与 darwin/linux。本机实测源包 `bin/napi-v6/` 含 darwin+linux+win32（259MB），win32 下还有 **arm64 67MB**——ps1 精确到 `win32\x64\*` 而非 `win32\*`，若写错一级目录将多带 67MB，此关键点实现正确；x64 内容 = 4 dll + .node 共 62MB，与 S-2 实测 62.5MB 吻合。70MB 硬预算断言（:280）+ onnxruntime-common 运行时依赖防漏（:283-293）+ THIRD_PARTY_NOTICES 缺失即 Fail（:297-303）。
- **verify-ort-sea.js**：消费 staging（不重复实现白名单，verify-ort-sea.js:5-8 注释）→ 断言无 darwin/linux（:100-105）+ ≤70MB（:108）→ SEA 组装 → dummy 推理。**亲跑全绿**（§1）。挂接口径：plan:413 明定「手动/发版门禁」——不进 CI 符合 plan；但 variant-decision.md:34 的发版本机门禁清单只列了 vendor 校验与 golden harness，**漏列 verify-ort-sea**（F-3）。
- esbuild `--external:onnxruntime-node`（ps1:93）与 CI --strict（ci.yml:31-34）/postinstall（package.json:23）挂接 vendor 校验 ✓；onnxruntime-node ^1.27.0 与 S-2 验证版本一致 ✓。

### 2.5 G1 包线常量与校准曲线

- **MAX_PROMPT_TOKENS=38 证据强度**：核验 `g1-cases.json`——19 case 的 prompt_tokens 最大值恰为 38（len-31-ok），**>38 的英文 case 从未被扫描**。故 38 是「实测命中的最大值」型 fail-closed 上限（拒绝未测区域），方向保守、可用；但 envelope.md:20「>38 在英文包线内无命中证据」的措辞隐含「测过未中」，实为「未测」，需勘误（F-2）。边界参差（hybrid 在 tok 12/15 两档 MISS）已如实披露（§3.1），常量不依赖「边界干净」成立。
- **校准曲线算术**：分桶表 n=38/臂、合并 76，逐格百分比复算全中（7/7=100%、9/11=81.8%、16/18=88.9% 等）；双臂均单调（100→27.8→7.7；81.8→47.1→10）。「无干净截断」如实披露（[-2,-1) 混合区、int8 [-1,0] 混入 2 个 OOD MISS、f-long-zh 深低分命中例外 §4.3）；n=76 不足定阈值、M2 不定阈值纪律（envelope.md:5, :86）与 plan:485 置信度契约（未校准徽标）对齐 ✓。
- **「歧义选错目标」机理与 L2 论证**：hybrid/fp32 对无位置限定短命令稳定误选 btn_help（809px 系统性 MISS），加位置限定后双臂全中同点——机理实测成立（envelope.md:66，与 S-3 退化点模式互证）。论证强度恰当：doc 只主张「L2 人审必要性获实测支撑」，未主张「L2 充分」；且同时披露 locLP 无法分离歧义误中（§5）——不过强 ✓。
- **变体差异诚实登记**：int8 更稳（8/8 vs 6/8）但慢 ~59%，登记为 B8 修订输入且不改决策、机理标注未证实（:67）✓。§3.3 主动纠正跨臂锚引用（f-ok-en 3.6px 属 int8 臂）✓。
- **双臂重跑复现**：见 §1——命中名单与延迟量级均复现，G1 数据可信。

### 2.6 M1-M7 落实抽查（wp5-plan-adversary.md:76-82）

| 修正 | 落点 | 核验 |
|---|---|---|
| M2（G1 收窄为常量导出、验收锚定冻结基线） | envelope.md:5 + plan:485 | ✅ 全文无阈值主张，校准读法三條皆「不定阈值」 |
| M4（发布链流程 + host 显式外部依赖） | variant-decision.md §2/§3 | ✅ 2FA/双人 review/重登记走 PR/同一次提交/fake fetch E2E/首日任务全有；诚实态「代码完成、E2E 待 host」（:41） |
| M7（stale .part 测试） | model-download.ts:217-237 + 4 测试 | ✅（ready/busy 与三层开关部分落 WI-3.2/3.4，属 I3，非本迭代） |
| M1/M3/M5/M6 | WI-2.x（I2） | ➖ 非 I1 范围；M6 的 hybrid@4 补测已排 WI-2.3（plan:433），与本评审 §3 观察-2 衔接 |

### 2.7 license 门

- **双引一致性**：门文案直接引文与 provenance 原文逐词一致——Ethics 节 "We have made our model checkpoint and code accessible under the MIT license"（model-license.ts:84 vs provenance:65）、Florence-2 "Florence2 model is available under MIT license"（:86 vs :65）、数据集 "explicitly allow research use"（:95 vs :65）；Samsung 版权行字节一致（:38 vs :66）。转述不挂引号、引文带出处，排版纪律与文件头声明（:3-6）一致。
- **实测披露**：门文案 S-3 冻结数字（13.3% 含巧合 / 0/5 Wilson 上界 29.9% / 4 核 2.8-3.3s，:100-102）与 S-3 REPORT 及 S-3 评审复算一致 ✓；「完整性 ≠ 来源」明示（:109-110）✓；L2 必经条款（:108）✓。
- **单一真源**：`THIRD_PARTY_NOTICES_TEXT`（:46-73）与 companion/THIRD_PARTY_NOTICES 逐字节一致由测试强制（computer-model-license.test.ts:86-90，51/51 绿）；notice 含双方 MIT 全文 + 版权行（THIRD_PARTY_NOTICES:18-38, :40-67）；入包路径 ps1 缺失即 Fail ✓。

## 3. 发现清单

| 编号 | 严重度 | 发现 |
|---|---|---|
| F-1 | FOLLOW-UP | variant-decision.md:13「705MB（704,678,632B 实测）」字节数与登记值不符——manifest 四图合计 **704,780,632 B**（含 tokenizer 707,078,593 B），文中数字错位（780→678 转置）；registry 本身自洽，仅决策记录括号值需勘误 |
| F-2 | FOLLOW-UP | envelope.md:20「>38 在英文包线内无命中证据」措辞过强——实测 case 集 token 上限即 38（g1-cases.json 复算），>38 从未扫描；上限为 fail-closed 语义（拒未测区），应写明「未测」而非「无命中证据」 |
| F-3 | FOLLOW-UP | variant-decision.md:34 发版前本机门禁清单漏列 `verify-ort-sea.js`（plan:413 明定的 B7 手动/发版门禁）；发版 checklist 应补上 |
| F-4 | FOLLOW-UP | plan:408-410（WI-1.3）的「ORT dll 钉哈希 + `verify-onnxruntime.js` CLI + 改 1 字节 dll 负测试」未交付——交付将校验并入 model-manifest.ts 且只覆盖模型文件。威胁模型上 dll 旁 exe 放置、可写安装目录即可换 exe，边际价值为纵深防御，不构成 MUST-FIX；但属 plan 明文项的静默偏离，应修订 plan 明示放弃或补登记 WI（provenance:99 的「vendor 后重跑 S-1 导出回归」亦无独立运行记录——verify 脚本头注释称已跑且哈希逐字节一致，与 manifest fp32 登记值（af096239/b59e88b7）自洽，建议补一句「字节同一性经钉哈希持续强制」的明示声明闭环） |
| F-5 | FOLLOW-UP（I3 门禁） | ① G6 OOD 采集 owner 开口项保持围栏：未入库前 I3 验收不得宣称 OOD 覆盖完整（plan:398 已置）；② I3 集成验收须复验「ORT session 创建入参即 `loadVerifiedFileBytes` 返回 buffer」的接线事实（当前无生产调用方，契约靠 I2/I3 落地） |
| 观察-1 | — | commit 的 WI 编号与 plan 编号有漂移（如 commit WI-1.4=vendor vs plan WI-1.4=裁剪），内容映射完整无歧义，不影响验收 |
| 观察-2 | — | 跨批延迟不可比已有案：S-3 记录的 fp32 1821ms @8线程为热节流批（ADDENDUM.md:22「结论以同批对照为准」），本评审安静环境复测 hybrid 666ms/int8 1130ms 与 G1 批一致；variant-decision 的 736ms 采自安静批，决策不受节流批影响；I2 WI-2.3 hybrid@4 补测须同批对照 |

## 4. 结论

I1 出口标准（plan:399）逐项判定：manifest 入库 ✅（活体过 schema）；下载/校验/裁剪全链路带负测试 ✅（51/51 + 活体三态）；G1 包线数据与校准曲线入库 ✅（重跑复现）；G6 OOD case 入库 ⏸（owner 采集，M4 诚实态 + I3 围栏已置）。裁决 **APPROVED WITH FOLLOW-UPS**：5 条跟进项均为文档勘误/明示声明类，不阻塞 I2 开工；G6 围栏与 I3 复验点已登记。

---

# 终审（修复循环四批收口后）

> **日期**: 2026-07-20（终审时间锚点 2026-07-20T18:14:35+0800）· **评审方**: Reviewer（只读 + 亲跑复验；未改业务代码）
> **被审范围**: `efaed10..e3af8b8`（4 个修复 commit：M1 流内截流 / M2 stat-first + M5 幂等 / M3 全局核算 + M4 G1 防自毁 / F-1~F-4 勘误 + M6 nit 捆，+359/-80 行）
> **对抗基准**: `coordinate-computer-use-wp5-i1-adversary.md`（P1-a/P2-a/P3-a/P3-b/P3-c + P4×6，裁决 SOUND WITH MANDATORY FIXES）

## 最终裁决: `APPROVED`

必修项 M1（MEDIUM）与 M2（LOW-MED，I2 接线前）修复经代码级与活体双重验证为真修复；M3-M6 与初审 F-1~F-4 全部逐条闭环；亲跑 tsc 0 错、I1 范围 57/57 全绿（与自报一致）、vendor --strict exit 0、stat-first 探针 0ms 干净拒绝。初审 F-5 两条为 I3 前向登记项（非 I1 跟进），维持登记。I1 无遗留阻塞项。

## 逐条确认表

| 项 | 判定 | 核验证据（行号为修复后当前值） |
|---|---|---|
| **M1**（P1-a，MEDIUM）超限流截流 | ✅ 真修复·中途截断 | 第一道 Content-Length 零写盘预检（model-download.ts:374-379）；第二道 data 监听 `received > expectedSize` 即 `source.destroy`（:389-396）——截断在流内中途非流尽后，落盘有界于 size+ε（注释 :383-386 如实声明）；截断后清理 part+meta（:280-284）；新 reason `oversize-stream`（:59）入文案表（model-state-messages.ts:96-102，「传输中途截断并清理」）。回归测试实证 `route.cancelled === true` + 进度峰值 <100KB≪8MB + 单请求内截断（computer-model-download.test.ts:366-398） |
| **M2**（P2-a）stat-first 预检 | ✅ 真修复·同 buffer 兜底不动 | stat→size→readFile→**buffer 上仍复比 size**（model-manifest.ts:199/:211/:230）→ 同 buffer sha256→返回同 buffer；stat→read 替换窗口在注释明示并以 buffer 级 size+hash 双兜底（:187-189）；stat→read 间 ENOENT 归一缺文件态（:217-224）。活体探针：3GB 稀疏文件错尺寸 **0ms** 干净拒绝（修复前须全量读入） |
| **M3**（P3-a）预算全局核算 | ✅ 真修复·无新误拒 | `budgetDir = dirname(destDir)` = models/ 根（:189-190）+ `dirOccupiedBytes` 改递归（:139-148）；兄弟变体场景演算：双变体在盘 1137MB + 重拉 hybrid 705MB = 1842MB < 默认 2048MB（最坏现实组合仍通过），旧文件双计为保守方向并已注释声明（:186-188）；文案对齐「全部变体合计」（model-state-messages.ts:67）；兄弟变体计入有测试（computer-model-download.test.ts:655） |
| **M4**（P3-b）G1 冻结文件防自毁 | ✅ 真修复 | 输出按变体分名（g1-envelope-scan.js:27-29：hybrid→`g1-envelope-result.json`、int8→`-int8.json`），头部注释明示「默认输出即冻结文件、更新须显式提交」（:10-14）；REPORT.md:87 复跑说明同步；冻结两文件当前与 HEAD 干净一致 |
| **M5**（P3-c）幂等重下跳过 | ✅ 真修复 | 在盘文件 size+sha256 双中 → 清理残留 part/meta + `continue` 零 fetch（:225-235）；哈希不符落回正常重下；零 fetch 测试 ×2（:589/:615） |
| **M6**（P4 nit 捆 ×6） | ✅ 5/6 落地，1/6 既有明示维持 | ① Content-Range 偏移注释明示「sha256 兜底自愈、真实链路演练复核」（:366-368）；② `redirect:"manual"` + 3xx/opaqueredirect 归一 http-error（:332/:352-356）；③ meta.size 纳入 stale 判定（:249）；④ name 限 basename regex（model-manifest.ts:45）+ 四向量逃逸测试（:177-186）；⑥ CRLF 修复建议补 zip 用户路径（verify-tinyclick-vendor.js:123-124）。⑤ LICENSE 第二登记源：未改动——脚本头 :38-41 既有例外注释（schema 只覆盖三代码文件）+ 对抗文档 :34 已注明，「文档明示例外」实质已满足，nit 级维持可接受 |
| **F-1** | ✅ | variant-decision.md:13 改「704,780,632B（manifest 四图合计；含 tokenizer 共 707,078,593B）」——与初审复算值逐位一致 |
| **F-2** | ✅ | envelope.md:20 改「**>38 从未被扫描**……fail-closed 上限（拒绝未测区域），非『测过未中』」——语义勘误到位 |
| **F-3** | ✅ | variant-decision.md:34 发版本机门禁补 `verify-ort-sea.js`（plan:413 B7 手动/发版门禁） |
| **F-4** | ✅ | plan:411 增「I1 收口勘误」明示 dll 钉哈希 CLI 未交付 + 威胁模型不闭合论证；provenance:99 补执行记录——**核验实物 s1 ADDENDUM:55-66**：vendored 重导四图 sha256 与 S-1 原物字节级一致（af096239/b59e88b7/2127af82/012cdafe）+ token parity 逐位一致，回归真实发生过且有案 |

## 终审复跑记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | exit 0 |
| 门禁套件全量 | 1532 tests / 1487 pass / 44 fail——失败全部为既有 Windows 环境集（symlink EPERM、Unix socket EACCES、POSIX 0o600）与时序 flaky（chat/thread/message-router），与上轮基线同类；**零 I1 相关失败** |
| I1 范围四文件 | **57/57 全绿**（与自报一致；上批 51→本批 57，净增 6 条修复回归） |
| config.test.js I1 段 | 「computer 模型下载字段 normalize」✔（仅 2 条既有 0o600 环境失败维持） |
| `verify-tinyclick-vendor.js --strict` | exit 0，4/4 文件哈希全中 |
| stat-first 活体探针 | 3GB 稀疏文件错尺寸拒绝耗时 **0ms**（model-size-mismatch） |

## 终审补充观察（非阻塞）

- **name 正则残余面有界**：`/^[^/\\]+$/` 不拦裸 `".."`，但 `path.join(destDir,"..")` 仅达 models/ 根（DATA_DIR 内），真逃逸需含分隔符的多级路径（已拦）；且触发前提是 manifest 信任锚先失守——纵深防御项，不计发现。
- **M3 双计语义**：预算核算把在盘旧文件与本次总量重复计入（fail-closed），最坏现实组合 1842MB 仍低于默认 2048MB；若用户自定义预算 <1842MB 且双变体在盘时重拉，可能误拒——可调预算规避，文案已明示「可调大预算或删除其他变体」，可接受。
- **全量套件 flaky 集波动**：两轮全量跑失败名单有个体互换（时序敏感），均非 I1 文件；建议后续迭代另立 flaky 治理项，不属本评审范围。

## 终审结论

对抗裁决 SOUND WITH MANDATORY FIXES 的全部必修与建议项、初审 F-1~F-4 勘误，经逐条代码核验 + 活体探针 + 套件复跑确认**全部闭环**。I1 迭代终审 **APPROVED**：供应链与下载门禁可按 plan 进入 I2（ORT worker 推理主干）；前向登记项维持两条——G6 网易云 OOD owner 采集围栏（I3 验收不得宣称 OOD 覆盖完整）、I3 集成验收复验「session 入参即校验过 buffer」接线事实。
