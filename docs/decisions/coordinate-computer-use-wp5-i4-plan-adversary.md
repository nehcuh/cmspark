# WP5-I4 实施详案 — 对抗审查（规划详案轮）

- **日期**：2026-07-21（机器锚点 2026-07-21T00:04+0800）
- **审查对象**：`docs/decisions/coordinate-computer-use-plan.md` 「WP5-I4 实施详案」节（plan:527-596；工作区未提交改动，`git diff` +72 行，基于 HEAD e0d52c6）
- **审查方式**：只读对抗——详案全部锚点逐一回读代码复核；五工作项、六设计裁决、六出口标准、规划者自列五攻击面，外加自挖攻击面；不改代码、不改详案文本
- **前情承接核验**：I3 对抗 M1/M2/M3 修复提交在案（f991ed2 / 5be7758 / 9ac1122），i3-review §6 终审 APPROVED；详案「前置未修项：无」声明经 git log 核实**属实**，M1 挂钩出口标准 4 冒烟断言的承接设计**成立**

---

## 裁决：**PLAN SOUND WITH AMENDMENTS**

详案架构方向全部成立：三层开关门强度一致（实验层实为最严）、per-task admission 纯函数注入、刷新链恒 null 不动、LICENSE_DOOR_TEXT 单一真源、O-1 四写入点逐点承接、出口标准均可证伪。**无推翻性缺陷、无 HIGH 发现**。三处 LOW-MED 与七处 LOW 均为修订级——修正清单 M1–M6 并入详案文本后即可开工，无需重走规划轮。

---

## 指定攻击重点逐条裁决

### 重点 ① · 裁决①（set_enabled(true) 过生物识别门）是同级还是过度防御？——**同级，且论证比详案自述更强**

**实测的三层开关门强度矩阵**（本轮全部回读核实）：

| 层 | 端点 | validateWsMessage 条目 | source 围栏 | 生物识别门 |
|---|---|---|---|---|
| 主开关 | `computer.set_enabled` | **无**（未知类型默认放行，server.ts:2743-2744 实证） | 无 | **有**（computer/handlers.ts:133-155，`requireAppsBiometric`） |
| app 层 | `apps.set_coordinate_allowed` | **无**（validators 表 :2704-2735 无此键，实证） | 无 | **有**（apps/handlers.ts:435-454） |
| 实验层（I4） | `computer.model.set_enabled` | **有**（WI-4.2 新增） | 双层（validateWsMessage + handler belt） | **有**（裁决①） |

结论：两个先例的能力授权**唯一**非伪造门就是生物识别门（HMAC 连接鉴权不防同级用户进程——ws_secret 0o600 但 owner 可读，ws-auth.ts:12；source 是声明式，model-handlers.ts:8-11 自承）。伪造 settings 来源的成本 = 同级进程读 ws_secret + 握手 + 发声明式消息；伪造 coordinateAllowed 的成本 = 完全相同的连接面 + 过一次 Hello。两者唯一差异就是那扇门。**若实验层不设门，它即成为三层中唯一可脚本化静默武装的一层，造成强度倒挂**——「同级」不是保守选项，是一致性底线。且实验层实为三层**最严**（多了 source 条目真围栏），「同级」措辞准确无夸大。

**「G4 已逐条人审，门是否冗余」不成立**：G4 防的是「坏建议被执行」，不防「能力被静默武装」——两者职责不同。武装链无门时为：伪造来源接受 license → 自动触发 705MB 下载 → 伪造来源 set_enabled → 全静默完成；有门时最后一跳必弹 OS 宿主 Hello 对话框（渲染进程不可伪造，biometric-gate.ts:5-6）。G4 自身的确认疲劳防线（A1.3 uncross ≤3 子预算，executor.ts:805）恰是人审不可无限依赖的在案证据；一次性每安装一次的门无疲劳问题，详案理由③成立。

**如实校准（非发现）**：门的真实强度 = Windows Hello（OS 宿主弹窗，进程不可伪造）。manual-nonce 降级路径的挑战经同源 WS 投递（biometric-gate.ts:70-77），可脚本化的同级进程理论上可读回声传——manual-nonce 实际防的是「无原始 WS 能力的驱动」（LLM 工具循环），不防「有 shell 能力的同级脚本」。此性质为 D2 门族固有（WP4 主开关/app 层同型），非 I4 新引入，不改变同级裁决；建议 i4-implementation-notes 如实一句话记录（并入 M6）。

### 重点 ② · license_response 无 nonce 回声的抗抵赖性——**方向成立；nonce 回声经分析为「同源通道剧场」明确否决；实质修订是文本版本绑定（P1）**

**证据链能证明什么**：config 时间戳 + 审计事件只能证明「companion 进程于 T 写入了接受记录」，不能证明「用户在门 UI 前点击了接受」。但决定性事实是：**能伪造 license_response 的同级进程本来就能直接手改 config.json 写入 `modelLicenseAcceptedAt`**（normalize 只查形状不查来源），而手改 config 按裁决③即合法 opt-in——license_response 端点相对手改路径**没有扩大伪造能力面**。抗抵赖缺口是 ADR-010 信任公理（本机文件写 = owner，ADR-010 方式 B，docs/adr/010:62-73）的固有推论，不是本端点的缺陷。详案理由「license 是法律记录非能力本身（未接受则 set_enabled 必被 license_required 拦截）」成立。

**nonce 回声为何是剧场（明确否决，防后续轮次重复提出）**：挑战若经 license_required 载荷投递，则与响应同走一条 WS 通道——伪造客户端可读挑战、可回声响应，挑战-响应不绑定任何额外主体。唯一有效升级是把接受动作也过 D2 生物识别门，但那给「法律记录」施加了比「能力授权」更强的门，方向倒挂，且伪造者仍可手改 config 绕过，净收益为零。

**实质缺口在别处（→ P1）**：抗抵赖的真正问题是接受的**对象**未被记录——见发现清单 P1。

**download/delete 轮询 DoS 子点（规划者攻击面 1 附带）**：幂等只防并发不防轮询属实；磁盘预算 2048MB（config.ts:81-82）封顶塞盘面，但 delete+download 循环可烧网络与时间。攻击者需为已认证同级用户，损害有界且高度可见——LOW，声明即可（并入 M6）。

### 重点 ③ · O-1 表「伪造排除」列——**四行均有测试锚，但三处第二列承诺无自动化承接（P6/P7/P8）**

逐行核验（表在 plan:571-576）：

| 行 | 「伪造排除」承诺 | 可测试性核验 |
|---|---|---|
| ① admission 实参 | 「无 config/holder 外输入」+「刷新链恒 null 不动」 | 前者有六路矩阵测试锚 ✓；后者**只有意图声明，无回归测试锚**——executor.ts:993 显式 null 依赖「不动」纪律，未来重构可静默破坏（→ P7） |
| ② holder 写入 | 「并发首建测试」+「holder 无第二写入方（grep 断言）」 | 并发测试在 WI-4.3 清单 ✓；「grep 断言」是一次性人工核查还是自动化测试**未指明**——一次性 grep 防不住后续迭代引入第二写入方（→ P8） |
| ③ config 四字段 | 「手改 config = 显式 opt-in（裁决 3 文档化）」 | 叙事性处置而非「排除」——但诚实且落点明确（i4-implementation-notes），**成立**；另补一条启动期 loud log 建议（→ P9） |
| ④ WS 四路由 | 「未知类型默认放行故此四条目真围栏」 | 已实证默认放行（server.ts:2743-2744），validateWsMessage 负测试在清单 ✓；但「双层」之第二层（handler belt 二次核查）在工作项文本与测试清单中**未显式列出**——reset_circuit_breaker 先例 belt+测试齐全（model-handlers.ts:70-78），四新路由漏 belt 则「双层」名不副实（→ P6） |

### 重点 ④ · per-task 不收回 + 15 动作预算 + estop 关系——**取舍可接受，文案误导必修（P2）**

**结构事实**（全部回读核实）：locator 在任务组装点注入一次（server.ts:2001 → executor.ts:760），执行全程无 per-action 重估点（executor 全文 tinyclick 仅 :760/:993 两处）；任务预算默认 15（types.ts:106 `DEFAULT_TASK_BUDGET = 15`，上限 30）；实验层建议任务内继续出现时仍受 G4 逐条人审 + uncross ≤3 子预算约束——**不会静默执行任何东西**。

**estop 三通道实证**（estop.ts:1-16 注释与实现一致）：① Ctrl+Alt+End 热键 helper（preflight 门控——helper 不健康任务拒启，EMERGENCY_STOP_UNAVAILABLE；执行中看门狗 estopHeartbeatLost :175）；② WS `computer.task.abort`（server 任务注册表，同一 abortCheck 轮询）；③ 预算耗尽 re-L2（executor.ts:702-707）。**中止通道存在、可达、fail-closed**。

**结论**：「任务中途关闭仅影响下一任务」在 G4 托底 + estop 可达的前提下是可接受取舍，风险节登记（plan:588）方向正确。**但文案误导成立**：MODEL_SWITCH_COPY.layerSemantics 现行「拒绝或关闭后，UIA / OCR / 用户框选兜底不受影响」（model-state-messages.ts:168-171）——任务运行中读到此文案的用户会以为关闭**立即**生效，而详案未修订此文案、未规定设置页「任务运行中」态提示。被坏建议惊动而跑去关开关的用户，恰是最需要被引导去 estop 的人——文案此刻给出虚假保证，方向虽不 fail-open 但属诚实性缺陷（→ P2，LOW-MED 必修）。

### 重点 ⑤ · golden 双臂重跑 × I3 F-1 交互——**F-1 已根治，验收环境前提问题在机制上消解**

F-1 修复已落地（9ac1122，本轮回读核实）：延迟臂改为 **run 内自测基线 ×2.5**——门禁前用 s1 参考命令在 fixture.png 实测 3 次取中位（verify-tinyclick-golden.js:148-166），机器无关；「无基线回退 frozen ×1.5 legacy；禁直接放宽 ×1.5」（:18-19）为近死路径（基线测量失败意味着 runtime/fixture 已坏，整个 run 本就会失败）。出口 3「延迟臂基线相对 ×2.5 既有规则——F-1 已根治不搭车改」表述**准确**。我（前轮）担心的「热机假阳性阻塞验收」已被基线比值法从机制上消解，**无需**再写「安静机」验收前提。

观察项（不立案）：golden harness 直接构造定位链、不经 WS/config/admission——「admission 接线后重跑」是回归确认（接线不扰动链行为）而非新路径验收；建议验收记录写明运行机与负载状态备查（OBS 级，并入 M6 声明）。

---

## 自挖发现清单

| 编号 | 严重度 | 一句话 | 计划怎么改 |
|---|---|---|---|
| **P1** | **LOW-MED** | 许可证接受记录是裸时间戳，未绑定文本版本——未来 LICENSE_DOOR_TEXT 随模型版本/条款变更时，旧接受静默覆盖新文本，「接受的对象」不可考 | WI-4.1/4.2：接受时同时写入 `modelLicenseAcceptedTextHash`（LICENSE_DOOR_TEXT 的 sha256 前 12 位）；enable/admission 时比对当前文本哈希，不符则重新弹门（license_required）+ normalize 对非法哈希 delete+loud log；出口 5 增「文本漂移重门」测试 |
| **P2** | **LOW-MED** | MODEL_SWITCH_COPY「拒绝或关闭后……不受影响」在任务运行中关闭时构成虚假保证——per-task 语义下当前任务仍弹实验层建议，用户不知应改用 estop | WI-4.4：layerSemantics 补「任务运行中关闭将于当前任务结束后生效；立即停止请按 Ctrl+Alt+End 或中止任务」+ 设置页任务运行中态提示（有活动任务时开关旁注）+ model-switch-logic 纯函数与测试；出口 1 挂钩 |
| **P3** | **LOW-MED** | 裁决④变体切换路径按文档不可操作——四路由无 variant setter、UI 四件无选择器；手改 config 因缓存不热加载（config.ts:276-281 缓存实证）需重启方生效，「disable→改变体→enable」链缺「重启」环节；且 int8 文件未下载时切过去 admission 复验 fail-closed，download 路由的按变体语义未指定 | 二选一显式化：（a）新增 `computer.model.set_variant` 路由（settings-source 双层 + 切换指引文案）；（b）裁决④改写为「手改 config.json + 重启 companion」并如实标注；无论何者，download 路由补「下载当前配置变体的文件组」语义 + 变体文件缺失时的诚实状态文案 + 测试 |
| P4 | LOW | dispose 竞态熔断误计未指定——disable/delete dispose 与进行中推理竞态时，worker 失败是否计入 faults（熔断计数）未定义；M6 冷启动排除语义（plan:524）未覆盖 dispose 竞态（攻击面 4 自列但未答） | WI-4.3 增语义条款：dispose 发起后/进行中 locate 的失败豁免熔断计数（faults 冻结）+ 「dispose 竞态不误计熔断」测试 |
| P5 | LOW | WI-4.2 message-router 接线只写「broadcast 注入」，未写 requestConfirmation 注入——裁决①的门依赖该通道（无通道则 NO_CONFIRMATION_CHANNEL，computer/handlers.ts:134-137 先例） | WI-4.2 路由项改写为「复用 handleComputerModelMessage + requestConfirmation/broadcast 注入（:961-966 先例）」；ComputerModelHandlerContext 增 requestConfirmation 字段 |
| P6 | LOW | 四新路由的 handler 层 belt 二次核查（O-1 行④「双层」之第二层）在工作项文本与测试清单中未显式列出 | WI-4.2 增「四 case 均 handler 层复核 source:"settings"（reset_circuit_breaker :70-78 先例）」+ 四 belt 负测试；出口 2 行④测试锚同步 |
| P7 | LOW | O-1 行①「刷新链恒 null 不动」无回归测试锚 | WI-4.3 或 4.5 增回归测试：admission 开启态下触发刷新重定位路径，断言链 deps.tinyclick 仍为 null（executor.ts:993 结构锁定） |
| P8 | LOW | O-1 行②「holder 无第二写入方（grep 断言）」未指明一次性核查还是自动化 | i4-implementation-notes 记录在案 grep 证据（提交时点），并在 WI-4.3 测试加结构化断言（holder 写入点仅 admission/disable/delete 三处的符号级注释契约） |
| P9 | LOW | 手改 config 合法 enable 无启动期可观测性——god-mode way B 有醒目 WARNING 先例（ADR-010:73），`modelEnabled:true` 手改加载静默 | config normalize 增一条：加载时 `modelEnabled===true` 打醒目 log（「实验层经 config.json 手动开启，ADR-010 opt-in」），不阻断 |
| P10 | LOW | download/delete 轮询 DoS 面（攻击面 1 自列附带点）只有幂等无频率约束 | i4-implementation-notes 声明残余（同级已认证用户、磁盘预算封顶、高度可见），或加每连接频率上限（apps evidence.open P6 先例）；二选一 |

---

## 规划者自列五攻击面评价

1. **声明式 source 围栏（license_response 特例）**：提得准。但建议的 nonce 回声方向经本审分析为**同源通道剧场**（挑战与响应同走一条 WS，伪造者可读可回声），明确否决并记录理由；实质修订落在 P1（文本版本绑定）。download/delete 轮询点成立（P10）。
2. **生物识别门双轨叙事**：成立且详案已自备解药——裁决③文档化承诺 + 本审实测 config 缓存不热加载（手改须重启生效，与 ADR-010 方式 B「保存后重启 companion」同型），「门可绕」叙事在重启门槛下如实成立；时序子点（批准→写入崩溃 fail-safe、写入→广播间隙 UI 自愈）方向均 fail-closed，无追加。P9 补强可观测性。
3. **admission 输入完整性与任务内收回**：提得准，详案风险节已登记取舍；本审实证 estop 三通道可达 + G4 托底后裁定取舍可接受，但发现文案误导（P2）与 per-action 重估点确实不存在（executor tinyclick 仅 :760/:993 两处）——登记从「叙事」升级为「文案必修」。
4. **holder 并发/竞态矩阵**：单飞锁 + 并发测试已在 WI-4.3 应答；但 **dispose 竞态误计熔断**这一格（自列了问题没给答案）——本审立 P4。熔断保活 + reset no-op 分支形态矩阵（:80-85）经复核无追加。
5. **许可证门呈现伪造**：companion 被控则全局皆失（它 spawn Hello、注入输入），WS 通道内篡改需同级用户能力——门载荷伪造与 state 广播伪造均不超 ADR-010 信任边界，**不立案**；哈希回声建议同攻击面 1 之 nonce，剧场，否决。真问题仍是 P1。

---

## 正面确认（回读核实无虚的结构主张，防后续轮次误判）

- **未知类型默认放行**实证（server.ts:2743-2744），「条目即真围栏」成立；WI-4.2 四条目设计正确。
- **`.invalid` 占位主机**实证（models.manifest.json:28 等 10 处 URL），裁决⑤零网络 fail-fast 针对真实缺口——resolveDownloadUrl 现行为（model-manifest.ts:154-155）会原样返回 `.invalid` URL，无兜底则用户拿到 DNS 失败后的 network-error，`download-host-unset` 文案显著更诚实。
- **实验层门强度不弱反强**：主开关与 app 层均**无** validateWsMessage 条目、**无** source 围栏（本轮实测），实验层「source 双层 + 生物识别门」为三层最严——无强度倒挂。
- **I3 留账承接完整**：M1（预算记账移 G4 后，f991ed2）挂钩出口 4 冒烟断言「G4 批准后才耗预算」；M2（golden 锚 id 键取 + fail-closed，5be7758）；M3 + F-1 + F-2（9ac1122）；O-1 四写入点表逐点应答；P4-3（空命令 admission 前置）登记不立案的处置与 i3-adversary「不立案」原议一致。
- **normalize 语义与 ADR-010 一致**：四字段 coerce/delete + loud log 与 config.ts:307-345 惯例区同型；AcceptedAt 非法 → delete（回退未接受）方向 fail-closed。
- **estop 与任务预算**：estop.ts 三通道与 preflight 门控实证；DEFAULT_TASK_BUDGET=15 / MAX=30 / UNCROSS≤3（types.ts:106/107/132）与详案叙事一致。
- **config 写路径**：setComputerCoordinateEnabled 更新缓存 + atomicWriteJSON + CONFIG_CHANGE_EVENT（config.ts:441-443）——WS 路径变更即时生效、手改文件须重启，per-task「任务间翻转即生效」对 WS 路径成立。

---

## 修正清单（并入详案文本后开工；编号独立本档）

| 编号 | 严重度 | 窗口 | 内容 | 落点 |
|---|---|---|---|---|
| **M1** | LOW-MED | I4 开工前并入 | license 接受记录绑文本哈希 + 漂移重门 + normalize + 测试（P1） | WI-4.1/4.2、裁决②、出口 5 |
| **M2** | LOW-MED | I4 开工前并入 | MODEL_SWITCH_COPY 任务内关闭语义 + estop 引导 + 任务运行中开关旁注 + 测试（P2） | WI-4.4、出口 1 |
| **M3** | LOW-MED | I4 开工前并入 | 变体切换路径二选一显式化 + download 按变体语义 + 变体缺失诚实文案 + 测试（P3） | 裁决④、WI-4.2/4.4 |
| M4 | LOW | 随 WI-4.3 | dispose 竞态熔断豁免语义 + 测试（P4） | WI-4.3、攻击面 4 应答 |
| M5 | LOW | 随 WI-4.2 | requestConfirmation 注入显式化 + 四路由 handler belt + belt 负测试（P5/P6） | WI-4.2、出口 2 行④ |
| M6 | LOW（捆） | 随 I4 收口 | 刷新链 null 回归测试 + holder 单写入方在案断言 + 手改 enable 启动 loud log + download/delete 轮询 DoS 声明 + manual-nonce 真实强度一句话 + golden 验收记录机器/负载（P7/P8/P9/P10 + 校准项） | WI-4.2/4.3/4.5、i4-implementation-notes |

---

*WP5-I4 实施详案对抗审查 v1.0 — 裁决：PLAN SOUND WITH AMENDMENTS（M1–M3 并入详案文本后开工；M4–M6 随对应工作项落地；无 HIGH、无推翻性缺陷）*
