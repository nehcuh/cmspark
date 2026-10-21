# 聊天事项工作中心：独立对抗评审（第一轮）

时间：2026-10-21 14:46:06 UTC。评审者：独立 Codex 子代理 `/root/workspace_adversary`，未参与本功能实现；当前环境未提供可核实的精确模型版本，不虚构版本号。

Base / HEAD：`a3ecd5f21e63c05044fd6ced9406168de544b9c1`。Branch：`codex/chat-action-workspace-752`。
冻结对象：42 个已暂存文件的完整 `git diff --cached --binary`，SHA-256 `4bcd5515523c058d7719ae70bffbff005019725564480b7dfd3be56f995cd7a5`。此哈希不包括本评审报告；开始和结束读取的暂存 diff 哈希一致。

## 裁决

发现三个可重复的 P2 实现缺陷，分别影响提醒的单次语义、敏感数据的保留期、最新来源的可访问性。当前不通过放行。没有发现需要升级到 P0/P1 的权限绕过、自动发送聊天消息或无授权截图路径；这不构成对未执行真实平台场景的认证。

以下都属于可观测行为错误，不是布局、代码风格或命名偏好。修复建议是实现方向，验收以外部行为为准。

## F1 · P2 · 普通事项编辑重新排程已经提交的提醒

位置：`companion/src/activity/store.ts:132`，调用路径 `chrome-extension/src/sidepanel/components/personal-workspace/PersonalWorkspace.tsx:126`。

`update()` 只要看到 `remind_at` 键，就把提醒重新置为 `scheduled`。真实 `TaskEditor` 每次保存均发送这个字段，即使用户只改标题或勾选“处理已完成”。对于已经到时并且 `submitted` 的提醒，处理完成但仍待反馈的事项仍符合通知条件；下一轮后台检查再次通知。`failed` / `unknown` 状态同样会被普通保存隐式重试。用户没有重新安排提醒，却改变了持久状态及对外副作用。

隔离复现（真实源码、临时数据、Node 22.23.2）：建立需要反馈、提醒时间已到的事项；`claimReminder()` 后 `finishReminder(..., 'submitted')`；按真实表单字段调用 `update()`，保留原提醒时间且仅修改标题/处理状态。输出：

```json
{"case":"ordinary full-form save after already submitted reminder","before":"submitted","after":"scheduled","dueAgain":1}
```

修复验收：未改提醒时刻的普通编辑保留原 `submitted` / `failed` / `unknown` 回执，后台不会重发；用户明确改为新的提醒时刻才建立新排程。还要覆盖 `datetime-local` 的精度：现有表单展示会丢失原 ISO 的秒和毫秒，不能把未操作的控件重新序列化当成用户重排。可让表单仅提交实际修改的提醒，并让存储层对相同规范时刻保持原提醒状态。需要继续保留“正在通知时用户明确改期，旧回执不能覆盖新排程”的现有负控。

## F2 · P2 · 暂停采集后保留期和容量限制不再执行

位置：`companion/src/activity/service.ts:53–61`；唯一清理调用在同文件 `:80`、`:92` 的 `scan()` 内。界面承诺见 `chrome-extension/src/sidepanel/components/personal-workspace/PersonalWorkspace.tsx:157`。

`tick()` 在记录关闭或平台不支持采集时直接返回，启动和读取来源也不执行 `prune()`。所以用户暂停记录后，即使 Companion 继续运行提醒，过去保存的截图、OCR、候选和事项引用仍无限期留下。把保存期限从 14 天缩为 1 天也不会在暂停状态触发清理。这与界面“来源最多保留 N 天”的明确隐私控制不符；用户不应为了执行删除策略而重新打开采集。

隔离复现：向真实 `ActivityService` 的临时存储写入 2026-09-01 的来源；注入当前时间 2026-10-21，默认保留 14 天、记录关闭；调用 `start()`、`tick()`、`stop()`。所有采集、模型、通知依赖均设置为一旦调用便抛错；它们未被调用。输出：

```json
{"case":"disabled recording with elapsed 14-day retention","enabled":false,"oldSourcesRetained":1,"imageRetained":true}
```

修复验收：后台维护在暂停、重启、非采集平台上仍执行保留期和配额；删除截图、OCR、候选及事项引用，同时保留正式事项身份。维护不能每秒克隆全部 OCR。若新增维护允许在模型请求进行时删除来源，应让源删除失效化该请求，或在接纳结果前重新核对来源仍存在；不能让迟到的模型输出复活已经清理的引用/候选。该并发要求是修复时必须保持的现有信任边界，不另计第四个现存缺陷。

## F3 · P2 · “最近的采集来源”实际只展示最早 30 条

位置：`chrome-extension/src/sidepanel/components/personal-workspace/PersonalWorkspace.tsx:159`；数据顺序证据为 `companion/src/activity/store.ts:79` 的 `s.sources.unshift(source)`。

后端按最新在前保存，前端却反转整个数组后截取 30 条。记录超过 30 条后，最新截图完全没有来源核对入口。未开启模型的用户依靠该入口“手动整理为待办”，因而会被挡在新消息的手动整理路径外；不是单纯列表排序偏好。

隔离复现：用真实 `ActivityStore` 连续插入 31 个不同 OCR 的来源，再执行真实组件中的数组投影。输出：

```json
{"case":"recent 30 source UI projection","newestInStore":"capture 30","newestVisible":false,"firstShown":"capture 0","lastShown":"capture 29"}
```

修复验收：31 条及以上时最新一条必须可见；以最新优先展示最近 30 条，或提供明确的分页。增加真实组件回归，验证 newest 的“核对来源 / 手动整理”可到达，不能仅镜像数组表达式写测试。

## 评审覆盖和已通过的边界

Outcome：读取批准的设计、实施合同和完整机器证据。个人事项独立于 Agent MissionBoard；候选不自动成为正式事项；处理和反馈各自保存；用户显式确认后才排程。三个缺陷分别破坏提醒、留存和来源路径，现有通过计数未覆盖它们。

Trajectory：检查配置/删除/停止时的 generation 和 AbortSignal、连接身份 `isCurrentSession`、显式模型同意、OCR 抽取失败与迟到回包、原生采集前后前台身份和安全输入复核。现有删除及配置 fencing 能阻止已知迟到结果；没有新增主动切群、滚动、输入注入或聊天数据库读取。来源文字是数据，候选必须具有实际 OCR 连续引用；模型没有获得修改配置或任务状态的工具权限。

Components：检查原子状态保存、重复候选确认、版本冲突、提醒 claim / 崩溃 unknown / 旧回执匹配、文件身份与摘要核验、严格消息 schema、扩展 sender 白名单、Companion 的已认证 panel 门。设置助手使用服务器持有的五分钟候选，校验 owner、选项、旧值及闭合目录；不序列化完整配置，保存调用已有 config 家族并读回核对。manual 候选不假称写入。语音结束只填草稿，界面保存失败不盲目重试。检查完整页保持聊天和各目的地挂载、会议返回、危险操作时的可见聊天优先级及错误提示。

以上为代码与定向测试支持的有界结论，不声称穷尽所有竞争、系统窗口或恶意应用变体。

## 本评审独立执行的验证

- 在项目 `companion` 目录，先 `nvm use 22.23.2`，再通过项目隔离 runner 执行 `.test-dist/tests/activity-752.test.js`、`settings-assistant.test.js`、`personal-workspace-transport.test.js`：34 PASS / 0 FAIL / 0 SKIP。
- 另用 `tsx/cjs` 直接加载当前源码，使用独立临时 `CMSPARK_DATA_DIR` 运行上述三条反例；全部重复得到错误行为，退出码 0。临时目录已删除，未改生产源文件。
- 审阅机器报告给出的扩展 1,805 PASS、隔离非 root Linux Companion 8,505 PASS / 178 原有平台 SKIP、双端构建及受控真实 App 浏览器证据；这些是提供的证据，非本评审重复执行的全量结果。
- 实际 macOS TCC / ScreenCaptureKit / Vision、真实模型准确率、真实系统通知展示未执行。没有对用户聊天截图，没有发送 provider 请求，没有触发通知或修改 live config。Windows/Linux 截图不支持属于已披露范围，不作为隐藏缺陷或已通过能力。

修复三项并取得对应回归证据后，需要对修复 diff 和涉及的并发边界复核，再进入 Pi 全量材料复审。当前机器测试通过不能覆盖这三条已证实反例。

VERDICT: REJECT
