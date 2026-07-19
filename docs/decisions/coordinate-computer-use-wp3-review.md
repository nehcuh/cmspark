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
