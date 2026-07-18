# 坐标化 Computer-Use WP1 实现代码 — 对抗裁决（代码级）

> **日期**: 2026-07-19 · **对抗 Agent**: Adversary（只读评审 + 本机只读探针）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `56903c9..a9ffe93`（WP1 实现 + 评审 R1–R5 修复，共 11 个 commit）
> **被审代码**: `companion/src/computer/`（8 文件）+ `companion/src/host-use/win/scripts/computer-*.ps1`（6 脚本）+ `companion/tests/fixtures/self-drawn-window.ps1` + server/schema/config/store 接线
> **基准文档**: `coordinate-computer-use-plan.md`（Amendments A1–A10）、`coordinate-computer-use-adversary.md`（本 Agent 的方案级裁决）、`coordinate-computer-use-wp1-review.md`（评审 R1–R5）、`scripts/spike/s5-sendinput/s5-spike-report.md`（S-5 与 C1–C4）
> **方法**: 全文逐行读码 + 本机复验（tsc 构建 exit 0；computer 六套件 122/122 pass，2026-07-19 00:5x +0800）；未对任何第三方应用发注入；未修改实现代码

## 裁决: `SOUND WITH MANDATORY FIXES`

骨架是真的：A3 语料绑定全链、A4 无路径硬拒（`confirm.captured.length === 0` 锁死）、A10 双开关三重冗余、originWs 类型级强制与 respondFrom 原点校验、fail-closed 错误分类学、性质断言测试——逐行复核后均成立，评审 R1–R5 的修复逐条验证为**真修复**（§1）。但代码级攻击发现 **6 个 MUST-FIX**：其中 X1（A2.1 对话框不变量的差分通道在定量上近乎失能）与 X2（click 注入不验证落点窗口归属，白名单边界可被顶置窗口击穿）是强制修订 A1/A2 承诺过的防线在实际实现上的空洞；X3–X6 各有小范围修法。全部修复均为局部改动，修后可快速复审。

---

## 1. 评审修复真实性核验（R1–R5：逐条验证「真的而非表面」）

| # | 结论 | 证据与残余 |
|---|---|---|
| R1（raw 帧清理覆盖所有出口） | **真修复（进程内全出口）**，残余 → X6 | `executor.ts:173-192` pendingRaws 跟踪 + `releaseRaw`（:391 陈旧定位帧即时删）+ `fail()` 与成功路径双 `sweepRaws`（:196, :542）；seal 失败经 `evidence.ts:96-99` 抛 EVIDENCE_ERROR → fail → sweep 兜底。四条性质测试（`computer-executor.test.ts:454-552`）覆盖成功/ELEMENT_NOT_FOUND/STALE_SCREENSHOT/DANGER_HARD_DENY/describe 五路径且断言「既未 seal 也未删除 = 失败」。**残余**：跟踪是纯内存结构，进程崩溃/被杀后 `%TEMP%\cmspark-computer` 无人清扫（janitor 只管 evidence 目录，无启动 sweep）→ X6。 |
| R2（只读帧落盘前凭证模糊） | **真修复** | `executor.ts:290-304`：screenshot 与 describe 均先 OCR 再过 `scanDanger` 取 credentialRects，语言包缺失 fail-closed；测试 `:556-589` 断言 blur rect 几何与不过度模糊。**新发现**：注入后 after 帧用的是**注入前**扫描的 blur 图 → X5。 |
| R3（bare "Pay" + 拉丁词边界） | **真修复** | `danger.ts:32` bare "pay" 入 HARD 集；`:85-93` ASCII 词元 `\b` 边界、CJK 保持子串；`tokenMatches` 对 `支付Pay`/`Pay付款`（CJK 与 \w 交界处天然成界）与 `pin码` 均正确；`repay`/`payment` 不误伤。测试 `computer-danger.test.ts:30-92` 逐性质锁定。残余：Unicode 规范化缺位（全角/零宽）→ Y2。 |
| R4（像素通道替身的诚实性） | **真修复（语义诚实）**，残余为已声明能力边界 | `crossverifyChannel="pixel-region"` 落证据（`executor.ts:99,386-387`），重定位点击诚实记 uncrossverified 并吃 ≤3 子预算（`:383,400-410`），测试 `:200-214,285-308` 锁语义。**能力边界（非欺骗但须知情）**：0.08 阈值下「视觉微变但语义已换」的亚阈值替换可通过（200×200 区域 64×64 降采样，换同色同字宽按钮文字约扰动 3–10% cell，处于阈值边缘）；证据记录的是「像素稳定」而非「语义不变」——字段名已诚实，残余可接受 → Y2 类记录。 |
| R5（type 走 re-L2） | **真修复** | `executor.ts:443` 无路径硬拒按 `action !== "type"` 门控，type 的窗口级 HARD 落入 `:454-461` re-L2 通道；测试 `:374-399` 双向锁定。re-L2 信息充分性：对话框含任务名 + 命中词 + 风险说明，但为纯文本（无截图预览，依赖 WP4 preview_image——评审已记录，本裁决并入 Y9 验收门禁重申）。 |

---

## 2. 强制修复（X1–X6）

### X1 — A2.1 对话框不变量定量失能：整窗差分阈值 0.3 漏掉几乎所有真实对话框

- **攻击场景**：OSR 应用（网易云类，本范式的主要目标）在**同一 hwnd 内**自绘弹出确认层（「确定要删除吗？」，500×350，与窗口同色或半透明）。任务第 N 步点击触发它，第 N+1 步在预算内直接点「确定」。前台通道不触发（同一 hwnd，无新顶层窗口）；差分通道：500×350 / 1054×736 窗口 ≈ 22.5% 面积 → diffRatio ≈ 0.22 **< 0.3**；窗口最大化（1920×1080）时 ≈ 8.4%；小型通知 ≈ 3%。半透明与同色进一步压低 luma 差。**0.3 的整窗阈值只catch得住整页跳转，catch 不住对话框**——A2.1 硬不变量对它最想防的场景实质性未执行。词库兜底亦失效：「确定/确认」被刻意不入词库（`danger.ts:34-38`，理由成立），恰好是对话框按钮最常见的标注。
- **代码证据**：`types.ts:76`（DIALOG_DIFF_THRESHOLD=0.3）；`executor.ts:478`（唯一差分判据）；`computer-imgdiff.ps1:13,56-74`（64×64 cell 均值指标，面积比即检出上限）；`executor.ts:478` 前台判据 `fg !== 0 && fg !== hwnd` 只认异 hwnd。夹具对话框是独立顶层窗口（`self-drawn-window.ps1:123-137` TopMost Form）→ 测试永远走前台通道，差分通道的盲区**零覆盖**。
- **修复要求**：① 差分判据改为「新增大面积连通变化区域」或对整窗 diff 阈值降档（建议 0.05–0.08 起，配合动作后 300–500ms 延迟再截 after 帧以纳入弹层动画）；② 夹具增加**同 hwnd 自绘对话框**模式（Paint 事件内绘制，不开新窗口），补「in-window 对话框 → 暂停 re-L2」的性质测试；③ 将「阈值—面积」定量关系与残余盲区（<阈值的小弹层）写入 plan §E.4/WP1 节。

### X2 — click 注入不验证落点窗口归属：顶置/遮挡窗口可截收白名单意图的点击

- **攻击场景**：他进程窗口（攻击者的 AlwaysOnTop 层、系统通知、任何 topmost 窗口）覆盖目标点；或 `SetForegroundWindow` 静默失败（前台锁）。`computer-input.ps1` 计算绝对屏幕坐标后直接 SendInput——**点击落在覆盖窗口上**：一次以白名单授权为背书、以不可逆后果为可能的注入，投递到了白名单边界之外。executor 的逐动作归属重查（`executor.ts:316-317`）只验证 hwnd 存活与进程归属，不验证 Z 序可见性；PrintWindow 截图对遮挡窗口照常出图，A1 像素比对对此全盲；A2.1 的事后前台检查（`:476-478`）在点击**之后**——对「允许/删除/发送」类控件为时已晚。type 动作有 FOCUSLOST 逐批前台复查（ps1:218），click 动作**什么对应物都没有**。
- **代码证据**：`computer-input.ps1:189`（`ForceForeground` 返回值被 `Out-Null` 丢弃）、`:192-208`（click 分支无任何 GetForegroundWindow/WindowFromPoint 复核）、`executor.ts:467`（调用前无可见性校验）。
- **修复要求**：ps1 click 分支在 ForceForeground 后、SendInput 前复核 `GetForegroundWindow() == hwnd` **且** `GetAncestor(WindowFromPoint(screenX,screenY), GA_ROOT) == hwnd`，任一不满足 → 新 stderr 前缀（如 `OCCLUDED:<d>`，映射 OUT_OF_BOUNDS 或新 typed code）fail-closed；executor 侧补对应 fake 性质测试。文档化残余：检查组与 SendInput 之间仍有毫秒级 race，由事后 A2.1 通道兜底。

### X3 — re-L2 批准后按陈旧坐标注入：A1 的 ≤300ms 不变量在「用户思考时间」面前失效

- **攻击/工程场景**：动作链为「捕获 fresh 帧 → 危险扫描命中 caution/uncross 子预算超限 → re-L2 弹窗 → 用户阅读数十秒 → 批准 → **按弹窗前计算的坐标注入**」。批准到注入之间没有任何新鲜度复查；`PIXEL_STALE_MS`（`types.ts:72`）定义后**全仓零引用**（dead constant，证明该不变量从未被时间上接线）。re-L2 介入的恰恰是高危动作（命中危险词/不可交叉验证）——风险最高的一类点击拿着最陈旧的坐标。
- **代码证据**：`executor.ts:400-410`（uncross re-L2）与 `:454-461`（danger re-L2）位于最后一次捕获（`:371`）与注入（`:464-468`）之间；PIXEL_STALE_MS 仅 `types.ts:72` 一处。
- **修复要求**：任何 re-L2 批准后、注入前重截并按 A1.1 重新做区域 diff（不稳定 → 重定位或 STALE_SCREENSHOT 诚实失败；危险扫描一并重跑）；或删除 PIXEL_STALE_MS 并在文档中承认「re-L2 后无新鲜度保证」。取前者。

### X4 — type.text 无长度上限：可无中止地向用户前台灌键长达小时级

- **攻击场景**：被注入/跑偏的 LLM 构造 100KB 的 type.text（L2 对话框逐字展示为单行 JSON，UI 本身即被 DoS）；用户一旦批准，ps1 以 30–80ms/字符节流注入 ≈ 1.5–3 小时，TS 侧超时同比例放大（`15000 + len*120` ms）——期间无急停（A9 热键属 WP2），用户机器前台被持续劫持。预算按**动作数**计，对字符数无约束。
- **代码证据**：`tool-schemas.ts:118`（`text: z.string().min(1)` 无 max）；`win-adapters.ts:278`（超时随文本长度无界放大）；`computer-input.ps1:27-28,227-228`（节流参数）。
- **修复要求**：schema 层 `text.max(N)`（建议 N=2000）+ 同任务语料总字符上限；ps1 侧注入总时长硬上限（如 120s）超限即 SENDFAILED；修复前 WP1 文档须把「长文本注入无急停」列为已知风险。

### X5 — after 帧用过期 blur 图落盘：A7.4 对注入后帧失效

- **攻击/泄露场景**：点击的后果使凭证词出现/移位（点「登录」后弹出「密码」标签、2FA 码显示）。after 帧用**注入前** OCR 扫描得到的 credentialRects 做模糊——新出现的凭证区域**未被像素化**即被 DPAPI 加密持久化（同一用户态进程可 Unprotect 读出原图，见 A7③ 已接受残余——残余被这里放大）。对话框暂停场景更尖锐：含「密码」字样的任务自引发对话框先被未模糊封存，再弹 re-L2。
- **代码证据**：`executor.ts:482-485`（before/after 两帧同用 `scan.credentialRects`，scan 源自 `:423-432` 注入前帧的 OCR）。
- **修复要求**：after 帧独立过一遍凭证词扫描（复用对话框检测已付出的 capture，OCR 一次 ≈300ms，成本可接受）用其自有 credentialRects 封存；补「after 帧新出现凭证词 → blur 非空」性质测试。

### X6 — 进程崩溃窗口的 %TEMP% 明文残留：R1 的内存跟踪覆盖不到的出口

- **攻击/泄露场景**：任务中途 companion 崩溃/被杀/断电——pendingRaws 随之消亡，`%TEMP%\cmspark-computer\cap-*.png` 明文全窗截图（可能正显示凭证）永久滞留，任何备份软件/同用户进程可读。A7 承诺「原始像素永不持久化」，崩溃路径违背。
- **代码证据**：`win-adapters.ts:58-62`（临时捕获目录）；`executor.ts:173-192`（纯内存跟踪）；`evidence.ts:157-178`（janitor 只管 evidence 目录）；`server.ts:1803`（janitor 仅任务触发，无启动 sweep）。
- **修复要求**（任一）：① companion 启动时 sweep 该临时目录（TTL 或全清）；② janitor 管辖面扩至该目录；③ 捕获直接写入 evidence 任务目录由 sealer 生命周期接管。补一条「预置陈旧 cap 文件被启动 sweep 清除」的测试。

---

## 3. 建议（Y 类）

- **Y1（危险扫描窗口通道用过期 OCR）**：稳定分支下 `executor.ts:423` 复用定位帧 OCR 做整窗扫描——区域外的窗口内容变化（如新浮现的「验证码」输入框）不入检测。建议窗口通道改用 fresh 帧 OCR，或文档化该陈旧窗口。
- **Y2（词库规范化加固）**：`danger.ts:67-69` 仅 toLowerCase。建议 NFKC 折叠（全角 Ｐａｙ→Pay）+ 剥离零宽字符（U+200B-200D/FEFF）后匹配；评估 PayPal/Alipay 等驼峰品牌是否显式入词（`\b` 对 Alipay/PayPal 不命中）；将「OCR 引擎自身的规范化行为」列为未验证依赖。
- **Y3（L2 对话框不枚举点击目标）**：`server.ts:470-481` 仅列任务/应用/预算/type 语料——点击目标（锚文本/坐标）完全不可见，LLM 可写一份人畜无害的 task 文案掩盖危险点击序列。建议逐字枚举点击目标（复用 :477 的 JSON.stringify 模式）；task 行同法转义防换行伪造对话框版式。
- **Y4（节流实现与注释承诺不符）**：`computer-input.ps1:221-229` 的 `Start-Sleep` 发生在**数组累积**阶段，随后 32 事件（16 字符）一次性 SendInput 爆发——对「OSR 丢瞬时事件流」的防护名存实亡（S-5 T6 的 200 事件突发是在 WinForms 夹具上测的，C2 保留对 OSR 明确未证）。改为按字符/小批 SendInput + 批间 sleep。
- **Y5（目录预置/symlink 面）**：evidence 基目录与 %TEMP% 捕获目录无 reparse-point/ACL 检查；同用户攻击者可预置 symlink 重定向写入。属 A7③ 已接受的同用户残余，但应在 `evidence.ts` 头部与 §E.5 明文，并在 init 时拒绝 reparse point。
- **Y6（小项）**：`OCRFAILED` 前缀仍未入 `PS_ERROR_CODES`（`win-adapters.ts:29-41`，评审 N1 遗留）；`runPs` 默认 maxBuffer 1MB，超大 OCR 输出会误标 INJECT_FAILED；`Locator.ensureLanguage` 接口方法生产零调用（死接口）；预算续期 `executor.ts:323` 不回读 `config.computer?.budget`（与 :247 初值不一致）。
- **Y7（跨任务预算不可聚合）**：任务拆分（10 任务 × 15 动作）可放大总动作量，每次 L2 只见本任务草案（确认疲劳）。建议 L2 对话框展示「本会话累计已批准注入动作数」，或将累计量纳入速率限制。`budget` 参数 LLM 可控（≤30）本身可接受。
- **Y8（注释坐标系误导）**：`computer-evidence-seal.ps1:15` 与 `computer-imgdiff.ps1:11` 注释称 client px，实际图像空间；`diff()` 的 crop 只作用于 A 图的语义需在类型注释保持（types.ts:191-199 已做对）。
- **Y9（缺口 6 仍未关闭）**：真实夹具 E2E 仍无记录——IL/桌面拒绝、FOCUSLOST、真实 OCR/diff 阈值校准、type 真实注入全部零自动/手动留痕覆盖；评审设定的「手动集成测试清单执行留痕」是 WP1 验收的**正式门禁**，本裁决重申：未执行前不得宣告 WP1 通过。夹具需随 X1 扩 in-window 对话框模式。
- **Y10（威胁模型落字）**：DPAPI CurrentUser 下「同用户进程可 Unprotect」仅见于 A7 修订文本，应同步进 `evidence.ts:1-13` 头部注释与 plan §E.5，保持代码-文档互证。

---

## 4. 攻击面逐条覆盖表

| 攻击面 | 结论 |
|---|---|
| 1a. R1 全出口 | 进程内全出口已覆盖（四性质测试）；**崩溃窗口未覆盖 → X6** |
| 1b. R3 词边界 CJK/全角 | CJK 混排正确（`支付Pay`/`Pay付款`/`pin码` 均验证）；全角/零宽规范化缺位 → Y2 |
| 1c. R4 像素替身被骗 | 亚阈值语义替换可通过（同色同字宽文字、区域外阴影诱导）；字段语义已诚实降级，残余知情接受 → Y2 类 |
| 1d. R5 后用户信息充分性 | 纯文本 re-L2（命中词+任务+风险说明），无截图——WP4 preview_image 门禁重申 → Y9 |
| 2a. 300ms 重截与注入间 race | 存在且被 re-L2 放大至分钟级 → **X3**；PIXEL_STALE_MS dead |
| 2b. 渐变/亚阈值绕过 imgdiff | 单帧比对非累计，攻击窗口=一次 OCR 时长；亚阈值文字替换可过 → 已并入 X1/Y2 类记录 |
| 2c. 持续抖屏 | **诚实失败，无死循环**：单次重定位，失败 STALE_SCREENSHOT，抖动全变 uncrossverified 点击 → 子预算 3 耗尽 → re-L2，有界 |
| 3. 对话框启发假阴 | 半透明/小面积/同色/非矩形/同 hwnd 自绘对话框可绕过双通道 → **X1**（含定量证明） |
| 4a. ps1 argv-only | 成立：execFile + `-File` + argv 数组，文本走 argv 元素，无字符串插值执行 |
| 4b. OCR WinRT 反射类型混淆 | 无：`MakeGenericMethod` 仅内部固定类型，外部输入只有路径 |
| 4c. DPAPI entropy/scope | CurrentUser + 无自设 entropy，标准用法；同用户 Unprotect 残余 → Y10 落字 |
| 4d. 路径 symlink/预置 | cap 文件名 12 hex 随机不可预测；目录预置属同用户残余 → Y5 |
| 5a. DPAPI 威胁模型诚实 | 修订文本有，代码/方案节未同步 → Y10 |
| 5b. TTL 清理竞态 | janitor 仅任务触发；活动任务目录 mtime 持续刷新，误删需任务暂停 >7 天且 fail-closed 方向（seal 失败）→ 可接受 |
| 5c. blur 可逆性 | 16×16 均值马赛克对文本实践不可逆（残留长度信息）；建议改纯色填充更便宜更强 → 并入 Y5 类 |
| 6a. schema 长度/枚举约束 | 枚举/strict/actions≤50 到位；**text/task 无长度上限 → X4** |
| 6b. 预算 15 任务拆分 | 可拆分放大，无跨任务聚合 → Y7 |
| 6c. originWs 张冠李戴 | **不成立**：闭包绑定调用时 ws、respondFrom 原点校验（`security-confirmation.ts:251`）、断连仅拒本 socket 且 fail-closed、re-L2 fallback 返 denied（`server.ts:1820`） |
| 7a. 测试是否断安全性质 | 是：断 typed code/confirm 次数/seal 序列/删除清单/blur 几何；少量负载性子串可接受 |
| 7b. fake 与生产 ps1 的差 | 留有洞：IL/桌面/FOCUSLOST/节流/真实阈值校准零覆盖 → Y9；X1/X4 两条本身只能经真实路径暴露 |

---

## 5. 确认做对的地方（简短）

1. **R1–R5 全部是真修复**：每条都有对应性质测试锁定行为而非形状，复审中未发现表面修复。
2. **A3 全链与 A4 无路径拒的代码形态**：token 绑定全草案哈希（签发/验证同函数防发散）、硬拒分支零 confirm 调用且测试断言 `captured.length === 0`。
3. **originWs 闭环**：类型级 REQUIRED + 闭包绑定 + respondFrom 原点强制 + 断连 fail-closed，多标签/重连场景无张冠李戴。
4. **抖屏/重定位有界**：单次重定位 + 诚实 STALE_SCREENSHOT + 子预算兜底，无死循环。
5. **ps1 纪律与 fail-closed 默认值**：argv-only、15s 超时、绝对路径 powershell、DPI 自归一化、`diffRatio ?? 1` 缺省取最保守值、IL/桌面探测失败即拒。
6. **证据链 seal 顺序**：先模糊后加密再删 raw；janitor/purgeAll 纯函数可测；history.db redaction 有「明文绝不落盘」实证测试。

## 6. 本机复验记录（2026-07-19 +0800）

| 命令 | 结果 |
|---|---|
| `companion: node node_modules/typescript/bin/tsc -p tsconfig.test.json` | exit 0 |
| `node --test .test-dist/tests/computer-*.test.js + apps-coordinate.test.js` | **122/122 pass**，0 fail |

---

*复审触发条件：X1–X6 修复合入 + 缺口 6 手动集成测试执行留痕（Y9）。X1/X2/X3 任一未修前，WP1 不得对外宣称满足 A1/A2 不变量。*
