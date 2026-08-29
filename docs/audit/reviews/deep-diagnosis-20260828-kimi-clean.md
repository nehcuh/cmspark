# Kimi independent re-review — CMspark 0.5.3 deep diagnosis (2026-08-28)

Source: `docs/audit/reviews/deep-diagnosis-20260828-kimi-20260828-190625.md` (raw includes VibeSOP hook dump; this file is the reviewer body only).
HEAD: `feat/overlay-card-first-paint` @ 597a5827

## Verdict rationale

  报告声称的 0 Critical 成立——我未发现配对绕过、未认证 RCE 或大规模破坏；estop 抢绑、XSS、allowlist 绕过都需同用户/已配对/已 L2 前提，校准正确。14 条 High 我逐条开了源码，全部属实、无一条 stale。P0 五条与代码现状对齐。唯一分歧是定级边界（overlay token 在 argv 我倾向 High，报告记 Medium），属 nit 而非漏 Critical。

  ## Confirmed Critical / High

  | id | title | file:line | why real |
  |----|-------|-----------|----------|
  | overlay-xss | Capture-card markdown 可突破 `<a href>` | `overlay-md.ts:32-34` + `summoner-web.ts:1704` + `summoner-web.ts:524-525` | `esc()` 只换 `&<>`（1413），链接正则 `https?:[^)\s]+` 不排除 `"`，`href=\""+u+"\"` 直接拼接；`d.innerHTML=renderMd(text)`；CSP `script-src 'unsafe-inline'`。`[x](https://e/"onclick="…)` 成立。 |
  | bridge-tools-01 | osascript_eval 错 tab | `companion-dispatch.ts:1056-1068` | 无 url/tabId 时遍历 `tabUrlCache`（Map 插入序）保留最后一条 http(s) 作 fallback；注释自称 "most recently cached" 实为插入序。 |
  | mcp-01 | stdio L2 预览隐藏 env | `message-router/handlers/mcp.ts:52-58` + `transport.ts:220-224` | 预览仅 command/args/cwd/enabled；`buildMcpStdioEnv` 对 `config.env` 任意键 `env[k]=v` 无 denylist，NODE_OPTIONS/DYLD_* 可过。 |
  | computer-host-01 | estop 匿名 /tmp 套接字 | `darwin-estop.ts:28,85-96,174-181` | `/tmp/cmspark-estop.sock`；`tryConnectHeld` 对任何 listener connect 成功即 `ok:true`；无 nonce/getpeereid；外部 owner 直接信任。 |
  | computer-host-03 | allowlist `-c` 引号绕过 | `shell.ts:161,175,499-503` | `BARE_INTERPRETER_DENY_FLAGS` 打在 raw suffix 上，`'-c'` 前缀是引号不匹配 `\s-c`；`tryParseSimpleArgv` 去引号后 argv spawn。需 policy=allowlist，仍属实。 |
  | computer-host-04 | Win 脚本 NODE_ENV 信任 | `powershell.ts:63-67` | `CMSPARK_WIN_SCRIPTS` 在 `NODE_ENV!=="production"` 即生效；打包 SEA 通常不设 NODE_ENV → override 可用。 |
  | orchestrator-packs-01 | spawn_worker token 绑定不全 | `security-policy.ts:94-95` | payload = `spawn|role|pack|alias`，无 tool_allow/deny/intent_id。 |
  | x-architecture-01 | Overlay 聊天全量工具环 | `adapter.ts:127-146,619-623` | `ChatCreateParams` 无 surface；tools = `getToolDefinitions()` + MCP，仅按 thread whitelist（null=全开）过滤。 |
  | overlay-summoner-03 | Overlay 经 tray 面变更 MCP | `menu-bar-agent.ts:894-897,913-917` | `handleSummonerMcpToggle`/`handleSummonerMcpAdd` 走 `companionClient`（tray WS），SUMMONER_ACL 拦不到；`mcp.add` 可直达。 |
  | orchestrator-packs-02 | pack.apply/skill.activate 不绑 overlay 线程 | `message-router.ts:3083-3088` + `summoner-web.ts:655` | overlay 分支禁 Trust/force 字段，但 `applyPack(rest.pack_id, rest.thread_id, …)` 的 thread_id 任意；skill.activate 同样直传 HTTP body 的 thread_id。 |
  | orchestrator-packs-03 | SkillEngine 独立 ThreadManager 写读 | `skill-engine.ts:480,652` + `thread-manager.ts:760-765` | 每线程 `new ThreadManager()` 独立快照；`get()` 在 run_progress 为空时 `this.saveIndex()`。saveIndex 的 digest merge（461-467）只护 digest，其余字段仍可被旧快照覆盖。 |
  | knowledge-loop-01 | 截断保存覆盖磁盘 | `KnowledgeSubPanel.tsx:679,754-768` + `skill-engine.ts:1468,1487-1503` | `truncated:true` 只禁导出；Save 按钮（!readOnly 即显示）把截断 body 发给 `knowledge.update`，`updateKnowledge` 当全文 `writeRestrictedFile`。 |
  | overlay-summoner-01 | hide 不释放 composer 租约 | `summoner-web.ts:358-361,571` | `hideSummonerWebShell` 只 `requestSummonerWebClose`+`closeOverlayChrome`；SSE close 仅 `sseClients.delete(res)`；全文件无 `handleSummonerClosed`/lease 释放。 |
  | x-correctness-abort | 中止路径不完整 | `message-router.ts:790-796` + `lifecycle.ts:1418-1427` | file.upload 设 `abortControllers` 但不写 `llmLoopOwnerPanel`；WS close 走 `abortLlmLoopsForPanel`（只 abort+放 gate），不做 chat.abort 的 reject pending/放租约/drain。 |

  ## Refuted / downgraded

  | id | original sev | new sev | why |
  |----|--------------|---------|-----|
  | 08-11 七条 Critical | Critical | 0（维持报告结论） | 抽查未发现未认证 RCE/配对绕过；报告的降级判断成立，不重新通胀。 |
  | computer-host-02 | High | 驳回（维持） | darwin-estop.ts 头部注释与 `holdSocket`/EOF 检测确为 08-01 合同，非未修缺陷。 |
  | overlay-summoner-02 / privacy_ack | High | Medium（维持） | `summoner-web.ts:839,892,951` 恒 `privacy_ack_v2:true` 属实，但属诚实闸失效而非 RCE，降级合理。 |

  ## Missed by fanout (High+ only)

  无新增的确定 High。一条边界项我记录但不强制升级：

  - **overlay-token-csrf 定级偏低（High 候选）**：token 在 Chrome `--app` argv（同 UID 任意进程 `ps` 可读）+ `originOk` 放行 null/缺 Origin（`summoner-web.ts:193-195`）+ x-architecture-01 使 overlay 聊天带 L1（screenshot/get_page_text 无 L2）。三者叠加 = 同用户本地进程无需配对即可经 loopback HTTP 驱动 L1 工具静默截屏/读页面。与 computer-host-01 同类的「同用户本地攻击」报告给了 High，这条给 Medium 口径不一。修复已在 P1 #14，不挡 verdict。

  ## Nits

  - `thread-manager.ts:736-766` 的 `get()` 有读路径副作用（saveIndex），orchestrator-packs-03 描述准确；但 saveIndex 已有 digest merge（461-467），"打烂 index.json" 的爆炸半径比措辞略小，主要是 run_progress/字段级覆盖。
  - Medium 计数 36 我未逐条复核（抽查了 originOk、privacy_ack、file.upload、pack.apply 链路均属实）；计数依赖报告的簇规则。
  - x-correctness-abort 中 lifecycle close 有 `abortLlmLoopsForPanel`（lifecycle.ts:1422），报告说「close 只 abort」准确，但建议措辞点明 gate 已放、租约/pending 未放，避免读者以为 close 什么都不做。

  ## Recalibrated counts

  Critical: 0  High: 14（token-csrf 若升级则 15 / Medium 35）  Medium: 36  Overall grade: C+

  VERDICT: APPROVE_WITH_NITS
