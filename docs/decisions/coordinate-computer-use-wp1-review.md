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

*复审触发条件：R1–R5 修复合入 + 缺口 6 手动集成测试执行留痕。*
