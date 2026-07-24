# WP5-I4 实施笔记（实验层用户开启路径）

> 立项：plan:527-615「WP5-I4 实施详案」+ 对抗修订 P1-P10（`coordinate-computer-use-wp5-i4-plan-adversary.md`：PLAN SOUND WITH AMENDMENTS）。
> 落地：`36780fb`（WI-4.1）→ `b087696`（WI-4.2）→ `bc12053`（WI-4.3）→ `2747477`（WI-4.4）→ 本笔记随 WI-4.5 提交。
> 门禁：companion tsc 绿 + computer/apps 套件 **621 → 660**（WI-4.1 +6 / WI-4.2 +15 / WI-4.3 +19 / WI-4.4 +4 / WI-4.5 +1 P7）；chrome-extension tsc 绿 + 套件 **176 → 196**（+20）。

---

## 1. O-1 四写入点可达性分析表（出口标准 2，I4 评审逐点重做）

| 写入点 | 触发条件 | 围栏 | 伪造路径排除 | 测试锚 |
|---|---|---|---|---|
| ① server.ts:2001 邻位 admission 实参 | per-task `resolveTinyClickAdmission({config, holder, deps})`（runComputerTask 前 await） | 纯函数六路 fail-closed 矩阵；config/holder/deps 外零输入 | executor 刷新链 `tinyclick:null`（executor.ts:993）显式不动；**P7 回归测试结构锁定**（admission ON + 刷新 L1 miss → tc 零调用 + 日志仅 refresh:null 跳过） | computer-model-admission.test.ts（13）+ computer-executor.test.ts P7 |
| ② holder 写入 | admission 全通过懒建（写入点①=model-admission.ts:227）/ disable·delete dispose 后置 null（model-handlers.ts:278/:408） | 进程级单例 + WeakMap 并发首建单飞 + stillEnabled 落地竞态复核 | 并发首建测试（sessionFactory 仅 1 次）；**P8 提交时点 grep 证据**（§2）+ 符号级注释契约（model-handlers.ts:40-45，admission 测试锁行为面） | computer-model-admission.test.ts 并发/竞态/翻转用例 |
| ③ config 五字段（P1 增文本哈希） | set_enabled（D2 生物识别门）/ license_response handler | validateWsMessage 形状 + handler belt 复核 source + 门（enable）+ normalize 防篡改（形状 coerce/delete + loud log） | 手改 config = 显式 owner opt-in（裁决 3，§3 文档化）+ 启动期醒目 loud log（P9，normalize cache-miss 路径每进程一次） | config.test.ts / computer-model-handlers.test.ts（25） |
| ④ WS 六路由（get_state/set_enabled/license_response/download/delete/reset_circuit_breaker） | 扩展设置页（background 透传白名单六 case） | source:"settings" 双层（validateWsMessage + handler belt，P6）+ enable 生物识别门（裁决 1） | 未知类型默认放行故此六条目真围栏；belt 四负测试（P6）；扩展透传不注入 source 以外信任 | validateWsMessage 负测试 + belt 四负测试 + chrome-extension 套件 |

## 2. P8 holder 无第二写入方（提交时点 grep 证据，2026-07-21）

```
$ grep -rn '\.session = ' companion/src/ --include='*.ts'（排除比较运算）
src/computer/model-admission.ts:227:  args.holder.session = session; // P8 写入点①：admission 全通过懒建
src/computer/model-handlers.ts:278:          holder.session = null     // 写入点②：disable dispose 后
src/computer/model-handlers.ts:408:        holder.session = null       // 写入点②：delete dispose 后
src/computer/tinyclick-locator.ts:104: this.session = deps.session;    // 非 holder——locator 私有字段（deps 注入），非同对象

$ grep -rn 'computerModelSession' companion/src/ --include='*.ts'（model-handlers.ts 外）
src/server.ts:2006/2009：仅 import + 作为 admission holder 实参（只读传递）
```

结论：holder 写入仅 admission/disable/delete 三处（测试注入为写入点③，注释契约明载）；server.ts 无写；扩展无从触及（进程边界）。

## 3. 裁决 3 文档化：手改 config 的语义继承

手改 `config.json` 置 `modelEnabled:true` + 合法 `modelLicenseAcceptedAt`/`modelLicenseAcceptedTextHash`（当前 LICENSE_DOOR_TEXT 的 sha256 前 12 位）= **显式 owner opt-in**（ADR-010 主开关/god-mode way B 同型先例），admission 放行；normalize 只防篡改形状（非布尔 coerce false、非 ISO delete、哈希形状 `/^[0-9a-f]{12}$/` 不符 delete、variant 非枚举回退 hybrid，全 loud log），不撤销合法布尔。启动期 cache-miss 路径打醒目 loud log「实验层经 config.json 手动开启，ADR-010 opt-in」（P9；每进程一次不刷屏，setter 直写缓存不触发）。**「生物识别门可绕」双标叙事由此消解**：门防的是 LLM 驱动/脚本化 WS 客户端静默开启；本机文件系统写权限本就在 ADR-010 信任边界内。

## 4. manual-nonce 降级真实强度（对抗轮校准项，一句话）

D2 生物识别门的 manual-nonce 降级（Hello 不可用时的手动确认串）防的是 **LLM 工具循环**（模型无法可靠复现逐字输入），**不防**有 shell 能力的同级脚本（nonce 可读可回声）——D2 门族固有边界，非 I4 新引入；license/download/delete 不过门即据此权衡（裁决 1：三者均非能力授权本体，settings 双层围栏已足）。

## 5. P10 download/delete 轮询 DoS 残余声明

幂等只防并发（进程级 activeDownload 单飞）不防轮询：已认证同级用户可循环 download/delete 烧网络与磁盘时间。**损害有界**：磁盘预算 `modelDiskBudgetMB`（默认 2048MB）封顶塞盘面；占位主机 `.invalid` + 未配镜像 = 零网络 fail-fast（裁决 5）。**高度可见**：审计事件 `computer.model.download.*` + 状态广播全留痕。不加频率上限（复杂度不值）；如需升级，备选 = 每连接频率上限（apps `evidence.open` P6 先例）。

## 6. 任务内 admission 不收回（攻击面 3 登记的设计取舍，I4 评审接受）

admission per-task 组装：任务执行中途 `set_enabled(false)` **不影响当次任务**——已组装的 locator 用至任务结束，下一任务起生效。文案侧已闭环（P2：开关旁注 `switchRunningNote` + `layerSemantics` per-task 语义 + Ctrl+Alt+End/中止任务 estop 引导——被坏建议惊动而关开关的用户恰是最需要 estop 引导的人）；**立即停止的真实通道 = estop 三通道**（热键/面板中止/预算耗尽 re-L2），非开关。另：build 落地 × 关闭竞态经 `stillEnabled()` 新鲜度复核（admission 落地前重读 config，已关 → dispose 新建会话不写 holder，~1.3GB RSS 泄漏面闭合）。

## 7. golden 双臂验收记录（出口 3；admission 接线后真机重跑）

- **运行机**：Intel i9-14900KF（P 核 8，intraOp=8 映射命中）、32 逻辑核、64GB RAM（运行时 free ~46GB）、Windows 11（10.0.28000）；桌面交互态轻负载（无并发压测/编译）。
- **结果**：`verify-tinyclick-golden.js --variant hybrid` **16P/3R/0F**（延迟臂基线 737.3ms ×2.5=1843ms 上界）；`--variant int8` **17P/2R/0F**（基线 1182.0ms ×2.5=2955ms 上界）——与 F-1 修复后冻结基线完全一致，准确率臂锚无漂移。
- **开启态冒烟（出口 4）**：`verify-tinyclick-enable-smoke.js` 双臂全绿（hybrid 41 项断言 / int8 全断言）——注入点 vs frozen 锚 dist：hybrid **0.0px**（(481,169)）、int8 **0.0px**（复跑）/ 1.0px（首跑），sanity 上界 64px 仅为冒烟级，精度判定归 golden 门禁。

## 8. 出口 4 冒烟断言明细（verify-tinyclick-enable-smoke.js，自动臂）

fail-closed 基线（model-switch-off）→ license_required（config 零写入 + MIT 全文/Samsung 版权行/Ethics 双引/实测披露四段标记）→ license_response accepted（时间戳 + 12 位文本哈希 + **download-host-unset 零网络**——零进度广播为证据）→ 生物识别门双路（拒绝 BIOMETRIC_DENIED 零写入 / 批准 enabled 且 config.json 持久化）→ admission 真会话（I1 复验 + warmup，junction 指向 spike 模型目录）→ **拒绝臂**：caption 含「实验层建议（TinyClick 本地模型，未校准，可能完全错误）」+ dangerousApis 标 `computer.experimental_suggestion` + autoConfirmEligible=false + ELEMENT_NOT_FOUND 诚实降级 + 零注入 + completedActions=0 + 无后续 tinyclick hit → **批准臂**（M1 形态，3 直接点击建预算上下文）：G4 门 + A1.3 续期门（「交叉验证」）各一次 + 建议点真注入 + completedActions=4（**批准后才耗预算**，与拒绝臂 0 对照）+ 证据链 layer=tinyclick + uncrossverified + confidence 缺省（G3）。

**手动臂（发版前人工 checklist）**：真 Windows Hello 弹窗批准/拒绝各一（`security.biometric.*` 审计留痕）+ 设置页真弹窗渲染许可证全文 + 真机关闭开关观察任务运行中旁注。自动臂 fake 门已覆盖逻辑双路；Hello 实机面属 D2 门族既有验收（apps.set_coordinate_allowed 同门），不重复阻塞本迭代。

## 9. 对 plan 文字的偏离登记（均收敛语义，不改契约）

1. **holder Pick 面未扩**（plan:545 原案「holder Pick 面增 locator 只读访问」）：改采 `sessionMeta` WeakMap（session → 同实例 tokenizer/locate 绑定）——holder 四方法面不动（WI-4.2 已交付的 handler/测试零 churn），tokenizer 零分叉契约由构建期配对保证；外来会话（非 admission 构建）fail-closed `model-session-foreign`（无法保证同实例，宁可不开层）。
2. **P4 豁免复用 `disposed` 标志**（原案「增 private disposing」）：dispose() 首句同步置位 disposed，无置位前窗口，`if (this.disposed)` 即等价覆盖「dispose 发起后/进行中」——少一个状态位，语义相同；豁免形态 = 不计 faults/不熔断/不广播 + `fault-suppressed` 审计留痕（M6 冷启动排除语义扩展）。
3. **modelError family → `computer.model`**：扩展按 family 把模型错误路由到设置页实验区错误位（apps family:"apps" 先例）；BIOMETRIC_DENIED 等共享 code 在 apps/computer 流间不可分，family 是唯一无歧义路由键；旧扩展忽略 family 落 chat 流，向后兼容（WI-4.4 内修订，测试断言同步）。
4. **MODEL_STATE_MESSAGES 补 `circuit-breaker` 词表**：I2 熔断广播 reason 长期无文案条目（设置页 I4 才落地消费面），补齐并锁「无自动恢复 + 不受影响」双语义断言。
5. **镜像文案表**：扩展 model-switch-logic.ts 逐字镜像 MODEL_STATE_MESSAGES/MODEL_SWITCH_COPY（companion 单一真源，两侧文案断言互锁：computer-model-states.test.ts ↔ model-switch-logic.test.ts）；许可证门全文不镜像——渲染 license_required 载荷原文。

## 10. 冒烟 harness 事故与纪律（fixture.png 扫除事件，2026-07-21）

首跑冒烟时 fake capturer 直接把 **spike fixture.png 本体路径**交给 executor——R1 raw sweeper 在任何出口删除 raw 帧（生产语义：采集帧 = 任务所有 transient），fixture.png 被真删。处置：① smoke 改为每 capture 复制隔离副本（脚本内醒目注释，防再犯）；② **禁止**从 fixture.jpg 再编码顶替（jpg 压缩 artifact 使 int8 边际 case f-ok-en 漂移 591.5px 超容差——像素地基即 frozen 锚地基）；③ 正确复原 = 重跑 `s3-fixture-render.ps1`（owner-draw 矢量直出 PNG，ground-truth 像素 by construction）。复原后 golden 双臂与冒烟双臂全部重跑刷新证据（§7）。教训入档：**任何把既有文件路径交给 executor 的 harness，都必须先确认该路径可被 sweeper 删除**。

## 11. 出口标准总账

| # | 标准 | 状态 | 证据 |
|---|---|---|---|
| 1 | WI-3.4 原文出口闭环 + P2 挂钩 | ✅ | companion 659/660 套件含 layerSemantics per-task + estop 引导断言；扩展 model-switch-logic.test.ts 运行中旁注判定；无乐观更新/拒绝永久跳过测试在案 |
| 2 | O-1 四写入点可达性分析表 | ✅ | 本文 §1（逐点重做）+ §2 grep 证据 |
| 3 | golden 双臂重跑全绿 | ✅ | §7（hybrid 16P/3R/0F、int8 17P/2R/0F） |
| 4 | 开启态冒烟 | ✅ | §8 自动臂双臂全绿（caption/拒绝降级无污染/uncrossverified/预算批准后耗） |
| 5 | license 门 | ✅ | WI-4.2 套件（零写入/时间戳+哈希/漂移重门/LICENSE_DECLINED）+ §8 冒烟四段标记 |
| 6 | 生物识别门同级 | ✅ | WI-4.2 fake 门双路测试 + §8 冒烟双路；真 Hello 手动臂 checklist（§8 末） |

**I3 留账四项全部收口**：①WS 开关族（WI-4.2）②config 字段（WI-4.1）③admission 组装（WI-4.3）④扩展用户面（WI-4.4）。
