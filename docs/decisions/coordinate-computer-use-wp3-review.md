# 坐标化 Computer-Use WP3 UIA 层与降级链 — 评审结论

> **日期**: 2026-07-19（本机时间锚点 2026-07-19T21:04:53+0800） · **评审 Agent**: Reviewer（只读评审 + 本机复验）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `9983681..HEAD`（6 个 commit，`4bf6a87` UIA 探针 → `f9afc63` F1 测试，+2539/-114 行，18 个文件，工作区干净）
> **基准文档**: `coordinate-computer-use-plan.md` §H WP3 节（plan:258-260）+ §K.5（plan:309 写回防篡改开放问题）、WP1 对抗 Amendments A5 修订要求②（跨进程坐标 DPI 归一化）、WP2 终审 §T6 输入清单
> **复验方式**: 全文逐行读码 + 本机实际执行构建/测试（非转述），证据见 §6

## 裁决: `CHANGES REQUIRED`（单条 MUST-FIX，修复量小，修后快速复审）

WP3 的主体质量高：**降级链语义经逐行复核成立**——UIA 坐标权威 + OCR witness 的设计使「应用自报数据永远让位像素实证」，disagree 降级 L1 的方向正确；L2/L3 stub 诚实标注不伪造结果；WP1 R4 的「独立语义层互证」承诺由 `uia+ocr` 通道真正兑现；uiaCapable 写回的 §K.5 防篡改论证闭环（三态提示非权限位、手设 override 永不覆盖、伪造 verdict 双向无安全获益）；WindowOpened 订阅的 consume-once/容错/隐私规约全部落实；F1 abort 抽取语义逐字保留。本机复跑 tsc exit 0、**410/410 全绿**（与自报基线一致）。

**但有 1 个 MUST-FIX**：R1——三个新 ps1 未做 DPI 感知归一化，直接违反 WP1 对抗 Amendments A5 修订要求②的原文（「所有跨进程坐标（PS 子进程的 **UIA**/OCR 输出）必须在脚本内归一化为物理像素」），uia-locate.ps1 的坐标输出在多屏混合 DPI 下系统性失真。修复有现成模板（computer-capture.ps1:24-25），成本 ≈15 行。

---

## 1. MUST-FIX（R1）

### R1 — A5.2 回归：三个新 ps1 缺 `SetProcessDpiAwarenessContext(-4)`，UIA 坐标在多屏混合 DPI 下系统性失真

- **问题**：WP1 三个脚本（capture/input/windows）均设 `SetProcessDpiAwarenessContext(-4)`（PerMonitorV2，例：computer-capture.ps1:24-25），这是 A5 修订要求②的落地——该修订**明确点名 UIA 输出**：「所有跨进程坐标（PS 子进程的 UIA/OCR 输出）必须在脚本内查询自身 DPI context 并归一化为物理像素后输出」。WP3 新增的三个 ps1 全部缺失（grep 计数：computer-uia-locate.ps1 / computer-uia-probe.ps1 / computer-uia-watch.ps1 均为 0）。PowerShell 进程默认 system-DPI-aware，在**每显示器不同 DPI** 场景被虚拟化——`computer-uia-locate.ps1` 返回的 `BoundingRectangle` 中心/矩形（:80-81）成为虚拟坐标，而 capture 链（PMV2）全程物理像素；`locate-chain.ts:173-179` 以 `uiaHit.x - shot.rect.x` 混算两个坐标系，结果系统性错位。
- **影响面评估（诚实分层）**：
  1. **uia-locate.ps1（主要）**：单屏（含单屏 150%）无影响（system-aware 进程在系统 DPI 下不虚拟化）；**多屏混合 DPI（plan §G.5 明示矩阵项）下 L0 坐标系统性失真**。安全网真实存在：错位导致 witness OCR 系统性 disagree → 降级 L1（locate-chain.ts:187-191，纯像素通道接管，功能自纠正）；错位坐标出界 → OUT_OF_BOUNDS 拒绝（fail-closed）；错位区域内 danger scan 仍是真实像素 OCR。**残余**：witness bbox 同样错位，巧合 agree（错位 bbox 内恰好含锚字符，如重复图标/文字密集 UI）时 pixel-region diff 比对错位区域且两帧通常稳定 → crossverified 注入错位坐标，普通按钮误点由 A2.1 事后通道兜底——低概率但非零；且 L0 在该场景事实上失效（总是降级，WP3 核心交付物名存实亡）。
  2. **uia-probe.ps1（轻微）**：BoundingRectangle 只用于 `Width/Height > 0` 的 on-screen 判定（:73,:82），虚拟化坐标系下宽高仍为正，verdict 不受影响。
  3. **uia-watch.ps1（无直接影响）**：事件只载 controlType/className，不传坐标。按同一纪律统一补齐。
- **为什么算 MUST-FIX**：这是 Amendment 级纪律（A5 修订②）在 WP3 核心交付物（L0 坐标源）上的回归，触发场景是 plan 明示的验收矩阵项；安全网把注入风险降到有界，但坐标系正确性是注入系统地基，不该以「多数情况自纠正」放行。
- **修复要求**：三个 ps1 头部加 computer-capture.ps1:24-25 同款两行（Add-Type DllImport + `SetProcessDpiAwarenessContext(-4)`）；`computer-input-ps1.test.ts` 的静态守卫扩展一条「每个 computer-*.ps1 含 SetProcessDpiAwarenessContext(-4) 调用」的文本断言，防再次回归。

---

## 2. NIT（单列，均不阻塞）

- **N1 — witness 对单字符锚几乎无判别力**：`ocrWitnessAgrees`（locate-chain.ts:83-106）的 corroboration 条件是「bbox+8px 内出现锚的任一字符」。多字符锚（「确定」「搜索」）尚可；**单字符锚**（「×」「▶」「?」）时 bbox 内出现该字符即 agree，corroboration 强度趋零——UIA 坐标在此情形实际上无独立见证。建议 WP7 红队评估，或对 length<2 的锚要求完整词命中才算 agree。
- **N2 — L0 substring 命中（0.8）无独立阈值门，且 witness 对其误匹配结构性失明**：computer-uia-locate.ps1:71 的 substring 匹配（锚「搜索」可命中「搜索结果页」按钮）返回 confidence 0.8，chain 未设 L0 置信度下限（plan §B 的阈值语义仅及 L2 层）。关键是 witness 无法拦截此类误匹配——被误匹配元素的名称本身包含锚字符，witness 必然自洽 agree。后果有界（danger scan + A2.1 兜底），但属 plan §B.2「按 Name 查询」之外的便利特性，建议：substring 命中降格为 corroborate-only（不作坐标源）或列入 WP7 评估。

---

## 3. 做对的地方（按评审重点逐项）

**① 降级链正确性 ✅**：单向降级，每层 attempt 结构化记录 {layer,outcome,reason,confidence,ms} 进 actions.json locateAttempts 与 computeruse.locate 审计（locate-chain.ts:128-133/162-171）；UIA infra 抛错 → error attempt + 降级（:158-164）；L2/L3 stub 记 `wp5-not-implemented`/`wp6-not-implemented` 后抛 ELEMENT_NOT_FOUND 且消息带全链路原因（:330-334）——**不伪造结果**；ambiguous 候选数入日志（:167-168）；帧纪律维持 WP1 R1（superseded 帧仅成功路径释放，throw 归 exit sweep，:230 注释）。

**② uiaCapable 写回防篡改（§K.5）✅**：三态准入提示非权限位的论证成立——全部注入安全不变量（coordinateAllowed/vault-LOLBIN/IL/桌面/danger/预算）独立于该位，手改值最坏换一次浪费的 L0 往返。写回路径：`applyUiaProbedVerdict`（apps/types.ts:216-238）手设 override（有 uiaCapable 无 uiaProbedAt）**永不覆盖**、只触两字段、revalidate 后才返回；`writeBackUiaVerdict`（uia.ts:96-111）fire-and-forget 不拖累任务；executor lazy probe 仅在未探测时触发、失败=honest unknown 不写回（executor.ts:385-426）、证据链记录 verdict 来源（entry/probe/unknown 三态）。**恶意应用伪造 verdict 双向无获益**：伪造 capable=true → L0 先试但坐标须过 witness 像素实证；伪造 false → 仅退回 OCR 层顺序。写回时机论证（任务起始 lazy、非 add-time/launch/后台扫描）在 uia.ts:24-28 落字。

**③ WindowOpened 订阅 ✅**：C# delegate 而非 scriptblock——规避 runspace 线程封送导致事件永不投递的真实坑（computer-uia-watch.ps1:18-22 注释诚实）；进程过滤双侧（ps1 :61 + TS win-adapters.ts:566）；**consume-once**：drain=splice 清空，注入后归因单消费，批准后不重复触发（executor.ts:954-958 注释 + 测试 :277）；factory throw → `computer.uia.watch_failed` 日志 + 任务安全继续（executor.ts:464-472 + 测试 :252）；dispose 覆盖 fail/成功双出口 + ps1 `-MaxSeconds` 自终止 backstop + TS dispose kill 三层防泄漏；**隐私规约双侧一致**：ps1 不发射 element Name（:65-66）、TS 日志只记计数+className（executor.ts:1087-1093）；UIA-blind 残余诚实文档化（通道不存在时 pixel-only，executor.ts:459-463）。

**④ L0/L1 互证语义 ✅**：UIA 坐标权威、OCR witness——disagree 时**信像素不信应用自报**（降级 L1，OCR 接管坐标源，locate-chain.ts:187-191），威胁模型方向正确；语言包缺失时 L0 坐标由 WP1 pixel-region 通道守卫（channel 如实记为 "pixel-region" 而非 "uia+ocr"，:220）；A1 像素新鲜度双层同规（不稳定 → 产出层一次 live re-probe → 成功 honestly uncrossverified / 失败 STALE_SCREENSHOT，:225-257）。**WP1 R4 承诺在此兑现**：`crossverifyChannel` 首次有了真正的独立语义层互证值 "uia+ocr"。

**⑤ F1 abort 抽取 ✅**：与 WP2 内联版逐字一致——`*` 恐慌全置、单任务定向、标志翻转无条件（set 在 send 前）、仅 ack 受 OPEN 门控（server.ts:217-247 vs 旧 :3085-3095）；dispatch 改一行调用（:3080-3082）；4 测试态含「socket 关闭时中止仍生效无 ack」（computer-task-abort.test.ts:106）。

**⑥ 顺带关闭的既有项**：Y6 全四小项（OCRFAILED→OCR_FAILED 映射 win-adapters.ts:46、runPs maxBuffer 16MB powershell.ts:112、ensureLanguage 获调用者 executor.ts:438-451、预算续期公式统一 :607-610）；Y-e（WP2 终审发现）：server.ts:3181 广播镜像 broadcastToClients 认证过滤；BOM 守卫扩展至 7 脚本（computer-input-ps1.test.ts:19-27，三个新 ps1 实测均 efbbbf）。

---

## 4. §H WP3 验收核对

> 依据 `coordinate-computer-use-plan.md:260`：「Chrome 窗口走 L0 命中、自绘夹具自动降级 L1、混合层任务日志完整」。

| 验收项 | 结论 | 说明 |
|---|---|---|
| Chrome 窗口走 L0 命中 | **真机项（开放）** | 只读验证（uia-locate.ps1 对 Chrome 窗口查询），不涉及注入——Chrome 的 vault 结构排除只禁注入路径，不妨碍 L0 定位验证本身。需 owner 在场执行留痕。 |
| 自绘夹具自动降级 L1 | **开发者自报夹具 e2e / 建议 owner 复验** | commit message 数据具体（UiaMode=on → nodes=3 namedOnscreen=1 capable；off → nodes=1 namedOnscreen=0 blind；死 hwnd → HWNDDEAD exit 4），形态符合 WP1 留痕惯例；评审未独立复跑（真机项）。单测侧「UIA-incapable → L0 skipped → L1 pixel-region」已锁定（computer-locate-chain.test.ts:375）。 |
| 混合层任务日志完整 | **✅ 代码级关闭** | 每层 attempt 结构化入证据链 + 审计日志，降级原因全覆盖（uia-not-found/uia-ocr-disagree/ocr-language-missing/wp5/wp6-stub），测试锁定（:348-388）。 |

另注：R1 修复后建议把「多屏混合 DPI 下 L0 坐标一致性」补入 §G.5 真机矩阵复查项（单屏 150% 已在矩阵内）。

---

## 5. 文档残项评估（确认可留 follow-up，不阻塞）

| 项 | 状态 | 评估 |
|---|---|---|
| Y8（seal/imgdiff ps1 注释坐标系措辞） | 未修 | 两行注释措辞（computer-evidence-seal.ps1:15 / computer-imgdiff.ps1:20「window-client px」应为图像空间），纯文档修正无行为影响。**不阻塞**；与 R1 修复同批顺手做。 |
| Y10（DPAPI 威胁模型落字） | 未修 | 注释/文档补写（evidence.ts 头注 + plan §E.5「同用户进程可 Unprotect」）。**不阻塞**。 |
| Y-a（estop 孤儿驻留） | 未修 | 驻留 helper 无副作用（ready.json 幂等、50ms 轮询空转 ≈0 成本），文档化或退出钩子均可。**不阻塞**。 |
| Y-b（flag/ready 路径可预测） | 未修 | 双向均为安全方向（伪造 flag=中止、删 ready=拒飞），文档化即可。**不阻塞**。 |
| Y-c（RDP 热键盲区） | 未修 | 已入 WP2 终审真机清单 E 项。**不阻塞**。 |
| Y-d（速率门重启重置） | 未修 | LLM 无重启 companion 路径，残余有界，文档化。**不阻塞**。 |

---

## 6. 本机复跑记录（非转述）

- 时间锚点：`date '+%Y-%m-%dT%H:%M:%S%z'` → **2026-07-19T21:04:53+0800**。
- 编译：`cd companion && node node_modules/typescript/bin/tsc -p tsconfig.test.json` → **exit 0**。
- 门禁套件：`node --test .test-dist/tests/computer-*.test.js .test-dist/tests/apps-*.test.js .test-dist/tests/integration/computer-*.test.js` → **tests 410 / pass 410 / fail 0**，duration ≈ 1.65s。与自报基线一致（369 → 401 → 406 → 410 只增不减：+16 写回/verdict、+16 链、+5 watcher、+3 abort+守卫，算术吻合）。
- 范围核对：`git log 9983681..HEAD` = 6 commit；`git diff --stat` = 18 文件 +2539/-114；`git status` 干净。
- BOM 实测：三个新 ps1 头部均为 `efbbbf`（xxd 实测）。

---

## 结论

R1（三个 ps1 补 PMV2 + 一条静态守卫断言，预估 ≤20 行）修复后本评审可转为 **APPROVED**。N1/N2 不阻塞，归 WP7 红队或 WP3 收尾小批；Y8 建议与 R1 同批顺手关闭。WP3 的降级链、写回防篡改、WindowOpened 通道、F1 抽取在 R1 之外无需任何代码改动——四层定位的语义骨架是扎实的。真机遗留两项（Chrome L0 命中、夹具降级复验）按 WP1/WP2 同标准留痕后闭合 WP3 验收。

---

# 终审（2026-07-19 23:25 +0800）

> 范围：`9983681..HEAD` 修复批次 6 commit（`0797320` R1+Y8、`5822524` X1、`76b2f4f` X2、`a1613ca` Y4/Y5+Y3、`1a3c6dd` Y10+Y-a~Y-d、`47396a5` 文档入库），工作区干净。以下每条均为逐行复读 diff + 亲跑门禁后的独立确认，非转述开发者自报。

## T1 修复批次逐条确认

| commit | 项 | 结论 | 关键证据（文件:行号） |
|---|---|---|---|
| `0797320` | R1（三 ps1 补 PMV2） | ✅ 真修复 | `computer-uia-locate.ps1:28-29`、`computer-uia-watch.ps1:41-42`、`computer-uia-probe.ps1:36-37` 与 `computer-capture.ps1:24-25` 同款两行（Add-Type + `SetProcessDpiAwarenessContext(-4)`，try 包裹不破坏旧系统）；静态守卫 `DPI_AWARE_PS1` 名单+逐脚本文本断言（`computer-input-ps1.test.ts:67/77`）——再新增 coordinate-emitting ps1 漏加即红 |
| `0797320` | Y8（seal/imgdiff 注释坐标系措辞） | ✅ 真修复 | `computer-evidence-seal.ps1:16`、`computer-imgdiff.ps1:21` 均改为「bitmap's pixel space, NOT window-client space」 |
| `5822524` | X1（witness 定量化） | ✅ 真修复 | 双上限双侧执行：ps1 源端丢弃+计数（`computer-uia-locate.ps1:99-100`，三处输出 JSON 均带 `oversized`），TS 侧 `WITNESS_BBOX_MAX_AREA_PX2`/`WITNESS_BBOX_MAX_WINDOW_RATIO` 复核（locate-chain.ts `ocrWitnessCheck`）；强度三规则（多字符锚=连续重构或 coverage>=1；单字符锚=bbox 内整词全等，吞掉首轮 N1）；歧义 candidates>1 强制 uncrossverified+无 channel+吃子预算；`WitnessVerdict` 七字段进证据（evidence.ts witness 字段、executor.ts:715 取值、:1033 落盘，含 L0→L1 降级路径「拒绝须说因」）；5 对抗测试（超大 bbox 吞锚/单字重叠/单字正例/多字重构正例/歧义首选） |
| `76b2f4f` | X2（watcher 生命周期） | ✅ 真修复 | ① ready 握手：ps1 订阅失败 `exit 5` 先于 ready 打印（`computer-uia-watch.ps1:90-101`）；工厂 Promise 仅在 `{"ready":true}` 后 resolve，pre-ready 退出带 stderr 尾拒（win-adapters.ts:675）、10s 超时 kill+拒（:683）→ `watch_started` 永不为死通道而记（executor.ts:492-497）；② exit/error 置死+exitCode（win-adapters.ts:640-646），executor 下一 drain 记一次 `watch_died` 并置空（executor.ts:992-1001），evidence finalize 双出口均带 `uiaWatcher {started,died,exitCode}`（executor.ts:372 失败路、:1170 成功路）；③ `min(3600, max(600, budget*130+900))` 对齐预算（executor.ts:491）+ ps1 父进程轮询孤儿守护（computer-uia-watch.ps1:107-114）；④ 缓冲上限 256 + 溢出合成弹窗标记 fail-safe（win-adapters.ts:540、:578）；4 测试（拒握手不记 started/中途死亡记一次+证据离线/溢出标记/win32 真 ps1 冒烟） |
| `a1613ca` | Y4（锚匹配大小写） | ✅ 真修复 | exact 路径改 `$norm.Equals($anchor, [StringComparison]::OrdinalIgnoreCase)`（`computer-uia-locate.ps1:83`），与 substring 路径 ToLowerInvariant 同为文化无关，Turkish-i 边角消除 |
| `a1613ca` | Y5（uiaCapable 未纳入结构排除） | ✅ 真修复 | `normalizeAppEntry` 对 vault/LOLBIN 强制清 `uiaCapable`/`uiaProbedAt` 并响亮记日志，changed 判定覆盖两新字段（apps/types.ts:264-291）；coordinateAllowed 仍是实际门禁，此为纵深防御，语义正确 |
| `a1613ca` | Y3（watcher pid 过滤逃逸） | ✅ 文档化（接受） | `computer-uia-watch.ps1:18-23` 头注 + executor.ts:482-489 注释：同 app 异 pid 弹窗为明示残余，界定为 Assert-Landing（OCCLUDED 拒注入）+ 前台通道兜底。多进程跟踪属范围扩张，文档化可接受 |
| `1a3c6dd` | Y10（DPAPI 威胁模型落字） | ✅ 真修复 | `evidence.ts:15-21` 头注 + plan §E.5 第 5 条（plan:219）：同用户进程可 Unprotect 明示接受，DPAPI=静态/离线边界；A7 修正案优先于 v1 不模糊措辞的另注一并落地 |
| `1a3c6dd` | Y-a~Y-d（estop/速率残余） | ✅ 文档化（接受） | plan §E.6 第 4 条（plan:226-230）：孤儿驻留≈0 成本、路径可预测双向落安全侧、RDP/锁屏盲区留真机 F2-E、速率窗重启重置有界——与首轮 §5 评估一致的处置 |
| `47396a5` | 评审+对抗文档入库 | ✅ | 本文件与 `coordinate-computer-use-wp3-adversary.md` 入库，修复回路输入留痕 |

**Y1/Y2 状态（对抗批次内 SHOULD，本批未修，如实记录）**：

- **Y1（screen→image 映射竞态）— 开放，归 WP7**：`locate-chain.ts:242` 仍用**捕获时刻** `shot.rect` 映射实时刻 UIA 屏幕坐标，ps1 未改返回 client 空间坐标，竞态类未从源头消除。但可利用面已被本批两道闸收窄：X1 强化后的 witness 对「窗口移动→bbox 错位」必然 disagree 降级 L1；A1 像素新鲜度 diff（:279-291）在注入前接住位移。残余为对抗文档原述的「均匀背景+持续抖动」边角，概率性、幅度限于单步位移。处置建议不变（ps1 读树时减活动客户端矩形，源上消掉整类）。
- **Y2（verdict 永久化/refresh 死分支）— 开放，归 WP7**：executor 仍仅 `uiaCapable === undefined` 时探测（executor.ts:437），写回后终身不再验；`applyUiaProbedVerdict` 的 refresh 允许分支（apps/types.ts:217）从 executor 不可达。exe drift 检查挡住换 exe，内容级变化不触发重探。处置建议不变（TTL 重探 / 删死分支并在 §K.5 写明「一次探测终身有效」为显式决策，二选一）。无安全不变量依赖该位（首轮 ② 已论证），故维持 SHOULD。

## T2 X1 重点复核专项（witness 定量化的数值与语义合理性）

1. **双上限数值自洽**：150_000px² ≈ 387×387，远大于正常交互元素（按钮实测 ≈5-12k px²），误伤面≈0；小窗口时面积比 0.3 主导、大窗口时绝对值主导，两上限各管一段。超大容器锚点被超限丢弃的代价是降级 L1 OCR——fail-safe 方向，非功能失败。
2. **无误伤既有路径**：witness 只在 L0 分支 `if (uiaHit)` 内运行，L1 OCR 单通道路径（UIA-blind 应用、WP1 既有行为）不经过 `ocrWitnessCheck`，基线测试无回归印证（420/420 中含全部 WP1/WP2 用例）。
3. **语义分层清楚**：witness disagree（矛盾）→ 不信 UIA 自报、OCR 接管坐标源（L1）；歧义多候选（不矛盾但不可证）→ 保留 UIA 坐标但降格 uncrossverified 吃 A1.3 子预算。前者是安全降级，后者是记账降格，两层不混。
4. **fail-closed 方向核验**：超大 bbox「永不 agree」且 ps1 源端即丢弃（攻击者无法靠注入伪造 oversized 计数旁路，TS 侧独立复核同一双上限）；强度不足=disagree=降级，无「弱互证拿满血徽章」路径；证据七字段让每次拒发徽章都可审计。

## T3 X2 重点复核专项（watcher 生命周期的降级诚实性）

1. **握手无伪阳性**：ps1 在 `AddAutomationEventHandler` 成功后才打印 ready（:90-101），订阅失败 `exit 5` 带 WATCHFAILED 到 stderr——工厂拒信附 stderr 尾（win-adapters.ts:675），三种失败（pre-ready exit/超时/spawn error）全部走 `watch_failed`，`watch_started` 只在 Promise resolve 后记录（executor.ts:494）。
2. **死亡降级路径诚实**：watcher 死后通道确实静默（drain 归空），但证据 finalize 如实记 `{started:true, died:true, exitCode}`——通道离线状态可审计，不再「证据声称在线」。静默退回 WP2 基线（pixel-diff+前台+top-level-hwnd 通道仍在）可接受，因 watcher 是纯加法 OR 通道，且 X2 ① 的「factory 失败安全继续」语义在全链路一致。
3. **backstop 对齐算术核验**：`budget*130+900`（单动作上限 130s × 预算动作数 + 15min 余量）clamp 进 ps1 的 [600,3600] 区间，不会小于 ps1 默认也不会溢出；孤儿守护用缓存 `Process` 句柄的 `HasExited`（每轮实时查 OS），父死即 break 退出，崩溃 companion 不留轮询 watcher。
4. **缓冲 fail-safe 核验**：溢出时丢最新、置 overflowed，下一 drain 追加 `(watcher-buffer-overflow)` 合成事件——事件洪峰读作「有弹窗」→ 对话不变量暂停任务，方向正确；丢弃的是最新而非最旧，早期弹窗（更可能是攻击起点）保留，取舍合理。

## T4 本机复跑记录（终审，非转述）

- 时间锚点：`date '+%Y-%m-%dT%H:%M:%S%z'` → **2026-07-19T23:25:12+0800**。
- 编译：`cd companion && node node_modules/typescript/bin/tsc -p tsconfig.test.json` → **exit 0**。
- 门禁套件：`node --test .test-dist/tests/computer-*.test.js .test-dist/tests/apps-*.test.js .test-dist/tests/integration/computer-*.test.js` → **tests 420 / pass 420 / fail 0**，duration ≈ 2.4s。基线算术吻合：410（首轮实测）+ 1（R1 DPI 静态守卫）+ 5（X1）+ 4（X2）= 420，只增不减。
- 范围核对：`git log --oneline 9983681..HEAD` = 12 commit（6 feat + 6 fix 修复批）；`git status --porcelain` 空（干净）。
- 抽查真实 ps1 行为：三新 ps1 头部 BOM 在首轮已实测 efbbbf，本批改动文件 commit message 均自报 BOM 复核+PARSE_OK，与 diff 所见无 BOM 破坏迹象一致（未复测，转述标注）。

## T5 最终裁决

## 裁决：`APPROVED WITH FOLLOW-UPS`

首轮唯一 MUST-FIX（R1）与对抗批次两条 MUST（X1/X2）均为**真修复且带性质测试**；SHOULD 级 Y4/Y5 真修复，Y3/Y10/Y-a~Y-d 按评审预期文档化；门禁 410→420 只增不减，tsc 干净。WP3 四层定位链可入库。

**Follow-ups（均不阻塞，已显式归口）**：

1. **Y1 → WP7**：ps1 直接返回 client 空间坐标，从源头消掉三时刻矩形竞态（残余已被 X1 witness + A1 新鲜度收窄至「均匀背景+持续抖动」边角）。
2. **Y2 → WP7**：verdict TTL 重探，或删 refresh 死分支并在 §K.5 写明「一次探测终身有效」为显式决策（二选一）。
3. **N2 → WP7 红队**：L0 substring 命中降格 corroborate-only 或评估（首轮已列）。
4. **真机两项 + 混合 DPI 矩阵**：Chrome 窗口 L0 命中留痕、自绘夹具降级复验（首轮 §4）；「多屏混合 DPI 下 L0 坐标一致性」随 R1 修复一并纳入 §G.5 真机矩阵复查——三项均只读/夹具级，owner 在场执行后闭合 WP3 §H 验收。

> 本终审段落为追加，首轮评审（§1-§6 及结论段）原文保留未改。首轮结论段中「R1 修复后本评审可转为 APPROVED」的条件已由本终审确认达成；最终状态以 T5 裁决为准。
