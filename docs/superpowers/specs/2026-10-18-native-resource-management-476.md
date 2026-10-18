GitHub: #476

Approved implementation contract; source review and hosted native delivery remain pending.

# #476 原生单 Markdown 技能／知识管理合同

状态：CONTRACT_ONLY，待root真正非作者批准后才实现。原Issue[476](https://github.com/nehcuh/cmspark/issues/476)已先于本设计存在；本批属于原“技能／知识管理、只读列表不算完成”，不新建需求票。基准公共tree e838cac35b90c3ab91ee3fedf5e9b963724fadfb；保已源审对话42／Stop2、已交MCP/metadata，不声称这些都已真实发布或whole476完成。视觉沿用现DESIGN与原生四页。

## 1. 本批可用结果与边界

同一资源模块完成两页的“查看正文→导入单MD文本→核实持久化→再次打开→修改知识／移除”。kind只skill|knowledge；update只knowledge。builtin一律只读，类型/身份含糊则拒；现有folder skill可只读SKILL.md主正文，不通过exportSkill打ZIP，不宣称展示其其它资源。**本批不移除目录型skill**，避免把单MD删除扩成整个目录删除；这是明确的有限范围，待root本合同裁定。非builtin单文件skill可移除；knowledge按canonical文档ID管理。

无URL、renderer磁盘路径、ZIP／目录上传、安装脚本、依赖安装、进程执行、全局启用开关或默认配置变更。这是全局资源变更，不是只影响某一thread的附件：OS确认明确可能影响现有匹配规则下后续读取这些资源的对话/轮次；不自动附加到当前thread，不承诺所有正在运行的轮次完全不受既有refresh语义影响。管理许可不等于执行资源指令或绕过现tool/HITL。skill.activate/deactivate只是线程附件，本批不拿它冒全局管理。原PTY/ACP、文件工作、对话归档／搜索、Chrome逐任务策略及整体场景仍在476后续范围；本批不顺带开放。

## 2. 当前真实来源与数值

真实producer：SkillEngine.get/list、getKnowledge/updateKnowledge/importSkill/importKnowledge/deleteSkill/deleteKnowledge；知识import同时保原findKnowledgeDuplicate规则，force覆盖入口不暴露。身份复用doc-identity的allocateDocIdentity、cleanTitle及现有根/符号链接规则，不另写YAML/Markdown语法。知识更新两项真实writer缺陷由root单独修并交真正非作者审；本合同不重做产品源码。

已有固定值：knowledge正文wire cap524288 UTF8字节、文件cap6291456（skill-engine.ts:66–67）；title200字符、filename stem80（doc-identity.ts:8–9）；description500（updateKnowledge）；tags最多8、每项24（normalizeTags）。沿用现归一化，不静默新增更宽值。真实同SHA engine测得正文524287/524288完整，524289截断且body更新被拒；malformed技能YAML被拒；skill.import对524289正文仍接受。故本native**请求text及知识replacement body均≤524288 UTF8字节**是复用wire cap的明确新入口限制，不谎称现skill importer已有此限制。所有发送帧还受既有10MiB WS界限，按最终JSON UTF8字节复核；不提高全局frame/heap/进程预算。

read返回完整canonical正文text（不是ZIP、文件路径或原始config）；skill text为主Markdown正文，knowledge text为完整parsed body，title/description/tags单独表示，正文不含额外序列化的授权元数据。超过524288可返回明确truncated预览；不是“全文”。私有目标文件若大于现6MiB cap先拒target快照读取，不承诺修复existing engine扫描所有外部文件的总体内存。脱敏命中、截断、读取失败、含糊身份或目录skill都不得update/remove回写；builtin只读。UI明确原因，不拿缺失字段当空正文。

确认复用同一SecurityConfirmationManager默认45000ms，不重置“全文查看”／重试／回执时间；沿用已有L2 admission60s等待与per-run1/process2，不设第二队列或新deadline。一个已认证socket最多一个资源写operation、一个当前read/edit快照；现宿主数量边界不扩大。方法集4→5时保auth protocol1/HMAC domain不变；launcher同步生产5，两host与全部实际bootstrap消费者精确接收5。旧4cap只能原scope，不靠renderer请求提升；重铸需真实launcher revoke/relaunch，不fallback。

## 3. 精确四方法与DTO

renderer仍先通过native主文档generation校验；host去掉generation、重映射request ID后走专用channel。id沿用dialog的1–128 ASCII[a-zA-Z0-9_-]；kind为上述两值。除下列exact keys外一律拒，包括原型键、重复JSON键、rawargs/config_override/trust/permissions、路径、user_gesture及decision。payload_json是仅用于固定schema的JSON string，不是genericforward：

| method | exact wire keys（含type,id） | payload／行为 |
|---|---|---|
| desktop.resource.read | type,id,kind,resource_id | 真canonical ID，不按title／renderer filename选文件 |
| desktop.resource.import | type,id,kind,payload_json | 内层exact {text:string}，完整单MD文本；无url/path/force/pin_thread_id |
| desktop.resource.update | type,id,kind,resource_id,revision,payload_json | kind必须knowledge；非空patch仅title,description,tags,body。值类型严格，不String任意对象；按已有canonical规则规范化并向controller呈现实际归一值 |
| desktop.resource.remove | type,id,kind,resource_id,revision | 只能移除捕获的非builtin单文件资源，不递归目录 |


成功read的.result仅：type,id,ok,doc。doc白名单kind,resource_id,title,description,tags,text,complete,truncated,redacted,builtin,writable,read_only_reason,revision；revision是server根据真实快照产生的opaque64hex OCC指纹，不是凭证/授权/全局generation。可写快照才有revision；不可写时为null。禁止source_file、dir、resources、路径、环境、trust、安装/允许目录字段及原始异常。内容用textContent/惰性文本，不能执行HTML或内容指令。

import/update/remove结果.result包含type,id,kind,ok,outcome及仅已确定时的resource_id；outcome为committed|denied|conflict|unavailable|unknown，error_code为闭合DESKTOP_RESOURCE_*值。成功后read实际当前资源再建立新revision，不能沿用旧快照。失败不能回显正文、异常或路径。发生写后刷新错误／连接丢失时诚实unknown，不声称“没写”，不回滚已成功提交。

导入先用canonical parser/identity/duplicate规则得到规范化action和预期新ID。已有同kind canonicalID/name或builtin冲突必须拒绝；知识正文duplicate按现规则拒，无force按钮；不跨kind选取同名对象。YAML元数据只能作为当前canonical parser认可的资源内容/元数据，不能变成信任、builtin、运行命令或安装权限。未知/权限型import frontmatter不能透传成可执行设置；实现用现loader实际读取字段的有限投影（name/id/title/description/type/site/tags/priority），其它frontmatter需明确拒绝，正文原字节保留。Skill type仅当前prompt_template/tool_chain/sub_agent/site_knowledge/domain_knowledge五种；不新增类型。导入提交必须create-exclusive，若预期目标被抢占则conflict，不依赖allocate后默认writeFile覆盖；这是当前importer需要的窄internalcommit差额，旧caller不能被悄然改义。

## 4. 私有快照、OCC与ABA的真实保证

当前getKnowledgeVersion只hash语义content/meta，get依赖path|mtimeMs|size缓存指纹；refresh只有内部派生索引触发，**没有现成可供资源actor订阅的逐资源mutation事件**。两者均不是完整文件身份。合同不发明已存在的强OCC接口，也不宣称一次裸content SHA拒绝所有ABA。

实现须在canonical engine旁提供窄私有snapshot/commit出口：唯一kind+ID映射、builtin/单文件分类、固定根/父链身份、lstat/fstat真实文件身份（dev/ino/birth/ctime/mtime/size的可用准确值）、完整raw bytes SHA及canonical正文/metadata投影。读取前后验证同一真实regular文件、拒链接/替换/不一致；不能借缓存旧get跳过直接当前磁盘校验。renderer只见revision，不见private路径/原字节/文件元数据。

仅为活跃快照／pending动作，在**既有同步refresh/受控resource写链**加有限观察通知：每次可影响该资源的canonical mutation/refresh使该快照单向invalidated，即使A→B→A最终正文相同也拒；订阅在actor取消/新read/完成时解除。它不是持久全局generation、tombstone、每文件无限map或新授权。原公开caller仍原义；私有新出口使用该观察及真实磁盘检查。任何新事件钩子在实现中必须具体钉住实际canonical调用，不能假设现有fswatch可观察所有操作。

read→确认前→批准后commit前分别检查owner、快照失效、resource身份/rawbytes/归一动作、目标仍非builtin；最后一次校验到同步commit之间不能await。update/remove必须exact revision匹配本actor当前可写快照；其它socket拿到同字串无权使用。import复核dup/ID/name/预定目标并exclusive创建；互不覆盖兄弟文档。

必须实际测试canonical A→B→A、同内容换inode/rename替换、删除再建、stale缓存、观察期间外部变化以及确认内变更拒绝。**边界诚实：**既无事件被观测、又把所有可用内核身份/元数据和字节完全恢复的外部变更，不可能凭当前读数推断历史；不保证检测每一种外部文件ABA，也不宣称面对同用户内核/凭据对手的OS隔离。若root要求该强历史保证，本有限scope做不到，应明确拒绝而非造global框架。

## 5. native确认、生命周期与实际提交

每次写入均经private资源actor（真实registry principal+socket），配置上下文thread_id严格null，非wildcard。四方法不暴露一般tool确认。controller绑定purpose=resource、op/import|update|remove、kind、canonicalID/revision、完整规范化payload、真实文件快照、connection、native当前document及原deadline；摘要不代替exactaction。

现两个host的begin_confirmation只识别desktop.mcp.save，因此需有限新增purpose路由。资源请求携purpose:'resource'并绑定具体在途资源method/request；旧MCP消息/行为保持。controller-only decision增加该purpose闭合分支，拒未知purpose/错误pending；绝不把resource回执交给mcpSave.decide或按“哪个pending存在”猜。renderer methods依旧排除decision。action_json与digest只送private OS controller，不经deliver进入WebView、模型、日志或普通reply。原生显示转义后的kind/动作/名称/完整文本可查看；完整action可滚动查看，不能截断1200字符后宣称批准了全部。

现host已有document generation/epoch和request映射、document/navigation/offline时retire_confirmation；复用该所有权。先删除pending，再关OS控件/触发回调；回执必须同socket/document/generation/epoch、同action及未过期且manager.respondFrom成功，一轮一次。取消、宿主退出、revoke、断线/重连、旧document、payload/资源变化均使effect0（若尚未commit）。postconfirm await返回后在实际mutation现场再次核native current，不只入口核一次。

resource.read另开目标使旧edit快照失效，不能把旧A批准改写B。仅导航到其它页不必回滚已提交A；保捕获A的在途状态，晚ACK只按request/kind/ID/document/page-epoch归属，不能覆盖新视图/草稿。原生确认仍清楚指向A，用户可取消。文档reload/离线必须取消本document未提交动作；已提交未送达只能unknown。

同步写操作设置commit事实，不以UI ACK当落盘。同一在途重复点击同步latch；server busy/当前已知同ID不同payload拒绝。lostACK不自动重放/import第二份，不造跨重启持久幂等承诺；用户先read/list核对，新的明确操作必须重新确认。拒绝/异常释放自己的admission与订阅，不释放继任，不clear其它线程/run的leases。本次自身同步commit后的refresh只淘汰旧revision，不能把已知落盘误标effect0/取消；observer/sink异常不能阻止其它cleanup或替换primary。

## 6. 本批验收与交付

一套renderer→真实HMACchannel→实际SkillEngine→owned FS纵向producer，先RED（现四方法拒绝、UI无入口）后GREEN。两kind正常import/read/reopen，知识update保id/name/filename和未改正文、其它文件不变；remove拒绝保持、批准仅目标消失。builtin/folder、wrongkind/ID、duplicate、坏YAML/原型/重复键、隐藏或截断text、边界cap、halfwrite、create collision、observer/IO故障、cancel/approve/late/current变false且signal未abort、pageABA/资源ABA／旧socket/丢ACK都用真实producer反例。root writer两项原RED必须保留并通过，不凭native页表面绿跳过。

guard在import前禁真实OS/net/provider/native；临时数据与child env严格allowlist，不继承HOME/秘密，不把synthetic批准称真人。共享一次相关host+lockedARM/selectedTS与build，原42及650 unchanged机器只引用，不重复整仓。真实Hosted WinMac用实际controller/键盘→两类导入及再开→知识编辑落盘再开→拒删/批删→断线unknown与清理；both原生、head和精确main门不能用Linux skip替。按用户最新规则，两路相互独立的非作者有效复审即可；不固定模型家族，不要求Grok/DeepSeek或其它指定CLI参加，不加第三、第四路。真实身份/源码版本仍须核实。未达到上述仅conditional，不关闭整体476。
