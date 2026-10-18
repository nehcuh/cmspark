# #476 原生对话首组实施计划

状态：root已真正非作者批准实施；当前源码实现与受控CPU验证已完成，whole非作者、模型及hosted原生验收仍待执行。以spec.md精确范围为合同，不借本计划放开legacy ACL。原#476已在设计前存在，whole保持OPEN。source基线main820，已交694/695设施与metadata不重做。

## 实际源码闭包与有限改点

| 实际main820位置 | 本组要复用/补齐 |
|---|---|
| desktop/{capabilities.ts:2–12,identity.ts:45–114,channel.ts:23–83}；ws/lifecycle.ts:801–812 | Registry持有发证时固定方法集、principal和socket；新增四个精确方法、v4重铸与注入真实native chat service。新native actor须显式支持，不能假冒tray或靠未知surface分支。 |
| message-router.ts:1168–1546、272–316、2182–2230 | 复用真实chat文本准备、线程/lease/conductor/run_active、同步controller claim、generation CAS、终态/stop。新增仅可信内部的origin/current/run-handle hook；不导出可任意操纵controller map，不开放router任意rest。 |
| ws/composer-lease.ts:94–174；ws/l2-conductor.ts | 复用现holder/rev与guard。native只用现非overlay composer分类；overlay占用时原拒绝，不偷偷claim/release，不增加renderer lease API。 |
| llm/adapter.ts:192–200,735–752,1796–1828,2800–2824 | client_message_id与持久message_id、reservedUserMessageId已有私有能力；累计token不是delta，done不必有新消息。保持原模型/技能/knowledge选择、执行策略、事件终值，不以聊天新入口更改provider/default。 |
| threads/thread-manager.ts:709–748,1240–1254,1269–1328 | 同一create/getMessages/addMessage及原atomic文件写；新增有限严格历史读投影，保留旧caller容错。复用实际消息id去关联，失败允许partial/UNKNOWN，不新建store/事务。 |
| server.ts:461–550,726–750；desktop/mcp-save.ts:87–111；native CPP:144–159、Swift同beginConfirmation | 真executor当前origin绑定；MCP native窗只懂MCP action，本组不能泛用。对未支持L2请求沿manager显式拒/取消，发固定有限状态，无副作用。 |
| DesktopHost.cpp:170–186/215、Swift:119–148/184–201、assets/app.js:3–35 | 复用origin/frame/document UUID映射；新增send多帧直到真实终态、Stop run_id翻译、open/selection epoch。普通read/MCP/metadata原匹配仍保留。 |
| DESIGN.md:28–40,48–69,159–164；现index.html/app.css | 同一导航与内容区增加朴素composer、发送/停止状态和历史，不换设计系统；窄/短窗口输入/Stop可达、无误自动聚焦。 |

Stop细节必须先钉producer：abortThreadChat是同步core，现chat.abort后还有按thread的异步pending/PTY清理。不能仅在入口比一次generation、随后异步清掉继任run。优先用捕获signal/真实origin及已属本run的pending标识调用既有清理；任何按thread后续动作须仍受同一run保护。旧run已终结/被取代时只返回STALE/已终结，不清别人的任务。原clearQueue/no-revive语义仍通过同canonical路径保留；不新造全局调度器。

## 一组真实RED→GREEN

1. **入口先RED。** 在owned目录、clean child env和effectsGuard先于import的真实channel/registry/canonical manager/session连接中，从实际DOM按钮产生New/Open/Send/Stop帧。main820没有这些入口/方法应拒；不能只对手造DTO或独立镜像实现测绿。New必须是空create，确认模型/工具/mic调用0；write/rename故障、两写间partial与丢ACK显示UNKNOWN，不自动再建。新manager和实际磁盘证明创建/消息归属。
2. **发送实际链。** 只替provider transport为受控async seam，执行真实router/adapter/store及origin callback。验证user持久ID、两个以上累计token替换、最终持久assistant、重开同ID/顺序/内容，另有未配置模型/真实policy拒绝有限反馈。模型seam不是实际provider成功。实际工具executor无确认允许路径与未支持L2 manager拒绝/取消/effect0均验证，原MCP批准与其它origin pending不受影响。
3. **两个thread/两个run负控。** A运行→选B→A；旧open/旧generation/错thread/错run/新socket/撤销后的chunk不能覆盖草稿或写错历史。真正运行A仍只归A；fresh open只可重绑server确认owned的run。同步双发、同请求重入、已持久UUID重复、Stop vs完成/换run、Stop清理await后继任run存活、late done无message_id、sink throw、丢ACK及断线后新principal均钉实。未知event/错误带私有sentinel、原始reasoning/tool args/config不得泄漏。
4. **兼容与机器。** 原六读、v3拒绝/重铸、metadata晚包、MCP确认45s/取消、原overlay/panel lease、模型和L2/HITL策略相关负控保持。只受影响host semanticTSC/focused CPU/真实DOM producer及一次fresh locked LinuxARM，完整source/locks/cache inventory；不无理由全仓/前端重跑，不把Linux skip称native。编译/hosted门按实际产品改点选定并记录。
5. **真native与发布。** Hosted Windows WebView2与macOS WKWebView实际窗口：键盘New/select/Send，真实controller传递、流式显示、Stop，关闭重开同canonical历史；另运行断线/丢ACK与不支持L2确实拒绝，原host origin/bootstrap/navigation/identity gates原断言不松。受控流用于可重复桥验收，清楚注明并非真人或真实模型业务验收。本机禁止GUI/browser/App/PS/native编译/运行；不为机器成功强行放宽权限、延时或改默认。源码真正非作者、原要求Grok4.6-build+直接HTTPDeepSeekV4Pro、Kimi+现配置GLM全输入意见与严格actualEOF/identity/naturalexit；精确新head all4及merge后main all4再交付。

## 交付边界

一次冻结本组源码/actual producer/失败纠正，作者不自批；root决定是否批准spec和有限actor/run/strict-history内部改点。若真实canonical producer无法在该范围传递origin、取得run handle或无副作用拒L2，应立即给root具体反例，不改成unused接口/假托tray。原生完整界面不是所有Agent/终端/Chrome全能力，本组结果只能Refs476，不能Close。无新增独立Issue、通用token/generation系统、provider安装、live config迁移或额外业务/真人前置。
