# Project Knowledge

## Process Patterns

### 大功能隔离：独立分支 + `rebase --onto` 接到当前 main（2026-08-23 · S77）
- **场景**：overlay 在旧 tip 上长了 20+ commit，同时 main 合了 #213 等插件修。用户要「main=插件最新、overlay 独立」。
- **做法**：`git rebase --onto origin/main <pre-feature-base> feat/os-agent-shell`（本轮 `e63bf87`）。drop 与 main 重复的 commit（site-op 副本、session-end docs）。push 前确认 `origin/main..HEAD` 只剩本功能。
- **不要**：把 WIP 大功能合进 main「先占坑」；`git stash` 含已 staged `A` 文件会失败——先 `git reset` 再 stash。
- **4 行 case**：动作=隔离 summoner；成功=main 干净插件、overlay 21 commit 可独立推；归责=功能与产品面混在同一 HEAD；保护=合 main 变成显式决定

### 站点负知识：继续会重置同工具失败闸（2026-08-21 · qg44es）
- **现象**：WAVE-1 已类型化仍 `click` 9 败 / `get_element_info` 8 败；知乎写作。体积封顶打到了 osascript/shell，然后 hop 到 click。
- **根因**：`MAX_SAME_TOOL_RECOVERABLE_FAILURES` 在每个 chatCreate /「继续」清零；换工具名再点同一 locator；`record_experience` 要 LLM 自觉写；同一 tab `CDP_ATTACH_FAILED` 后仍对同一 tabId 发 CDP
- **闸**：`(origin, tool, locator)` 失败 2 次 → `SITE_OP_BANNED`（跨工具同 locator 也禁）；tab attach 失败 1 次 → `TAB_ATTACH_FROZEN`；继续不清零；prompt 注入 + site_knowledge 一条 DO NOT retry
- **4 行 case**：动作=知乎 click 写文章 ×2 + attach 后再 type；失败=继续重置 3 次闸；归责=计数器作用域错；保护=同一网址重复失败的 CDP 不得再试

### 网页操作：CSS-only click + 成功路径风暴（2026-08-21 · a7ubt9）
- **现象**：读推文/发知乎；`click` 3/3 失败；`osascript_eval` 81 次（80 成功）；`shell_exec` 54；用户喝止 get_element_info / 要求 host_computer
- **根因（对抗后）**：(1) catalog click 只收 CSS，finder 已在 download（D10 欠账）；(2) CDP attach 失败被 **改写成** Element not found；(3) `element not found` 可恢复但无 suggested_action；(4) `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` **不计成功**，osascript 工作环刷爆；(5) type/hover/fill_form **假 success:true**；(6) last-resort 只在 prompt
- **不要**：http 上禁 osascript（会杀掉这场唯一能写的知乎路径）；click({text}) 当本场救命；`chrome-extension://` 子串改 non_recoverable（https 编辑器同一句 attach error）；host_computer 当网页默认
- **方向锁**（3 路对抗 + Claude/Kimi APPROVE_WITH_NITS）：W1 共享 resolveLocator + fail-closed ELEMENT_*；W3′ 类型化 WRONG_ORIGIN（tabs.get url）+ 成功环预算 + evaluate 死世界诚实；W2 snapshot 第二波
- **设计 SoT**：`docs/superpowers/specs/2026-08-21-web-act-loop-design.md`（locator/budget/win32 三路 **REJECT** 已折入）：text 独占不 fall through；成功环 = 同脚本 3 次 + origin 体积 24；Windows **无**第三条 JS，`CDP_ATTACH_FAILED` 禁止 suggest evaluate/CU；shell 按 payload 指纹；fill_form Ctrl 半边必须带 VK
- **Windows**：`osascript_eval` 不进工具表。禁止把 evaluate 当成 attach 失败的退路（同一 debugger）。轨迹未在 win32 复放。
- **相关**：`docs/audit/reviews/web-act-loop-direction-20260821.md`
- **实现（WAVE-1 · 2026-08-21）**：combination C `planLocator`；`classifyInteractiveFailure` URL-first（`Debugger is not attached` ≠ ELEMENT_NOT_FOUND）；evaluate 探针 `1+1===2`；`dom_script` peek-before-execute 3/24；fill_form Ctrl 半边 VK=65 modifiers=2；catalog `text`；Rule 12/12b NEVER host_computer for DOM；linux 无 CU 文案
- **闸门**：locator/budget APPROVE_WITH_NITS；win32 先 REJECT（tsc.test import.meta + attach 正则）→ 折入后 rereview APPROVE_WITH_NITS；Claude+Kimi impl dual 均 APPROVE_WITH_NITS。**MERGE=NO**（未 CI 全绿 / 未 PR / 未打包）
- **4 行 case**：动作=click({text}) + origin 成功环 24；成功=类型化失败/假 success 关掉/体积封顶；归责=规格曾把 attach 当找不到元素 + 只计失败；保护=L1 网页可按可见字点、风暴可停

### 打包 Node 无 npm：npx 会去 lstat `<app>/Contents/lib`（2026-08-21 · 会议+MCP 同日翻车）
- **现象**：MCP filesystem `-32000 Connection closed`；stderr `ENOENT lstat /Applications/CMspark.app/Contents/lib`
- **根因**：DMG 只带 `Contents/Resources/node`（无 npx/npm、无 `Contents/lib`）。`buildSpawnPath` 把该目录排 PATH 最前 → nvm 的 `npx` 跑在打包 node 下 → npm prefix=`Contents/`
- **纪律**：(1) 只把 **node+npx 成对** 的目录放 PATH 头；未配对打包 node 必须排在用户 PATH **之后**；(2) MCP stdio **强制** `npm_config_prefix=~/.cmspark-agent/npm-prefix`（mkdir，不写进 .app，免得坏签名）；(3) 文档不得用现在时暗示「已安装包已修好」——旧 DMG 要 `config.env.PATH=nvm/bin` 或重打包
- **测**：`dirHasNpx` 假 Resources；`buildSpawnPath({execPath: bundled node})` 断言 nvm 对在 Resources 前；`buildMcpStdioEnv` prefix；`launch-companion.sh` 含 `npm_config_prefix`（zip；MCP 子进程不依赖它）
- **4 行 case**：动作=spawn `npx -y @modelcontextprotocol/server-filesystem`；失败=Contents/lib ENOENT；归责=AI/产品把未配对 node 当 nvm 对；保护=Compose mcp-server 在打包 Companion 下可启动

### 会议「结束并生成纪要」死等 STT ACK（2026-08-21 · 同日 Companion SIGTERM）
- **现象**：点结束 UI 仍「正在听…约 8 秒出第一段字」；`meeting.recording_reconciled`→`ready` 无纪要
- **根因**：近实时 streaming 在 `voice.stt.end` 后 **无限** `pending`；`stop()` 在 `waiting` 几乎空操作。Companion 一死 ACK 永不来，`onEnd`/`finalizeCapture` 不跑
- **纪律**：(1) STT pending 必须有墙钟（默认 95s；用户 stop 后 `stopGrace` 12s **含 waiting 重武装**）；(2) 工作台 stopping 20s failsafe + 断连 5s debounce（WS 1s blip 不得杀录）；(3) **不得**在 Companion 断开时 `pendingGenerate=true` 后 fire-and-forget WS——对抗 REJECT：按钮卡「生成中」。须 defer-reconnect + watchdog
- **测**：classic/streaming「companion never ACKs」→ `onEnd` 于 stopGrace 内；`meetingMinutesSendPlan(false)==="defer-reconnect"`；stopping hint ≠ 正在听
- **4 行 case**：动作=结束并生成纪要；失败=永远 listening + 无 minutes；归责=规格漏了「ACK 永不来」；保护=L0 会议可结束、转写可再生成纪要

### L2 批准后再跑 regex 硬拦 = 假「拒绝弹窗」（2026-08-20 · #203 · fzbcro）
- **现象**：日志 `security.confirmation.approved` 后立刻 `contains high-risk APIs (fetch). Execution requires user confirmation`；聊天再套「若你已拒绝弹窗」；用户以为没弹窗
- **根因**：(1) `companion-dispatch` 在 **valid token 之后** 仍 `return checkHighRiskExecution.error`；(2) `formatChatErrorLine` 凡 `error_level===security` 一律加拒绝弹窗，不看 denied/timeout/unavailable
- **纪律**：`checkHighRiskExecution.blocked` 只做 L2 **预览**，批准后不得二次 veto；文案仅 `User denied` / `你拒绝了这次` 才写拒绝弹窗（禁止匹配「不是你拒绝了」）
- **测**：platform-free `issueToken` + `executeCompanionTool` 断言无 `contains high-risk APIs`（勿新开文件去 `bindCompanionDispatchRuntime`+改 `HOME`，会污染并行套件）
- **相关**：`companion-dispatch.ts` osascript 案 · `user-gate-copy.ts` · PR #203

### 多路对抗流水线：评审→互斥修复→重放复验→外部双路（2026-08-20 · #202）
- **链**：kimi AgentSwarm 4 路独立对抗评审（各自 `[executed]` 实测攻击，非目测）→ 4 路并行修复（**文件范围互斥切分**是并行不互踩的关键，prompt 里明写禁止改的范围外文件）→ 4 路独立复验（重放原始攻击 + 攻击修复机制本身）→ 收敛残留（复验两路独立撞到同一 N1 = 高置信）→ `grok --single` + `pi -p` 双路 → PR → CI → merge
- **复验硬招**：`git show HEAD:<file>` 编译出修复前产物做**对照组**——新测试必须在旧代码上红、新代码上绿，否则测试可能在发假通行证（本批 M4 就是这么抓出来的）
- **grok headless**：`grok --single "<prompt>" --always-approve --output-format plain > out.md`（`-p` 同义）；与 `pi -p --no-session` 配对可替代 claude+pi 双路
- **教训**：F2 改了 companion 侧缓存键归一化，F4 的扩展侧 lock-step 缓存没跟上 → 复验才暴露；凡「两侧 lock-step」声明，必须实测两侧键输出矩阵一致，不能信注释
- **记录**：`docs/audit/reviews/post-merge-198-201-adversary-synthesis-20260819.md`

### 脏工作区混功能：server.ts 必须手术式拆分再提交（2026-08-04）
- **现象**：同一 `server.ts` 同时有 full-autonomy cruise 与 run-state `thread_id`；`git add` 整文件会把未审 Trust 改动塞进 UX PR
- **做法**：HEAD 还原 → 只重放本功能 hunk；另一功能 hunk 再单独回放；或 `git add -p`；dual-review 附带 patch 若含 dirty tree 须在 prompt 声明
- **反例**：为「干净 diff」抹掉另一 WIP，用户后续要求一并提交时需从 patch/对话恢复

### 设计门：Product MAJOR_REVISE 必须回写 SoT 再 dual（2026-08-04）
- 四路对抗 Product 可 MAJOR_REVISE，其余 PASS_WITH_CHANGES → **吸收全部 Product blocking 后再** `dual-external-review.sh`
- 本轮：W2-min 同 ship、诚实 RunBusy、常驻芯片、portal、F-S1 → Pi+Claude **APPROVE_WITH_NITS**

### Eval Engineering 闸门（2026-08-04）
- **思想**: 不信任模型；用机核 + 独立评审 + 爆炸半径放行（Hanako 评估工程 6 步映射）
- **Skill**: `docs/skills/eval-engineering-gate/SKILL.md`（git SoT；v1.1）
- **确认序（用户锁定）**: **独立对抗 agent 确认 → Pi 复审**；实现 agent 不得自评放行；dual-external-review.sh 仅可选补充
- **卡片**: `docs/audit/reviews/_templates/eval-gate-card.md`（ADVERSARY + PI_REREVIEW）
- **机核**: 单测/CI；红则禁止进审
- **缺口纪律**: 禁止 self-APPROVE；禁止「同会话自对抗」；禁止跳过 Pi；禁止信心分阈值；`disclosure_accepted` 不可信 caller 自报
- **Outbound 应用**: `docs/superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md`

## Technical Pitfalls

### BSD `cp -r` 会把 symlink 落成实体文件——DMG 内 codesign 封签静默破（2026-09-07 · host-integrity）
- **坑**：`create-dmg.sh` 把 .app `cp -r` 进 sparse 卷。`Resources/cmspark-host` 设计为 symlink→`../MacOS/CMspark`（单 CDHash），BSD `-r` **解析 symlink 复制内容**（`-R` 才保留链接）。封签清单记的是 symlink，DMG 里变成实体文件 → `codesign --verify` 报 "a sealed resource is missing or invalid (file modified)"，packaged 安装上 host-integrity 全 fail-closed（window-list 拒 spawn）。**0.6.5/0.6.6 两个 DMG 同病**；staging 阶段的 verify 验的是拷贝前，缺陷静默存活多个版本。
- **纪律**：DMG/安装包装配一律 `cp -R` 或 `ditto`；签名verify 必须对**最终产物**（DMG 卷内）再做一次 fail-closed，不能只验 staging。门禁：`scripts/tests/test-package-gates.sh` 三条静态断言（cp -R / 禁 cp -r / DMG 内复验）。
- **4 行 case**：动作=换装后 window-list；失败=host-integrity SHA 不符且 codesign verify 失败；归责=cp -r 解 symlink；保护=DMG 卷内复验 fail-closed

### Qwen3-VL 恒输出相对坐标 [0,1000]；Path C reparse-wins 要求双端 lockstep（2026-09-07 · #423）
- **坑**：Qwen3-VL 官方约定改为**原图相对坐标 [0,1000]**（Qwen2.5-VL 是绝对像素）——包括恰好落在像素界内的值（raw 174 在 640 宽图上是 111px 不是 174px）。旧 L-QW-3「clamp-only 永不 rescale」前提证伪，评测门 0/10。复杂 GUI 下 10/10 输出数组形态 `{"x":[x,y],"y":[y]}`——点在 x 数组，y 是冗余拷贝（d9 反例：y[0] 错 x[1] 对），取点规则 `(x[0], x[1])`。另一个坑：`qwen-vl-locator.ts` Path C 用 `parseGuiClickPoint(raw)` **重解析并覆盖** worker 返回点——只修 Python worker 会被 TS 侧打回，必须 `worker.py` / `qwen-vl-coords.ts` / `gui-action-parse.ts` 三处 lockstep。
- **纪律**：VLM 坐标问题先实证判空间（探针图 + 多尺寸），别信 prompt 声明（prompt 写 "pixel coordinates" 模型仍吐 0-1000）。评测门 FAIL 先查 harness 约定。修复后 0/10 → 6/10，余 4 例是 2B 感知误差（#363 摘帽仍 blocked，候选：4B 变体 / few-shot point_2d / bbox 取中心）。
- **4 行 case**：动作=CU 定位评测；失败=0/10 全 MISS 钳到边缘；归责=坐标空间约定错配 + 数组形态被 bracket 正则捡漏；保护=always-map + 真 JSON 解码 + 双端同构测试

### 知识库导入 concat-per-chunk `btoa` 会毁掉 PDF（2026-09-03 · #282）
- **坑**：对话框附件 `FileReader.readAsDataURL` 整文件编码；知识库单篇导入按 `CHUNK=0x8000` 分块 `btoa` 再拼接。`0x8000 % 3 === 2`，每块被 padding，拼出的不是原字节。companion `pdf-parse` 报 `Invalid PDF structure`。解析器相同，**喂进去的字节不同**。&lt;32KiB 只有一块所以碰巧能过；「导入文件夹」走 companion 读盘也不经过这段。
- **纪律**：浏览器侧二进制 → base64 用 `readAsDataURL` 或「拼 binary 字符串、**一次** `btoa`」（`bytesToBase64`）。禁止 `base64 += btoa(chunk)`。回归：`chrome-extension/tests/knowledge-file-base64.test.ts`。
- **4 行 case**：动作=知识面板导入 &gt;32KiB PDF；失败=Invalid PDF structure、对话框同文件成功；归责=分块 btoa padding；保护=与 composer 同一编码

### 嵌套 grok `--output-format text` 非法；`kimi -p` 不能配 `--yolo`/`--auto`（2026-09-03 · Gate10）
- **坑**：grok CLI 只认 `plain|json|streaming-json`，`--output-format text` 立刻 exit 2。`kimi -p` 与 `--yolo`/`--auto` 互斥，立刻 exit 1。本会话 Gate10 第二路因此空转两次。
- **纪律**：独立 grok 评审用 `grok --prompt-file … --output-format plain`。kimi headless 只用 `kimi -p "…" --output-format text`（不要 --auto/--yolo）。Pi 仍不在 PATH 时第二家族用 kimi。
- **4 行 case**：动作=派 grok/kimi 独立评审；失败=0.4s 退出、无报告；归责=flag 抄 claude 的 text / 把 yolo 接到 -p；保护=Gate10 改 kimi -p 成功出 AWN

### tmux `capture-pane` 看不到 Kimi 折叠块（2026-09-03 · 接手）
- **坑**：Kimi TUI `ctrl+o to expand` 在 pane 里是折叠的。只读屏幕会漏掉「被打断的开闸 / 查重判断」正文。用户会说「你看下输出呢」。
- **纪律**：接手另一窗 Kimi = `tmux list-panes` + `capture-pane` **加上** `~/.kimi-code/sessions/…/agents/main/wire.jsonl` 里 `content.part`（含 `think`）。不要把 TUI 状态条 `[+132 -48]` 当活工作树——另一 agent 可能已 commit。
- **4 行 case**：动作=接手 kimi 优化；失败=跳过打断工作和查重判断；归责=只信可见 pane；保护=展开 wire.jsonl

### `classifyError` 默认 `non_recoverable` 会杀掉准入闸（2026-09-01 · #265）
- **坑**：page-tool 无活清单时 `PROPOSE_REQUIRED`。若先走 `classifyError`，默认 fallthrough = `non_recoverable` → **整轮对话死**。若当 recoverable 再进 `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`，三次 gated click 也会杀轮。plan dual 2× AWN 点名此序。
- **纪律**：adapter 先认 `proposeDenied`；闸错误**绕过** classifyError 与同工具失败计数。`runChatCreate` 必须 sticky-clear `run_progress: null`，否则 leftover H1 / 上轮清单让测试（`m2-untrusted-marker` 的 `get_page_text`/`get_page_html`）撞闸、注入断言假红。
- **4 行 case**：动作=无清单时 click；失败=整轮被非恢复错误杀掉 / CI 假红；归责=默认分类器 + 闸当普通工具错；保护=准入闸独立短路、每轮 chatCreate 清清单

### PAGE_TOOLS 必须抄活 catalog 名，不是规格口语（2026-09-01 · #265）
- **坑**：spec r1 写 `drag` / `read_page`。活工具是 `drag_and_drop` / `get_page_text`。闸名单写错 = 真页面工具漏网，或闸住不存在的名字。
- **纪律**：`RUN_PROGRESS_PAGE_TOOLS = TAB_LEASE_TOOLS ∪ {create_tab, osascript_eval, host_computer}`。对照 `COMPANION_TOOLS` 实名，禁止凭记忆缩写。`mcp__*` 目前不在名单（已知残留）。worker 线程 HARD_DENY propose **且跳过** page-tool 闸。
- **4 行 case**：动作=模型 `get_page_text`；失败=闸不认口语名；归责=规格名 ≠ catalog；保护=从 TAB_LEASE 集合派生

### overlay 写进度只信 WS `handshakeSurface`，不信模型袋（2026-09-01 · #265）
- **坑**：若 `run_progress_propose` 读 `params.surface`，overlay 可自报 panel 改清单（纸门）。ACL 必须从握手戳来。
- **纪律**：`server.ts` 用 `getWsAuthState` 盖 `handshakeSurface`；dispatch 只看该戳。overlay 写 fail-closed。禁止 overlay Allow/Deny。
- **4 行 case**：动作=overlay 带 `params.surface=panel` propose；失败=若信模型袋则越权写；归责=caller 自报 surface；保护=握手戳单一写者

### `listSig` 必须哈希全表，不能 `live:0`（2026-09-01 · #265）
- **坑**：Wave 1 sticky 残 H1 待办会挡住新任务。remount key 若只看 `live:0`，空活清单不卸旧表，用户仍看见上轮步骤。
- **纪律**：`ChatView` `key={`${activeThreadId}:${listSig(runItems)}`}`；`listSig` 扫全表。下轮 user turn leftover **替换**（chatCreate 清）。同请求第二次 propose = `ALREADY_HAS_STEPS`。
- **4 行 case**：动作=新任务开跑；失败=顶上仍是旧 compact 残单；归责=remount 签名太窄；保护=全表签名 + 每轮清

### companion 无 `.nvmrc`：`nvm use` 静默失败 → stale `.test-dist` 假测试失败（2026-08-31 · #264 验证）
- **坑**：`nvm use >/dev/null 2>&1 && rm -rf .test-dist && tsc …`——`nvm use` 无参时要读 `.nvmrc`，companion 没有该文件 → 非零退出 → `&&` 链整体跳过重编译，后续 `node --test .test-dist/…` 跑的是**别人（grok 1 小时前）留下的旧编译产物**，报出源码里已不存在的断言失败（假 RED）。
- **纪律**：跑 companion 测试前先核对 `.test-dist` mtime 新于最新源码 mtime；或拆成 `;` 让 tsc 无条件执行。诊断先看产物时间戳，别先怀疑代码。
- **4 行 case**：动作=验证 #262 修复；失败=run-progress 源扫描测假失败；归责=stale .test-dist（nvm use 跳链）；保护=mtime 对比后再信测试结果

### squash 合入后 `git cherry` 仍会给原 commit `+`（2026-08-29 · 对齐 main）
- **坑**：overlay 会议台/默认展开已随 #246 squash 进 main，本地 `597a5827`/`b6ac5928` 仍 `cherry +`。把 overlay 枝合进后来的 main 会倒退 A–F（XSS/cookie/HMAC Origin）。
- **纪律**：判断「是否已在 main」看**产品字符串/文件**（`开始录制`、`hud expanded`），不要只看 SHA/`cherry`。`gh pr merge --delete-branch` 若有 worktree 占着 **被删的功能枝或 `main`**，远程已合、本地 checkout/删枝会失败——先 `worktree remove`（#266 即 worktree 占着 `feat/265-runprogress-live-plan`）。
- **4 行 case**：动作=整理本地 vs origin/main；失败=差点把旧 overlay 压上新 main；归责=squash 改 patch-id；保护=合入以 PR SHA 为准

### kimi `-p` 不能配 `--yolo`；VibeSOP hook 污染 stdout（2026-08-29）
- **坑**：kimi CLI `-p` 与 `--yolo`/`--auto` 互斥。UserPromptSubmit hook 把整段 routing JSON 灌进 `-p` 输出，文件头不是评审。Pi 不在 PATH → 用 kimi+claude 顶 dual。
- **纪律**：embed prompt 文件；`grep VERDICT` 取 **最后一行**；hook dump 不当评审正文。`scripts/dual-external-review.sh` 仍要 pi。
- **4 行 case**：动作=kimi dual；失败=误读 hook 当 VERDICT；归责=stdout 不纯；保护=last VERDICT 才是门

### handshake `panel` 是扩展 Origin，不是第三号忽略名单（2026-08-29 · #252/#254）
- **坑**：Batch E 把 chrome-extension omit stamp 成 `panel`。F2 strawman「忽略 panel」会杀掉唯一合法 `tab.navigated` 发送者，evaluate 信任缓存过期。
- **纪律**：`tab.navigated` 只认 Origin `chrome-extension://`；tray Origin 静默丢。`__cmspark_surface` 保持二元 `summoner|tray`（panel 握手 collapse 成 tray stamp = panel holder）。扩展自称 `summoner` → terminate（overlay 租约盗窃）。
- **4 行 case**：动作=扩展推 tab.navigated；失败=按 surface 忽略 panel；归责=Origin 类与 surface 名混用；保护=evaluate 自动批准只信扩展当前页

### `ThreadManager.get()` 禁止 `saveIndex`；unbound SkillEngine 勿缓存 fallback 单例（2026-08-29 · #250）
- **坑**：`get()` 为 seed `run_progress` 写盘 → 第二份 TM 空快照盖活 index。SkillEngine `new ThreadManager()` 各持一份。测试 fallback 若模块单例，后建线程对 unbound engine 不可见。
- **纪律**：`get()` 只内存 seed；`server.ts` `bindThreadManager` 一次；测试 `fallbackThreadManager()` **每次** `new ThreadManager()` 读盘。源码扫描测用 `srcFile()` 双候选（`.test-dist` 下 `__dirname/../src` ENOENT）。
- **4 行 case**：动作=侧栏 get 线程；失败=index 被空快照砸；归责=读路径写盘 + 独立 TM；保护=技能目录不被 get 写坏

### tray `sendRequest` 的 `id: tray-N` 不是会议 id（2026-08-28 · overlay 会议台）
- **现象**：浮窗点「我已了解」后会议台空、hint「meeting not found」。
- **根因**：`CompanionClient.sendRequest` 把 RPC 相关写成 WS `id: tray-${n}`。`meeting.start` 把 `msg.id` 当会议 id → `loadMeeting("tray-5")` 失败。`meeting.end`/`append`/`minutes` 若 `Object.assign` 用会议 id 盖掉 RPC id，pending 对不上、HTTP 5s 超时。
- **纪律**：(1) RPC 永远 `id=tray-N`；(2) 域 id 走 `meeting_id`；(3) handler `resolveMeetingId` 忽略 `/^tray-\d+$/` 和非 `isSafeMeetingId`；(4) overlay 解析响应用 `meeting.id`（`mtg_…`），不要顶层 `id`。
- **4 行 case**：动作=overlay `meeting.start` 无会议 id；失败=not_found；归责=RPC id 与域 id 同字段；保护=无 id 则内部 create，有 `mtg_` 才 load

### Chrome 已在跑时 `--app --window-size` 会被丢掉（2026-08-28）
- **坑**：用户 Chrome 已开，CLI `--window-size=360,420` / `--window-position` 常被忽略；`window.resizeTo`/`moveTo` 对 `--app` 也经常失败。狗食看到的是默认大窗 + 折叠 HUD。
- **修**：独立 `--user-data-dir=~/.cmspark-agent/overlay-chrome`；关窗走该 profile 的 PID，不要 `pkill -f CMspark.app`（会匹配当前 wrapper）。
- **4 行 case**：动作=托盘开 Capture 卡；失败=巨大空白 Chrome 窗；归责=共用用户资料；保护=overlay 必须自己的 Chrome profile

### Overlay 内联 JS 活在 TS 模板字符串里：转义一坏整页脚本不跑（2026-08-28）
- **现象**：只有原生 `<label for=files>` 能点，发送/会议/麦全死。
- **根因**：`SUMMONER_HTML` 是 TS template。`esc()` 对象字面量、`alert("a\n b")` 的 `\n` 变成真换行 → `new Function(script)` 都过不了。
- **纪律**：改 overlay 脚本后必须用 HTML `<script>` 抽出来 `new Function`；禁止在模板里写未转义的 `` ` `` / `${` / 真实换行字符串。
- **4 行 case**：动作=点发送；失败=静默；归责=模板把 JS 弄坏；保护=测锁 parse + 看得见的发送钮

### `chrome.sidePanel.open({windowId: lastFocused})` 会开到 overlay `--app`（2026-08-28 · #244）
- **坑**：浮窗自己就是 last focused。点「打开浏览器并打开侧栏」侧栏挂在 360×420 `--app` 上。
- **修**：SW 只对 `chrome.windows.getAll({windowTypes:["normal"]})` 调 `sidePanel.open`。Companion 永不 `chrome.*`。
- **4 行 case**：动作=overlay 打开侧栏；失败=侧栏进了卡片窗；归责=lastFocused=自己；保护=只绑普通窗

### `pgrep -f /Applications/CMspark.app` 会杀掉正在跑的 wrapper（2026-08-28）
- **坑**：诊断/热替换脚本的 argv 含该路径，`pgrep -f` 命中自己 → SIGTERM，命令没跑完。
- **纪律**：按 PID 杀；`ps -ax` + 过滤；热替换：`daemon stop` → `/bin/cp -f dist/cmspark-agent.js` → `open -a CMspark`。先 `tsc` 再 `bundle:exe`（package.sh 内联 MCP，dev `bundle:exe` 的 externals 列表已够当前 .app）。
- **4 行 case**：动作=热替换狗食；失败=脚本自杀；归责=-f 匹配 cmdline；保护=按 PID / 不用 pkill -f 包路径

### `xattr -cr` 换装会撞 SIP `com.apple.provenance`（2026-08-31 · S102）
- **坑**：项目旧纪律写「ditto 后 `xattr -cr`」。whisper / libggml 是 `r-xr-xr-x` 且带 SIP 保护的 `com.apple.provenance`，`-cr` 对它们 `Permission denied`，脚本在 `set -e` 下中断。
- **纪律**：(1) `daemon stop` → `osascript` quit → **按 PID 逐个** `kill -9`（整表 `kill $(ps…)` 不可靠）→ `ditto` 覆盖 `/Applications/CMspark.app`；(2) 只剥 Gatekeeper：`xattr -dr com.apple.quarantine`；(3) `codesign --verify` + A6 单 CDHash；(4) `open -a CMspark`。本机换装**不要**留 `~/CMspark.app.bak-*`（用户明确不要备份）。shell 里 `du` 可能是 `dust` 别名，尺寸用 `/usr/bin/du`。
- **Skill**：`docs/skills/cmspark-macos-app-replace/SKILL.md`
- **4 行 case**：动作=0.5.6 DMG 换 0.5.3；失败=`xattr -cr` 权限错；归责=SIP provenance + 只读 Mach-O；保护=只剥 quarantine、按 PID 杀残进程

### Overlay 会议 45s 窗 = 「没有实时转写」（2026-08-28）
- **坑**：侧栏近实时是 ~8s + `voice.stt.partial_request`。浮窗 ScriptProcessor 用听写 45s 硬顶，第一段字很晚才来，用户以为没转写。
- **修**：会议 `STT_MEETING_MS=8000` + `/api/stt/partial` 轮询；听写仍 45s。说话人是本机 k-means 匿名「发言人N」，不是认人。
- **4 行 case**：动作=开始录制；失败=空台；归责=窗长抄了听写 cap；保护=会议跟 MeetingPanel 近实时

### T1 Playwright 干净 profile 打不开门户 ≠ 撞上 SSO 登录墙（2026-08-27）
- **现象**：日常 Chrome 已打开 OA 可读邮件；bundled Chromium / Chrome channel / 空 user-data-dir GUI Chrome 对 `oa`/`home.cmschina.com.cn` 均 `ERR_EMPTY_RESPONSE`（~150ms，198.18 fake-ip，MacPacket `127.0.0.1:1082` 同样 empty reply）。curl 亦然。
- **纪律**：对照臂必须是**新用户目录**，禁止 Chrome DevTools MCP（挂着已登录 Chrome）。没见到登录表单就**不得**对外说「证伪 SSO」。L7 可 PASS 带 nit：CMspark 完成、干净浏览器打不开；**仍禁**扩 outbound profile。
- **4 行 case**：动作=同一任务 Playwright 空 profile；失败=打不开而非登录墙；归责=TUN/fake-ip + 已打开标签 vs 新连接；保护=ADR-022 L7 诚实、不扩 cookies/evaluate/L2

### C-thin loopback URL 只许 `token`：加 `&thread=` 会静默打不开（2026-08-27 · #239）
- **坑**：`isSummonerLoopbackUrl` 曾要求 query **恰好一个** key=`token`。`openLoopbackPage(url+"&thread="+id)` 被拒，`planSummonerShellOpen` error，不 spawn。测试只锁字符串拼接，绿了但窗没开。
- **修**：keys = `token` 或 `token`+非空 `thread`；其它 key 仍拒。空 `threadId` 不追加。`openLoopbackPage===false` 不得 success notify。
- **4 行 case**：动作=弹出对话框带 thread；失败=URL 门拒双 query；归责=安全门与产品 query 没一起测；保护=HTML 壳只能开 loopback token URL

### token 出 argv 后 `&thread=` 会进 pathname（2026-08-29 · #250 Batch D）
- **坑**：`summonerWebPageUrl` 不再带 `?token=`，menu-bar 仍 `url+"&thread="+id` → `http://127.0.0.1:P/&thread=X`。WHATWG 把 `&thread=` 当 **path**，query 空，`isSummonerLoopbackUrl` 曾放行 → GET 不是 `/` → 无 Set-Cookie → **403**。弹出对话框死，托盘空 thread 仍绿。
- **纪律**：无 `?` 用 `?thread=`；pathname 只许 `/` 或 `/summoner`；测必须构造 URL 再 `isSummonerLoopbackUrl`，不能只扫源码 `"&thread="`。
- **相关**：Cookie first-paint（EventSource 不能自定义 header；`GET /` Host 闸 + Set-Cookie，不要 Secure）。
- **4 行 case**：动作=侧栏弹出对话框；失败=首屏 403；归责=token 出 query 后拼接没改 join；保护=overlay 钥匙不进 argv 且窗能开

### `placeWindow(true)` ≠ 展开脸（2026-08-27 · #239）
- **坑**：`.body{display:none}`，`.hud.expanded .body{display:grid}`。只改窗口高度仍是收起条。测 `/placeWindow\(true\)/` 会绿错实现，且 `setExpanded(true)` 源码是 `placeWindow(!!on)` 对不上字面量。
- **修**：默认 `setExpanded(true)`。spawn `--window-size=720,520`（否则先画 120px 条）。
- **4 行 case**：动作=HTML 空态整张脸；失败=高了但没内容；归责=高度≠ CSS expanded；保护=L0 浮动空态真看见招呼

### tray `onAppMessage` 滤确认 ≠ 已订阅 overlay 推送（2026-08-27 · #239）
- **坑**：`companion-client` 会 fan-out 无 `id` 的 push。`menu-bar-agent` 现有 cb 只处理 `security.confirmation.request` 然后 `return`。broadcast `overlay.shell.open` 到 tray 等于没人开窗。带 `id` 的 broadcast 还会被当成 RPC 响应吃掉。
- **修**：**另**挂一条 `companionClient.onAppMessage`。payload 仅 `{type,thread_id}` 无 id。不要挂 `summonerClient`（防双开）。
- **4 行 case**：动作=companion broadcast 开壳；失败=tray 当空气；归责=fan-out≠订阅；保护=扩展起源弹出必须有人 openLoopbackPage

### Overlay HTML 无 `chrome.tabs.query`；浮窗「当前页」会逼 ACL 涨（2026-08-27 · #239）
- **坑**：Gemini「正在分享标签」是 Chrome 一等。扩展 Side Panel 可以 `tabs.query`。C-thin HTML 要标题就得 `list_tabs` / SSE `tab.*` → F-S-5。标签栏药丸扩展做不到。
- **纪律**：芯片只在 Side Panel。Overlay HTML = 无页变体。禁止 `list_tabs`/`tab.*`/`ui.dock` 进 `SUMMONER_ALLOW` / C-thin dispatch / overlay SSE。
- **4 行 case**：动作=四处同一张脸含正在看；失败=不可信 HTML 要 tab API；归责=把 Gemini 手抄进 Capture；保护=overlay ACL 不涨

### `SET_PROCESSING_STATUS` 当 toast 会拆掉空态（2026-08-27 · #239）
- **坑**：ChatView 有 processingLabel 就藏 EmptyState，画出带 `...` 的思考泡。弹出失败走这条像模型在想，且不清。
- **修**：`cmspark:toast` → App `showToast` 4s。文案 `无法弹出对话框`。SW `{ok:false}` / `lastError` 也 toast。业务码走 companion `error` 帧（bulk-forward 立刻 `{ok:true}`）。
- **4 行 case**：动作=Companion 没开点弹出；失败=空态消失变思考中；归责=错用 processing 通道；保护=失败可看见招呼+toast

### Capture 召唤器「淡不掉」= `NSApp.activate` 抢前台（2026-08-27 · #229）
- **坑**：HUD 已是 `.nonactivatingPanel` + `canBecomeKey`，但 `open()` 仍 `NSApp.activate(ignoringOtherApps: true)`。关条 `orderOut` 后用户停在 CMspark，不是 Chrome。Confirm HUD 注释已写 do NOT activate。
- **修**：Capture `open(threadId:)` 只 `makeKeyAndOrderFront` + `orderFrontRegardless`。测禁 `NSApp.activate(`（带括号，避免吃到注释）。🎙/📎 模态仍可 activate（残留）。
- **测**：regex 看不见 Dock；DoD 1 须对着 Chrome 热键狗食。改 Swift 必 `build-tray.sh` + 更新 `SWIFT_TRAY_SHA256`。安装包不会自动含新 tray。
- **4 行 case**：动作=#229 热键开条；失败=前台被抢走；归责=activate 与 nonactivating 打架；保护=L0 Capture 不抢 Chrome/Codex

### H1 `open_todos` 改成对象会炸「查看摘要」（2026-08-27 · #237）
- **坑**：`ChatView` `<li>{t}</li>` 假定 string[]。persist `{text, tool}` 后 React *Objects are not valid as a React child*。
- **修**：sanitize 接受 string | `{text, tool?}`；notice/摘要只渲染 `.text`；hash JSON **含** `tool`。`tool` 仅 `^[a-z][a-z0-9_]{0,79}$`，不 `.toLowerCase()`（`Navigate` 丢 tool）。无 tool 的 seed 仍只能点。
- **测**：`docs/mcp.md` 曾钉死「尚未跑」——改 T1 叙事必须同步 `outbound-mcp-docs-grant.test.ts`。
- **4 行 case**：动作=H1 待办带 tool；失败=摘要崩溃 / 契约测红；归责=UI 类型与 SoT 分叉 + 文档被测锁；保护=不按中文猜工具、不 tick model_draft

### C-thin 召唤器：窗口像素必须和 CSS 布局同宽（2026-08-25 · Win dogfood）
- **现象**：用户说知识/MCP「没法点开」。窗是 `--window-size=640,720`，HTML 却 `@media (max-width:720px){ .list{display:none} }`，轨钮改的是看不见的列表。
- **产品第一眼**：默认必须是**居中小条**（composer only），不要一开就是展开工作台。展开后再露出 52+216+主列。
- **纪律**：(1) `--window-size` 与 `placeWindow`/`resizeTo` 用同一套折叠/展开尺寸（720×120 / 720×520）；(2) 禁止用「窄于工作台」的 media 把列表藏掉；(3) 官方 Windows 换装走 `package.sh windows-x64` + `CMspark-Setup-v*.exe /S`（`node.exe`+`cmspark-agent.js`），**不是** SEA `cmspark-agent.exe`——LOCALAPPDATA 现网是 NSIS。
- **4 行 case**：动作=640 宽 `--app` + 点知识轨；失败=列表 display:none；归责=窗口规格与 CSS 各写各的；保护=召唤条先出现、展开后三栏都可点

### overlay 新 WS 类型必须 background relay + 未跟踪文件必须 stage（2026-08-25 · knowledge honesty）
- **坑 1**：Side Panel `chrome.runtime.sendMessage({type:"knowledge.preview"})` 若 `background/index.ts` 无 `case`，companion 永远收不到。Wave 0b r1 Pi **REJECT**。同类：`knowledge.related` / `thread.distill_preview` 必须同时进 validate、router、background、useWebSocket。
- **坑 2**：`DATA_DIR` 若在 `config.ts` **import-time** 快照，`initDataDir()`/`saveIndex` 用 live `getConfigDir()` 会 ENOENT（P1 D8）。测须 `getConfigDir` live + `modulesToClear`。
- **坑 3**：`scripts/dual-external-review.sh` 只 `git diff HEAD` + `--cached`。**未跟踪** 的 `knowledge-related.ts` / `distill.ts` 不进 patch → 外审漏看。审前 `git add` 新文件，不要 `git add .`。
- **坑 4**：F-UX-NOUN-1 禁「图谱」。Wave 2 在 ThreadList 加「话题」时 overflow 仍写「关联图谱 / 类 Obsidian」→ Product **REJECT**。同面板改名词必须扫可见 copy。
- **4 行 case**：动作=Wave 0b/2 接线+dual；失败=preview 不到 companion / patch 无新文件 / 图谱卡话题夹；归责=relay 漏 case + 评审脚本不收 untracked + 名词锁未扫旧菜单；保护=overlay ACL 零增长、知识确认导入、话题夹不是 Project

### leftover / drain / redact 测钉窗口（2026-08-25 · #221）
- **take→drop 窗**：`convertLeftoverSteerToNextRun` 先 `takeSteer` 再 enqueue。测若在 helper **返回后** 才 `enqueueSteer` concurrent，往 full 路径塞 `dropSteer` 仍绿（队列已被 take 掏空）。必须 `_setAfterLeftoverTakeForTests` 打在 take 与 enqueue 之间。
- **drain 先闸再 take**：pause/trash/`MULTI_AGENT_LLM_CAP` 若在 `takeNextRun` 之后，客户端已持 `chat.enqueued` 的回合会被丢掉。upload/regen **不得** `return drainedAfter*`（推 frame，原 RPC 恒 `file.uploaded` / regen `null`）。
- **redact 调用点 ≠ 正则**：thread-JSON 与 `history/store.ts` 即使 `SENSITIVE_KEY_RE`+leaf 字节相同，cookie params / 通用工具分支仍可跳过扫描。`{Authorization:{value:"…" }}` 对象袋：内层 `value` 不是敏感 **键名**，须整袋 collapse，不能只 recurse。
- **不要**全局 redact 裸 `value`（误杀 get_page_text 等字段）。
- **4 行 case**：动作=折 #220 对抗残留；成功=#221 CI 绿合；归责=测钉错窗口 + history 调用点漏扫；保护=F1 adopt / 排队不丢 / threads.json+history.db 不落 Authorization 袋

### overlay HTML 不得直连 companion WS；`accepted` ≠ 已发送（2026-08-24 · #219 C-thin）
- **坑**：系统浏览器 Origin 是 `http://127.0.0.1`，`isAllowedWsOrigin` 只放 `chrome-extension://` 与 `cmspark-tray://local`。给 loopback 开 WS 等于拆 HMAC 前门。
- **修**：HTML 走 settings-web 同款 loopback+token HTTP；tray `surface=summoner` 客户端代发。chat.create 是 fire-and-forget → HTTP 只回 `{type:accepted}`；忙时 `run_active` 是随后的 `{type:error,error:run_active}` 推送。页面把 accepted 画成「已发送」会撒谎。
- **纪律**：SSE `/api/events` 白名单转发；`security.confirmation.request` 禁止下发。打开 URL 只允许 `http://127.0.0.1|localhost` + **唯一** query `token=` 且 **64 hex**；Win32 `cmd.exe /c start "" url` **禁止** `shell:true`。

### `OVERLAY_STANDBY` 的 SoT 是 `data.error_code`，不是英文 `error` 整句（2026-08-24 · #219 SSE r1 REJECT）
- **坑**：router `gateChatCreateOnLease` 返回 `error: "OVERLAY_STANDBY: composer is on the other surface"` + `data.error_code: "OVERLAY_STANDBY"`。UI `labels[d.error]` 永远 miss，用户看见英文；单测只 grep HTML 里有「侧栏占用了输入」= 戏台。
- **修**：`summonerWebEventStatus` / HTML `statusFromEvent` 用 `error_code || data.error_code`，前缀含 `OVERLAY_STANDBY` / `LEASE_REV_MISMATCH` 都映射中文。测必须喂真实 router 形状。
- **同类**：lease claim 失败是 `composer.lease.error` / `LEASE_REV_MISMATCH`，不是 OVERLAY_STANDBY。

### overlay STT：start 失败后 fire-and-forget chunk/end 会盖掉真错误（2026-08-23 · S77）
- **现象**：麦报 `no matching session`。config `localModelId=small`，盘上只有 medium/large；start 已 `model_missing`。
- **根因**：(1) 模型 id 不回退；(2) start 失败后仍异步发 chunk/end，后到的「无 session」盖掉 start 错误；(3) click 只送 44 字节 WAV 头。
- **修**：`resolveSummonerSttModelId` 回退已装模型；`handleSummonerMic` **await start**；太短给文案；click-to-toggle。
- **纪律**：STT 多段协议里 **start 必须是门**；失败路径禁止再发 chunk/end。

### Swift overlay 流式 flicker：勿每 token 拆泡 + 半截 markdown + 改窗尺寸（2026-08-23 · S77）
- **坑**：每个 delta 毁掉全部 bubble、对不完整 markdown 再 parse、`setContentSize` → 闪。
- **修**：流中只 patch 最后一条 **纯文本**；`markDone` 再 markdown；流中禁止 resize；`CATransaction.setDisableActions`。
- **纪律**：流式 UI 与终态渲染分相；AppKit 布局动画默认开。

### `pkill -f cmspark-tray` 会匹配到自己的 bash（2026-08-23）
- **坑**：命令行含 pattern，bash 先进进程表，`pkill -f` 先杀自己。
- **修**：按 PID 杀；或 pattern 写得不可能匹配当前 argv。

### 改 `Tray.swift` 必须重编并钉 `SWIFT_TRAY_SHA256`（S77 仍有效）
- launcher 启动校验哈希，不匹配则自动重编。rebase 改写 commit SHA **不等于** 二进制 SHA——二进制变了才改 pin。
- 编：`bash companion/src/tray/build-tray.sh` → 更新 `swift-tray-bridge.ts`。

### worktree 测 companion 缺 `node_modules` 会假红（2026-08-23）
- 新 worktree 默认没有依赖。测前 `ln -s` 或 `npm ci`。`dist/index.js` 也要 `npm run build`，否则 daemon 起不来。

### `formatChatErrorLine` 不得把硬闸/批准后失败说成拒窗（2026-08-20 · #203）
- **坑**：`errorLevel==="security"` 无分流 → scheme/cage/批准后 regex 都带「若你已拒绝弹窗」
- **修**：硬闸走「这不是确认弹窗」短接；deny / timeout / unavailable / leftover 分句；`looksLikeUserDeniedGateCopy` 排除「不是你拒绝了」
- **扩展**：`gate-error-copy.ts` 必须 lock-step

### 单测文件 `bindCompanionDispatchRuntime` + 模块级 `HOME=` 污染并行 `npm test`（2026-08-20）
- **坑**：新文件 `before()` 绑 stub `_rt`、顶层改 `process.env.HOME` → 同进程 computer-executor / allow-dir 红
- **修**：C-N1 类断言放进已有 `security-gates.test.ts`（server 已 bind）；不要为 dispatch 单测另开污染文件

### 清理空白 / 整理助手扫不到「未命名」编程接力 husk（2026-08-17 · #193）
- **现象**：点完整理+清理空白，列表仍有 `#rny77t` / `p1-wl` 一类意义不明行
- **根因**：(1) `cleanupEmpty` 只硬删 `message_count===0`，ACP handback 一写入 assistant 就免疫；(2) 整理默认 `to=now-30d`，近端 husk 根本不进扫描；(3) 规则无 `no_user`/`acp_husk`；(4) 自动起名要 user 消息
- **产品锁**：无意义=无 user 回合，不是标题不好听；`cleanup_empty` 语义冻结；整理默认「全部（含近期）」
- **相关**：`docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md` · PR #193

### ACP 失败词禁止扫 handback 正文（2026-08-17 · #193 对抗 REJECT）
- **坑**：`isAcpFailTemplate` 对 `denied|timeout|cancelled` 做 `includes()`，扫的是 assistant 前 400 字（已进入 `### 摘要` DATA）
- **后果**：实质 diff（`t4s8kw` 类）正文提到 timeout → 被标 `acp_husk` 并预勾进回收站
- **修**：只看第一方标题行（`【编程接力 · …】完成|部分`）；薄 husk 靠字数 &lt;200，不靠正文英文词
- **纪律**：不可信 handback 不得当删除谓词、标题或列表证据

### cleanup_empty 的 Trust 释放必须与 exceptId 对齐（2026-08-17 · #193）
- **坑**：先对所有 0 消息线程 `releaseTrustBeforeThreadGone`，再 `cleanupEmpty(exceptId)` 留下当前草稿
- **后果**：刚 `+新建` 且绑了 Pack Trust 的空槽被清 cookie，会话还在
- **修**：release 循环跳过 `except_thread_id`；整理扫描同样 exclude active

### SW 转发 suggest_cleanup 必须显式带 except_thread_id（2026-08-17 · #193）
- **坑**：Side Panel 发了 `except_thread_id`，background 只转发 `from/to/include_workers` → companion 仍预勾当前空草稿
- **纪律**：新增 WS 字段要同时改 panel → SW → validate/router；不要假设整包透传

### L2_GATE_TOOLS ≠ 永远弹确认（ACP B1 · 2026-08-13 · S70）
- **现象**：工具在 `L2_GATE_TOOLS` 里，但 `auto_approve_dangerous` / god-mode / 三旗巡航下仍无对话框就拿到 `security_token`
- **根因**：`skipConfirmation` 为 true 时只有 `capabilityForceConfirm`（及 host_computer 特例）会 `forceConfirm`；漏加则走 auto_approved 发 token
- **修法**：关键 spawn 类加入 `capabilityForceConfirm`；若产品要求永不巡航跳过（如 ACP），用 `forceConfirm = acpForceConfirm || (… && !userFullAutonomy)`
- **相关**：`companion/src/tool/l2-admission.ts` · ADR-025 · Pi dual-review REJECT

### Ghostty/macOS 终端：禁止 spawn CLI，用 open -na --args（2026-08-14 · #190）
- **现象**：选了 Ghostty 仍开系统 Terminal；或 spawn 无窗口
- **根因**：(1) `coding_handoff.local_terminal_app` 未落盘 → `auto`→Terminal；(2) Ghostty 文档：**macOS 不支持 CLI 起 GUI**，须 `open -na Ghostty.app --args -e bash -lc '…'`
- **修**：config.set 允许 `local_terminal_app`；Mode C 用 open-args-e；未安装**禁止**静默回退 Terminal
- **相关**：`companion/src/acp/open-local-terminal.ts` · PR #190

### ACP pending_diffs 必须带 applyable（否则 Apply CTA 死）（2026-08-14 · #190）
- **现象**：propose_diff 结束后侧栏没有「应用 diff」
- **根因**：`acp.handback.message` 带 `applyable`，随后 closed `acp.session.event` 的 `pending_diffs` 无该字段 → reducer 把 `hasPendingDiff` 冲回 false
- **修**：manager 写 `pending_diffs` 时同步算 `applyable`（与 lifecycle 谓词一致）+ 回归测
- **纪律**：extension 事件合同字段跨消息类型要对齐，后到的 event 不能静默降级

### skill_install L2 预览 picker 必须 === 安装 picker（2026-08-12 · #184）
- **坑**：`skillInstallOverwritePreview` 用 `entries.find(SKILL.md)` 第一个，install 用 `pickSkillMdEntry`（prefer skills/ + deepest）→ monorepo 上 L2 显示 name/overwrite 与真实写入不一致（token 绑定错误）
- **修**：共享 `SkillEngine.pickSkillMdEntryResult`；多 `skills/*/SKILL.md` **fail-closed**（L2 前硬失败 + candidates）
- **纪律**：改 zip 选择逻辑必须同步 preview + install + security-policy/l2 文案

### browser_download TIMEOUT 恢复 ≠ prefer_existing 无约束（2026-08-12 · #184）
- **坑**：超时后扫 chrome.downloads 若无时间窗 / 忽略 `force_redownload`，会返回陈旧 complete，违反 BD-WAITER「禁止 latch 预注册 complete」
- **修**：仅 `!force_redownload && (filenameHint||urlContains)`；`minCompletedAfterMs`（与 waiter **50ms** skew 对齐）；缺时间戳 fail-closed
- **纪律**：单测禁止用 `force_redownload:true` 断言 `cache_after_timeout` 成功

### 大 skill 包预算与 monorepo 子树（2026-08-12 · #184 / x9xinc）
- **现象**：dashiai-ppt ~46MB zip / ~81MB 子树 / 365 文件，旧 25MB·500 直接拒
- **修**：100MiB compressed / 120MiB extract / 2000 files；只计所选 SKILL 目录；`importSkillFolderFromPath` 免 base64；覆盖用 tmp→bak→dest
- **纪律**：改预算同步 stub/测试；size=0 且 compressed>64KiB 拒（zip-bomb 类）；生产 FromPath 必须有真实 zip 集成测

### `tsconfig.test.json` 绿 ≠ 生产 `tsc --noEmit`（2026-08-18 · #196）
- **坑**：扩展 `npm test` 只编 `tsconfig.test.json` 的 include 白名单，**不编** `ChatView.tsx` 等组件。对测试套说「tsc 0」会漏掉 `TS1117` 重复属性
- **后果**：S12 外部 dual 两轮 REJECT（重复 `color` → 再生产 `tsc` 红）
- **纪律**：宣称机核必须跑 `chrome-extension` 的 **主** `tsc --noEmit`（`npm run build` 的前半）；dual prompt 写明「不得只信 test tsconfig」

### 行内 `color`（含 `inherit`）会杀死 stylesheet `:hover`（2026-08-18 · #196）
- **坑**：`styles.inviteRow` 先有 `color: tokens.text`，再补 `color: "inherit"` —— 修了 TS1117，但 **任何** style 属性里的 `color` 都压过 `.invite-row:hover`
- **修**：`inviteRow` **不准**写 `color`；颜色只活在 class CSS
- **测**：源码切片断言 `inviteRow` 块无 `color:`（jsdom 测不了 cascade）
- **纪律**：要 hover 变色就别在 React inline 上声明同一属性

### 320px 历史列表禁止 `absolute + left:0 + width:300`（2026-08-18 · #196）
- **坑**：chevron 在栏右侧，300px 下拉往右撑，Side Panel 视口裁成一半
- **修**：`createPortal` + `position:fixed; left:8; right:8`；`styles.panel` 基座也要是这套，禁止基座残留 300px
- **相关**：巡航短词 + 芯片占宽后更易复现

### dist-package 路径：源码 build ≠ 用户加载的扩展（2026-08-12）
- **坑**：用户加载 `dist-package/cmspark-macos-arm64/chrome-extension`，只 `chrome-extension/build` 无效；companion 须 **esbuild** `cmspark-agent.js` 再 cp（`tsc` 模块树不够）
- **修**：`npm run build` + `run-esbuild-bundle.mjs` + rsync extension + cp agent.js（含 dmg-staging Resources）
- **纪律**：改 UI/工具后问用户加载路径；热修后重启托盘/Companion

### analyze_image IMAGE_FETCH：三旗=风险自担，只硬拦疑似 SSRF（2026-08-12）
- **产品**：不是「为防 SSRF 一律 ban file://」；三旗全开后允许 `file://` 拉图并跳过图片确认；**云元数据 IP / javascript:** 仍硬拦
- **默认模式**：`file://` 仍拒（非确认窗，错误码 `image_fetch_file_requires_cruise`）— 用 screenshot
- **单旗** god-mode / auto_approve_dangerous **单独**不放行 image fetch 确认
- **纪律**：文案禁止写「若你已拒绝弹窗」套用到硬闸；硬闸 vs 确认 vs 风险自担三语分清
- **CI**：`security-gates` 勿再断言 `/Security Block/` for file:；对齐 `file_requires_cruise|三旗`（#183 曾因此红）

### 三旗路径 ≈ 无 path cage；只拦语义危险（2026-08-12 · #183）
- **产品法**：三旗 = 工具面 + 路径风险自担；几乎不拦普通路径；**残留地板**见 `cruise-path.ts`（volume/multi-user/OS 硬危险、worker download、modules、netsec allowlist、shell policy 空 allowlist）
- **模块**：`companion/src/security/cruise-path.ts` + MCP allow-dir expand / skill_install tier / shell cwd / browser-download
- **文案**：用户可见错误禁止 `god-mode` 作行动指引；写 **三旗 / cruise / MCP 面板加 allow path**
- **纪律**：改产品门后同步 `mcp-error-hints` / integration gates 断言；hot-patch `/Applications` 时须含完整 PR 栈（勿只打半截再丢 acquireLock）

### acquireLock 自检：本 PID 已持锁 ≠ already_running（2026-08-12 · #180→#181）
- **现象**：托盘在、Companion 秒退「already_running」——锁文件是 **自己** 的 PID
- **修法**：`heldLockPath` / acquire 幂等：同 PID 视为已持有，继续 init
- **纪律**：OPS-02 hold lock through init 后，锁获取必须 idempotent；热修 daemon 时别回滚到无 lock 修复的 bundle

### 线程 tool_whitelist：三旗巡航应扩面；MCP 名 `filesystem` ↔ `fs`（2026-08-12）
- **现象**：开了无人值守/三旗仍 `tool_whitelist_blocked`（list_tabs/shell）；用户以为权限已全局放开
- **根因**：
  1. 旧实现白名单与 L2 **正交**——三旗只免确认，不扩工具面（产品视角不符合）
  2. 用户在 **新线程**（如 cdl9qs）仍带 `["mcp__filesystem__*"]`，改 dsmgjn 不等于改当前对话
  3. 只改磁盘 `index.json` 时若 daemon 未重启，`saveIndex` 会用内存旧快照盖回
  4. `mcp__fs__*` ≠ `mcp__filesystem__*`
- **修法**：三旗巡航对 **非 worker** 线程 `isToolAllowed` 视为全开；adapter 用同一 gate 过滤 LLM 工具表；别名 fs↔filesystem；改策略走 `thread.update` 或重启
- **纪律**：查 blocked 的 **thread_id**；全工具 = 该线程 `null` 或三旗；勿假设「无人值守 arm」 alone 放开 shell

### MCP filesystem 失效 allow-dir 须 prune 回落 home（2026-08-12）
- **现象**：`args` 残留 `/var/folders/.../cmspark-allow-dir-*` → server dead；`ensureFilesystemAllowlist` 曾「有 path 就不注入」
- **修法**：启动/sanitize 时 drop 不存在的 allow-dir/roots，空则注入 home；测试用 `CMSPARK_DATA_DIR`，禁止污染用户 config
- **纪律**：allow path 必须 exists；改磁盘 config 后重启 companion

### 会议 STT soft-continue 与 max-1 槽：conflict/oom 绝不可 soft 空转（2026-08-12 · #179）
- **现象**：段失败一律 soft → `resource_conflict`/`session_busy` 占着 max-1 槽 → 后续段永久 conflict；坏二进制 sticky `infer_failed`/`binary_broken` soft 到 hard cap
- **修法**：soft 仅 `infer_failed|empty_result|infer_timeout|partial_skipped` + streak≤3；conflict abort+单次重试后硬停；`oom`/`binary_broken` **首击硬停**
- **诚实 UX**：soft banner 必须写「本段转写已丢失（不可恢复）；结束默认删音频」——不可暗示可重试本段
- **纪律**：改 STT 错误分类前对照 adversary F-merge-2；流式 start 错误与 end 错误勿双计 streak

### 本机 whisper 用户缓存路径：禁止「pin 失败仍 ok」（2026-08-12 · #179）
- **现象**：`…/bin/whisper/…` 路径 pin 失败仍 `ok:true, pinned:false` → 可写缓存可被替换执行（违 ADR-023 L5）
- **修法**：安装写 `install.manifest.json`（primary+dylib sha256）；resolve 时校验 manifest；无 manifest → 不接受 user-cache 旁路
- **残余**：manifest 与二进制同目录 → 防误配/损坏，**非**防本地攻击者替换；真 pin 需签包或 HTTPS 源
- **打包**：darwin 0 dylib 或仅 whisper 缺 ggml → hard fail；`otool` 残留 Homebrew 绝对路径 → hard fail

### 会议 AI 纠错：停录必须 drain refine 队列再 end/纪要（2026-08-12 · #179）
- **现象**：800ms 固定等待；LLM 慢时 `generate_minutes` 看不到 refined 段；`meetingIdRef` 换会后晚到 refine 可能 append 到新会
- **修法**：`createSerialRefineQueue().drain(22s)` → 再 `meeting.end` / silence-cut / minutes；append **pin 段所属 meeting id**
- **契约**：`priorContext` ≤2k 仅消歧；guard 仍对 **raw 段** 比长度；fail-open 保留原文；默认 `asrRefinerEnabled=false`
- **纪律**：correct_only（ADR-024）≠ 润色；job 拆 `asr_refiner` ≠ `meeting_minutes`

### Early SIGKILL 文案勿含 “OOM” 子串（2026-08-12 · #179）
- **现象**：runner `killed early (… OOM …)` + session 先跑 oom 正则 → dyld 死被标「内存不足」
- **修法**：early-kill 文案只用 dyld/binary/SIGKILL；映射顺序 **binary_broken 先于 oom**
- **纪律**：错误码文案是分类输入，禁止在「非内存」路径写 OOM 字样

### llm.oneshot / 同类 handler：校验 payload 先于 config/key 门（2026-08-12 · #174）
- **现象**：本地有 API key 时 empty `user_content` 测绿；CI 无 key 时先返回 `companion_llm_not_configured`，断言 `/user_content/` 失败
- **修法**：`handleLlmOneshot` 先校验 `user_content` 非空，再查 `api_key` / masked
- **纪律**：fail-closed 测试须覆盖「无密钥环境」；错误码顺序要确定性，不能依赖本机 `~/.cmspark-agent` 是否已配 key

### spawnHostBin 返回 stdout 字符串，不是 `{stdout}`（2026-08-12 · #174）
- **现象**：从 `execFileAsync` 迁到 `spawnHostBin` 后仍写 `result.stdout` → runtime/类型错
- **契约**：`spawnHostBin(bin, args, {timeoutMs}) → Promise<string>`；长进程用 `resolveIntegrityHostBin` + `spawn(realpath, …)`
- **纪律**：全路径 host 完整性只走 integrity 模块，禁 raw `execFile(cmspark-host)`

### zsh 监控脚本禁用 `status` 作变量名（2026-08-12）
- **现象**：`status=$(gh run list …)` 秒退 `read-only variable: status`
- **修法**：用 `st` / `row` / `concl` 等名
- **纪律**：shell 轮询 CI 脚本避开 zsh 只读特殊变量

### 默认工作区沙箱 ≠ 自动 bind workspace_root（2026-08-11 S65 · #165/#166）
- **产品**：未设置 `thread.workspace_root` 时 `workspace_*` **运行时**落到 `~/CMspark-projects`（mkdir `0o700`），**不**写 thread；folder-picker 显式绑定仍优先；`setWorkspaceRoot` 仍须 native pick；`shell_exec` cwd **不**跟沙箱
- **安全 nits**：沙箱根若为 **symlink** 会把 host_read 扩到其它家目录路径 → #166 `lstat` 拒绝 symlink + realpath 必须等于字面 `~/CMspark-projects`
- **文案漂移**：实现后 catalog/ChatView 若仍写「必须选工作区」会逼 LLM 假失败 → 工具描述与 UI hint 须同步 Scheme 1
- **门禁**：adversary + Claude+Pi dual **APPROVE_WITH_NITS** → nits follow-up PR；机核 `capability-workspace` + `security-thread`
- **纪律**：默认沙箱是 **consent 边界内的交付沙箱**，不是静默扩权到任意仓库；真实仓仍要用户手势选目录

### squash 后 `git branch --no-merged` 假阳性 → 切勿整支硬开 PR（2026-08-11 S63）
- **现象**：`git branch -r --no-merged origin/main` 仍列出 11 条 remote，但 `gh pr list --head <b>` 全是 MERGED/CLOSED；tip commit 文案在 main 上能 grep 到
- **根因**：squash/merge 后 **SHA 不同**，git 按可达性判「未合并」；三方 diff / `merge-tree` 仍会把**旧 monolith `server.ts`** 等塞回 C10 后的 main
- **危险**：对 stale 分支「开 PR → 过 CI → 合」= 冲突地狱 + **回退 god-file 拆分**（companion-dispatch 等）
- **正确动作**：(1) 对每支查 `gh pr list --state all --head`；(2) `git merge-tree --write-tree origin/main origin/<b>` 看是否 NO_OP / 是否冲突带 `<<<<<<<`；(3) 文案/patch-id 对照；(4) 确认已合则 **`git push origin --delete`**，不要重建 PR
- **纪律**：`--no-merged` 只是候选；**内容门** = PR 历史 + merge-tree + 关键文件（如 C10 抽取）是否仍在

### C10 抽取后测试须 eager-bind companion-dispatch（2026-08-11 · #163）
- **现象**：Linux CI `host_app` 等：`companion-dispatch runtime not bound`
- **根因**：`bindCompanionDispatchFromServerLocals` 若只在 `initServices`/`startServer` 路径调用，直接 `createToolExecutor` 的单测不会 bind
- **修法**：模块加载侧 **eager bind**（#163 跟进 `d028f2e`）；测试勿假设隐式 runtime
- **纪律**：god-file 抽出的 dispatch 表，默认路径与 test 入口都要能 bind

### shell_exec / netsec：issueTokenFor 与 validate 绑定必须同形（2026-08-09 S62 · #161）
- **现象**：企业 auto / full-autonomy cruise 下 `Invalid or expired security token for shell_exec`（日志显示刚 issue 即 fail）
- **根因**：`issueTokenFor` 经 `bindingPayloadFor` 绑定 `shell|cmd|cwd=...`（netsec 绑 targets+ports），`executeCompanionTool` 却 `validateToken(token, tool, bareCommand)` — 绑定字符串永远对不上
- **修法**：issue 与 validate **成对**用 `issueTokenFor` / `validateTokenFor(token, toolName, params)`；禁止手拼 code 字符串
- **部署**：修在源码/SEA 后，若用户仍跑旧 `dist-package\cmspark-agent.exe` 会继续报错 → 先停进程再 stage/重编（exe 被锁则 Copy-Item 失败）
- **纪律**：任何 L2 token 工具改 `bindingPayloadFor` 时，**全仓** `validateToken` 调用点必须同步；单测覆盖 cwd 非空时 issue→validate 成功路径

### 打包 SEA 被运行中 exe 锁死（2026-08-09 S62）
- **现象**：`build-windows-exe.ps1` 或手工 `Copy-Item` 失败「正由另一进程使用」
- **做法**：`Stop-Process -Name cmspark-agent -Force`（或脚本内 `Stop-ProcessesUsingPath`）后再 stage；验证 `Get-Item ...\cmspark-agent.exe | LastWriteTime` 与 `companion\dist` 一致
- **纪律**：Windows 验收「修了不生效」先查是否仍在跑旧包路径的 exe

### `run-tests.mjs` JSDoc 禁写 `*/` 序列（2026-08-09 S59–S60 · Pi REJECT）
- **现象**：P2 换 Unix `find` 为 `scripts/run-tests.mjs` 后 `npm test` 秒崩 `SyntaxError: Unexpected token '*'`
- **根因**：块注释里写了 `**/*.test.js` 类文本 → `*/` 提前结束注释
- **修法**：注释只写「matching *.test.js」；合并前 `node --check scripts/run-tests.mjs` + 官方入口 `npm test` 冒烟
- **纪律**：dual-review 机核必须跑 **产品入口**（`npm test`），不能只 `node --test` 单文件宣称绿灯

### dual-review 全量 patch 超 context → Claude UNKNOWN（2026-08-09 S59）
- **现象**：PR #159 对 `0de1760..HEAD` 生成 ~548KB patch；Claude Code `context window limit` → verdict UNKNOWN
- **做法**：r1 以 Pi 正文为准；**r2 base 收窄到 blocker 修复 commit**（小 diff）让双端都能出 VERDICT
- **纪律**：P0+P1 大 PR dual 可分批或 r2 只审 delta；Windows 用 **Git Bash** + `PATH=/c/nvm4w/nodejs` 跑 `dual-external-review.sh`

### `handleMessage` 第 3 参才是 session（2026-08-09 S59 · P0 CI）
- **现象**：SEC-B 后 stdio `mcp.add` 测仍报 `requestConfirmation channel missing`
- **根因**：`handleMessage(msg, services, session?)` 测里把 L2 mock 塞进第 2 参（被当成 services）
- **修法**：`handleMessage(msg, emptyServices, { sendToExtension, executeTool, requestConfirmation })`
- **纪律**：改 `require_grant` / L2 默认值后，**全仓** e2e/config 测必须同步（outbound 用 `cmg_` grant，不能只靠 ws_secret）

### Windows base Python 发现：勿停在 findUv / bare PATH（2026-08-09 S57）
- **现象**：S35 修好 uv 后，仍无全局 Python 时 system 假阴性；Store `WindowsApps\python.exe` 别名可冒充可用；缺 Python 文案 brew/python.org 不对称 winget
- **锁（Scheme D）**：`findPythonBase` 序 config → isolated → well-known 绝对 → manager **seed only** → enriched PATH/`py` → Store 拒绝 + ≥3.10 + **绝对 pin**；managers 不 activate、不当 Qwen 一等 runtime
- **CTA**：`basePythonAvailable` 区分「创建独立环境」vs「安装 Python」；`pythonInstallHint` win32 必含 winget
- **纪律**：isolated missing 禁止把 system 写进 `pythonPath`（B3）；执行 argv0 永不 bare `python`/`py`；测注入勿过粗 short-circuit 挡死 ensure 单测
- **门控**：host `pi -p` 可偏题（bridge/架构 backlog）；设计复审用 **协议只读 agent** 钉文件清单；误输出勿作 verdict

### PR 合 main 后工作区易混：功能分支脏改 ≠ 未合 PR（2026-08-09 S57）
- **现象**：#157 已合而 #156 仍 OPEN；本地 `main` 上仍挂 Python 改与 Whisper 打包脏文件
- **做法**：跨功能 PR 用 **worktree 从 origin/main 切干净分支** 只拷相关文件；合入后 `stash` 再 `pull --ff-only`；状态汇报必须 `gh pr list --state open` + `git rev-parse HEAD origin/main`
- **纪律**：勿在 `feat/A` 脏树上直接堆 `feat/B` 再开 PR

### 本机听写三层：模型 / cmspark-whisper / 麦克风 勿混（2026-08-08 S56）
- **现象**：点下载「没反应」；`binary_missing`「请更新 Companion」；`Requested device not found`
- **分层**：
  1. **权重** `voice.model.download` → `~/.cmspark-agent/models/whisper/`（HTTPS+sha256；**不依赖** binary）
  2. **运行时** `cmspark-whisper-win-x64.exe` 或 PATH `whisper-cli`（**不进 SEA 内部**；旁路 `bin/`）
  3. **麦** `getUserMedia`（NotFoundError = 无输入设备/隐私关，非 Companion）
- **下载无反馈**：设置页 fire-and-forget `sendMessage` 且 store 纯镜像 → 未连接时零 UI；须读 `ok/error` + 本地 pending + 超时
- **Windows 打包**：`build-package.bat` 只做 SEA；stage 条件是事先有 `companion/dist/bin/cmspark-whisper-win-x64.exe`；缺则 soft-warn、运行时 binary_missing
- **SEA 解析**：须搜 `<exeDir>/bin`（`allWhisperSearchRoots`）；仅靠 `__dirname` 会找不到安装目录旁路
- **dev 回落**：PATH 上 `whisper-cli(.exe)` 可当本机组件；分发包仍应 stage bin/
- **纪律**：用户报「听写坏」先分三层再改；`binary_missing` 文案勿只写「更新 Companion」

### React #310：early-return 之后的 `useCallback`（2026-08-08 S55）
- **现象**：生产 Side Panel 开设置崩溃 `Minified React error #310`（Rendered more hooks than previous render）
- **根因**：`SettingsSlideout` 在 `if (!settingsOpen) return null` **之后**新增 `useCallback(applySettingsIntent)`；关→开时 hooks 数量 +1
- **修法（#154）**：所有 hooks **无条件**放在 early-return 之前；关闭时仍跑 hook，只是不渲染 UI
- **纪律**：组件可 early-return UI，**禁止** early-return 之后再出现 `useState/useEffect/useCallback/useMemo/useRef`

### 本机 Whisper「字级流」≠ decoder token；partial 禁止 cancel-restart（2026-08-08 S55）
- **诚实边界**：whisper.cpp 离线整段解码；产品 M2 = PCM 流式上传 + 会话内 snapshot **重解码** + 约 8s 窗定稿 interim
- **Pi REJECT F2**：客户端每 1.4s `partial_request`，服务端若 **取消** 在飞 partial 再开新跑 → medium 推断 > poll → 假设永远饿死
- **修法**：`partialInferring` 时返回 `partial_busy`（不 cancel）；客户端按 hypothesis `ms` 自适应 poll（1.4–6s）；窗口内只 interim，窗末一次 final
- **纪律**：宣称「真字级」前写清 re-decode；对慢模型 **busy 跳过 > 取消重启**

### 连续本机 STT：`processing` 掉 liveOverlay → 草稿闪消失（2026-08-08 S52）
- **现象**：前几个字正常，后续字闪一下又没了；听写像卡住
- **根因**：composer `value={liveOverlay ?? text}`；local continuous 段间 `phase=processing` 时旧逻辑 **不渲染 overlay**，回退到仅在 `ENGINE_END` 才更新的陈旧 `text`
- **修法（PR #147）**：`voiceLiveComposerText` 含 `processing`；每个 `ENGINE_RESULT` final 且 `finals` 变长时立即 `onDraft`；overlay 占位时 **禁用** textarea（避免「可编辑」假象）
- **纪律**：凡「临时 phase」若 UI 切回 idle 展示源，必须先同步展示源或扩大 live 条件

### React effect 依赖整个 hook 返回对象会拆掉长会话（2026-08-08 S52 · D2）
- **现象**：按住热键听写几秒就断；或变成 classic 45s 且松手停不掉
- **根因**：`useEffect(..., [voice])` 而 `useVoiceInput()` 每渲染返回新对象；`listenTick` 250ms 触发 re-render → cleanup 里 `holdStop()`；另 `queueMicrotask` 在 `permissions.query` 完成前误判 idle 并恢复 classic
- **修法**：hotkey 监听只依赖 chord/enabled；`holdStart`/`holdStop` 用 ref；hold 用 epoch 取消 async begin；mode 保持 continuous 直到 stop
- **纪律**：副作用 effect 禁止依赖「每 render 新建」的 API 对象；async start 必须可取消

### dual-review / packaging：`git add` 勿吞入 audit patch 与 host-integrity 脏改（2026-08-08）
- **坑**：工作区大量 `docs/audit/reviews/*.patch` untracked；`git add docs/` 或误加会把 5 万行噪声塞进 PR（#146 曾 force-push 清）
- **打包**：`make package-macos` 会改 `host-integrity.ts` SHA。替换 `/Applications/CMspark.app`：先 `daemon stop`，按 PID 杀残进程，`ditto` 覆盖，**只** `xattr -dr com.apple.quarantine`（不要 `-cr`，会撞 SIP provenance）。本机不要留 `~/CMspark.app.bak-*`。
- **纪律**：打包后单独看 `git status`；PR 只 stage 功能文件

### analyze_image `data:` 假 Security Block ≠ 授权不够（2026-08-06 S50）
- **现象**：用户开满 L2 / `auto_approve_dangerous` / god-mode / 域白名单，仍报 `Security Block: analyze_image cannot read data: URL (data:image/…base64,…)`；错误串塞满 base64
- **根因**：IMAGE_FETCH_GATE path B 只放行 `http(s)`；扩展 canvas 失败（非仅 CORS）时把 `el.src` 当 `fetch_required`，内联 `data:` 进硬拦。设计假设「data: 永不污染 canvas」不成立
- **反直觉**：god-mode 放行的是**导航 scheme**，不是「任意 URL 字节送 LLM」；`data:` 无 SSRF 网络面，与跨域 fetch 不同门
- **修法（PR #130）**：
  1. 扩展 CDP 后 `promoteFetchSrc`：`data:` → 本地 decode（mime 白名单 + 6MiB）→ `type:canvas`；`blob:` 明确失败；永不对 `data:` 发 `fetch_required`
  2. Companion 旧扩展兜底：phase1 仍见 `data:` 时**本地 decode 返回**，无 L2、无 phase2、不扩 `schemeOk`
  3. 错误/日志禁止整段 data: 洪水；R2 nits：strip base64 空白、交叉 pin allowlist
- **测试坑**：plasmo 生产 `strict:false` 下 `!r.ok` **不收窄**判别联合；测试 tsconfig `strict:true` 会绿过生产 tsc 红 → 必须用 `ok === true/false`（Pi R1 REJECT）
- **Ship**：`fix/analyze-image-data-url-p0` · **PR #130** · dual R2 both_ok · R3 Pi APPROVE / Claude APPROVE_WITH_NITS
- **纪律**：全授权失败先分「确认门」vs「scheme 硬拦」；双审须跑生产 `tsc --noEmit` 不仅 test dist

### Thread list 作用域复用会污染主会话 UI（2026-08-06 S48）
- **现象**：回收站打开发 `thread.list`；空列表触发 auto-create 空白线程；或 `SET_THREADS` 清掉 active
- **根因**：同一 `thread.list` 处理器不区分 active / trash / include_trashed
- **修法**：companion 回传 `list_scope`（`active|all|trash`）；`trash` 不 SET_THREADS；`all` 更新列表但不 auto-create/select
- **纪律**：凡「同一 type、不同语义」的 list 必须 echo scope；扩展侧默认 fail-closed 跳过 blank 创建

### 语义变更的 WS 默认值必须迁旧调用方（2026-08-06 S48）
- **坑**：把 `thread.delete` 默认从 hard 改 soft → `files.test` 红 + tray 只听 `thread.deleted` 缓存陈旧
- **修法**：单删默认 **hard**（legacy）；新 UI 显式 `mode:"trash"`；新事件 `thread.trashed` 加入 tray refresh
- **模式**：协议默认向后兼容；产品新语义走显式 mode / 新 type

### listWithPreviews 双读消息文件（2026-08-06 S48）
- **坑**：preview 读一遍 + digest stale 再读一遍 → 200 线程 400 次 I/O
- **修**：单次 `getMessages` 同时产出 preview + stale；`@` 用 `getUserPreviewPair`；后台 digest `extractThreadDigestQueued`（并发 2 + 同 id 去重）
- **purge**：过期 trash 批量改 index 再 unlink，禁止 N 次 saveIndex

### `@` popover 必须与 `/` 同级拦截 Enter（2026-08-06 S48）
- **坑**：只 gate `slashVisible` 时，`@` 选中 Enter 会先 `handleSend` 再选 chip
- **修**：`handleKeyDown` 对 `(slashVisible || atVisible)` 统一 early-return Arrow/Escape/Enter

### skill_install 源路径 ≠ MCP filesystem 授权（2026-08-06 S46）
- **现象**：用户以为 MCP 授权了 `~/` 就能 `skill_install` `~/Projects/...`；对话中途停在「先确认包大小」
- **根因**：两套门——MCP `server-filesystem` 用 args roots；`isSkillInstallSourceAllowed` 曾只允许 Downloads/tmp/data dir（Trust 防任意 path 进技能库）
- **产品修**：主目录为 `user_home` tier（L2 确认=授权）；系统路径仍 denied；L2 前预检非法源
- **心智**：需要权限应弹窗，而非硬拒；三旗巡航与 forceConfirm 代数对齐（skill_install 仍 L2 除非三旗）

### MCP write 确认与 shell_exec 巡航不同步（2026-08-06 S46 · #pl5bud）
- **现象**：用户开全自动巡航仍反复点确认，以为是 shell
- **证据**：`security.enterprise_auto_approved` shell_exec；`mcp.confirm.requested` write_file force_confirm=true
- **修法**：`executeMcpTool`/`executeMcpMetaTool` 在三旗下 `mcp.confirm.waived`；单独 god-mode / 仅 enterprise 仍确认
- **教训**：Autonomy 开关必须覆盖所有 L2 方言（Companion critical + MCP capability gate），否则「全授权」撒谎

### Pack allowlist 与 MCP 白名单正交（2026-08-06 S46）
- **坑**：`tool_whitelist` 非 null 时 adapter/`isToolAllowed` 会滤掉 `mcp__*`（validator 也不允许 mcp 名进 allow）
- **修**：native 按 whitelist 滤；`mcp__*` 与 meta 工具正交（MCP 仍走 selection_mode）
- **用户场景 allowlist + 勾 MCP** 必须同发此修，否则场景一收窄就断 MCP

### 用户场景 Trust B 写全局（2026-08-06 · 产品覆盖 ADR）
- **原 ADR-014/020**：Pack 禁止 auto_approve / 开 module
- **产品 B**：仅 `origin=user` 的 `trust` 块可在 apply 写全局（skip_l2→三旗、enable_modules、auto_approve_*）；builtin 仍禁
- **回滚**：`mission_pack_trust_snapshot` + unapply `restoreTrustSnapshot`
- **纪律**：仍需 user_gesture；apply 前二次确认；审计 `pack.trust_apply` / `pack.trust_restore`

### Trust B 生命周期必须覆盖所有「离开」路径（2026-08-06 S46→#126）
- **现象**：S46 multi-lane REQUEST_CHANGES——happy path unapply 恢复，但 uninstall/切换/删除对话/apply 失败/spawn 仍会粘三旗或抬权
- **修法（PR #126）**：
  1. **restore**：unapply · uninstall · switch-away · `releaseTrustBeforeThreadGone`（thread.delete / cleanup_empty）
  2. **allowTrust**：默认 false；仅 UI `pack.apply`/save+apply `true`；spawn 永不写 Trust
  3. **install 剥离**：zip/dir 强制 `origin=installed`、strip `trust`（仅 saveUserPack 可持久化）
  4. **单 holder**：他对话已有 cookie → `trust_holder_conflict`
  5. **journal**：`mission-pack-trust-journal.json` applying→held；启动 `reconcilePackTrustOnBoot`
- **反直觉**：`restoreSnapshot` 会 null cookie 却不 restore 全局——必须先读 cookie 再清；switch 后须 `getConfig()` 再 blocked 判断
- **Ship**：`7b71eef` · merge `b338498` · dual Claude+Pi APPROVE_WITH_NITS · DMG v0.4.0 装 `/Applications`

### Trust 单 holder 冲突必须 UX 一键接管（2026-08-08 S53 · #148）
- **现象**：用户以为「对话结束」就释放 Trust；历史线程 cookie 仍 held → 新对话 apply 报 `trust_holder_conflict`（只见 raw id）
- **纪律**：对话结束 / 切走 ≠ unapply；仅 退出场景 / 删除 / force_takeover
- **修法（#148）**：错误带 `holders`（alias）；Side Panel 弹窗 **解锁并用于本对话** → `force_takeover` unapply 占用方再 apply；Pi APPROVE_WITH_NITS → residual cookie clear + audit
- **Ship**：`fa501d7` · merge `2460565`

### 工具轮会「吃掉」直播思考条（2026-08-08 S53 · #149 · #h1yi2w）
- **现象**：流式能见「模型思考中」，tool 跑完只剩 shell 小窗；磁盘 assistant 其实有 `reasoning_content`
- **根因**：`tool.start` 清 `streamingReasoning` 只 ADD tool 卡；中间轮无 `chat.done`（done 仅无 tool 终轮）
- **修法**：adapter 在 tool 前发 `chat.assistant`（message_id+reasoning）；UI 落历史行；`tool.start` 兜底 commit 流
- **反直觉**：磁盘有 ≠ 侧栏直播 transcript 有；重开线程从 messages 能看见，当次会话看不见

### Digest/标签被多 tray 冲掉（2026-08-08 S53 · #149）
- **现象**：AI 抽标签当次可见，重开全无；`index.json` digest 计数为 0
- **根因**：设计已持久化 `thread.digest` 到 index；**多进程**（daemon + 残留 tray）各持旧内存 `saveIndex` 整文件覆盖 → 抹掉 digest
- **修法**：`saveIndex` 写前 merge 磁盘 peer digests（memory `undefined` 才补）；`@` 抽完 broadcast；extract complete 再 list
- **运维**：安装/调试只留 **一个** Companion；清多余 tray

### skill_install Downloads 不得靠路径段名（2026-08-06）
- **坑**：`segments.includes("downloads")` 会把 `/usr/local/Downloads/...` 当 default 区
- **修**：仅 `~/Downloads` · `~/下载`（realpath under home）+ tmp + data dir；其余主目录为 `user_home`

### 附件上传「思考中」：乐观 UI 与 file.upload_error 未清 busy（2026-08-05）
- **现象**：Side Panel 上传 docx 后一直「思考中」；用户以为解析挂了。磁盘线程无 `<document>`，companion 日志无 `file.upload*`
- **根因分层**：(1) **UI** `SET_PROCESSING` 后只靠 `chat.done`/`chat.error` 清 busy；`file.upload_error` / 通用 `error` / Companion 未连接 **都不清** `isProcessing`/`threadBusy`；(2) **环境** 打包 `CMspark.app` 旧扩展/旧 companion 与源码不同步时，请求可能根本进不了带修复的进程；(3) **解析器本身** 对 ~30–55KB docx 正常（~100ms），不是 officeparser 坏了
- **修法**：`useWebSocket` 处理 `file.upload_error` + 通用 error 清 busy；parse 超时收成 `file.upload_error`；流式 `chat.reasoning` + `file.upload_status`；panel→SW→WS 诊断事件（勿记 base64）
- **验证**：dev 扩展 + `npm run dev` companion → `#ne13jb` 全链路 `panel_dispatch`→`ws.file_upload.received`→`parsed`→`chat_start`→`complete`
- **Ship**：`c6b1e8b` on main

### 上传错误跨线程污染：清 busy ≠ 可改 panel chrome（2026-08-05 S45）
- **现象**：S44 修了同线程 stuck busy；多路对抗发现 `file.upload_error` 无 `shouldApplyStreamEvent` → 切到 B 后 A 的失败解锁 B 并污染 B  transcript
- **纪律**：**mapBusy 按 upload `thread_id` 永远清**；`isProcessing` / `ADD_MESSAGE` / streaming 仅 active 门控；App SW-fail 用 `activeThreadIdRef` 勿信闭包 state
- **错误可见性**：门控后 active 不写消息 → companion 须 **persist** `file.upload_error`（`threadManager.addMessage`），切回才看得见
- **WS 门**：超大/校验失败/SW `!sent` 也要 stamp `file.upload_error`+`thread_id`，勿裸 `error` 清 active
- **Ship**：PR #125 `7c8ec53`

### Fleet 显示已 scope、停止仍全进程（2026-08-05 S45）
- **现象**：#124 列表/RunBusy 按 active thread；`fleet.stop_all` 无 stamp → companion 杀**全部** worker
- **修法**：`buildFleetStopAllMessage` — run→`orchestrator_run_id`；parent→`parent_thread_id`；none 才进程级 + 诚实文案；companion `fleet.stop_all` 优先级 run > parent > all
- **锁列表**：FleetStrip 须与 FleetWorkerList 一样 scope locks（勿 process-wide 展示）

### 运行态假空闲：Composer 只认 streaming，不认整轮 busy（2026-08-04）
- **现象**：复杂多 tool / 思考间隙，侧栏像会话结束，可打字发送，随后 agent 又突然继续
- **根因**：`canSend`/`Stop` 只绑 `streamingContent`；`isProcessing`/running tools/fleet 不进门控；`SET_ACTIVE_THREAD` 清零 busy；`tool.start` 无 `thread_id` 写到 active 线程
- **RunBusy 陷阱**：`classifyFleetActivity` 把**残留 idle worker** 当 active → 横幅会「永远还在跑」；必须用诚实 `deriveRunBusy`（locks / intents / holding_tabs / llm_active / threadBusyById），禁止 `worker_count>0` 单独成立
- **FocusBand**：`maxHeight:80; overflow:hidden` 会裁切内嵌列表 → worker 列表必须 **portal** 到 body
- **下钻同 ship**：W1 进入 worker 若无 `threadBusyById`+tool `thread_id`，会**制造**更多假空闲（Product 对抗 MAJOR_REVISE）
- **SoT/实现**：`docs/superpowers/specs/2026-08-04-run-state-and-worker-drilldown.md` · PR #117 · `utils/thread-busy.ts`

### Anthropic first-party denylist：FQDN 尾点可绕过 naive 匹配（2026-08-03 S38）
- **现象**: `api.anthropic.com.`（trailing dot）若只做 exact / `.anthropic.com` 后缀比较，可能不命中 first-party → 兼容头策略失效
- **修法**: hostname 规范化时 **strip trailing dots** 再匹配；加回归测
- **关联**: L7 union 必须同时挡 `client_header_profile` 与 `extra_headers`，防 profile 关了仍用 extras 伪装 UA

### LLM 协议适配：内部 OpenAI 形、Anthropic 只在 wire（2026-08-03）
- 线程持久化 / tool 环 **不要** 迁 Messages 形；`tool_use.id` 出站规范化 `^[a-zA-Z0-9_-]+$`
- P0 用 `fetch`+SSE 而非 `@anthropic-ai/sdk`，才能控 Coding Plan 兼容头
- 官方 `api.anthropic.com` / `claude.ai` **禁止** Claude Code 兼容头；system 首行「You are Claude Code」v1 不做

### 无人值守 = 风险自担全程静默，不是「只免 initial L2」（2026-08-09 S61 · #160）
- **产品 JTBD**：短语+双勾选武装后，用户已自担桌面键鼠/注入风险；若 mid-task re-L2（含 danger/experimental/foreground）仍弹窗，则「无人值守」名不副实
- **实现（ADR-021 2026-08-09 修订）**：
  - initial：`evaluateUnattendedHostComputerSkipDetail` 仅 armed + `coordinateAllowed` + budget/actions caps（**不再** gate modelEnabled/experimental/credential latch）
  - mid-task：`executor.reL2` **最先** `isUnattendedArmed()` → 全 tag 静默（含原 PROMPT_ALWAYS）
  - 硬拒绝（支付/验证码/凭证 type·key）仍 **throw**，不经 confirm
- **G1 / 巡航边界**：无 grant 时 PROMPT_ALWAYS 仍 force；alone 1–2 旗永不 arm grant；三旗巡航可 waive host **initial** forceConfirm，但不能静默 PROMPT_ALWAYS re-L2
- **文档纪律**：ADR-017/020、confirm-center、矩阵/双勾选必须与 ADR-021 同步；历史 design SoT「re-L2 仍确认」已过时
- **测试缺口**：纯 grant 测够用；executor 级「armed + danger_detected 零 confirm」仍缺（对抗 nits）
- **急停 ≠ 解除**：急停只停任务，grant 可续至 8h/重启

### 无人值守 packaging：进程 grant vs 持久 cruise dual-write（2026-08-03 S36）
- **现象**：UI 勾选「重启后自动失效，不会写入长期配置」；`security.unattended.arm` 却 `saveConfig` 写 `auto_approve_dangerous` + `auto_approve_enterprise_tools`（可选 `allow_all_schemes`）
- **影响**：用户以为「会话值守」；重启后桌面 grant 没了，**网页/企业巡航仍开**；enterprise 模块开启时 shell/netsec 可跟跳 L2
- **实现锚点**：`message-router.ts` arm 段 dual-write；`SettingsSlideout` 仅客户端 dual-ack；`include_protocol:false` **不** force-clear 已有 scheme unlock
- **修法方向**：服务端 acks/`user_gesture`；arm 时精确写 target 向量（含 clear protocol）；文案与 dual-write 同真；或停止 dual-write 仅进程 overlay
- **报告**：`docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md`

### `ensure_python_env` 失败前已写 `pythonMode: isolated`（2026-08-03）
- **锚点**：`companion/src/computer/model-handlers.ts` case `computer.model.ensure_python_env` — `setComputerModelFields({ pythonMode: "isolated" })` 在 `ensureIsolatedPythonEnv` 之前
- **影响**：venv/pip 失败后配置卡在 isolated，preflight/download 按 isolated 判未就绪，原 system 路径被弃用
- **修法**：仅 `result.ok` 后持久化，或失败回滚旧 mode

### TinyClick 残留清理（2026-08-08）
- **产品早已切 Qwen3-VL**；仓库仍留 Florence-2 ONNX 全栈 + CI `verify-tinyclick-vendor` + `onnxruntime-node`
- **清理**：删除 `tinyclick-*.ts` / 单测 / spike / scripts/verify-tinyclick* / `models.manifest.json` / s1 spike；`tinyclickLocator` → `experimentalLocator`；去掉 `onnxruntime-node` 与 postinstall vendor 校验
- 实验层 admission 仅 `resolveModelAdmission*` + `qwen-vl-*`

### Vision 复用主 LLM（多模态 UX P0 · 2026-08-08）
- **问题**：默认 vision=Ollama llava；主模型已是 Claude/GPT-4o/Kimi 多模态时用户仍被引导另配 VLM
- **解法**：Side Panel 勾选视觉时若 `likelyMultimodal` 且 `protocol≠anthropic` → 提示「使用主模型」；`vision-reuse-logic.ts` 纯逻辑；`saveConfig` 在 url+model 匹配且 vision key 占位时继承 `llm.api_key`；非 loopback+占位 key **拒绝 POST 图**（`shouldBlockVisionRequest`）
- **诚实边界**：仍是 pre-analyze→文字，不是主对话原生看图；Anthropic Messages 主协议不提供一键复用（vision 轨仅 OpenAI 兼容）
- **与 CU Qwen 分轨**：设置文案明确「看图描述 ≠ 实验层 Qwen3-VL 定位」
- **锚点**：`vision-reuse-logic.ts` · `vision-reuse-inherit.ts` · SettingsSlideout · settings-web · brief/adversary synthesis under `docs/decisions` + `docs/audit/reviews/vision-reuse-*`
- **闸门**：三路对抗 + dual Claude/Pi APPROVE_WITH_NITS

### Vision 405 ≠ 本地 Qwen；智谱 base_url 必须带 `/api`（2026-08-02）
- **用户误判**：已下载 Qwen3-VL 并开启实验层，仍报 `vision.analysis_failed` / `405 Not Allowed (nginx)`（截图 + `analyze_image` 同错）
- **两层能力**：
  - **本地 Qwen**（`computer.modelEnabled` + `~/.cmspark-agent/models/qwen3-vl-*`）→ Computer Use **UIA/OCR 之后的实验定位建议点**；不服务 `analyze_image` 描述
  - **Vision**（`config.vision`，`llm/vision-pipeline.ts` → OpenAI `chat.completions`）→ `screenshot` / `analyze_image` **看图说话**
- **405 根因**：智谱配成 `https://open.bigmodel.cn/paas/v4`（少 `/api`）→ nginx 405；正确为 **`https://open.bigmodel.cn/api/paas/v4`**
- **改对后常见下一错**：`429 code 1113 余额不足或无可用资源包`（端点通、账号无额度）
- **测本地 Qwen**：白名单 App 上走 `host_computer`，确认台看 **experimental_suggestion**；日志 `qwen|experimental|locate`；**不要**用「描述网页截图」测
- 教训：产品层命名「模型」易混；排障先看 `vision.analysis_failed` 的 **model 字段**（如 `glm-4.6v`）与 `computer.model*` 是否同轨

### macOS host_computer：estop code 4 / LS vs CLI TCC（2026-08-01→02 闭环）
- **用户错误（旧）**：`emergency-stop unavailable (… code 4)`；亦见 SCK `-3801`
- **code 4 含义**：`CGEvent.tapCreate` 失败（辅助功能/事件监听），旧逻辑 **整 helper 退出** → socket 死 → CU preflight 硬拒
- **产品身份**：`MacOS/CMspark` + `com.cmspark.agent`（PR #103 已合 main）
- **关键发现（反直觉）**：同一 ad-hoc CDHash，**CLI/`Process` 从 Terminal 可建 tap**；`open -a` / LS 启动路径下 `AXIsProcessTrusted` 常 false、tapCreate nil。CLI `security-check` axTrusted=true **≠** app 内 estop 可信
- **修法（分支 tip，待合 main）**：
  1. tray/Aqua 拥有 estop（`launchAgentTrayAndExit` 先 spawn estop）
  2. **soft-fail**：tap 失败 → 热键 DEGRADED，**socket 保活**（CU fail-closed = socket 非 hotkey）
  3. `describe` 空间分行 OCR（勿 `join(" ")`），防 agent `shell_exec` 自写 Vision
- **Ship**：`dist-package/CMspark-v0.3.0-macOS.dmg`（2026-08-02）；ship note `docs/superpowers/plans/2026-08-02-macos-dmg-ship-note.md`
- **仍开放**：LS 热键 DEGRADED；ad-hoc 重装 TCC；Developer ID；Side Panel 每机真机确认台
- 教训：CU fail-closed 应对 **proof-of-life socket**；热键是 best-effort。旧 DMG 不含 soft-fail/spatial describe——分发须重打

### macOS describe OCR：`join(" ")` 毁阅读序 → shell Vision 旁路（2026-08-01 #k47c0u）
- 现象：`describe` 像只读到一行；agent 写 `/tmp/ocr.swift` + `screencapture`（enterprise auto-approve）
- 根因：产品 OCR **已是** `VNRecognizeTextRequest`；`untrustedText = words.join(" ")` 丢行结构；Vision 配置 405 时更易旁路
- 修：`ocr-describe.ts` mid-Y 聚类分行 + `[untrusted host-ocr]` 前缀；adapter/catalog 禁止 shell OCR 替代
- 教训：引擎可用 ≠ 给 LLM 的版式可用；enterprise shell 自动批准会放大旁路
### macOS 屏幕录制：勾了 CMspark 仍 -3801（产品身份分裂，2026-08-01）
- 现象：系统设置里 CMspark 已开，外程序/L2 截图 ScreenCaptureKit `-3801`；开发重装反复出现
- 根因：`MacOS/CMspark` 曾是 **bash→node**；真正 SCK 在 `Resources/cmspark-host`（`com.cmspark.host`，ad-hoc 独立 CDHash）。TCC 记的是**捕获进程身份**，不是桌面图标名。历史错误串还教用户勾 node/host → 产品体验失败
- 产品锁：用户路径 **只认 CMspark**；禁止引导 node/cmspark-host
- 方案 D：主可执行 = host Mach-O 装成 `Contents/MacOS/CMspark`，嵌入 `com.cmspark.agent`（PR #103 已合 main）
- SoT：`docs/superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md`
- 教训：helper 做 TCC 锚可以避免 osascript 名，但 **屏幕录制必须与 App 产品名合一**；ad-hoc 重装会清授权，长期要 Developer ID；真机阻塞见上条 estop/-3801

### 技能扫描：非「仅启动一次」，但 skill.list 曾只读内存（2026-07-31）
- 现象：用户/Agent 拷文件进 `~/.cmspark-agent/skills` 或外部落盘后，Skills 列表/自动匹配像「没装上」；体感「只有 Companion 启动才扫」
- 根因：audit item 10 去掉了每次 `skill.list` 的全量 `refresh()`（防 4 目录同步扫盘卡 UI）；API 导入路径会 refresh，**外部写盘不通知**
- 修法（PR #96 `feat/skill-disk-refresh`）：`computeDiskFingerprint`（path|mtime|size）+ `ensureFresh`/`refreshIfStale` 挂在 list/get/match/resolve/listKnowledge；磁盘变才 full re-parse；UI 打开 Skills → `skill.refresh` + **↻ 刷新**
- 教训：缓存失效要覆盖 **带外写盘**；别恢复「每次 list 全量 refresh」；force 路径用独立 `skill.refresh`

### log.event 回声环 → 通宵耗电（已修 #91，2026-07-31）
- 现象：插件 ↔ Companion「频繁连接」、系统异常耗电、日志可达数十 GB
- 根因：**非**单纯重连风暴，而是 `log.event` echo：Companion echo → Side Panel 关闭导致 sendMessage 失败 → `sidepanel_forward_failed` 再 logToCompanion → 死循环
- 防线（main 已含）：server **不** echo log.event 给发送方；扩展 **永不** 把 forward failure 回传 Companion（`log-forward-policy.ts`）；入站 token bucket ~10/s（`log-event-gate.ts`）；未配对抑制 reconnect storm；`chrome.alarms` 退避
- 自查：空闲 CPU 近 0；`~/.cmspark-agent/logs` 无海量 `sidepanel_forward_failed`；扩展与 Companion 须同为 #91 后构建
- 教训：可观测性路径也要 **anti-echo**；扩展本地 fan-out 日志即可，勿依赖 companion 回推

### 合盖通宵掉电：先排 #91，再查 DarkWake / 本机大内存服务（2026-08-05）
- 现象：合盖过夜掉电 >20–50%；用户直觉常指向 CMspark companion↔扩展「频繁通信」（#91 回声环）
- **差分诊断（勿一上来改代码）**：
  1. companion 日日志是否 GB 级 / 有无海量 `sidepanel_forward_failed` → #91 复发
  2. 合盖窗口内 companion 日志是否**空窗**（如 18:15→次日 08:05 零事件）→ 应用层 WS 风暴可排除
  3. `pmset -g log`：Clamshell 后 `DarkWake` 频率 + reason + `Charge:%` 曲线
- 2026-08-04 晚实测：Clamshell **85%→次日 58%**（~14h，~2%/h）；**DarkWake ~440–450/h**；原因几乎全是 `wifibt` / `E_RX_IP_PACKET ARPT` / `centauri-alpha|beta`（**非** CMspark）
- **oMLX 帮凶**：`omlx-server` 常驻 **~13GB**（本机 127.0.0.1:11434）+ 通宵周期性 `PreventUserIdleSystemSleep`（`app.omlx` / CFNetwork.StorageDB）；通宵**无推理**仍占内存；关 oMLX 后 DarkWake **仍在** → Wi‑Fi 唤醒是主因，大内存服务放大代价
- 对照实验：必须 **拔电（Using Batt）** 合盖才可读掉电；插 AC 时 100% 无法判 A/B
- 缓解顺序：关「网络访问时唤醒」/ 合盖关 Wi‑Fi → 不用时退出 oMLX → 再查 CMspark 孤儿进程（headless print-to-pdf、挂死 modelscope 等）
- 教训：**合盖掉电 ≠ 上次根因**；先 pmset + 日志空窗排应用，再查本机 LLM 常驻内存

### 场景（Mission Pack）白名单 ≠ God-mode / 确认开关（2026-07-31）
- 现象：用户开了 `auto_approve_dangerous` + `allow_all_schemes`，仍报 `tool_not_allowed:workspace_list_dir — not in thread tool_whitelist`；装技能线程被套 AppSec 后无法 list 本机目录
- 根因：`thread.tool_whitelist`（Pack apply 收窄）在 `createToolExecutor` **硬门**，先于 L2 确认；god-mode 只跳过确认，**不**打开白名单外工具
- 产品：入口改名 **「场景」**；`pack.unapply` 退出恢复 snapshot；`tool_not_allowed` 人话 + **recoverable** + `suggested_action: unapply_pack`；apply/unapply 需 `user_gesture:true`（禁 LLM 自 apply）
- 装技能主路径：**Skills → 导入 ZIP/文件夹**，勿 apply「应用安全审查」
- NetSec allowlist / 本对话授权已迁 **设置 → 网络扫描**，勿与场景模板混在同一页主叙事
- PR #93 `feat/scene-ux-p0`；SoT `docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md`
- 教训：凡「危险全局开关」与「线程场景表面」分层教学；错误串禁开发者 jargon 且勿默认 non_recoverable

### God-mode / 危险 flag：UI 短语 ≠ companion 门（P1-1，2026-07-29）
- 现象：Settings 武装 `allow_all_schemes` 需输入 phrase，但 `config.set` 经任意已鉴权 WS 可直接布尔 `true` → UI 剧场
- 修法（Design A / PR #85 **已合 main**）：companion 对 **false→true** 的 `allow_all_schemes` / `auto_approve_dangerous` / `auto_approve_enterprise_tools` 要求 top-level `confirmation_phrase` 匹配 `SECURITY_ARM_CONFIRM_PHRASE`（`我了解风险`，`companion/src/security-arm.ts`）；缺/错 → 整条 config.set 拒绝 + `security.arm_rejected`；对 → 持久化 + `security.flag_armed`
- 消武与「已 true 再 save」无需 phrase；`config.json` 带外编辑仍走 ADR-010 路径
- 扩展：Settings 武装路径经 background 透传 phrase，不能只改 store 布尔
- 测试：`companion/tests/message-router-config-security.test.ts`
- 教训：凡「危险全局开关」，**权威门在 companion**；UI phrase 只是入口。同类后续（P1-2 originWs 等）同样勿只信客户端

### MCP ensureFilesystemAllowlist 注入 cwd → applyConfig 假 restart 挂 CI（2026-07-30）
- 现象：PR 在 Ubuntu CI 上 `npm test` 跑到 ~1300+ 后 **6h GHA cancel**；本地 `mcp-manager` soft-only trust_level 测失败且进程不退出
- 根因：`ensureFilesystemAllowlist` 在 **已有 allow-dir** 时仍补 `cwd: homedir()` → 每次 `sanitizeMcpConfig` 改 cwd → `requiresRestart` true → stop/start 假路径 + open handles
- 修法（PR #90）：有 `hasDir || hasRoots` 时 **原样返回**，勿 cwd-only mutation；回归测 deep-equal
- 连锁：Linux 上 3 个 osascript 测仍期望 `Security Block`，但 message-router **先** early-reject `macos-only` → 须平台分叉断言（同批 test fix）
- 教训：sanitize **幂等且不改语义无关字段**；否则 soft update 变 hard restart。CI cancel 先看是否 **hang 非 fail**

### Dual-review Claude 勿跑 companion 全量 npm test（2026-07-30）
- 现象：`dual-external-review.sh` 中 Claude 起 `npm test` → 挂数十分钟 / 与 CI 争 runner
- 修法：review prompt 写死 **禁止 full suite**；仅 Read/Grep + 定向 `node --test` 子集；实现者已绿的矩阵可引用
- 教训：外部审是 **diff 审**，不是再跑一次 CI

### TS 判别联合：`!x.allowed` 可能不收窄（2026-07-30 P1-3）
- 现象：`EvaluateExecutionDecision` 有 `allowed: false` + `error`，但 `if (!decision.allowed) decision.error` → CI `tsc` TS2339
- 修法：`if (decision.allowed === false)` 后再读 `error`
- 教训：boolean 判别联合用 **严格相等**，勿依赖 negation 收窄

### CMspark config: env var must not override user-provided API key
- `DEEPSEEK_API_KEY` environment variable used to take unconditional priority in both `getConfig()` and `saveConfig()`, causing UI-set keys to be overwritten and then saved as empty strings
- Fix: only fall back to env var when no user-provided (non-masked, non-env) key exists; persist user-provided keys to disk; mask only when the saved value equals the env var
- Files: `companion/src/config.ts`, `companion/src/message-router.ts`, `companion/src/settings-web.ts`

### Masked API key detection must be consistent across modules
- `isMaskedApiKey()` had divergent implementations in `config.ts`, `settings-web.ts`, `background/index.ts`, and `useWebSocket.ts`; some required `length >= 12` and missed shorter UI masks like `sk-****xyz`
- Fix: unified rule — `"***"`, any substring `"****"`, or `"...."` dot-masking (length >= 10); exported from `config.ts` and reused where possible

### Module-level config cache breaks test isolation
- `config.ts` keeps `cachedConfig` at module scope; tests that mutate `process.env.DEEPSEEK_API_KEY` or `config.json` can see stale cached state across test cases
- Fix for tests: export `clearConfigCache()` (test-only helper) and reset file + cache in `before()` hooks
- Files: `companion/src/config.ts`, `companion/tests/config.test.ts`

### Quick Action ID collision in companion-client.ts
- `Object.assign(msg, params)` would overwrite `msg.id` with `params.id` (actionId), causing request/response ID mismatch and timeout
- Fix: renamed to `actionId` field in params

### systray2 `update-menu` does NOT refresh `internalIdMap`
- `systray2` builds `internalIdMap` once at init (mapping `__id` → MenuItem). Calling `sendAction({ type: "update-menu" })` updates the visible menu but **leaves the internal map stale**
- When menu structure changes (e.g. Quick Actions count varies), subsequent clicks return stale `__id`s, causing clicks to map to the **wrong action** (e.g. clicking "Settings" triggers a Quick Action)
- Fix: kill + recreate the tray instance on every rebuild instead of using `update-menu`

### Chrome extension `thread.delete` field name mismatch
- Frontend (`ThreadList.tsx`) sends `thread_id` (snake_case) but `background/index.ts` reads `message.threadId` (camelCase)
- Result: companion receives `undefined` thread_id, deletion never executes
- Fix: read `message.thread_id || message.threadId` in background for backward compatibility

### CMspark .app 部署:不能只换 cmspark-agent.js(依赖漂移)
- `/Applications/CMspark.app/Contents/Resources/node_modules` 是打包时冻结的。当前源码 `dist/mcp/client.js` 深路径 `require('@modelcontextprotocol/sdk/client/index.js')`,而 `bundle:exe` 把该包 externalize → 只换 bundle 会启动即崩(MODULE_NOT_FOUND)
- 必须整机重打包:`make package-macos`(或 package-windows/linux)—— scripts/package.sh 会把 companion/node_modules 一起 stage 进新 .app
- app 未签名,文件可换;但 node_modules 必须与 bundle 同步更新

### Mermaid 图表渲染的三个坑（2026-07-01，详见 docs/adr/009）
- **mermaid 11 在 MV3 strict CSP 下可客户端直跑**：spike 验证（prod 构建，`script-src 'self'`）无 `securitypolicyviolation`；静态扫描全 bundle，`eval`/`new Function`/string-timer/constructor-escape 全 0，唯一 `Function("return this")()` 是 lodash `_root.js` 取全局的写法，浏览器里被 `self`（`=window`）短路永不执行。**无需** sandbox/offscreen/server。
- **`@mermaid-js/parser` 的 exports map 缺 `default`**：mermaid 11 拆出 `@mermaid-js/parser@1.2.0`，其 `package.json` `exports` 只有 `import` 条件 → Plasmo 0.90.5 的 Parcel resolver 解析失败（build 报 `Failed to resolve '@mermaid-js/parser'`）。修：`package.json` 加 `"alias": { "@mermaid-js/parser": "@mermaid-js/parser/dist/mermaid-parser.core.mjs" }`。
- **`htmlLabels:false` 是 mandatory**：mermaid 默认 `htmlLabels:true` 把节点标签渲成 `<foreignObject>`，而 DOMPurify 的 SVG profile（`USE_PROFILES:{svg:true,svgFilters:true}`）**剥 `foreignObject`** → 节点文字消失（只有 `<text>` 的边/箭头标签存活，症状"有些字有、有些没有"）。修：root-level `htmlLabels:false` 强制纯 `<text>`/`<tspan>`。特权扩展页面下不可信 SVG 务必 `securityLevel:'strict'` + 我们的 DOMPurify SVG profile 二次过（纵深防御，C1）。

### 诊断 Node daemon CPU spin：`ps pcpu` 是衰减平均，必须用 `top -l 2` 取瞬时（2026-07-13）
- 现象：daemon 刚重启（uptime < 5min）后 `ps -o pcpu`（或 `top -pid <PID>` 单次）显示 ~30%，看似仍在 spin；但 `top -l 2 -pid <PID>`（取第二次采样）瞬时 = 0.0%，`sample` = 100% 在 `uv__io_poll`（libuv idle block）。
- 根因：macOS `ps pcpu` / `top` 单次是**过去一分钟的衰减平均**，把启动尖峰 + extension 重连 burst 的 CPU 留在衰减尾巴里——刚启动的进程即使瞬时 idle 也显高。
- 修法（诊断流程）：判 spin **必须**用 `top -l 2 -pid <PID> -n 0`（`-l 2` 采样两次，第二次才是瞬时稳态）；配合 `sample <PID> <秒>` 看 `uv__io_poll`（idle）vs `OnUvRead`/`Writev`（活跃 IO）的采样占比。**真 spin 的特征是主线程阻塞 → 日志静默**（心跳/事件全停）；若日志持续输出 + healthz 响应正常，则非 spin。
- 教训：2026-07-13 部署 spin fix（PR #64，O(N²) 流式越狱扫描 → 有界窗口 O(N)）时被 30% 误判"fix 没生效仍在 spin"，实为 idle。`sample` + 日志连续性才是真相，`ps pcpu` 不是。详见 [[spin-rc-on-squared-jailbreak-scan]]。

### macOS tray 配对码窗口不显示：accessory app 需 `orderFrontRegardless`（2026-07-14）
- 现象：packaged macOS tray 点「🔑 显示配对码」毫无反应（无窗口、无通知）；菜单/状态图标正常。
- 根因：macOS 14+ 弃用 `NSApp.activate(ignoringOtherApps:)`。Swift tray 是 `.accessory` app（且从 `LSBackgroundOnly` 的 .app 派生），配对码窗口**被创建**（`isVisible=true`、有时 `isKeyWindow`）但**不真正到前台**，静默留在后面 → 用户看不到。菜单/图标靠鼠标事件驱动不受影响，掩盖了失败。
- 诊断关键：一度被"shipped 二进制坏了"误导——其实 `build-tray.sh` 产出与 shipped 哈希一致（`10a586ea`），Tray.swift `git diff` 为空（手动 `swiftc` 哈希不同 `de53a716` 只是内嵌源码路径元数据差异，功能等价）。破局点是写**最小 `.accessory` Swift harness**（同 activate/makeKeyAndOrderFront），它**能**弹窗 → 证明策略/API 没问题，失败是窗口**排序**不是创建。
- 修法（PR #65，9315d31）：`Tray.swift` `PairingController.show()` 在 `makeKeyAndOrderFront` 后加 `window.orderFrontRegardless()`（AppKit「即使激活被压制也强制到前台」原语，无 Dock 闪烁）。配套 `SWIFT_TRAY_SHA256` `10a586ea`→`46d866a6`（A8 lock-step）。
- 教训：① 任何 Swift tray/NSWindow 弹窗：`makeKeyAndOrderFront` 后**必加** `orderFrontRegardless()`，别依赖已弃用的 `activate(ignoringOtherApps:)`。② 诊断"窗口不显示"先分清 **create vs order**——最小 harness + 打印窗口属性（isVisible/isOnActiveSpace/isKeyWindow/frame）是客观证据，别只靠肉眼、别被哈希差异带偏。③ Tray.swift 改动 → `bash companion/src/tray/build-tray.sh` 重编 → 更新 `companion/src/tray/swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256`（build-tray.sh 末尾提示 `menu-bar-agent.ts` 是**错的**，常量实际在 `swift-tray-bridge.ts`）。

### Swift tray SHA256：hash mismatch 禁止自动 rebuild（S-P0-2，Native HUD 继承）
- 改 `Tray.swift` 后必须 `bash companion/src/tray/build-tray.sh`，把 digest 写入 `swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256`
- **Hash mismatch ≠ 缺失 binary**：缺失可 dev rebuild；mismatch 视为可疑，拒绝 spawn、不静默 rebuild（防 TOCTOU / 篡改证据被覆盖）
- HUD 与 tray 同一 binary 时，所有 HUD 改动都触发同一 hash 更新路径

### Grok Rhai workflow：`fn` 不捕获外层 `let`（2026-07-28 docs reorg）
- 现象：`docs-reorg-phase12` 在 Phase1 外审门崩溃：`Variable not found: root` / 同类对 `output_schema`
- 根因：Rhai 函数**不捕获**外层局部变量；`run_external(...)` 内写 `root` 或 `external_schema` 会在**调用时**才炸（canned smoke 可能过、真跑 fail）
- 修法：① 参数显式传入（`repo_root`）；② schema **在 fn 内**字面构造；③ 或**内联** dual-review agent 调用（phase34 采用）
- 相关：`.grok/workflows/docs-reorg-phase12.rhai` → continue / phase34

### Dual-review Claude 429 ≠ 内容 REJECT（2026-07-28 p3）
- `scripts/dual-external-review.sh` 对空/失败输出会映射 VERDICT；Claude 全文 `API Error 429` 额度时脚本仍落 `REJECT`
- **勿把 429 当文档/代码否决**；应用 Pi（或 adversarial）+ 额度后复跑 Claude；verdict json 应注明 `infra_429`
- 同日 Kimi 也可能 403 usage limit — 双审工具链要有配额/替代审查者预案

### Computer Use 文档：全局开关勿写成「侧栏生物识别一键开」（2026-07-28）
- 0.3.0 用户实用路径：`~/.cmspark-agent/config.json` 的 `computer.coordinateEnabled`
- Companion 有 `computer.set_enabled`（可生物识别），但 **Side Panel/托盘未接线**；Apps「坐标操作」只读 `computer.get_state`
- 用户指南/ADR-017 必须诚实写 UI 债；checklist 不能要求「面板拨开全局」
- Files: `docs/computer-use-user-guide.md`, `docs/adr/017-computer-use.md`, `companion/src/computer/handlers.ts`

### Confirm multi-surface：晚到响应 wire 保持 `unknown`，勿发明 `already_resolved`（2026-07-27）
- `SecurityConfirmationManager.respond` / `respondFrom` 删除 pending 后晚到调用返回既有 **`unknown`** 语义
- Brief/plan 散文可说 “already resolved”，**wire symbol 不改名**（旧扩展兼容 + N5 lock）
- 多 surface 清理靠 **NEW** fan-out（`onTerminal` → cancel tray + cancel HUD + resolved 通知），不是改 outcome 枚举

### macOS computer-use inject：截图坐标与 inject 原点必须同闸（bestDist < 24）（2026-07-26）
- 现象：前台切换 OK、截图 OK，模拟点击全「成功」但 UI 不变（#mvt4t8 / #32c2b0 / #i4x6pm 前期）。
- 根因：`cuScreenshot` 仅在 AX↔CG 帧距 `bestDist < 24` 时采用 AX client 原点；`cuClientOriginScreen`（inject）原先**无此闸**，微信多窗口时绑到错误 AX 框 → client(0,0) 屏坐标与 CG 框差约 (-68,-46)，点击整片偏移。
- 修法：inject 与截图 lockstep 的 `bestDist < 24`；失败则退回 CG 框原点。
- 教训：凡「截图定标 + 注入」双路径，client 原点算法必须**同一函数/同一门限**，禁止截图严格、inject 宽松。

### SkyLight `SLEventPostToPid` 对微信/网易云可静默无效，仍 ok:true（2026-07-26）
- 现象：坐标修对后 inject 仍无效；JSON `ok:true`，甚至 `verified:true`（像素微变），用户肉眼零反应（#i4x6pm）。
- 根因：Approach C 用 SkyLight per-PID 服务 Chrome 后台注入；微信/网易云等 AppKit/Electron **可不消费**该通道且不报错。`slPostToPid` 只证明 SPI 调用返回，不证明 UI 生效。
- 修法：inject 前 `activate(options: .activateIgnoringOtherApps)`；**SkyLight + HID `CGEvent.post(.cghidEventTap)` 双投递**（`delivery: skylight+hid`）；需 cmspark-host Accessibility（本机 `axTrusted:true`）。
- 环境：`CMSPARK_SKYLIGHT_NO_ACTIVATE=1` / `CMSPARK_INJECT_NO_HID=1` 可回退 canary。
- 教训：① 私有 SPI 交付必须有**可观察 ground truth**（TextEdit 正文 / 真实 UI 状态），不能只信 ok JSON。② 像素 verified 不足以证 click 语义成功。③ 热换 `cmspark-host` 必须同步 `CMSPARK_HOST_SHA256`（`host-integrity.ts` + 打包 agent.js），否则 inject 被 integrity 拒。

### Mail `message 1 of inbox` 是最旧不是最新（2026-07-26 #mxz27i）
- 现象：host_read 永远读到 iCloud 2023 welcome；Exchange 有新信读不到。
- 根因：AppleScript 统一收件箱 index 1 常为最旧；非按 date 排序。
- 修法：`messages of inbox whose date received ≥ cutoff`（30d→365d）取 max date；编译 `read-mail.scpt` 与 app `host-scripts` 同步。
- 教训：Mail 脚本禁止假设 index 顺序 = 时间序；大收件箱用 whose + 近窗，勿全量扫。

### macOS 26 Tahoe TCC 按 bundle 级签名评估，不是 per-binary（2026-07-23 regression）
- 现象：DMG 安装的 `CMspark.app` 反复弹 ScreenCapture 授权，即使系统设置里已经显示"已授权"。用户每次启动都要重新点允许。
- 根因：`create-dmg.sh` 历史上没有 codesign 步骤，DMG 里的 `.app` bundle **整体未签名**。即使内部 binary（`cmspark-host`、`node`）单独签了，macOS 26 Tahoe TCC **按 bundle 级签名评估**，未签名 bundle = 每次启动重新评估授权 = 反复弹窗。用户从 DMG 拖 `.app` 到 `/Applications` 还会**覆盖**之前手工重签的版本，把问题带回来。
- 修法（commit `198bfe9`）：`create-dmg.sh` 在 `cp staging`（Step 3）和 `hdiutil create`（Step 4）之间加 Step 3.5：`codesign --force --deep --sign - --options runtime --entitlements <host.entitlements> "${APP_BUNDLE}"` + `codesign --verify` 硬门（失败 `exit 1`）+ 打印 CDHash/Identifier/flags 便于诊断。所有 step 标签从 `[X/5]` 改成 `[X/6]`。
- 教训：① **打包脚本必须 codesign 整个 .app bundle**，不能只签内部 binary；TCC 看的是 bundle 级签名。② 诊断"TCC 反复弹已授权权限"先 `codesign -dv --verbose=4 /Applications/CMspark.app` 看 `flags=runtime` 是否在、`CDHash` 是否非空 —— 缺失就是 bundle 未签名。③ 长期解法仍是 Apple Developer ID + notarize（TCC 看 TeamID 不看 cdhash）；短期缓解：DMG 流程必须包含 `codesign --force --deep`。详见 [[tcc-cdhash-vs-activate]]。

### Windows estop：死 PID 留下 ready.json tombstone → 心跳 stale 数天（2026-07-28）
- 现象：`host_computer` / emergency-stop 报 `heartbeat stale (430532579ms)` 量级（约 5 天），estop 不可用。
- 根因：`computer-estop.ps1` 写 `%TEMP%/cmspark-computer/estop-ready.json`；helper 进程死掉后 **tombstone 仍在**，TS 侧把旧 ready 当存活、用陈旧 mtime 算心跳。
- 修法（`96548e1`）：读 ready 时检测 PID 是否存活；死 PID → 清 tombstone；spawn 前再清一次，避免复活后读到旧文件。
- 教训：凡「文件心跳 / ready 标记」健康检查，**必须**附进程 liveness（PID + kill(0)/OpenProcess），不能只信 mtime；crash 后磁盘 artifact 会伪装成 healthy。
- Files: `companion/src/computer/estop.ts`, `companion/tests/computer-estop.test.ts`

### Windows estop：Node `spawn({detached:true})` 让 powershell -File 秒退（2026-07-28，用户验收）
- 现象：tombstone 修完后仍 `estop helper ready file missing (helper not running)`；ensure 轮询 ~8s 失败。
- 根因复现：`spawn(powershell, [-File computer-estop.ps1], { detached: true, stdio: 'ignore', windowsHide: true })` → **exit 1、无 ready.json**；同脚本 `detached: false` 或 `Start-Process` 正常写心跳。
- 修法（`7c7611b`）：`spawnEstopHelper` 改 `detached: false`（helper 与 companion 共生命周期 + `unref` 不挡事件循环）；脚本缺失时把路径并入 refusal reason。
- 部署：全量 `build-windows-exe.ps1` 可能被 `dist-package/**/debug.log` 锁失败 → 可热覆盖 `cmspark-agent.exe` + 确保旁置 `host-scripts-win/`。
- 教训：Windows 上「后台常驻 ps1」**不要**想当然 `detached:true`；先最小 harness 比只改 ready 解析快。
- 用户验收：host_computer 过 estop preflight 成功。

### Side Panel `t.skills is not iterable`：skill.list 载荷非数组（2026-07-27）
- 现象：扩展运行时 TypeError `t.skills is not iterable`（store / BottomBar / slash skills）。
- 根因：`SET_SKILLS` 等路径把 **undefined/非数组** 当数组 spread/iterate；companion `skill.list` 异常或旧协议时 payload 形状漂移。
- 修法（`0108fd4`）：`Array.isArray` 守卫 + 默认 `[]`（agentStore、useWebSocket、BottomBar、SlashCommandPopover、App）。
- 教训：跨进程 list 载荷一律 **归一成数组再入 store**；禁止信任 wire 上「一定是 array」。

### BottomBar「更多」被裁切 + 用户加载 dist-package 扩展（2026-07-27）
- 现象：点「更多」看不到菜单项（像被遮挡/无选项）。
- 根因链：① 父级 `overflow`/`overflowX:auto` 裁切 absolute 菜单；② InputArea 绘制序盖住菜单；③ **用户加载的是 `dist-package/...` 里的扩展，不是 `chrome-extension/build`** — 本地改 build 不生效。
- 修法：菜单改 `position:fixed` + 视口定位（`2536320`/`725197f`）；验收前 **重打 Windows 包把扩展同步进 dist-package**（debug.log 被锁时可 stage 到 `dist-package-new`）。
- 教训：修 UI 前先问/确认 extension 加载路径；packaged 用户路径与 monorepo `build/` 不是同一 artifact。

### Enterprise L2：allowlist/task 授权 ≠ 跳过 forceConfirm（2026-07-27 A+B）
- 现象：netsec 已 allowlist 仍每 op 弹 L2；用户期望 session 一次允许 / 全局 enterprise god-mode。
- 根因：`shell_exec` / `netsec_port_scan` 走 `capabilityForceConfirm`；**`auto_approve_dangerous` 与 host session-trust 不自动覆盖 enterprise forceConfirm**。
- 产品解：
  - **A** thread-scoped enterprise session trust（per-family `netsec`|`shell`）；idle 30m + hard 8h from last **interactive** grant；auto-approve 不 touch 续期
  - **B** `security.auto_approve_enterprise_tools`（default false；phrase gate；`FORBIDDEN_PACK_KEYS`）
- Gate algebra **G1**：`mustInteract = (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip`
- 文档：`docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md`
- 教训：多层安全「跳过」必须写清代数；allowlist/task auth/L2/forceConfirm/god-mode 不是同一开关。

## Reusable Patterns

### 知识库 Wave A/B + 开闸 + 查重：kimi 主线、grok 接手、claude+kimi dual（2026-09-03 · #272–#283）
- **链**：#273 Wave A #275 → #272 草稿 #276 → #274 文件夹 #277 → #273 Wave B #278 → 开闸 #280 → PDF 编码 #282 → 查重 #281/#283。Pi 不在 PATH 时第二路用 **kimi -p**，不要嵌套 grok `--output-format text`。
- **开闸**：评测双栏 pass 才把 `KNOWLEDGE_ROUTE_*_BRANCH` 改 true；用户「按堆选文」默认仍关。漂移扳机流程性（评测不在 CI）。
- **查重**：sha256(剥 frontmatter 的 body)；空/扫描件占位**豁免**（否则同名同页数扫描件目录导入静默丢）。单篇可强制第二份；目录跳过并计数。
- **4 行 case**：动作=接手 kimi 未完成开闸+查重；成功=CI 绿合 main；归责=占位正文当 exact-match；保护=Gate-d281 kimi REJECT 折进 spec

### 体检批次：Issue-first → 四路折针 → kimi+claude dual → TDD → CI → squash（2026-08-29 · #245–#254）
- **链**：深诊 fanout → GitHub Issue → strawman → 四路独立对抗（Security/Product/Impl/Skeptic）折针进 spec → **kimi+claude** dual（Pi 不在 PATH）both AWN 才写码 → TDD 机核 → PR → 实现 dual + CI 全绿才 squash。实现 agent 不得自评放行。
- **校准**：Critical=未认证 RCE/配对绕过；High=已认证完整性/等价 RCE。overlay 钥匙出 argv 是 T3 误标不是 unauth RCE。
- **禁**：`SUMMONER_ALLOW` 当本季 rollback（#230 冻）；overlay Allow/Deny；拆 `message-router.ts`；宣称 Capture/CU/F-S-10 闭合；扩 #228 profile。
- **本轮合入**：A+B #246 · C #248 · D #250 · E #252 · F #254；tip `5c4fcab0`。
- **4 行 case**：动作=用户说继续；成功=有界票+双路 AWN+CI 才合；归责=无票设计会忘；保护=CONTRIBUTING Issue-first + eval gate

### 需求设计 Issue-first；冻结清单禁止「继续」整票做（2026-08-27）
- **坑**：SoT 只活在 `docs/superpowers/specs/` → 下场会话当没发生过。#230 是追踪+禁区，说「继续」容易把 F-S-10 / overlay-acl 当主线。
- **做法**：新产品行为先 `gh issue create`（模板 `.github/ISSUE_TEMPLATE/design.md`），spec 头 `GitHub: #N`，PR `Closes/Refs`。冻结票拆**子 Issue** 再动（#235 grant-cli、#237 RunProgress tool）。T2 仍计划 dual → 实现 dual；T1 CLI 校验可机核后合。
- **本季**：#228 T1 关（禁扩 profile）；#229 快/淡关；#235/#237 关；#239/#240 ChatShell 合；#241/#242 Capture 卡合；体检 A–F #245–#254 合。**#230 仍冻** F-S-10 / overlay-acl。
- **4 行 case**：动作=用户说继续；失败=差点做 T3 冻结项；归责=追踪票当实现票；保护=CONTRIBUTING Issue-first + #230 自己的「未开子项不许顺便」

### Knowledge Honesty 波浪：身份三分 + ledger 芯片 + 话题夹字符串（2026-08-25）
- **定位**：日常浏览器+本机知识助手；不是 Codex / Raycast / Project / 图谱 DB。
- **身份**：`{id, filename, title}`；CJK title 可入库；filename `k-<sha10>` 防 `--.md` 互撞；写盘统一 helper。
- **诚实**：RAG/truncate/entries/search 都 sanitize；`retrieved_sources` 挂 assistant 消息；芯片 ⊆ companion ledger，禁模型脚注。
- **导入**：preview + `user_gesture`；overlay **禁** `knowledge.*`；提炼=`thread.distill_preview` 脱敏后走同一确认 modal，永不自动写盘。
- **相关 ≤3**：query-time 抄 `threads/related.ts`，不落边。话题夹=`Thread.topic_folder` 标签，`thread.update` **allowlist 必须含该 key** 否则 UI 更新被丢。
- **闸门**：Wave 0 / 0b+1 r3 / Wave 2 dual 均 both AWN。本机已 `make package-macos` 换装 `/Applications/CMspark.app`（备份 `~/CMspark.app.bak-20260825-133708`）。
- **SoT**：`docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md`

### 合后独立复验 squash ≠ WIP r2（2026-08-25 · #220→#221）
- **坑**：合前四路 r2 打的是 `c5b4242` **未提交工作区**；squash `1d16b0e` 是另一份树。r2 AWN 不能当 live main 证据。
- **做法**：`git pull` → freeze `base..HEAD` SHA256 → 四路 **worktree** 独立对抗（重放原 BLOCK + 变异杀死）→ 合成 → `dual-external-review.sh` Claude+Pi（先 stash 脏 `session.md`，否则 diff 掺记忆层）→ 折 nits 再 PR → CI 绿 squash。
- **worktree**：子仓无 `node_modules`；`NODE_PATH=` 主仓 `companion/node_modules` 或临时 symlink，跑完拆。`js-yaml`/`openai` ENOENT 是环境，不是产品红。
- **本轮**：#220 合后复验 AWN → 折 nits → 再四路+Claude/Pi AWN → #221 `ac0a3be`。
- **4 行 case**：动作=拉取 #220 开对抗；成功=live HEAD 独立 HOLD + nits PR 合；归责=WIP r2 被当成合入证明；保护=T2 确认序（对抗→Pi/Claude，实现不得自评）

### C-thin 召唤壳：loopback HTML + SSE + Chromium `--app`，冻 AppKit（2026-08-24 · #219）
- **产品**：企业工作台 = 一 loop 三 surface（L0 召唤 / L1 Side Panel / L2 Cockpit）。跨平台不是 Mac-only Swift。
- **壳**：同一份 HTML；token/Host/Origin 抄 settings-web；tray 代发 summoner ACL。有 Chrome/Edge → `--app=` 640×720；否则 `open`/`xdg-open`/`cmd start` 诚实降级。
- **禁止**：Electron；给 `isAllowedWsOrigin` 加 loopback；overlay Allow/Deny；再给 `SummonerOverlay.swift` 加功能（Mac NSPanel 冻结）。
- **闸门**：T2 独立对抗 → Pi；REJECT 折 nits 再 r2；用户说「CI 绿再合」才 squash。原生 WKWebView/WebView2/GTK 仍可选。
- **SoT**：`docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

### 五路独立对抗 → 用户拍两叉 → 落地三路 REJECT → 修 → CI 合（2026-08-17 · #193）
- **设计**：A JTBD / B 呈现 / C 起名 / D 清理 / E 安全 互不看见；合成后只让用户裁 1–2 个真分歧（本轮 C′ 写库 + D 预勾）
- **落地**：H1 呈现+召回可单独验收；H2 起名写口防新 husk；实现后再开独立对抗，**禁止同会话自 APPROVE**
- **本轮 REJECT 共识**：活跃草稿预勾、body 失败词、Trust exceptId、终态漏钩/双写、batch≤50
- **相关**：`alias-commit.ts` 唯一写口；`cleanup-rules.ts` 纯函数金样

### 四路对抗 REJECT → 修 B1–B4 → dual R2 both_ok → CI 绿合 main（2026-08-12 · #184）
1. 产品缺口（UI id / 大 zip / download shelf）实现后 **四路独立 adversarial**（安全/正确性/下载/UI）
2. 内部 REJECT 落 `docs/audit/reviews/*adversarial*`；修阻塞项 + R2 nits 再收一档
3. `scripts/dual-external-review.sh` Claude+Pi：R1 REJECT 可接受；修后 R2 **APPROVE_WITH_NITS** 才合
4. `gh pr checks --watch` 全绿 → `gh pr merge --merge --delete-branch`
5. 价值：避免 shelf-recovery 错误语义被单测固化进 main

### 对抗 REJECT → 分 Slice 吸收 → dual → nits 再 PR（2026-08-12 · #179）
1. 真机/四路对抗合成 **REJECT** 落 `docs/audit/reviews/*adversary-synthesis*`
2. 按 F-merge 表 **Slice 实现**（soft/pin/package/UX）+ 机核
3. `scripts/dual-external-review.sh <batch> <prompt> origin/main`（未跟踪新文件须 **stage** 才能进 patch）
4. `APPROVE_WITH_NITS` → **同会话**吸高优先 nits → 再开/更新 PR（本轮 #179）
5. 价值：避免 REJECT 快照直接 merge；nits 不隔夜腐化

### Deep-diagnosis 按严重度分批合 main（2026-08-11–12 · #172→#175）
1. Fanout 出 P0/P1/P2 action plan（`docs/audit/deep-diagnosis-fanout-report-*`）
2. **每批独立分支** off main：`fix/p{0,1,2}-…` → 实现 + 机核 → PR → 盯 CI → rebase merge
3. P2 可再开 **residual closeout**（#175）：god-file 续拆、密钥 dual-home、多 OS smoke、host 长进程 integrity
4. CI 失败先修（如 oneshot 错误码顺序）再合；closeout 落 `docs/audit/*closeout*`
5. 价值：P0 不堵在大 PR；residual 写在 closeout 清单上可验收「清单清完」

### 功能 PR → dual nits follow-up → 同日合 main（2026-08-11 S65 · #165→#166）
1. 产品小方案先锁契约（运行时 fallback vs 写 thread / shell 是否跟）
2. Grok workflow 或单会话实现 + 机核 → **独立对抗** → `dual-external-review.sh`（Claude+Pi）
3. `APPROVE_WITH_NITS` 可先合主功能；**同会话**开 follow-up PR 清 catalog/UI/symlink/docs nits，CI 绿再合
4. 审计落 `docs/audit/reviews/<batch>-{adversary,claude,pi,verdict}*`

### Remote 分支卫生：PR 历史 → merge-tree → 删 stale（2026-08-11 S63）
1. `git fetch --prune` + `gh pr list --state open`
2. `git branch -r --no-merged origin/main` → **候选**，非判决
3. 每支：`gh pr list --state all --head <branch>`；tip subject 是否已在 `origin/main` log
4. `git merge-tree --write-tree origin/main origin/<b>`：NO_OP / 小 doc / **大 server.ts 回灌** → 分类
5. 已合或仅 handoff 噪声 → `git push origin --delete`；真正未合内容 → **基于当前 main 重建**，禁整支 stale 硬合
6. 顺手清 `merge-base --is-ancestor origin/<b> origin/main` 且 ahead=0 的 remote

### 大重构后合 PR 序：底座 → 叠层；CI 绿再 merge（2026-08-10–11 · #162→#163）
- multi-adv 安全残差 **#162** 先合 main，再把 god-file **#163** retarget main
- C10 机械 extract 按 A–H 分期 + 日终 dual nits；CI 失败先修 bind 再 merge
- 价值：避免叠层 PR 与底座冲突、避免未 bind 的 test 绿本地红 CI

### Windows 真机「修了不生效」排障序（2026-08-09 S62）
1. **进程路径**：`Get-Process cmspark-agent | Path` 是否 `dist-package\...\cmspark-agent.exe`
2. **二进制时间戳**：`companion\dist` vs `dist-package` 是否一致；不一致则停进程 + 重编/拷贝
3. **源码绑定**：L2 类错误查 `issueTokenFor`/`validateTokenFor` 是否同 `bindingPayloadFor`
4. **扩展加载路径**：用户是否加载 `dist-package\...\chrome-extension` 而非 monorepo `build/`
5. **再验功能**：shell / 听写分层（权重 / binary / 麦）

### L2 危险工具 token 改动检查清单（2026-08-09 S62）
- [ ] `SecurityPolicy.bindingPayloadFor` 覆盖全部敏感字段（含 cwd、targets、ports…）
- [ ] L2 签发只用 `issueTokenFor`
- [ ] `executeCompanionTool` / 各 case 只用 `validateTokenFor(params)`（禁止 bare string）
- [ ] 单测：非默认 params（cwd 非空）issue → validate true；篡改字段 validate false
- [ ] 打包路径：SEA 含修复 + 文档/用户须重启 companion

### 多波次能力：分析 dual → 计划 dual → 实现 dual → nits → PR/CI merge（2026-08-07 S51）
- **场景**：长对话压缩 / 场景知识 / 冷检索等跨 Surface·Compose 的串联交付
- **闸门**：`docs/superpowers/specs/*adversarial*` → plan dual（可 REJECT 修 SoT）→ impl dual → 折 nits → commit → PR → CI 绿 merge
- **Wave A**：`active_knowledge_ids` 端到端 + 场景 `knowledge_refs`（修 UI 发字段但 allowlist 丢弃的 orphan）
- **Wave B**：H1 结构化 handoff `[context_handoff]`（勿称 M3，compact-ux 的 M3 是 UI 折叠）
- **Wave C**：`thread_recall` 同 thread 关键词冷检索 + F-S5 + CJK 双字；hint 仅 `isToolAllowed`
- **Ship**：A+B **#134 MERGED**；C 实现 dual 过、session-end 时待 commit/PR
- **价值**：计划门抓住 redact 形状错误，避免「测试绿但生产泄 cookie」

### 产品冲突 ADR 时：选项阶梯 A 可控 / B 全局 / C 仅引导（2026-08-06 S46）
- **场景**：用户认为「场景应能跳过 L2 / 开 module / 写 auto_approve」，与 Pack=Composition 冲突
- **做法**：先列 A（apply 授权单+可回滚）/ B（全局 Trust 注入）/ C（仅引导）；用户点选后再实现；B 须改 ADR 修订说明 + snapshot restore + 仅 user origin
- **价值**：避免实现 agent 静默沿用旧「禁止」或静默放大 Trust

### 多路对抗设计 → dual-review → 再按序实现（场景/Trust 类）（2026-08-06）
- Security / Product-UX / Impl 三车道 plan agent（UX 可失败则主会话补）→ `docs/superpowers/specs/*` 合成 → `dual-external-review.sh` → 按 §实现次序写代码
- SoT：`docs/superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md`

### 实现 workflow：节点 Pi-only + 里程碑 Claude+Pi dual（2026-08-03 S38）
- **何时用**：多切片实现且需外部审，但不想每个切片都跑双路（贵/慢）
- **脚本**:
  - 节点：`scripts/pi-external-review.sh <batch> <prompt> [base]`
  - 里程碑：`scripts/dual-external-review.sh <batch> <prompt> [base]`
- **编排例**: `.grok/workflows/llm-anthropic-protocol-p0-with-gates.rhai`
  - Prep → Node impl → Pi → Fix/recheck → … → M1 tests → dual → Fix → Ship note
- **门禁**: Pi/dual REJECT 则 `await_user`；NITS 修安全/正确性后可过
- **价值**: N1 真实抓住 denylist 绕过；M1 dual 锁定 ship 面

### 合 main 后多路对抗复审（post-ship multi-lane review）（2026-08-03）
- **何时用**：#105/#106 类大 diff 已合 main，需要独立于实现会话的对抗体检
- **步骤**：
  1. `git fetch` + 安全 rebase/ff；收集 **生产路径** diff（排除 audit 文档噪声）
  2. 并行 4 路 read-only subagent：Security · Correctness · Architecture · Compat（可按题换角色）
  3. 编排器 **[inspected]** 抽检 HIGH（勿盲信 lane 摘要）
  4. 合成：任一路 REQUEST_CHANGES 且 architect≠CLEAR → 最终 REQUEST_CHANGES；写 `docs/audit/reviews/multi-adversarial-review-*.md`
- **价值**：捕获 dual-write 文案撒谎、失败路径状态机、跨平台文案等实现门控易漏项
- **产物例**：`docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md` · **S45** `multi-adversarial-review-20260805-main-s45.md` → PR #125

### Windows 上 dual-external-review（2026-08-05 S45）
- **坑**：`bash scripts/dual-external-review.sh` 依赖 WSL；无 WSL 时整脚本失败
- **坑**：PowerShell `*> file` 写 **UTF-16 LE BOM** → `read_file` 报 binary；需转 UTF-8
- **坑**：`pi -p -t read,bash` 偶发只吐 DSML tool_calls 不收口 → 改 `-t read` 或重跑；Claude `claude -p --permission-mode acceptEdits` 较稳
- **做法**：实现 diff 单独落 `docs/audit/reviews/<batch>-diff-*.patch`；verdict JSON 手写/脚本；commit message 用 temp 文件勿 HEREDOC

### 产品安全入口：对抗四角色 → SoT → Pi/Claude 双审 → 再实现（2026-08-02）
- **何时用**：改 Trust / 确认门 / 高风险 UI 叙事（尤其用户与 ADR 心智冲突时）
- **步骤**：
  1. 并行 subagent：Product/UX · Security · Compat/ADR · Autonomy（或平台角色）
  2. 写 adversary synthesis + design SoT + impl plan（锁 D/S/R 门）
  3. `scripts/dual-external-review.sh <batch> <prompt>` → 双方 APPROVE / APPROVE_WITH_NITS
  4. 折叠 nits 再写代码；**gate algebra 默认不动** unless plan 明确
- **模板**：`docs/audit/reviews/trust-ia-autopilot-dual-review-prompt-20260802.md` · macos-tcc / mission-pack UX 同类
- **反模式**：先扩 god 语义再补文档；双审前实现；用「Autopilot」作第 4 能力轴


### macOS CU 热键 vs fail-closed（2026-08-02）
- Fail-closed 应对 **socket proof-of-life**（companion 持连）；全局热键/CGEventTap 为 best-effort
- LS 启动路径 ad-hoc TCC 常比 CLI 严：勿用 CLI `security-check` 断言 app 内 tap 可用
- Soft-fail + 日志 `hotkey DEGRADED` 比 exit(4) 更不易把整条 CU 打死

### P0 batch-fix + 对抗后 Pi（或 Claude+Pi）外部审（2026-08 续用）
- Workflow：实现 → 定向测试 → `pi -p --no-session`（+ 可选 claude）→ APPROVE* 才 ship
- kimi：`-p` 不可与 `-y`/`--auto` 同用；用户可跳过 Kimi 只保留 Pi/Claude

### ADR-020 后 backlog 必须换坐标系（2026-07-29）
- 本体：`docs/adr/020-capability-model-three-axes.md`（Surface / Composition / Autonomy；Trust 横切）
- **排序权威**：`docs/optimization-plan-post-adr-020.md`（A 治理 → B Trust P1 → C Pack-first → D L2 → E Autonomy）
- 旧 `docs/optimization-plan-post-v0.3.0.md` 仅考古，**勿**再按 §6 开任务
- 新场景默认 **Pack + skill/MCP**；禁止裸「中层 Agent」；PR 填能力声明（`.github/pull_request_template.md`）
- dual-review 自动附：`docs/audit/reviews/_templates/dual-review-capability-checklist.md`（`scripts/dual-external-review.sh`）
- 安全残余盘点模板：先写 `docs/audit/p1-*-open-items-*.md`（OPEN/FIXED + 文件锚点）再改代码

### Outbound MCP Server 方向（2026-08-03 · DIRECTION LOCKED · 未开工）
- **问题**：给 Claude/Cursor/Grok 等编程 Agent 暴露真实 Chrome 能力 — Skill 不够，主路径是 MCP Server
- **不做**：通用 Browser MCP 克隆；默认出 L2/cookies/shell；用 Skill 冒充浏览器服务
- **做（若做）**：Composition 导出 curated L1；Trust/HITL/审计差异化；对照 Playwright（无状态）与 DevTools MCP（调试）
- **锁 L1–L9**：见 `docs/decisions/cmspark-as-mcp-server-brief-2026-08-03.md`（含 L3+ 页内容出境、L4+ stdio≠auth、L8 IDE 确认不依赖 Side Panel、L9 双入口 tab lease、`cmspark__*` 命名）
- **真相**：今天 Companion 只是 MCP **client**；`ws_secret` 不管 MCP caller
- **排序**：挂 optimization-plan §C；**不**插队 B 轨 P1；Phase 0 bake-off 后才扩面
- **双审**：Claude+Pi APPROVE_WITH_NITS → `cmspark-mcp-server-strategy-verdict-20260803-150011`

### Broadcast pattern for cross-client actions
- When tray triggers an action that should execute in the Chrome extension, companion creates the entity then **broadcasts** a start message to ALL WebSocket clients
- The extension picks it up and initiates its own request through its connection, so streaming flows naturally
- Avoids needing to modify the chat/streaming pipeline to support cross-client routing
- Files: server.ts `broadcast` fn → message-router.ts broadcasts `quickAction.start` → extension forwards to sidepanel → sidepanel sends `chat.send` through its own WS connection

### P0 batch-fix + 对抗后 Claude/Pi 双外部审（2026-07-25，可复用）
- Workflow: `.grok/workflows/p0-batch-fix.rhai`；脚本 `scripts/dual-external-review.sh`
- 链：Design → Implement → 内部对抗(2 skeptics, fail-closed) → **仅对抗通过后** 分别起 `claude -p` 与 `pi -p` → 双 APPROVE/APPROVE_WITH_NITS → build → commit
- Claude：`--permission-mode acceptEdits` + Read/Grep/Glob/Bash；**不要**用 plan mode（终稿 VERDICT 会吞进 plan 文件 → 脚本判 UNKNOWN）
- Pi：`-p --no-session -t read,bash`；可能长时间空 stdout 挂起 — 可用户 waive，用 Claude + 对抗 + host 定向测推进，事后补 verdict 文件
- **Pi 机读行**：提示词要求最终一行 **英文** `VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT`（中文「审查结论」易被脚本漏匹配 → UNKNOWN）
- 产物目录：`docs/audit/reviews/`；批次报告 + claude/pi md + verdict json + patch
- 诊断 fanout 姐妹流：`.grok/workflows/deep-diagnosis-fanout.rhai`（子系统 10 + 横切 6 + 对抗 16 + 综合）
- **设计/plan 也可用同一脚本做 Task 0 门**（例：`native-hud-p3a-spike-plan`）；APPROVE_WITH_NITS 后 nits **必须折入文档再写代码**

### Agent 安装外部 Skill 场景 backlog（2026-08-01）
- 用户意图：Chrome 插件驱动下载 skill 包 → 配置给 **CMspark** 使用（非 Claude `~/.claude/skills`、非仓库 `skills/`）
- 落点必须是 `~/.cmspark-agent/skills`（`getConfigDir()/skills`）；UI 导入已支持；**LLM 无一等 skill_install tool**（`skill.import*` 仅 WS/UI）
- #au4dch 失败模式：装到项目 `skills/` 或只解压 Downloads → 面板看不到
- 文档：`docs/optimization-plan-agent-skill-install.md`（挂 Composition backlog）

### #au4dch UX 子轨：下载去重 · 运行态 · Shell 两轨（2026-08-01）
- 会话证据：单线程长 `shell_exec`（非 spawn_worker）也会被用户感知为「卡住/已结束」；`processingLabel` 只看 last assistant.tool_calls，与 `tool.start`→`role:tool` 结构错位
- shell 黑窗：`capability/shell.ts` spawn 未 `windowsHide`；stdout 仅 close 后回传 — 先止血（A）再 PTY epic（B），禁止混 PR / 禁止塞 Side Panel 半成品终端
- 下载：`download-waiter` 故意忽略 pre-existing complete → 需 `downloads.find` / `prefer_existing`，不是再加强制 click
- 文档：`docs/optimization-plan-au4dch-ux-shell-download.md`（挂 post-adr-020 执行序，不取代 A–E 权威）

### Trust P1 批 + browser_download：独立 PR + 共享 CI 修 cherry-pick（2026-07-30）
- Workflows：`.grok/workflows/p1-security-batch-fix.rhai`（P1-1…4）；`browser-download-p1-with-gates.rhai`（spike 门 + 实现 + 双审）
- **独立分支** 基于 main，勿叠 PR；合入顺序 #90 CI 修 → Trust/功能 → 冲突几乎都在 `p1-security-open-items` 摘要表
- 摘要表冲突：两边 **FIXED 取并集**；文首「下一枪」跟 main 实际状态改
- CI 根因修（cwd / osascript 平台测）**先 cherry-pick 到所有开放 PR** 再等绿，否则 6 条 PR 全红
- browser_download：PRIMARY `chrome.downloads`；Downloads 沙箱；`DOWNLOAD_BUSY` 在 TabQueue 前；`download` 别名在 companion 入口规范化

### Tab lease 仅 multi-agent：单 agent 多 tab 勿 HARD lease（2026-07-28 PR #81）
- 现象：普通聊天 / AppSec 打开第 3 个 tab 命中 `max_tabs_leased_per_worker=2` → 硬失败
- 修法：`server.ts` early HARD + SOFT + `create_tab` autoHold **仅** `isMultiAgentThread || anyTabLeaseHeld()`；lease 错误进 `classifyError` recoverable
- 教训：ADR-015 排他锁是 **worker 编排** 工具，不能默认套在所有 CDP 线程上
- Files: `server.ts`, `tab-lease.ts`, `security.ts`

### Site knowledge 自动注入必须扩展发 hostname（2026-07-28 PR #81）
- Companion 早已 `resolveKnowledgeIdsForThread(..., hostname)`，但扩展 chat 不带 hostname → `getBySite` 永空
- 扩展：`getActiveTabHostname()` 只传 hostname（不传完整 URL）；chat.create/regenerate/file.upload/quickAction
- Companion：`normalizeHostname` case-insensitive；hostname **只**用于选 knowledge，不是 trust 门
- Files: `active-tab-hostname.ts`, `message-router.ts`, `site-matcher.ts`

### Docs reorg Phase1–4 门控编排（2026-07-28，已合 PR #80）
- 计划：`docs/docs-reorg-plan-2026-07-28.md`；终报：`docs/audit/reviews/docs-reorg-phase1-4-final-report.md`
- Workflows：`.grok/workflows/docs-reorg-phase12.rhai` / `…-continue.rhai` / `…-phase34.rhai`
- 门：实现 → 内部对抗 → **Claude+Pi**（`dual-external-review.sh`）→ nits → 归档 `git mv`（禁首轮 `rm`）
- 恢复套路：workflow 代理断流/Rhai 炸 → **手工**跑 dual-review + 本地 adversarial；Claude 429 → 信 Pi + adversarial，额度后再补 Claude
- 归档锁：勿动 `decisions/coordinate-computer-use-plan.md`、`host-adapter-interface.md`、HUD N1–N10 lock、`superpowers/`

### Grill + lock doc 再写 plan（Native HUD N1–N10，2026-07-27）
- 顺序：product brief → dual-review → **grill N1–N10**（双独立 agent 强制 LOCK|AMEND|OPEN）→ lock 文档 → spike plan → plan dual-review → 才允许代码
- 数值分歧取折中并写进 lock（例：heartbeat Claude 2s vs Pi 3s → **3s**；ping 250 vs 500 → **400ms**）
- Spike 与 production 分层：spike 证明 open/hydrate/confirm/abort/standby；截图 dual-track 单独门禁

### 定点修复: kimi 改动前复审的动态工作流
- 已沉淀为个人技能 `kimi-gated-fix`(~/.config/skills/kimi-gated-fix/),含可移植的 workflow-template.js
- 模式: 对已诊断到代码行的 bug,dynamic workflow pipeline(Design 精确 diff → kimi 改动前复审 → 仅 APPROVE 才 Apply → build 验证);主会话再对完整 git diff 做 kimi 终审
- kimi 调用: Write prompt 文件 → `$KIMI -p "$(<file)" --output-format text`(避开 shell 转义)
- apply 子代理 stall 兜底: 主会话手动补 kimi 复审 + Edit,不重跑整流(实战遇过连 stall 6 次)

### 全量代码审计 via Fuck My Shit Mountain skill（2026-07-09，可复用工作流）
- 技能目录:`~/.config/skills/Fuck_My_Shit_Mountain/fuck-my-shit-mountain/`;盘点脚本 `scripts/project_inventory.py <root> --format json`;报告 lint `scripts/report_lint.py --modes <modes> <file>`。
- 工作流(full 模式):必需输入 = 审计模式 + 报告语言 + 输出格式(用 AskUserQuestion 一次问清);→ 加载 `prompts/full-audit.md` + 6 个 rubrics(severity/confidence/evidence/coverage/scoring/principles) + `templates/{audit-report,issue-card}.md`;→ 按"维度簇"fan-out 并行 general-purpose 子代理(每个深读相关文件返回 file:line 级 issue-card findings);→ 主会话对 Critical 论断做对抗性复核(直接 Read 源码确认,避免子代理误报虚高);→ 综合 + 逐维度打分(0-10,10=最好);→ 按 `templates/audit-report.md` 写报告;→ `report_lint.py` 修到 OK;→ 元数据存 `.claude/audits/`。
- **关键坑(lint 格式)**: finding 头必须是 `### Finding: <title>`(不是 `### 🔴 C1 —`);13 个字段必须是 `- Field: value` **无 `**bold**`**(lint 正则 `^-\s*Field:` 匹配不到 bold);统计表计数必须等于全局 `- Severity:` 行数。初稿用 emoji 头 + bold 字段 → lint 报 count mismatch + 缺维度小节 → 整份重写。一次写对可省一次重写。
- full 模式需 25 个维度小节(section 头须含对应关键词如 "Architecture"/"Code Consistency"/"Comment Coverage"),漏一个 lint 即 FAIL。
- 评分是判断不是扣分:承重墙缺陷(如 WS 信任根缺失)按"系统性 vs 孤立"判,不按个数平均。
- 边界:技能默认只审计出报告,不改源码(除非用户明确要求实现修复)。

## Technical Pitfalls

### F-S5 `redactMessagesForCompaction` 依赖 assistant↔tool 配对（2026-08-07 · Wave C dual）
- **现象**：计划写「对 hit 建 `{role,content}` 再跑 redact」——双审 R2 REJECT。
- **根因**：F-S5 用 assistant 消息里的 `tool_calls[].id` → name 映射，再靠 tool 消息的 `tool_call_id` 查敏感集。持久化 tool 行若只传 content、无配对/无 name，name 退化为 `"tool"`，**绕过** cookie/shell 分支，只剩 sk-/Bearer 正则。
- **修法**：`toCanonicalForRedact` 必须带上配对 assistant，或对孤儿 tool **合成** `{role:assistant, tool_calls:[{id, function:{name}}]}`；name 解析顺序 `tool_name → name → function.name`；仍无法解析则 **drop hit**（fail-closed）。
- **测试**：孤儿 `get_cookies` + 配对 `shell_exec` 必须断言原文 secret 不出现。
- **复用**：任何「历史回放 / recall / compact 输入」复用 F-S5 时先查此坑。

### 测试隔离：静态 import 会在 `before()` 设环境变量前计算模块级路径
- 现象：companion `security-gates.test.ts` 6 个安全闸门用例静默红（`timeout waiting for security.confirmation.request`），疑似生产 bug。
- 根因：`import { ... } from "../../src/server.js"`（静态）在模块加载时（早于 `before()` 的 `process.env.HOME = tempDir`）就执行了 `src/config.ts` 的 `export const DATA_DIR = process.env.CMSPARK_DATA_DIR || os.homedir()/.cmspark-agent` → DATA_DIR 锁死到**开发者真实 home** → 测试读真实 config（如开了 `auto_approve_dangerous`）→ 确认被自动批准 → 等不到确认请求。
- 修法（两种，等价）：① 加一个「最先 import」的 setup 模块，在 `src/config.ts` 加载前设 `CMSPARK_DATA_DIR` 到临时目录（security-gates 用此）；② 在 `before()` 里**动态** `await import("../src/config")`（config.test.ts / history.test.ts 用此）。两者都让 DATA_DIR 在 config 加载时已指向临时目录。
- 教训：任何「模块级常量读 env/算路径」的模块，测试若要隔离，必须保证 env 在该模块**首次加载前**就位——静态 import + before() 设 env 是经典坑（import 先于 before）。

### node:test + ws：teardown 的异步错误会被判文件失败
- 现象：`security-gates.test.ts` 13/13 用例全过，但 node:test 仍把**整文件**标红 `'test failed'`（无具体断言）。
- 根因：afterEach 里 `terminate()` 一个仍在 CONNECTING（readyState 0）的 client ws，触发异步 `"WebSocket was closed before the connection was established"` → uncaughtException → node:test 标文件失败（不归属任何用例）。诊断：`process._getActiveHandles()` 看到 writeOnly 未销毁 socket；stderr 有 "generated asynchronous activity after the test ended"。
- 修法：给两个 ws 加 `ws.on("error", () => {})` 吞掉预期的 teardown 关闭错误。
- 相关：`security-policy.test.ts` hang = 每次 `issueToken` 的 TTL `setTimeout(..., 120s)` 不 `.unref()` → 进程保活 120s；修 `.unref()`（生产无害，token 在内存随进程消亡）。`daemon-cli.test.ts` hang = 测试 `unlinkSync` 锁文件不关 `net.Server` → handle 泄漏；修 `releaseLock()`（关 server）。

### 验证"竞态"再决定加锁（H5 教训）
- 审计称 `saveConfig` 有 read-modify-write 竞态（高），建议加 mutex。**查证为非 bug**：`saveConfig` 全同步（getConfig→deepMerge→writeFileSync 无 await），JS 单线程下同步函数不会被中途交错；且唯一数组追加 caller（server.ts:598 getConfig→613 saveConfig）中间也无 await。
- 教训：JS 单线程下，**全同步**的 read-modify-write 天然原子，不存在交错竞态——只有 caller「读 → await → 用陈旧快照写」才有竞态。审计/评审提"竞态"时先确认是否有 await 间隙，别为不存在的竞态加锁（cargo-cult）。kimi 终审也独立验证了所有 caller无 await 间隙，确认非 bug。

## Architecture Decisions

### 知识检索开闸 + 完全重复导入（2026-09-03 · #280/#281）
- **开闸**：诚实门评测 `folder/group: pass` 后工厂常数 true；开关 `knowledge_route_by_group` undefined=false。SoT：spec 2026-09-02 retrieval-scoring · ADR-027。
- **查重**：`H = sha256(previewKnowledge.body.trim())`；不写 frontmatter。占位/空 body 不参与。F-I-5 仍加后缀不覆盖。SoT：`docs/superpowers/specs/2026-09-03-knowledge-exact-duplicate-import.md` LOCKED。Ship PR **#283** `7ab36063`。
- **禁**：MD5；近似重复；静默覆盖；图谱/embedding。

### 当轮活计划 T3：companion 准入，不是 LLM 记忆（2026-09-01 · #265 · 0.5.7）
- **产品**：聊天列 Wave 1 sticky 可勾清单（线稿 01+02）。**不要** StatusRail 手风琴（#256 已 REJECT path C）；**不要**偷运 Wave 2 FocusBand。
- **对象**：`thread.run_progress`；`source: seed | model_draft | user`。H1 `open_todos` 只许 seed；活计划走 `run_progress_propose`（model_draft）。禁止把 propose 写成 seed。
- **可见性**：每 `chatCreate` 可 propose；第一个 PAGE_TOOL 无清单 → `PROPOSE_REQUIRED`。保证看见步骤的是 companion 闸，不是模型自觉。
- **Trust**：overlay 写 fail-closed（`handshakeSurface` 来自 WS）；worker HARD_DENY propose 且跳过 page-tool 闸。
- **Ship**：PR **#266** squash `2cd41f1d`；lockstep **0.5.7**。SoT：`docs/superpowers/specs/2026-08-31-runprogress-live-plan-design.md`（r2b LOCKED）

### 0.5.3 体检 A–F 合 main；Capture/CU 仍不宣称闭合（2026-08-29）
- **合入**：#246 XSS/hide abort/真 L0/知识截断/estop；#248 osascript URL·MCP env·shell -c·Win 脚本·spawn HMAC；#250 SkillEngine 单例·cookie 首屏·shrink closer·进度双写；#252 Origin 类 handshake·esbuild pin；#254 未知 L2 throw·tab.navigated Origin·user_gesture 转发·netsec /0·MCP 剥内部键。tip **`5c4fcab0`**。
- **仍冻**：#228 禁扩 profile；#229 P2 已合但 DMG 未必含 Swift；#230 F-S-10 / overlay-acl。overlay **永不** Allow/Deny。
- **残留 Medium（未做）**：overlay-privacy-ack、HUD 导入、outbound grant_id、L2 conductor 按 thread、D2 无观看者 drop nextRun。
- **SoT**：`docs/audit/deep-diagnosis-fanout-2026-08-28.md` · 各批 `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-*.md`

### ChatShell 同一张脸：copy 合同 + 扩展起源弹出 HTML（2026-08-27 · #239 · PR #240）
- **产品**：侧栏空态 = 招呼 + `当前页：` + 3 模板填作曲。「弹出对话框」开 overlay HTML 同一 copy（整张脸、**无页**）。Mac 热键仍 Swift 收起条。入口=工具栏 C，不是标签栏药丸。不画实心贴回。
- **协议**：`overlay.shell.open` 仅 `chrome-extension://`；不进 `SUMMONER_ALLOW`。broadcast `{type,thread_id}` 无 id。tray 另挂 `onAppMessage` → `openLoopbackPage`。RPC = `accepted` 不是 `opened`。失败 toast。
- **闸门**：spec/plan 对抗 REJECT→r2 → Claude+Pi 均 AWN。实现 subagent-driven + 终审 I1–I3 已折。
- **已合 main** `#240`。SoT：`docs/superpowers/specs/2026-08-27-chat-shell-same-face-design.md`

### 产品 0.5.3 形态切点：租手实验，T1 PASS 带 nit，不扩 profile（2026-08-27）
- **版本**：companion/extension/NSIS **0.5.3**。切片 1–3/5/6 + 知识诚实 on main。本机 `/Applications/CMspark.app` 已换 0.5.3 DMG（#229 Swift 快/淡**未**打进该包）。
- **T1**：CMspark 臂 OA「我的邮件」完成 + HITL；Playwright 干净 profile 打不开门户。L7 **PASS 带 nit**。`require_grant`/`auto_approve_dangerous` bake-off 后已改回盘上原值。
- **禁**：扩 outbound 默认工具面；overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；不经确认改 live `config.json`。
- **活票**：#228 T1 禁扩 profile；#230 冻结残留（F-S-10 / overlay-acl）。正交 #69/#70/#71。ChatShell #240 已合。
- **SoT**：`docs/superpowers/specs/2026-08-27-post-227-status.md` · CHANGELOG 0.5.3

### Daily assistant · Knowledge Honesty（2026-08-25 · Wave 0–2 on `feat/knowledge-honesty-wave0`）
- **禁**：Project 实体、graph DB、分类表、远程 KB、overlay 知识管理、companion `sidePanel.open`、对话自动入库、Perplexity `[n]`、Raycast 重做。
- **Wave 0**：identity + 全路径 sanitize + CJK。**0b**：确认导入。**1**：本轮附带 ledger。**2**：相关≤3、distill+confirm、话题夹、召唤器瘦身、启动器仅分发文档。
- **Trust**：知识仍是 untrusted retrieved data；overlay ACL 不涨。
- **未合 main**：分支 `feat/knowledge-honesty-wave0`；真机 0.5.2 DMG 已换。Chrome 扩展需重载 `chrome-extension/build/chrome-mv3-prod/`。

### OS summoner = 薄 L0；跨平台是 C-thin HTML，不是第二 Side Panel（2026-08-24 · #219 MERGED）
- **身份**：本机 Agent 全局召唤。Chrome 是按需 L1。overlay **永不** Allow/Deny。
- **合同**：`surface=summoner` ACL（S21，含 `file.upload`）；`composer.lease` overlay vs panel（S20）；busy `chat.create`/`file.upload` → `run_active` 不 supersede；pack.apply `allowTrust` 由 surface 强制 false。
- **宿主**：Mac 仍可 Swift NSPanel（冻增长）。Win/Linux + 跨平台路径 = loopback HTML + SSE + Chromium `--app`。页面不升级 companion WS。
- **Ship**：PR **#219** squash `daf8bc9`。原生 WKWebView/WebView2/GTK 未做。
- **SoT**：`docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md` · `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

### OS summoner overlay = 薄 L0，不是第二 Side Panel（2026-08-23 · S77 · WIP）
- **身份**：本机 Agent 全局召唤（identity 2）。Chrome 关着也能聊；Chrome 是 **按需 L1 执行器**（`pickAuthenticatedClientWs` 只认 extension；`BROWSER_UNAVAILABLE` 不可恢复）。
- **不是**：Raycast 克隆；第二套 Side Panel 家；overlay 上 Allow/Deny（N5 单写者仍是 Panel/HUD）。
- **插件故事**：Pack / Skill / MCP。MCP 工具已在 Companion `chat.create` 目录；overlay 只 `mcp.list` 可见性，**禁** `mcp.add`。需确认时 `resolveMcpConfirmTarget` 改道 extension WS。
- **合同**：`surface=summoner` ACL（S21）；`composer.lease` CAS overlay vs panel（S20）；无 LLM `openChrome` 工具。
- **默认**：Chrome `open -ga` 静默；idle `resume_idle_minutes` 超时新开，历史走 `#`。
- **分支（已过时）**：曾只活在 `feat/os-agent-shell`。**#219 已合 main**（见上条）。GOAL.md/ADR-020 一句话冻到 P0 证伪。
- **SoT**：`docs/decisions/os-agent-shell-brief-2026-08-22.md` · plan `docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md`

### 会话卫生：无意义=无 user；C′ 闭枚举；D 薄 husk 预勾（2026-08-17 · #193 MERGED）
- **SoT**：`docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md`
- **呈现**：空 alias 显示 `空会话`/`编程接力`/`无用户消息`；禁止 `未命名 · id`（`#id` 徽章留下）
- **写库**：ACP 终态且 alias 空 → `接力·{agent}·{审查|起草|失败|部分|取消}`；`p1-wl` 等已提交短码禁止静默改
- **清理**：整理默认全部时间；`acp_husk`/`no_user` 薄默认勾；实质 ACP 与簇主 omit；`cleanup_empty` 仍只硬删 0 消息
- **Ship**：PR **#193** rebase `7a88b8c`

### Windows npm shim ≠ spawnable（2026-08-16 · #191）
- **坑**：nvm/npm 在 `node.exe` 旁放一对垫片：`claude`（`#!/bin/sh`）+ `claude.cmd`。`where` 先列出 shebang。Node `spawn` 无 shell 时：shebang → ENOENT，`.cmd` → EINVAL。仓库里 `shell_exec` 已写过这条，ACP 漏了。
- **修**：`pickWindowsWhereHit`；`resolveAcpSpawn` 解包 `%dp0%`/`%~dp0` → PE 或 sibling `node.exe`+`cli.js`；禁止 `shell:true` 送 prompt；unwrap 失败 `wrapViaCmd` 必须剥 `-p`/长参数/`&|<>`。
- **勿**：把 `process.execPath`（打包 `cmspark-agent.exe`）当 node 跑 JS shim。
- **对照**：`capability/shell.ts` `shouldUseArgvSpawn`、`scripts/verify-ort-sea.js` cmd `/d /s /c`。PR **#191**。

### Windows Mode C 禁止 80ms 假 L1（2026-08-16 · #191）
- **坑**：WindowsApps `wt.exe` 是 0 字节执行别名；`spawn` 常不报 `error`。80ms 当成功会让 UI 写「已打开本机终端」，实际没窗。
- **修**：拒绝裸 `wt.exe` / WindowsApps 路径；`auto` 先 `start`+PowerShell；cmd-host 只 L0；粘贴行带 `Get-Content` 任务文件。
- **诚实**：观察失败必须 `failed` 或真 L0，旧 `ok:false` 比假 L1 更好。

### 编程接力 Panel + Mode C（2026-08-14 · S71 · #190 MERGED）
- **产品锁**：无 TUI embed / 无伪 IDE；Mode C = **侧栏监视桥 + 本机终端双进程**（非同一会话）；Stop 只杀桥
- **诚实源**：`open_local_terminal_snapshot` 在 propose 拍；UI 的 Stop/banner 只信 session 的 `openLocalTerminal` + `local_terminal`（非 live config + 时间线正则）
- **Env**：`buildAcpAgentEnv` = process.env + login-shell snapshot + user-env + server.env；禁止 PATH/HOME/LANG 白名单剥 API key
- **终端偏好**：`coding_handoff.local_terminal_app`；macOS Ghostty 必须 `open -na App.app --args -e bash -lc …`（CLI binary 不能起 GUI）
- **SoT**：`docs/coding-handoff-user-guide.md` · `docs/decisions/acp-dual-open-terminal-mode-c-2026-08-14.md` · PR **#190** `8708f89`
- **仍 DEFER**：TUI embed、full tree、Monaco、与终端完全同一 ACP session

### 编程接力 / ACP Client（2026-08-13 · S70 · feat/coding-handoff）
- **产品**：浏览器证据 → 本机编程 Agent 的 **接力（handoff）**，不是 Side Panel IDE / 第三 runtime；与 Outbound MCP 方向相反（他们租浏览器 / 我们外派写码）
- **分期**：Phase A 任务包复制（`/code`）默认可用；Phase B `config.acp.enabled` 默认 false；写盘/shell-in-agent NO-GO
- **HITL 坑（Pi B1）**：仅把工具放进 `L2_GATE_TOOLS` **不够** — 必须进 `capabilityForceConfirm`，且 ACP 应对 **三旗巡航也永不 waive**（`acpForceConfirm` 覆盖 `userFullAutonomy`）。否则 god-mode/auto_approve 会静默发 token 开 spawn
- **Token 绑定**：新 L2 工具必须扩 `SecurityPolicy.bindingPayloadFor`，禁止落 `default: ""`
- **诚实文案**：UI 用「会话模式: 审查/起草」，禁止「只读」暗示 OS 沙箱（外部 Agent 是独立进程）
- **SoT**：`docs/decisions/acp-coding-handoff-product-design-2026-08-13.md` · ADR-025 · **shipped as #190**
- **演进**：S71 已交付 Panel 实时监视 + Mode C 本机终端（仍非 TUI embed）

## Architecture Decisions (legacy)

### 运行时上下文分层：M1 · H1 · cold recall（2026-08-07）
- **M1**：turn-safe head-drop + omit notice；磁盘全文保留
- **H1**（增强 M2）：结构化工作记忆 goals/decisions/constraints/open_todos/artifacts；注入 `[context_handoff]`；失败 → M2 散文 → M1
- **Cold**：`thread_recall` 按需搜本 thread 全历史（非 embedding、非跨 thread）
- **三系统仍分**：Runtime budget ≠ Digest ≠ Export
- **SoT**：`docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md`

### Trust IA + 运行自主度（2026-08-02）→ **#106 main**
- 协议解锁 + 运行自主度 dual-write 三 bool；否决 Scheme C（God 不扩 CU/shell）
- Ship：PR **#106** `ed92a81`

### 无人值守桌面值守 ADR-021（2026-08-02）→ **#106 main**
- **硬需求**：长程无人值守；微信 `host_computer` 可免 initial L2
- **安全**：对抗 REJECT 目标；产品以 F1–F15 地板 + OCR residual 推进
- **实现**：进程 grant 8h；`hostComputerTrustSkip = G1 || unattended`；open_within_app；仅 coordinateAllowed
- **UI**：无人值守档 + **值守中 · 桌面**；急停 ≠ 解除；Pack 禁武装
- **流程坑**：扩展初始同步加消息必须改 `sidepanel-state.test.ts`；勿 `armed || true` 乐观假绿
- **SoT**：`docs/adr/021-unattended-desktop-session.md` · unattended-desktop design/plan
- **真机**：`docs/superpowers/plans/2026-08-02-unattended-desktop-manual-checklist.md`
- **S36 post-ship（未关）**：UI「不会写入长期配置」与 arm 时 `saveConfig` dual-write cruise/enterprise 冲突；`include_protocol:false` 不清除已有 `allow_all_schemes`；服务端未强制 dual-ack（仅短语）

### Companion Native HUD N1–N10（2026-07-27 LOCK，P3a 前）
- **Source of truth**: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
- **N1**: 一个 Companion 拉起的 Swift 二进制 = tray + HUD 窗；单一 SHA256 gate（可改常量名，不拆第二 gate）
- **N2**: 每 thread 一个 wide shell；败者收 **`shell.standby`（NEW）**；MinimalConfirm 只在 Panel
- **N3**: `hud.shell` auto|native|extension；healthy = PID + heartbeat ≤**3s** + ping ≤**400ms**；冷启动不挡 open
- **N4**: 关窗 ≠ 停任务/改 CapabilityLevel；无 wide shell → Panel MinimalConfirm + toast
- **N5**: 既有 single-writer；wire 晚到结果仍为 **`unknown`**（禁止改名 `already_resolved`）；**broadcast resolved 是 NEW**
- **N6**: Conductor = active wide shell，服务端强制；LIVE 时 Panel send 排队
- **N7**: Tray「打开确认台」走 N3（修正 D16 where native ships）
- **N8**: 禁止静默切换，除 death/health-fail（toast+fallback）或用户改设置
- **N9**: macOS native first；Cockpit parity CI 全平台
- **N10**: DualTrack 右轨 N≤8 + 内滚动，HUD **与** Cockpit 一致
- **Spike wire 归属**: `SecurityConfirmationManager` + `onTerminal` 在 **`server.ts`**；menu-bar 不建第二 manager；spike fan-out 仅 HUD+tray（WS 多端 deferred）
- **P3a 进度（2026-07-28）**: Task 1–6 源码在 main；Swift 源码有、SHA256 rebuild 待 macOS；Task 7 实现双评未做

### Enterprise session trust (A) + global enterprise auto-approve (B)（2026-07-27）
- **Why**: netsec/shell 在 allowlist 后仍每 op L2（`capabilityForceConfirm`）；用户需要 session 级与全局两档缓解，且不冲垮 pack/host 信任边界
- **A**: `enterprise-session-trust.ts` — thread + family(`netsec`|`shell`)；交互 grant；idle 30m + hard 8h；SafetyStrip revoke；不因 auto-path 续期
- **B**: `config.security.auto_approve_enterprise_tools` default false；phrase gate；`packs/types` FORBIDDEN
- **G1**: enterpriseSkip 与 hostComputerTrustSkip 并列；`forceConfirm` 仍可要求交互，除非 A/B 显式 enterpriseSkip
- **UI**: MinimalConfirm + ConfirmElevated 勾选 A；SettingsSlideout 开关 B
- **Plan + ship**: `docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md`；commits `5c3f21b`/`c7924bc` + audit reviews
- **Tradeoff**: B 是真 god-mode 子集（仅 enterprise tools），故意独立于 `auto_approve_dangerous`，避免误开全局危险自动批

### Quick Actions: delegation vs direct execution (2026-06-09)
- **Decision**: Quick actions from tray no longer execute tools directly; instead they create a thread and broadcast to the extension, which starts a normal chat
- **Why**: Previous direct execution + result server approach was fragile and all actions were failing. Delegating to the extension leverages the existing chat pipeline (streaming, tool calling, error handling) and displays results naturally in the Side Panel
- **Tradeoff**: Requires Chrome extension to be connected; no offline/standalone quick actions

### CI test glob globstar 坑：`tests/**/*.test.js` 在 dash 只匹配子目录
- 现象：companion `npm test` 的 glob `tests/**/*.test.js` 在 CI(ubuntu dash)下，`**` 无 globstar 支持 → 只匹配 `tests/<subdir>/*.test.js`（8 个子目录文件），**漏掉所有顶层 `tests/*.test.js`**（config/history/file-parser/ws-origin/threads-history/skills/knowledge/… 共 ~20 个文件/~596 测试）。CI 一直"绿"但只跑 <15% 测试。
- 修复：改用 `find .test-dist/tests -name '*.test.js' -not -name '_*'`（递归 + 排除 setup 模块）。+ settings-web.test 需单独 `node --test` 调用（多文件并发时 node:test IPC 崩溃）。
- 教训：shell globstar (`**`) 不是跨 shell 可移植的——dash/sh 默认不支持，bash 需 `shopt -s globstar`。CI 的 `npm test` 脚本里用 `**` 要么确认 CI shell 支持，要么用 `find` 替代。

### MCP capability 推断的 "unknown" 是 critical，god mode 绕不过（2026-07-14）
- 现象：filesystem MCP server（trust_level="trusted"）的 `directory_tree` 工具，即使开了 god mode（`security.allow_all_schemes`）也强制弹确认窗。
- 根因：`classifyMcpCall`（security.ts:381）按 tool name 正则匹配能力（read/write/exec/egress/db-mutate）。匹配不上就返回 `["unknown"]`。而 `CRITICAL_MCP_CAPABILITIES`（security.ts:297）显式包含 `"unknown"` —— "推断不出来就当危险的，强制确认"（§6.3 defense-in-depth）。**god mode 只 bypass UI prompt，不 bypass critical capability 边界**（§6.1.5/§6.2 mirror）。
- `directory_tree` / `walk_files` / `traverse` / `enumerate_records` 这种 read-flavored token 原 regex 不认（既不含 `read/list/find/get/info/...`，也不含 `directory/tree`）→ 落到 unknown → critical。
- 两条修法（互补）：
  1. **代码侧**（C4）：扩 `MCP_NAME_READ` regex 加 `directory|tree|walk|traverse|enumerate` → 推断成 `read-only`（D8 non-critical）
  2. **config 侧**（用户声明）：filesystem server 配置加 `security_capabilities: ["file-read", "read-only"]`（**必须是数组**，给字符串会被 `sanitizeMcpConfig` 静默丢弃，日志见 `mcp.config.security_capabilities_not_array got:"string"`）。merge 逻辑（Option C）：inferred 非空 → 并集；inferred=[unknown] + declared 非空 → 用 declared 解决 unknown
- 诊断入口：日志里 grep `security.mcp_critical_confirmed` 看 `capabilities` 字段是否含 `unknown`，是 → 推断器没认出 + 用户没声明
- 文件：security.ts:297/350/381/439, mcp/manager.ts:466（sanitizeMcpConfig）

### MCP filesystem directory_tree 在 $HOME 必撞 TCC EPERM（2026-07-14）
- 现象：让 agent `directory_tree /Users/huchen`，秒回 `EPERM: operation not permitted, scandir '/Users/huchen/.Trash'` → 整个对话被 `"不可恢复错误"` 杀死。
- 根因链：
  1. macOS TCC 保护 `~/.Trash` / `~/Library/Mail` 等即使进程有 FS 访问权
  2. 上游 `@modelcontextprotocol/server-filesystem` 一遇 EPERM **整次 walk bail**（不 skip-and-continue），返回 JSON-RPC error
  3. companion 收到 error 字符串 `"MCP filesystem/directory_tree returned error: EPERM: operation not permitted, scandir..."` 送进 `classifyError`
  4. `classifyError` 的 non_recoverable 列表只匹配 `"permission denied"` / `"permission not granted"`，**不匹配 `"eperm"` / `"operation not permitted"`** → 落到默认 non_recoverable → 杀对话
- 修复（C5）：`security.ts` recoverable 列表加 `"eperm"` + `"operation not permitted"` → LLM 收到 recoverable 反馈，可改扫 `~/.cmspark-agent/knowledge/global/` 这种窄路径重试。recoverable-loop guard（adapter.ts）会兜底防死循环。
- 注意区分：`"permission denied"`（EACCES）保留 non_recoverable，因为本仓库里它通常是 trust-policy denial（"不在 trusted_domains"），不是 fs TCC。
- 教训：错误分类器要枚举足够多的错误字符串模式；默认 fallthrough 到 non_recoverable 是激进的 —— 对 fs/MCP 上游错误尤其要补 recoverable 模式，否则一次 OSErr 就让 agent 整段对话死掉。
- 文件：security.ts:574-608（classifyError）, security-thread.test.ts

### Claude Code sandbox 无法触发 osascript GUI 对话框（2026-07-14）
- 现象：从 Claude Code bash 启动的 companion，`osascript -e 'POSIX path of (choose folder)'` 8 秒内返回 `用户已取消 (-128)`，**对话框压根没出现**。
- 根因：Claude Code 的 bash sandbox 没有 WindowServer / GUI session 访问权 → macOS Apple Events 直接当"无权显示 UI"返回 cancel。
- 验证：直接在 Claude bash 跑 `timeout 8 osascript -e 'POSIX path of (choose folder with prompt "test")'`，秒回 -128 + 无对话框 = sandbox 限制；从 Terminal.app 跑正常弹窗。
- 影响：任何用 `pickFolderNative()`（obsidian/folder-picker.ts）或 osascript 的 companion 功能（Obsidian 导出、knowledge.import_directory）都不能从 Claude sandbox 验证。
- 解法：
  1. 用户从 Terminal.app 跑 `cd ~/Projects/cmspark/companion && node dist/index.js start`（Terminal 有 GUI session）
  2. 或用 production tray 启动的 daemon（pid 1 父进程但同 UID，由 tray app 在 GUI session 启动）
- 生产环境影响：tray app 是 GUI app（在 user session 里），它启的 daemon 继承 GUI 访问权，osascript 能弹。Claude sandbox 启的 companion 才有问题。
- 文件：companion/src/obsidian/folder-picker.ts:40-53（pickMacOS）

### `git add -p` 通过 heredoc 实现非交互 partial-stage（reusable pattern）
- 场景：一个文件里有多个主题的改动（如 `message-router.ts` 同时含 knowledge.import_directory / thread.fork / config masking 三件事），想拆 commit。
- 流程：
  1. 列 hunk：`git diff <file> | grep "^@@"`
  2. 计划每 hunk 归属哪个 commit
  3. `git add -p <file> << 'EOF'\ny\nn\ny\ny\nn\nEOF`（每行一个 hunk 的 y/n）
  4. hunk 包含多个主题：答 `s`（split）→ 自动拆成子 hunks → 逐个 y/n
  5. mixed hunk 拆不开的：答 `e` 手动编辑 patch
- 注意：zsh 把 `rm` alias 成 `rm -i`，批量删文件用 `\rm` 或 `command rm` 绕过
- 案例（2026-07-14）：13 文件 +576 -93 改动，按 8 个主题拆 commit；message-router.ts 6 hunks 分到 C1/C2/C3；agentStore.tsx 一个 hunk 同时含 C1（SET_KNOWLEDGE_IMPORT_STATUS reducer）+ C3（SET_SETTINGS_OPEN reducer），用 `s` 拆成两个子 hunk 分别归 commit

### macOS coordinate computer-use: CGWindowListCreateImage deprecated in macOS 15
- Both `CGWindowListCreateImage` and `CGDisplayCreateImage` are marked unavailable (error, not warning) in macOS 15 SDK
- ScreenCaptureKit is the replacement but requires macOS 12.3+ and async APIs
- Workaround: use `/usr/sbin/screencapture -x -R x,y,w,h` subprocess call for window capture
- Files: `companion/src/host-use/darwin/host.swift` (cuScreenshot function)

### Swift multi-file compilation: only one file can have top-level code
- Compiling multiple .swift files (not in a target) requires exactly one "main" file with top-level statements
- Solution: single-file compilation with all functions in one file
- Files: `companion/src/host-use/darwin/host.swift`

### Extension App Tab macOS support requires 3-layer changes
- Adding macOS app support needs: (1) companion add-flow.ts bundleId branch, (2) companion enumerate.ts PlistBuddy scanner, (3) extension AppsPanel.tsx platform guard + bundleId field
- Missing any layer = "应用启动仅 Windows 可用" dead button
- Files: add-flow.ts, enumerate.ts, handlers.ts, apps-utils.ts, types.ts, AppsPanel.tsx

### System prompt app index was platform-gated to win32 only
- `buildAppIndexSection(platform)` returned empty string for non-win32 → LLM never saw mac.app.* tokens
- Fix: also accept "darwin" platform; also update tool-definitions descriptions from "(Windows ONLY)" to "(Windows / macOS)"
- Files: adapter.ts, tool-definitions.ts

### Biometric gate on macOS should prefer Touch ID over nonce challenge
- Default non-win32 fallback was 6-char manual nonce code → 45s timeout kills user experience
- Fix: `requireAppsBiometric` priority chain: win32→Windows Hello / darwin→Touch ID / fallback→nonce
- Touch ID uses `cmspark-host biometric-verify` subcommand with 60s timeout
- Files: biometric-gate.ts, host-use/darwin/index.ts

### VibeSOP SpanWriter metadata serialisation trap
- `SpanWriter.write_span()` serialises `metadata` dict → JSON string (for `redact_sensitive()`)
- `SpanAggregator._read_spans_in_window()` knows this and deserialises back
- `Dashboard._read_jsonl()` did NOT → crash on `/api/spans?skill_id=...`
- Fix: add `_normalize_span_metadata()` to dashboard's _read_jsonl
- Pattern: any consumer of spans.jsonl must handle metadata-as-string

### Instinct feedback signals: neutral vs explicit
- Hot path (routing) must NOT call `record_feedback_outcome(success=True)` — inflates confidence
- Route match ≠ user confirmed success
- Use `times_matched` (neutral counter) in hot path; `success_count/failure_count` only from CLI feedback

### Dashboard XSS: data attributes > inline onclick
- Span/trace IDs embedded in `onclick="showDetail('...')"` are XSS vectors
- Fix: `data-trace-id` + `data-trace-source` on `<tr>` + delegated click on `<tbody>`

### Grill-me + multi-agent adversarial verification workflow
- 3 explore sub-agents parallel → grill-me (5 rounds, Kimi Code answers) → Claude Code final review
- Found 2 blocking issues (schema duplication, feedback semantic error) before implementation
- After implementation, adversarial code review found 8 issues (1 CRITICAL, 1 HIGH)

## Qwen3-VL 实验层（2026-08-01）

- **SoT**: `docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md`
- **开工**: `docs/superpowers/plans/2026-08-01-qwen3-vl-experimental-layer-impl.md` + HANDOFF
- **坑**: Companion 权威非扩展推理；大陆用 auto/魔搭；P0=A1–A8 未绿勿宣称可内测；坐标必须像素；canEnable 硬禁用；trust_remote_code 须门文案
- **决策锁**: D1 硬禁用 / D3 像素 / D8 废 budgetMB / D9 许可 UI 复位 / D11 modelEnabled 禁 G1 skip
