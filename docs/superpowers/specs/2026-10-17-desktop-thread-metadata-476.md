# 原生工作台：对话元数据三项管理合同

GitHub: #476（原票已满足 Issue-first；不新建重复子票）

状态：合同已由 root 全文批准实施；本组在实际已交付 main `d445c81b74fe98431b49de4f794471816ecd526d` / tree `56887b10a4101229678fdac04bb7c7ac564ecf6f` 上实现。独立源码、模型、实际原生与发布验收待完成。

## 1. 一组结果与固定基线

用户在原生工作台的对话行打开一个“对话信息”表单，修改名称、人工标签、手动分组，保存后看到同一 Companion 对话数据中的持久结果。三项作为一个模块、一个测试与评审组交付，不拆成三个按钮 PR。

固定 main `72d7ad3767d216d3fa2cfc597e7e6b83727d9076` / tree `c44ae9d20340c5b202c6c446cfd6e643d786f56f`；接入参照已接受 PR694 head `e28fa85b1fad3549d5879e3adc39d3d22be47f06` / tree `56887b10a4101229678fdac04bb7c7ac564ecf6f`。两者是需求整理时的历史基线；实现时 PR694 已真实合入上述 d445 main，原 tree 完整继承。原 #476 正文及全部一条评论已重新读取，与前次映射相同。源证据的 whole SHA 用于身份核验；本目录只嵌入注明行界的相关代码，不冒称嵌入完整大型源文件。

范围严格为 `alias`、`user_tags`、`topic_folder`。不含新建、切换聊天运行、归档/回收站/恢复、workspace/Project/Pack 归属、权限继承、配置/工具白名单、AI digest、终端/Agent 执行、Chrome 策略或新授权机制。标签/分组展示本组结果，不顺带增加全局搜索、排序、目录树或标签词典。

## 2. 已有真实链与必须处理的约束

| 已有源 | 本组沿用的事实 |
|---|---|
| `threads/metadata-patch.ts:5–22`、`user-tags.ts:2–15`、`distill.ts:79–87` | 三键共享校验；未知键整次拒绝。名称非空、NFC/去控制字符/trim/200长度；标签最多20个字符串、每项40、规范化/去重；分组字符串或null、去控制字符及路径分隔符/trim/40，空值归null。沿用现有截断和清洗，不另创规则。 |
| `message-router.ts:3155–3215`、`ThreadManager.update:1019–1027,1091–1104` | 同一 manager 拥有元数据和持久化；通用 update 还有配置/权限字段，不能整体放入 desktop allowlist。元数据更新没有 LLM-busy 拒绝；UI saving 与 LLM busy 不同。 |
| `thread-manager.ts:620–651`、`io.ts:16–29` | saveIndex 的 peer-merge 读错误被容忍，实际写/rename 错误会抛出。update 在落盘前已改 target 内存，不能把返回对象或同 manager 回读当持久化证明。 |
| `ws/lifecycle.ts:801–812` | 原生 channel 注入的就是 runtime 同一个 ThreadManager；不需要第二个 store、镜像配置或独立会话目录。 |
| `desktop/read.ts:15–28`、manager `829–831` | 现只读快照无 purge/repair/write，只含 id/alias/time、排除 trash；标题用既有 redactor。新字段只能按白名单投影，不能返回完整 Thread。 |
| `desktop/channel.ts:49–77`、`capabilities.ts`、`identity.ts:47–59,101–114` | native principal/socket、发证时固定方法集、重连撤销旧 socket 已存在；方法扩充须 bump 当前方法集版本并由 launcher 重新签发，不修改 renderer 声称的角色来授权。 |
| `DesktopHost.cpp:169–187`、`DesktopHost.swift:119–147,176–198` | controller 绑定当前 document generation、socket/epoch、native UUID→UI ID；请求按方法记录，旧文档/连接清空。当前 target 回包校验只有 thread.peek，新 metadata 两方法须同样做 target 绑定。 |

## 3. 精确 RPC 候选（需 root 批准后实施）

以下名字是本组提议的新窄接口，不是当前已存在协议。只有已认证 native renderer/controller 可调用；legacy WS、summoner、extension 不因本组增加写权限。

| 方法 | Companion wire 必须且仅有的键 | 成功响应 |
|---|---|---|
| `desktop.thread.metadata.edit` | `type,id,thread_id` | `type:"desktop.thread.metadata.edit.result",id,thread_id,ok:true,metadata:{alias,user_tags,topic_folder}` |
| `desktop.thread.metadata.save` | `type,id,thread_id,payload_json` | `type:"desktop.thread.metadata.save.result",id,thread_id,ok:true,saved:true,metadata:{alias,user_tags,topic_folder}` |

renderer→native 的键分别再加且必须有 `generation`；controller 验证后移除 generation、用真实 native UUID 替换 id，回包恢复 UI id。两端 controller 与 Companion 都拒绝额外/缺失/错类型键。id 沿用现有非空字符串及200上限；thread_id 使用既有 `ThreadManager.isSafeThreadId`，指向现存且未入回收站的目标。没有可接受的 `surface`、role、user_gesture、owner、approved 或任意 action 字段。

`payload_json` 只承载非空三键子集，值类型仅名称字符串、标签字符串数组、分组字符串/null；先拒绝重复 JSON key（包括转义后同名键）、prototype/未知键/嵌套对象，再调用原 `summonerThreadMetadata`。复用其 normalization，不复制另一套权限或模型参数 patch。空标签数组和null分组是明确清空；未提交的键保留当前值。全空 patch 拒绝。遵守现有 WS 最大帧界限，不引入新数值预算。

handler 只得到/调用窄元数据读写能力，底层仍是同一个 runtime manager；不转发通用 message-router、任意方法名或任意 Thread patch。每次读取、写入前和发送 ACK 前核当前 principal/socket authority；资源 ID 为该请求固定 target，不读取之后变化的 UI selectedThread 来决定写谁。这里没有新租户或 per-thread ACL 模型，也不把“出现在列表”伪称独立授权凭据。

失败返回相应 `.result`、原 id/target、`ok:false`，save 同时 `saved:false`；error_code 为本组固定有限枚举（输入无效、目标不可用、连接过期、元数据被遮蔽、保存未确认），不返回 raw Exception、文件路径、配置、正文或环境。方法拒绝沿用现有 channel 的拒绝语义。不得吞真实存储错误后返回 saved。

## 4. 持久化、DTO 与原有策略

- 成功 ACK 只能在同一 manager 的真实原子索引写成功之后产生；响应是保存后的规范化三字段投影，不返回整个 Thread。测试以全新 manager 重载 owned 索引，验证三个字段及另一对话不变，不能仅断言内存对象相等。
- 已知写/rename失败：保持旧持久值，失败不得残留“已保存”表象。实现允许在 ThreadManager 内对这次同步 metadata update 做最小目标对象失败回滚/包装，恢复本次触达的字段及更新时间，覆盖既有 update 内部可能的 target 派生变更；不能恢复整个 index、覆盖其它对话或新建事务/store 框架。失败后再次 edit/list 不能把未持久内存当成功状态。真实故障 producer 必须验证这个边界，不靠 UI catch 掩盖它。
- 已写入后连接关闭/丢 ACK 是未确认结果，不声称磁盘回滚；保草稿并提示刷新核对，不自动重发、不把恢复连接当保存成功。即使实际副作用已发生，过期 socket 也不能收到成功 ACK。
- DTO 只含固定 ID 和三项用户元数据；list 可在原有 id/title/time/truncated 之外增加白名单标签/分组，以显示本组结果。数组拷贝，保留原64项列表界限及 redactor；不读取或返回 workspace_root、source paths、Project metadata、config_override、工具/资源选择、MCP秘密、trust、消息正文或内存对象引用。
- 沿用现有 redactor，不新增 secret 分类器。为避免 raw label 泄漏或把遮蔽占位符回写，本合同候选选择：任一现有三字段需要遮蔽时，edit 及 save 的写前检查都返回固定“元数据被遮蔽，不能在此编辑”错误且不返回 raw metadata；列表照旧安全显示。save 的成功 DTO 也不回显疑似秘密；若提交值会被遮蔽，写前拒绝，原值不变。这是仅此原生呈现的限制，不改共享validator/overlay行为；需 root 一次合同批准，不得由实现者临时更换成不安全 raw 编辑。
- 三字段是现有 overlay-safe 元数据，不新增 L2 class、user-gesture 证明、原生确认队列或隐式工具批准；沿用现有元数据无 LLM-busy gate 的行为。MCP/终端/权限等现有 L2和原生确认机制完全保留，不能从本接口调用它们。原计划 slices2/3 的身份/确认设施依赖已存在，不重做该设施或撤销其其它敏感操作门禁。

## 5. 一个原生表单与晚到响应

对话行有“对话信息”按钮，单个内联表单显示名称、人工标签、手动分组及保存/取消。名称/分组沿用现有长度；标签每行一个，保留逗号作为合法标签文本，不用字符串拼接悄悄拆改既有标签。所有字段用 value/textContent，响应及标签不进 innerHTML、脚本、LLM 输入。分组是文字标签，不是目录选择器。

每次打开/取消/切换行或页面/收到新 document generation/断线都使编辑 epoch 失效。表单持有打开时固定的 `{target,documentGeneration,editEpoch,editRequestId}`；save 另持有固定 request ID、规范化提交字段和同一组绑定。A→B→A、关闭后重开A、同一对话旧 edit/save 回包都不能覆盖新草稿或显示新一轮“已保存”。native controller 的 UUID、generation/socket epoch 与 thread_id 回包校验和 renderer 的 editor epoch 必须同时满足，不能只比 selectedThread 相等。

保存中仅禁该表单重复提交；它不是 LLM busy。取消/切换后旧操作若已提交，不反向“撤销”磁盘写，只使旧结果失效；返回后从真实数据重新 edit。普通列表刷新不能覆盖正在编辑的草稿。断线/失败保留固定原目标草稿并明确未确认，用户重新打开/核对后显式提交新请求；不能悄悄把 A 草稿提交给 B。加载/失败/保存状态有键盘可达的文字反馈，取消回到原按钮；窄/短窗口内表单可滚动，不新增整个工作台布局重构。

## 6. 整组精确 DoD

| DoD | 必须由实际 producer 证明 |
|---|---|
| 三项一次共享实现 | UI实际生成的帧进入真实 authenticated channel→共享 validator→真实 ThreadManager；三项单独及组合提交、清空标签/分组、Unicode/规范化/上限都正确；新 manager 重载一致。fixture 来自真实生产出口，不手造协议假样本。 |
| 窄边界 | 顶层/JSON重复/额外/prototype/错类型/空 patch、未知或入trash target拒绝；有效 alias 夹带 config/trust/workspace/AI digest也整次拒绝；无权限字段副作用。 |
| safe projection | 列表/编辑/成功/错误 DTO 对完整 Thread中放入的路径/配置/凭据/正文标记零泄漏；遮蔽值不暴露、不落盘替换成占位符；UI文本不能执行HTML。 |
| 保存真实性 | 实际写和rename故障均不Saved；盘/目标内存恢复与其它对话不变；后续重读、正常重试可靠；不以 mock return true替代真实原子写。 |
| 关联/晚到/未知结果 | A→B→A、close/reopen、doc generation更新、乱序读写、断线后ACK/重连旧包、同类型后请求覆盖旧native UUID、不同thread_id回包均不能污染新表单；已commit但断线显示未确认且不自动replay。 |
| 现有策略保留 | 真实LLM忙时元数据仍按现有语义可更新；表单防双击不伪造thread_busy；通用thread.update仍拒desktop；summoner ACL/legacy/native confirmation/controller-only decision/现有MCP保存链原负控不弱化。 |
| 实际产品验收 | 相关TSC/后端focused/真实JS DOM producer与构建、一次必要锁定LinuxARM；真正非作者复审；原指定Grok4.6-build+directHTTPDeepSeekV4Pro/noPi、完整Kimi与当前配置GLM的增量完整意见及机器实际输入/EOF/identity证明；新head实际Mac/Windows原生三字段编辑/落盘/重开、键盘/断线场景及全CI，最后main交付按原流程。模型可用或CPU绿不能冒原生通过。 |

不为这一叶增加物理真人、安装外部Agent或企业SSO前置；亦不免除原票已命名的native平台与精确CI门。三项完整同组一次冻结/复审，不逐按钮重走昂贵模型流程。

## 7. #476 仍然未完成的范围

本组只完成原DoD中名称/人工标签/手动分组的原生入口。新建、搜索/切换聊天执行、归档语义等尚须各自核实际缺口；现有trash不能冒独立archive。stdio MCP已审/交付状态按PR694实际CI/main另记，本组不重开、不冒它补齐全部MCP管理/其他transport。技能/知识原生全局管理、现有PTY/ACP结果进入原生工作台、Chrome逐任务展示策略、原票整体交互/两个业务首发场景仍属父范围。现有runtime归属保护已存在，不以native入口缺少为由重写runtime，也不把所有内部缺口归为外部业务阻塞。本组通过不关闭 #476。
