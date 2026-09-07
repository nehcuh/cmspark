# 0.7.0 共享站点上下文与业务证据实施契约

GitHub: [#445](https://github.com/nehcuh/cmspark/issues/445)；实施：#451（上下文）、#452（提取）、#453（证据）、#454/#455（双 Pack）、#456（MCP）。
状态：实施设计 R6，Grok 4.6 + DeepSeek V4 Pro 独立复审均 APPROVE_WITH_NITS（用户已确认模型组合更正）；下文补齐解释性细则。仅设计通过，不代表实现或企业验收已交付。

## 目标与约束

用户已确认变更材料与研发关联两个场景都作为首发必验。前者交付版本、制品、架构影响、CMDB 状态的带来源草稿；后者交付需求、故事、代码、测试、缺陷之间的可核对关系。独立模式不依赖 Codex、shell、CU 或多 Agent；允许外部助手时通过独立授权复用上下文。

保持现有唯一 tool-loop、Pack 装配、确认/停止机制、MCP default/interact 工具范围。运行进度、业务核对、执行授权分开：执行成功不等于材料正确，材料完整不减免任何写入确认。新共享模块不得依赖 UI、WebSocket 或 LLM SDK。“服务端”在本文专指当前 OS 用户本地 Companion 进程，不建设云端数据服务或多租户平台。

能力声明：Surface 为现有 L0/L1；Composition 为共享服务及两个 Mission Pack；Autonomy 沿用单线程，Board 可选；Trust 不放宽已有授权；Channel 沿用 Extension↔Companion 与受控 MCP。

## 1. SiteContext

由共享服务接收已解析目标、用户选择、查询和经验存储，产生版本化快照；Chat/MCP 负责各自的目标解析和授权。上下文内容一律作为数据，不成为授权来源。

- `target`：tabId、脱敏 URL、origin、hostname、获取时间、目标来源；未知目标显式 unavailable。原始 URL 只留在浏览器目标解析边界，不能进入上下文提示、证据文件、日志或 MCP。导出目标 URL 去掉 userinfo/query/fragment，仅保留 origin + pathname（含非默认端口）；来源业务 ID 使用单独带引用的字段，不能从 token 查询参数猜。页面参数里的任意 URL 不代替浏览器已解析目标。
- `selection`：用户手动选择与自动站点匹配分开。切换站点后重新解析自动候选，保留用户手动选择的跨系统材料。
- `sources`：文档 ID、版本/内容指纹、实际注入字符数及裁剪状态；保留原引擎知识预算与数据隔离包装。
- `experience`：独立的负向经验摘要，关联目标和有效期；有明确 stale/撤销语义。文档站点匹配与机器失败禁令不是同一个键：文档沿用 hostname 匹配（W1 canonical hostname）；机器禁令使用HTTP(S) WHATWG URL.origin 序列化（拒绝 null），省略默认端口，保留 www 子域差异；https://x.com 与 https://x.com:443 同键，非默认端口不同键。不得把父域、子域、端口或不同协议合并为机器禁令。
- `snapshot_id`：内容及目标指纹，便于判断刷新，而非授权 token。

Chat 初次发送使用扩展实际解析的活动 tab 信息；旧客户端只有 hostname 时兼容选择，但来源标注为 hint，不能用于授权导出。旧 hostname hint 可继续驱动兼容的自动知识匹配，但标记 hint，不参与观察证据、机器禁令恢复或 MCP 授权。每轮模型调用前按最新目标和知识版本刷新；同一轮工具执行后的经验变化在下一次模型请求前体现。复用引擎 ensureFresh/内容指纹，不在每次请求全盘重新生成检索索引。工具解析到另一 tab、导航后实际 URL 更新、同域路径变化，以及 query/fragment 路由变化都使快照重新构建；后两者只参与去除 userinfo 后的不透明导航 HMAC-SHA-256，不暴露原值；只更新当前上下文段，不覆盖安全 footer。

先复用现有 SkillEngine 匹配和知识包装；抽出服务层，不重写检索算法。服务不能依赖全局“当前站点”。多用户/入口状态必须由明确 scope 管理。

## 2. ExecutionExperience

经验生命周期以 `(owner scope, actual origin)` 为边界。Chat scope 对应服务端线程；MCP scope 由服务端根据已认证 caller/grant/session 创建和回收，不能接受调用者伪造 threadId。

已持久化经验保留 recorded_at、stale 和版本。自动失败经验默认有效期 7 天；已过期经验不参与机器禁令恢复；缺失/非法时间按不可用于机器禁令处理并保留原知识文档中可查看的记录。运行 scope 不持久化到共享知识文档：旧记录无需伪造原线程/原 grant；只可在当前已授权读取该文档的 scope 内恢复。旧行必须能解析出完整 HTTP(S) origin 且与实际目标 origin 完全相同，文档站点元数据匹配；缺少 origin/site、未知 schema 或时间的记录仅供原文查看，不能自动恢复禁令。显式 stale 或删除后，下一次刷新必须撤销对应恢复的禁令；不能因 hydrated-once 集合而永久残留。运行中观察到的失败与历史恢复计数分开，避免撤销历史经验时清掉本轮实际失败。

失败计数、目标冻结与经验提示由同一服务更新。origin 禁令对当前 owner scope 内访问同一 origin 的所有 tab 生效，新 tab 不得绕过。tab 冻结只表示该 tab 的 attach/目标状态失败，与 origin 禁令独立。成功导航只解冻其实际 tab；调用 list_tabs 或创建新 tab 不解除别的 tab 禁令。范围、次数、容量沿用既有约束。MCP 断连/撤销/过期需结束所属内存 scope，不把状态共享给另一 grant。

## 3. Extraction / Observation

扩展读取结果增加兼容字段，保留原 text/html 字段：

- 实际 tab 的脱敏 URL（严格采用 §1 的 scheme/host/path；原值只在浏览器边界用于比较，不传入结果）、标题、采集时间；真实执行通道（CDP、isolated、main、DOM）。
- 范围：document 或 selector；frame 指明当前实现为 top。不把顶层 body 当包含所有 iframe。
- 覆盖：`complete_for_scope`、`partial`、`unknown`；全页业务完整性不由一次 DOM 读取保证。
- truncated、上限及 stop_reason；固定字段 pagination 与 virtualization，各自枚举 unknown/not_present/fully_traversed；默认 unknown。只有试点范围适配器证明不存在或已遍历到终止条件才设置后两者，并记录 adapter_id/version。未适配页面不能靠 DOM 当前可见文本推断为全量。

覆盖的唯一写入者是 Companion 的 Observation 构造器，发生在入库前：同 scope 的第一次 draft_create 原子锁定 pilot-contract 快照及 digest，后续草稿复用该快照；外部配置变更须新建会话生效。没有有效契约时锁定空契约，可生成未齐备草稿。构造器只对锁定契约中匹配实际 origin、binding_system_key 和精确 scope 的已知适配器执行覆盖判定；歧义、无匹配或未知版本均保留 unknown。static_declaration_v1 将试点用户的静态范围声明作为明确记录的覆盖依据，只在实际成功、目标稳定、未截断的 top frame 读取（包括 document 与 selector 范围）上赋值 complete_for_scope=true、pagination/virtualization=not_present，同时冻结 adapter_id/version、contract_digest 与 coverage_basis=user_pilot_declaration，不能伪称运行时已遍历。任何齐备展示和验收保留该依据。扩展仅产生原始范围、通道、截断和目标数据，不能接收模型提供的覆盖布尔值。首次 draft_create 之前捕获的 Observation 保留 unknown，需重新读取才能取得契约覆盖；入库后不可追补或修改。仅在利用集合覆盖判定时，核对器要求 Observation 的 contract_digest、adapter_id/version 与草稿快照一致；标量引用不要求适配器，仍核对来源绑定、摘录、token 与时效，绝不依照当前外部文件重解释旧记录。本版只实现 static_declaration_v1；复杂分页/虚拟化页面若无另票实现并验收的适配器，不得判齐备。

Companion 根据成功的实际读取结果创建不可变 Observation，生成服务端 ID，保存工具调用 ID、目标元数据、规范化内容和内容摘要。失败工具记录可审计但不能成为成功材料依据。0.7.0 自动捕获工具白名单固定为 get_page_text、get_page_html；只接受 success=true 且有可解析的实际目标元数据的结果。screenshot/CU/evaluate/cookies/下载，以及外部 MCP server 工具返回，均不自动进入业务证据库。外部客户端通过 CMspark outbound MCP 调用上述本地白名单网页读取工具时仍可形成 Observation，归当前已验证 grant/session；这不同于从外部 MCP server 接收任意结果。手动输入及上传报告可以作为草稿候选值（不创建 Observation）；没有当前 scope Observation 引用的值标 user_provided/unverified，不是浏览器验证证据。容量有界，不保存 cookie/凭据或所有工具结果。

内容经现有页面清洗后，规范化仅做 Unicode NFC、CRLF/CR→LF；保留大小写与正文内部空白。digest 为该规范化内容 UTF-8 的 SHA-256；excerpt 使用相同规范化并携带 start/end Unicode code-point 半开区间偏移（在规范化文本上按 Array.from(text) 切片，不使用 UTF-16 或 UTF-8 字节偏移），核对正文相应区间完全一致。展示摘要仅为规范化内容的有界前缀，不由 LLM生成，不用于核对。失败调用继续留在既有有界工具消息/操作日志中，不创建 Observation，也不消耗 Observation 配额。

Observation 持久化的目标元组明确包含 tab_id、origin、url、navigation_key：origin 为完整 HTTP(S) WHATWG URL.origin（含非默认端口），url 为 origin + pathname；“只存脱敏 URL”仅限制 URL 字符串中的 userinfo/query/fragment，不禁止上述 origin 与导航指纹元数据。重新读取证据文件时可直接用 origin 核对绑定，不能从导航 hash 反推来源。

读取时刻与源数据业务时间分开。Observation.observed_at 由 Companion 时钟生成；候选字段的 source_updated_at/source_revision 必须来自被引用内容，缺少时明确 unknown，不能用 observed_at 填补。URL 可能含敏感查询参数；持久化来源同样严格只存 §1 脱敏 URL 与不透明 navigation_key，不能保留原始 query/fragment/userinfo，也不能把认证 token 当引用分享。此约束针对来源 URL；页面正文仍走既有清洗，不声称能够发现正文中的任意未知秘密。

## 4. Claim、Relation 与 Deliverable

Claim 只是下面两个版本化草稿 schema 的字段记录，不做通用图谱、图查询或任意实体类型平台。LLM 通过 draft_update 提议候选字段/关系，服务端执行确定性核对；模型不能传入 supported/confirmed 状态。

Claim 是候选事实，不是通过验证的真值：记录业务对象类型、稳定 ID、环境/版本、字段值和来源引用。事实字段引用必须指向当前 scope 的成功 Observation 及具体摘录。story.draft 是创作文字，明确不属于 Claim，不生成事实状态、不要求引用；其存在性由独立 draft_text_present 布尔值表示。引用存在不够，至少检查摘录确实存在、值有依据；语义一致性仍按规则/人工真值核对，不能以一次 LLM 评分代替。

Relation 显式连接需求、故事、代码、测试、缺陷或系统、发布、制品、运行环境。只凭名称相似不能建立已确认关系。用户提供的代码链接记录为 user-provided，未读取验证时不得标为 tool-verified。

Deliverable 保存场景、字段/关系要求、Claim 引用、缺失、冲突、时效未知与草稿正文。核对结果采用可解释的逐项状态：supported、missing、conflict、unverified、stale。全部必要项达到场景验收条件才称材料齐备；仍是待用户复核的草稿，不叫部署完成或研发完成。

采用独立小型、版本化的线程证据文件（schema_version=1），原线程消息只保存引用/摘要，避免 compaction 删除证据。路径为 DATA_DIR/business-evidence-v1/<scope sha256>.json（hash 输入为 UTF-8 JSON 数组：["chat", 已鉴权 thread ID] 或 ["mcp", grant ID, server session UUID]），不能把调用者参数拼成路径。Chat scope 使用服务端已鉴权线程上下文（与读取该线程消息的身份边界相同）；MCP scope 由已验证的具体 grant ID + 服务端会话 UUID 派生。工具参数不接受 threadId/owner/scope，scope 由执行器闭包绑定，格式合法的陌生 ID 也不能访问。当前产品是同一 OS 用户的本地 Companion，不扩展到多租户。

读写使用既有受限文件权限和临时文件原子 rename；同一 scope 的 mutation 排队，检查和写入在同一临界区，读者只见完整快照。上限固定为 64 条 Observation、单条内容 64 KiB UTF-8、单 scope JSON 总计 4 MiB、16 份草稿；以实际序列化字节检查。任何一个上限先到即拒绝新增，不逐出任何 Observation（包括未引用的）；不能逐出仍被草稿引用的证据；容量不足返回 EVIDENCE_CAPACITY/partial，不偷偷丢引用。达到 16 草稿或其他容量上限后，本 scope 可继续读/导出/更新既有草稿但不能新增；用户通过现有新建会话进入新 scope，旧引用保留；本版不新增 delete 工具。旧线程缺少文件时为空，不做全库迁移。未知主 schema 拒绝读取/渲染/修改并返回 EVIDENCE_SCHEMA_UNSUPPORTED；已知 schema 的扩展字段按原样保留，核对不使用未知字段。降级不改此独立目录是兼容要求，需在 0.6.6→0.7.0→0.6.6→0.7.0 演练中证明，不能只靠声明。

“公共证据”仅指两个 Pack 复用同一份有 scope 的数据模型，并非公开可读。0.7.0 这一切片不新增 Board 共享/同步，避免第三份状态；后续集成也只能复用同一 scope 鉴权。暂不改变旧 Board.canComplete / Loop completion 语义；新材料核对走新契约，避免旧线程被隐式重新解释。

## 5. 两个 Mission Pack

变更 Pack 与研发关联 Pack 共享读取、记录、引用、核对与导出工具。按现有 Pack schema 声明工具白名单和知识，不创建第二执行器，不升级已有 expert-ops 只读能力。

变更场景默认要求：目标系统及环境、发布/构建身份、制品身份、架构影响、CMDB 采集状态。具体字段和有效期从试点契约提供，默认缺项可生成草稿但不能通过核对。

研发场景默认要求：需求 ID/来源/验收标准、故事草稿、代码引用及确认状态、测试覆盖映射、缺陷记录或明确状态。空缺陷列表不等于无缺陷；空测试列表不等于已覆盖。代码开发可在原编辑器完成，也可经获准外部助手接力。

页面写入使用现有确认路径。0.7.0 基线交付草稿与关系核对，不自动发布生产变更、不承诺自动写完代码；若试点要求真实平台写入，必须增加写前确认、远端 ID、回读以及响应丢失后的去重验收。

## 6. MCP 独立上下文出口

新增可选上下文 profile/授权，不扩 default/interact。页面导出许可不包含知识或历史证据；新增知识范围须由用户明确选择文档/站点，调用者不能自授范围。

每次调用重新验证具体 grant 的存活、出口许可、目标和所选 ID；不借同 caller 的其他 grant 合并权限。返回获准子集以及 omitted 原因，不承诺不同授权集内容完全相同。上下文预算、版本、数据包装与 Chat 共用服务。

MCP 网页读取过程中形成的内部证据只归当前 grant/session，不允许任意 threadId 访问历史业务材料；本次不提供业务证据导出 API。Chat→MCP 历史材料分享与外部报告直写证据库不在本次首发范围；外部助手产物可通过已有聊天粘贴/文件上传进入 user_provided 候选材料，再由 CMspark 读取网页复核。撤销后停止新读取，并在异步读取完成、返回内容前再次校验同一 grant；期间撤销则丢弃待返回内容，不写入 scope 证据库；已被外部助手读到的内容不能声称能撤回。旧 grants 无新字段默认无上下文出口权。预算共享的是代码和常量，不是不同 scope/caller 的可消耗总池。

## 7. 验收与推进顺序

每一节点先做真实生产路径的机器验证，再让 Grok/DeepSeek 独立复审；阻断/重要发现修复后复审。关键节点：共享上下文/生命周期、提取契约、证据核对与 Pack、MCP 授权、最终两场景集成。

必须有负例：跨站残留、冷目标、知识撤销、过期经验、并发 caller、错误环境/版本/需求 ID、失败读取、无关引用、截断/分页未知、未验证代码链接、未覆盖测试、撤销出口权、升级后引用恢复。

合成网页与 stub 模型可验证契约和调用链，必须明确标注，不能替代真实企业模型/网页验收。OS、endpoint、网页样本和真值待用户补充；这些是最终首发验收前提，不阻塞已有基础修复及通用共享契约实现。


## 8. 两个固定草稿 schema 与核对规则（R5）

`change_material.v1` 与 `development_trace.v1` 均是待用户复核的 Markdown + 结构化 JSON 草稿；没有泛化的图谱 API。每个标识使用 `{system_key, kind, external_id}` 命名空间，禁止把不同系统的同号 ID 合并。system_key 专指来源平台（如 devops、artifact、architecture、cmdb），不等于变更的业务系统 ID；一个草稿允许同时引用多个来源平台。绑定表每行 `(system_key, environment, origins: string[])` 由用户试点配置绑定，允许一行包含多个精确 origin；核对器从此绑定取得来源系统/环境标签，不信任模型标签。环境无关的架构/需求页面允许在试点表显式标记 environment=agnostic，只用于环境无关字段，不替代 runtime/target 环境证明。一个 origin 服务多个环境时，还须配置页面范围和环境字段的精确文本提取规则，不能仅凭 origin 推断；缺少无歧义匹配则 unverified。没有绑定时可记录草稿，但字段和关系均不能通过核对，材料无法齐备。

| schema | 必需字段/关系 | 独立模式证据来源 |
|---|---|---|
| change_material.v1 | target.system_id、target.environment | 架构/CMDB 实际网页，引用系统 ID 与环境 |
| change_material.v1 | release.id、release.version、release.commit_id、release.build_id | DevOps 发布/构建详情网页 |
| change_material.v1 | artifact.id、artifact.version、artifact.digest、artifact.build_id | 制品详情网页；build_id 必须等于 release.build_id，且发布网页必须显式关联 release.id 与 release.build_id |
| change_material.v1 | architecture.system_id、architecture.revision、architecture.dependencies、architecture.impact_note | 架构设计/影响分析网页；空依赖只在来源明确表示无依赖时有效 |
| change_material.v1 | runtime.system_id、runtime.environment、runtime.assets、runtime.source_updated_at | CMDB 当前系统/资产网页；系统/环境必须与 target 精确相同 |
| development_trace.v1 | requirement.id、requirement.revision、requirement.acceptance_criteria | DevOps 需求详情网页 |
| development_trace.v1 | story.draft、story.requirement_id、story.acceptance_criteria | 服务生成故事草稿；requirement_id 与已读取需求一致；明确标为草稿，不能声称已在平台创建 |
| development_trace.v1 | code.repository_id、code.commit_id（code.pr_id 可选）、code.requirement_id | 企业代码托管的 commit/PR 网页；必须读取完整 commit 身份及显式需求关联；PR 页面须显示 head commit 才能提供该字段 |
| development_trace.v1 | tests.case_ids、tests.requirement_id、tests.commit_id、tests.run_id、tests.outcome、tests.source_updated_at | DevOps 测试用例和 CI/测试运行网页；需求/commit 必须与本草稿一致 |
| development_trace.v1 | tests.criteria_mapping | 每条需求验收标准映射到实际用例 ID，引用测试用例网页；只能说明存在显式映射，不能宣称测试语义完备 |
| development_trace.v1 | defects.status、defects.ids、defects.requirement_id | DevOps 缺陷查询/详情网页；无缺陷需完整查询范围与明确空结果，unknown 不等于 none |

附加描述、负责人、优先级、截图、发布窗口、备注为可选项，缺失不阻断材料齐备。用户试点只能在本地版本化 pilot-contract.json 的 required_fields 中增加可由白名单文本/HTML 捕获核对的必需项（截图不能设为必需）；核对器读取同一锁定配置并将配置摘要写入草稿；删除上述必需项或放宽核对属于显式 schema 配置变化，需要另留验收记录，不能由 LLM 自行决定。

业务时间与状态必须来自同一 Observation 的同一登记范围；多条状态引用时逐条核对其自身时间，不能借用另一 Observation 的新时间。缺少同源时间的状态为 unverified。默认时效按字段计算：普通可变网页字段使用 observed_at，最长 24 小时；runtime 状态/资产使用 source_updated_at，最长 15 分钟；tests 运行结果使用 source_updated_at，最长 24 小时。commit、制品 digest、架构 revision 等不可变身份不按内容或 Observation 年龄认定失效，但必须与本次选定版本对应；其他版本名称仍按普通可变字段处理。业务时间缺失：时间字段 missing，依赖该时间的状态字段 unverified；非法或超过 Companion now+5 分钟的未来时间为 unverified；合法但超过窗口为 stale。实际业务可在试点契约中显式覆盖这些窗口，发布验收锁定所用值。这些是材料复核策略，不保证底层系统自身实时。

字段状态的确定顺序：

1. 标量未提供、null 或空白字符串/必需关系未提供 → missing。集合未提供/null 是 missing；[] 是显式空集合，进入覆盖/empty_marker 核对，不按缺值处理。不存在或外 scope 引用、失败来源、尚未读取的用户输入、来源 system_key/environment/origin 不在绑定内 → unverified（越权读取请求本身拒绝）。
2. 精确摘录必须与规范化内容区间一致；关键 ID/环境/版本在原文必须为完整 token：相邻 Unicode 字母、数字或 `_.:@-` 时不允许截取。斜杠 / 是允许的分隔符；字段值自身可包含 /，核对时仍对整个候选字符串作精确匹配。区间不一致、值不在摘录中或 token 边界违规均为 unverified，不能落入 supported。普通描述需精确摘录；模型改写描述只可为草稿文字，不作为已核实字段。story.draft 是唯一必需的创作字段（不属于 Claim）：非空且渲染明确标为“故事草稿”即满足草稿存在性，不参与事实支持状态，也不声称在平台创建；story.requirement_id/acceptance_criteria 仍必须引用已核实需求来源。
3. 标量的当前引用支持互斥值，或集合的同一成员身份存在互斥属性（不同成员本身不是冲突）、环境/系统不一致、制品 build/commit 与 release 不一致、测试需求/commit 与草稿不一致 → conflict。禁止凭相似名称或模型打分消解。
4. 按上述字段组时钟表确定 stale/unverified/missing，分别记录原因。缺少必需业务时间不能用采集时间替代。
5. 部分/截断 Observation 内的具体字段可 supported，只要该字段精确有据；但依赖“全部”的集合（包括 requirement.acceptance_criteria、story.acceptance_criteria、dependencies、assets、测试覆盖、无缺陷断言；所有必需集合均适用）要求 complete_for_scope 且范围与所要求集合一致。集合范围必须等于 pilot-contract.json 中为该字段登记的 document 或命名 selector，complete_for_scope=true、truncated=false 且 pagination/virtualization 均为已确认非未知状态；未登记范围使集合 unverified。空集合仅在此完整范围的摘录精确等于配置 empty_marker 文本时 supported，禁止从省略项推断为空。分页/虚拟化未知使集合仍 unverified。容量不足记录为资源缺口并阻断本草稿齐备。
6. 其余字段为 supported。关系两端各自保留 {system_key, kind, external_id}，允许跨平台命名空间；禁止把两端同号当同一对象。来源引用须显式包含双方完整 ID，且 pilot-contract 的该关系 source_binding 声明来源字段分别属于哪一端命名空间；仅共现无绑定仍 unverified。也可引用锁定试点契约中的人工映射 mapping_id，须精确对应双方端点且双方事实自身已 supported；后者标 user_confirmed，不伪装 tool_verified。没有映射则不能凭模型布尔值补确认。用户确认不能消除越权/错误环境/冲突/过期。

材料齐备：仅 development_trace.v1 要求 story.draft 满足存在性（不冒充已核实事实），其余所有必需事实字段满足上述规则，所有必需集合覆盖已证明，必须的关系 supported 或显式 user_confirmed，事实字段和关系无 missing/conflict/unverified/stale，且无资源缺口；story.draft 不生成上述事实状态，仅检查 draft_text_present，且 development_trace.v1 的 tests.outcome 在 pilot-contract.json 固定 pass_values 集合中。独立模式的代码/测试关键身份不能仅凭粘贴 URL 或外部助手成功消息通过；网页可读路径是正常路径，用户上传报告保留 user_provided，必须回到系统网页复核。测试运行失败可生成真实草稿，但 development_trace.v1 不判齐备；完整且通过的运行也不被称为“研发完成”。

跨 origin 是本产品的正常行为：来源各自标明 system_key、origin、对象 ID、environment/version 和采集时间，核对使用这套标签，不要求所有来源等于当前活动 tab。异步读取必须绑定执行时实际目标；浏览器边界对读取前后目标比较 [tab_id, WHATWG origin, navigation_key]，任何一项不同即 TARGET_CHANGED/unverified。navigation_key 必须在浏览器边界用去 userinfo 后完整 URL（含 query/fragment）的 UTF-8 HMAC-SHA-256 计算；不能等脱敏 URL 到 Companion 后再计算。切换当前上下文不能重写已经采集证据的 origin 或把它自动归入新系统。

CMDB 的 not_collected 是 missing；not_applicable 必须由试点契约事先明确不需要运行资产的场景并有理由，模型不能用 N/A 绕过。当前默认 change_material.v1 要求 CMDB，所以 N/A 不通过默认 schema。固定必需关系名：change 的 release_artifact、architecture_target、runtime_target；development 的 story_requirement、code_requirement、tests_requirement、tests_commit、defects_requirement、criteria_cases。固定外键检查独立执行，用户关系确认不能覆盖不一致的外键。PR 可选；如果提供，PR 网页 head commit 必须等于 code.commit_id，否则 conflict。

## 9. Pack 工具与数据边界（R6）

不新增浏览器执行引擎。两个 Pack 使用已有 navigate/list_tabs/get_page_text/get_page_html/wait_for，以及以下本地材料工具，遵守既有工具白名单：

- `draft_create({kind, title, target, request_id})`：target 仅 {business_system_id, environment}，表示用户希望处理的业务系统/环境，不是浏览器 target 或来源平台，不接收 URL。创建值只是候选，change_material 的 target.system_id/environment 必须再由来源引用核对，禁止创建参数自动取得 supported。development_trace 可省略 business_system_id；需求身份由后续引用给出。kind 仅允许上述两种 v1 schema；返回服务端 draft_id、revision=1、缺失清单。request_id 为必需非空字符串（最多 128 字符）；同 scope/request_id 相同请求幂等返回；参数变化则 IDEMPOTENCY_CONFLICT。
- `draft_update({draft_id, expected_revision, fields, relations, story_draft_text, request_id})`：request_id 同样必需。fields 是按事实 schema path 索引的 map：标量项 {value:string|null, citations:[{observation_id, excerpt, start, end}]}；集合项 {value:string[]|null, citations:[{observation_id, excerpt, start, end, member_index:number}], coverage_citations:[{observation_id, excerpt, start, end}]}。集合成员为唯一 NFC 字符串，member_index 引用当前数组元素（越界拒绝更新）；每个成员至少一条完整 token/精确摘录支持，各成员独立核对，不要求整段 JSON 数组出现在网页。集合 [] 没有成员引用，只使用 coverage_citations 的完整范围和 empty_marker 核对；标量不接受 member_index/coverage_citations。未知字段或类型拒绝更新，不能猜 schema；story.draft 不放入 fields，另用可选 story_draft_text:string|null 更新创作文字（null 删除）；无引用也合法，渲染器始终附“故事草稿”标签；relations 是按固定关系名索引的 map，每项 {citations, mapping_id?}，后者只引用草稿创建时锁定 pilot-contract 中的人工映射记录，不接受模型布尔确认。不接受 verification 状态。新 request_id 且 revision 匹配时替换指定 path，未提交 path 保留；value=null 明确删除候选并变为 missing。每次非重放的成功更新将 revision 加 1（即使等值写入）；幂等重放不增加。冲突来自当前引用/字段，不来自历史候选。先检查 request_id 幂等缓存：相同规范化请求返回原结果（含原 revision），不同参数 IDEMPOTENCY_CONFLICT；随后检查 expected_revision，不匹配返回 DRAFT_REVISION_CONFLICT。
- `draft_read({draft_id})`：返回本 scope 的结构化草稿、引用与确定性核对结果；不存在/外 scope ID 统一 NOT_FOUND，不透露陌生对象是否存在。
- `draft_render({draft_id})`：同一份数据生成 Markdown 和 JSON 内容；复用聊天工具结果展示/现有导出，不直接写外部平台。输出明确“材料草稿：齐备待复核/未齐备待处理”，未齐备逐项列出缺失/冲突/未核实/过期/容量原因，不复用 Loop complete 字样。

符合捕获条件且入库成功的网页读取结果才增加字符串 observation_id；失败、仅 hostname、不可解析实际目标、TARGET_CHANGED 或容量不足均省略此字段，并返回 capture_status/reason（容量不足为 CAPACITY），保留原网页读取结果；由 Companion 自动生成，模型不能自行调用 record_observation 编造已执行读取。Summary、LLM 候选、外部助手回传与用户上传都不能伪造此 ID 来源。

MCP 新 profile 名为 `outbound_context_v1`，固定包含 list_tabs、navigate、get_page_text、click、type、screenshot、wait_for、downloads_find 与 site_context；不改变 default/interact 本身。上述八工具沿用现有 default/interact 的逐次执行权限、L2 与页面导出判定；allow_context_export 只控制 site_context，绝不放行浏览器写入或下载；allow_page_export 也不作为浏览器所有操作的总开关。现有工具继续逐项遵守 facade 的授权规则。新 grant 字段：`context_origins: string[]`（精确 origin，不支持 wildcard）、`context_knowledge_ids: string[]`、`allow_context_export: boolean`，另沿用 grant_id/caller_id/expires_at/revoked 与 allow_page_export。缺新字段默认拒绝上下文出口；page-export 不蕴含知识出口，知识出口也不蕴含 page-export。同一钥匙中的浏览器调用和上下文调用由 Companion 绑定到同一服务端 grant/session scope；不合并同 caller 的其他钥匙。scope/session ID 只由 Companion 分配，调用方仅拿不透明句柄且每次绑定同一有效 grant 校验。

`site_context({tabId, query})`：目标由浏览器解析，origin 在当前钥匙 context_origins 集合内；共享 Knowledge 投影只包含 context_knowledge_ids 中选定且仍存在的知识正文片段/来源/版本，不包含内部 Safety Guard、会话消息、未选知识、原始 URL token。该接口仅导出所选知识投影与当前 grant/session 自身内存产生的经验摘要（origin、次数、到期时间、stale），经验部分不导出从共享知识恢复的其他线程记录，也不导出 Observation 正文，不读取/导出业务 Observation 内容。业务证据仍归其创建 scope，0.7.0 本切片不新增 evidence_read/历史分享出口，避免发布无法兑现的预留 API。

MCP 内外一致指同一授权文档集合、同一目标/查询、同一预算时使用同一 Knowledge 投影算法；不承诺聊天安全提示等全部内部 prompt 完全相同。omitted reason 固定为 GRANT_DENIED、SCOPE_DENIED、NOT_FOUND、BUDGET、REDACTED、CAPACITY；任何省略不能被消费方理解为完整材料。TARGET_CHANGED 是读取结果错误码，不是 site_context 的 omitted reason。

MCP 在核心两个 Pack 之后单独交付/复审；这是用户要求的可选外部入口，不成为独立运行时依赖。最终 0.7.0 仍需通过其已承诺出口门禁。Board 分享、通用关系图、Chat→MCP 历史证据分享延期，不削弱两个首发业务场景。

草稿来源尾注示例：`[obs_123] DevOps / release:REL-42 / prod / 1.2.3 / 采集 2026-09-07T03:00:00Z / source_updated_at:unknown / selector:#release / 覆盖 partial`。每个字段链接到本 scope 的具体摘录；显示 URL 仅 scheme/host/path。草稿与工具数据始终按不可信内容渲染，不能由 Markdown 执行脚本。

## 10. 发布阻断与补充负例（R5）

两个真实场景的生产调用路径验收均是 0.7.0 发布阻断项；合成契约测试、审查通过、核心服务实现均不能代替。所有必需集合都有试点适配声明：简单静态顶层页面使用版本化 static_declaration_v1（明确 document/selector、无分页/虚拟化、登记 empty_marker）；其页面结构须通过试点真值验证，任何缺声明/结构不符恢复 unknown。若试点网页包含 iframe/分页/虚拟列表，对应遍历适配器进入发布关键路径；不能仅靠 unknown 枚举就宣称支持。初始顶层实现可用于开发 fixture，最终试点必须明确页面可提取结构或完成相应结构适配。

补充必须测试：伪造/外 scope draft/observation ID；跨 grant 访问；异步读取期间撤销；原始 URL token 在上下文/存储/导出中均消失；容量边界不丢引用且不判齐备；并发更新 revision 冲突；原子写入中断保持上一完整文件；降级再升级/未知版本保留；采集时间与业务时间混淆；origin 禁令跨 tab 生效与 tab freeze 独立；同域不同端口/协议不串禁令；摘录从 non-prod 取 prod 被拒绝；源系统标签/对象命名空间错配；Pack 白名单不因材料工具绕过；SkillEngine 抽取服务前后固定语料与同选择集输出特征一致。

开发评审流程只记录在此文档及审计日志，绝不作为产品运行时需要 Grok/DeepSeek 或多 Agent 的能力依赖。

试点冻结前须校验页面实际 ID 排版（紧邻冒号/点等可能因严格 token 边界而 unverified）与重读容量（CMDB 15 分钟窗口下 64 Observation 是否足够完成一次任务）；未通过时调整页面提取/试点配置契约并重审，不静默放宽核对或逐出历史证据。

## 11. pilot-contract.v1 与关系端点（#453）

本版只接受 schema_version=1；缺文件允许存草稿但不能判齐备；未知 schema 拒绝核对并保留原文件。原始文件由用户/试点维护，不提供模型修改此配置的专用工具；每份草稿记录本 scope 已锁定配置的 SHA-256 和快照，外部文件变化不会静默重解释既有证据。

固定结构：
- bindings: [{system_key, environment, origins:string[], environment_selector?, environment_literal?}]；所有 origins 导入时以 HTTP(S) WHATWG URL.origin 规范化，去默认端口，拒绝 userinfo/path（除 /）/query/fragment/wildcard，同一行规范化后重复 origin 拒绝；跨行同 origin 只有环境精确提取规则可无歧义区分才允许，否则拒绝配置。environment=agnostic 仅可用于不要求环境证明的字段。
- collection_scopes: 按固定集合 field path 索引，值 {adapter_id, adapter_version, scope:{kind:document|selector, selector?}, empty_marker:string, binding_system_key}。static_declaration_v1 的声明属于用户提供的试点假设，必须通过真实页面验收；不会自动适配未知页面。
- source_bindings: 按固定关系名索引，值声明允许的来源平台和两端 {system_key,kind}，用于解释来源中两个显式 ID 的命名空间；无声明不做跨平台自动对应。
- mappings: [{id, relation, from:{system_key,kind,external_id}, to:{system_key,kind,external_id}, rationale}]，由用户维护的人工映射，不能以模型请求新建；关系工具只引用该锁定快照已有 id。
- required_fields:string[] 只能添加本 schema 允许的可文本核对字段；pass_values:string[] 必需非空；freshness 可选，单位毫秒，窗口必须为有限正数，缺省用 §8。
- runtime_not_applicable 可选 {allowed:boolean, rationale:string}；默认 false。not_collected 就是没有 runtime 证据，不需要从网页寻找特殊 marker。

架构端点为 {system_key:架构来源平台,kind:architecture,external_id:architecture.system_id + "@" + architecture.revision}；这是一项明确标注的派生标识，不冒充远端原生 ID。目标端点由已核实 target.system_id 和来源平台命名空间限定，不能拿 draft_create 参数自动充当已核实目标。

requirement.acceptance_criteria 为标准原文字符串集合。每条标准的派生 criterion ID 为 requirement.id + "#" + SHA256(NFC 标准原文的 UTF-8 字节) 的小写十六进制编码，来源命名空间归需求平台；它不是远端原生 ID。tests.criteria_mapping 为固定编码的字符串集合：JSON.stringify([criterionId, caseId])；其成员引用须同时包含该标准完整原文与该 caseId 的显式对应（不能要求派生 hash 原样出现在网页），并有 source_binding 约束两个命名空间。每条需求标准至少有一条映射；未覆盖不判齐备，不能宣称语义完备。

MCP 自动捕获只为该 grant/session 的内部审计保留有界 Observation，本版没有材料编辑/历史导出入口；消耗容量是明确限制，容量满时保留网页读取结果并省略 observation_id，返回 CAPACITY，不扩充权限以恢复容量。

## R6 核对例外与确定性细则（优先于上述通用规则）

- tests.criteria_mapping 是唯一不按整个成员值逐字出现在网页核对的派生集合。核对器解析固定 JSON 二元组，依据已 supported 的 requirement.id/完整 acceptance_criteria 计算 criterionId，再核对同一引用范围内标准原文与完整 caseId 的显式对应及 source_binding。候选编码必须与核对器生成的标准 JSON 完全相等；哈希和整个 JSON 串不要求出现在网页。仍检查集合完整覆盖、来源绑定、时效和所有 caseId 属于 supported 的 tests.case_ids。criteria_cases 关系由这一完整 supported 集合确定性导出，不再要求网页出现派生 criterionId；模型不得提交该关系以覆盖推导结果。
- architecture_target 对派生架构身份同样核对 architecture.system_id 与 architecture.revision 的各自完整原生值及 source_binding，不要求拼接的 @ 身份字面出现在网页。story_requirement 是创作草稿的来源关系：草稿存在且 story.requirement_id 精确等于 supported 的 requirement.id，故事验收标准引用已 supported 的完整需求标准集合即可；不虚构远端 story ID。除这三项外，关系继续要求两端完整原生 ID 的明确对应。
- relations 的 citations 元素固定为 {observation_id, excerpt, start, end}，规则与标量引用一致，不接受 member_index。criteria_cases 是只读派生结果，draft_update 提交它返回 INVALID_RELATION；固定关系清单包含它仅表示核对输出必需。
- 幂等请求规范化：完成类型校验后，对所有对象键按 Unicode 码点排序递归序列化，数组顺序保留，字符串按各字段既定 NFC 规则，省略不存在的可选键但不省略显式 null，数字须有限安全整数；不包含传输层字段。操作名与全部有效参数（含 expected_revision，不含 request_id 本身）一起生成 SHA256。不得裁掉未知键后接受请求，未知参数直接拒绝。
- 容量拒绝是整个 mutation 原子不应用，不是部分写入。partial 只描述本草稿材料状态/捕获缺口；绝不意味着已写入半份 Observation 或半次字段更新。

R6 独立复审解释细则：

- 覆盖记录统一为 coverage:complete_for_scope|partial|unknown 与 complete_for_scope:boolean，后者严格等价于 coverage===complete_for_scope，不能分别赋值；pagination/virtualization 是独立覆盖维度。多个 field path 匹配同 origin 和 scope 且 adapter_id/version/binding_system_key 一致不算歧义；匹配行使用不同适配器版本或无法唯一解析来源平台才拒绝覆盖。binding_system_key 从锁定 bindings 的 origin 匹配产生，不能从模型标签取得。
- criteria_cases 与 story_requirement 均为只读字段派生关系，跳过“未提交关系→missing”的一般步骤；核对完字段后生成。story_requirement 复用已经核实的 story.requirement_id 与 story.acceptance_criteria 引用，不接受单独关系 citations/mapping_id，不创造 story 外部端点。draft_update 对这两个关系名都返回 INVALID_RELATION。architecture_target 仅免除派生 @ 字面匹配，引用仍须支持原生 target.system_id 及架构系统/版本。
- 派生标准端点 kind 固定 acceptance_criterion，用例端点 kind 固定 test_case。criteria_mapping 字符串严格使用 ECMAScript JSON.stringify 的无额外空格/标准转义二元数组，不用幂等请求序列化器代替。明确对应指登记来源关系内的完整标准原文与完整 caseId 同范围出现；该规则不推断测试语义充分性。
- freshness 形状固定 {mutable_ms?, runtime_ms?, tests_ms?}，分别覆盖三组有限正整数毫秒窗口。幂等回放记录同样计入 4 MiB scope 上限，不逐出旧记录；达到容量时拒绝新 mutation 并保持旧请求仍可回放，避免无界增长或静默遗失幂等保证。
- 扩展 captured_at 只用于当前读取诊断；持久证据只保留 Companion observed_at 这一采集时钟，业务 source_updated_at 仍来自正文。Observation 构造器必须验证目标中的 url 精确等于 WHATWG origin + pathname（根路径保留 /），否则拒绝捕获，不从脱敏 URL 重算浏览器 navigation_key。

导航指纹安全补正（#451 DeepSeek 代码复审，经 Claude Code CLI 调用）：navigation_key 使用浏览器 Service Worker 内随机、不可导出的临时密钥执行 HMAC-SHA-256（UTF-8，去 userinfo 后完整 URL，小写十六进制），不使用可离线猜测查询值的普通哈希。密钥不持久化、不传给 Companion/模型/MCP；worker 重启时指纹失效并重新读取，不能跨密钥生命周期用指纹相等推断页面未变化。Companion 只验证并保留浏览器指纹，不能从脱敏 URL 重算。内容 digest、文档版本与 scope hash 仍用原先 SHA-256，不改变它们的契约。

旧客户端兼容决定（#451）：只有 hostname 的旧扩展继续使用站点知识提示，明确属于 hint；不基于它恢复精确 origin 的机器禁令，避免猜测协议和端口。第一次成功且已通过权限判断的页面工具提供实际 tab 后，下一轮解析实际目标并恢复所选且实际注入文档中的有效经验。原有本轮失败计数与即时禁令继续有效。升级/降级演练须覆盖这一混用窗口，不能声称旧客户端在首次实际页面访问前具有完全相同的持久禁令行为。

提取来源补强（#452）：CDP/isolated/main 在同一同步页面读取中采样正文与 location.href，在浏览器端生成 HMAC 后丢弃原始 URL；来源指纹必须同时匹配前后 tab 样本。DOM 回退绑定 DOM.getDocument 的 root.documentURL，缺失文档 URL 时可返回普通正文但不提供证据有效目标。data.source 保持旧 runtime|dom 家族，provenance.channel 提供实际通道。标题中的 URL 形态文本同样脱敏；pathname 与任意非 URL 页面文字不被声称绝无秘密。

#453 实现复审补正（R2，待复审）：

- mutation_result 只用于创建/更新的原回执重放。draft_read 与 draft_render 的 JSON 删除该历史回执，只暴露当前核对结果的 ready；避免历史已齐备与当前已过期同时出现。
- 空 runtime.assets 的 coverage_citations 仍须精确等于固定 empty_marker。源业务时间由同一 Observation、同一登记完整范围内的独立时间引用证明，不要求固定 empty_marker 本身含动态时间；其余非空状态引用仍要求同范围时间出现在具体状态摘录中。业务时间使用完整带时区 ISO 时间，禁止截取日期前缀。
- tests.criteria_mapping 的每条成员引用须是单行明确对应，包含完整标准和用例 ID，不能同时出现其他已选标准或用例；全页共现不能证明交叉配对。复杂多行关系布局需进一步适配，不能猜测后判齐备。
- 架构 system@revision 派生身份的两个组成值若含 @，关系核对保守拒绝以避免拼接歧义；不得用碰撞后的人工映射替代原生身份。
- draft_read 返回已核实需求标准的 criteria_catalog（含派生 criterion_id），使无 shell/Codex 条件下也能构造标准映射。
