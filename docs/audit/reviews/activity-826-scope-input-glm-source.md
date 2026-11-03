# Scope owned-input setup — actual GLM source gate

- Verdict **APPROVE**, confirms independent B source approval; no reachable blocker.
- Base `67c5e209d239995b930fe1dfcc54f444005e44f8`; all four source hashes in structured receipt.
- Manifest SHA256 `78ac41343f2f652d9c1229efc0da63c2c45576b75472896c6629041f866ecfc9`; complete fourfile diff SHA256 `e6d97c65e8d223a9e87e0e1ba418c42371be6fdc8730ddeba7836f84145edded`.
- Prompt SHA256 `3d2abe778690e152cb4aca9f8bd0958b85f224e3acb63e09eaa58f5c4dce54a9`; 128901 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `376346ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 32900, "outputTokens": 14790, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.5342499999999999, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Known prototype gap closed by actual setupComplete fence, new actual late-qualified-event controls and independent deleting-the-real-fence RED. Old22prototype is not evidence for this property.
- Permission: frozen fourfile commit and exact-head canonical CI after coordinator gates. Original10s/180s/business/cleanup remain. No Windows runtime/input/business acceptance, human approval, historical cause, extra MCP probe, merge or release approved.

## Actual reviewer response (verbatim)

## 独立源码复审结论：APPROVE(确认 B 的 APPROVE)

以下基于所提供的冻结四文件完整源码、base 67c5 完整 diff、两份 12/12 TAP 日志、B 的 fence 变异对照日志及 C#/clang 预检，逐项对照本评审边界；未使用工具、未发起任何 dispatch(MCP 探针不在本次范围内)。

**一、已知的原型缺口在真实调用点闭合，而非掩盖。** Build 闭包中 `Action check` 首行即 `if (!setupComplete) return;`,而 ready/ack 的 `Write` 只存在于 check 内部；到达 check 的全部四条路径(ContentRendered 尾部调用、Activated/GotKeyboardFocus 的 BeginInvoke、resize 经 CheckCurrentReceipt)同受此单点栅栏约束，C# 源中 IsReady 亦仅被 check 调用，不存在无栅栏写入路径。setupComplete 仅在 SetupOwnedClick 完整返回后置真，而该 helper 正常返回当且仅当 `SendInput(3,...)==3`。失败路径为 INPUT_REFUSED→尝试写 failure.json→Shutdown(2)→return,setupComplete 永久为 false;failure.json 写入自身抛错也被内层 catch 吞掉，Shutdown 仍执行。测试 8 对 inserted=0/1/2、covered-root、ABI 五种失败，在 SendInput 端口内回灌 onActivated/onKeyboardFocus 并 flush,失败后再令 foreground/IsKeyboardFocused 为真、直接调用真实 IsReady 断言返回 true,并再次派发两事件+CheckCurrentReceipt+onRendered,断言除 failure.json 外零写入、零重发；Write 抛错分支亦得 shutdowns=[2]。B 的变异控制删的是 C# 源中真实的 `if (!setupComplete) return;` 才转 RED,证据形态是当前 12 用例+源级变异，而非旧 22 原型或“Main catch 足够”的假设，符合协调者修正要求。

**二、输入面自洽且不扩张。** wire 段已无 `.Activate(`/`.Focus(`(doesNotMatch 且实际 calls 仅 ['input:17']);requested 先于调用置位，重入事件不能重发；resize 复用同闭包不新建点击；popup 各自独立一次。helper 依序拒绝：WPF 状态→HWND/IsWindowVisible/PresentationSource.Handle 精确相等→有限几何→floor 后整点回投 TextBox 内部→整窗 InputHitTest 且命中须为 focus 本身或其后代(同 HWND 兄弟覆盖层被拒)→GetClientRect/ScreenToClient→76–79 虚拟屏边界((long) 加宽、宽≤1 先拒)→运行期 ABI→WindowFromPoint→GA_ROOT(2) 等于自身根→PID 属本进程；随后单一三记录 type0 全零批(MOVE|ABSOLUTE|VIRTUALDESK、LEFTDOWN、LEFTUP),负原点先减再按 65535/(w-1) 归一。35 项拒绝均零输入，正向对照证明端口链真实到达。失败一律抛错并关停，无 SetForeground/SetCursorPos/提升/揭开等回退动作。

**三、布局与诚实边界。** Sequential `Input{uint Type;MouseInput Mouse}` 非伪联合声明；对 type0 与原生最大联合成员布局等价：inputLayout 解析真实字段得 x64 40/Mouse 偏移 8、x86 28/偏移 4,与 clang Windows x86_64/i686 static_assert 及两条源 ABI 分支互证；真实 CLR Marshal.SizeOf 若不符将由 C# 内 `inputSize!=40/28` 先拒。PInvoke 签名(POINT 按值、out RECT/PID、DWORD 计数/尺寸)匹配 winuser。Math.Round 端口的 midpoint-to-even 与 C# 语义一致。以上均为源码/静态证据；真实 Windows 编译与输入投递明确留待下一门，依本评审边界不构成源码阻断项。

**四、保留与闭环。** diff 未触碰 IsReady 与 native test/helper:10s 回执、180s 案例、probe 前台不变断言、OCR 裁剪/侧栏/嵌图/模型、resize/popup、failure.json 快速判别失败、finally 子关闭→投影→清理→lease 顺序与 pending 清零断言均在。observation.cjs 闭集只含 INPUT_COMPLETE/INPUT_REFUSED,旧 ACTIVATE_/FOCUS_ 文件显式保持 UNKNOWN,无伪装兼容分支；16 个名字均对 C# 字符串字面量闭环。原 128 组合与查询计数(含抛错观察者)与录制基线全等，原 8 项行为经真实适配器保留；adaptSetup 为锚定一对一端口并断言无 C# 残留，非自造替身。

**五、非阻断观察。** Shutdown(2) 后 Main 返回 0,但 scope825Receipt 由 failure.json 判别快速失败；banker 舍入与 OS 逆映射至多一像素偏差，中心点击远在 TextBox 内，未命中即为可判别失败；hit-test→SendInput 非原子、非 HWND 定向，依赖受控租用测试桌面——源码注释如实声明。历史 OS 原因未知不影响本次具体修正的评审。

综上，B 的 APPROVE 与机器证据相互印证，未发现可达且有据的阻断项。本批准仅授权冻结四文件提交及协调者门禁后的 exact-head canonical CI;不声称 Windows 输入/业务验收、人类批准、历史成因结论、合并/发布，亦不包含或追加任何 MCP 探针。

**VERDICT: APPROVE**
