# #476 原生 MCP 保存纵向实施候选
GitHub: #476。DRAFT；先 root 批准配套 spec，再实施。当前没有源码/测试改动或原生运行。

## 实际接入位置
- `desktop/capabilities.ts`、`identity.ts`、`channel.ts`：现 method-set1/6读；给受限编辑/保存与独立native-only回执，仍单一身份 registry，不借 legacy surface。
- `desktop/native/DesktopHost.swift` 全167行、CPP全189行：现 generation/epoch、请求映射及 read-only renderer filter；native请求需单独处理，不能当普通 reply deliver 给WebView。新增真正OS控件和controller回执，保留导航/继承/parentwatch/auth拒绝。build脚本现从 capabilities 生成读表，需同源生成分离角色表与v2，非复制常量。
- `desktop/assets/app.js/index.html/css`：已有MCP列表只读。添加新建/单条编辑表单、保存忙态、草稿/错误/已保存连接状态；请求只能到两个固定方法，decision无DOM入口。
- `message-router/handlers/mcp.ts:244–365`：复用 validate、mask-preserving merge、force stdio gate、原store；必要最小私有session hook承载已冻结 normalized action/提交，避免复制MCP业务和双确认。原 `McpSession.requestConfirmation` 无 owner-current/atomiccommit 合同，不能只换 callback 后声称闭环。
- `security-confirmation.ts`、`ws/lifecycle.ts:802–808`：单例request/respondFrom/abort/terminal和现desktop disconnect；添有限native绑定检查，不用全权respond。`config.ts:1056–1081`真实同步原子写+event，作为最终store；保留旧客户端行为。

## 先真实红，再窄实现
1. 钉main9caa同6读/控制原件。以现channel+实际handlers的 stdio add/update producer、真正 manager 和惰性 config/McpManager deps 写永久用例：原未开放native保存/编辑应RED；不把新请求发到旧legacy handler冒安全路径。所有测试在临时dataDir，网络/进程调用前guards，0真实spawn/不读liveconfig。
2. 实测原handler确认等待期间 sibling 被其它配置写入后落盘丢失，以及目标改动/删后重建/ABA；冻结原RED。实现当前map单目标同步提交+target event stale latch与private normalized mutation；global enable支路冻结空表/全局开关前提，不能连带启动后来sibling。将该动作servers+enabled经原atomic writer一次保存，禁止给原add两次写虚构事务保证，旧extension路径不无故改协议。新增stdio保存显示enabled启动副作用；metadata-only update也恰好一轮确认。
3. 复用现manager cancellation-cancellation integration：同owner native批准一次→真实store一次写/正确masked ACK；拒绝/关闭/45s过期/预abort/approve后同turnabort→store0、spawn0；其它请求仍可完成。schema传入相同normalized mutation与私有完整payload一致，展示截断/JSON属性重排/恶意标签不能换实际action。
4. 角色/边界用实际registry+channel控：shared-secret/伪surface/renderer主frame或subframe/DOM/旧web confirmation ID/外socket/旧principal/错thread/digest均不得决策；不删除合法pending。disconnected/reconnected/revoke/hostexit后的迟到approve无效；重复无第二次store。既有document generation变化关闭旧dialog而非复活请求。
5. 表单/DTO永久控：新manual、既有trust/env/roots/timeout保持、未知字段与提升trust拒绝；HTTP不支持提示；中文/空格/逐项argv精确、不泄env值。空安装thread_id=null精确settings绑定、真实thread与错thread拒绝；实际保存失败、连接失败、成功ACK三态及草稿保留；恶意server name/参数/错误文案都text/原生转义，日志/provider0私有payload。

## 原生和兼容门
Node与lockedARM只运行实际producer/manager/store及DOM惰性测试、定向TSC/build，绝不冒native。未来hostedWindows/macOS现有构建与nativefixture接真实TaskDialog/NSAlert lifecycle，证明controller-only按钮→同owner回执→actualhandler/store；对话窗关闭/断线/旧document/取消比赛和全部现#480 auth/bootstrap/导航/继承负控保留。自动UI测试标明synthetic user action，不冒真人生物识别。当前机器browser/WebView/PS/App/native禁用。

核全部新renderer方法与native-only集合、method-set v2生成一致；launcher不能复用仍v1capability，旧读行为与legacyextension/tray/summoner矩阵保持。全量源freeze后真正第三方独立审批（实施者不能自批），按原票named Grok4.6/directDeepSeekV4Pro及标准两review门/精确新head CI→授权merge→精确main CI。任何source finding先真实producer修，不用timeout/retry/skip/借旧host绿色。首组交付可用MCP新增/修改；删除/HTTP/终端/技能/知识及whole476其余验收明确仍partial。

## 已知收束点，root批准前须明确
- 首组故意限定stdio和上述4类可编辑字段；这是可用配置保存，不是完整MCP管理。若root要env/trust/HTTP同时开放，必须逐字段补合同，不能隐式透传整config。
- root已明确接受MCP设置无thread时null精确上下文候选；不能默默把fresh install卡在“请先建会话”，也不为此扩thread.create。
- 现“队列上限”实际是orchestrator per-run1/process2及60s admission wait，不是manager.pending有总数cap；复用并正确释放。每连接保存忙态拒第二项，不能给旧队列新增无限UI请求。
- manager当前不绑定完整thread/payload；所需有限native pending metadata是新增authority，正由本spec明确。原45s从实际manager请求起计，不因排队、查看全文、重连或重发续期。
- 完整归一化payload私有绑定与原生全文查看是授权依据；1200预览和同socket均不足。配置保存会触发现有applyConfig，不能承诺用户批准后仍绝无进程启动。

已取得真实原生产反例：root的 `/tmp/cmspark-mcp-pending-root-20261017/owned-data-r1/actual-results.json` 以actual handleMcpFamily+真实config/get/replace和owned磁盘证明 remove-target、disable-target、siblingchange 三例0P3FAIL，返回mcp.servers.updated且内存==磁盘。仅manager.list惰性接缝、0spawn/net/native、批准为synthetic非真人。root亲接此既有bugfix并会冻结给真正非作者；本合同保留该RED，不在此改handler，也不冒当前已修。
