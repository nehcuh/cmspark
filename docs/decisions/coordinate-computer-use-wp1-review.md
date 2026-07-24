# 坐标化 Computer-Use WP1 最小回路 — 评审结论

> **日期**: 2026-07-18 · **评审 Agent**: Reviewer（只读评审 + 本机复验）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `56903c9..e9c48cd`（5 个 commit，+4299/-12 行，30 个文件）
> **基准文档**: `coordinate-computer-use-plan.md`（含顶部 Amendments A1–A10，冲突以 Amendments 为准）、`coordinate-computer-use-adversary.md`
> **复验方式**: 全文逐行读码 + 本机实际执行构建/测试（非转述），证据见 §6

## 裁决: `CHANGES REQUIRED`

WP1 的骨架是扎实的：A3 语料绑定全链、A4 无放行路径硬拒、A10 双开关 default-deny、fail-closed 错误分类学、可注入接口与性质断言测试都落到了位，构建与 81 个新增测试本机复验全绿。**但有 5 个 MUST-FIX**：其中 R1（原始截图在 %TEMP% 明文泄漏、无 TTL 覆盖）与 R3（A2.2 词库漏 bare "Pay"，区域硬拒出现空洞）直接触及强制修订 A7/A4 的核心承诺；R1 在真实 OCR 延迟下几乎每次 OCR 定位点击都会触发，不是边角路径。全部修复均为小范围局部改动（每条 ≲30 行），修后可快速复审。

---

## 1. MUST-FIX（R1–R5）

### R1 — A7：未加密原始截图在 %TEMP% 持久泄漏（陈旧替换路径 + 全部错误路径）

- **问题**：`PsScreenCapturer.captureWindow` 把原始窗口截图写到 `%TEMP%\cmspark-computer\cap-*.png`（`companion/src/computer/win-adapters.ts:58-62`），只有「成功走到 seal」的帧才会被 sealer 删除。两条泄漏路径：
  1. **A1 陈旧检查路径**：`executor.ts:271` 基准帧 raw1 → `executor.ts:289` 重截 raw2 → 无论 diff 是否超阈值，`executor.ts:298/304` 都用 fresh 替换 shot，**raw1 在两个分支都被遗弃**，既不 seal 也不删除。真实环境 OCR ≥300ms 是常态（`PIXEL_STALE_MS=300`，`types.ts:72`），即几乎每次 OCR 定位点击都泄漏一张明文全窗截图。
  2. **错误路径**：`ELEMENT_NOT_FOUND`（`executor.ts:282`）、`STALE_SCREENSHOT`（:296）、`OUT_OF_BOUNDS`（:332）、`DANGER_HARD_DENY`（:353/:360）、注入失败（:438）等任何 capture 之后的失败退出，`fail()`（:141-156）只做 finalize，不清理 raw。
- **为什么算 MUST-FIX**：A7 的裁决是「原始像素永不写盘（持久化）」+ 全持久化面级联；这些 raw 是**未加密、未模糊、无 TTL** 的全窗截图（可能正显示凭证），落在任何备份软件/他用户可读的 %TEMP%，且 janitor（`evidence.ts:149-170`）只管 evidence 目录，没人扫这里。这恰是 A7 攻击场景描述的情形。
- **修复要求**：① executor 跟踪本任务产生的全部 raw 路径，`fail()` 与陈旧替换点 best-effort 删除；或②把临时捕获目录改到 evidence 任务目录下，让 sealer/janitor 生命周期天然接管；③janitor 或启动 sweep 覆盖临时捕获目录。任选一，需补「错误路径无 raw 残留」的性质测试。

### R2 — A7.4：screenshot/describe 只读帧落盘前未做凭证区域模糊

- **问题**：`executor.ts:233-239` 对只读动作固定传空 `blur`；describe 已经跑过 OCR（:236）却不复用其结果算 `credentialRects`，screenshot 则完全不检测。注入类动作的 before/after 帧有模糊（:394-395 + `danger.ts:96-106`），只读帧没有——证据链里反而多了无模糊的帧。
- **修复要求**：describe 路径用已有 OCR 结果过 `scanDanger` 取 `credentialRects`（零额外成本）；screenshot 路径要么同样过一遍凭证词 OCR 再 seal，要么在方案文档明示接受该残余并记录理由。补断言「describe 帧的 credentialRects 透传 sealer」的测试。

### R3 — A2.2/A4：危险词库漏 bare "Pay"，区域硬拒存在空洞；拉丁词元需边界匹配

- **问题**：`danger.ts:19-26` HARD 集含 "pay now"/"payment" 但**不含 bare "Pay"**——A2.2 修订要求显式枚举的词表里有 "Pay"。一个文字恰为「Pay」的按钮出现在预点击区域时，`matchWords`（:59-67）无任何命中 → regionLevel=none → 最终确认支付点击**不被硬拒**，A4 禁区出现可点击路径。同函数纯子串匹配还造成反向误伤："pin"⊂"shopping"（任意含 shopping 的窗口 type 全灭）、 "format"⊂"information"（区域内出现 information 即无谓 re-L2）。
- **修复要求**：① HARD 集补齐 A2.2 枚举的缺失词元（至少 bare "Pay"，并复核 "Confirm" 等通用词的取舍理由写进注释）；②拉丁词元改词边界匹配（`\b`），CJK 词元保持子串；③为「区域仅含 "Pay" 的点击 → DANGER_HARD_DENY 且无 re-L2」与「窗口含 shopping/information 不触发」各补一条性质测试。

### R4 — A1.2：「独立层交叉验证」降级语义不诚实，证据链 `crossverified=true` 言过其实

- **问题**：WP1 只有 OCR 单层，A1.2 的「OCR↔UIA/模型互证」结构上不可得。实现把降级做成「窗口存活 + 标题非空探针」（`executor.ts:309-313`）——它验证的是 hwnd 活性（且与 :250-252 的逐动作归属重查完全重复），**对 ~200×200 目标区域内容零验证**，却把 `crossverified: true` 写进证据链（:313、:404、测试 `computer-executor.test.ts:189` 还固化了这个语义）。审计记录因此声称「经独立层交叉验证」，实际没有。
- **修复要求**（二选一，均需在文档同步降级语义）：① 诚实降级——WP1 内 OCR 命中一律记 `crossverified=false`，与图标点击同吃 ≤3 未交叉验证子预算（A1.3 的保守读法）；② 实质降级——用**像素通道**做 WP1 替身：对 200×200 区域裁片在定位帧/注入前帧间跑 imgdiff（独立于 OCR 的通道），区域稳定才记 crossverified，并把「这是像素稳定性互证、非语义互证」写进证据记录字段名/注释与方案 WP1 节。无论哪条，`computer-executor.test.ts:180-192` 的断言要跟着改。

### R5 — A4 分类越界：type 动作遇窗口级 HARD 词被「无路径硬拒」

- **问题**：type 动作的危险扫描区域被设为整窗（`executor.ts:347`），于是 `scan.regionLevel === "hard"` 等价于「窗口里出现支付类词」；`executor.ts:359-365` 对 type 同样抛 `DANGER_HARD_DENY`——**在显示了「立即支付」字样的电商页搜索框里打字，没有任何放行路径**（连 re-L2 都不行）。A4 的无路径禁区范围是「最终确认按钮的**点击**」；窗口级金融上下文按 §E.4 重排后属于「暂停 + re-L2（有路径）」组。当前实现把无路径硬拒扩大到了授权外的场景，正常任务直接死路。
- **修复要求**：region-hard 无路径分支按 `action.action !== "type"` 门控（type 只保留 :350-358 的凭证上下文无路径拒）；type 遇窗口级 HARD 词走 :366 的 re-L2 通道。补「窗口含支付词时 type → re-L2 而非 hard deny」的性质测试。

---

## 2. Amendments 逐条核验（✅ / 部分 / ❌ + 证据）

| # | 结论 | 证据与说明 |
|---|---|---|
| A1 | **部分** | TOCTOU：≤300ms 重截比对 + 超阈值重定位拒注 ✅（`executor.ts:287-307`，测试 :242-285）；~200×200 区域独立层交叉验证 **部分**——降级为存活探针且语义虚标（→ R4）；uncrossverified 标记 + 子预算 ≤3 ✅（:314-326，测试 :289-307）；type 逐批前台 hwnd 重查 ✅（`computer-input.ps1:215-220` FOCUSLOST）；KEYEVENTF_UNICODE 强制 ✅（`computer-input.ps1:88`，wVk=0 纯 UTF-16 码元）。残留：显式坐标点击与 type 无 A1.1 重截比对（见 N7）；重定位后注入前无最终新鲜度复查（N8）。 |
| A2 | **部分** | 任务自引发对话框不可点击 ✅（动作后前台 hwnd 变化 ∨ 整窗 diff>0.3 → 暂停 + re-L2，保守方向，`executor.ts:383-435`；测试 :381-399）；双通道危险检测 ✅（区域裁片 + 整窗，`danger.ts:87-94`）；双语词库 **部分**——主体完整但漏 bare "Pay"（→ R3）。说明：re-L2 对话框为纯文本，「对话框截图交用户」依赖 WP4 的 preview_image 字段（`security-confirmation.ts:35-65` 尚无该字段），WP1 范围内可接受，WP4 必须补。 |
| A3 | **✅** | L2 逐字枚举全部 type.text（`server.ts:470-480`）；token 绑定 app+task+corpusHash+完整草案哈希（`types.ts:256-264`、`security-policy.ts:61-67`、签发/验证同函数 :684/:1782 保证不发散）；executor 语料成员复查（`executor.ts:263-268`）；history 落盘仅哈希（`store.ts:196-220`，测试断言「青花瓷」/token 明文绝不落盘，`computer-evidence.test.ts:240-245`）。WP1 无 key 动作，危险组合键枚举不适用（WP2 范畴）。 |
| A4 | **部分** | 区域 HARD 词 = 真无路径硬拒 ✅（`executor.ts:359-365` 直接抛错无 confirm 调用，测试断言 `confirm.captured.length === 0`，:348）；窗口 HARD 词 = 暂停 + re-L2（有路径）✅（:366-373）；type 遇凭证上下文无路径拒 ✅（:350-358，测试 :365-377）；**但** type 遇窗口级 HARD 词被错分为无路径（→ R5）。 |
| A7 | **部分** | DPAPI CurrentUser 静态加密 ✅（`computer-evidence-seal.ps1:92-94`，先 16×16 像素化后加密再删 raw，:88-96）；7 天 TTL janitor ✅（`evidence.ts:21,149-170`，任务触发 wiring `server.ts:1803`）；history.db 敏感集合 ✅（`store.ts:26` 含 host_computer + 专用 redactor :86-91）；凭证区域落盘前模糊 **部分**——注入路径 ✅，只读帧 ❌（→ R2）；全持久化面级联 **部分**——%TEMP% raw 泄漏无覆盖（→ R1）。「立即清除全部证据」`purgeAllEvidence` 已实现（:173-180）但尚无 WS/启动 wiring（WP4 UI 范畴，N5）。 |
| A10 | **✅** | 全局 `computer.coordinateEnabled` 默认 false + 非布尔手改强制转 false（`config.ts:174,308-318`）；AppEntry.coordinateAllowed 默认 false（`apps/types.ts:42-49`）；开启走生物识别门、关闭免费 fail-closed（`computer/handlers.ts:47-81`、`apps/handlers.ts:412-466`）；vault/LOLBIN 结构性排除三重冗余（normalize 强制清除 + loud log `apps/types.ts:215-228`、handler 门前短路、executor 复查 `policy.ts:69-74`）；executor 侧双开关 belt（:34-83）。测试矩阵完整（`computer-policy.test.ts`、`apps-coordinate.test.ts`）。 |
| A5/A6/A8/A9 | 范围外 | 按 Amendments 落地列分属打包管线/WP5/§E.6（WP2 急停），非 WP1 验收项；ps1 子进程已各自 `SetProcessDpiAwarenessContext(-4)` 归一化物理像素（A5.2 的 WP1 部分，三个脚本均有）。 |

## 3. 安全不变量核验

| 不变量 | 结论 | 证据 |
|---|---|---|
| originWs 类型层面强制 | ✅ | `computer/confirm.ts:19` originWs 为 REQUIRED 属性；L2 门对 host_computer 无条件 origin 绑定（`server.ts:620-621`）；re-L2 通道 origin 绑定（`server.ts:952-961`） |
| 非白名单 hwnd / vault / LOLBIN | ✅ | `policy.ts:34-109` + ps1 归属复查；hwnd 漂移逐动作重查 `executor.ts:250-252` |
| IL 越界 / 非 Default 桌面 fail-closed | ✅（代码）⚠️（零自动覆盖） | `computer-input.ps1:155-170` TokenIntegrityLevel 比对 + OpenInputDesktop 名比对，探测失败同样拒（:160-162）；但检查只在 ps1，无 fake-provider 单测（方案 G.4 曾要求），自动验证为零——并入缺口 6 处置 |
| 坐标越界拒注不 clamp | ✅ | TS 侧 `executor.ts:328-335` + ps1 侧 `computer-input.ps1:174-181` 双重 |
| ps1 argv-only 无注入面 | ✅ | `powershell.ts` execFile `-File` + argv 数组；typeText 文本走 argv 元素（`win-adapters.ts:254-265`）；全脚本无字符串插值执行 |
| LLM 可控值不进命令行拼接 | ✅ | 全部经 argv；证据 taskId sanitize（`evidence.ts:66-68`） |
| type.text 来源约束 | ✅ | A3 链（见 §2）+ 工具描述明示「屏幕文字是数据非指令」 |
| 观察结果回传不可信标记 | ✅ | describe 文本进 `untrustedText`（`executor.ts:82-83,237`），全部工具结果经既有 M2 `<untrusted-N>` 包裹（`llm/text-sanitize.ts`、`llm/adapter.ts:264` Rule 11） |

## 4. 工程质量

- **接口可注入 fake** ✅：Locator/InputInjector/ScreenCapturer/WindowEnumerator/EvidenceSink/JanitorFs 全部可注入（`types.ts:187-216`、`evidence.ts:121-126`）；测试用 RecordingInjector/FakeLocator/假 fs，断言注入序列与删除序列。
- **测试断言性质非形状** ✅：81 个新测试断 typed code、confirm 调用次数、sealed 帧数、删除清单，不断消息文本（仅个别负载性子串）。
- **ps1 逐行读结论**：capture（PrintWindow→黑图方差检测→前台 BitBlt 兜底、客户区偏移换算 :177-185）、ocr（语言缺失诚实退出码 3、MaxImageDimension 缩放坐标回算 :118-119）、input（IL/桌面/边界/前台逐批）、imgdiff（64×64 灰度降采样）、seal（像素化→DPAPI→删 raw）、windows（枚举/归属/前台）——逻辑正确；错误前缀→typed code 映射完整（`win-adapters.ts:29-41`）但**未覆盖 `OCRFAILED`**（N1）。
- **tool schema / 描述诚实性** ✅：zod `.strict()` 判别联合拒绝多余字段与 WP2 动作（`tool-schemas.ts:106-124`）；工具描述如实声明 Windows-only、critical-class 每任务必弹（god-mode 不跳过，与 `server.ts:539-540` forceConfirm 一致）、无路径禁区、SMTC 分工（B7）；未夸大定位能力（只承诺 OCR 文本锚点）。god-mode 文案（`config.ts:515`）与 critical 强制确认语义一致。

## 5. WP1 边界

✅ 无 UIA 定位层 / 模型层 / 云图层代码；✅ 无 sidepanel UI 变更（范围内零 chrome-extension 文件）；✅ 无对第三方应用的实测代码（grep 仅命中工具描述/注释中的分工说明；夹具为自绘 `tests/fixtures/self-drawn-window.ps1`，UIA 开关是方案 G.1 要求的夹具能力而非定位层）。`ScreenCapturer.crop` 在 WP1 executor 无调用方（死代码，N4）。

## 6. 亲自复验（本机实际执行，2026-07-18 23:48 +0800）

| 命令 | 结果 |
|---|---|
| `companion: node node_modules/typescript/bin/tsc -p tsconfig.test.json` | **exit 0** |
| `companion: node --test .test-dist/tests/computer-*.test.js + apps-coordinate.test.js` | **81/81 pass**（executor 20 + policy 27 + evidence 13 + apps-coordinate 21），0 fail |
| `chrome-extension: node node_modules/typescript/bin/tsc --noEmit` | **exit 0** |

未跑全量套件（评审指令：~34–53 个预存 Windows 环境失败与本次无关，不计入）。

## 7. 已知缺口 6（真实夹具端到端集成测试缺失）评估

**结论：不列为代码 MUST-FIX，可由父 Agent 手动集成测试替代——但它是 WP1 验收的正式门禁，必须在宣告 WP1 通过前实际执行并留痕。**

依据：① TS 侧逻辑已有 81 个性质测试覆盖；② SendInput/前台焦点/UNICODE CJK 机制已被同机 S-5 spike 实证（10/10 前台、10/10 点击、CJK 精确、0% 丢失，`21d09e4`），ps1 是在已验证原语上的薄编排；③ WP1 验收条款明确要求「夹具上点击确定 / 输入青花瓷端到端通过」——该条款目前**形式上未满足**。

手动集成测试最低清单（建议父 Agent 在本机执行并把输出附进 WP1 验收记录）：
1. 起 `self-drawn-window.ps1`（off 模式）→ 真实 `computer-capture.ps1` + `computer-ocr.ps1` 定位「确定」→ `computer-input.ps1` 点击 → `fixture-state.json` clicks=1；
2. focus-input 后 type「青花瓷」→ state.text 精确相等（验证 UNICODE CJK 与节流）；
3. seal→unprotect 往返字节一致 + protect 后 raw 已删；
4. 负向探针：对一个提权窗口跑 input 脚本断言 ILDENIED 退出码 5（顺带补上 IL/桌面检查零自动覆盖的实证空白）；夹具 popup-dialog 后 type 断言 FOCUSLOST；
5. 附带补一个 `rethrowComputerPsError` 前缀映射的纯函数单测（廉价，当前零覆盖）。

若本机无法执行该清单，WP1 验收保持开放，不得以单测全绿替代。

## 8. NIT

- **N1** `OCRFAILED` 前缀未进 `PS_ERROR_CODES`（`win-adapters.ts:29-41` vs `computer-ocr.ps1:13`），OCR 解码/识别失败会被误标 `INJECT_FAILED`。
- **N2** 拉丁词元纯子串误伤（"pin"⊂"shopping"、"format"⊂"information"，`danger.ts:54-67`）——随 R3 边界匹配一并修。
- **N3** `computer-evidence-seal.ps1:15` 注释称 BlurRects 为「window-client px」，实际调用方传图像空间坐标（OCR word 框即图像空间）——注释误导，坐标本身自洽。
- **N4** `computer-imgdiff.ps1` crop 仅作用于 A 图且注释称 client px（位图实为全窗含标题栏）；WP1 executor 未使用 crop/diff-crop 路径，`ScreenCapturer.crop` 死代码。
- **N5** janitor 仅任务触发时跑（`server.ts:1803`），无启动 sweep；`purgeAllEvidence` 无 WS 入口（WP4）；%TEMP% 捕获目录无人管辖（随 R1 修）。
- **N6** screenshot/describe 不做逐动作 hwnd 归属重查（`executor.ts:230-246` 在 :250 重查之前 continue）——只读低风险。
- **N7** 显式坐标点击与 type 无 A1.1 重截比对；显式坐标可有「与任务内最近一帧 diff」的 WP2 改进空间。
- **N8** 陈旧重定位后到注入前无最终 ≤300ms 复查（probeWindow 增加延迟），残余由动作后验证兜底。
- **N9** 对话框启发整窗 diff 阈值 0.3（`types.ts:76`）对大窗口内小弹层可能不敏感；前台通道可补偿真实模态对话框。
- **N10** `rethrowComputerPsError` 前缀映射零单测（纯函数，并入缺口 6 清单第 5 项）。

## 9. 做对了的地方（简短）

1. **A3 全链闭环**：L2 逐字枚举 → token 绑定全草案哈希 → executor 复查 → history 哈希化，且有「明文绝不落盘」的实证测试——这是 K.3 最想要的形态。
2. **A4 无路径拒是真的无路径**：硬拒分支没有任何 confirm 调用，测试用 `confirm.captured.length === 0` 锁死；窗口/区域双级分类与 §E.4 重排语义一致。
3. **A10 三重冗余结构性排除**（normalize 强制清除 + handler 门前短路 + executor belt）与「关闭免费、开启过门」的 fail-closed 方向；originWs 类型级强制。
4. **错误分类学 + 性质断言**：typed code 全表、ps1 前缀映射、测试断性质不断形状；四接口全可注入。
5. **seal 管线顺序正确**：对话框 diff 先于 seal 执行（原始帧被 sealer 删除前完成比对）；像素化→DPAPI→删 raw 的顺序保证了「模糊后才是持久化字节」。
6. **ps1 纪律**：argv-only、单行 JSON、stderr 前缀、15s 超时、绝对路径 powershell.exe、PerMonitorV2 自归一化——E10 模式完整复用。

---

# 终审（2026-07-19 02:32 +0800）

> **增审范围**: `694b4d9..df227a1`（R1–R5 修复 5 commit + N10 映射测试 1 commit + X1–X6 修复 6 commit + 缺口 6 E2E 留痕 1 commit，共 13 commit）
> **新增基准**: `coordinate-computer-use-wp1-adversary.md`（代码级对抗裁决 SOUND WITH MANDATORY FIXES，X1–X6）、`scripts/spike/wp1-e2e/wp1-e2e-record.md`（父 Agent 真机夹具留痕）
> **方法**: 修复 commit 逐 diff 抽查（重点 X1/X2/X3 全 diff 精读）+ E2E 留痕对照评审最低清单逐项核验 + 本机亲自复跑

## 终审裁决: `APPROVED` — WP1 宣告通过

R1–R5 与 X1–X6 全部验证为**真修复而非表面修复**（§T1/T2）；缺口 6 E2E 留痕可信且覆盖度满足门禁（§T3），并超额完成 X1/X2 的真实环境实证；本机复跑 `tsc -p tsconfig.test.json` exit 0、computer+apps 套件 **293/293 全绿**（与基线一致）。剩余项全部为已文档化的 Y 类残余/NIT，不构成 WP1 验收条件，整理为 WP2 输入清单（§T5）。

**X1/X2/X3 的 A1/A2 合规性成立**（WP1 诚实形态 + 明示残余，逐条论证见 §T2 末）。

## T1. R1–R5 修复真实性（抽查）

| # | 结论 | 关键证据 |
|---|---|---|
| R1 | 真修复 | `executor.ts:183-215` pendingRaws/trackCapture/releaseRaw/sweepRaws 全出口跟踪；`fail()` 先 sweep 再 finalize（:217-219）；陈旧定位帧双分支即时 releaseRaw（:419-421）；成功路径收尾 sweep（:727） |
| R2 | 真修复 | 只读帧一律 OCR + `scanDanger` 取 credentialRects 后 seal（:311-327），语言包缺失 fail-closed |
| R3 | 真修复 | bare "pay" 入 HARD 集（`danger.ts:32`）；ASCII 词元 `\b` 边界、CJK 子串（:75-93）；bare "confirm/确认" 排除理由成文；16 条性质测试双向锁定 |
| R4 | 真修复 | 像素通道替身按评审选项②落地：注入前必重截 + `diffRegion` 双裁片比对（`win-adapters.ts:135-150`，临时裁片 finally 删除）；`crossverifyChannel:"pixel-region"` 明示「像素稳定性、非语义互证」；重定位点击诚实吃 ≤3 子预算；方案文档 WP1 节已同步降级语义（plan :249） |
| R5 | 真修复 | region-hard 无路径拒按 `action!=="type"` 门控（`executor.ts:476`），type 窗口级 HARD 落入 re-L2 通道，凭证无路径拒保持不变 |

## T2. X1–X6 修复真实性（重点三条全 diff 精读）

| # | 结论 | 关键证据与评估 |
|---|---|---|
| X1 | 真修复 + 真机实证 | 四通道 OR（前台变化 / 同 exe 新顶层窗口 / 整窗 0.3 / zone/blob）落地 `executor.ts:619-629`；`computer-imgdiff.ps1` 的 zone/blob 是**真实计算**（逐 cell 变化图 → 8×8 宏区覆盖率 + 4-连通迭代 DFS、防换行回绕、PS 5.1 兼容）；`DiffMetrics` 可选通道设计使 fake 不参与（types.ts:229-239）；夹具 inwindow 自绘对话框模式真实绘制无新 hwnd；<5% 盲区已写入 plan :250 明示债务。**E2E 第 7 项实测**：整窗 0.1494（旧指标必然漏检，实证对抗定量分析）vs zone 0.7812 / blob 0.1257 双通道命中 |
| X2 | 真修复 + 真机实证 | `computer-input.ps1`：ForceForeground 返回值不再丢弃（false→FOCUSLOST）、`GetForegroundWindow()==hwnd` 复核、`GetAncestor(WindowFromPoint(pt),GA_ROOT)==hwnd` 落点归属复核（新前缀 OCCLUDED exit 10 → `CLICK_OCCLUDED` typed code）；属性测试断言零 confirm 调用零 raw 残留；毫秒级 race 残余已文档化（A2.1 事后通道兜底）。**E2E 第 6 项实测**：真实置顶对话框遮挡点击 → `OCCLUDED` 拒绝且 clicks/dialogClicks 保持 0，关窗后恢复 |
| X3 | 真修复 | `PIXEL_STALE_MS` 从 dead constant 变为真门禁（`executor.ts:494-596`）：仅 danger/uncross 两个**动作中** re-L2 置位（budget re-L2 在捕获前、dialog re-L2 在注入后，均不置位——分类正确）；target 点击走 F1 强制重定位→F2 diffRegion 重判互证语义；显式坐标/type 换帧保密封一致性；每帧 releaseRaw；危险扫描重跑且**仅升级可行动**（同级不重复询问避免 prompt 循环，新 hard/新凭证 → 无路径拒）；3 条新性质测试（移动目标点中刷新坐标 / 目标消失 STALE 零注入 / 升级为 region-hard 拒） |
| X4 | 真修复 | 三层帽：zod schema 2000、executor 单条 + 语料总量 2000（:137-168）、ps1 2000 字符 + 120s 预估时长硬帽（`computer-input.ps1:245-247`） |
| X5 | 真修复 | after 帧独立凭证扫描（:644-661）；OCR 不可用 → 帧 fail-closed 丢弃（raw swept、hash 省略、note 记录）；seal 失败与 OCR 失败不错误归类 |
| X6 | 真修复 | `sweepComputerTempCaptures`（dead-pid 或 >1h 即删，本 pid/不可解析名保留，可注入 fs）wiring 到任务启动旁路（`server.ts:1804-1812`），6 条性质测试 |

**A1/A2 合规性论证**：A1（像素 TOCTOU）——注入前重截 + 区域 diff + 重定位拒注的主链（R4 形态）、re-L2 批准后强制刷新（X3）、type 逐批 FOCUSLOST、UNICODE 强制，闭环成立；A1.2 以「像素稳定性互证」的诚实降级形态存在且证据字段名不夸大（WP3 UIA 落地后取代，plan :249 成文）。A2（对话框不变量 + 双通道危险检测）——X1 使差分通道在定量上真实有效（真机实测佐证）、X2 补上 click 的落点归属检查使白名单边界在 Z 序维度闭合、词库完整性 R3 修复。两者在 WP1 范围内的承诺均已兑现，残余（<5% 小弹层、毫秒 race、同级不再问）全部明示成文并有后续归属（WP3/WP7）。

## T3. E2E 留痕可信度与覆盖度核验

对照评审最低清单逐项：

| 评审最低清单 | 留痕 | 结论 |
|---|---|---|
| 夹具 OCR 定位「确定」+ 真实点击验 clicks | 第 2/3 项（bbox 偏差 <20px、clicks 0→1、screen 坐标留档） | ✓ |
| type「青花瓷」验 UNICODE CJK | 第 4 项（text 精确相等） | ✓ |
| seal 往返 + raw 删除 | 第 8 项（blurred:1、原 after.png 已删、unprotect 成功） | ✓ |
| 提权窗口 ILDENIED 负向探针 | **未做**，作者明示原因（VM 触发 UAC 不便） | 接受——ps1 IL 逻辑 fail-closed by construction（探测失败即拒）且经两轮读码；但见 NIT-F1 |
| 弹窗后 FOCUSLOST | **部分**：第 6 项实证的是 click 侧 OCCLUDED（WindowFromPoint 路径），mid-type FOCUSLOST 循环未直接实测 | 残余列入 WP2 输入（Y9 类） |
| 前缀映射单测 | `computer-win-adapters.test.ts`（含 OCCLUDED 行） | ✓ |
| （超额）X1 inwindow 像素通道实测 | 第 7 项定量数据 | ✓ 价值高 |
| （超额）X2 真实对话框遮挡 | 第 6 项 | ✓ 价值高 |

**可信度评估：高**。留痕含真实数值/真实 stderr 前缀/环境参数（Win11 26H1、DPI 150%），且**自证其力**：顺带捕获两个真实缺陷——夹具 window 模式弹窗的 Point 参数模式解析 bug（证明 X1 window 通道此前从未被真实弹窗验证过；若手工测试缺位此 bug 将带伤进 WP2）与 5 个 ps1 缺 UTF-8 BOM。第 9 项对马赛克强度如实保留、未覆盖项明示——符合留痕文档的诚实标准。

**NIT-F1（文档准确性）**：留痕「未覆盖」节称「IL fail-closed 由单测 fake IL provider 覆盖」——实际并无 fake IL provider，真实覆盖仅为 stderr 前缀映射单测（`computer-win-adapters.test.ts:25,79`）。建议一句修正，并将真实跨 IL 拒绝探针并入 WP2 真实机验收矩阵。

## T4. 本机复跑（2026-07-19 02:3x +0800，亲自执行）

| 命令 | 结果 |
|---|---|
| `companion: node node_modules/typescript/bin/tsc -p tsconfig.test.json` | **exit 0** |
| `node --test .test-dist/tests/computer-*.test.js + apps-*.test.js` | **293/293 pass**，0 fail（与基线一致） |

## T5. WP2 输入清单（Y 类残余 + NIT，均非 WP1 验收条件）

1. **真实机矩阵**：提权窗口 ILDENIED 负向探针、mid-type FOCUSLOST 弹窗喷雾中止探针、组合型 IME 激活态（S-5 C1 保留）、网易云真实注入（owner E2E 专属）；同步修正 E2E 留痕 NIT-F1。
2. **Y1** 危险扫描窗口通道改用注入前新鲜帧 OCR（当前复用定位帧 OCR，区域外新浮现内容不入检测）。
3. **Y2** 词库 NFKC 规范化 + 零宽字符剥离；PayPal/Alipay 驼峰品牌词决策；OCR 引擎规范化行为列为未验证依赖。
4. **Y3** L2 对话框逐字枚举点击目标（锚文本/坐标）+ task 行转义防版式伪造。
5. **Y4** type 节流改按字符/小批真实 SendInput（当前 sleep 在事件累积阶段，16 字符仍单次爆发；S-5 C2 对 OSR 未证）。
6. **Y5** evidence/%TEMP% 目录 reparse-point 拒绝 + init 检查；马赛克改纯色填充评估（E2E 第 9 项保留）。
7. **Y6** OCRFAILED 前缀入 `PS_ERROR_CODES`；`runPs` maxBuffer 评估放大；`ensureLanguage` 死接口清理；预算续期回读 `config.computer?.budget`。
8. **Y7** 跨任务注入动作累计进 L2 对话框或速率限制（防任务拆分放大）。
9. **Y8** seal/imgdiff 注释坐标系修正（图像空间，非 client px）。
10. **Y10** DPAPI 同用户威胁模型同步进 `evidence.ts` 头注释与 plan §E.5。
11. **X 类明示债务跟踪**：<5% 小弹层盲区（→WP3 UIA WindowOpened + WP7 红队语料）；X2 毫秒 race（A2.1 兜底语义）；X3「同级不再问」的词集变化语义（同级异词不再 re-L2，WP2 评估是否按词集变化重问）。
12. **评审 NIT 遗留**：screenshot/describe 不做逐动作 hwnd 归属重查（只读低风险）；显式坐标点击无帧间 diff 护栏（现由子预算+事后通道约束，WP2 可加「与任务内最近帧 diff」）。

## T6. 终审结语

WP1 两轮修复（评审 R1–R5、对抗 X1–X6）共 11 个 fix commit 全部真修复，缺口 6 以高可信留痕关闭，Amendments A1–A10 中 WP1 承担的部分全部落地（A1/A2/A3/A4/A7/A10 ✅，A5/A6/A8/A9 按方案映射不属 WP1）。**WP1 宣告通过**，可以进入 WP2（执行层完备与白名单绑定）——WP2 启动时把 §T5 清单作为输入，其中第 1 项真实机矩阵与第 11 项明示债务为强制性跟踪项。

---

*终审人：Reviewer · 方法：逐 diff 抽查 + 留痕逐项核验 + 本机复跑（非转述）*
