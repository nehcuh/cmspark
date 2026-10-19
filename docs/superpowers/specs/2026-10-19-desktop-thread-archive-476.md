# #476 原生对话永久归档／恢复合同

GitHub: #476。本合同已获独立合同复核及 root 实施批准；源码复审、机器和精确提交原生 CI 是独立交付门，合同批准不等于源码或原生通过。准确基线 main f756970c8a9d65a39d8b6fcf2be0520a21b49c26/tree8b95652b5ae108c5d1ca860499903dd7efb9139d，实际方法集v6/read7/renderer19/native20。原正文明确对话归档，沿用原Issue和原工作台计划§4，不建新票，不扩Chrome/workspace/PTY/Agent，也不把未合705当交付。

## 1. 一个可用结果及数据寿命

桌面正常对话行有明确“归档”入口；“已归档”视图能列出、按标题或精确ID定位、打开同一历史、明确“恢复”。归档是canonical index可选`archived_at?: string | null`：缺失/null表示未归档，合法非空canonical时间串表示已归档。写archive只设置该字段和原updated_at；restore只清为null并更新updated_at。不迁移、复制、改写messages/attachments，不改变ID/alias/tags/folder/项目/配置/信任/兄弟线程。不新增默认目录、消息、新thread、模型调用或全局generation；已有index未含字段无需批量迁移。

**这不是trash。** 当前trash/restore操纵trashed_at；purgeExpiredTrash默认30天实际unlink消息并removeAttachmentsDir，不能改名复用。归档没有基于年龄的自动删除/恢复，也不设置trashed_at。已有30天回收站只认trashed_at，规则保持；用户明确后续trash/hard-delete仍按原授权和真实提示执行，不把归档变为抵抗显式删除的备份。若归档线程后来进回收站，trash优先隐藏它；从回收站恢复后仍保原archived_at，重新出现在已归档。归档本身及自动empty清理不得删除一个已归档的空对话：现cleanupEmpty需窄排除archived目标；明确选定删除/清理仍属旧显式动作，不新增删除权。继续对话产生的旧消息保留/截断策略原义不变，不能宣称归档绕过所有既有数据保留策略。

## 2. 与旧Web和原桌面功能共存

旧Web/extension/router `thread.list`、listWithPreviews、search/select/open保持当前“所有非trash”语义，**继续包含已归档对话**，能读原历史；不因新增标记从没有恢复UI的Web中消失。Web不新增归档写入口或暗中清标记。其旧list_scope active是既有“非回收站”，不能悄改为“未归档”；标题/普通metadata保存保留新字段。通用thread.update的既有allowlist不加入archived_at，不能通过任意updates修改它。Project.archived_at与Thread.archived_at不同，不混用项目归档。

桌面普通thread.list及已有thread.search只展示未归档非trash；原方法请求schema、64行列表cap、搜索120/limit1..20/default10、脱敏前评分等行为保持。新的归档视图走下列独立只读方法。manager原desktopMetadataSnapshot仍能覆盖全部非trash，供已归档thread的metadata/open准确定位；不能全局过滤掉archived而让恢复、历史或现caller找不到目标。桌面读层按明确视图过滤，旧desktop对话open/metadata仍可读取已归档项。归档是整理状态，不新加禁聊策略或自动restore；用户明确继续原有允许对话时仍归原thread。当前页面/运行目标不会因归档被换成别的thread。

新归档列表只metadata，不读getMessages/digest/body，不调会purge/repair/save的generic list。至少能定位65th及重名标题：沿现redacted标题评分，并允许query恰为canonical安全ID时仅返回该唯一archived项；不得以隐藏title/token内容判断匹配。普通Web搜索评分和现桌面thread.search不改变。

## 3. 精确三方法与有限DTO

复用专用HMAC桌面socket/registry/current principal、主frame/origin/document校验及请求UUID remap；不是generic router forwarding。id为既有非空string、≤200 UTF16；thread_id复用isSafeThreadId（1..64 ASCII安全字符）；revision为exact64hex。无renderer路径、timestamp、expected元数据、approval/user_gesture、config/model/信任字段。unknown/duplicate/escaped duplicate/prototype/nested/coerced键均由现flat parser和精确schema拒绝。

| 方法 | 除type之外的精确请求键 | 结果 |
|---|---|---|
| desktop.archive.list | id；可选query:string≤现120 UTF16 | 未给/空白query列已归档非trash；有query按上述metadata标题/精确ID。最多原rail64项，truncated诚实；不新cursor/global scan/cache/任意limit。 |
| desktop.archive.state | id,thread_id | 退休该actor旧快照，再读canonical目标/活动状态，返回单个当前可归档／恢复快照。目标不存在/回收站/坏元数据也须先退休旧revision。 |
| desktop.archive.set | id,thread_id,revision,archived:boolean | exact当前state/OCC/owner且idle后，设置请求的状态；true归档、false恢复。不是toggle，不重放。 |

list成功只有type=`desktop.archive.list.result`,id,ok:true,threads,truncated；row仅{id,title,updated_at,archived:true}，全部label与时间先按现文本投影脱敏/界限，不给正文、disk路径或wholeThread。state成功只有type,id,thread_id,ok:true,state:{archived:boolean,title,revision,activity:'idle'|'busy'|'unknown'}。读取有效非trash目标每次生成fresh64hex revision（含busy/unknown），最多每actor一个快照；它仅correlator，不是grant。无法核实档案字段/owner/存在性则失败，不把非法日期猜成未归档。

set成功只有type,id,thread_id,ok:true,saved:true,archived:boolean；仅实际持久成功后发送。失败只有type,id,thread_id（目标请求时）,ok:false,error_code及set的saved:false。固定enum：DESKTOP_ARCHIVE_INPUT_INVALID/METHOD_DENIED/STALE/NOT_FOUND/CONFLICT/BUSY/ACTIVITY_UNKNOWN/UNAVAILABLE/SAVE_UNCONFIRMED。无error.message/任意字符串/路径/原始id以外private字段。same-state仍须合法当前快照/owner/OCC/idle，返回当前状态而不重复写/改时间。

只新增这两个read和一个reversible metadata write。当前基线方法集v6→v7/read9/renderer22/native23；controller-only仍只有原confirmation.decision。本叶不引入L2队列、执行或删除批准，不借旧MCP purpose；明确新权限来自launcher重铸method-set，不来自UI。原cap不能升级。两个host、C/Swift bootstrap、固定native消费者和builder同步实数；如基线后来含705，先机械重数再修订版本，不能硬套7。main builder read grammar当前仅两段：仅为这两个固定desktop.archive名称添加有限例外，不能放开任意三段方法。

## 4. OCC、活动、当前性与退休

私有actor每认证socket只持有一个state快照：canonical ID、真实archived_at状态（含缺失/null的原形）、updated_at、必要原index目标身份；renderer只见随机revision。新state、socketclose/revoke/reconnect退休快照；set校验后单次消费，失败也不自动重试。收到schema/owner合格的state先退休旧快照，再验证目标；恶意foreign/malformed请求不能伪装当前owner。无跨restart snapshot恢复、持久token库、全局generation或无限线程map。

复用实际projectThreadActivity及当前run admission/confirmation、LLM、pending工具、ACP offered/startup/live、embed intent、PTY live/closing/pending open和shell的busy/unknown判定；不是新busy布尔或只查LLM。state只读可展示busy/unknown；set前同步复验，非idle拒绝。该probe的真实server注入/current性缺失一律unknown。无await的owner+目标/OCC+活动复核→唯一同步commit区内不能开始新run；不抢占/Stop/恢复焦点/确认别人操作。已打开历史/其它metadata不受读状态动作影响。

native文档退休、切目标、切页、断线不让旧UI携带revision污染新页面。文档退休时复用已有untracked state退休办法：native仍持last owned target与socket时发fresh UUID的state，响应不投任何新document，随后清旧remap；服务端state即使目标已删除仍先退旧snapshot。新文档须fresh state才能set。无需新增retire RPC/权限。若旧set已在退休消息前同步线性化，不能追认“取消未写”，保留unconfirmed并fresh read。没有待模型/确认长operation，也不引新timeout。

## 5. 真实index限制与最小必需持久闭包

现saveIndex629–664整index写，仅merge digest/last_message_at。因此**不能只加字段/setter**：归档前加载的第二manager保存兄弟B会覆盖磁盘A标记。新archived_at必须在原saveIndex读盘合并位置有窄保留规则：普通已有save保存磁盘已存在的archive状态及对应较新updated_at；只有本次唯一私有archive提交携带exact expected→next意图能替换其目标。该提交在同步写前核当前磁盘和canonical target是否仍与state一致；磁盘坏/目标变/新归档冲突拒绝，不把“merge失败仍写内存”套用于新字段。未归档旧行保持缺失或null，不无故批写所有行。与磁盘peer/archive目标有关的updated_at不得倒退，不能凭同进程_lastTs宣称跨进程全局顺序。

实现可复用原target-descriptor rollback和atomicWriteJSON，而非新store/lock框架；失败只还原本目标描述符，不整index回滚覆盖兄弟或已合peer metadata。归档操作本身不写消息/附件。实际write/rename在commit前拒绝必须保原目标内存/盘和兄弟；若无法证明是否已rename、投递失败或随后重读失败，返回SAVE_UNCONFIRMED，fresh read核实，不保证“任何throw都零磁盘变化”。同版本合作manager的field-preservation必须有真实持久反例；旧二进制/手工并发改index不属于可声称原子隔离，观测到冲突拒绝，不宣称完整跨进程CAS或永不inode/文件ABA。

## 6. UI与验收硬门

四类导航沿现样式；对话页增加正常/已归档视图及明确归档/恢复按钮、归档查询/空/截断/错误反馈。操作先state再显式动作set，不能读取state就改盘。捕获真实document、view、target、request与selection epoch；A→B→A、view切换、query/clear、offline/reconnect、新文档、旧success/error均不得覆盖当前行/草稿。丢ACK不显示已恢复/已归档、不自动重放；重新列出/state才知事实。原chat/resource/metadata草稿、Stop与确认闭包保留。文本只textContent；无自动批准、导航、默认配置或Browser展示。

永久真实producer先RED再修：实际HMAC/channel→同canonical manager→真实renderer归档/恢复/重载；A+B、消息+附件哈希、所有非归档元数据及兄弟不变；空归档不被cleanupEmpty删，旧30天trash仍按原规则删只trashed目标；archive+trash/restore优先关系；Web list/select/update保持可访问和不清标记；两个真实manager旧快照写B不丢A归档/恢复及时间；state/set OCC/ABA/owner/busy/unknown/断线/late/lostACK；坏index/读写/rename故障与secret/redaction/严格schema。normal和archive各65条及重名/精确ID能恢复目标，不用fixture自造后端回执。

作者冻结后两位真正非作者、唯一受影响locked ARM与相关host/semantic；不得把Node DOM当原生。Hosted Win/Mac实际键盘归档→切已归档→重开原历史→恢复及失败/断线/cleanup必须通过；原安全/原45s等现case预算不加，不扩CI列表或跳过红。当前705红仍独立保留，本叶不承诺whole476完成、也无#571式Gap替代条款。版本0.6.14开发/Unreleased，不发版或改默认安装。
