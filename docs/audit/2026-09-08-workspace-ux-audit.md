# 工作空间 UI/UX 源码审计

关联 [#481](https://github.com/nehcuh/cmspark/issues/481)。2026-09-08。
基线 `abd9995b059d0e97a36286028b478416158bdd8a`；下列行号是基线定位，同期 #482/
#483 修复可能已改变工作树，不能用此表重新判定最终提交仍有缺陷。
方法为源码/类型/路由/设计交叉阅读；未做本批真实麦克风时延、安装截图、Windows
原生视觉验收。事实为代码直示，推断为产品判断，未知需运行证明。方案见
[当前计划](../superpowers/plans/2026-09-08-workspace-projects-ux.md)。

## 1. 排序结论

| 优先级/归属 | 事实（仓库相对文件定位） | 推断与验收 |
|---|---|---|
| P1 #483 | `chrome-extension/src/sidepanel/components/FocusBand.tsx:75` 直接取全局 codingSession；`App.tsx:162` 任意新 sessionId 自动开面板；`store/agentStore.tsx:1720` 用前会话字段兜底 | 可解释新对话残留；须修事件合并和显示选择。A→B→A、交错/稀疏事件、停止/diff 目标验收，不能只藏 UI |
| P1 #482 | 用户报告召唤器无反应/插件慢；`companion/src/summoner-web.ts:1712` 含缓冲/时窗，`:1880` 启动链；插件另有 STT 适配层 | 仅源码不能断定窗长是唯一原因。测 capture-ready/partial/final，验证准备/失败/取消可见；实际设备延迟未知 |
| P2 #481 | `summoner-web.ts:813` PATCH 只写 alias；`:1906` 行仅打开/重命名/回收站 | 标签/组确未接入；复用字段与保存回执，精确扩展 payload ACL，不能另存组或假装项目 |
| P2 #481 | `WorkspaceFrame.tsx:52` 资源排在最近对话之前；`ContextPanelHost.tsx:63` “标签”表示 browser tabs | 对话优先、浏览器标签页明确命名；检查键盘/宽窄/短屏并保留整理/图谱 |
| P2 后续项目 | `companion/src/threads/thread-manager.ts:78` workspace_root 在 Thread；`:149` topic_folder 注明 not Project/Pack | 没有 Project 实体；可空 project_id 加独立实体，不能把组当目录/权限 |
| P2 后续资源 | `McpPanel.tsx:49` 线程选择，`:60` 全局服务器开关，`:69` 全局总开关，`:90` 编辑在同一面板 | 区分“用于本对话/全局管理”；错误/待保存就地呈现，不改安全路径 |
| P2 后续设置 | `SettingsPage.tsx:5` 已八分类；`companion/src/settings-web.ts:586` 全局模型页但 `:667` 按钮、`:673` 视觉说明仍英文 | 不泛称设置完全无结构。统一术语/范围/独立保存语义，不能伪装完整管理台 |

## 2. 主要界面、证据与可验收改进

表内 `sidepanel/`、`terminal/`、`cockpit/`、图谱路径均以 `chrome-extension/src/`
为根；明确标为 companion 的文件则以 `companion/src/` 为根。

| 界面 | 事实/可复用部分 | 推断的改进与验收（除注明本批外均后续） |
|---|---|---|
| 主工作区 | `sidepanel/components/WorkspaceFrame.tsx:43` 是既有 store 的最近投影；`StatusRail.tsx:223` 导航，`:236` 标题，`:238` 新建，`:254` ThreadList；`sidepanel/App.tsx:235` 消息、`:239` 资源、`:240` 输入 | 保留中性视觉，只修导航优先级/作用域，不加第二全局任务顶栏。本批测空对话/长标题/离线/新建/200% 等效 reflow，Stop 与输入不被遮挡 |
| 对话管理 | `ThreadList.tsx:1397` 管理，`:1400` 四类视图，`:1543` AI提取/整理/图谱/回收站；`ThreadMetadataEditor.tsx:18` 规范化；`utils/thread-management.ts:13` persisted ACK，`:8` AI组派生 | 端间补齐，不再造缓存。本批测空分类、失败保留、错/迟回执、重载、AI不覆盖人工；不宣称召唤器已具备全部 AI/图谱 |
| 召唤器 | companion `summoner-web.ts:1462` 左栏，`:1496` 窄导航，`:2518` 排序，`:2524` 资源切换；`:260` MCP投影只名字/状态；`:2589` 技能/`:2606` 知识仅挂载本对话 | 导航名称不能暗示全量管理。元数据本批窄扩展，MCP/安装/终端仍按#476。测晚资源响应、线程切换、空/错误态；普通本地聊天不强开Chrome |
| 输入/附件/捕获 | `ComposerDock.tsx:13` 只是容器，输入内部在 App；companion `summoner-web.ts:1529` mic，`:1540` 附近 composer/capture，`:1552` 隐私卡；隐藏旧设置按钮 `:1538` | 改容器不能证明全部输入流程已修。听写/附件固定草稿目标，取消/隐藏释放资源；不得增加看似可用的死设置入口。捕获与正文的来源应可辨 |
| 语音/会议 | `VoiceStatusCapsule.tsx:5` 状态与live text，`:35` 电平动画；`MeetingPanel.tsx:1243` 模式/互斥/不自动开麦，`:1271` 仍旧设置路径，`:1445` 录制，`:1503` 说话人/导入，`:1675` 转写，`:1781` 纪要 | 本批准备/处理/失败清晰、停止和晚终稿、跨对话与会议互斥。后续按记录/导入→校对→生成组织，高级说话人折叠；手改转写不能被晚同步覆盖。时延需实机，不据动画推断 |
| 编程控制器 | `CodingAgentPanel.tsx:110` 接 workspace；`App.tsx:244` 取当前thread的目录/消息，但全局codingSession未同样限定；`CodingSessionShell.tsx:53` CLI单轮输入禁用 | 先修归属，保留有效结果。后续当前对话“代码与终端”，其他运行侧栏跳转；不能宣传所有 CLI 多轮。A/B与多个session、操作闭包、late event测清 |
| 内嵌终端 | `terminal/TerminalApp.tsx:61` thread/review关联；`:230` 标题仅“内嵌终端”/状态；`:256` 默认展开手工提示与JSON回传 | 后续加可读归属/回对话，回传按需展开。测正确review/thread收到、失败保留JSON、关闭实际生命周期；手工流程不能称自动回传，导入成功不等于审阅通过 |
| 场景/技能/知识 | `PacksPanel.tsx:1387` 场景状态内藏工作目录，`:1437` 场景绑定多资源；`ContextPanelHost.tsx:392` SkillsPanel；`KnowledgeSubPanel.tsx:1028` 文件/大文件/文件夹/URL/建夹五入口 | 后续目录回项目/对话上下文，保留场景兼容入口；知识导入可菜单收拢但保留不同picker/限额。测场景卸载不丢手工目录，各导入底层校验保留，管理与当前选择分开 |
| MCP/应用/任务板 | `McpPanel.tsx:49–104` 当前选择/全局管理混合；`AppsPanel.tsx:25` 独立应用；`ContextPanelHost.tsx:311` BoardPanel | 后续固定搜索/当前选择/管理分区；全局启停不能误称只影响本对话。任务板、编程、浏览器状态不互相覆盖；不得另造运行事实源 |
| 插件设置 | `SettingsPage.tsx:5` 模型/语音/文件知识/连接/安全/本机工具/密钥/实验八类，`:16` 隐藏但不卸载；`SettingsSlideout.tsx:829` 宽导航、`:831` 窄选择 | 保留分类与草稿；文件知识“偏好”区别资源内容管理，本机工具按对象分区。验收深链、切页草稿、masked secret保留、保存/下载/连接各自回执，不能一个Save越过确认 |
| 独立设置 | companion `settings-web.ts:586` 全局模型作用域；`:667` Save/Test/Cancel，`:673` Vision Model及说明英文 | 后续统一中文并注明只配置全局模型；未覆盖功能不显示假入口。模型/视觉测试与持久保存分开，错误保留输入，密钥不泄露 |
| 确认台 | `cockpit/CockpitApp.tsx:148` 标题含模式/连接/原始thread ID，`:189` 急停，`:197` 收起不停止提示，`:233` 独立ConfirmElevated | 后续标题可读化属chrome改进，不是权限缺陷。本批不改确认DOM/handler。验收风险证据/拒绝/急停可见、收起真实不停止、断连挑战正确取消 |
| 对话/知识图谱 | `thread-graph/ThreadGraphApp.tsx:692` 搜索/阈值toolbar，`:970` 键盘说明；`knowledge-graph/KnowledgeGraphApp.tsx:637` toolbar，`:708` 组，`:760` 图语义 | 保留两图及入口，后续共享返回/空态/toolbar文法。搜索/焦点优先、高级阈值展开；无标签/边/重建/错误可解释，节点回正确实体，相关度不冒充业务依赖证据 |
| 品牌/托盘/宿主 | `scripts/lib/brand-icon.mjs` 连接火花；#474已区分进程与连接状态；#477窗口仍Chromium，非完整native身份 | 保留已交付标识；Mac/Windows运行截图另验，不据PNG证明安装替换。放大/召唤不改权限，浏览器连接前后台不等于逐任务可见性保证 |

## 3. 项目与复用边界

**事实：** Thread（`companion/src/threads/thread-manager.ts:42–152`）含人工分类、
AI digest、workspace_root、资源选择和运行信息，没有 project_id；插件 `types.ts:55`
同为线程目录，`:77` topic_folder注明非Project。`message-router.ts:2984` 通用更新
有 user_tags/topic_folder，workspace_root走独立workspace路径。`ws/summoner-acl.ts`
基线payload gate为alias-only。因此当前窄扩展是实际ACL变化，需要协议/负例复审。

**推断：** 项目适合长期业务/代码范围，但不是多一个筛选器。可复用Thread/元数据
规范化与确认、目录选择校验、ACP/PTY IDs、资源库、确认manager。后续才新增独立
Project、可空归属、目录建议、迁移候选；不用新项目偷渡自动授权。详细流程见计划§5。

## 4. 完成标准与未知

- 本审计覆盖主要入口/所有权，不是逐控件WCAG或视觉认证，没有“美观分”。未验收的
  会议/设置/图谱/终端改进仍是后续工作；不得计入本批实现完成率。
- 用户语音症状需真实权限、音频设备、模型冷热启动实测。静态时窗不是唯一根因证据。
- 编程归属缺陷有高置信源码解释；最终需测当前提交，不能只引用此基线。
- 本批交付限计划§1；项目实体仍提案，#476原生/高权限/浏览器任务策略继续独立跟踪。
- 机器检查、真实双模型复审、当前CI、安装/运行证明分别留痕；设计通过不等于实现通过。
