# Post-#191 Merge Multi-Domain Adversarial Review — Synthesis

**Scope:** main `750cf41..2e7751a`（PR #191–#196：clipboard image paste、thread hygiene、companion-canon sidepanel、attach r2/r3 nits、release 0.5.1）。185 files changed；源文件 46 个（+3,749 / −666）。
**Method:** 6 路独立对抗性评审 agent（explore，read-only），按功能域划分，各自基于 diff + 全文通读 + 实跑域内测试。
**Test evidence:** 域内测试全部实际运行——域1（image-compose/sidepanel-state/vision-reuse-logic 69 例）、域2（8 文件 87 例）、域3（27 例，Windows 红 4 例见 F8）、域4（ws-frame-budget 等）、域5（8 文件 81 例）、域6（3 文件 101 例，官方运行器 tsc + node --test）。
**Verdict:** 无 P0/P1。P2 × 9（去重后），P3 × 若干。安全设计（MIME 嗅探双闸、sidecar realpath 包含、fail-closed 模型判定、logger data:URL redact）成体系且测试对口；弱点集中在管线接缝：协议演进兼容、跨 surface 竞态、错误面覆盖。

## 1 跨域共性发现（多 agent 独立命中）

| ID | Severity | Finding | Location | 命中域 |
|----|----------|---------|----------|--------|
| F1 | P2 | `reduceAddMessage` 位置式收养：persist echo 无差别收养到最后一条临时用户气泡，不校验内容/无 clientMessageId。多 surface（panel+Cockpit）在一个 WS 往返窗口内向同一线程发消息即错配：消息重复/丢失、id 与内容错位、破坏 regenerate 锚定 | `chrome-extension/src/sidepanel/store/agentStore.tsx:563`；根因在 `companion/src/llm/adapter.ts:390` echo 不带 client 关联 id | 1/2/5 |
| F2 | P2 | `chat.user` persist 广播是双向协议不兼容变更。新 companion+旧扩展 → 每条消息双气泡；旧 companion+新扩展 → 上传回合从会话消失（乐观气泡已删）。无版本协商/优雅降级 | `companion/src/llm/adapter.ts:390`；`chrome-extension/src/sidepanel/App.tsx`（file.upload 分支乐观气泡被移除） | 1/5 |
| F3 | P2 | `BUMP_COMPOSER_UPLOAD_CLEAR` 被 `shouldApplyStreamEvent` 线程门控跳过：上传在途切线程 → chips 永久滞留 → 下次在**别的线程**发送把旧附件一起发出去（跨线程附件泄漏） | `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:1668` | 1/5 |
| F4 | P3 | `preview_jpeg_b64` 两侧无长度上限（sanitizer 与 stampAttachments 持久化），且 hydrate 路径不经 sanitizer（注释与行为不符） | `useWebSocket.ts:117`、`thread-manager.ts:196-210` | 1/3 |

## 2 各域独立发现

### 域1 图片粘贴·扩展端管线

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| F5 | P2 | 混合批次 ingest 时部分文件被拒的错误（doc>10MB、GIF>4MB、压缩失败）被循环后无条件 `setFileError(nextFileErrorAfterIngest(...))` 抹掉，文件静默丢失 | `App.tsx:1433` + `image-compose.ts:30` |
| F6 | P2 | WS 帧预算拒绝产生双 ❌ 气泡：广播 `file.upload_error`（气泡1）+ `sendResponse({ok:false})` 回调（气泡2，文案"Companion 未连接"完全误导） | `background/index.ts:608-616` + `App.tsx:1265` |
| — | P3 | 尺寸超限 GIF 被第二分支 catch 吞掉静默放行；动画 WebP 无 `isGifMime` 保护会被 canvas 扁平化丢动画 | `App.tsx:1398-1407`、`image-compose.ts:259` |
| — | P3 | 测试盲区：多气泡收养竞态、混合批次错误优先级、canvas 真实压缩路径（node 无 canvas） | — |

### 域2 图片·companion LLM 管线

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| — | P3 | `writeImageSidecar` 写 tmp 失败遗留孤儿 `.tmp-<pid>`，永不清理 | `image-sidecar.ts:141` |
| — | P3 | base64 解码 try/catch 为死代码（`Buffer.from` 不抛错）；无扩展名文件误判格式 | `split-upload-files.ts:70-75` |
| — | P3 | `[图片: name]` 占位符未做文件名净化（同函数 untrusted-image 有净化，策略不一致） | `image-parts.ts:98` |
| — | P3 | 自定义 `width`/`height` 字段原样上 OpenAI 兼容端点 wire，严格代理可能 400 | `providers/openai.ts:38` |
| — | P3 | `likelyMultimodal` 启发式 SoT 需随新模型家族手工维护（设计内权衡，建议文件头标注） | `likely-multimodal.ts` |

### 域3 线程图片 sidecar 与线程卫生

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| F7 | P2 | `deleteSidecarsForMessages` 前缀扫描误删：`${id}-` 前缀关系时删 msg `abc` 连带删 `abc-1` 的 sidecar（已运行复现）。当前 id 生成器不含 `-` 故 latent，但 `SAFE_MSG_ID` 显式允许且本次新开了调用方指定 id 的口子 | `image-sidecar.ts:280-282` |
| F8 | P2 | 新增 sidecar 测试 4 例在 Windows 必红（POSIX mode 位断言 ×2、symlink EPERM ×2），无平台守卫——项目目标平台测试长期红会淹没真实回归 | `thread-image-sidecar.test.ts:63,209,340,385` |
| — | P3 | fork 拷 sidecar 无 try/catch：fs 异常产生半完成 fork（新线程已建、图缺）。file.upload 有兜底，两处不对称 | `message-router.ts:1650` |
| — | P3 | `fail`/`cancelled` outcome 与失败模板检测在当前生产模板下不可达（死分支，与规格 P-B7 脱节） | `thread-inspect.ts:41-53`、`cleanup-rules.ts:114-117` |
| — | P3 | reserved id 无唯一性校验（latent；重号后 `deleteMessagesFrom` 从错误位置截断） | `thread-manager.ts:925-930` |
| — | P3 | `classifyAlias` 与 `provisionalTitleFromUserText` 对纯 `[文件 x]` 文本分类不一致 | `alias-commit.ts:55-67`、`adapter.ts:1511` |

### 域4 WS 消息路由与帧预算

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| F9 | P2 | chatCreate 失败无条件 `deleteSidecarsForMessages`，但用户消息在 LLM 调用**之前**已持久化 → 悬空图片引用，regenerate/后续轮次永远读不到图（瞬时 LLM 错误即触发，已落盘数据实际丢失） | `message-router.ts:859-866` + `adapter.ts:383` |
| F10 | P2 | `batch_auto_title` 用 `aliasFromFirstUserText(preview,16)`（剥礼貌前缀、16+…=17 字符）与 `classifyAlias` 参照值（`slice(0,15)+"…"`=16 字符、不剥前缀）不一致 → 首条消息 >16 字或带礼貌前缀的线程被误判 user 标题，LLM 自动标题对目标线程群永久冻结 | `message-router.ts:1466`、`digest.ts:89`、`alias-commit.ts:55-64` |
| — | P3 | `WS_SOFT_MAX` 收紧后（9.75MB）日志仍记旧阈值 10MB、`ws-frame-budget.ts` 头注释过时，排障误导 | `lifecycle.ts:832`、`ws-frame-budget.ts` |
| — | P3 | `suggest_cleanup` 的 first_user_preview 不再跳过空内容首条用户消息（影响清理建议准确度） | `message-router.ts:1324-1331` |

### 域5 sidepanel companion-canon UI 改版

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| — | P3 | 「📎 文件名」重复渲染（气泡正文 + attachMeta 行各一遍）；vision 轨 `[图片: x] 描述` 以普通段落显示在用户气泡，无折叠/弱化 | `ChatView.tsx:718-726`、`adapter.ts:377-382` |
| — | P3 | 整理助手对旧 companion 零预选且无「全选」兜底（precheck 缺省时） | `ThreadList.tsx:197-207` |

### 域6 ACP Windows 修复与打包

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| — | P3 | cliHandoff 把信号杀死（code===null）误判成功；300ms 观察窗存在迟发失败误报（沿用既有窗口语义） | `open-local-terminal.ts:511-517` |
| — | P3 | pref=wt 时吞掉 `start` 的真实错误，报错文案误导指向 wt | `open-local-terminal.ts:648-652` |
| — | P3 | `windowsQuotePath` 不转义 `%`，cmd 上下文展开 `%VAR%`（pre-existing，本次改写了该函数，顺手修成本低） | `open-local-terminal.ts:267-270` |
| — | P3 | `jsonrpc-stdio.ts` `this.buf += chunk` 无上限（pre-existing） | `jsonrpc-stdio.ts:44` |
| — | P3 | 测试盲区：`spawnDetachedWin` 2500ms 超时拒绝路径、`emitTerminal` WeakSet 一次性语义无覆盖 | — |

## 3 核查确认无问题的关键路径

- **MIME 伪造**：客户端 `admitComposerImage` + 服务端 `writeImageSidecar` 写入前二次 sniff 双闸，魔数须与声明类型一致且均在 4 类光栅白名单，fail-closed。
- **路径穿越**：sidecar 全链路 companion-chosen 命名 + id 白名单正则 + lstat 拒符号链接 + 双 realpath 严格内含（Windows 大小写一致）；`rel` 永不直接作加载路径；伪造 rel/msg_id/index/mime 组合全部 fail-closed。
- **多模态 SoT**：`likelyMultimodal` 仅两处调用且同 config；deny kimi-k2/moonshot-v1 正确；useNative 绝不走 analyzeImage。
- **hydrate 配对**：rebuild 对 user 消息 1:1 保序，索引配对 sound；maxImages=4 取最新、丢失降级 `[图片丢失]`、非原生模型降级纯文本，均有测试。
- **context budget**：parts 走专门估算分支（1600/2800/图），无 base64 stringify；compaction redact 收敛为文本。
- **cmd 引号契约**：`/d /s /c` + 整包引号 + `windowsVerbatimArguments` 与生产验证的 `wrapViaCmd` 一致；F5 钉装 System32 绝对路径消除 ComSpec/PATH 劫持。
- **wt handoff（F2 修复确认）**：旧代码把 wt exit-0 CLI handoff 误判失败导致 wt 永远落空，新语义正确且测试矩阵齐全。
- **logger redact**：新增 `base64|image_url|^content$` 实际堵住 `image_url` data:URL base64 泄漏（截断 2000 字符曾落日志）。
- **版本 lock-step**：companion/extension/jsonrpc/MCP/installer 全链路 0.5.1 一致。

## 4 修复计划（P2，按修复批次分组）

| 批次 | Findings | 主要文件 |
|------|----------|----------|
| EXT（扩展端） | F1-ext、F2、F3、F5、F6 | `App.tsx`、`useWebSocket.ts`、`agentStore.tsx`、`background/index.ts`、`image-compose.ts` |
| COMP-chat | F1-comp、F9 | `adapter.ts`、`message-router.ts`、`provider.ts` |
| COMP-threads | F7、F8、F10 | `image-sidecar.ts`、`digest.ts`、`alias-commit.ts` + 测试 |

**协议契约（F1）**：`chat.create` 透传 `clientMessageId`；`chat.user` echo 携带 `client_message_id` 字段；扩展端先精确匹配，无匹配退化为 append（不做位置猜测）。

## 5 修复结果与双路复审（2026-08-18）

9 个 P2 全部修复落地（F4=P3 明确 deferred）。已接受的行为变更：

1. 即时标题长度 16→17 字符（与 batch 统一）；
2. `aliasFromFirstUserText` 默认 maxLen 40→16（grep 确认无依赖方）；
3. 即时标题路径（`provisionalTitleFromUserText` → `aliasFromFirstUserText`）现在也剥 请/帮我/麻烦/请问 礼貌前缀（如 `请帮我总结文档` → `总结文档`）——pi 复审 NIT 1 指出后补录于此，属 F10 统一语义的有意结果。

**双路复审**（规约 `post191-review-fixes-dual-prompt-20260818.md`；原始输出 `post191-review-fixes-claude-raw-20260818.md`、`post191-review-fixes-pi-raw-20260818.md`）：

| 评审 | 结论 | 发现 |
|------|------|------|
| claude 2.1.220 | APPROVE | 0 blocking / 0 nits；F1 全链路核验、四种版本组合协议兼容、测试非 vacuous |
| pi 0.83.0 | APPROVE_WITH_NITS | 5 nits（NIT 1 已补录上文；其余为 UI 接缝无直测、temp id 同毫秒碰撞 pre-existing 等低危项）；R1–R5 全 PASS |

遗留跟进项：**已全部收敛（2026-08-18）**。① 旧 16 字符 alias：`classifyAlias` 增加旧公式回退（`legacyProvisionalTitleFromUserText`，私有、仅识别 F10 前落盘数据），旧 alias 判 provisional_user 且 →llm 放行，误伤面测试锁定手写标题仍判 user；② F4：`preview_jpeg_b64` 两侧加 `MAX_PREVIEW_B64_CHARS = 400_000` 截断（`thread-manager.ts` stampAttachments + `useWebSocket.ts` parseChatUserAttachments），hydrate 路径（`thread.messages` + `thread.forked`）统一走 `sanitizeHydratedMessages` 同一安全边界。最终回归：扩展 730/730、companion 受影响 41/41 全绿。

**pi nits 收敛（2026-08-18，全部 5 项）**：NIT 1 见上文补录；NIT 2 补 router 级直测 `companion/tests/client-message-id-passthrough.test.ts`（chat.create emit/omit + file.upload 三例，非 vacuous 已验证）；NIT 3 `fileUploadedEffects` 重构为 `fileUploadedApplyToPanel(): boolean` 消除恒真分支（含源码顺序锁测试）；NIT 4 抽纯函数模块 `utils/upload-send.ts`（`buildOptimisticUploadBubble` + `uploadSendOutcome`）补直测；NIT 5 共享 `utils/temp-message-id.ts` 统一临时 id 为 `${threadId}_user_${ms}_${rand}`，5 处生成点 + `isTempUserMessageId` 正则同步（旧格式仍兼容）。收敛后回归：扩展 728/728、companion 受影响 36/36 全绿。
