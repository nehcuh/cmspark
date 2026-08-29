# 0.5.3 体检批 C — 宿主 P1（#247）

> **GitHub:** [#247](https://github.com/nehcuh/cmspark/issues/247)  
> **状态:** 四路已折 · dual Claude **AWN** + Kimi **AWN**（`both_ok=true`）· nits 已折 · TDD 机核绿 · 待 PR/CI  
> **对抗合成:** [batch-c-adversary-synthesis-2026-08-29.md](../../audit/reviews/batch-c-adversary-synthesis-2026-08-29.md)  
> **前序:** #245 / PR #246 已合 main（A+B）。本票禁止重做 Capture。  
> **HEAD 基线:** `origin/main` `e36176a5`

```text
Surface:      Operate companion tools
L2-classes:   shell | osascript (existing)
Compose:      mcp-server env
Autonomy:     spawn_worker HMAC
Trust:        L2 preview honesty ; token bind
Channel:      community
Blast:        T3
```

**产品句：** 确认台看到的，就是实际跑的。osascript 不能打错 tab；MCP 不能偷塞 loader env；shell allowlist 不能被引号绕过 `-c`；Windows 脚本覆盖要双 opt-in；工人 token 不能换一套 tool_allow 重放。

**实现是否允许开工：是。** dual Claude AWN + Kimi AWN；下列 dual nits 已折进针。

## 1. 四路表

| 路 | verdict | 抽查后站得住的 BLOCK | 与 SoT 冲突需折 |
|----|---------|----------------------|----------------|
| Security | PASS_WITH_CHANGES | C1 预览+HMAC+精确 URL；C2 禁整表 denylist；C3 parse-null 不得 fail-open；C5 绑 allow/deny/intent | 不拆 message-router |
| Product | PASS_WITH_CHANGES | C2 键名/无值/拒非整剥/PATH 留下；C1 tabId 恢复+catalog+废 fragment+预览 URL | fail-closed 不过苛 |
| Impl | PASS_WITH_CHANGES | 文件地图；zod 不得 required url；HMAC `[]` vs missing；测红名单 | schema 强制 url 会杀 adapter 注入 |
| Skeptic | PASS_WITH_CHANGES | keep-query drop-hash；parse-null 扫 token；sort+JSON 不是 DoS 修复 | 五项都不推翻批次 |

**被推翻/降级：** HMAC 顺序 DoS（mismatch=再确认）；env 前缀进 allowlist（`FOO=1 python3` 已不 startsWith）；整表 `USER_ENV_DENYLIST`（PATH 冲突 → 专用 loader 表）；C4 同用户口号（Darwin 已否决，本批对齐）。

## 2. 必须折进路径的针（folded pins）

1. **C1-TABID-RECOVERY：** 无绝对 `http(s)` URL **且**无 `tabId`（或 cache 解析失败）才失败。`list_tabs` 后带 **该** `tabId` 必须成功。禁止 `tabUrlCache` 插入序末条 http fallback。
2. **C1-CATALOG-TABID：** catalog 增加 `tabId`。zod **保持 url optional**（adapter `pinned_tabs` 注入在 parse 之后；schema 强制 url 会重开 chat-kill）。catalog `required` 改为 `["expression"]`；描述写「`tabId`（来自 list_tabs）或 list_tabs 返回的精确 url，两者都缺失败」。
3. **C1-EXACT-URL-CONTRACT：** 解析一次：`params.url` 若是绝对 `http(s):` 用它；否则 `getCachedTabUrl(tabId)`；否则失败。规范 URL = 该字符串 **去 hash、留 query**，**不** `new URL().href` 再序列化、**不**排序/丢 search、**不** origin+path-only。拒绝 hostname fragment（`zhihu.com`）。AppleScript：`if URL of t is pageUrl`（不是 `contains`）。catalog / 错文废除 fragment 合同。可恢复错误：`pass tabId from list_tabs, or the exact url list_tabs returned`。
4. **C1-PREVIEW-URL：** L2 预览含规范 URL（有则加 tabId）。只把 URL 塞进 HMAC、UI 仍只显示 JS → 产品句假。
5. **C1-HMAC-LOCKSTEP：** `bindingPayloadFor("osascript_eval")` 含规范 URL。L2 **issue 侧**先按针 3 解析，把规范 URL **写回** `finalParams.url` 再 `issueTokenFor`（preview / HMAC / dispatch 读同一字段）。**所有** issue/validate 改 `validateTokenFor`（含 `companion-dispatch.ts` 与 `message-router.ts` 现有 osascript 分支）。**不拆** `message-router.ts`。WS 分支必须 **转发 `tabId`**（不得只 `{url, expression}`），并废除 fragment 错文。token 存在后执行 **已绑定的 URL**，禁止再解析 tabId（tab 可能已导航）。token 换 URL 失败。
6. **C2-HONEST-KEYS：** 预览列出将生效的 `config.env` **键名**（排序）；无额外 env 时写死 `env: (none)`。
7. **C2-NO-VALUES：** 值一律不出现（含部分 redact）。`details.code` 打出明文 → REJECT。
8. **C2-DENY-NOT-STRIP：** loader 键 **整次 add/update 拒绝**。禁止静默剥键再让用户批准「看起来干净」的 spawn。`buildMcpStdioEnv` 同样 fail-closed（纵深）。错误必须 **点名** 违规键（含 legacy persist 在 spawn/`toggle_enabled` 路径撞上旧 loader 键）。
9. **C2-DENYLIST-SCOPE：** **禁止**整表复用 `USER_ENV_DENYLIST`（含 PATH/HOME/NODE_ENV）。新增 `isUnsafeLoaderEnvKey`：exact `NODE_OPTIONS` `NODE_PATH` `ELECTRON_RUN_AS_NODE` `LD_PRELOAD` `LD_LIBRARY_PATH` `PYTHONINSPECT` `PYTHONHOME` `PYTHONPATH` `PYTHONSTARTUP` `BASH_ENV` `ENV` `OPENSSL_CONF`；prefix `DYLD_` `BASH_FUNC_`。键比较 **大小写不敏感**。`config.env.PATH` 与运营商密钥（`BRAVE_API_KEY`）留下。不把 C2 扩成 argv 解释器策略（`node -r` 已在 L2 `args:`）。
10. **C3-PARSED-ARGV：** `commandMatchesAllowlistEntry` 在 `tryParseSimpleArgv` 之后扫 **全部** `argv[1:]`：`-c`/`-e`/`--command`/`--eval`、附着 `--command=`/`--eval=`/`-cCODE`。短选项簇含 `c`/`e`（`-ic`/`-Oc`）**只**打已知解释器 basename（`python`/`python3`/`python3.*`/`node`/`nodejs`/`ruby`/`perl`/`php`/`lua`/`osascript`）；**不要**误伤 `grep -ic` / `wc -c`。bare entry（`!/\s/.test(ent)`）才启用；多 token 模板（`python3 -c`）保持现状。
11. **C3-PARSE-NULL：** parse 返回 null **不得** fail-open：剥掉前导 `ENV=` token 后 **再 parse**，对剩余 argv 跑针 10 的扫描；raw regex 只作最终备份（否则 `FOO=1 python3 '-c'` 的引号仍漏）。DoD 负例是 `python3 '-c' 'code'`，不是 `print(1)`（括号已死于 metachar）。
12. **C4-DUAL-OPT-IN：** 克隆 Darwin `host-bin.ts`：`CMSPARK_WIN_SCRIPTS` 已设且 `CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE!=="1"` → **throw**。`ALLOW=1` 在 `NODE_ENV=production` 也生效。`NODE_ENV` 不是开关。`computer-uia-watch.test.ts` 必须同时设 ALLOW。日常 `npm run dev` 走 exe 旁 / dist / tsx `src/.../scripts`，不碰这两个变量。
13. **C5-HMAC-CANON：** `spawn|{role}|{pack}|{alias}|allow={canon}|deny={canon}|intent={id}`。`canon(list)`：非 Array → `null`；Array（含空）→ `JSON.stringify([...new Set(list.map(String))].sort())`。`intent_id` trim，空=`""`。
14. **C5-APPLY-BOUND：** `validateTokenFor` 之后 `spawnWorkerThread` 用 **同一** params 的 allow/deny/intent。禁止从 HMAC 反解集合。`[]` **不是** missing：绑了空数组就按空数组走（空经 HARD_DENY 后仍空 → spawn 失败），不得悄悄落到默认浏览器集。HARD_DENY 仍剥 shell/host/osascript。L2 预览加 deny + intent。reorder 同一集合 **成功**（sort）；多一个 tool **失败**。
15. **C5-PACK-RESIDUAL（点名、不修）：** `pack_id` 已在 HMAC，换 pack 失败；`applyPack` 仍可能相对 `tool_allow` 扩白名单。本批不冻 pack 组合。不得声称「执行只用绑定集合」若同时设了 `pack_id`。

## 3. 五项（可一 PR 多 commit，禁止与 D/E 混）

| ID | 体检 | 修法 | DoD 机核 |
|----|------|------|----------|
| **C1** | bridge-tools-01 | 针 1–5 | 无 url 且无 tabId → 失败（无 cache 末条）。token URL A 不能跑 URL B。schema 仅 expression 仍 parse。catalog 无 fragment/`contains`。L2 `details.code` 含规范 URL。 |
| **C2** | mcp-01 | 针 6–9 | L2 `details.code` 匹配 `env:` 键名或 `(none)`。`buildMcpStdioEnv({ NODE_OPTIONS })` 拒。`PATH` override 仍活。`DYLD_INSERT_LIBRARIES` 拒。add/update 带 loader 键整次失败。确认台无明文值。 |
| **C3** | computer-host-03 | 针 10–11 | `commandMatchesAllowlistEntry("python3 '-c' 'code'", "python3") === false`；`python3 -c` 与 `python3 -ic` 同样拒；`python3 script.py` 仍 ok。 |
| **C4** | computer-host-04 | 针 12 | NODE_ENV 空 + WIN_SCRIPTS 设了 → throw；+ ALLOW=1 → path join。`NODE_ENV=production` + 双开关仍 join。 |
| **C5** | orchestrator-packs-01 | 针 13–15 | 换 allow 重放 token 失败；reorder 同一 allow 成功；HARD_DENY 仍剥 `shell_exec`。 |

## 4. 文件地图

| 文件 | ID | 做什么 |
|------|----|--------|
| `companion/src/tool/companion-dispatch.ts` | C1, C5 | 删末条 cache fallback；精确 URL；osascript **`validateTokenFor`**；执行绑定 URL；spawn 已 `validateTokenFor`，apply 绑定集合 |
| `companion/src/security-policy.ts` | C1, C5 | osascript payload += 规范 URL；spawn canon allow/deny/intent |
| `companion/src/tool/osascript-bind.ts` | C1 | canonicalize keep-query drop-hash；resolve url 或 tabId（无末条 cache） |
| `companion/src/tool/l2-admission.ts` | C1, C5 | issue 前解析 URL 写回 `finalParams.url`；预览 URL + spawn deny/intent |
| `companion/src/bridge/tool-definitions-catalog.json` | C1 | 加 tabId；废 fragment/`contains`；required=`expression` |
| `companion/src/bridge/tool-schemas.ts` | C1 | **保持 url optional** |
| `companion/src/message-router.ts` | C1 | osascript 分支改 `validateTokenFor`；**转发 tabId**；废 fragment 硬失败文案（现有 case，**不拆文件**） |
| `companion/src/message-router/handlers/mcp.ts` | C2 | 预览 env 键；add/update 拒 loader 键 |
| `companion/src/mcp/transport.ts` | C2 | `buildMcpStdioEnv` fail-closed |
| `companion/src/user-env.ts` | C2 | 导出 `isUnsafeLoaderEnvKey`（**不**扩 USER_ENV_DENYLIST 除非另锁 chrome lockstep） |
| `companion/src/capability/shell.ts` | C3 | deny on parsed argv + parse-null 扫描 |
| `companion/src/host-use/win/powershell.ts` | C4 | Darwin 双 opt-in |
| `companion/src/orchestrator/spawn.ts` | C5 | `[]` ≠ missing（空数组不落到默认集） |
| `companion/tests/tool-schemas.test.ts` | C1 | expression-only 仍绿 |
| `companion/tests/security/security-policy.test.ts` | C1 | C-N3 payload = expr + URL |
| `companion/tests/p1-deep-diagnosis-batch.test.ts` | C3 | `python3 '-c'` |
| `companion/tests/p0-deep-diagnosis-batch.test.ts` | C2 | NODE_OPTIONS 拒；PATH override 留 |
| `companion/tests/mcp-stdio-l2-gate.test.ts` | C2 | 预览含 env 键 |
| `companion/tests/orchestrator-l2-flight.test.ts` | C5 | spawn HMAC 断言跟上 |
| `companion/tests/p2-deep-diagnosis-batch.test.ts` | C5 | issueTokenFor 形状 |
| `companion/tests/computer-uia-watch.test.ts` | C4 | 加 `CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE=1` |
| 新测：osascript 无 url/tabId、token 换 URL、quoted `-c`、spawn allow 重放、win-scripts dual-opt-in | C1–C5 | 克隆 `host-bin-resolve.test.ts` 形态 |

## 5. NEVER

- 改 `SUMMONER_ALLOW` / overlay Allow/Deny / #228 profile
- 拆 `message-router.ts`
- D（SkillEngine 快照、token-in-argv）或 E（打包/handshake）
- 改 live `~/.cmspark-agent/config.json`
- 重开 osascript 宿主 AppleScript / `do shell script`
- 把 `NODE_ENV!==production` 当 Win 脚本放行路径
- 从 HMAC 反解 allow 列表
- 本 PR 扩到 `php -r` / `node -p` / overlay Capture
- 宣称 F-S-10 / Capture / CU 闭环

## 6. KEEP

- evaluate / osascript 仍默认 L2；osascript **不**走域白名单自动批准
- AppleScript 仍是 JS-in-tab argv 模板
- worker HARD_DENY
- #245 Capture L0 行为不动
- MCP `config.env` 给运营商密钥（非 loader）；不 dump `process.env`
- `issueTokenFor` / `validateTokenFor` 是唯一绑定对
- allowlist metachar reject 仍在

## 7. PR 形状

一张 PR、最多五个 commit（C1…C5），`Closes #247`。禁止与 D/E 混。不改 SUMMONER_ALLOW。不宣称 Capture 狗食安全因此本票可混 overlay。
