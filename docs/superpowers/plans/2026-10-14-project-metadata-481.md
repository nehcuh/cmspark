# #641 / #481 Project 元数据纵向实现计划

> GitHub: #641；Parent: #481
> 日期：2026-10-14；base main `5cafdf5604a7456b56c3d11578f4afdd9787c164`
> 分支：`codex/project-metadata-481`
> 状态：root 非作者合同已批准实现；产品与作者 focused/两端合成 UI/双 build 已通过，source 冻结等待非作者、完整模型、fresh ARM 与 CI gates。
> 合同：[spec](../specs/2026-10-14-project-metadata-481.md)。

## 0. Issue-first 与非回归范围

先按 `.github/ISSUE_TEMPLATE/design.md` 创建 #641，再写这两个文档；原body/comments与newissue确认JSON/sequence/hash保存在私有tracker外部receipt。新增#641单独计库存，不把“原53票”分母加1或假关#481。旧481人工分类、483owner、484boundedrichUIcache、522人工CLI入口、432PTY等已交付保持，不重做其已完成波。

## 1. 现有 source事实与接点

| 当前实际源码 | 复用/最小改动边界 |
|---|---|
| `threads/thread-manager.ts`模型/create/get/list/update/index + `sidepanel/types.ts` | 消息owner/index保留；通过ProjectStore做optionalproject_id投影，关联不双写index。原thread创建/alias/trash/mcp/资源/权限保持，ordinarychat无项目强制。 |
| `io.ts:atomicWriteJSON` | 同目录原子替换可复用；新ProjectStore负责freshread/OCC/ownedlock/stagedcopy，不能把rename当整个并发合同。 |
| `message-router.ts`现thread.create/update/list/select与`listLlmActiveThreadIds` | 增加窄组织service dispatch、公共projection与runtimebusyinjection；不把project写入现genericthread.update whitelist，不修改审批/执行policy。 |
| `ws/validate.ts` / `ws/summoner-acl.ts` / `ws/lifecycle.ts` | 严格schema/metadata allowlist新增确切六方法；HTTP/WS同service、nonce/origin/auth保持。current unbound SecurityConfirmationManager必须保守pending拒绝，非凭不存在thread API猜idle。 |
| `security-confirmation.ts:pendingCount/hasPendingForWorker` | 复用已有boolean/count probe；仅只读相关适配，不输出prompt/nonce/pixels、不respond/cancel，unattributed不当无pending。 |
| `ws/tool-forward.ts:listPendingToolsForThread`、`acp/manager.ts:listSessionsForThread`、`pty/session.ts:isPtyBusy`、`pty/handler.ts:pendingOpen`、`acp/open-local-terminal.ts:peekEmbedIntent` | 聚合authoritative active/pending/closing/startup/intent状态；需要小booleanprobe时只读新增。actual embed intentTTL10min，与taskcommand60sec不同；均不延长或销毁。probe配置缺失拒写。 |
| `summoner-web.ts`已auth API/dispatchAllowed / `summoner/thread-management.ts` | 独立Project薄adapter+UI保留已有tags/folder/edit回执。不是复制Threadstore、不是开放全局config。 |
| `WorkspaceFrame` / `ThreadList` / metadataeditor / `utils/thread-management` / sharedstore | 独立Project组织区域/selector和draft，其保存只能actualserverack。沿用owner路由，不将currentProject引入stop/prompt/apply身份判定。 |
| existing source `project-dir.ts`/workspacebind | 本批不调用mkdir/目录picker/绑定；existing工具名含project不代表Projectmodel，不可依赖它冒充实体。 |

## 2. root 审核合同后的一条纵向批

1. **先失败场景**：存储actualpayload+单ownerprojection、createoperationrestart、两writerOCC、failedcommit和oldThreadincarnation；busyproducer/unknown/迟到、严格HTTP+WSschema/ACL；用原tempfixture机制隔离data，不改liveconfig。
2. **实现 metadata owner/service**：新 `threads/project-store.ts` 与小project DTO/handler；fixedfile规范store、revision、createopprovenance、唯一关联，readonlyprojection/diagnostic。schema预算和lock故障保持failclosed。一个file存Project+membership，不造第二message仓库。
3. **接线actualauth传输/runtime**：六metadata方法+sharedservice；runtimebusy有production接线以及真实adaptertests。server从currentThread/Project/活动事实校验，跨await失效反例不要只写unitmock；commitcriticalsection无await。legacytags/group与sensitivekeys负例保留。
4. **两端可用UI**：同公共Project/revision DTO，name-only创建、项目外、新对话两步关联的诚实失败、显式移入/出、rename/archive/restore/search；fixedsubmit identity/owner回执/drafts。strictbusy/nonexistent/archived/conflict/unknown恢复，不能展示空壳Project支持。
5. **focused生产验收+freeze**：actualbackendtempdir save/restart↔两端实际组件/HTML；宽窄短屏/键盘/失败/lateowner。记录真实RED与修复，不把setuperror当产品RED。sha/full.diff完整固定public sources与machine logs。
6. **共享门禁**：同批一轮appropriatehost test/build+freshlockedLinuxARM，非作者独立对抗，完整实际Kimi与root指定/用户允许的最终judge（工作日不Pi），original#481指定Grok/DeepSeek身份准确；increment仅受影响，不逐控件重整仓。
7. **PR与主分支**：全部gates实际approve才stage显式sources/commit/push/createPR并attach；完成#641可Closes641，#481按originalDoD复核无假关；exacthead所有CIjobs绿后用户已授权merge，babysit exactmain全部jobs、记录realclosure与original53/新增inventory。

## 3. focused场景与失败凭据

| 真producer场景 | 必须观察到的结果/反向控制 |
|---|---|
| create(name-only) / lostack / restart replay | 实际serverUUID对象；同operation samecanonicalname返回同项目、不加revision/不重复对象；sameop differentname固定拒绝；不写个人目录、不spawn/confirm。 |
| old history + association + reincarnation | 初始无projectfile/read不create；关联后真实重启两端可读；旧messages/tags/folder/workspace bytes保持；harddelete后同ThreadID新created_at不继承旧membership。 |
| two writers / corruptedstore / failwrite | 实际owned exclusive lock/freshrevision，一winner一conflict/busy；rename失败旧disk/oldmemory；invalidstore不覆写/不假空/不丢普通历史；无unboundedretry/未知lock清理。 |
| current busy / pending / unknown | actualLLM/ACPofferedconfirmedrunning/startup/tool/PTYclosing/pendingL2/embedintent/SCMpending任一阻断移入/出；已close且无pending允许；probe缺失拒写；不停止原任务、不consumesecretintent。 |
| archive/rename/restore | archive任一boundbusy全拒，闲时归档保留关联/对话/文件；restore保持；rename运行中不改ID/cwd/session；新归入archived/missing拒；snapshot历史thread/session身份不改。 |
| auth payload | exactkeys/types/bounds、混合project+workspace/config/trust/confirm拒整个包；HTTP+WS同结果；LLM工具catalog无新项目mutation；summoner只窄六metadata方法。 |
| real UI/HTML | actualpersistedfields/operation/revision才saved；transportACK/错thread/错project/错op/late/timeout保持draft或显示unknown；A→B→A不抢代码目标，keyboard/320/390/759/760/420/480可达，screenshot仅佐证。 |

合同中 cap256Project/8192association/4MiB、六方法及 store 投影已由 root 明确批准实现；这不是最终源码或模型批准。若独立 review 修改，则保留失败与修正，只补受影响验证并重新冻结，不能默默改变 gate。

## 4. 明确结束边界

产品步骤已按 root 实施授权完成作者验证并冻结交付；尚未完结独立/模型/ARM/CI门禁。无企业T4/真实业务账号/SSO/默认App/DMG/真实AI provider/mic/nativeOS验收要求。futureProject目录建议与resource授权、execution/private descriptor历史生命周期留后续；不以这些独立范围假卡metadata，也不以本票metadata绿假称它们完成。

作者 machine：backend 14 owning + 9 相邻 = 23/23；frontend 5 owning + 11 相邻 = 16/16；实际 ProjectPanel/reducer 与生产 Summoner HTML+认证 HTTP 的合成 Playwright 13/13，明确不是整扩展 HMAC/真人/native/provider 验收；两组件生产 build 与 UI hygiene 通过。完整失败/修正、真实回执、精确 source/diff/hash 交由 root 私有 tracker 留存。新 store 容量与旧会话历史容量不混报。

R1 独立实际生产 DOM/stock selectThread 发现 Summoner A→B→A 后旧新建回执抢回 C，REQUEST_CHANGES 保留，旧机核绿不构成放行。R2 复用已有 selectionRevision 在成功/错误恢复两处绑定提交版本；作者追加实际 React 同事件 batched A→B→A 红证，canonical reducer 仅 distinct SET_ACTIVE_THREAD 推进纯 UI 选择版本，ProjectPanel 绑定该版本并保留最初空 owner 的精确 createdUUID 一次预期切换。没有后端 runtime generation、权限、store/OCC/busy 变更。永久 production callback/actual router 六控制在冻结 R1 UI 上 6/3PASS3FAIL→R2 6/6；R2 affected backend29/29、front17/17、两端 UI14场景、双build 通过。R1 整组机核保留原基准，不冒充 R2 精确批准；R2 新完整 source 冻结等待非作者增量和最终门禁。

**CURRENT: ISSUE641_CREATED → ROOT_CONTRACT_APPROVE_FOR_IMPLEMENTATION → AUTHOR_MACHINE_PASS/SOURCE_FROZEN；NONAUTHOR/MODEL/FRESH_ARM/CI_PENDING；STAGE/COMMIT/PUSH_NONE。**
