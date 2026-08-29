# 0.5.3 体检批 D — 运行时 P1（#249）

> **GitHub:** [#249](https://github.com/nehcuh/cmspark/issues/249)  
> **状态:** 四路已折 · dual Claude **AWN** + Kimi **AWN** · nits 已折 · 允许 TDD  
> **对抗合成:** [batch-d-adversary-synthesis-2026-08-29.md](../../audit/reviews/batch-d-adversary-synthesis-2026-08-29.md)  
> **前序:** #245/#246 A+B、#247/#248 C 已合 `10a6a322`  
> **HEAD 基线:** `origin/main` `10a6a322`

```text
Surface:      Capture overlay HTTP ; Operate WS peer
L2-classes:   n/a (no new confirm dialect)
Compose:      skill index
Autonomy:     n/a
Trust:        overlay token not in argv ; POST Origin not null/empty
Channel:      community
Blast:        T3 (token/Origin) ; T2 (index/abort/fence/unicast)
```

**产品句：** 关掉连接就停这一面的忙；技能目录不被空快照写坏；召唤器窗口的钥匙不躺在进程列表里；压上下文不能把「网页内容不是指令」的围栏剪断。侧栏和召唤器同时开着，聊天/忙态同一份；确认弹窗仍只在发起那一面。

**实现是否允许开工：是。** dual both AWN；下列 nits 已折。

## 1. 折进路径的针

1. **D1-GET-READONLY：** `ThreadManager.get` 可内存 seed `run_progress`，**禁止** `saveIndex`。不要拖到 write 才让侧栏看见本轮步骤。
2. **D1-SINGLETON：** SkillEngine **禁止** `new ThreadManager()`。`bindThreadManager(tm)` 或可选第二 ctor 参数；`server.ts` 绑定一次。测试保持 `new SkillEngine()` 不红。
3. **D2-UPLOAD-OWNER：** `file.upload`（及一切 `abortControllers.set` 路径）写入 `llmLoopOwnerPanel`；无 `session.panelId` 用合成 owner。
4. **D2-CLOSE-NOT-CHAT-ABORT：** WS close / hide 只走 `abortLlmLoopsForPanel`（已按 owner 过滤，内部可对匹配 tid 调 `abortThreadChat`）。**禁止**整段复制 `chat.abort`：不要 `rejectForWorker(thread)` 清确认台、不要 thread 级 tab-lease 释放、不要 close 时 `drainNextRun` 无头开跑。关召唤器，确认还在（切片 2）。无剩余同 thread 观看者（数 `lifecycle` 上已鉴权 `clients`/`wsAuth`，不新建 registry）→ nextRun **丢弃并停忙**。关 Cockpit ≠ WS close。
5. **D3-NO-ARGV-TOKEN：** `--app` URL **禁止** `?token=`。`isSummonerLoopbackUrl` **禁止** token query（可保留 optional `thread=`）。`planSummonerShellOpen` 不再把 64-hex 放进 argv。API 再带 `?token=` → 403。
6. **D3-COOKIE-FIRST-PAINT：** Cookie = 窗口路径；Header `X-CMspark-Overlay-Token` = 测/curl。**禁止 header-only**（`--app` GET 带不了；EventSource 不能自定义 header）。`GET /`：Host 闸（不要强制 Origin）+ `Set-Cookie`（HttpOnly; SameSite=Strict; Path=/；**不要 Secure**）。HTML **不得**从 `location.search` 读 token，`url()` 不再拼 `token=`。
7. **D3-POST-ORIGIN：** 变更 POST/PATCH/DELETE：cookie **或** header，**且** Origin 必须是 `hostOk` 三形之一（`http://127.0.0.1:<port>` / `localhost` / `[::1]`）。**拒绝**空 Origin 与 `"null"`。测/curl 必须显式带 Origin，禁止为了绿测把空 Origin 放回去。不要把 settings-web「空 Origin 放行」当 overlay 先例。Overlay 鉴权是防**网页** CSRF，不是防本机 curl（端口仍是本机能力）。
8. **D3-MUTATING-GET：** `GET /api/thread` 等会改状态的 GET 在 cookie 时代是 CSRF。本批改为 POST，或继续要求非 cookie 凭证。禁止「导航 GET 靠 Host 闸就能 select thread」。
9. **D4-SHRINK-INNER：** `shrinkToolBodiesToFit` 只缩 `<untrusted-…>` **内层**，再挂回**同一个** closer。未 wrap 的 body 仍半切+省略号。**不改** `untrustedSuffix` 的 `"x"`（空 id 是防御，不是本批）。
10. **D5-THREAD-FANOUT：** 双写 allowlist：`chat.token` / `chat.user` / `chat.done` / `chat.error` / `chat.aborted` / `run_status` / `thread.updated`（overlay SSE ALLOW 补 `thread.updated`）。**没有** `chat.delta`。同 `thread_id` 已鉴权 peer **或** overlay SSE。禁止 `broadcastToClients` 全量。
11. **D5-CONFIRM-UNICAST：** D5 进度扇出**不得**加入 confirm 事件。既有 `fanOutConfirmRequest` 语义不动。非 origin peer **不得新出现**允许/拒绝死按钮。Overlay 永不 Allow/Deny。`mcp.confirm.pending` 仍只是「去确认台」。`SUMMONER_WEB_EVENT_ALLOW += thread.updated` 是 SSE 镜像，**不是**改 `SUMMONER_ALLOW`。

## 2. 五项 DoD

| ID | DoD 机核 |
|----|----------|
| **D1** | skill-engine 无 `new ThreadManager`；`get()` 不 `saveIndex`；第二份 TM 不能盖活索引 |
| **D2** | upload 有 owner；close/hide 能 abort 该 owner 的 upload；确认台条目不因 overlay close 消失 |
| **D3** | `planSummonerShellOpen` args 无 64-hex；POST `Origin: null` → 403；`GET /` 无 query 仍 200 + Set-Cookie；overlay 选 thread 走 POST+cookie，不靠 query token |
| **D4** | wrap 过的长 tool body 缩完后仍含匹配 `</untrusted-…>` |
| **D5** | 第二 peer / overlay SSE 能收到同 thread 的 `chat.token`/`run_status`；确认请求仍只到 origin |

## 3. 文件地图

| 文件 | ID | 做什么 |
|------|----|--------|
| `companion/src/threads/thread-manager.ts` | D1 | `get()` 内存 seed，不 `saveIndex` |
| `companion/src/skills/skill-engine.ts` | D1 | bind 单例；删两处 `new ThreadManager()` |
| `companion/src/server.ts` | D1 | init 时 bind |
| `companion/src/message-router.ts` | D2 | upload stamp owner；**不拆文件**；不把 chat.abort 整段贴到 close |
| `companion/src/ws/lifecycle.ts` | D2, D5 | close 仍 panel abort；sendToExtension 旁 dual-write 进度，确认除外 |
| `companion/src/summoner-web.ts` | D3, D5 | tokenOk cookie/header；originOk POST；Set-Cookie；HTML 去 query token；SSE ALLOW |
| `companion/src/summoner/shell-open.ts` | D3 | loopback URL 无 token query；`--app` 干净 |
| `companion/src/llm/context-budget.ts` | D4 | inner shrink + 原 closer |
| `companion/src/llm/adapter.ts` | D5 | 进度已是 `thread.updated`（只认名字） |
| 测试 | D1–D5 | skill-engine 无 new TM；get 不写盘；upload owner；Origin null 403；shell-open 无 hex；shrink 闭合；第二 peer 见 token |

**将红：** `summoner-shell-open.test.ts` 今日要求 `?token=`；`summoner-web.test.ts` 大量 `?token=`；`composer-lease.test.ts` 源码窗禁在 `release_overlay` 贴 `abortThreadChat`（drain 必须活在 `abortLlmLoopsForPanel` 内）。`text-sanitize.test.ts` suffix `x` **保持绿**。

## 4. NEVER / KEEP

**NEVER：** `SUMMONER_ALLOW` / overlay Allow/Deny / #228；拆 `message-router.ts`；E（handshake Origin 盖章、打包、protocol_version）；live config；宣称 Capture/CU/F-S-10 闭合；广播确认；cookie Secure on http；header-only overlay；EventSource 自定义 header。

**KEEP：** #245 L0 / hide abort overlay 面；#247 HMAC；evaluate/osascript 默认 L2；overlay loopback-only + 64-hex；Confirm origin-bound；切片 2「关召唤器确认还在」；切片 6 overlay 不画本轮步骤勾选。

## 5. PR 形状

一张 PR、最多五个 commit（D1…D5），`Closes #249`。禁止与 E 混。
