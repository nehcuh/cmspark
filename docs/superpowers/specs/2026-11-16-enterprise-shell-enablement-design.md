# enterprise 档始终提供 shell

GitHub: #853

状态：设计说明。尚未实现。实现计划和测试要等这份说明经过独立评审，并且用户读过后另授权。本文件不改产品代码。

用户已确认的产品句：enterprise 档始终提供 shell，不再保留单独且生效的 shell 开关；命令执行授权仍独立保留。这取代「只在升级那一次打开 shell，之后仍可单独关闭」的方案。不能把实现退回 on-upgrade-only，也不能留下一个用户还能拨动、并且会改变 shell 是否可用的电源。

## 当前行为

证据来自合并提交 `bdfbeee333a51028d5df89d9c772012cd6f71076` 上的源码，不是浏览器点击。

- `companion/src/packs/pack-engine.ts` 的 `setCapabilityProfile` 升到 enterprise 时只写 `capability_profile`。降到 community 时把已经 `enabled === true` 的 shell 和 netsec 写成 `enabled: false`。
- `companion/src/capability/modules.ts` 的 `setModuleEnabled` 在 community 下拒绝打开 shell 或 netsec，错误是 `enterprise_profile_required`。shell 默认 `enabled: false`，`policy` 默认 `confirm_per_command`。
- `requireModule("shell")` 在未启用时返回 `module_disabled:shell — enable in settings (modules.set_enabled) before use`。这句不能原样留下：新语义已经没有这颗电源。`checkShellScope` 先走这道门，再走命令策略。`commandAllowedByPolicy` 在 `confirm_per_command` 下放到后续 L2。
- `setModuleEnabled` 自己决定拒绝或写入。`message-router.ts` 的 `modules.set_enabled` 只是把它的错误原样返回。`restoreTrustSnapshot`（`pack-engine.ts` 369–374）调用它后不看返回值。`computeApplyBlocked`（1391–1394）仍用 `m.enabled !== true` 判断，其中包含 shell。`acp/capability-context.ts` 27–30 在 Linux 上仍写「需先在设置启用 shell」。
- `config.set` 在 `message-router/handlers/config.ts` 把请求抄进显式白名单 `normalized`。白名单没有 `modules`。未列入的键被丢掉，正常的模型、安全和编程助手字段仍会保存。
- `setCapabilityProfile` 在 `from === target` 时直接返回当前快照，不会把 enterprise 下的 `shell.enabled: false` 补成 true。
- `modules.update` 会丢掉 patch 里的 `enabled`，不能用来开电源。
- 设置页 `CapabilityProfileSection` 和 `buildProfileSwitchConfirm` 写明：enterprise 只解锁资格，不自动打开模块。场景页 `PacksPanel` 对未开启的 shell 显示「开启」并发送 `modules.set_enabled`。
- 设置助手目录 `companion/src/settings-assistant/catalog.ts` 没有能力档，也没有 shell。模型只能从目录出候选。因此「如何开启 shell」会得到目录中没有这项，而不是去执行写入。
- 模式 C 本机终端、内嵌终端、ACP 是另外的配置和入口。内嵌终端的平台限制是 macOS / Windows。`shell_exec` 不使用这道 PTY 限制。

## 权威定义

Companion 增加一个函数，名字实现时定，下文叫 `shellProvision`。它是 shell 是否提供的唯一判断。`requireModule("shell")`、`modules.list`、档位回执快照、场景页和设置页所展示的 shell 状态都调用它，或调用它写入后再投影的结果。禁止在 UI、工具门和 pack 应用里各自写「profile 是 enterprise 吗」。

```text
shellProvision(config) =
  provided
    当 capability_profile === "enterprise"
    且 modules.shell 存在
    且 modules.shell.available === true
  否则 not_provided
原因：
  community        capability_profile 不是 enterprise
  unavailable      shell 模块缺失，或 available 不是 true
```

`modules.shell.enabled` 不再是输入。它只保存与 `shellProvision` 相同的投影，供旧客户端读取。`policy`、`allowlist_commands`、`enabled_at` 以外的策略字段继续是运行策略，不是电源。

本子项目不新增「企业策略关闭 shell」的开关。仓库里没有这样的独立字段。若 `available !== true`，shell 不提供，错误沿用模块不可用，不把它做成第二颗电源。连接失败仍是传输或回执错误，不写成 shell 未启用。操作系统对 `shell_exec` 没有单独的启用门；Linux PTY 和 Whisper 不在本子项目实现。

## 持久化与迁移

归一化是纯函数，作用在即将写入的配置对象上。`saveConfigInternal` 在原子写入前对这份对象调用一次。它不调用 `getConfig`，也不再调用 `saveConfig`，所以没有读副作用，也不会写回环。

加载配置时若投影和磁盘不一致，只额外调用一次 `saveConfig` 写入 shell 的 `enabled` / `enabled_at` / `enabled_by`。这次调用进入 `saveConfigInternal` 后投影已经一致，不会再触发第二次修复。修复写入失败时不把内存状态当成已提供或已关闭，并向 `modules.list` 返回 `SHELL_PROVISION_RESULT_UNKNOWN`。

成功写入的配置在返回前满足：

- enterprise 且 `shellProvision` 为 provided：`modules.shell.enabled = true`，`enabled_by = "profile.enterprise"`。若原值不是 true，`enabled_at` 写成这次归一化的时间；原值已是 true 则不改 `enabled_at`。保留原有 `policy` 和 `allowlist_commands`。
- community，或 shell 不可用：`modules.shell.enabled = false`，`enabled_at = null`，`enabled_by = null`。同样保留策略字段。
- 不改 `modules.netsec`、`appsec`、`devsec-workspace`，除非原有降级逻辑本来就要关闭已开启的 netsec。

已经是 enterprise 且磁盘上 `shell.enabled === false` 的安装，在 Companion 加载配置后、响应 `modules.list` 或执行 `shell_exec` 之前完成这次归一化。归一化是幂等的。完成后，列表、设置、场景和工具门看到的都是 provided。不允许解释成「保留用户旧的关闭」。

归一化失败或写后快照读不回上述结果时，调用方得到 `SHELL_PROVISION_RESULT_UNKNOWN`。这时不宣告 shell 已提供，也不宣告用户的旧关闭仍然有效。

设置页和场景页收到该错误时显示「shell 提供状态未知」，不显示已提供或未提供。旁边的恢复动作只发送 `modules.list`。列表返回明确投影后，两处改成对应的只读句子。列表失败或仍是未知，就保持未知。已经是 enterprise 时，这个按钮不是再次升档：`setCapabilityProfile` 对相同档位早返回，不会修补 `shell.enabled: false`。加载归一化才是这条旧数据的修复路径。

## 档位切换

升级确认仍是现有的两步：`buildProfileSwitchConfirm` 的文案先说明结果，用户取消则 `resolveProfileSwitchSend` 返回空，不发送。

确认文案改为：

- 升到 enterprise：本档会提供 shell。netsec 不会因此打开。每条命令仍按现有策略和 L2 确认。三旗、确认短语和自动批准不变。
- 切回 community：shell 不再提供。当前已开启的 netsec 仍按现有降级逻辑关闭。

`modules.set_profile` 的成功回执只在快照同时满足目标档位和 `shellProvision` 时成立。升到 enterprise 的成功快照必须是 `capability_profile: enterprise` 且 `modules.shell.enabled: true`，并且 netsec 的 `enabled` 与写入前相同。降到 community 的成功快照必须是 community 且 `modules.shell.enabled: false`；原来开着的 netsec 仍为 false。

`PROFILE_REVISION_CONFLICT`、`PROFILE_STATE_INVALID`、`PROFILE_CHANGE_RESULT_UNKNOWN`、通道 `lastError` 和断连都不显示「shell 已提供」或「能力档已更新」。界面留在切换前的档位和投影。

再次升到 enterprise 会再次提供 shell。不存在「上次用户关过电源，所以这次不提供」。

## 旧客户端写入

拒绝发生在 `setModuleEnabled`，不是只发生在 WebSocket handler。`module === "shell"` 时，无论 `enabled` 是 true 还是 false，函数返回错误并且不调用 `saveConfig`。handler 因此不能返回 `{ type: "modules.updated" }`。错误文本是：

```text
type: error
error: shell_switch_removed — shell availability follows capability_profile; derived_enabled=<true|false>
```

`derived_enabled` 是当前 `shellProvision` 的投影。这不是成功。community 下 `derived_enabled=false`。enterprise 且 available 时 `derived_enabled=true`。

`modules.set_enabled` 对 netsec、appsec、devsec-workspace 保持现有行为。community 下打开 netsec 仍返回 `enterprise_profile_required`。

`config.set` 只有在请求体显式带有 `config.modules.shell.enabled` 时整次拒绝，错误同样是 `shell_switch_removed`，已允许的字段也不写入。没有这个路径的请求保持现有白名单：未知键继续被忽略，模型、安全、编程助手等已允许字段仍按今天的规则保存。不能因为请求里有其它未知键就让正常配置失败。

`modules.update` 继续丢弃 patch 中的 `enabled`，不能用来改变 shell 是否提供；策略字段仍按现有 enterprise 条件更新。

`restoreTrustSnapshot` 不再对 shell 调用 `setModuleEnabled`，也不再忽略它的返回值来假装恢复了 `enabled: false`。它先按现有方式写回档位和安全旗；`saveConfig` 内的归一化决定 shell 投影。快照里的 shell `enabled: false` 在结果档位仍是 enterprise 时不被恢复。netsec 及其它模块仍调用 `setModuleEnabled`，返回不成功时写入审计并保留该错误，不把它当成已恢复。

`computeApplyBlocked` 对 `requires_modules` 里的 shell 改调用 `shellProvision`。provided 时不因为磁盘 `enabled !== true` 返回 `module_disabled:shell`。community 返回 `enterprise_profile_required`，不返回教用户调用 `modules.set_enabled` 的句子。其它模块仍看 `available` 和 `enabled`。

`pack.apply` 成功把档位写成 enterprise 时，同一次 `saveConfig` 的归一化使 shell 为 provided。它不能留下 enterprise 加 `shell.enabled: false`。pack 对 netsec 的启用和信任短语保持现有门。

## 执行门

`checkShellScope` 先调用 `shellProvision`：

- not_provided 且原因是 community：返回 `enterprise_profile_required — set capability_profile=enterprise for shell`。文本里不出现 `modules.set_enabled`，也不出现「在设置里启用 shell」。现有工具卡、场景页和 ACP 提示如果匹配旧的 `module_disabled:shell — enable in settings (modules.set_enabled)`，要改成匹配这句新错误。
- not_provided 且原因是 unavailable：返回 `module not available: shell`。不提示去开电源，也不把这个缺口写成 Linux PTY 未实现。
- provided：不再因为 `enabled === false` 拒绝。继续执行现有的命令长度、空命令、`commandAllowedByPolicy` 和 L2。`confirm_per_command` 仍不在这一层放行执行。

界面在 enterprise 下不得显示「shell 已开启」之后，又只因为旧的 `enabled: false` 被后端拒绝。

## 界面和助手

场景页不再渲染 shell 的「开启」按钮，也不再为 shell 发送 `modules.set_enabled`。shell 行只读：

- enterprise：`shell 已由 enterprise 档提供。执行命令仍需单独确认。`
- community：`shell 随 enterprise 档提供。确认升档后可用。`

netsec、应用安全、工作区读写的电源按钮保留。

设置页能力档的说明与确认文案使用上一节的句子。不再写「切换本身不会开启任何模块」来覆盖 shell。netsec 仍写明不会自动开启。

失败导航：

- community 的 shell 资格错误：主按钮打开设置「本机与工具」的能力档。可以保留打开场景页的次按钮，但文案不说去打开 shell 电源。
- enterprise 下不再出现「去打开 shell 电源」。若命令被策略或 L2 拦住，文案说明授权或策略，不说能力未启用。
- 模式 C 本机终端、内嵌终端、ACP 的文案继续使用各自的名字，不称它们为 shell。

设置助手不能靠目录里的固定句子区分两种状态。现有 manual 项的 `read` 固定返回「需在对应设置核对」，apply 对 manual 固定返回「尚未修改：请进入原设置入口核对并单独确认。」规则导航只认识会议、场景和语音。这些都覆盖不了 community 与 enterprise 的差别。

实现时由 Companion 在生成候选之后、把候选返回扩展之前，用当前 `shellProvision` 填入受控文案，而不是让模型写这句说明：

- community：`shell 随 enterprise 档提供。请打开「本机与工具」，确认升档。命令执行仍需单独授权。`
- provided：`shell 已由 enterprise 档提供，没有单独电源。命令仍需策略和 L2 授权。`
- unknown：`shell 提供状态未知。请刷新本机能力列表，不要再次切换相同档位。`

导航按钮由扩展按这个状态打开「本机与工具」。它不发送 `config.set`、`modules.set_enabled`、`modules.set_profile` 或 `pack.apply`。模型自由文本不能变成这些消息，也不能改写上面三句。apply 这条候选仍是 manual，回执使用同一句受控文案，不使用固定的「尚未修改」。

`buildCodingHandoffContext` 的 Linux 分支不再写「需先在设置启用 shell」。community 使用升档那句；provided 仍可说明用 `shell_exec` 安装 zenity，并遵守现有命令策略和确认；unavailable 说明模块不可用。这段不提及内嵌 PTY。

首次引导不新增流程。能力档确认文案就是升级时看到的说明。

## 菜单规划

这不是本子项目的实现范围。后续菜单按用户任务整理，而不是按内部模块名铺开。一个能力有一个主入口，其它页面只放同一状态的深链。

六层职责用于判断一个控件该不该存在，不是六个并列开关：

| 职责 | 问题 | 本子项目 |
|---|---|---|
| 连接 | 通路在不在 | 不改配对 |
| 资格 | 档位是否提供这类能力 | shell 由 enterprise 提供 |
| 意愿 | 用户要不要另开一项 | shell 不再有意愿开关；netsec 仍有 |
| 运行策略 | 打开后按什么规则 | shell 的 policy 和 allowlist 保留 |
| 单次授权 | 这一次危险动作能不能做 | L2、三旗、确认短语不改 |
| 系统权限 | 操作系统是否放行 | 不把 PTY 限制套到 shell_exec |

下一阶段仍要用户另确认，本文件不实现：

- netsec 继续独立开启和目标授权。
- 模式 C、内嵌终端、ACP 继续分开，只统一文案，避免叫成 shell。
- 运行自主度的组合按钮和场景信任写入，继续是单次授权，不并进能力档。
- Computer Use、LCU、实验模型继续按各自的安装和许可前提。
- 设置助手目录逐步补上这些主入口的手动项，仍不从模型文本直接写配置。

## 安全边界

不修改 L2、`security_token`、三旗、确认短语、自动批准、命令长度和 allowlist 规则。不因为 enterprise 打开 netsec。不把本机终端、内嵌终端或 ACP 的启用写成 shell 已提供。归一化只改 `modules.shell` 的 `enabled`、`enabled_at`、`enabled_by`。

## 回滚

回滚是撤掉本子项目的代码。归一化已经把旧的 enterprise + `shell.enabled: false` 写成 true。回滚代码不会自动把这些安装改回 false。要恢复旧关闭，只能恢复该次写入前的配置备份。回滚后旧客户端又会把 `enabled: false` 当成电源，因此回滚说明必须带上这个数据后果，不能承诺只撤代码就回到旧开关。

## 验收

实现阶段才写这些测试。本 checkpoint 不添加测试文件。测试调用真实的 Companion handler 和扩展组件，不把模型探针当成用户路径。

Companion：

- enterprise 且磁盘 `shell.enabled: false`，加载后 `shellProvision` 为 provided，`modules.list` 的 `shell.enabled` 为 true，原 `policy` 与 `allowlist_commands` 仍在。
- community 时 `requireModule("shell")` 和 `checkShellScope` 的错误是 `enterprise_profile_required — set capability_profile=enterprise for shell`，不含 `modules.set_enabled`，且不执行命令。
- `setModuleEnabled("shell", true|false)` 返回 `shell_switch_removed` 且不调用 `saveConfig`。`restoreTrustSnapshot` 在快照要求 shell 关闭、结果档位为 enterprise 时不把该关闭当成已恢复；netsec 的失败返回不被忽略。
- `computeApplyBlocked` 在 enterprise、`shell.available === true` 且磁盘 `enabled: false` 时，不因为 shell 需求返回 `module_disabled:shell`。community 返回 `enterprise_profile_required`。
- `buildCodingHandoffContext` 在 Linux 且 community 时不包含「启用 shell」。
- `modules.set_enabled` shell true 和 false 都没有 `modules.updated`。
- 同一请求不改变 netsec。`modules.set_enabled` netsec 在 community 仍是 `enterprise_profile_required`，在 enterprise 仍可开启。
- 请求体显式带 `config.modules.shell.enabled` 的 `config.set` 整次拒绝。只有未知键、没有这个路径的 `config.set` 仍保存白名单字段。
- 升档确认的成功快照同时是 enterprise 和 `shell.enabled: true`，netsec 与写入前相同。
- 取消确认不产生 `modules.set_profile`。
- 修订冲突、结果未知、通道错误不产生成功快照。
- 降级成功快照是 community、`shell.enabled: false`，原来开着的 netsec 为 false。
- 降级后再升档，shell 再次为 true。
- provided 之后，空命令、超长命令和 allowlist 拒绝仍失败；`confirm_per_command` 仍进入现有 L2，而不是在 `checkShellScope` 放行。

扩展：

- 能力档确认文案包含「提供 shell」和「netsec 不自动开启」。取消不发送。
- 场景页没有 shell 的开启按钮；enterprise 与 community 分别显示上一节的只读句子。netsec 按钮仍在。
- 设置助手对「如何开启 shell」的可见句子来自当前 `shellProvision`，community 与 enterprise 不同。点击导航不发送 `config.set`、`modules.set_enabled`、`modules.set_profile`、`pack.apply`。
- 加载归一化失败时，设置页和场景页显示未知。刷新只发送 `modules.list`。当前已是 enterprise 时不发送 `modules.set_profile`。
- enterprise 的工具失败不再出现「打开 shell 电源」。模式 C、内嵌终端、ACP 的标签不变。Linux ACP 提示不再要求启用 shell 电源。

## 自审

- 与「升级时开一次、之后可关」冲突的句子已删除。enterprise 期间没有生效的 shell 电源。
- 旧的 `enabled: false` 会被归一化，不会被保留成关闭。
- `requireModule` 不再保留「enable in settings (modules.set_enabled)」这句。
- `shell_switch_removed` 对 true 和 false 都是错误，避免假成功。
- `config.set` 的整次拒绝只覆盖显式的 `config.modules.shell.enabled`。未知键不拖垮白名单写入。
- 相同档位的 `setCapabilityProfile` 不负责修补旧的 false。加载归一化负责，失败时界面保持未知并用 `modules.list` 刷新。
- 助手文案由 `shellProvision` 生成，不依赖 manual 项的固定「需在对应设置核对」。
- netsec、L2、三旗、确认短语、命令策略没有被并进资格。
- 本机终端、内嵌终端、ACP 没有被定义成 shell。
- 菜单六层是职责划分，不是本轮要做的六个新开关。
- 没有留下待定实现。仓库中不存在的企业策略字段本轮不新增。

## 不再需要用户决定的事

14:07 的选择已经关闭这些分叉：不是 on-upgrade-only；不保留生效的独立 shell 开关；已有 enterprise 且 shell 关闭的安装也要提供 shell；命令授权保持独立；netsec 不跟随打开。

本子项目没有新的产品分叉。菜单重构和其它能力的助手目录仍按「菜单规划」等待另一次确认，不在 #853 的实现里展开。
