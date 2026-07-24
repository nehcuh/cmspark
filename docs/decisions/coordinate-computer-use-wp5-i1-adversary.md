# WP5 I1 实现（供应链与下载门禁）— 对抗审计

> **日期**: 2026-07-20（时间锚点 17:18 +0800，本机 `date` 实测）
> **审计方**: Adversary——攻击对象是实现本身（代码级对抗面、状态一致性、防线兑现度），不是计划
> **被审材料**: `23ca94f..36b3eab` 8 commit（+收口 `efaed10`）——model-manifest.ts / model-download.ts / model-license.ts / model-state-messages.ts / verify-tinyclick-vendor.js / verify-ort-sea.js / build-windows-exe.ps1 / ci.yml / config.ts / models.manifest.json / wp5-envelope.md / wp5-variant-decision.md / 4 测试文件
> **亲跑验证**: `tsc --noEmit` exit 0；I1 四测试文件 **51/51 绿**（本机亲跑，与评审一致）；`verify-tinyclick-vendor.js --strict` exit 0（4 文件哈希全中）；超限流探针（本机实证，见 P1-a）；G1 工作区漂移逐行核验
> **纪律**: 只读 + 探针（临时目录，已清理）+ 写本文档；不改业务代码、不改 spike 产物
> **不重复报**: 评审 F-1~F-5、详案对抗 M1-M7、TOCTOU 同 buffer、manifest 信任锚、62MB 白名单、G1 常量证据强度——均已复核成立；45 个既有 Windows 环境失败非 I1（评审 §1 已核定）

## 裁决: `SOUND WITH MANDATORY FIXES`

I1 的承重安全语义经独立攻击复测**成立**：镜像解析只取 origin、path/query 双向剥离（model-manifest.ts:152-173），同源不同路径注入无攻击面；崩溃中点状态机自洽（分片已齐未 rename 零请求复验、孤儿 meta 自愈、最终裁决权在加载侧每次复验）；notice 入包接缝（ee62c78 拷贝 × 35ab981 单一真源 × 测试字节锁）闭合；vendor 钉哈希挂接链（CI --strict + postinstall warn-only + export_onnx.py 导出断言）与 systray2 先例一致；G1 的 MAX_PROMPT_TOKENS=38 明确定案为**层内拒绝**语义（envelope.md:20），截断风险在 I1 层面不存在。

**但下载器有一条必修**：「防塞盘 DoS」的预算前置检查只约束 **manifest 申报字节**，对**线路上实际流出字节**无中途截流——恶意/故障镜像可写穿磁盘（本机实证 8389× 申报量）。完整性不失（哈希兜底），但 §C.2 攻击面提示 5 的防线被部分绕过，修复廉价（流内截断）。鉴于 ① host 未上线前该路径无真实触发面（variant-decision.md:39 fail-closed 诚实态）② 完整性链与其余全项经攻击复测无损——不判 FLAWED；但它是头条防线（下载器头注释 :11 自证）的实证缺口，**必须在真实 host 上线 / I3 WS 接线（WI-3.4 提供用户触发面）之前修复**——不判 SOUND。

---

## 攻击角逐项裁决（任务书 6 角 + 自挖）

### 角 1 · 下载器对抗面 —— 镜像注入闭环；崩溃一致性闭环；超限流失守（P1-a）

- **镜像 path/query 剥离**：`resolveDownloadUrl`（model-manifest.ts:152-173）仅取 `mirrorUrl.origin`，path/query/fragment 忽略并 loud log；登记 url 侧 query/fragment 同样丢弃（:171-172）。`evil.com/model/../../x` 类注入**无承接面**——路径唯一来自 manifest（git 信任锚），`new URL().pathname` 还会归一化 dot 段。**闭环**。
- **崩溃中点状态一致性**：无独立「下载完成」标记——完成态 = 最终文件存在，加载侧每次全量复验（manifest.ts:187-219）是最终裁决；崩在 rename 前 → 分片已齐则零请求直接复验 rename（download.ts:255）；崩在 rename 后 meta 未删 → 孤儿 meta 下次自愈（:223-233）。rename 同目录同卷（:275）。**闭环**。
- **超限流（P1-a，实证）**：`downloadOne` 的 pipeline（:336）对 body 字节数**无上限**，size 检查在流尽之后（:260）。探针：申报 1000B、线路吐 8MB → **8,388,608B 全量写盘**后方以 size-mismatch 拒绝（超收 8389×）。预算前置检查（:177-186）只按 manifest `totalSize`（:173）核算——「下载后检查会被塞盘 DoS」（:11）的防线对「线路上多吐字节」不成立。触发面：用户被社工配置恶意镜像（modelMirror 是合法配置项）或 host 被攻破/故障——与下载门禁的防御对象同一 actor。

### 角 2 · 校验器 —— size 顺序倒置（P2-a）；buffer 驻留闭环

- **size/sha256 顺序**：`loadVerifiedFileBytes` 先 `readFile` 全量入内存（manifest.ts:193）**再**比 size（:205）——路径上被放置超大文件时，内存耗尽先于干净拒绝。威胁面限于本地可写 `~/.cmspark-agent/models/` 的 actor（能改配置的同等级），且当前**无生产调用方**（I2/I3 接线）——定 LOW-MED，I2 接线前必修。buffer 驻留：单图最大 366MB 一次一文件，头注释（:181-184）论证成立，ORT 接线后的峰值复核归 I2（观察 O-3）。

### 角 3 · vendor 钉哈希 —— 三个候选全闭环（一处叙事例外入 P4）

- **zip 分发**：vendor/.gitattributes 钉 `*.py text eol=lf` + `LICENSE text eol=lf`；git archive（GitHub zip）应用 eol 属性 → zip 内即 LF。**闭环**（CRLF 诊断的 `git checkout` 修复建议对 zip 用户无效，入 P4 nit）。
- **postinstall × SkipInstall**：postinstall（package.json:23）不带 `--strict` → warn-only 不阻断，与 verify-systray2.js:9/:142 **先例一致**；阻断位在 CI --strict（ci.yml vendor 步）+ export_onnx.py 导出断言（d834e1e 从 manifest 读钉值，消第二登记源）。ps1 SkipInstall 分支注释（:55）如实声明。挂接链语义自洽。**闭环**。
- **叙事例外**：verify-tinyclick-vendor.js:41 的 `LICENSE_SHA256` 是脚本常量——头注释「one registry, no drift」实际有第 4 个哈希在登记源外（已注明原因）。入 P4 nit。

### 角 4 · license 门 —— notice 接缝闭合；文案时机属 I3

- ps1 拷贝 `companion/THIRD_PARTY_NOTICES` 入 staging、缺失即 Fail（ps1:297-303）；测试强制文件与 `THIRD_PARTY_NOTICES_TEXT` 常量逐字节一致（35ab981 单一真源）。两 commit 接缝**闭合**。「首次启用才显示」的呈现时机是 WI-3.4（I3）范围，I1 只交付文案与 notice——**非本迭代缺口**；I3 须保证接受后可再查阅（入观察 O-4）。

### 角 5 · verify-ort-sea —— dummy 证明链接、不证明尺寸级（观察 O-1）；CI 挂接合 plan

- dummy_add.onnx（[1,2,3]→[2,3,4]）证明的是 `createRequire(execPath)` + dll 解析 + SEA 组装链路；**真实 705MB 模型 × SEA exe × 836MB RSS 全程未测**（S-2 教训：尺寸类 gap）。plan:413 本就明定「dummy 冒烟、手动/发版门禁」，故非 I1 缺陷——但尺寸级缺口必须在 I2 收口前闭合（观察 O-1/O-3）。不进 CI 符合 plan:413；发版清单漏列已由 F-3 登记，不重复。

### 角 6 · G1 MAX_PROMPT_TOKENS=38 —— 拒绝语义已定案，截断面在 I1 不存在

- envelope.md:20 明定「超出**层内拒绝**（`tinyclick-envelope:too-long`）」——拒绝而非截断，I3 常量输入语义无歧义。**闭环**；I3 须补「>38 token 输入永远得不到推理结果」的负测试（防实现退化为截断，截断 = 静默改语义 = 坐标错位），入 I3 围栏（观察 O-4）。

---

## 发现清单

### P1-a（MEDIUM，必修）下载器对超限流无中途截流——预算前置防线被绕过

- **一句话**：`downloadOne` 流式写盘无字节上限（model-download.ts:336），服务端吐超申报量时全量落盘后才以 size-mismatch 拒绝（:260）——本机探针实证 8MB/1000B（8389×）；「防塞盘 DoS 必须下载前检查」（:11）只核算 manifest 申报字节（:173/:179），恶意镜像（合法配置项，社工面）或故障 host 可写穿磁盘。
- **证据**：探针输出 `over-stream ratio = 8389x declared size accepted before rejection`（fake fetch 8MB vs 申报 1000B；`.part` 事后清理正常）。
- **为何必修**：这是下载器自证的头条例防线（§C.2 + plan 攻击面提示 5）；完整性虽由哈希兜底，可用性缺口与门禁防御对象同源。修复窗口：真实 host 上线 / I3 WS 接线前（当前无生产触发面，variant-decision.md:39）。
- **怎么修（M1）**：流内计数 `received > f.size` 即 abort（删分片、reason 复用 size-mismatch 或新增 `oversize-stream`）；有 Content-Length 时先比对再开写；回归测试 = 超限流在 ~size+ε 处截断且 fetch 被中止。

### P2-a（LOW-MED，I2 接线前必修）`loadVerifiedFileBytes` 先全量读盘后比 size

- **一句话**：manifest.ts:193 `readFile` 先于 :205 size 校验——模型路径上的超大文件先吃内存再被拒，干净拒绝变内存耗尽。
- **缓解**：写入面限于本地同级 actor（能写 models 目录者本可删配置 DoS）；当前无生产调用方。
- **怎么修（M2）**：`stat` 先比 size（不符即 `model-size-mismatch` 拒），再读盘、**buffer 上再比一次 size + sha256**（保 TOCTOU 同 buffer 契约不动）。

### P3-a（LOW）磁盘预算 per-variant 与「双变体 2048MB」叙事 2× 偏差

- **一句话**：`DEFAULT_DISK_BUDGET_MB` 注释自称「hybrid 705MB + int8 432MB **双变体** + 余量」（download.ts:38）、测试名复述（computer-model-download.test.ts:523），但 `dirOccupiedBytes(destDir)` 只核当前变体目录（:178）——双变体各享 2048MB，实际封顶 **4096MB**，是文档值的 2 倍。
- **怎么修（M3）**：要么按 `models/` 根目录核算占用（真全局预算），要么把注释/测试/文案（model-state-messages.ts:66）改为「每变体预算」；二选一，叙事与实现必须一致。

### P3-b（LOW）G1 冻结数据工作区漂移 + 复跑流程自毁冻结文件

- **一句话**：收口提交后，`g1-envelope-result.json`（hybrid 臂）在工作区**被删**、`g1-envelope-result-int8.json` 被改写（逐行核验：仅 totalMs 抖动，测量值未动）且**均未提交**——成因是脚本固定写同名输出、int8 臂靠「人工改名」（envelope.md:14 自证），复跑即覆盖另一臂冻结文件；M2 锚定叙事（冻结产物在 git）当前靠 36b3eab 历史保住 hybrid 臂，HEAD 工作区已不完整。
- **怎么修（M4）**：立即恢复/重建两臂冻结文件并提交（或明示重跑重提交）；`g1-envelope-scan.js` 增输出路径参数（按 variant 分名），头注「复跑不得覆盖已提交冻结文件」。

### P3-c（LOW）幂等重下 = 成功后再次触发全量重拉 705MB

- **一句话**：`downloadModelVariant` 不查 destPath 既有文件——分片缺失即 resumeFrom=0 全量重下（download.ts:215-242），用户点两次「下载」= 1.4GB 流量与一倍磁盘写放大；预算检查按 `occupied+totalSize` 保守放行（:179），不拦截此浪费。
- **怎么修（M5）**：destPath 存在且 streaming sha256 命中 → 跳过该文件（校验成本秒级，哈希钉死无完整性损失）；补「全变体已在盘 → 零 fetch」测试。

### P4（nit 捆，均 fail-closed 或无现实触发面）

1. **206 Content-Range 未校验**（download.ts:315 只比状态码）——偏移错误的续传体会拼错文件，哈希兜底后自愈（删片重下）；建议校验或注释明示「哈希兜底」。
2. **fetch 无 redirect 策略**（:296 默认 follow）——302 跳 http 降级只损可用性（哈希兜底）；建议 `redirect:"error"` 或注释明示。
3. **meta.size 死字段**（:96 写入、:217-222 不比）——sha256 已钉，功能冗余；建议删除或纳入 stale 判定。
4. **schema `name` 未限 basename**（manifest.ts:43）——`path.join(destDir, f.name)`（download.ts:209）理论上可目录逃逸，唯触发需 manifest 信任锚先失守；纵深硬化建议 regex 禁 `/\\`。
5. **LICENSE_SHA256 第二登记源**（verify-tinyclick-vendor.js:41）——与「one registry」叙事例外；建议入 manifest schema 或文档明示例外。
6. **CRLF 修复建议对 zip 用户无效**（verify-tinyclick-vendor.js:122 `git checkout`）——补一句「无 git 时重新下载 zip」。

---

## 残余风险声明（观察项，非本迭代缺陷）

- **O-1**：verify-ort-sea 的 dummy 冒烟证明链接链路，不证明真实 705MB 模型可加载于 SEA exe——**I2 出口标准须含「真模型 × SEA exe 加载 + RSS/延迟复测」**（S-2 尺寸级教训；与 F-5② 的 buffer 接线复验同窗口）。
- **O-2**：postject@1.0.0-alpha.6 经 `npx --yes` 运行时拉取（verify-ort-sea.js:170-175 / ps1:158）——S-2 沿袭的构建期供应链面，npm 完整性以外无钉死；I1 未引入、未恶化。
- **O-3**：真模型 × worker × SEA 的内存峰值（366MB buffer + ORT arena）与 hybrid@4 延迟补测归 I2（WI-2.1/2.3，M6 已排）。
- **O-4**：I3 围栏重申——G6 OOD 未入库前不得宣称覆盖完整（F-5①）；`>38 token` 须负测试证明**拒绝不截断**；license 文案接受后可再查阅入口。

## 修正清单

| 编号 | 严重度 | 窗口 | 内容 |
|---|---|---|---|
| **M1** | MEDIUM（必修） | host 上线 / I3 WS 接线前 | 下载流内截流 + Content-Length 预检 + 超限流回归测试（P1-a） |
| M2 | LOW-MED | I2 接线前 | 校验器 stat-first size 预检，保同 buffer 契约（P2-a） |
| M3 | LOW | I2 | 磁盘预算语义对齐（全局核算 or 每变体叙事）（P3-a） |
| M4 | LOW | 立即 | G1 冻结文件恢复 + 复跑输出分名（P3-b） |
| M5 | LOW | I2 | 已在盘文件哈希命中跳过下载（P3-c） |
| M6 | LOW（nit 捆） | 随对应项 | Content-Range/redirect/meta.size/name 约束/双登记源/zip 建议（P4×6） |

---
*WP5 I1 实现对抗审计 v1.0 — 裁决：SOUND WITH MANDATORY FIXES（M1 必修于 host 上线/I3 接线前；M2 必修于 I2 接线前；M3-M6 进对应迭代清单）*
