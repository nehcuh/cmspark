GitHub: #476

Approved implementation contract; source review and hosted native delivery remain pending.

# #476 单MD原生资源管理实施计划

状态CONTRACT_ONLY，必须root先全文批准spec/plan才编码。原Issue476就是Issue-first；不是新需求，不按按钮新造Issue。基准e838源不变，future main机械继承650/其它已审差额单独核，不整文件覆盖。最终只Refs476，whole仍OPEN。

## A. 数据/来源与精确复用

- desktop/capabilities.ts方法集4；新增四个desktop.resource方法后需版本5、真实host重铸/revoke，registry发放scope、两host常量、launcher.c两处真实snprintf producer，以及synchronize-handle-probe.c/windows-inheritance.c/windows-malformed-bootstrap.c三个真实C消费者同步，不能只改TS数字。
- desktop/channel.ts专用actor路由，flat-json原约束；dialog、metadata、MCP旧入口原义保持。UI沿现四页，不新增设计系统/通用RPC。
- SkillEngine现get/import/update/delete与canonical doc identity、知识duplicate规则。细节snapshot私有出口不得走exportSkill（folder ZIP）或把list内部source_file/resources照搬renderer。
- SecurityConfirmationManager/default45s、现L2 admission60s/1&2、真实OS confirmation窗口和请求映射；新purpose只资源四动作。无新全局token/generation/持久幂等表或队列。
- 已测524288正文wire、6MiB文件cap；nativetext限制524288是显式窄新入口。字段归一化沿200title/500description/8×24tags。完整JSON仍≤现10MiB，不改默认配置/预算。

## B. 先记录真实RED、划清作者

1. 用frozen e838实际DOM/channel/store setup新增本批永久用例：四resource调用被现method表拒、列表无管理动作的实际RED。source/trace保存，不手写假接口成功fixture。
2. root独占修knowledge writer既有title-only trimStart与half-write EIO两缺陷，并交source/tests/真实REDGREEN供真正非作者审；本worker不并改这些路径。该组件绿不冒whole新UI批准。
3. 本批实现者在root writer出口冻结前，先确定有限private snapshot/commit接口与冲突检测所需字段。若需动同一SkillEngine源，由root指定单一作者协调合组，不能互覆。无明确适配API时先给具体源码差额，不另起设计框架。

## C. canonical snapshot/commit先于UI写通

4. read用实际唯一kind+id和regular文件证据，rawbytes与canonical projection严格一致；完整文本脱敏/截断/builtin/folder分类。建立一个actor本地edit快照，revision由真实数据/身份产生；新read失效旧快照，公开DTO不带私有原件。当前ensureFresh/fingerprint不是CAS，要钉强制当前读取与实际文件替换。
5. 窄active-observer接既有sync refresh/真实canonical mutation：pending期间任何已观测canonical变化使快照单向invalid；注册/解除无无界map。真实A-B-A及外部metadata/内容/rename反例。未观测全信息复原的外部ABA明确不承诺。
6. importer预解析与duplicate/name/builtin/目标冲突使用同一canonical规则；confirm后再查，真正create-exclusive publication。当前默认writeRestrictedFile不是exclusive事务，需窄私有commit选项/出口，旧调用不改义。update/remove finalcheck→synccommit无await，root原子writer证据与新callback共同核；失败不覆盖兄弟或误ACK。

## D. native channel、UI、controller同批闭环

7. 四exact frame/innerpayload schemas及闭error/outcome；拒unknown/重复原型/伪gesture/任意path/URL/zip/force。keep per-socket operation+last已知结果，不定义全历史exactly-once。
8. 两资源页共用详情与import表单，只有knowledge可编辑；builtin/目录技能/脱敏/截断只读原因明确。草稿、busy、request/kind/ID/document/epoch归属同步latch；离线不假persist或自动再发。normal old42 Stop及原MCP/metadata不回归。
9. 两OS host新增purpose='resource'私有确认分支和精确pending method/kind/ID/revision映射；完整action_json保controller，普通WebView reply不出现它。旧MCP精确schema/decision仍旧路。取消先清pending，再关控件；同epoch/deadline/manager ownership才能respond。正常主窗与确认窗close语义、oldcomponent raw保留。

## E. 一次成组验收，不按钮拆批

10. actualSkillEngine/ownedFS及真实channel/renderer纵向：两kind import/read/reopen、knowledge update、remove deny/approve；same-data身份不漂、他文档不变。badfrontmatter/caps/readerrors/redaction/truncation/builtin/packagedskill/duplicate/exclusive collision/OCC/API ABA/physical replacement与确认race/unknownACK都实际反例。
11. 确认验证是controller路径与actualmanager，不UI自称gesture；cancel/revoke/不同socket/旧doc/批后currentfalse signal仍活均effect0。受控provider/fixture非真人/真实模型；不碰live HOME/配置。
12. source组合冻结一次：所有FULL diff/作者与真正非作者/原RED纠正；一轮受影响host+freshlockedARM+selectedsemanticTS/必要build，root writer组件作者身份分开。复用原42/650不变基线，不全仓/全前端无理由重跑。
13. 真实两路独立非作者有效意见，source body/身份/EOF/自然exit保真；互盲，不固定模型家族，不额外等待第三、第四CLI。用户最新双路要求覆盖旧具名要求。真实HostedWinMac nativekeys/controller/持久化/断线/清理+精确head/mainCI完成才交付本批；仅source或Linux回执不能当原生过。

## 本合同请root一次裁定的有限新增

四命名方法、purpose资源分支/版本5；native text512KiB限制；folder技能只读不目录remove；一个actor一个edit快照+operation；真实物理/bytes OCC与窄refresh观察；native-only import exclusive publication。以上是待审明确差额，不伪装已有API。无其它authority、时限、安装权限、默认配置或原票外验收。root批准后再实际RED→实现，不靠本计划宣称完成。
