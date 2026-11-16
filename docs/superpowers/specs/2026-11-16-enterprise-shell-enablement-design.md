# enterprise 档始终提供 shell

GitHub: #853

状态：设计说明。尚未实现。实现计划和测试要等这份说明经过独立评审，并且用户读过后另授权。本文件不改产品代码。

用户已确认的产品句：enterprise 档始终提供 shell，不再保留单独且生效的 shell 开关；命令执行授权仍独立保留。这取代「只在升级那一次打开 shell，之后仍可单独关闭」的方案。不能把实现退回 on-upgrade-only，也不能留下一个用户还能拨动、并且会改变 shell 是否可用的电源。

## 当前行为

证据来自合并提交 `bdfbeee333a51028d5df89d9c772012cd6f71076` 上的源码，不是浏览器点击。

- `companion/src/packs/pack-engine.ts` 的 `setCapabilityProfile` 升到 enterprise 时只写 `capability_profile`。降到 community 时把已经 `enabled === true` 的 shell 和 netsec 写成 `enabled: false`。
- `companion/src/capability/modules.ts` 的 `setModuleEnabled` 在 community 下拒绝打开 shell 或 netsec，错误是 `enterprise_profile_required`。shell 默认 `enabled: false`，`policy` 默认 `confirm_per_command`。
- `requireModule("shell")` 只看 `available && enabled`。`checkShellScope` 先走这道门，再走命令策略。`commandAllowedByPolicy` 在 `confirm_per_command` 下放到后续 L2，不把策略本身当成电源。
- `modules.set_enabled` 成功时返回 `modules.updated`。`modules.update` 会丢掉 patch 里的 `enabled`，不能用来开电源。
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

任何成功持久化的配置，在写入返回前都经过同一次归一化：

- enterprise 且 `shellProvision` 为 provided：`modules.shell.enabled = true`，`enabled_by = "profile.enterprise"`。若原值不是 true，`enabled_at` 写成这次归一化的时间；原值已是 true 则不改 `enabled_at`。保留原有 `policy` 和 `allowlist_commands`。
- community，或 shell 不可用：`modules.shell.enabled = false`，`enabled_at = null`，`enabled_by = null`。同样保留策略字段。
- 不改 `modules.netsec`、`appsec`、`devsec-workspace`，除非原有降级逻辑本来就要关闭已开启的 netsec。

已经是 enterprise 且磁盘上 `shell.enabled === false` 的安装，在 Companion 加载配置后、响应 `modules.list` 或执行 `shell_exec` 之前完成这次归一化。归一化是幂等的。完成后，列表、设置、场景和工具门看到的都是 provided。不允许解释成「保留用户旧的关闭」。

归一化失败或写后快照读不回上述结果时，调用方得到 `SHELL_PROVISION_RESULT_UNKNOWN`。这时不宣告 shell 已提供，也不宣告用户的旧关闭仍然有效。

## 档位切换

升级确认仍是现有的两步：`buildProfileSwitchConfirm` 的文案先说明结果，用户取消则 `resolveProfileSwitchSend` 返回空，不发送。

确认文案改为：

- 升到 enterprise：本档会提供 shell。netsec 不会因此打开。每条命令仍按现有策略和 L2 确认。三旗、确认短语和自动批准不变。
- 切回 community：shell 不再提供。当前已开启的 netsec 仍按现有降级逻辑关闭。

`modules.set_profile` 的成功回执只在快照同时满足目标档位和 `shellProvision` 时成立。升到 enterprise 的成功快照必须是 `capability_profile: enterprise` 且 `modules.shell.enabled: true`，并且 netsec 的 `enabled` 与写入前相同。降到 community 的成功快照必须是 community 且 `modules.shell.enabled: false`；原来开着的 netsec 仍为 false。

`PROFILE_REVISION_CONFLICT`、`PROFILE_STATE_INVALID`、`PROFILE_CHANGE_RESULT_UNKNOWN`、通道 `lastError` 和断连都不显示「shell 已提供」或「能力档已更新」。界面留在切换前的档位和投影。

再次升到 enterprise 会再次提供 shell。不存在「上次用户关过电源，所以这次不提供」。

## 旧客户端写入

`modules.set_enabled` 且 `module === "shell"`，无论 `enabled` 是 true 还是 false，都不写盘，不返回 `{ type: "modules.updated" }`。返回：

```text
type: error
error: shell_switch_removed — shell availability follows capability_profile; derived_enabled=<true|false>
```

`derived_enabled` 是当前 `shellProvision` 的投影。这不是成功。community 下 `derived_enabled=false`。enterprise 且 available 时 `derived_enabled=true`。

`modules.set_enabled` 对 netsec、appsec、devsec-workspace 保持现有行为。community 下打开 netsec 仍返回 `enterprise_profile_required`。

`config.set` 或其它补丁若显式包含 `modules.shell.enabled`，整次写入拒绝，错误同样是 `shell_switch_removed`，磁盘不变。不把该字段悄悄丢掉再返回成功。`modules.update` 继续丢弃 patch 中的 `enabled`，不能用来改变 shell 是否提供；策略字段仍按现有 enterprise 条件更新。

`pack.apply` 在成功把档位写成 enterprise 的同一次结果里必须满足 `shellProvision`。它不能把 enterprise 留下、同时把 `shell.enabled` 留成 false。pack 若要求关闭 shell 而结果档位仍是 enterprise，这次 apply 失败，不写这组矛盾状态。pack 对 netsec 的启用和信任短语保持现有门，不因 shell 语义被打开。

## 执行门

`checkShellScope` 先调用 `shellProvision`：

- not_provided 且原因是 community：返回现有可识别的 `enterprise_profile_required` 或包含 `module_disabled:shell` 的错误文本，供界面指向升档，而不是指向一颗已删除的电源。
- not_provided 且原因是 unavailable：返回模块不可用，不提示去开电源。
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

设置助手新增一条目录项，`scope: "manual"`，没有 `patch`。模型只能选择这项，不能发明键名。

- 用户说「如何开启 shell」或「帮我开启 shell」时，community 的说明指向能力档确认，并给出打开「本机与工具」的导航。
- enterprise 的说明是 shell 已提供，命令仍要单独授权；若失败，原因是连接、命令策略或 L2，不是缺少电源。
- 提交这项只得到 manual 回执，不发送 `config.set`、`modules.set_enabled`、`modules.set_profile` 或 `pack.apply`。模型自由文本不能直接变成这些消息。

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
- community 时 `checkShellScope` 失败，错误指向档位而不是电源；不执行命令。
- `modules.set_enabled` shell true 和 false 都返回 `shell_switch_removed`，且没有 `modules.updated`。
- 同一请求不改变 netsec。`modules.set_enabled` netsec 在 community 仍是 `enterprise_profile_required`，在 enterprise 仍可开启。
- 带 `modules.shell.enabled: false` 的 `config.set` 整次拒绝，其它字段也不写入。
- 升档确认的成功快照同时是 enterprise 和 `shell.enabled: true`，netsec 与写入前相同。
- 取消确认不产生 `modules.set_profile`。
- 修订冲突、结果未知、通道错误不产生成功快照。
- 降级成功快照是 community、`shell.enabled: false`，原来开着的 netsec 为 false。
- 降级后再升档，shell 再次为 true。
- provided 之后，空命令、超长命令和 allowlist 拒绝仍失败；`confirm_per_command` 仍进入现有 L2，而不是在 `checkShellScope` 放行。

扩展：

- 能力档确认文案包含「提供 shell」和「netsec 不自动开启」。取消不发送。
- 场景页没有 shell 的开启按钮；enterprise 与 community 分别显示上一节的只读句子。netsec 按钮仍在。
- 设置助手对「如何开启 shell」只生成手动候选和导航。点击导航不发送 `config.set`、`modules.set_enabled`、`modules.set_profile`、`pack.apply`。
- enterprise 的工具失败不再出现「打开 shell 电源」。模式 C、内嵌终端、ACP 的标签不变。

## 自审

- 与「升级时开一次、之后可关」冲突的句子已删除。enterprise 期间没有生效的 shell 电源。
- 旧的 `enabled: false` 会被归一化，不会被保留成关闭。
- `shell_switch_removed` 对 true 和 false 都是错误，避免假成功。
- netsec、L2、三旗、确认短语、命令策略没有被并进资格。
- 本机终端、内嵌终端、ACP 没有被定义成 shell。
- 菜单六层是职责划分，不是本轮要做的六个新开关。
- 没有留下待定实现。仓库中不存在的企业策略字段本轮不新增。

## 不再需要用户决定的事

14:07 的选择已经关闭这些分叉：不是 on-upgrade-only；不保留生效的独立 shell 开关；已有 enterprise 且 shell 关闭的安装也要提供 shell；命令授权保持独立；netsec 不跟随打开。

本子项目没有新的产品分叉。菜单重构和其它能力的助手目录仍按「菜单规划」等待另一次确认，不在 #853 的实现里展开。
