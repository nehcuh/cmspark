# 已固定 Windows GUI exe 的显式漂移检查与重新批准

GitHub: [#689](https://github.com/nehcuh/cmspark/issues/689), parent [#70](https://github.com/nehcuh/cmspark/issues/70)

状态：**合同 R2 已获 root 正式非作者批准，当前实现待完整源码/机器/独立/模型/原生与 CI 门禁；尚未发布。** 本票先于本 spec/plan 创建。依据 current main08e142b70b3d2d387de697ad3ed7104189c3a138/tree42e3623ec81e4e99decf0530063f02bc46e42c45，并投影已审 Apps33 tree51e1f000616ada848241eb26cca14170c0e65962 的 #686 主体/模板接口；后者是已审源码依赖，不伪称已经 main 交付。

## 1. 首片与原决策的关系

用户显式选择一个**已经登记、已有合法 SHA256 pin 的 Windows GUI exe**，检查当前文件，核对旧 pin/本次新测 hash；检测到变化后条目持久处于 manual 悬置，只有独立 D2（原 requireAppsBiometric，Hello 或原手输 nonce）后才采用同一主体的新 hash 并恢复明确展示的策略。材料/普通 L2/原线程信任均不能替代 D2。

此片是原 #70 drift 需求的有限能力，不是全局监控：仅新增 owner 的显式 Check/Reapprove。**旧 coordinate assertExeNotDrifted 仍在原调用点硬拒 APP_EXE_DRIFT，不据此虚构 L0 每次启动 hash 或全局自动降级已经实现。** 该既有拒绝不自动写本片持久态；用户随后 Check 才建立持久 manual 悬置。原父要求中的全部检测触发点/全部 signer 变化仍不在本片交付声明内。这是需要批准的明确首片限制，不能用“已更新 pin”关闭父70。

只处理 kind=gui、win.app token、唯一 exe 身份；不处理 CLI、AUMID、bundleId、多身份/cli_manifest、无 pin 或非64hex pin。不创建首次 pin，不扫描 apps 全表，不创建新 grant、generation/tombstone、后台计时器、模型工具、MCP 出口或自动重试。既有 L0/LOLBIN/vault/auto-cap、模板 L2/危险 D2、nonce origin 与原尝试上限保持。

## 2. 明确的 owner 状态机

`apps.drift_status` 只读取已登记配置的 pin 和有限漂移记录，不打开 exe、不测 hash/签名、不创建目录或修改配置。返回不能说明磁盘现在仍未改变。UI 将 observed hash 标为“上次检查值，批准前会重新检查”，不是“持续监测”。只有 owner 按钮触发 Check 和 Reapprove；不在 apps.list、页面 render、模型循环或恢复启动时隐式测量/接受新值。

### 新持久字段（待批准）

AppEntry 可选 `binary_drift`，严格只允许以下6键：

```
{ schema_version: 1,
  status: "suspended" | "invalidated",
  approved_sha256: lowercase64hex,
  observed_sha256: lowercase64hex,
  restore_policy: "manual" | "ai" | "auto",
  subject_digest: lowercase64hex }
```

record 存在时 policy 必须 manual；approved_sha256 必须等于 entry.exe.sha256 的小写规范值。record 不保存路径、句柄、nonce、确认ID、人员、任意文本/错误、历史列表或时间序列。subject_digest 是悬置提交后的有限 App 主体投影的 SHA256：global apps.enabled、token/kind/source/display_name/added_at/policy/enabled、exe path/pin/signer/user_writable_dir、aumid/bundleId/coordinateAllowed/templates/cli_manifest；不包括 binary_drift 本身和 UIA/运行提示。它不是授权、挑战或新 generation。结构校验与合法主体过期必须分开：未知 schema/字段、类型/枚举/hex错误、record存在而policy不是manual、approved_sha256与当前合法pin不一致，属于 APP_DRIFT_STATE_INVALID，沿现有invalid-entry failclosed路径拒绝/禁用；status不丢record、不修复、Check/Reapprove不测量/不写。只有六键结构合法且policy/pin一致时，subject_digest不匹配才是合法的过期恢复意图，显示review_again，不能当schema损坏、自动删record或自动恢复策略。

1. 无 record、Check 测得与 pin 相同：返回本次 `matches_pin`，不改 policy/pin，也不新增持久记录。readonly status 后仍只能说 `not_checked`（磁盘当前未知），不把上次成功变成实时健康承诺。
2. 无 record、Check 确认不同：保存原 policy 为 restore_policy，保留原 exe pin；同一次同步 current-map 提交设 policy=manual、记录两 hash 和提交后 subject_digest、status=suspended。清除该 token 原 app-launch 与 computer session trust。不会自动发 D2 或采用 hash。
3. 已 suspended，再 Check：必须原 subject_digest 与当前主体仍一致；更新上次观察 hash，但保留首次 restore_policy/approved pin。两次 owner check 若并发，后者遇状态事件改变即 stale，不用旧 map 覆盖。若磁盘回到旧 pin，也保持 suspended；**不自动恢复**，D2 可以明确批准“同原 pin、恢复该策略”。
4. record 已 invalidated 或主体 digest 不符：不使用其旧 restore_policy。只允许再显式 Check；从**当前**策略重新建立恢复意图（正常为 manual）。若已有记录，即使当前 hash 恰好等于 pin，重新 Check 也建立新的 suspended/manual 意图；不会从 invalidated 记录复活原 auto。无隐式回滚。
5. Reapprove 已确认提交成功：只在当前 suspended+digest 匹配下采用刚重新核验的新 hash，恢复 UI/D2 明确展示的原 restore_policy，删除 record。校验/D2/文件/cap等在writer调用之前拒绝时，本请求不发起提交，不回滚其它当前修改；其原manual/pin/record由本请求保持不变。**一旦调用replaceAppsEntries，异常或ACK丢失不代表没有提交**，必须按§7的unknown+fresh status处理；禁止无条件声称“失败后仍旧manual/pin”。D2已明确授权的提交可能成功但通知失败，此时不盲回滚或自动重发。

### 初始失败、已悬置失败和可用性矩阵（R2）

本片选择**不新增“缺少观察hash的failclosed悬置态”**。无record的初始Check必须整次measurement成功后才可能写：读/签名探测/严格wire/预算/身份失败均返回measurement失败，本请求没有调用writer，不创建record、不改变pin/policy。若此前是auto/noRecord，它仍是该auto/noRecord，不能声称已经manual或已检测全部漂移。原coordinate硬拒/L0既有行为保持准确；UI说明“检查失败，未建立悬置，请勿据此信任当前文件”。若整次测量有效但不满足本片签名支持条件，也同样不产生首次写入；不在编码时补出第五种状态。

已有结构合法manual record时，后续measurement/D2的提交前失败不改变该manual record。状态或配置可能被其它owner动作更改，错误响应不声称能冻结全局当前map；应取fresh status显示实际状态。正常失败与未知提交结果严格区分。

| 加载/状态 | readonly status | Check | Reapprove |
|---|---|---|---|
| 无record/合法支持pin/全局及条目enabled | not_checked；不宣称磁盘相同 | 可明确测量；首次失败不写且原policy保持 | 无悬置，拒绝，先Check |
| record结构/pin/policy不合法 | APP_DRIFT_STATE_INVALID，保留原件，不自动修复 | 拒绝，0测量/0写 | 拒绝，0D2/0写 |
| 结构合法suspended，digest相符，enabled | suspended，上次观察值 | 可重查，原恢复意图保持；失败无本请求提交 | 可新D2和最终复查；writer异常按unknown |
| 合法invalidated，或合法suspended但digest不符，enabled | review_again；record不被readonly改写 | 重新明确测量后只从当前manual建立新意图，不读旧restore_policy | 当前请求拒绝；持久invalidated绝不因digest又相等复活旧意图 |
| globaloff或entrydisabled（无论有无record） | 有record显示review_again，无record仍not_checked；沿现有Apps可用性UI标disabled | 固定APP_DRIFT_DISABLED，0测量/0写 | 同样拒绝，0D2/0写 |

managed set_enabled(false)即使重启前后都必须持久invalidated，enable(true)不清它。显式set_policy(manual)也同样持久废止旧恢复意图。受管理的global开关/主体写入口应在其自己的当前map提交里使记录invalidated；本片不全局改writer。当前global kill-switch的真实owner直接config文件编辑仍属既有opt-in边界：readonly观察off不暗中写配置；离线人工off→on或相同值文件ABA不被声称可追溯。当前off绝不允许检查/采用，合法digest变化一律review_again；不能拿本片冒充抵抗真实owner改文件的新权限系统。

只要本进程的owner请求实际看到subject不匹配，其请求-local stale latch永久stale，值回原样也不能继续。持久record已invalidated在重启后仍如此。合法digest不匹配本身不触发静默持久repair，新的Check是显式owner动作，最终写入时必须用当前manual重新建意图。当前策略为非manual且有record不是“意图变旧”而是结构非法，不以旧auto恢复它。

### 用户操作如何废止旧恢复意图

新 record 必须加入现有 grantSubject（因而 addSubject）、guiTemplateSubject 和本请求的 configEvents stale latch。只是新增字段而不改这些投影是不安全的；实际旧代码反例已证明它会被忽略。

- 存在 record（suspended 或 invalidated）时 set_policy(auto/ai) 在原 same-policy/gate 分支之前拒 `APP_DRIFT_REAPPROVAL_REQUIRED`。显式 set_policy(manual) 即使当前已经 manual，也将 record 标 invalidated，保留 manual，表示用户选择了当前手工策略；后来的重试/重启不能回滚为旧 auto。
- set_enabled(false) 仍允许并清原 trust，同时 record→invalidated；随后 enable(true) 不恢复策略/旧恢复意图。两次写都使 pending reapproval/旧 grant stale。
- 存在 record 时 set_coordinate_allowed(true) 在原 already-enabled no-op 与 D2 之前拒；清 false 仍允许并 invalidate record。原被清位不会被 reapproval补回。新流程从不设置 coordinateAllowed。
- 修改路径、pin、signer、kind、身份、templates、策略、全局开关等任何被投影 authority 变化，受管理写入口必须先保留 manual 并使已有记录 invalidated，或删除该 entry；不得静默去掉记录恢复权限。remove 仍直接删除，不能由晚回执重建。apps.list/preset materialization/add 当前-map 合并继续保留该字段，不重放旧快照。只改 sibling 不使本主体 stale，最后必须合并最新 map 保留 sibling。
- 已在等待的旧 set_policy/add/coordinate/template 请求，看到 drift 字段变化必须永久 stale；A→B→A 不能复活。最后复查当前配置也要捕获没有 event 的文件 reload。主机内真实 owner 直接编辑 config.json 的既有 opt-in 边界不改成抵抗同 owner 的防篡改系统；不承诺进程未运行时相同值的人工文件 ABA 可追溯。
- 重启后结构合法的record均保留加载；invalidated或合法digest不匹配显示review_again，不当结构坏数据丢弃。只有suspended+manual+当前subject_digest匹配才允许再次明确发起D2；invalidated不能恢复原policy。没有恢复后台任务或可复用审批回执。旧产品降级不被声称理解新状态；不因此修改旧版本或发明迁移框架。真实owner直接更换exe/pin的既有config opt-in不是本流程；若遗留record与新pin不一致，按invalid-entry拒绝，不能以旧恢复意图补救。

Trust clear 是显式结果，不能捕获失败后仍报告“清理成功”。Check在manual持久悬置后调用现有两个 token-local clearer；失败返回固定管理错误、保留manual和旧pin。Reapprove在最终同步提交**之前**严格清除这两个trust，再核同主体/文件后才采用pin和恢复策略，失败不提交；不得把原吞错clear wrapper当成功。实际 l2-admission.ts:930附近已明确 manual 从不查询 app-launch thread trust，因此清理失败的悬置仍保持原 manual 确认，不需要新L2架构或L0 hash。坐标路径原APP_EXE_DRIFT及结构门仍先于实际注入，不能靠session trust绕过。该证明须进focused控。

## 3. 三个有限管理消息（待批准）

沿用现有已鉴权 Apps 管理 WS、family=apps 响应与 owner UI；绝不放进 LLM tools/Pack/MCP。validator+router+extension转发须三处齐备，类型/键严格拒绝；除既有传输 type/id 外不接收未知业务键。token 使用既有 APP_TOKEN_PATTERN，hash 仅64hex并按服务端小写规范比较。

- `apps.drift_status {token}`：返回有限 `status: unsupported|not_checked|suspended|review_again`、registered_sha256、可选 last_observed_sha256/restore_policy。无 pin/非本范围只 unsupported；不回显文件路径/正文/错误/nonce。UI 不能将 readonly status 自动升级为 Check。
- `apps.check_drift {token}`：显式 owner 动作，服务端从当前 entry 选择唯一 exe，不接受 path/hash/policy。返回有限当次状态和服务端测得的 old/current hash，若悬置还显示 restore_policy；不执行 exe、不批准它。
- `apps.reapprove {token, expected_old_sha256, expected_observed_sha256}`：两个 hash 只是用户已经见到的意图回显，**不是权限凭证**。服务端仍独立测量并比对；变化要求重新 Check/展示后再来，不自动接受最新值。不能提交 restore_policy、signer、路径、state、grant或审批结果。

管理结果可使用已有 error family，新增有限 code 候选（R2额外明确APP_DRIFT_STATE_INVALID、APP_DRIFT_DISABLED、APP_DRIFT_COMMIT_UNCERTAIN）：APP_DRIFT_UNSUPPORTED、APP_DRIFT_MEASUREMENT_FAILED、APP_DRIFT_CHANGED_AGAIN、APP_DRIFT_REAPPROVAL_REQUIRED、APP_DRIFT_REVIEW_STALE、APP_DRIFT_SIGNER_UNSUPPORTED、APP_DRIFT_POLICY_CAP。原 BIOMETRIC_DENIED/APP_GRANT_STALE 按已有语义复用。它们不进入 browser tool-loop registry或改变 APP_EXE_DRIFT 等级。

## 4. 测量与签名能力的窄边界

每个 Check/Reapprove 仅测当前登记的一个 exe。新待批预算：单次完整 measurement **15,000ms 绝对预算，最多256MiB，64KiB streaming chunk**，无缓存/续期/重试。签名 probe 与 hash/身份复查共享该 measurement 的剩余预算；不能每 await 重置15s。D2用原 manager 生命周期，本片不增加/延长其审批期限；D2前后是两次明确测量，不能称整个交互只花15s。

只允许既有 Windows drive-absolute canonical .exe，本片采用 max259字符的有限 profile；不扩展环境变量、不 trim/替换、不支持 UNC/网络/mapped drive、device/ADS、相对路径、多身份。Win32本机 locality/reparse 元数据可复用既有 argv-only runner/固定只读脚本能力；若需单独 `apps-drift-files.ps1` 只做 GetDriveType+逐组件reparse判定，不能 exec/读取任意第二文件/枚举进程或输出原始机器状态。Node canonical realpath、叶/路径链身份和 fstat 使用 bigint dev/ino/nlink/size/ns时间字段，不把64bit ID转Number。打开前后/持句柄读前后/返回前检查相同主体与 regular/nlink1/nonreparse；先查 size 超限再读，EOF/累计字节/当前 size 不符均拒。

复用现有 apps-signer.ps1 的只读真实 Authenticode probe，但不沿用 probeSigner丢失 status 的模糊结果。严格有限解析 signer/status wire（≤4096UTF8 bytes，Subject≤2048字符），只接受 actual Valid+同一已登记 Subject，或原无 signer且 actual NotSigned+空 Subject；错误/超时/HashMismatch/UnknownError/其它 status、Subject变化均拒。初始无record的Check此时不写也不伪报manual；已经有manual悬置的提交前失败才保留该悬置。不能拿旧 signer 字符串给新 exe 计算 auto cap。重新计算现有 user-writable/structural/policy cap，并将测量前后当前文件身份/hash与 signer probe 的对象绑定。Reapprove若fresh cap低于保存restore_policy，保持已有manual并明确拒绝，不能静默恢复更高策略；Check从不恢复策略，不把这种恢复cap比较变成未定义的首次写入。

**签名支持声明仅为旧 Subject粒度上的一致性/现有 cap复查。** 不新增证书thumbprint/链/撤销协议，不承诺同Subject换证书或所有 signer drift被检测，不为签名变化开放采用流程。此类结果可显示“签名身份/状态变化，本片不支持重新采用”；已有悬置保留manual，初始无record的失败保持原策略且明确未建立悬置，走后续明确owner决策。实际 Windows签名语义需 hosted fixture证明；Node seam不是 Authenticode证明。

最后一次 hash/metadata/签名测量之后，立即进行 request owner/config subject/caps/文件 snapshot同步 recheck，随后同步 replaceAppsEntries；中间禁止 import、probe、await。这是现有同 owner TOCTOU边界下的有限窗口防护，不宣称对已执行恶意同用户进程提供内核不可变文件锁。失败返回有限错误，不带路径/正文或native原始错误。

## 5. D2与连接生命周期

UI明确显示 app标识、原pin、当次观察hash、要恢复的策略与“不会扩大模板profile”。调用原 requireAppsBiometric(action=apps.reapprove)；Hello cancelled硬拒，不走nonce；只有 unavailable使用原 originWs manager nonce，仍保 wrongsocket/wrongcode/原lockout。基础平台不符拒本片，不能因 helper在Linux可nonce就开放其它平台。

在首 await 前捕获不可变 entry/state主体并安装既有 request-local configEvents stale latch。新管理请求还必须获得由ws/lifecycle对**实际 originating authenticated socket**闭合的内部 ownerCurrent：OPEN、原 wsAuth对象仍相同且 authenticated。它不是renderer参数，也不默认为true；缺少则新操作failclosed。close/失鉴权/换认证状态、subject变更、请求取消后不能写。nonce origin本身不能覆盖 Hello成功后socket已断的情形。每个await前后、D2返回、最终persist前都核；finally释放 listener/stream/fd。并发批准只一份能提交，其它因 record/pin变化stale；不建全局 pending map或新epoch。

## 6. 与#686的不可混淆边界

record参与 guiTemplateSubject，建立悬置或采用pin均使旧模板 receipt永久失效。新pin批准只同意登记该指纹并恢复其既有有限策略，**不批准任何新版模板解析器**。GUI_TEMPLATE_PROFILE、固定NPP版本/bytes/SHA、四固定flags、profile/locality/XML/最终metadata、每次freshL2、dangerous额外D2以及private single-use receipt均完全保留。当前非固定NPP新hash即使D2采用也仍不能通过#686 prepareGuiTemplateFiles；不修改该常量或把它换成 entry pin。

UI成功文案：“新指纹已登记；应用策略已按确认恢复。文件模板仍受已支持版本/profile限制。” unsupported-template/profile继续使用原严格错误，不能以“已重新批准”解释为模板可执行、文件已经打开或父70完成。本片不改#688的fixedprofile源码与验收值。

## 7. 持久与审计

使用现有config atomic writer和configEvents，不建第二文件/数据库，不改global writer。最终write用当前map，只替换目标entry；sibling新增/删除/修改保留。禁用/失效记录不被normalization/list/preset丢弃。

**实际writer语义已亲证，R1旧承诺撤销：**replaceAppsEntries先atomicWriteJSON，再设置cachedConfig，再emit。真实postcommit listener throw会使调用者收到异常，但disk/cache已经是已批准新pin/恢复策略；普通prewrite失败则可仍为旧manual/pin。不能只凭异常把这两类归成failed-no-change，也不能尝试恢复捕获的旧map。

- writer调用前的本请求验证/measurement/D2拒绝：明确未尝试提交，返回原有限原因；不声称其它并发owner没有改状态。
- writer自然返回：已提交；只有此分支可主动给成功管理回执/新audit。其后WS ACK丢失只使客户端不知道结果，不撤销合法提交。
- writer抛错或调用后通信丢失：返回/展示APP_DRIFT_COMMIT_UNCERTAIN（若通信可用），有限outcome=unknown；不声称“失败且未写”、不自动清record/回滚/重试/复用旧审批。handler可在catch做一次只读current status尝试，读取失败仍unknown，不能以返回旧快照代替真实状态。
- owner显式刷新apps.drift_status/apps.list取得当前server map与有限状态。若显示新pin/noRecord/恢复策略，只说明当前已登记状态；不凭数值推断一定是某个丢ACK请求提交。若仍旧manual/record也不自动重发；owner重新核对后按当前状态发起新的Check/Reapprove，每次重新D2，不保存可复用审批凭证。条目已移除/替换/sibling变化必须原样保留。

unknown是临时管理回执/客户端不确定性，不是第七个持久record字段，不建通用事务/idempotency服务。真实writer prewrite抛、postcommit emit抛、正常提交后人为丢ACK三类必须用完整actual函数+owned disk控覆盖。新audit若未发出也不能倒推出未提交；若某处通知失败，不在catch伪造“denied但没写”。不记录raw异常/路径。

新增有限 audit：apps.binary_drift（explicit_check、old/newsha、from_policy、to=manual）、apps.binary_reapproved（old/newsha、restore_policy、method）、apps.binary_reapproval_denied（固定reason）。App token是既有应用标识，不是security_token。新事件不记路径、参数/文件正文、nonce、rawerror、签名原始对象或完整配置。沿用原gate审计，不用本合同虚称整个既有logger已不记录任何旧字段。

## 8. 验收与批准前的停止点

root 已正式审批本 R2 的新增状态/键/消息/范围和预算；该合同批准不替代实现门禁。现有2×12与额外19条旧路径控制只是证明当前缺口与兼容接线风险，**不是尚未写的新状态机已通过**。

实现时实际producer先RED再修：real schema/router/handler/UI链、旧pinA→owned新字节B→Check悬置→明确D2→最终同B采用/恢复；samepin恢复仍D2；新文件C拒；无pin/签名变更/overflow/timeout/partialread/reparse/identity替换拒；6种持久状态不合法拒。特别覆盖旧set_policy auto/ai/samemanual、enabled ABA、coordinate existingtrue/pendingtrue、add/list/preset/currentmap、已有template receipt、config mutable alias、subject A→B→A、多并发、socket断开/错误socket/Hello cancel/unavailable nonce、writer prewrite/postcommit throw、丢ACK unknown+fresh status和cleartrust失败。

每次 measurement绝对15s/256MiB边界/最后afterawait deadline复查均实际负控，不能用fake时钟绿称native。host/lockedARM共享组机器、真正非作者、完整既有Kimi+配置Claude（实际glm5.3、no--model）、必要hostedWindows realFS/签名helper/schema/normal App管理链与真实文件身份门禁，精确head全4CI→授权合→精确main全4/实际子票关闭。软件Hello/manager controls不称物理Hello/真人输入；需准确保留实际未运行事实，不把硬件缺失当软件编码永久外阻。父70仍部分，不扩大到全signaturedrift/首pin/gallery/CLI/所有模板版本。
