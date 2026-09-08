I'll read only the packet file and follow its review instructions independently.The packet is a read-only design gate. I’ll check the claimed current code and protocol against the repo, then score the scoped design.The packet claims a few protocol facts I need to verify in the current ThreadList, router allowlist, and save/correlation path.Some claimed gaps already exist in tree. I’ll check ThreadList, save correlation, digest extract, and the topbar layout against the packet.Independent design gate **#473**. Read only the packet; did not read other reviewer reports. Evidence is **[inspected]** (source + tests in-tree; no commands, no live data).

The scoped design is the right product: one ThreadList, derived AI view, `user_tags` ≠ digest, save waits for persisted `thread.updated`. A few implementation choices currently violate that contract and the 320 layout claim.

---

### P0
None.

### P1
1. **关系图把人工标签写进 `digest.tags`。** `openThreadGraph` 用 `threadTags()`（`user_tags` ∪ digest）填 slim `digest.tags`。这直接违反「AI 分组只读 AI 标签、不把人工标签伪装成 AI」。Companion `related.ts` 用两类标签做共现可以，但图载荷不能冒充 digest。图谱入口恢复时必须只传 `digest.tags`（或另开 `user_tags` 字段）。
2. **320 顶栏没有保底行序。** 设计要求窄屏常驻「+」和「对话管理」四字，标题可缩，风险/停止不被遮。现状：`.cm-header-new` + 四字触发器都在 `flexShrink: 0` 的 cluster 里，`max-width:759` 才 `flex-wrap`。320 上几乎必然 2–3 行；cruise 在 DOM 里排在 cluster 之后，停止在 composer。必须在 320 / 320 短屏量出来：cruise 仍可见、停止不被顶栏/管理面板盖住；不能只靠 wrap。

### MAJOR
1. **可见名 ≠ 可访问名。** 触发器可见「对话管理」，`aria-label` 仍是「历史对话」（面板仍是「历史对话列表」）。兼容旧入口合理，但 WCAG 2.5.3 Label in Name 失败；语音控制说「对话管理」打不中。建议 `aria-label="对话管理"` 或 `"对话管理，历史对话"`，测试跟着改。
2. **AI 分组「待 AI 整理」不置底。** `renderTopicsView(ai)` 只把「未分组」排最后。「待 AI 整理」会按拼音插在组中间，空态文案也不出现。应与手动分组同一规则。
3. **主行动名容易和 AI 分组搅在一起。** 设计要的是「AI 提取」；实现是「AI 整理标签」。整理助手本身没标成智能分组，但这颗按钮会。改回「AI 提取」/「为未标注提取要点」。

### NIT
- ⋯ 里仍留提取/整理/图谱/回收站，和顶排重复；起名/清理留在 ⋯ 符合设计。
- 首个 `digest.tags[]` 当组名：重提取会换组。帮助行已说明是派生视图，可接受。
- 保存 15s 超时后迟到的 `thread.updated` 仍会 UPSERT，UI 已报失败。文案已提示检查连接，可接受。
- 管理面板内「+ 新建」不是宽屏主入口，可留。

---

### 设计对照（站得住）
- **范围：** T2 元数据/UI。`user_tags` 只进 `thread.update` allowlist，不改权限默认值；后台提取仍要 `thread_digest_enabled`（设置里默认关），无新默认任务。
- **AI 分组：** `aiThreadGroup()` 只用 `digest.tags` 首个非空标签；无标签 →「待 AI 整理」；不写 `topic_folder`。提取 `update({ digest })` 不动根字段；`thread-digest.test.ts` 已钉 reload 后 `user_tags`/`topic_folder` 仍在。
- **人工标签：** 独立字段，≤20 × 40，去控制符/NFC/空白/大小写去重；表单只提交 `user_tags` + `topic_folder`。
- **保存：** lifecycle 回显 `id`（`lifecycle.ts:1472`）；SW 已转发 `id`（`background/index.ts:994`）；编辑器等匹配的 `thread.updated`/`error`，ACK `{ok:true}` 不算成功。`thread-management.test.ts` 覆盖该契约。
- **入口：** 窄屏 `+`（`aria-label="新对话"`，`createBlankThread`，≥760 隐藏）；宽屏左导航创建；`cmspark:open-thread-manager` 打开同一 ThreadList；无第二套线程缓存。一对一 `topic_folder`，不做批量移动/全局改名。

Packet 里的 CURRENT 片段已落后于工作区（`user_tags`、编辑表单、id 转发、管理入口都已在树上）。按现树门禁，不是按过期 snippet。

---

**VERDICT: APPROVE_WITH_NITS**

设计本身可落地，不要扩成标签平台。合并前必须修 P1-1（图谱不得把 `user_tags` 写进 `digest.tags`），并在 320 / 320 短屏实证 P1-2。MAJOR 建议同一 PR 收掉。
