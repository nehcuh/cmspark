# 设计 B 实施前门复审(GLM-Claude 独立复审)

## 总体结论

我未仅复述独立报告，而是在真实源码中逐条核对了其关键事实断言，均成立：

- `service.ts` scan 内确实是 `capture` 返回后立即 `addSource`、之后才 `extractSource`——scope gate 必须在 adapter 返回前完成，报告结论正确；且 `platform.ts` capture 现状返回整窗字节(原型 `currentAdapterReturnsWholeFrame:true` 与源码一致)，证明整窗泄漏是正常路径上的真实缺口，本设计正对此修复。
- `activity-request.ts` 的 `matchingActivityReply` 末段确实无条件要求 `state`,我自行读码确认 `{ok:true,preview:{}}`/`{ok:true,text:...}` 会落入该分支返回 false——matcher 集成缺口真实可达，原型只是机械复现了这一点。
- `computer-capture.ps1` crop-only 分支确有 `Max(0,$CropX)/Min($CropW,src.Width-$cx)` clamp,调用方必须先拒绝越界并核裁剪后尺寸；`PS_DEFAULT_TIMEOUT_MS=15000` 与“仅 scan/import/analyze 有 720s”均与源码一致；预览链 4 次 PS(Probe→security→capture→Probe)、预检 2 次(crop+OCR),90s/45s 预算推导成立。
- 6 MiB 原始字节 base64 为 8,388,608 字符，恰等于现有 `activity.import` 的 `image_base64` 上限，且 < WS 10 MiB——`preview_ocr` 可直接沿用现有界限，无新传输风险。

具体 API 决定与独立报告**无实质矛盾**：报告补充提出的 4 个集成缺口(matcher 分支、90/45s 预算、abort 只取消等待不杀进程、>6MiB 不缩放不改 metadata)已被决定原文吸收。三层审查：outcome 层同帧标题 gate 先于任何存储/AI,侧栏/正文提名不可授权(原型场景 2/3 验证)；trajectory 层无新增服务端缓存/token/TTL/队列，复用现有单飞、revision、generation fence;component 层 producer(Probe+GetClassName、crop-only、OCR)与 consumer(adapter gate→service→store/模型、前端 matcher/timeout)路径完整。`preview_ocr` 只本机 OCR 用户自供 PNG 且不持久化，副作用严格小于现有 `activity.import`,无新攻击面。

## 逐关键子设计结论与可观察验收

**1. 范围/config/profile/layout/schema 与受限未校准语义 — APPROVE**
验收：app 有 entry 且 profiles 空 → 采集得到独立跳过状态，store 零新增 source、模型零调用、临时目录空；无 entry → 返回整窗字节与旧行为逐字节一致；同 `(window_class,width,height)` key 重复保存被显式替换或拒绝(原型已验)；非整数/越界/标题不含于内容在 configure 即 INVALID_REQUEST;矩形 1..8192 与 validatePng 像素预算一致，无比例扩张。

**2. 同帧标题 OCR gate、content crop、临时文件与存储/AI 隔离 — APPROVE**
验收：一次采集只产生一个原 PNG,标题 crop+OCR 与内容 crop 均出自该文件(测试可断言临时文件时序)；标题不匹配/OCR 空/缺语言/尺寸变化 → adapter 不返回图像 → 无 addSource、无 extract 调用；vision 模型收到的 buffer 与内容裁剪逐字节相等，夹具侧栏标记像素不存在、嵌图标记保留(原型像素模拟对应)；裁剪输出 PNG IHDR 宽高==矩形；所有分支 finally 后临时目录为空。

**3. 一次性校准 RPC — APPROVE**
验收：preview 仅从 owned UI origin 可达，返回 ≤6MiB 且通过专用 matcher(否则前端按现有逻辑丢弃——已证现状会丢)；`chat_scopes=[]` 绕过仅 server-owned、录制请求不可传入(preview 入参只有 app_id);preview_ocr 对同一冻结 PNG+rect+lang 的 `recognized_title` 与实际 gate 投影来自同一函数(逐字符相等)；>6MiB 明确大小错误不缩放；前端 90s/45s 预算存在；取消/晚到回执被代数约束忽略(原型已验)；预览后 store 与磁盘零变化。

**4. UI 双框/坐标/标题/revision/取消 — APPROVE**
验收：表单像素值==保存 profile 值==后端实际使用矩形三方一致；键盘可编辑整数并两端校验；预检出标题前不可添加 profile;主表单须带 expected_revision 保存(旧 revision 冲突)；取消/关闭/切 app/新预览/rect 或 language 变化清空预检并忽略晚到响应；文案不声称已即时终止 PS 子进程。

**5. 群聊/独立窗、同名、嵌图 DoD 与 Windows 验收 — APPROVE**
验收：owned 双栏夹具——仅授权侧栏名拒绝、正文提名拒绝、匹配后 source 与模型输入均无侧栏像素、聊天内嵌图保留并产出 literal quote 候选；两个 class/尺寸 profile 确定性选择、同 key 歧义拒绝；resize/revoke/stale 均不放行且无遗留 pending;五款软件如实标注未现场观察，不冒称逐客户端认证。

## Blockers

**无。** 我按“可达触发→受支持路径→用户目标影响”检验了候选项：如 `validateConfig` 现无 `chat_scopes` 键、`message-router.ts` dispatch 现无两 RPC case——触发的确可达(configure 会 INVALID_REQUEST / RPC 无回执超时)，但两者均属决定与门框架明确承诺“完整接通”的机械接线，缺省行为是 fail-closed(拒绝保存/超时失败)，不会造成越权放行或隐私泄漏，属实施检查而非设计缺口。未发现决定与报告间需裁决的真实矛盾。

## NITS(不阻塞)

- `preview_ocr` 的 `ocr_language` 应默认取当前 `config.ocr_language`,避免用与实际 gate 不同的语言校准(不一致时仍 fail-closed 拒绝，仅影响可用性)。
- schema 应要求每 profile `allowed_titles` 非空(空表同样 fail-closed,但应在保存时给出明确错误)。
- 标题区含群人数/未读角标等动态文本时 exact 匹配会因计数变化而拒绝——这是设计明确选择的严格性，建议文案提示用户可存多个完整标题变体(≤20)。
- preview 与进行中 scan 共享 `pending` 会返回 BUSY,建议 UI 提示稍候而非静默失败。
- 6–8MiB 的大窗无法预览校准(采集本身仍可到 8MiB),按补充决定提示调整窗口，文案需明示。

## 必须保留实施检查

1. 五处接线一次到位：background `index.ts` 方法白名单、`ws/validate.ts` validators map、`validation.ts` `validateActivityMessage` extras、`message-router.ts` dispatch、前端专用 matcher + 90s/45s 超时——原型只机械证明了 matcher 一处，其余四处同构但须逐项落地与测试。
2. `validateConfig` 新增 `chat_scopes` 键及服务端结构校验(20 app / 8 profile / 20 标题 / 200 字 / 整数矩形 / 图内 / title⊆content),不得只靠前端。
3. 标题投影 `words→text.join(' ').trim()` 抽成唯一共享函数供预检与 gate 复用；注意与现有整图 OCR 的 `join('\n')` 是两个不同投影，不得混用。
4. 调用方先拒绝非整数/越界/空矩形，crop 后核 PNG IHDR 尺寸==请求，绝不依赖原生 clamp。
5. 原图/标题图/内容图全部走 `withPendingImage` 嵌套 finally 清理，覆盖成功/拒绝/取消/异常；采集前后身份检查加入 `window_class` 一致。
6. Windows CI owned 双栏夹具按上述 DoD 亲证同帧 gate+crop、侧栏零泄漏、嵌图保留；实施后另做独立测试与源码复审(本门不要求未写代码已获原生通过)。

VERDICT: APPROVE_WITH_NITS
