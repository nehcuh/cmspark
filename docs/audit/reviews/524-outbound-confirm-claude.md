核对完毕，汇总评审结论。

---

## 双路独立复审报告（#524 租手确认与 Windows 配置）

### 核对结果（对应 8 个验证点）

**1. `[Outbound]` 前缀覆盖面 — 覆盖现有全部租手确认路径**
- 首次外泄：`companion/src/outbound-mcp/companion-http.ts:208` `toolName: \`[Outbound] ${internal}\``，外泄类 = get_page_text/screenshot/get_page_html/analyze_image（profile.ts:110-117）。
- navigate/create_tab URL 门：`companion/src/tool/url-cookie-admission.ts:395` 同样加前缀。
- 唯一无前缀的 WS 侧确认在 `companion/src/tool/l2-admission.ts:1488`（只有 1270 行的 tray 请求加了前缀），但 `L2_GATE_TOOLS`（l2-admission.ts:64-83）与三个 outbound profile 工具集（profile.ts:21-66）**不相交**，租手工具今天到不了那里。见 NIT-1。

**2. open_focus 真开窗，侧栏关时后台仍收到**
- `chrome-extension/src/background/index.ts:581-583`：`decideCockpitFocus(...) === "open_focus"` → `openOrFocusCockpit()`。
- `cockpit-window.ts:139-204`：已有窗则 `windows.update({focused:true, drawAttention:true})`，否则 `windows.create({type:"popup", focused:true})`。
- WS 由后台持有（架构 A2；`confirm-fanout.ts:77-87` 把确认发给所有已鉴权非 summoner peer，即后台 WS），侧栏开不开无关。文档前提写满了（mcp.md:346「扩展需已连接」；TROUBLESHOOTING.md:301「Chrome 要开着、扩展要已连接」）。

**3. fullPreview 不改侧栏可批性，未误开 nonce**
- `MinimalConfirm.tsx:147-148`：允许键只被 `needsNonce || expert_team` 禁用；`full_preview` 不参与。companion-http.ts:205-214 的 opts 未设 `nonceChallenge`。侧栏红条仍可批，与 CHANGELOG 声明一致。

**4. 焦点例外未放宽，自动批准未绕过**
- `cockpit-focus-policy.ts:100-102`：`outboundChannel` 仅由 `tool_name` 以 `[Outbound]` 开头判定；新测试锁了普通 navigate 仍 `stay_background`。
- 出站轨道不吃任何自动放行：`url-cookie-admission.ts:366-370` `skipUrlConfirmation = outboundTrack ? false : …`（auto_approved_domains / auto_approve_dangerous / allow_all_schemes 全被挡），:338 L1 scheme 同理；外泄确认 `autoConfirmEligible: false`（companion-http.ts:213）。

**5. originWs 未丢**
- companion-http.ts:168-176 构造 `confirmOriginOpts`、:215 传入；本次 diff 只动了 `preview`/`fullPreview` 两个字段。outbound 本就按设计 unbound（confirm-fanout.ts:113-118），未被改动。

**6. Windows 路径文档基本诚实**
- CLI 在真 Windows 上印展开路径：grant-cli.ts:132-138（`process.env.LOCALAPPDATA` 存在时用真实值）。见 NIT-2 边缘情形。
- 侧栏复制片段（TSX:82-87）用 `C:\Users\<你的用户名>\...` 占位符，注释行与帮助文本都明说要替换、不要写 `%LOCALAPPDATA%`；照抄会失败但错误被明确警告，不算「复制即失败」陷阱。

**7. caller 原本就有输入框，本次加的是可见标签；权限入口名实相符**
- diff 旧代码已有 `value={callerId}` 输入框（旧 placeholder「caller_id（与 MCP 调用 body 绑定）」），本次加 label/help/aria。页面外泄勾选始终可见（TSX:322-335）；上下文出口按声明只在 `outbound_context_v1` 出现（TSX:336）。

**8. 测试只锁策略函数 — 属 NIT 不阻塞**
- 新测试锁 `cockpitFocusEventFromMessage` + `decideCockpitFocus` 纯函数（含无武装门断言）与 companion 帧形状（tool_name/full_preview/code_preview 含调用方）。没有任何测试锁「后台收到帧 → 真调 openOrFocusCockpit」；但该接线（index.ts:581-583）不在本 diff 内、是既有行为（nonce/重预览路径同一接线）。风险可接受。
- 附：实现者称「cockpit-focus-policy.test.ts 36 通过」，该文件实际只有 19 处 `test(`（我未运行，静态计数）——声称数字对不上，疑为跨文件合计或口误，非代码缺陷。

### 阻塞项

无阻塞。

### 非阻塞 NIT

1. **l2-admission 前缀不对称（潜伏坑）**：`l2-admission.ts:1270` tray 请求加 `[Outbound] ` 前缀，但同函数 WS 侧 `securityConfirmations.request`（:1488）用裸 `toolName`。今天无租手工具在 `L2_GATE_TOOLS` 里所以不可达；将来任何 outbound 工具若进 L2 门，WS 确认将不带前缀、不弹窗，恰好复现 #524 投诉。建议后续统一。
2. **LOCALAPPDATA 缺失边缘**：Windows 上若 `process.env.LOCALAPPDATA` 为空（grant-cli.ts:132-133），CLI 会退回印 `%LOCALAPPDATA%` 模板，与 mcp.md:366「stdout 会印出已经展开的 command / args」字面矛盾。标准 Windows 环境不会发生，影响极小。
3. **「权限」帮助文本提及不可见的门**：OutboundMcpSettingsSection.tsx:319-320「页面外泄和上下文出口是两道门」在非 context 档下也显示，而上下文出口区块（:336）此时隐藏，轻微误导。
4. **报告数字不准**：测试通过数声称（36/38）与文件内静态计数不符（19/22 个 `test(`），建议修正说法。

能力声明（ADR-020）与代码事实一致：仅 Surface 变化（open_focus 例外），无 L2-class/Compose/Autonomy 扩张，Trust 仍 fail-closed 45s 拒绝，Channel 声明与 fan-out 实现相符。

VERDICT: APPROVE_WITH_NITS
