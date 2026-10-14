# 可选 Project 元数据与两端对话归属

> GitHub: #641；Parent: #481
> 日期：2026-10-14
> 状态：root 非作者合同已批准实现；作者 focused/backend/frontend/两端合成 UI 与双 build 通过，source 冻结交付独立复审；非作者源码、完整模型、fresh ARM、CI 放行仍 PENDING。
> 基线：`5cafdf5604a7456b56c3d11578f4afdd9787c164`
> 实施基线：`56e7fc8b1c8f1051845cd7b4d3a073c8585a8f8d`（安全 fast-forward 的无交叠 #640 已交付变更）。
> 原设计：[workspace projects §5](../plans/2026-09-08-workspace-projects-ux.md)。

## 1. 产品行为与范围

用户可以只凭名称建立真正独立的 Project，显式组织空闲对话。普通对话默认项目外；人工标签、手动分组、AI 分类仍独立。插件和召唤器使用同一个服务端持久化元数据所有者和同一语义的创建/选择/移出/改名/归档/恢复入口。Project 不是文件夹名、工作目录或授权。

本切片只交付 name-only 组织元数据，不加入 Project.workspace_root 建议/继承、目录 picker、文件内容、自动 mkdir/clone/worktree、共享资源/密钥、新 Execution store 或旧历史批量迁移。已有 thread.workspace_root 与运行 cwd/commit/权限完全按原入口使用。现有 ACP/PTY/LLM 运行仍以 thread/session 事实键归属，切换项目视图不能改变执行目标。未来目录建议需独立切片，不借本元数据字段直接放开现有 workspace ACL。

原 #481 的 tags/group、代码 owner 隔离、整体 audit/规范已完成，继续复用；本票不重复实现。backend execution 历史/private CLI descriptor 退役仍是后续协调项，不给它发明容量值、删除规则或延长原命令期限。

## 2. 单一持久化所有者

新增独立 `ProjectStore`，固定在既有 Companion config/data 根内的 `projects.json`。它只拥有项目记录及 thread→project 关联；ThreadManager 仍独占消息、普通 Thread/资源/权限数据。**不把关联同时写进 thread index 和 projects.json**，避免两个文件之间半事务和两个事实源。

规范格式为 `format_version:1`、非负 safe-integer `revision`、项目数组和关联数组。每次实际 mutation 整个文件 revision+1。Project public DTO：稳定服务端 UUID `id`、`name`、`created_at`、`updated_at`、`archived_at:null|string`。名称 NFC+trim，1–80 Unicode code points、UTF-8≤320 bytes；拒控制字符/空白名称。名字只作 textContent/React 文本，不用目录 sanitizer，不是文件路径，可以含普通 `/` 字符。

关联记录为 `thread_id`、原 Thread immutable `created_at`（incarnation fence）、`project_id`。同一 incarnation 至多一条；项目外不存关联。对已硬删除 Thread 的旧关联无需重写旧消息：读取时只投影 actual Thread.id+created_at 匹配的记录。重新创建相同 thread ID 不继承旧关联。归属投影为 optional `Thread.project_id`，没有匹配关联时为未设置/null。这仍是真实 Project 实体，与 folder/tags 无关，不复制 Thread 仓库。

读时无文件是空项目状态 revision0，**读操作不创建文件**。原无 Project 历史不重写。缺失单个 Project 记录但保留关联时原 Thread 仍可读，显示“原项目不可用”，不得悄悄当作删除了对话。损坏/超限/非规范 store 返回固定 PROJECT_STORE_INVALID，保留旧文件、禁组织 mutation；普通 Thread/messages/chat 继续可访问并显示组织状态不可用，不静默覆写空数据。

明确工程预算：最多256 Project记录（含归档）、8192关联，规范 JSON UTF-8≤4MiB。超过上限拒新写/导入，不自动删除任何项目/关联/消息，不宣称backend session history已有此上限。本值是本新元数据 store 的候选预算，由 root 审合同；不是旧 descriptor 生命周期承诺。

## 3. 原子写、OCC 与失败

所有 writer 必须经唯一 ProjectStore mutation入口：取得有限一次的 exclusive `wx` owned lock，fresh读取规范磁盘状态，核 expected_revision，再做无 await 的 busy/ID/状态检查和 staged-copy mutation，同目录原子写/rename，**成功之后**才发布新内存状态/回执。store与lock只接受受限根中的regular/no-follow文件；不从客户端接受path。暂存使用本次独占创建的随机文件、0600，同目录rename；不得跟随已有temp/symlink或覆盖未知暂存。writer冲突、写/rename失败一律固定错误，原数据保持；不能在内存先修改再假保存。finally仅释放本次仍匹配owned dev/ino身份的lock/temp；不自动删除未知/遗留锁、不无限等待/retry。遗留锁显示需管理员在停写状态检查，组织功能不可用不影响普通聊天。

复用 `io.atomicWriteJSON` 只解决整文件替换，不声称它单独实现跨 writer OCC或双文件事务。持有锁后必须 fresh读取、比较持久 revision，不能只比较进程旧cache。威胁范围是同一受限本地数据根的合作 Project writer，非任意同权限恶意进程；不重构现有全局数据锁体系。

所有 mutation 带 canonical UUID `operation_id`、exact `expected_revision`。非create mutation失败/丢回执不得自动重放；UI重新list并展示实际保存状态和原草稿后，由用户显式决定。create额外在项目内部保存 `creation_operation_id` 和规范初始名称（不投影UI/model）：同一operation+相同初始name重试先返回原Project current DTO/revision而不改名、不恢复归档、不增revision；相同operation换name拒。服务端第一次创建生成稳定UUID。这个每Project一份 provenance 支持lostACK/restart后确认原创建，不新增无限操作日志。create复读匹配发生在受锁 fresh读取后、OCC之前；别的操作的stale revision仍conflict。

所有输入严格拒未知key/错类型/非finite/危险原型字段、超限body；错误不含配置/路径/其他thread正文。只接受 metadata字段，不透传任意updates或 store内容。

## 4. 公开传输与 ACL

现有 authenticated WS + summoner authenticated HTTP，不加 listener、不作为 LLM catalog tool。shared service验证、OCC与busy检查是唯一路径；HTTP适配不能旁路调用store。

冻结方法候选：`project.list`（read）、`project.create`、`project.rename`、`project.archive`、`project.restore`、`thread.project.set`。mutator都含 `operation_id`/`expected_revision`/literal `user_gesture:true`；create只有name，项目动作只有project_id及rename name，set只有thread_id和project_id:string|null。传输已有correlation id保留。surface限现有可信panel/summoner，overlay新增allowlist**仅这六个元数据方法**和exactpayload；不能修改现有thread.update的alias/tags/folder exact boundary来偷渡project/path/config。其他surface/modeltool不能借metadata方法获得运行/批准权限。

read返回 `revision`、public Project DTOs；mutation返回matching operation_id/revision及实际 Project 或带project_id投影的Thread。不把creation provenance、目录、运行参数、confirm详情、descriptor输出。Thread list/update/select所需公共投影经同一ProjectStore，不能每端另建归属事实源；客户端的临时筛选/草稿不是持久所有者。

HTTP建议路由 `/api/projects`（GET/POST）、`/api/project/rename|archive|restore`（POST）、`/api/thread/project`（POST）；是现有认证dispatchAllowed到上述WS语义的薄适配，非新授权通道。未知字段混合合法元数据一并拒；不能同包顺带workspace/MCP/config/approval字段。

## 5. authoritative busy 与操作语义

`thread.project.set`（包括移出）必须先验证actual Thread存在且未trash，目标Project active或null，expected_revision匹配。**任何已有/可能正在运行或等待决定的实际producer状态都拒这条metadata移入/移出**，不能取客户端 idle/currentProject/threads UI cache为准。

源绑定检查：现有message-router `abortControllers`/`listLlmActiveThreadIds()`；ACP offered/confirmed/running及startup preparation；`ws/tool-forward`当前pendingToolCalls；PTY live/closing/等待L2 open；尚有效的 thread embed intent（实际TTL10分钟，**不是旧task command60秒**）；现有SecurityConfirmationManager pending。需要只读boolean adapter时只补有界检查，不暴露秘密/参数，不取消任务/决定/intent来满足移动。

当前原生L2 request经 `ws/lifecycle` `{originWs:ws}` 不总是带workerId/thread；现 `hasPendingForWorker` 不能证明这个线程没有unattributed确认。此切片保守规则：当 confirmation存在不能可靠归属、全局/unbound或foreign-owner活跃资源无法可靠关联时，移入/移出返回 PROJECT_THREAD_BUSY/PROJECT_ACTIVITY_UNKNOWN。可以用 `pendingCount()>0` 或当前唯一PTY busy作为保守拒绝，不伪造thread scope、不放松nonce/origin gates；UI文案说明先结束执行/处理决定再整理。不声称已实现不存在的hasPendingForThread。

writer取得锁后fresh校验、最后busy检查至原子提交之间**不await**；actual执行producer进入pending/active必须在其已有首个async等待前可被probe观察。mockprobe只作测试seam，production未正确注入runtimeprobe不得缺省idle，而应拒写。纯read不受busy门阻挡。

rename只改项目名称/updated_at/revision，可在归属线程运行时进行，因为稳定ID、thread/session/cwd/权限都不变。历史执行不重写成新id。archive检查全部仍匹配的关联Thread；任何busy/unknown整包拒，不能部分归档。成功archive只标archived_at，保留关联/消息/文件；existing Thread仍可访问并显示“项目已归档”，不自动移出，不停运行。归档项目不能成为新关联目标。restore只移除archived_at，不移动关联/目录/权限；保留实际old/current Thread。无Project硬删除接口，不级联删文件。相同状态的archive/restore，在revision和权限检查后可明确返回unchanged，不假增revision。

普通全局 `thread.create` 默认项目外。本切片“项目内新对话”采用先existing thread.create、actual returnedThread后**显式thread.project.set**两步，不宣称跨两个owner原子建会话；若关联失败，保留实际创建的项目外对话并给清晰恢复入口，不重复create或丢掉它。本切片不改 Fork复制语义；既有Fork保持原样/项目外，项目继承留未来Issue，避免静默迁移。已有会话可显式移入/移出。

## 6. 两端 UI/UX

Project是独立于“查看方式：最近/标签/分组/AI”的组织区域/筛选。至少“项目外对话”、项目名称/归档状态、创建name-only、search/list、改名/归档/恢复、对话显式选择/移出。不新增假的目录字段或“项目自动授权”提示，不复制Thread管理。

操作固定其submit时operation/thread/project/revision；迟到回执只能更新对应记录/notice，不能应用到当前另一thread、自动切换当前Project或抢回代码面板。成功必须与actual persisted回执匹配；transportACK不是成功。UI retain drafts/error/conflict/unknown状态，refresh不隐式重放。busy按钮可先禁用辅助反馈，但server门仍权威。界面显示现thread原显式workspace不变；不把选择Project当代码目录选择。

使用现tokens/WorkspaceFrame/ThreadList metadataeditor/sharedprojection + summoner existingHTMLadapter。主要控制≥32px；text+semanticbuttons、Enter/Space、Escape、初始focus/return；320/390及759/760转折、420/480短屏可到达操作与错误反馈。控件不遮挡composer/stop/confirmation。静态截图仅作旁证，验收要实际组件/HTML交互+actual backend保存/restart回执。

## 7. 验收与明确未声明项

必须actual producer红→绿：name-only真实Project对象/稳定ID；operationlostACK/restart同一创建；旧历史零迁移/tags/folder/workspace/message hashes；Thread incarnation reuse；same-revision两writer仅一winner；atomic失败不提前memorypublish；非法/archived/missing/corrupt；actualbusy/latepending/unknown拒写；混合敏感payload；两端persisted身份/版本/迟到/错误/UI键盘+窄短屏。

copy/store/schema fixture取生产serializer/response，不手造猜测payload。并发writer用实际临时数据根/实际store，不mock掉freshread/commit；busy反例生产router/manager/probe链路，拒绝必须证明0metadata writes/0exec/0confirm副作用。read不可创建store。合成UI授权明确synthetic，不叫本人确认、nativeOS或云模型。

无默认App/DMG安装、真实企业SSO/业务链接/第二身份、provider模型、麦克风/文件内容、futureProject目录授权、#476高权限native管理、backend history退役的完成主张。Grok4.6/DeepSeekV4Pro真实identity及当前用户允许的最终review流程需root如实记录；**工作日无Pi**，现有configuredClaude可用，availability不是approval。

## 8. Blast 与 root 阻断条件

T3，因summoner metadata allowlist窄扩。Surface两端组织；L2、Trust、Autonomy保持；Compose独立组织元数据→existingThread；Channel既有authHTTP/WS。项目ID/名称不是安全身份。没有root合同批准、明确busy probe接线/故障默认拒绝、同owner跨面投影和OCC亲证时不能称可实现/可合；source author不能自批。

**合同批准仅允许本切片实现，不是产品/模型/发布 APPROVE。当前产品实现中；没有 stage/commit/push 或完成票操作。**
