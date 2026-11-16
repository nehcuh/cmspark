# Shell 启用路径盘点与阶段 2b 边界

GitHub: 实施 2b 前须另开设计 Issue。本文件不是实施授权，不改产品行为。

基线：`aa011ac93148b163e16e1f5f82f4279271d08b6b`。证据来自该树上的源码阅读，不是浏览器点击实测，也不是对点击次数的计数。写文档时 CI `43799582557` 仍在该 SHA 上运行，不把该运行记成全绿。

四条能力分开记。下文的「shell」只指宿主工具 `shell_exec` 及其模块电源。本机终端、内嵌 PTY、ACP 编程接力各自另列。

## 1. 要让 `shell_exec` 真正可执行，源码上的顺序

下列顺序是调用链推导，不是实测步骤数。

1. 扩展已经连上 Companion。设置页「连接与配对」写明首次启动要粘贴配对密钥（`SettingsSlideout.tsx` 891）。未连接时后台转发会失败；本盘点没有在浏览器里制造断连。
2. `capability_profile` 为 `enterprise`。默认是 `community`（`companion/src/capability/modules.ts` 62）。
3. 模块 `shell` 的 `enabled` 为 true。默认 `enabled: false`，策略 `confirm_per_command`（同文件 22–28）。
4. 模型发起 `shell_exec` 时，`checkShellScope` 再查一次模块（`companion/src/capability/shell.ts` 401–403）。未开启则错误是 `module_disabled:shell — enable in settings (modules.set_enabled) before use`（`modules.ts` 77–81）。
5. 模块已开仍默认要 L2 确认令牌。`companion-dispatch.ts` 1289–1299：没有 `security_token` 就返回 `shell_exec requires L2 security_token confirmation`。`l2-admission.ts` 1107–1115 写明 `auto_approve_dangerous` 单独不跳过 `shell_exec`。能跳过的是企业全局开关 `security.auto_approve_enterprise_tools`，或仍有效的企业会话信任（同文件 1214–1230），以及三旗全自动巡航（1100–1102 的注释）。这些开关不在本盘点里改语义。
6. 执行前 `shellExec` 再查模块、策略和空命令（`shell.ts` 722–731）。

`shell` 模块开启本身没有确认短语。短语「我了解风险」只出现在会写入巡航旗的场景 Trust，以及设置里的三旗武装。见第 3 节。

## 2. 用户能碰到的入口

### 2.1 能力档：只给资格，不开 shell

| 项 | 源码 |
|---|---|
| 组件 | `CapabilityProfileSection.tsx` 15–98，挂在设置「本机与工具」`SettingsSlideout.tsx` 3173–3208 |
| 读状态 | 挂载时 `chrome.runtime.sendMessage({ type: "modules.list" })`（31）。`modules.list` / `modules.updated` 更新本地 `profile` 与 `modules`（33–47） |
| 确认 | `window.confirm`，文案来自 `buildProfileSwitchConfirm`（`capability-profile.ts` 23–53）。升到 enterprise 的正文写明不会自动开启模块。切回 community 且 shell 或 netsec 已开时，正文写明会强制断电 |
| 发送 | 用户确认后 `resolveProfileSwitchSend` 才产生 `{ type: "modules.set_profile", profile }`（61–68）。同档或未确认则不发送 |
| 后台 | `background/index.ts` 1632 把 `modules.set_profile` 列入转发。本函数没有读到 `settings-save` id 或 `config_revision` |
| Companion | `message-router.ts` 5455–5478。`profile` 只能是 `community` 或 `enterprise`。当前 UI 不带 `profile_receipt_protocol`，成功回复是 `modules.updated`，带 `modules`、`capability_profile`、`modules_disabled`。带协议 1 才会走 `modules.profile.result` |
| 失败 | 组件把任意 `error` 帧闪成 `msg.error`，5 秒（49–51）。没有单独的断连槽，也没有阶段 1 的 `immediateSave` |
| 前提 | 扩展能把消息送到 Companion。不要求已登录某个网站。不改变三旗 |

文案里的「本机能力」指向场景页，不是这个区块。这个区块的按钮文案是「切换到 enterprise」或「切回 community」（87–88）。

### 2.2 场景页「本机能力」：真正把 `shell.enabled` 写成 true

| 项 | 源码 |
|---|---|
| 组件 | `PacksPanel.tsx` 1548–1568。`shell` 显示名「本机命令」（1301–1305） |
| 点击 | `enableModule`（711–716）发送 `{ type: "modules.set_enabled", module, enabled: true }`。没有确认短语，没有 `id`，没有回调 |
| 乐观提示 | 发送后立刻 `flash("已请求开启本机能力：…")`。勾号只在本地状态 `modules[mod].enabled === true` 时出现（1560–1563） |
| 回执 | 监听 `modules.list` / `modules.updated` 后 `setModules`（665–667）。`useWebSocket.ts` 1638–1639 收到 `modules.updated` 后不再写入 store |
| Companion | `message-router.ts` 5443–5453 调用 `setModuleEnabled`。`shell` 或 `netsec` 在 `enabled: true` 且档位不是 `enterprise` 时返回 `enterprise_profile_required — set capability_profile=enterprise for shell/netsec`（`modules.ts` 97–104）。成功写 `saveConfig({ modules })` 并记 capability audit（110–116），回复 `{ type: "modules.updated", modules }` |
| 失败 | 同面板把 `error` 帧闪成 `msg.error`（693–701）。通道 `lastError` 没有被这个调用读取 |
| 关闭 | 这段 UI 在已开启时只显示勾号，没有关闭按钮。服务端 `setModuleEnabled(id, false)` 存在，但本面板不发送 `enabled: false` |
| 设置跳转 | 「网络扫描目标 / 本对话授权 → 设置」（1566–1568）只 `SET_SETTINGS_OPEN true`（838–840）。设置默认页是 `model`（`SettingsSlideout.tsx` 188），不会自动落到「本机与工具」 |

已登录 Chrome 不是这条消息的参数。需要的是侧栏能连上 Companion。

### 2.3 用户场景 Trust：可以连带打开 shell，而且可能写巡航旗

`PacksPanel.tsx` 1180–1223：勾了「开启模块」或「跳过 L2」，且工具允许列表含 `shell_exec` 时，把 `shell` 放进 `enable_modules`。`skip_l2` 且还没有任何模块时，会同时放进 `shell` 和 `netsec`。`set_enterprise_profile` 在要开 shell/netsec 或 `skip_l2` 时为 true。

用于本对话时，若 Trust 会写巡航旗，输入必须等于 `我了解风险`（45–48、741–744），并随 `pack.apply` 的 `confirmation_phrase` 送出（752–759）。Companion `pack-engine.ts` 1796–1807：巡航旗短语不通过则 `trust_phrase_required`，并说明这不是无人值守武装。`applyUserPackTrust`（195–214）会把档位升到 enterprise，再按 `enable_modules` 开模块。

这是现有手动确认，不是 shell 电源按钮的短语。2b 不改这段。

### 2.4 失败后的现有指路

`gate-error-copy.ts` 59–64：错误正文匹配 `module_disabled`、`module_unavailable`、`enterprise_profile` 或「本机能力未开启」时，聊天错误写成「侧栏 **场景** → **本机能力**」以及「设置 → 能力档」。`useWebSocket.ts` 675–686 把这段做成一条 assistant 消息。没有按钮。

场景面板的打开函数存在：`SettingsSlideout.tsx` 372–378，`host.openPanelForce("packs")`。能力档所在页的深链动作存在：`OPEN_SETTINGS_SECTION`（`agentStore.tsx` 1750–1755）加上设置页 effect（353–361）。「本机与工具」的 id 是 `integrations`（`SettingsPage.tsx` 11）。

### 2.5 语义设置助手：不开启 shell

目录项 `security.permissions`（`companion/src/settings-assistant/catalog.ts` 38）范围是 `manual`，栏目 `security`，前提是「授权、安装、配对、凭据和危险权限不通过语义候选自动修改」。应用时 `settings-assistant/index.ts` 124 对 manual 只回「尚未修改：请进入原设置入口核对并单独确认。」

侧栏回执按钮「打开对应设置核对」（`SettingsIntentBar.tsx` 151）调用 `onOpenSection(item.section)`。设置里把它接到 `selectSettingsPage`（`SettingsSlideout.tsx` 835）。因此这项打开的是「安全与信任」，不是场景页的 shell 电源，也不是「本机与工具」里的能力档。

规则导航只能打开会议、场景或语音设置（`SettingsIntentBar.tsx` 102–130，`settings-intent.ts` 33–41）。没有「打开 shell」规则。

### 2.6 安全与信任页：不代替 shell 电源

`SettingsSlideout.tsx` 3178–3203 用三句话区分场景、本机能力、运行自主度。企业高危开关文案含「shell / netsec」（2975、2984），协议解锁文案写明不含 shell forceConfirm（610、3081）。这些是阶段 1 已收口的即时 `config.set`，确认短语仍是现有常量。它们改变的是确认频率，不是 `modules.shell.enabled`。

### 2.7 首次引导

源码里没有单独的 shell 开通向导。设置「连接与配对」的首次说明只讲配对密钥（891）。编程接力文案里的「首次启动会自动开启本机 Agent 会话能力」（`coding-handoff/copy.ts` 174–175）指的是 ACP，不是 `shell` 模块。

## 3. 另外三条，不要并进 shell 电源

### 本机终端（模式 C）

设置开关在 `SettingsSlideout.tsx` 3233–3244，走阶段 1 的 `submitImmediate({ coding_handoff: { open_local_terminal } })`。文案在 `coding-handoff/copy.ts` 109–119：侧栏与本机终端是两个进程；Linux 写的是 `$TERMINAL` 或常见模拟器。Companion `open-local-terminal.ts` 1211–1213 与 1420 附近有 Linux 打开器。这不是 `modules.set_enabled`。

编程面板里还有一份同键开关 `CodingAgentPanel.tsx` 780–794：先 `SET_CONFIG` 再发没有 id 的 `config.set`。它没有走阶段 1 回执。2b 不改这一处。

### 内嵌 PTY

设置开关 `SettingsSlideout.tsx` 3247–3251，`submitImmediate({ embedded_terminal: { enabled } })`。文案写「实验 · 默认关 · macOS / Windows」（`copy.ts` 112–114）。`companion/src/pty/session.ts` 383–391：宿主不是 darwin 或 win32 时返回「内嵌终端仅支持 macOS / Windows（Linux 另票）。」代码 `unsupported`。Linux 声明保持这条，不把 `shell_exec` 说成同样不支持。

### ACP 编程接力

设置总开关 `SettingsSlideout.tsx` 3256–3259，阶段 1 回执，短语不需要。编程面板首次启动会另发 `{ type: "config.set", config: { acp: { enabled: true } } }`，只看传输回调 `{ ok: true|false }`，再轮询 `acp.list`（`CodingAgentPanel.tsx` 671–692、742–753）。没有 `settings-save` id，也没有模块 `shell`。启动前还要云模型披露勾选（653–655）。本盘点没有在源码里看到 ACP 总开关按 Linux 禁用。

## 4. 阶段 2b 建议

只做导航和状态诚实，不新增授权通道。推荐方案待协调者确认后再写 Issue 和实施。

推荐：

- 在现有 `humanizeSidepanelGateError` 的「本机能力未开启」结果上，增加两个只导航的按钮。一个调用已经存在的 `openPanelForce("packs")`，落到场景页「本机能力」。一个派发已经存在的 `OPEN_SETTINGS_SECTION`，`section: "integrations"`，落到能力档。按钮的处理函数不发送 `modules.set_enabled`、`modules.set_profile`、`config.set` 或 `pack.apply`。
- 场景页 shell 电源保留现在的无短语点击。发送后本地状态显示「已发送，等待 Companion」，只有 `modules.updated` 里该模块 `enabled === true` 才显示已开启。`error` 帧或 `chrome.runtime.lastError` 显示失败，并保持未开启。断连没有新超时；通道错误用现有回调能看到的 `lastError`。不把这条写进 `settingsSave` / `immediateSave`。
- 企业档 `window.confirm`、Trust 的「我了解风险」、三旗即时回执、L2 确认台都保持原样。

不在 2b 做：

- 用语义目录新增「打开 shell」或把 `security.permissions` 改成可自动提交。那会扩大助手能提到的权限面。若协调者以后要做，应是另一条 manual 候选，并且按钮仍然只导航。
- 给 `modules.set_enabled` 增加新的 id 协议。现有权威回执是 `modules.updated` / `error`。阶段 1 的 `settings-save` 回执继续只服务已经接入的设置 `config.set`。
- 改写 `CodingAgentPanel` 的 ACP 启用和模式 C 开关。它们不是 shell 电源；设置页对应开关已经有回执。
- 改 Linux PTY 的 unsupported 返回，或改本机终端的 Linux 打开器。

验收时要能用测试证明：

- 给定 `module_disabled:shell` 或 `enterprise_profile_required`，导航结果指向 `packs` 与 `integrations`，且结果对象里没有待发送的模块或配置消息。
- 其他错误不出现这两个按钮。
- 电源按钮在 `modules.updated` 之前不算已开启；`error` 或通道失败后仍是未开启。
- `buildProfileSwitchConfirm`、`resolveProfileSwitchSend` 的现有测试仍要求未确认不发送。
- 阶段 1 即时回执套件仍全绿。确认短语常量和三旗文案不被这组改动碰到。

## 5. 已核对与未核对

已核对：上述文件与行号在基线树上的当前内容；`modules.set_profile` 未确认不发送；`setModuleEnabled` 对 community 拒绝打开 shell/netsec；内嵌终端对非 macOS/Windows 返回 unsupported；语义 manual 项不写配置；设置页编程开关与编程面板的 `config.set` 不是同一条发送路径。

未核对：没有在浏览器里点击这些按钮，没有数点击次数，没有断开机实验，没有在 Linux 上执行 `shell_exec` 或打开本机终端。CI `43799582557` 在写本文时尚未结束。
