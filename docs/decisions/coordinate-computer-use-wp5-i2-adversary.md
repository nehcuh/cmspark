# WP5 I2 实现（ORT worker 推理主干）— 对抗审计

> **日期**: 2026-07-20（时间锚点 20:11 +0800，本机 `date` 实测）
> **审计方**: Adversary——攻击对象是实现本身（worker 边界信任、熔断/单飞状态机、并发竞态、注入面、门禁证据兑现度），不是计划
> **被审材料**: I2 七 commit（`aafd09a` WI-2.3 + `c697af5..ce7094a`）——tinyclick-runtime.ts / tinyclick-worker.ts / tinyclick-preprocess.ts / tinyclick-decode.ts / tinyclick-tokenizer.ts / tinyclick-session.ts / tinyclick-protocol.ts / verify-tinyclick-worker.js / verify-tinyclick-sea.js / ps1 接线 / envelope §8 / 4 测试文件；启动形态旁证 launch.bat / dist-package-new 内容
> **亲跑验证**: `tsc --noEmit` exit 0；I2 四测试文件 **43/43 绿**（与评审一致）；`verify-tinyclick-worker.js` 独立复跑 **PASS**（token 7/7、point {158,211}、RSS 1296→1660MB，输出刻意导向临时路径规避 F-1 覆写面，已清理）；**cwd 劫持探针实证**（见 P1-a，临时脚本已清理）；SEA 门禁本轮未重跑（评审 1 小时前 PASS 且无可被其改判的发现——见 P1-a 对该门禁断言力的结构性分析）
> **纪律**: 只读 + 探针（临时目录，已清理）+ 写本文档；不改业务代码、不改 spike 产物
> **不重复报**: 评审 F-1（门禁默认覆写冻结基准）/F-2（旁置 bundle 非 ps1 本体）/F-3/F-4（I3 顺延）；详案对抗 M1-M7；I1 M1-M6+F-1~F-5；dtype bug（已修且有同构门禁）

## 裁决: `SOUND WITH MANDATORY FIXES`

I2 的主干语义经独立攻击复测**成立**：预处理 stretch 与 spike 逐行同源、反变换诚实路径值域结构性有界（bin∈[0,999] → 坐标 ≤0.999W，NaN 无从产生）；tokenizer 1238 向量零分叉且畸形 fail-closed；懒加载 warmingPromise single-flight 正确（测试 :286 锁）；单飞 busy 即拒**无排队**——「静默串行化成长延迟链」不成立（攻击角 3 闭环）；熔断状态机达阈广播形状合 plan 明定；冷启动 load 超时不计熔断（M6）；基准门禁我独立复跑通过，dtype 真 bug 的修复与防回归门禁证据链完整。

**但有一条 MEDIUM 必修**：worker 的 ORT 加载顺序**倒置了 plan 明定的「禁裸 require」**——裸 require 优先、execPath createRequire 沦为兜底，SEA eval worker 中裸 require 从 **cwd** 解析（本机探针实证诱饵 cwd 供应模块成功），W1 发现 1 的 cwd 劫持面向量被重新打开；且 SEA 门禁的「createRequire(execPath) 载 ORT」主张**结构上不可能被该门禁证明**（cwd==exe 目录，两条解析路径重合，无插桩区分）——envelope §8 此句证据不足。另有一条 LOW-MED 应在 I3 接线前修：plan 攻击面 3 明令要审的「worker 返回坐标的值域校验」在 runtime/session **完全缺位**。两者都是小修（数行 + 测试）；主干其余全项无损，故不判 FLAWED；门禁主张失真 + plan 明定防线被倒置，故不判 SOUND。

---

## 攻击角逐项裁决（任务书 7 角 + 自挖）

### 角 1 · worker 边界误信 —— 诚实路径有界闭环；**越权路径零校验失守（P2-a）**

- **诚实 worker**：`parseLocBins`（decode.ts:61-66）bin 结构性 ∈[0,999]，`locBinToPixel`（preprocess.ts:106-113）输出 ≤0.999W——NaN/负值/超屏坐标在诚实路径**无从产生**。闭环。
- **越权 worker（W3 残余：native 级 fault / 触发式后门）**：可 post 任意 `point`——runtime（:303-308）与 session（:134-139）**逐字段透传，全链无值域校验**。plan 攻击面 3 的设问「坐标反变换后的值域校验在哪」的答案 = **不存在**。下游天花板 = reL2 人审（G4），但 NaN/超屏坐标进 PsPreviewBuilder 预览是未测异常面（渲染崩溃/误导标记）。详案 WI-3.1 亦未列此校验——计划层同样缺位。

### 角 2 · 熔断绕过 —— 计数时序基本闭环；**双计窗口（P3-b）**；复位认证面 = I3 围栏

- 单飞串行化 infer → 并发 infer 错误无法倍增计数；并发 prepare 共享 warmingPromise → 单次故障计一次。闭环。
- **双计窗口（P3-b）**：超时路径 timer 内 `registerFault("infer-timeout")`（:540-543）；`expectedExits` 只守卫 `exit` 事件（:446），**不守卫 `error` 事件**（:444 → onWorkerGone → 再 registerFault）——terminate 撕毁中的 worker 发 error，一次逻辑故障计两次。「3 次故障熔断」叙事实际可 1.5 次触发，方向 fail-closed 但与广播叙事不符。
- **复位认证面**：`resetCircuitBreaker`（:227-231）当前**无任何外部触发面**（WI-3.4 才接 WS）——攻击面为零。I3 围栏：接线 `computer.model.*` 时必须过 validateWsMessage 且仅接受设置页来源，禁止任意 panel/内容侧调用；复位滥用本身无害（faults=0），但复位后无重新准备失败即重计的语义测试，入 I3 清单。

### 角 3 · 单飞语义 —— 闭环（一处文案债入 P4）

- busy 期间第二请求**立即拒绝** `tinyclick-busy`（:276-278，测试 :321-332 锁）——无排队、无静默串行化；700ms 窗口内连续动作 = 快速失败走降级链，非长延迟链。
- **5s 超时起算点**：`sendRequest` 挂 timer 于 **postMessage 时刻**（:535-548）——懒加载 prepare（load ≤30s 超时 + warmup ≤5s）**不在** 5s 内。首触延迟上界 = 30s + 5s，I3 时间线文案须如实（P4-3）。

### 角 4 · 预处理反变换 —— 映射正确性有证据；**宽高比准确率证据零（P3-d）**

- 反变换数值证据：多分辨率往返 ≤1px 单测（preprocess.test.ts:117-130）+ s1 参考点锁定（:109-115）——**映射正确性**闭环。
- 但映射正确性 ≠ 模型准确率：S-3/G1 全部准确率领证于 3:2 夹具与被拒的 16:9@3840；包线只限**帧宽 ≤1920**（envelope §2.4）**不限宽高比**——竖屏 1080×1920（宽 ≤1920 放行！）、21:9@1920、16:9@1920 全部落在包线内且**零准确率实测**。stretch 非等比对竖屏的挤压（垂直 ~2.5×）是训练分布外形态。

### 角 5 · tokenizer 特殊 token 注入 —— **坐实（P3-c）**：未过滤，HF 忠实复现即攻击面

- `added_tokens` 含 `<loc_0>..<loc_999>`，左最长匹配作用于**输入文本**（tokenizer.ts:271-289）；`buildCommandPrompt` 的 `.toLowerCase()`（:36）不影响 `<loc_282>`（本体小写）匹配——命令中字面 `<loc_282>` **被编码为控制 token 50551** 进入 prompt。
- 注入链：屏幕内容 prompt injection → planner 命令携带字面 `<loc_N>` → 模型输入前缀含定位 token（OOD，可能牵引输出坐标，未经实测）。这是 HF AddedVocabulary 语义的**忠实复现**（1238 向量锁的就是这个行为）——问题不在 tokenizer 分叉，而在**管线无输入消毒**。天花板 = reL2 人审（G4），但「恶意建议点 + 权威感预览」正是 C-4 家族。

### 角 6 · 旁置 eval worker 信任级 —— 与 I1 F-4 内部一致（观察，不立案）

- 「文本比 dll 易改」差异如实成立（记事本即可改 vs 二进制补丁），但威胁模型等价：能写安装目录即可换 exe/dll/sidecar 任一（I1 F-4 已按此接受 dll 放弃钉哈希）。**内部一致，观察项**；若未来做 sidecar 哈希登记（scripts/*-sha256.json 模式现成），worker.js 应与 dll 同批纳入，不单独补课。

### 角 7 · 懒加载竞态 —— 并发 prepare 闭环；**dispose×warming 竞态泄漏（P3-a）**

- 并发 prepare 共享 warmingPromise、worker 只 spawn 一次（:253-257，测试 :286）——闭环。
- **dispose×warming 竞态（P3-a）**：warming 中（~1.3-2s 窗口）调 `dispose()`——此刻 `this.worker` 尚为 null（:236），terminate 跳过；`doPrepareInner` 继续跑完，`this.worker = worker`（:395）+ `status = "warm"`（:396）**在 disposed 实例上落地**——worker 线程 + ~1.3GB RSS **泄漏**至进程退出，无回收路径（二次 dispose 才能捕到，但 handlers 语义上只调一次；I3 的 modelEnabled 关断正是 dispose 的消费场景）。13 个 runtime 测试**无此用例**。

---

## 发现清单

### P1-a（MEDIUM，必修）worker resolveOrt 裸 require 优先——plan「禁裸 require」被倒置，cwd 劫持向量实证成立

- **一句话**：tinyclick-worker.ts:31-39 先裸 `require("onnxruntime-node")`、失败才回退 `createRequire(process.execPath)`——与 plan WI-2.1「加载一律 createRequire(execPath)（**禁裸 require**，防 cwd 污染，W1 发现 1）」**顺序倒置**；eval worker（SEA 旁置模式）中裸 require 从 `process.cwd()` 解析，本机探针实证：**诱饵 cwd（伪造 node_modules/onnxruntime-node）起 eval worker，worker 报告 `via=bare-require`、`decoy=true`、resolve 命中诱饵路径**——execPath 兜底永不到达。
- **后果链**：launch.bat `cd /d %~dp0`（dist-package-new 实证）守住常规启动；但开机自启/终端启动/无「起始位置」的快捷方式等 cwd≠安装目录的形态下，预埋的恶意 `node_modules/onnxruntime-node`（**native dll 载体**）替代 exe 旁钉哈希副本被加载 = 原生代码执行，哈希叙事整体旁路。头注释 :10「先裸探测」把 W1 发现 1 引用反了。
- **门禁失真**：verify-tinyclick-sea.js 以 `cwd: workDir`（:199-200，== exe 目录）跑 smoke——两条解析路径重合，**无插桩区分实际走了哪条**；envelope §8「createRequire(execPath) 载 ORT 全通」在该门禁结构下不可能被证明，措辞需勘误。
- **怎么修（M1）**：SEA/eval 分支直接用 `createRequire(process.execPath)`（裸探测仅限 dev 路径模式或删除）；门禁增**诱饵 cwd 负探针**（workDir 外 cwd 含 marker 包，断言 exe 旁副本被加载）；envelope §8 措辞修正为实际被证明的内容。修复 ~5 行 + 一探针，必修于发版/I3 接线前。

### P2-a（LOW-MED，I3 接线前必修）runtime/session 对 worker 返回坐标零值域校验

- **一句话**：plan 攻击面 3 明令要审的「坐标值域校验」全链缺位——runtime（:303-308）与 session（:134-139）对 `point/locBins/tokenIds` 逐字段透传；越权 worker 可注入 NaN/负值/超屏坐标直达 reL2 预览。
- **怎么修（M2）**：runtime infer 边界校验——locBins 为 [0,999] 整数对、point ∈ [0,width]×[0,height] 有限数、tokenIds ∈ [0,VOCAB_SIZE) 整数；违规按 `worker-error` 拒绝 + 计熔断；测试：fake worker 返回 NaN/负/超屏/越界 bin → 拒绝 + 故障计数。

### P3-a（LOW-MED）dispose×warming 竞态：worker 泄漏 + disposed 实例回温

- **一句话**：warming 中 dispose → 后到的 `this.worker=worker`/`status="warm"`（:395-396）落在 disposed 实例上，worker 线程与 ~1.3GB RSS 泄漏至进程退出；I3 开关关断首启加载是现实触发形态。
- **怎么修（M3）**：doPrepareInner 完成前查 `disposed`（或 dispose 先 await warmingPromise 再 terminate）；测试：warming 中 dispose → 无泄漏 + 后续 infer/prepare 均拒。

### P3-b（LOW）熔断双计窗口：超时 terminate 的 error 事件不经 expectedExits 守卫

- **一句话**：一次推理超时可在 timer（:540-543）与 onWorkerGone（:481-493）各计一次故障——`expectedExits` 只守卫 exit（:446）不守卫 error（:444）；「3 次熔断」叙事实际可 1.5 次触发（fail-closed 方向，但广播计数失真）。
- **怎么修（M4）**：onWorkerGone 对 `terminatedWorkers` 成员跳过计故障（terminateWorker 幂等注释 :452-460 同款思路延伸至 error 路径）；测试补「超时后 error 事件不双计」。

### P3-c（LOW）命令中字面 `<loc_N>` 被编码为控制 token——注入面未消毒

- **一句话**：tokenizer 忠实复现 HF added_tokens 输入匹配（:271-289），命令文本里的 `<loc_282>` 字面量直接成为定位 token 入 prompt；prompt-injection 可经 planner 命令注入（天花板 reL2 人审，但属 C-4 权威感错误家族）。
- **怎么修（M5）**：`buildCommandPrompt`（:35-37）处输入消毒——剥离/转义 `<...>` 形态子串（命令语义不受损，定位 token 永非合法命令成分）+ 回归测试；tokenizer 本体保持 HF 忠实不动。备选：头注明示接受风险由 G4 兜底——**建议前者**，一行消毒换注入面关闭。

### P3-d（LOW）包线限宽不限比：竖屏/超宽的模型准确率证据为零

- **一句话**：帧宽 ≤1920 放行竖屏 1080×1920 与 21:9——S-3/G1 准确率领证只有 3:2 夹具与被拒的 16:9@3840，包线内其余宽高比零实测；反变换往返 ≤1px 证据是映射正确性，不能外推准确率。
- **怎么修（M6）**：envelope §2 包线文档明示「宽高比为未测定维，包线通过 ≠ 命中承诺，reL2 人审兜底」（与 §2.3/§6.3 既有声明同型），或将「宽高比实测补测」列入 I3 观测档。docs 级。

### P4（nit 捆）

1. **F-1 亲跑旁证**：本轮复跑基准时刻意 `--json` 临时路径——默认输出即冻结文件名（verify-tinyclick-worker.js:173-179）的覆写面属实，评审 F-1 不再立案，但**每次复跑都在消耗冻结语义**，建议随 M6 一并修。
2. **terminatedWorkers 永不清理**（runtime.ts:186）：每 terminate 留存一个 WorkerLike 引用防 GC；熔断封顶 3 + 手动复位使其有界且微小——头注已自证「永不删除，幂等依据」，仅登记其「以泄漏换幂等」的取舍。
3. **首触延迟上界 35s**：5s 超时自 postMessage 起算（:535），懒加载期（load ≤30s + warmup ≤5s）不在其内——I3 时间线/设置页文案须如实呈现「首次启用最长 ~35s」。

---

## 残余风险声明（观察项，非本迭代缺陷）

- **O-1**：慢机（低压 U + 热节流）5s 超时余量外推未实测（评审 OBS-1 同）——I3 观测档纳入慢机样本。
- **O-2**：SEA 门禁本轮未重跑——评审 1 小时前 PASS 且无发现依赖其改判；P1-a 指出的「cwd 重合致断言失效」属结构性分析，重跑不能证伪也不能证实。
- **O-3**：worker sidecar 与 ORT dll 的钉哈希统一补课（I1 F-4 立场）——若做，同批纳入 worker.js。
- **O-4**：I3 围栏重申——`resetCircuitBreaker` 接线仅设置页来源 + validateWsMessage；`>38 token` 拒绝不截断负测试（I1 O-4）；G6 OOD 围栏（I1 F-5①）；golden 回放 harness 顺延项（评审 F-4）。

## 修正清单

| 编号 | 严重度 | 窗口 | 内容 |
|---|---|---|---|
| **M1** | MEDIUM（必修） | 发版 / I3 接线前 | resolveOrt execPath 优先（SEA 分支禁裸 require）+ 门禁诱饵 cwd 负探针 + envelope §8 勘误（P1-a） |
| M2 | LOW-MED（必修） | I3 接线前 | worker 输出值域校验（locBins/point/tokenIds）+ fake worker 负测试（P2-a） |
| M3 | LOW-MED | I3 | dispose×warming 竞态修复 + 泄漏测试（P3-a） |
| M4 | LOW | I3 | 熔断双计守卫（error 事件查 terminatedWorkers）+ 测试（P3-b） |
| M5 | LOW | I3 | buildCommandPrompt 输入消毒 `<...>` 子串 + 回归测试（P3-c） |
| M6 | LOW（nit 捆） | 随对应项 | envelope 宽高比注记 / F-1 默认输出改时间戳名 / terminatedWorkers 取舍登记 / 首触 35s 文案（P3-d+P4） |

---
*WP5 I2 实现对抗审计 v1.0 — 裁决：SOUND WITH MANDATORY FIXES（M1 必修于发版/I3 接线前；M2 必修于 I3 接线前；M3-M6 进 I3 清单）*
