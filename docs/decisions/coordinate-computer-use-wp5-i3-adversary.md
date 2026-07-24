# WP5 I3 实现（编排器接入与防信任放大）— 对抗审计

> **日期**: 2026-07-20（时间锚点 22:59 +0800，本机 `date` 实测）
> **审计方**: Adversary——攻击对象是接入层本身（包线可绕性、防信任放大机制的组成语义、门禁证据兑现度、fail-closed 中间态的临时攻击面）
> **被审材料**: I3 九 commit（`6368e26..7bc6bd6`）——tinyclick-locator.ts / locate-chain.ts+types.ts diff / executor.ts diff / model-handlers.ts / tinyclick-golden-eval.ts / verify-tinyclick-golden.js / model-state-messages.ts / server.ts+message-router diff / i3-implementation-notes.md；旁证：I2 对抗修复四 commit（`69cb04f..efa683b`）落实状态
> **亲跑验证**: `tsc --noEmit` exit 0；I3 六测试文件 **166/166 绿**；`verify-tinyclick-golden.js --variant hybrid` **PASS（total=19 pass=16 fail=0 report=3**，zh 拒绝 15/15=100%，距离臂全绿，f-icon-en 737ms 安静机延迟达标；报告导向临时文件已清理）——与评审热机 3 假阳性对照，F-1 环境敏感性获双向实证；fail-closed 四面独立复核（config 无字段 / WS 仅两路由 / holder 零写入 / server.ts:2001 deps 无 locator）
> **纪律**: 只读 + 写本文档；不改业务代码、不改 spike 产物
> **不重复报**: 评审 F-1（延迟臂环境敏感，本人本轮安静机全绿 + 评审热机假阳性 = 双向确认）/F-2；I1/I2 全部（M1-M6×2 + F 系列——其中 I2 对抗 M1-M6 修复已抽验落实：worker.ts:38-56 SEA 分支 execPath-only、runtime.ts:167-206 值域校验、tokenizer.ts:37-46 `<...>` 消毒）；WP3 降级链零回归（评审已核，我的 locate-chain diff 读码一致）

## 裁决: `SOUND WITH MANDATORY FIXES`

I3 的防信任放大主机制经独立攻击复测**成立**：包线三类拒绝代码化且**拒绝不截断**（非 ASCII 同形异义面在 7-bit 判定下结构性关闭，:84-87；38 token 边界值「卡线通过」买不到任何东西——上限是必要条件非命中承诺，envelope §2.1 注记与 locator:9-10 注释一致）；坍缩抑制的语义边界诚实（同帧+异命令+≤8px，同命令/跨帧/无 sha 不误伤）；experimental 标记为编译期字面量 `true`（只能标「是」）且**在进程内即时消费**——两个 chain 调用点全审（主链 :760 透传 / 刷新链 :971 显式 null），无第三消费方可按高置信误食；confidence 类型级缺省贯穿 hit→attempt→日志；G4 门 caption 走 X1 sanitize 防线、拒绝诚实降级零注入、批准走区域复核防提示循环；reset 围栏双层 + 声明式来源的诚实边界在案；显式 null 中间态经四面独立复核**无开启路径**（攻击角 5 闭环，见下）。

**但有一条 LOW-MED 必修于 I4 用户开启前**：**A1.3 子预算的扣减点在 G4 门之前**——被用户拒绝的实验层建议同样燃烧 uncross 预算，且「永远逐条人审」的建议与「免审自动注入」共用同一预算池，续期弹窗与 G4 门重复索票——在以防确认疲劳为设计目标的迭代里**系统性制造确认疲劳**（C-4 自伤）。另有两条 LOW 门禁健壮性项。均小修；主机制无损，故不判 FLAWED；必修项直击本迭代自己的设计目标，故不判 SOUND。

---

## 攻击角逐项裁决（任务书 6 角 + 自挖）

### 角 1 · 包线拒绝绕过 —— 三子面全闭环（一处 nit 入 P3-c）

- **38 token 卡线**：上限语义 = 「实测命中最大值」型 fail-closed（>38 从未扫描，拒绝未测区域）；len-31-ok tok=38 双臂 HIT 即边界实证。卡线通过只买到「在已测邻域内推理」+坍缩+reL2，**无信任增益**。闭环。
- **非 ASCII 同形异义**：`isAscii` 为严格 7-bit（:84-87）——全角 U+FF01-FF5E、拉丁扩展 U+0100+、西里尔同形 U+0430 全部 >0x7f 被拒。**伪装英文面结构性关闭**。
- **直接指称浅层判定**：按 envelope §2.3 定性为文档级 OOD 排除**不代码化**（:13-14 明示，句式与命中无单调关系的扫描证据支撑）——不存在可绕的「判定器」，约束本就定位为不承诺。闭环。
- **nit（P3-c）**：`isAscii` 放行 C0 控制符（0x00-0x1f）与 DEL——G1 命中证据全为可打印英文，控制符在「测量包线外、代码包线内」；后果有界（OOD prompt → 有界输出 + reL2），一行收紧。

### 角 2 · 坍缩抑制 —— 语义闭环；「绕过」买不到东西（疲劳归 P2-a）

- 9px 步进：逐步偏移的建议**本来就不是坍缩形态**（坍缩 = 异命令同点的自欺），放行后每条进 reL2 人审——抑制器是信任过滤器不是安全边界，绕过的代价只是用户注意力（疲劳问题归 P2-a 统一处置）。
- 精确重复同命令：不抑制是**有意语义**（:19-20 用户连点合法形态），重复弹窗疲劳同样归 P2-a。
- 窗口与预算交互：历史任务级随实例消亡（:21-22 + golden harness 每 case 新实例 :152-159 实证语义），跨任务零泄漏；抑制结果 = skipped → 链继续 → L3 stub → 诚实失败，无循环。闭环。

### 角 3 · experimental 标记逐跳 —— 闭环（无序列化跳可 strip）

- 标记**在进程内即时消费**：chain 返回 → executor 局部布尔（:776-779）→ G4 门（:879-922）——不经 JSON/WS/落库序列化，无中间跳可 strip。全仓 chain 调用点仅两处（server.ts:2001 主链、executor :965 刷新链显式 `tinyclick:null`）——无第三消费方。
- 落库 provenance 充分：attempts 记 `layer:"tinyclick"` + `experimental-denied-by-user` 拒绝痕（:915-919）+ `computer.task.experimental_gate` 审计（:894-900）+ 注入动作 uncrossverified 标记——证据链可区分实验层注入，无冒充高置信空间。闭环。

### 角 4 · reL2 子预算交互 —— **失守（P2-a）**：拒绝也烧预算 + 双门重复索票

- 代码事实：chain 对实验层命中置 `uncrossverified:true`（locate-chain diff，吃 A1.3 子预算 plan:458）→ executor :797-811 **先扣预算**（`uncrossLeft -= 1`，耗尽弹续期窗）→  bounds/危险扫描（caution 再弹）→ **最后才是 G4 实验层门**（:879+）。拒绝 → ELEMENT_NOT_FOUND——**预算已扣，注入未发生**。
- 组成后果：① 3 条**被拒**建议即可烧光子预算，第 4 个动作（哪怕是正常 OCR 点击）触发续期弹窗；② 单条实验层建议最多连吃**三个**弹窗（预算续期 + 危险 caution + G4 门）；③ 实验层建议**构造上永远逐条人审**（G4），与 A1.3 预算的设计对象（免审自动注入）不同类——共用一池 = 对同一风险双重索票。plan:458「吃子预算」的字面合规掩盖了「被拒也烧」的实现组成细节——这正是 G4 要防的确认疲劳的**系统化制造机**。

### 角 5 · 显式 null 的 fail-closed —— 四面复核闭环，无临时攻击面

- **config 路径**：无 `modelEnabled`/`modelLicense*` 字段（I1 仅加了 mirror/预算）——篡改无可扳之开关。
- **WS 路径**：`computer.model.*` 仅 get_state（只读）+ reset_circuit_breaker（双层 source 围栏，动作本身无副作用）两路由（message-router :967-974）；set_enabled/license/download/delete 不存在（I4 留账）——伪造无可调之端点。
- **deps 注入面**：生产唯一组装点 server.ts:2001 不传 `tinyclickLocator`（?? null → 链恒 skipped model-disabled）；进程级 holder `computerModelSession.session` 全仓**零写入**（:29 声明即终态）。
- **结论**：「留账缺失」不构成攻击面——缺失的是「开启路径」整体，而非开关的某个环节。I4 接线时须重审此四面的每一处新增写入点（评审 §4 出口标准追加条已置）。闭环。

### 角 6 · golden harness report 态 —— 客观性闭环（锚定两脆弱入 P3-a）

- **report 集合由 frozen 锚决定**（frozen.hit===false → 规则 3），生产行为**无法**把自己挪进 report——frozen-HIT 例任何非 hit 即 FAIL（规则 2，:139-158）；篡改锚需动 git 追踪文件（PR 评审）。判定标准客观，本轮亲跑 hybrid 臂 pass=16/fail=0/report=3、zh 拒绝 100% 复核成立。
- **锚定脆弱面（P3-a）**：① harness 按**位置索引**取锚（verify-tinyclick-golden.js:149 `frozen.golden[String(idx)]`）而锚条目自带 `id` 字段（实测 `f.golden['0'].id === 'f-ok-en'` 在案）却**不校验**——golden.json 增删重排即静默错锚，回退例继承 frozen-MISS 锚可化 FAIL 为 report（fail-open 方向）；② 规则 5（golden-eval.ts:135-137）包线内锚缺失 → report 不阻塞——文件内部分锚丢失同样 fail-open 降级。

---

## 发现清单

### P2-a（LOW-MED，I4 用户开启前必修）A1.3 子预算扣减点在 G4 门之前——被拒建议白烧预算 + 双门重复索票

- **一句话**：executor :797-811 在 G4 门（:879+）**之前**扣 uncross 预算——被拒的实验层建议（零注入）照样烧单位；且永远人审的建议与免审注入共用预算池，3 条被拒建议即可给无辜动作制造续期弹窗，单条建议最多三连弹窗——在防确认疲劳的迭代里系统性制造确认疲劳（C-4 自伤，方向 fail-closed 但敌我颠倒）。
- **证据**：chain uncrossverified:true（plan:458 字面合规）；扣减点 :797、续期弹窗 :800-810、G4 门 :879-922 的顺序读码；拒绝路径 :913-922（ELEMENT_NOT_FOUND，预算已扣）。
- **怎么修（M1）**：实验层建议的预算记账**移至 G4 批准之后**（只有真注入才消耗；被拒零消耗）——executor 顺序调整 + 测试（拒绝不耗预算 / 批准才耗 / 续期弹窗不被实验层建议触发）；或将「实验层豁免 A1.3」上 plan 裁决——二选一须留裁决记录，I4 出口标准挂钩。

### P3-a（LOW）golden harness 锚定两脆弱：索引寻址无 id 校验 + 锚缺失 fail-open

- **一句话**：verify-tinyclick-golden.js:149 按位置索引取锚而锚自带 id 不校验——golden.json 重排即静默错锚（回退例可化 FAIL 为 report）；golden-eval.ts:135-137 包线内锚缺失记 report 不阻塞——部分锚丢失同样 fail-open 降级。
- **怎么修（M2）**：锚寻址改按 `c.id` 键取 + 断言命中（失配即 exit 2）；规则 5 对包线内锚缺失记 FAIL（或单独 exit 2 警示）——门禁语义 fail-closed 化；各配一条回归测试（重排用例 / 缺锚用例）。

### P3-b（LOW）坍缩抑制的「非边界」属性未入文档

- **一句话**：抑制器是信任过滤器不是安全边界——9px 步进/精确重复的「绕过」语义上合法且代价仅是用户注意力；此属性代码注释有（:17-22），但 envelope/登记档未明示「坍缩抑制不构成命中承诺之外的第二信任闸」，后读者易高估。
- **怎么修（M3）**：envelope §2 或 i3-implementation-notes 补一句定位声明（与「包线通过≠命中承诺」同型）。docs 级。

### P3-c（LOW）`isAscii` 放行 C0 控制符与 DEL——测量包线外、代码包线内

- **一句话**：`! /[^\x00-\x7f]/`（locator.ts:84-87）放行 `\x00`-\x1f` 与 `\x7f`——G1 命中证据全为可打印英文，控制符命令属未测区域却进推理；后果有界（OOD 输出 + reL2），但与「拒绝未测区域」的 fail-closed 常量语义不自洽。
- **怎么修（M3）**：收紧为可打印 `[ -~]`（0x20-0x7E）+ 一条控制符拒绝测试；拒绝 reason 复用 non-ascii。

### P4（nit 捆）

1. **F-1 双向实证登记**：本轮安静机 hybrid 全绿（f-icon-en 737ms 达标）与评审热机 3 假阳性互为对照——环境敏感性不再是单点证据；根治（run 内自测基线比值法）建议随 I4 评估，**禁止**直接放宽 ×1.5（评审 §3 纪律同意）。
2. **三弹窗上界**：预算续期 + 危险 caution + G4 门可在单一动作内串联（:800/:869/:906）——M1 修复后自然消解其二，登记备查。
3. **空命令/纯空白命令**经模板包装后 tok≈12 ≤38 进推理（评审 OBS-1 同，非包线缺口）——I4 可在 admission 层加「非空且含可打印字符」前置，不立案。

---

## 残余风险声明（观察项，非本迭代缺陷）

- **O-1**：I4 接线面预审清单——server.ts:2001 将新增 locator 实参、holder 将新增写入点、config 将新增四字段、WS 将新增四路由：每一处都是本轮「显式 null 四面复核」的**反命题**，I4 评审须逐点重做可达性分析（评审 §4 出口追加条已置，此处从对抗侧背书）。
- **O-2**：慢机样本缺位（I2 OBS-1）与 golden 延迟根治（F-1）合并为 I4 观测档候选。
- **O-3**：report 态 3 例（f-ok-en 809px / f-play-en 151px / d-deskchrome-en 815.1px，本轮实测）为已知弱点的如实呈现——G6 补测（backlog）是它们的归口，不属 I3。

## 修正清单

| 编号 | 严重度 | 窗口 | 内容 |
|---|---|---|---|
| **M1** | LOW-MED（必修） | I4 用户开启前 | 实验层预算记账移至 G4 批准后（拒绝零消耗）或上 plan 裁豁免——留裁决记录 + 测试（P2-a） |
| M2 | LOW | 随 I4 | golden 锚按 id 键取 + 失配 exit 2 + 锚缺失 fail-closed 化 + 两回归测试（P3-a） |
| M3 | LOW（nit 捆） | 随 I4 | 坍缩非边界文档声明 / isAscii 收紧可打印 + 测试 / 空命令 admission 前置评估（P3-b/P3-c/P4-3） |

---
*WP5 I3 实现对抗审计 v1.0 — 裁决：SOUND WITH MANDATORY FIXES（M1 必修于 I4 用户开启前；M2/M3 随 I4 清单）*
