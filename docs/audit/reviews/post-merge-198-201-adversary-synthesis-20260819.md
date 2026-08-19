# 四路对抗合成 — main 98bb586..2faaefa (PR #198–#201)

> **日期**: 2026-08-19
> **对象**: `git diff 98bb586..2faaefa`（PR #198 vision/sidepanel followup、#199 sidepanel+companion、#200 voice classic idle、#201 file-scheme L2 path cage）
> **核验**: 四路均对照源码 `[inspected]`；关键发现均以真实探针/协议建模脚本 `[executed]` 复现；相关测试包全绿后评审

---

## 参与路与裁决

| 路 | 范围 | 裁决 |
|----|------|------|
| **A** | file: path cage + 一次性 L2（d0589e5） | SHIP-WITH-FIXES（high×1 med×1 low×4） |
| **B** | vision/LLM 管线（17f543f, f4e0098） | SHIP-WITH-FIXES（high×1 med×2 low×2） |
| **C** | sidepanel 状态/WS/cockpit/background（f4e0098, 1a09439） | SHIP-WITH-FIXES（med×1 low×3） |
| **D** | voice classic STT 延迟启动（8e3cf67） | **BLOCK**（crit×1 high×1 med×1 low×1） |

### 合成裁决

**BLOCK**。voice 路 critical 为日常双倍速听写即可确定性触发的「报错 + 麦克风永久锁死」，由 #200 新引入 classic 路径；须先修。

---

## Critical / High（必须修）

### V1 [critical] classic 冲突重试被自身 abort ACK 杀死，僵尸重试永久锁死 adapter
- 位置：`chrome-extension/src/sidepanel/voice/local-stt-adapter.ts:948-961`（重试块）、`:317-319`（无 pending fall-through kill）、`:179-208`（`reset()` 不碰 `loopGen` 且 `clearSub()`）、`:367`
- 序列：stop → start 被 `resource_conflict` 拒 → 每 chunk/end 被 `requirePeer` 拒 `session_unknown` → 进重试块发 `voice.stt.abort` + sleep 250ms → 旧 sid 的 `session_unknown` 落 `:317-319` 触发 `onError+onEnd+reset()` → `reset()` 不递增 `loopGen`，250ms 后僵尸醒来发 `-r1` start，但已 `clearSub()` 退订 → `uploadAndWait` 永不 settle → `phase` 永卡 `waiting`，`start()/stop()` 全静默拒绝。仅切线程/chat abort/重挂载可解锁。已按真实 companion 协议建模复现。

### V2 [high] 重试 abort 永远释放不了 max-1 槽位
- 位置：`local-stt-adapter.ts:954` 只 abort 自己被拒的新 sid；`companion/src/voice/stt-session-service.ts:495-502` 在 `sessionId` 不匹配时 early return，不触碰 holder 的 abortController。whisper infer 秒级，250ms backoff 后 holder 几乎必在 infer → `-r1` 必再冲突。连续模式 `:768-770` `abort(parentSessionId)` 同构。

### S1 [high] SSRF 守卫对所有 IPv6 字面量失效，API key 随 probe POST 到被禁主机
- 位置：`companion/src/security.ts:211-242`；调用点 `message-router/handlers/config.ts:330-335`
- `new URL().hostname` 对 IPv6 保留 `[]`、mapped v4 序列化为 hex（`[::ffff:a9fe:a9fe]`），而 `isCloudMetadataIp`/`isLinkLocalImdsHost` 按无括号字符串匹配 → `http://[fd00:ec2::254]/v1`、`http://[::ffff:169.254.169.254]/v1`、`http://[fe80::1]/v1` 全放行（已用编译产物实测）。`security.ts:193-194` 注释契约错误。新测试 `llm-endpoint-url.test.ts` 只测 v4 点分十进制。
- 关联：`settings-web.ts:147-150` 把 DNS 失败从 fail-closed 改成 fail-open（glibc 平台 bracketed 名被 getaddrinfo 拒 → 直接放行），须恢复 fail-closed；`settings-web.ts:13-15` 头部注释与新逻辑相反。

### F1 [high] drive-relative `file:///C:path` 绕过 path cage
- 位置：`companion/src/tool/file-url-admission.ts:124`（`path.resolve` 静默吸收非绝对路径）
- `fileURLToPath` 在 win32 对 `file:///C:...` 返回 drive-relative；`path.resolve` 锚到 companion cwd → 词法 home 内 → OFFER，弹窗显示 home 内假路径；Chrome 按自己的 per-drive cwd 打开**笼外系统文件**（已端到端实测弹窗放行）。设计文档 §2.2 明令「非绝对路径硬拒绝」，实现从未检查 `isAbsolute`。

---

## Medium（同批修）

| # | 发现 | 位置 |
|---|------|------|
| M1 | **B/C 两路独立收敛**：面板 `resolveNativeVision` 不读 probe 位——设置页刚提示「已探测到看图能力」，composer 附图却被 `IMAGE_PREFLIGHT_NO_VISION` 拦下；走视觉轨则目的地披露指向错误主机（companion 实际发主模型 host） | `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts:100-115`、`App.tsx:899-911,1188-1195`、对照 `companion/src/message-router.ts:736-740` |
| M2 | junction TOCTOU：不存在的文件只作词法检查，窗口期内经 home 内 junction 落盘笼外文件（真实 junction 实测 OFFER） | `file-url-admission.ts:211-217` |
| M3 | `probeNativeVision` 仅凭 HTTP 200 判定，one-api/new-api 类网关对纯文本模型也 200 → 假阳性缓存 | `companion/src/llm/connection-test.ts:129-166` |
| M4 | voice 重试测试断言不存在的 companion（不回逐 chunk `session_unknown`、不回 abort error ACK），给 V1 发假通行证 | `chrome-extension/tests/voice-local-stt-adapter-ws.test.ts:187-254` |

---

## Low（顺手修/跟进）

- L1 probe 缓存键小写归一化模型名/URL → 大小写敏感服务端跨模型投毒（`native-vision-probe-cache.ts:18-28`）
- L2 vision 描述缓存键不含模型/端点，双管线共享串味（`vision-pipeline.ts:36,58,111-117`）
- L3 门文案「凭据目录被硬拦」过度声明（实测 `.git-credentials`/`.npmrc`/浏览器凭据库均 OFFER），名单仅 5 段（`user-gate-copy.ts`、`gate-error-copy.ts`、`mcp/allow-dir-expand.ts:71-95`）
- L4 gate-error-copy `/file/i` 把 `files.example.com` 的 WS 断连误标为本地文件错误
- L5 MinimalConfirm 对 relevantApps 类确认误显「仅这一次，不加白名单」（`MinimalConfirm.tsx:315`）
- L6 目录 URL 可进弹窗，一枚确认可经 `get_page_text` 枚举目录（`file-url-admission.ts:211-219` 缺 `isFile()`）
- L7 `apps.list`/`acp.list` 未加 `Array.isArray` 请求回显守卫（`useWebSocket.ts:1257-1267,1303-1309`）
- L8 40ms hostname 预算静默丢弃站点知识，无日志（`background/active-tab-hostname.ts:36-60`）
- L9（跟进，非本批）`mergeHydratedMessages` 内容相等假设 → echo 丢失时用户轮次永久重复（`agentStore.tsx:647-678`），修法为 client_message_id 关联，单列跟进
- L10（存量提示）连续模式同构 kill+锁死模式；双重点击 stop 静默丢弃整段录音

---

## 已实测无问题（勿回退）

- A 路：遍历/双重编码/UNC/IPv6 host/junction 穿透已存在文件/8.3 短名 fail-closed；一次性语义（无 token、不写白名单、确认 id 随机 UUID + 已认证 socket + 解析即删）；`auto_approve_dangerous` 下 file: 仍弹；错误信息不泄漏 realPath；cookie 门 fail-closed。
- B 路：上传撤回链路幂等、跨线程 retract 精确；`admitComposerImage`/`visionImageDataUrl` 嗅探 fail-closed；GIF/VP8  dims 解析逐字节正确。
- C 路：stream-thread-gate 按 thread 门控齐全；`chat.token` 全量累积不丢中段；`pendingUploads` 三处清理完整；`withHostnameBudget` 无双发；`hostnameFromTabUrl` 解析正确。
- D 路：修复前存量测试全绿（755/755）。

---

*合成者: Kimi（4 路独立 coder subagent，各自 `[executed]` 验证）。修复后须以独立对抗路复验，不得用本文件自我 APPROVE。*

---

## 修复轮（2026-08-19，未提交，工作树）

4 路并行修复（文件范围互斥切分）→ 4 路独立对抗复验（重放原始攻击 + 攻击修复机制本身）→ 1 路残留修复。

### 复验裁决

| 范围 | 复验裁决 | 结果 |
|------|----------|------|
| voice（V1/V2/M4/L10） | **PASS** | 4 项全部闭合并经 HEAD 对照组重放验证（修复版不再锁死、HEAD 版复现锁死）；无修复引入新问题 |
| SSRF + LLM 缓存（S1/L1/L2） | PASS-WITH-NOTES | S1/L2 闭合（80/80 函数级探针 + settings-web 端到端 21/21）；L1 companion 侧闭合 |
| file path cage（F1/M2/L6/L3/L4/L5） | PASS-WITH-NOTES | 6 项全部实测闭合（20+ 形态探针、真实 junction 链）；无误伤 |
| 面板 probe + sidepanel（M1/L7/L8/M3-copy） | PASS-WITH-NOTES | 主流程闭环；复验发现 N1 失锁残留 |

### 复验发现的残留与处置

- **N1 [medium，两路复验独立收敛]**：扩展侧 keyed probe 缓存归一化未随 companion L1 同步（7 类编辑场景两侧判定相反，含面板侧 fail-open）→ **已修**（归一化算法逐行移植，`vision-reuse-logic.test.ts` 锁错方向的用例已反转）。
- **N2 [low]**：`SettingsSlideout.tsx` 探测文案过度声称 → 已对齐「端点接受图片输入」。
- **[low]×2 修复批次自引入**：MinimalConfirm host_write 信任提示过矫正、F1 拒绝 kind/error 字段不一致 → 已修。
- **跟进项（不阻断）**：dangling-junction anchor 的 TOCTOU 残余窗口（pre-existing，威胁模型外）；in-home symlink 一律 fail-closed 拒绝但 cage 文案未列该原因；`voice-local-continuous.test.ts:272` 仍是弱 fake；上传中 abort 双发 onError/onEnd（存量）；NAT64/6to4 内嵌 IMDS 地址（存量）；WS config.test 路径无 DNS 复查（存量）；L9 mergeHydratedMessages 内容相等去重（单列跟进）。

### 最终测试状态

- `chrome-extension && npm test`：**769/769**（基线 755 → +14 新/改测试）
- `companion` 相关套件（file-url-admission / security-gates / security-thread / llm-endpoint-url / settings-web / native-vision-probe-cache / vision-pipeline / config-test-probe-keyed / voice-stt 等）：全绿；全量套件 63 个失败均为 Windows-only 存量（chmod/symlink/daemon/POSIX 路径形），修复范围文件 0 失败

**合成裁决更新：BLOCK 解除 → SHIP-WITH-FIXES 完成。** 改动未提交，待用户审阅后提交。
