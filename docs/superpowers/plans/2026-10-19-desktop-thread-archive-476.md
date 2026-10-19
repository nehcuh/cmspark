# #476 永久归档实施计划

GitHub: #476。对应[归档合同](../specs/2026-10-19-desktop-thread-archive-476.md)；root 已在独立合同复核后批准实施，后续仍需机器、两路非作者及精确提交原生 CI。main f756/tree8b956准确；原归档需求已Issue-first，不新建票。root拟亲接核心源码；作者/协作者不能自批，后续两真实非作者即可，不固定模型家族或增第三票。

1. **先锁真实OLD与边界。** 留存当前canonical ThreadManager、desktop metadata/dialog/channel/read/capabilities/UI及实际HMAC→manager→DOM测试。编写永久回归先证明现native无归档入口；并实际证明简单optional字段方案在两个manager中被旧写覆盖、empty cleanup删除空归档候选。保原RED/原源码，不把模型/手写payload当真实producer；不在本机启动native/browser/Agent/PTY。

2. **root窄改canonical index，不借回收站。** Thread增加optional archived_at，无迁移/自动删除。新纯metadata snapshot支持非trash所有归档状态；新private conditional archive提交核expected tuple、同步活动/current owner、只改archive与updated_at并保原target rollback。原saveIndex仅对该新字段/对应时间补peer-preservation和明确私有write意图；不能只merge缺失值（restore=null也是持久值），不能让旧manager重放原archive。cleanupEmpty排除已归档；purgeExpiredTrash30天、delete、trash/restore、messages/attachment保持旧显式语义。原Web list/search/select/open仍包含全部非trash；thread.update不放新字段，真实普通metadata和消息保存不得清它。检查所有index写者，而不泛重构其它数据。

3. **实现精确actor/channel三方法。** desktop.archive.list/state/set按spec schema、单snapshot64hex OCC、fixed DTO/enum与真实activity probe；state退休发生在target读取前，set同步consume+revalidate+commit。新增两固定read名的builder grammar例外，method-set基线6→7/read9/renderer22/native23，实际launcher/两host/C/Swift/bootstrap/测试消费者逐一同步；若组合基线已变必须重新机械数表，不复写未合705。无generic RPC/delete/新L2/model/执行权限。

4. **UI只补归档可见路径。** 正常列表及现搜索筛未归档；已归档列表/标题及精确ID查询/打开历史/恢复复用现布局和同数据源。native request UUID+document/view/selection/query epoch拒旧回复，文档退休untracked state不投新document；旧set可能已commit要诚实unconfirmed。原聊天与资源/metadata草稿/Stop/确认不变；不自动切thread/发送、关闭运行或变更Web语义。

5. **一组focused验证。** 真实HMAC/manager/DOM与ownedFS覆盖正常A/B归档恢复/持久重开、message+attachment及metadata不变、empty/30天回收站、archive+trash优先关系、Web共存、两manager持久保留、所有坏schema与privacy、target-OCC/current/busy/unknown/late/ABA/lostACK、写前与rename失败回滚及unknown。正常/归档65条和重复标题/精确ID必须可定位。只运行受影响族/必要strict TS，依赖锁和实际source绑定；无本机native，不整仓。所有setup/产品RED保原。

6. **冻结与真实交付。** full before/after/diff、原source/outside modeOID、实际机器/effects/输入SHA，交两真非作者+唯一必要ARM。然后新head Hosted Win/Mac真实键盘归档/恢复/历史/断线及原strict安全门；不以Linux skip/Node DOM/源码批准称原生通过。不改现超时、确认、权限、CI清单或通用活动策略救绿。docs/TESTING/ledger/CHANGELOG只同步实际状态；原705和whole476剩余Chrome/local等不因此完成。root独立决定发布，作者不commit/push/关票。

## 已证源码冲突，实施时必须闭合

- saveIndex629–664是整index快照，当前只merge digest/last_message_at：需要新archive字段的局部持久化意图/peer保留，不能承诺现有OCC已经足够。
- cleanupEmpty823前后只排trashed：要明确不自动删空归档；30天purge只认trashed_at，绝不把永久归档塞进去。
- manager元数据快照被dialog/metadata共用：不能全局只返active而导致归档目标无法open/state/恢复。
- read-method grammar仅二段：只给两个固定archive read名有限例外，不泛改protocol。
- private state doc退休复用已有untracked refresh思想，但必须有真实server旧revision拒绝控制，不能只清前端Map冒后端退休。
