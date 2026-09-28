# Session Log

## Current Session

### S117 (2026-09-27→28) [0.6.9 拉取 · 多路对抗评审 · 三条 BLOCKING 修复 · cut 0.6.10]

- **任务**：拉 0.6.9（`59931595..b5a7396a`，12 提交）→ 编译 Windows 安装包换装 → 四路独立对抗评审 → 修 BLOCKING → 发布卫生。本机换装 `cmspark-agent v0.6.9`（Setup `c61a949e…`），daemon `:23401` 在听，备份 `CMspark-backup-20260927-225703.zip`。
- **环境坑（Windows）**：`make` 缺失直接跑 `package.sh`；bash→cmd 的 PATH 被截断致 `node` not found；WSL bash 抢 Git Bash 致 `set -o pipefail` 报错（`/usr/bin` 须在 system32 前）；node `-p require(POSIX路径)` 需 `cygpath -m`。
- **四路评审裁决 REJECT**（claude/pi/grok/kimi，`docs/audit/reviews/069-pull-20260927/SYNTHESIS.md`）：三条 BLOCKING 全实机复现——
  - **B1 #545**：`releaseIdleWorkerLeases` 在 fleet 快照**读路径**（FleetStrip 每 4s）无条件释放 worker 租约，绕过同批次刚建的三重保护；`create_tab` 60s 独占作废。5 场景 + 2 对照组复现。
  - **B2 #544（P0）**：same-tool-guard 的 pivot 指令被 `wrapUntrusted` 包进 `<untrusted>` 块，而 rule 11 / SECURITY FOOTER 明令禁止遵循块内 "call tool X" → 功能依赖模型违反安全规则才生效 + 侵蚀提示注入防线。真实模块重放确认 pivot 落在 untrusted 块内。
  - **B3 #546**：`run-tests.mjs` 拼 418 路径超 Windows argv 32767 → `ENAMETOOLONG`、`r.status ?? 1` 吞 `r.error` → exit 1 零输出（测试根本没跑）。
- **连带发现 #548**：写 B2 adapter 级测试时发现 pivot 在其声称的核心场景（连点同一句）不可达——site-op 熔断 `SITE_LOCATOR_FAIL_BAN=2` 按 locator 键在第 3 次点击前拦截，guard 按 toolName 键要到 3，且 `SITE_OP_BANNED` 不计数。实机探针确认。另 **#550**（SOFT_RESERVED 窄时序）。
- **PR #549**（B1/B2/B3 修复，`d1ee60a6`）：四路 APPROVE_WITH_NITS。B2 改走可信 system 轮次（先例 #430 CONTENT_RISK_QUARANTINE_PLACEHOLDER）；B1 三重保护 + fleet fail-closed；B3 分批 spawn + 打印 r.error。新增 `adapter-pivot-trusted-turn.test.ts`（4 用例含 anti-vacuity 守卫）+ tab-lease 6 用例。companion 5306 / ext 1458，新增失败文件为空。
- **PR #551**（cut 0.6.10，`c8d3741f`）：pi **三轮**才 APPROVE——① over-claim「页面伪造不出可信标记」（实为通道 role:system 不可伪造，非标记文字）② 熔断时序「第 2 次拦截」应为「第 3 次点击前」③ **改 PR 正文时手滑写 `Closes #552` 会误关承接票**（GitHub `closingIssuesReferences` 亲验）。17 文件版本锚 lock-step（照 `b78e0962`）。
- **PR #553**（#547 防复发机制，`aa3c786b`）：新增 `scripts/release-guard.sh`（tag==HEAD / 工作树干净 / [Unreleased] 空）。pi 两轮 REJECT→APPROVE：① git fail-open（`|| true` 吞 git status 失败 + 校验周边仓库）② dispatch dry-run 被误杀（用 `ref_type` 区分 tag/branch）③ `CMSPARK_RELEASE_TAG` 无条件信任可复现 #547（加 `^{commit}==HEAD` 校验）。gate 125→156，三次突变验证确认在守行为。
- **操作者本轮三处 over-claiming 均被评审或自查抓到并更正**：#549 防伪造论证、#551 熔断时序 + `Closes #552`、#553 package.sh 的 GATE_ONLY 归属（kimi 抓，该变量只在 test-package-gates.sh 用）。另：误关 #547 后已 `gh issue reopen`（根因是 commit message 的 `Closes` 也会关票，而 `closingIssuesReferences` 只查 PR 正文——操作者和 pi 都漏了这个来源）。
- **发布**：✅ **已发布 v0.6.10**（https://github.com/nehcuh/cmspark/releases/tag/v0.6.10）—— 用户确认后打 annotated tag（照 v0.6.9 惯例），release.yml 五 job 全绿（preflight 含 release-guard 首次 dogfood `completed success`），三端 zip + Setup.exe `59d49e08…` + SHA256SUMS。tag == main HEAD `fc5935e2`，#547 脱节闭环。
- **Next**：用户确认后打 `v0.6.10` tag 触发发布；发布后据实补 `PROJECT_CONTEXT.md` / overview.md 打包行的发布事实（Release URL、CDHash、SHA256），再关 #547（tag 与 HEAD 对齐后脱节闭环）。#548 / #550 / #552 follow-up（ps1/create-dmg/installer 三入口未接守卫、cli-version 硬编码正则）另票。
- Recorded: yes — release-guard fail-closed 三原则（查不出=失败、tag 不匹配豁免不覆盖、dispatch 用 ref_type 区分）；`Closes` 在 commit message 也关票；测试必须带 anti-vacuity 守卫防空转假绿；突变验证是「测试真在守」的唯一证据。


### S116 (2026-09-23) [#524 租手确认 · 0.6.9 换装发布]
- 侧栏 caller/权限、Windows 绝对路径、`[Outbound]` 确认把确认台拉到前面。Kimi+Claude AWN，NIT 补丁后再 Kimi AWN，Grok 复审 APPROVE。快进合 main `1f27b988`，CI 四作业绿。[PR #525](https://github.com/nehcuh/cmspark/pull/525)。
- 版本收到 **0.6.9**（`b78e0962`）。本机 `make package-macos` 换装 `/Applications/CMspark.app`：CDHash `37d554d0…` 与 staging 一致，`cmspark-agent v0.6.9`，`:23401` 在听。无 bak。`host-integrity.ts` 被 build-host 改脏，未提交。
- 发布：[v0.6.9](https://github.com/nehcuh/cmspark/releases/tag/v0.6.9) 含三端 zip、Windows Setup.exe、SHA256SUMS。第一标签因 Linux 断言 `napi-[0-9]+` 对不上 `napi-v6` 失败；正则修好后标签移到 `488252bf`。
- **Next**：Chrome 里重载未打包扩展 `chrome-extension/build/chrome-mv3-prod/`。不要提交 `host-integrity.ts`。#230 仍冻。
- Recorded: yes — kimi 参数顺序、租手确认前缀、napi-v6 发布断言

### S111 (2026-09-20) [#515 子任务身份 标准流程]

- **Issue** https://github.com/nehcuh/cmspark/issues/515 · spec `docs/superpowers/specs/2026-09-20-worker-subtask-identity.md` LOCKED
- **方案 A**：对话枚举默认藏 worker（父在同视图、非 active、`user_message_count<=1`）；chip `N 子任务` → select 父 + Fleet portal；面包屑 `← 主任务`
- **实现 r1 dual** kimi+claude **REJECT**：B1 `require("node:fs")` 打红 tsc；B2 @ 先抠 excludeId 导致主任务里 worker 摊平；B3 @ 缺归属标题
- **r2** `[executed]`：excludeId 改成结果过滤；belong title；trash chip disabled；静态 `node:fs` import。`chrome-extension` **1450/0**。timeline **42/42**
- **r2 dual** kimi **AWN** + claude **AWN**（claude 沙箱写不了文件，正文落 `issue-515-r2-dual-claude.md`）。折 nit：面包屑不跳软删父；宽屏搜索匹配 belong/role；归属标题带 own；selectMode chip disabled；计数一次过；搜索不叠「子任务」badge
- **#516** 整理确认被 overflow 裁切；回收站藏 worker + 无一键清空。确认条顶置；trash 不走 enum hide；「清空回收站」走既有 hard batch。Issue https://github.com/nehcuh/cmspark/issues/516

### S110 (2026-09-19) [fix/502-adversarial-punchlist 六路对抗评审]

- **任务**：对 `fix/502-adversarial-punchlist` vs `origin/main` (`93923c1d..022b2f60`) 做六路独立对抗评审 → 去重验真 → kimi+claude 双路复审。不修代码。
- **范围**：97 files / +12102 / -183。含 #502 操作面、#504–#511 punch list、#513 舰队建议卡、#514 Glance 推送/spawn kick。未提交的 `memory/project-knowledge.md` 不进审。
- **PR**：#512（punch list）；#503 是操作面原 PR（另一 head）。#513/#514 尚无独立 PR。
- **产物目录**：`docs/audit/reviews/502-punchlist-20260919/`
- **对抗** `[executed]`：6 路 A PRODUCT REJECT · B CORR AWN · C SEC AWN · D ARCH REJECT · E UX REJECT · F SKEPTIC REJECT。去重后 4 BLOCK（X1 live 芯 / X2 归档方言 / X4 kick abort / X9 spawn 夹具）+ MAJOR X3/X5/X6/X7/X8/X10。产物 `docs/audit/reviews/502-punchlist-20260919/`。
- **双路** `[executed]`：kimi REJECT + claude REJECT。X1–X9 两路 TRIGGERED。Claude 降 X10 为 NIT（预存在）并加 N-1 排队 kick 无取消（并入 X4）。
- **修复** `[executed]`：X1–X10 + N-1 全落地。companion 定向 93+92 绿；extension 相关 58+89 绿。用户睡觉期间完成，未开新 PR。
- **换装** `[executed]` 2026-09-20：`CMSPARK_REQUIRE_NSIS=1` Git Bash `package.sh windows-x64` → zip **81M** + Setup **52M** `CMspark-Setup-v0.6.7.exe`。daemon stop + 杀 tray → `/S` exit 0。ARP **0.6.7**。`wscript launch-hidden.vbs` → 2s `127.0.0.1:23401` LISTENING（daemon pid 856 + tray 20272）。`cmspark-agent v0.6.7`；扩展 manifest 0.6.7。安装目录 `cmspark-agent.js` 与 staging 同时戳。版本号仍 0.6.7（含 punchlist 代码）。

### S109 END (2026-09-15) [cmspark] VibeSOP 8.5.0 配置刷新

- CMspark `.vibe/dist/` 已重建 Claude/Grok/Kimi/OpenCode/Pi 五个平台产物；项目级 `.claude/` 与 `.grok/` 已刷新。
- 全局 Claude/Grok/Kimi/Pi/OpenCode 配置已同步到 8.5.0；额外 skill、`.grok/workflows`、Claude 本地设置和模型配置保留。
- 五个平台独立验证通过；Cursor 未配置且未触碰。当前仓库原有未提交内容保留，本次新增的 `.grok/rules/` 与 `vibesop-*` hooks 未自动提交。
- Next：重启相关 Agent；若要共享生成的 `.grok` 配置，再单独审阅并提交。
- Recorded: no — 本次是项目配置同步；可复用的 renderer/orphan skill 注意事项已记录在 VibeSOP project-knowledge。

### S107 (2026-09-08) [pull main · NSIS 换装 · 多路对抗体检]
- **任务**：拉最新 → `package.sh windows-x64` + `/S` 替换本机 → 多路独立对抗彻底体检。
- **pull** `[executed]`：stash session.md → `main` ff `7ab36063` → **`4a63de56`**（#485 workspace 归属；落后 270 commits）。stash pop 冲突，保留 origin session.md 后写本条。
- **包装** `[executed]`：`CMSPARK_REQUIRE_NSIS=1` Git Bash `package.sh windows-x64`（先 npm ci companion+extension）。zip **81M** `cmspark-v0.6.6-windows-x64.zip` + **52M** `CMspark-Setup-v0.6.6.exe`。staging **无** SEA；whisper win-x64 + ort napi win32/x64 + @lydell/node-pty 已入。
- **换装** `[executed]`：daemon 本未跑；`/S` exit 0。ARP **0.6.6**。`wscript launch-hidden.vbs` → **3s** `127.0.0.1:23401` LISTENING（pid 17588 daemon + 17560 tray）。`cmspark-agent v0.6.6`；扩展 manifest 0.6.6。INSTDIR 残留 `gif.jpg`/`gifcode_test`（安装器 overlay 不wipe）。未改用户意图配置。
- **对抗** `[executed]`：6 路独立。A PRODUCT **REJECT** · B CORR **AWN** · C SEC **AWN** · D SKEPTIC **REJECT** · E ARCH **AWN 6.6/C+** · F UX **REJECT**。A+D 独立命中：文档 0.6.0 vs 锁 0.6.6；README 全选灌库 vs TF-IDF top-k（**S106 同洞**）；Capture 360×420 vs `OVERLAY_WINDOW_SIZE` 1040×760。UX：Host「收起」unmount `meeting.end`；「设置→听写」死路径。合成 `docs/audit/reviews/s107-health-20260908/synthesis.md`。
- **不阻塞狗食**（已换装 0.6.6）。**阻塞诚实发版**：前门文档 + 知识注入 + Capture 尺寸 + 会议收起文案。
- **双路复审** `[executed]`：claude **AWN** + kimi **AWN**（`both_ok=true`）。五条 BLOCK 两路独立 TRIGGERED。NIT：听写死路径更宽（506/768/936）；unmount `meeting.end` 勿删、改 Host 文案。`docs/audit/reviews/s107-health-20260908/dual-*.md`。
- **0.6.7 诚实关门** `[executed]`：lockstep 0.6.7。L1 文档 grok · L2 UX grok · L4 脱敏 grok · L3 CLI 本会话（claude -p 空转）。互审 kimi **AWN** + grok **AWN**；Pi XML 失败；Claude 空转杀掉。折 NIT：MeetingPanel「设置→语音」；AGENTS/CONTRIBUTING 余项。package-gates 125/0；cli+redact 11/11；diarize-copy 5/5；companion tsc clean。未再编 NSIS（本机仍 0.6.6 包）。#230 仍冻。

### S106 tail (2026-09-06) [0.6.1 打包换装]
- make package-macos → CMspark-v0.6.1-macOS.dmg（80M）→ /Applications 换装；验证：Info.plist 0.6.1、daemon 23401 LISTEN、tray running、扩展 WS 认证。
- Recorded: yes — merge-and-cleanup-separate-steps / eval-gate-fail-check-harness-first 入 instincts

### S106 END (2026-09-06) [剩余 issue 全清 → 0.6.1 + 评测门实证]
- **Merged**：#421（#419 stdio 懒重拉/UI 选档/形状预检）· #422（#417 escalateGuidance 收敛 + linux cuArmed）· #424（#418 distill polish + 真实 LLM 884s 三轮调优 5 草稿 99 ids 零伪造）。全部双路对抗 + CI 绿。
- **非代码**：#351 终裁关闭（pi 红队修正论据：embedding 本机不出网，真理由是 #260 experimental + 无诉求）；#328 shadow 开启；#363 评测门首跑 **FAIL 0/10** → 归因 worker 坐标系（raw {"x":[800,260]} 超界，L-QW-3 clamp-only）→ #423。
- **残余**：#423 可执行；#363 blocked 维持；deferred/冻结不动；#71/#70 路标注释。
- **教训**：合并与清理分开两步（#422 TLS 超时又撞一次，refs/pull/N/head 救回）；评测 FAIL 先查 harness 坐标约定；grok 复审抓到作者测试计数误报（40→20 实数）——lane 数字一律复算。
- Recorded: yes

### S105++ (2026-09-06) [五票全清 → 0.6.1]
- **背景**：用户授权「按推荐顺序完成所有遗留任务」。lane 分工：claude→#409/#411，grok→#408+评审，pi→#406/#410+评审，kimi 居中协调+评审+#420。
- **Merged**：#412(#406 残余冻结+tray 端口读配置) · #413(#408 双轨同名) · #414(#409 升级链四断点) · #415(#410 interact profile+豁免旗不溅射) · #416(#411 全历史专家) · #420(0.6.1 lockstep)。全部 CI 绿 + 作者≠评审者复审闭环。
- **Follow-up**：#417/#418/#419 三张小票收编所有评审残余 NIT/P2。
- **Open 仅剩**：#417-419 + 冻结/阻塞/deferred 老票（#230/#363/#328/#351/#364/#372/#373/#71/#70）。
- **新教训**：git add -A 在含 node_modules symlink 的 worktree 会误提 symlink（#420 amend 修掉）；installer.nsi PRODUCT_VERSION 是第六个版本锚（CI package-gates 抓住）；CI build 的 fail 要看 runner 平台差异（#414 linux 分支漏网）。
- Recorded: yes

### S105 END (2026-09-06) [0.6.0 换装 ×2 · #404 测试污染事故 · tray port 误诊 · #407 抢救]
- **Ship**：0.6.0 DMG 打包换装两次（第二次含 #405）。**#404 事故**：settings-web-tokens.test.ts 静态 import 冻结 DATA_DIR，夹具（sk-test/https://x/m/port 23491）覆写真实 config.json → 0.6.0 启动 model_probe 失败 + MCP npx ENOENT（npm-prefix/lib 缺失）。**PR #405 合并** `f5320db0`：9 处 config.json 路径 + initDataDir 3 处 + getLogDir 全走 live getConfigDir()；claude 两轮评审 MAJOR→CLOSED。用户配置从 corrupt 备份恢复。
- **次生**：port 也被夹具改（23401→23491），tray 硬编码 WS_PORT=23401 探测恒失败误报「已停止」——恢复 port 后正常。教训两条入 instincts.yaml + .vibe/instincts.jsonl。
- **抢救**：主仓工作区发现 lane 无名改动（outbound-mcp stdio 短名修 Grok tool_count 0）→ 分支化 **PR #407 已合并** `f1cd33c5`（claude MAJOR→CLOSED：补 exfil 回归 6/6 + hermeticity import；grok 第二路 PASS 带 4 NIT）。
- **Open**：#406（getPidFilePath + tray WS_PORT 读配置）；#408（HTTP/stdio 双轨名称统一）；#230 冻；#363 blocked（真模型跑分）；#328 shadow 观测期。
- **本机**：/Applications CMspark 0.6.0（含 #405），daemon :23401，tray 状态 running 已验证。
- Recorded: yes — test-must-never-write-real-home / config-restore-diff-all-fields 两条本能

### S104 END (2026-09-03) [接手 kimi 知识库主线 · 开闸 #280 · PDF #282 · 查重 #283 · 0.5.8 换装]
- **触发**：另一 tmux 窗 kimi 被打断；用户要 grok 接手继续。
- **Ship on main**：#280 簇路由开闸（常数 true、开关默认关）`6ddd05a4`；#282 PDF 导入 readAsDataURL `f4475b62`；#283/#281 正文 sha256 查重 `7ab36063`。tip **`7ab36063`** == origin。无开放 PR。
- **本机**：`make package-macos` 换装 `/Applications/CMspark.app` **0.5.8**（开闸枝，**不含** #282/#283）；daemon `127.0.0.1:23401`；CDHash `63c4ed7c…583a` A6。无 bak。查重/PDF 修要再编包 + 重载扩展。
- **对抗**：Gate10 开闸 claude+kimi AWN；Gate-d281 查重 claude AWN / kimi REJECT（扫描件占位）已折。
- **下次**：重载 unpacked 扩展狗食 PDF 导入+按堆选文；再编 DMG 才有查重。#230 仍冻。#258–#260 排期。
- Recorded: yes — 分块 btoa 毁 PDF；grok output-format 不是 text；kimi -p 禁 yolo；tmux 折叠块要读 wire.jsonl

### S103 END (2026-09-01) [T3 当轮活计划 #265 · 0.5.7 lockstep · 本机换装]
- **触发**：侧栏干活顶栏看不到具体待办。#256 Wave 1 只挂 H1 残单；空对象是真缺口。
- **选定**：T3 当轮活计划（新 ingest）。不要 StatusRail C，不偷运 Wave 2。线稿 01+02（聊天列可勾活清单）。
- **Ship on main**：PR [#266](https://github.com/nehcuh/cmspark/pull/266) squash `2cd41f1d` Closes [#265](https://github.com/nehcuh/cmspark/issues/265)。spec r2b LOCKED。lockstep companion/extension/NSIS/CLI/CHANGELOG/AGENTS **0.5.7**。
- **产品**：聊天列 Wave 1 sticky「本轮步骤」；ingest = `run_progress_propose`；首个 PAGE_TOOL 无清单 → `PROPOSE_REQUIRED`。可见性靠 companion 准入，不靠 LLM 记忆。
- **本机**：`dist-package/CMspark-v0.5.7-macOS.dmg`（54M）；`/Applications/CMspark.app` 0.5.7；daemon `ws://127.0.0.1:23401`；CDHash `83f8a886…` A6。无 bak。
- **CI 修**：`m2-untrusted-marker` 的 `get_page_text`/`get_page_html` 撞闸 → `runChatCreate` sticky-clear `run_progress: null`。
- **对抗**：spec r1 4×REJECT → r2 3×REJECT → r2b 3 AWN；plan Product/Trust AWN。
- **下次**：Chrome unpacked 扩展重载 `chrome-extension/build/chrome-mv3-prod/`。#230 仍冻。#258–#260 排期。本地 session-end 未 push（S102+S103），除非用户要。
- Recorded: yes — classifyError 默认 non_recoverable 会杀闸；PAGE_TOOLS 必须活 catalog 名；handshakeSurface 来自 WS 不是模型袋；listSig 全表


### S102 END (2026-08-31) [本机 0.5.6 DMG 换装 · 清备份]
- **做了**：`make package-macos` → `dist-package/CMspark-v0.5.6-macOS.dmg`（57M）+ zip；停 daemon → `ditto` 换 `/Applications/CMspark.app`；用户不要备份，删 `~/CMspark.app.bak-20260828-144503` / `…145732` / `…20260831-170839`。
- **运行中**：`cmspark-agent v0.5.6`；`ws://127.0.0.1:23401`；codesign adhoc+runtime CDHash `b6f1fa57…` A6 单哈希。本机无 `.bak`。
- **下次**：Chrome unpacked 扩展若还是旧包，重载 `chrome-extension/build/chrome-mv3-prod/`。#230 仍冻。
- Recorded: yes — `xattr -cr` 撞 SIP provenance；按 PID 逐杀；不留 bak

### S101 END (2026-08-31) [4 路对抗评审 → #261–#264 全闭环 · 双路质量门]
- **评审**：pull 范围 `c39d7d3e..26949cbb` 派 4 路独立对抗子代理（ARCH/CORR/SEC/UX）→ 0 BLOCK / 7 MAJOR / ~17 NIT。CORR 与 SEC **独立命中同一 shell.ts 允许列表绕过类**（引号 `-""c` + 通配符 fallback 两向量，均实测可执行）。
- **grok 修 5 条**（#261 shell W1e fail-closed · #262 run_progress 三态 · #263 UX CTA/错误/回显 K），我实证回放验证（`scratch/w1e-replay.ts` 14 例全 PASS，已入库作回归证据）。
- **我修剩余 2 条**：#264 voice auto-correct 单向偏好漂移 → `localModelAutoCorrectedFrom` 暂存/恢复/清除（set_engine restore-first）；ADR-022 L4+ 补 grant 双轨修订注（发货门失同步）。
- **双路质量门**：claude + grok CLI headless 各 PASS_WITH_NITS、0 BLOCK；两路独立命中同一「撒谎测试名」。NIT 全收敛（含 grok 抓的「默认 medium 不暂存」文档 overclaim → 改文档不改代码）。
- **基线**：companion 全量 3937/0；CI build+smoke×3 绿；main tip `18d843d1` == origin。
- **经验**：grok headless = `grok -p/--single`（`--cwd` 指项目根）；评审包 instructions 必须写「刻意边界」防复审者重炒已裁决设计。
- **下次**：早期评审残余 NIT（RunProgress 微 a11y、summoner 拽底等）可开 follow-up；#230 仍冻。
- Recorded: yes — stale .test-dist 假失败（nvm use 无 .nvmrc 跳链）

### S100 (2026-08-31) [0.5.6 lockstep · push · NSIS]
- 包装 companion/extension/NSIS fallback/CLI/ACP/outbound **0.5.6**。CHANGELOG Unreleased → [0.5.6]。

### S99 (2026-08-31) [活文档锁 0.5.5 · Unreleased 记 S98]
- **不做**：不 bump `package.json` / NSIS / CLI 到 0.5.6。
- **做了**：Batch 0 诚实（README/PRODUCT/CLAUDE/AGENTS/GOAL/architecture/docs README/companion README.txt）0.5.3→0.5.5；T1 = 已记分+禁扩；#228/#229 从余项拿掉；post-227 标 SNAPSHOT；Capture 尺寸 360×420；CHANGELOG Unreleased 记召唤器流式 / 语音回退镜像 / 会议自动 K + #235 补记。
- **Batch 1**：README 开篇 = PRODUCT 家/四面；使用指南 Capture + 弹出 + 租手三门。
- **Batch 2**：`docs/summoner-user-guide.md` + TROUBLESHOOTING 召唤器节。未 bump 0.5.6。

### S98 END (2026-08-31) [召唤器流式 · 语音自动激活/回退/HF镜像 · 会议自动K · 双路复审修复]
- **Ship（本地 main，未 push）**：`e6929948` 召唤器 HTML shell 流式渲染 · `45b417aa` 会议说话人「自动」档 · `8f8bd2fa` 语音模型自动激活+非静默回退+HF 镜像 · `ce85bc4d` 复审归档。
- **召唤器根因**：后端一直在流式（adapter `chat.token` 累积快照）；Windows HTML shell 收到 token 只整表 refetch 而 assistant 轮末才落库——纯前端缺口。Swift overlay 本已流式未动。
- **语音**：下载完成自动写 `localModelId`；`get_state` 自动修正失效 active（medium→small→large）；`voice.autoFallbackToBrowser`（默认 true）当次会话回退+含云残留横幅；`voice.modelDownloadEndpoint`/`CMSPARK_HF_ENDPOINT` 镜像（仅重写 huggingface.co，https fail-closed）；新 WS `voice.model.set_prefs`（双栏）。ADR-023 L13 已补 2026-08-31 修订。
- **会议**：`meanSilhouette`/`selectBestK`（纯 TS）；`clampDiarizeK` 透传 0/"auto"；UI 默认「自动」。仍是 3 维特征近似，experimental 保留。
- **双路复审**：grok **REJECT** 3H2M2L（跨线程 token 泄漏 / 轮询拆气泡 / 水合窗口默认回云）+ claude **AWN** 2M1L（Enter 误清镜像源 / 空态丢 id）。9 条全修，合成 `docs/audit/reviews/summoner-voice-autok-20260831-fix-synthesis.md`。
- **建票**：#258 Hex 式语音 UX · #259 Windows SAPI 兜底 · #260 speaker embedding diarize。
- **基线**：companion 全量 81 失败为 main 预置（Windows symlink EPERM / 0o600 断言）；chrome-extension 858/858 全绿。
- **下次**：push 4 commits；Windows 真机验召唤器逐 token + 回收语音失败横幅错误码（network/binary_missing/model_missing 未定）；#258/#259/#260 排期。
- Recorded: yes — claude -p 长 prompt 走 stdin；送审先 stash 跑基线；companion 测试并发互踩 .test-dist；水合窗口≠缺失

### S97 (2026-08-30) [文档/版本/特色能力 · 多路独立对抗]
- **类**：只读审计。不改文档直到人审。
- **对象**：用户可见 + agent 入口文档的版本号、特色能力覆盖、过时声明。
- **路**：Version lockstep · 特色覆盖 · Skeptic 过时/夸大 · 用户入口 vs SoT · 0.5.3 后已交付未入活状态。
- **已知苗头**：`companion`/`AGENTS.md` **0.5.5**；`docs/README` / `README` / `PRODUCT.md` / `GOAL.md` / `architecture.md` / `CLAUDE.md` 仍锁 **0.5.3**。
- **五路 + dual AWN**（Claude CLI 挂，grok 顶第二路）。合成：`docs/audit/reviews/docs-version-capability-audit-2026-08-30.md`。P0 存活：版本分裂、#228/#229 已关仍当余项、T1「仍待」活指针。特色能力在 PRODUCT，不在 README 前门。未改文档，等人选 Batch 0/1。

### S96 (2026-08-30) [本轮步骤 IA · 顶栏下拉稻草人 · 五路对抗]
- **类**：Architectural / 设计-only。不写码。Issue-first：等人选对象再建票。
- **对象**：现有 L0 `RunProgress`「本轮步骤」（H1 `open_todos` 种子，钉在 `ChatView` 滚动列顶，stick-to-bottom 后滚走）。**不是** Mission Board / Cockpit 步骤轨 / overlay。
- **用户稻草人**：从 StatusRail 往下展开可收起任务清单。五路：**REJECT**（Zone A 盗窃；展开 ~207px + 最坏铬 → 流约 13%；`ComputerTaskBar` 已从 Panel 撤）。
- **真问题两层**：① 清单滚走 + 闷卡不好扫；② 对象常空、click-only、是 compact 残待办不是当轮活计划。搬铬修不了 ②。
- **密度漂**：StatusRail live **48**（审计 44）；Scene **36**（审计 28）；`popoutBar`「弹出对话框」审计未计。
- **推荐**：Wave 1 = 流内收起 + sticky-in-stream（T1，不改协议）。Wave 2 = FocusBand secondary 一行 glance（T2，Confirm/急停让位）。**禁止** StatusRail 手风琴；**禁止** 新 ingest / overlay 勾 / 「进行中」。
- **分叉**：用户若要「当轮活拆解」= 新对象 T3，另票，不在本 UI 里偷运。
- **选定**：用户选 **2 = 先 A 后 B**。顶栏 C 否。当轮活计划另票。
- **票**：[#256](https://github.com/nehcuh/cmspark/issues/256)
- **spec**：`docs/superpowers/specs/2026-08-30-runprogress-sticky-collapse-design.md`（DRAFT · 等人审）。Wave 1 T1 sticky+收起；Wave 2 T2 FocusBand 24px，密度重审开门。
- **四路**：Product PWC · Density REJECT · Trust Wave2 DENY · Skeptic SHRINK。折：≤3 默开、sticky 只收起头、禁当前步方言、Wave 2 默认 NO-GO。
- **Node1 dual**：kimi **AWN** + Claude **AWN**（`runprogress-256-r2-verdict-20260830-182414.json`）。nits 已折进 spec r2 LOCKED。
- **漂移**：`9d45b7c2` 已在 `origin/main`（r1 默收/`aria-current=step`/草稿进 m/展开 sticky 无上限）— **不是 SoT**。Wave 1 = 改写该铬。
- **Node2 plan**：`docs/superpowers/plans/2026-08-30-runprogress-wave1-r2.md`。四路折永远 sticky + ul 封顶。kimi 第一轮 REJECT（文内还写 unstick）已折。r2b **kimi AWN + Claude AWN**。
- **PR [#257](https://github.com/nehcuh/cmspark/pull/257)** `fix/256-runprogress-r2` tip `3f88eb04`（含 r2 spec/plan）。Worktree 保留。Wave 2 NO-GO。
- **Babysit CLOSED（不合）**：CI 全绿 run `33316442690`（build 3m8s + smoke 三台）。tip **`e1ec88bb`**。`MERGEABLE`/`CLEAN`，无人审、无线程。Wave 2 仍 NO-GO。#230 不合。
- **CI 根因**：companion TAP `fail 0` / `cancelled 15`。15 个全是 `ui-open-sidepanel.test.ts` timeout 起 `cancelledByParent`。主分支 `9d45b7c2` 同形（main 现也红）。`timer.unref()` 让 Node 22 `--test` 把只剩 unref handle 的文件当 idle。`e1ec88bb` 用与 `extension-peer.ts` 同形的 `NODE_TEST_CONTEXT` 守卫。

### S95 END (2026-08-30) [评审修复 0.5.4/0.5.5 · 脱敏桩渲染 · 截断双根因]
- **Ship on main**：两批评审修复 + 版本字面量 + lockstep 测试（123eaf2b…e0169825，0.5.4）；脱敏桩 UI 友好渲染 + 全位 0.5.5 lockstep（e9517488）。均两路对抗 + grok 复核 CLOSED/SHIPPABLE。本机 NSIS 已装 0.5.5（%LOCALAPPDATA%\CMspark）。
- **诊断**：qx8qfd「截断」= 脱敏桩渲染层全折叠（已修）；6r9a8c「截断」= live `llm.context_window: 4000` → budget≈2600 → 每轮 mid_loop `shrinkToolBodiesToFit` 静默砍最长工具结果加「…」，模型（DeepSeek-V4-Flash）见省略号陷入截断-重试循环。日志 `thread.context_compacted` dropped_count=0。**同名症状两个根因**。
- **建票**：[#255](https://github.com/nehcuh/cmspark/issues/255) 脱敏范围讨论（evaluate 全折叠致重载失忆）。tray 设置页定位已定：保持 LLM 快速配置现状，与扩展共享同一 config.json。
- **下次**：用户确认后 `settings --set llm.context_window=128000`（未动，AGENTS.md 禁未确认改 live config）；可建「预算器静默收缩检测提示」票；遗留 Low 清单在 `docs/superpowers/plans/2026-08-29-post-review-adversarial-fixes.md` 回执 + CHANGELOG Known residuals。
- Recorded: yes — 同名症状先分清机制再修；live config≠代码默认；grok -p 必须紧跟 prompt 值

### S94 END (2026-08-29) [体检 A–F 合 main · 对齐远程]
- **Ship on main**：#246 A+B · #248 C · #250 D · #252 E · #254 F。tip **`5c4fcab0`**。工作区 `main` == `origin/main`。
- **判断**：本地 overlay 两笔 SHA 未祖先于 main，但会议台/默认展开已在 #246 squash；勿把 overlay 枝压上后来的 main。
- **清**：worktree 241/247/249/251/253 已删；远程只剩 `origin/main`。
- **下次**：#228 禁扩 profile；#230 冻；残留 Medium：privacy_ack、HUD 导入、grant_id、conductor 按 thread。不宣称 Capture/CU/F-S-10 闭合。
- Recorded: yes — squash≠cherry；`&thread=` 进 path；kimi last VERDICT；panel≠忽略名单；get() 不 saveIndex

### S87 END (2026-08-28 ~18:18) [overlay Capture 卡狗食 · 会议台]
- **枝**：`feat/overlay-card-first-paint`（`b6ac5928` + 未合 dogfood）。#241/#242 已在 main `8b71f07d`。#239/#240 ChatShell 已合。
- **Ship（本机热替换 `/Applications/CMspark.app`）**：托盘/热键开同一张 360×420 HTML 卡（独立 overlay-chrome profile）；发送/markdown/新对话/历史；会议台：隐私 → 开始/结束录制 → ~8s 近实时 + 渐进假设；STT 跟侧栏 `voice.localModelId`；历史会议 list/get；匿名发言人N（`auto_diarize`）。打开侧栏只绑 `normal` 窗。
- **修**：`sendRequest` RPC `tray-N` ≠ `meeting.id`；内联 JS 可 `new Function`；默认 expanded 空态。
- **下次**：关旧浮窗再开新卡狗食。PR 未开。#230 仍冻。扩展「打开侧栏」修需重载 unpacked。T3 Pi 仍 skip。
- Recorded: yes — tray-N 撞会议 id；Chrome 已开丢 --window-size；模板弄坏 overlay JS；lastFocused=--app；pgrep -f 自杀；45s 窗不像实时

### S86 END (2026-08-27 ~20:03) [ChatShell 同一张脸 · #239 · PR #240]
- **Ship**：Gemini 对照 → Issue #239 → spec r2（三路 REJECT 已折）→ plan r2 → subagent-driven 实现 → **PR #240** `feat/slice-239-chat-shell`。未合 main。
- **产品**：侧栏空态当前页+3 芯片填作曲；弹出 → overlay HTML 无页整张脸；Mac 热键仍旧条。失败 toast「无法弹出对话框」。
- **下次**：PR #240 审/CI/合。#230 仍冻。勿扩 outbound profile。隔离 clone 在 `~/.grok/worktrees/projects-cmspark/subagent-01a04243-0d83-74d2-8780-ea2a855243f5`。
- Recorded: yes — loopback URL 双 query；placeWindow≠expanded；tray fan-out≠订阅；浮窗当前页会涨 ACL；processing 当 toast 拆空态

### S85 END (2026-08-27 ~14:02) [0.5.3 切点收口 · T1/召唤器/grant-cli/RunProgress tool]
- **Ship on main**：#231 0.5.3+Issue-first；#232 T1 CMspark 臂记分；#233 Playwright 对照 nit；#234 召唤器不抢前台；#236 grant-cli 未知 flag 失败；#238 H1 todo `{text,tool}` 精确勾。tip `ed22223`。残枝 `feat/slice-6-*` 已删。
- **T1**：OA 门户前 5 封（对话里核对，不入库）。PW 空 profile `ERR_EMPTY_RESPONSE`，**不是**登录墙。L7 PASS 带 nit。禁扩 profile。
- **本机**：`/Applications/CMspark.app` 0.5.3 DMG；#229 Swift 未打进该包。盘上 `require_grant=false` / `auto_approve_dangerous=true`（bake-off 后改回）。
- **下次**：#230 仍冻 F-S-10 / overlay-acl。形态主线用户可见项已完。要对着 Chrome 热键验 #229 须重启仓库 tray 或重打 DMG。
- Recorded: yes — Issue-first；PW≠SSO 墙；activate=淡不掉；H1 对象炸摘要；#230 须拆子票

### S84 (2026-08-27) [0.5.3 lockstep · Issue-first]
- **版本**：companion / extension / NSIS / CLI banners **0.5.2 → 0.5.3**。CHANGELOG 记录 #222–#227；诚实写明 T1 未跑。
- **Issue-first**：CONTRIBUTING / CLAUDE / AGENTS / PR 模板 / `.github/ISSUE_TEMPLATE/design.md`。新需求必须先开 GitHub Issue。
- **余项票**：[#228](https://github.com/nehcuh/cmspark/issues/228) T1 · [#229](https://github.com/nehcuh/cmspark/issues/229) 召唤器 P2 · [#230](https://github.com/nehcuh/cmspark/issues/230) 残留。
- **活状态**：`docs/superpowers/specs/2026-08-27-post-227-status.md`
- Recorded: yes — 设计不建票就会忘；0.5.3 ≠ 租手完成

### S83 (2026-08-26) [标准流程续 · T1 预检 BLOCK · 切片 6 计划]
- **T1 预检** `docs/audit/reviews/outbound-mcp-p0d-preflight-20260826.md`：daemon 在跑但是旧 0.5.2、无 `outbound-grant`；盘上 `require_grant=false` + `auto_approve_dangerous=true`。未签发钥匙、未打 live 工具。
- **切片 5**：机核已在 main（CompanionMark + 22px + 句子邀请 + 作曲区）。不重开。
- **切片 6 计划**：r1 四路 **3 REJECT + External AWN**；r2 针已折进计划。下一步 = **计划 dual（Claude+Pi）**，通过后再实现。**不要**未 dual 写码。
- Recorded: yes — T1 假分禁条；live 配置不是代码默认

### S82 END (2026-08-26) [#226 MERGED · 残枝清掉 · 现状快照]
- **Ship**：**PR #226 MERGED** `5d096a7`。知识 Wave 3 + 产品切片 1–3（租手钥匙 / L8 confirm / 召唤器诚实）。PR CI + main CI 全绿。
- **清**：本地枝/stash/未跟踪评审 patch 已删；远程已合残枝已删。`origin` 只剩 `main`。
- **诊断**：`docs/superpowers/specs/2026-08-26-post-226-status.md`。下一刀 = **切片 4 T1 真人 bake-off**，然后切片 5 侧栏看山。图谱 / overlay Allow/Deny / 第二扩展仍禁。
- Recorded: yes — 代码 DoD 绿 ≠ 五分钟租手真人验收；T1 没跑就扩 profile 违 SoT

### Task 8 hole (2026-08-26) [await extension peer before overlay-origin HITL]
- **Ship**: `fix(confirm): await extension peer before overlay-origin HITL`
- **Hole**: `waitForExtensionPeer` existed and auth.ok notified it, but no production confirm path awaited it.
- **TDD**: RED tsc (missing `ensureExtensionPeerForOverlayConfirm` / `confirmChannel` export). Then wrapper + dispatch/l2/url-cookie wire. GREEN 51 tests.
- **Wire**: overlay/inbound without extension → `attachChromeOnly` (never `sidePanel.open`) → `await waitForExtensionPeer`. Timeout → UNAVAILABLE / `approved: false`, never `approved: true`. Attach injected in tests.
- **Sites**: `mcp/dispatch.ts` confirmChannel (async), `l2-admission.ts`, `url-cookie-admission.ts` navigate + file-open.
- Recorded: yes — no skip-confirm / auto-approve / overlay Allow/Deny

### Task 12 (2026-08-26) [Hide MCP rail, freeze CONFIGURE chrome · PR-C]
- **Ship**: `fix(summoner): hide MCP rail without deleting protocol`
- **TDD**: failing hide assertions first (rail `isHidden`, HTML `data-sec="mcp" hidden`, add/import rows `isHidden = true`). Then chrome.
- **Chrome**: Swift MCP icon `btn.isHidden = spec.2 == 4`; rows `＋ 添加 MCP` / `＋ 导入知识` hidden; HTML `hidden` + `.rail-btn[hidden]{display:none}`. Default section remains 对话 (`railSection = 0` / `data-sec="threads"`).
- **Kept**: `summoner.mcp.toggle` / `summoner.mcp.add` / stdin handlers / sixth rail / `mcp.toggle_server` + `skill.activate` on SUMMONER_ALLOW. No ACL rollback. No overlay Allow/Deny. No HUD stdin grant.
- **Swift rebuild**: `build-tray.sh` ok. `SWIFT_TRAY_SHA256=31a7f3e072525afb3d9f1dcdc962b95e37bee9ea35593f597e64537ec4b8aa2b`
- Recorded: yes — hide-not-delete; compose source-regex still finds mcp.toggle/add

### Task 11 (2026-08-26) [Summoner copy + attach CTAs · PR-C]
- **Ship**: `fix(summoner): 展开对话 and 打开浏览器 honesty CTAs`
- **TDD**: flipped overlay/web/client/compose tests first (6 red: 展开对话, ctaBox `!detached`, 听写在侧栏, `/api/attach` 404, footnote). Then chrome.
- **Chrome**: both shells 展开对话/收起对话; detached unhides 打开浏览器 + 打开并前置浏览器; footnote 不能替你打开侧栏; HTML POST `/api/attach` → attachChromeOnly, never openSidePanel.
- **Swift rebuild**: `build-tray.sh` ok. `SWIFT_TRAY_SHA256=bd25914764d3ebea23e075d76b058b11458b4071508c0298eda27053f041f581`
- **Not this PR**: MCP rail still visible (Task 12). No overlay Allow/Deny.
- Recorded: yes — HTML mic 听写在侧栏; Mac HUD mic stays 按住听写

### S81 END (2026-08-25) [post-#222 P1+nits · Win HUD dogfood · PR #223]
- **Ship**：`fix/post220-head-p1-fold` → **PR #223**。P1：F-I-5 冲突后缀、PEM through END、F-S-1 untrusted wrap。nits + Windows C-thin 纸面 HUD。本机 NSIS 静默换装 `%LOCALAPPDATA%\CMspark`，23401 LISTENING。
- **闸门**：P1 四路 r2 AWN；nits+HUD 四路 AWN；Claude+Pi dual **both_ok**。用户狗食后：默认必须折叠居中小条；640×720 + media 藏列表 = 知识/MCP 点不开 → 已折 `720×120`/`placeWindow`。
- **下次**：CI 绿再合 #223；Chrome 重载 `Local\CMspark\chrome-extension`；再开召唤器应先见一条细条，⌄ 再展开。WebView2 仍非本线。
- Recorded: yes — C-thin 窗宽必须配 CSS；官方 Win 换装是 NSIS 不是 SEA

### S81 (2026-08-25) [pull main · 四路对抗 REJECT · P1 fold · r2 全 AWN]
- **Pull**: `fix/post219-kimi-nits-r2-fold` → `main` `6ce291db`（#220+#221+#222）
- **对抗**: `1d16b0ed..6ce291db` 四路独立 → **REJECT**（B P1×3）
- **折 / r2**: P1 三条 FOLDED；四路 AWN。后续 nits+HUD+PR 见 S81 END。

### S80 END (2026-08-25 ~13:40) [knowledge honesty Wave 0–2 · DMG 换装]
- **Ship（本机）**：`feat/knowledge-honesty-wave0` 落地 Wave 0/0b/1/2。`make package-macos` → `dist-package/CMspark-v0.5.2-macOS.dmg`；替换 `/Applications/CMspark.app`（备份 `~/CMspark.app.bak-20260825-133708`）；daemon `127.0.0.1:23401`。
- **闸门**：设计 dual AWN `102532`；Wave 0 impl AWN `105843`；0b+1 r3 both AWN `114735`；Wave 2 对抗四路 AWN（Product r1 REJECT 图谱名词后折）+ Claude/Pi AWN `132009`。
- **产品**：CJK identity；确认导入；本轮附带芯片；相关≤3；提炼脱敏+HITL；话题夹字符串；召唤器去工作台化；Raycast 仅分发文档。
- **下次**：开 PR（未合 main）；Chrome 重载解压扩展；overlay `pack.apply` peek / `user_gesture` 服务端 400 仍停住。
- Recorded: yes — overlay 新类型须 background relay；DATA_DIR 快照 vs getConfigDir；dual patch 须 stage 新文件；F-UX-NOUN 同面板扫旧「图谱」

### S79 END (2026-08-25 ~10:05) [#221 MERGED · post-#220 nits]
- **Ship**：**PR #221 squash MERGED** `ac0a3be`。CI build + 3 smoke 绿。本地 `main` == `origin/main`。
- **流程**：拉 `c5b4242..1d16b0e`（#220）→ 四路合后独立对抗 AWN → 折 nits → 再四路+Claude/Pi AWN → 折 dual 残留 → PR → CI → squash。
- **产品/工程**：nextRun 带 `clientMessageId`；heal skip 限定 in-flight 块；drain pause/trash/cap 先于 take；upload/regen 不替换 ack；overlay bind 显式 token；passwd/object 袋 + history 调用点 redact。
- **下次（可选）**：裸 `value` 勿全局 redact；M3 pack.apply 路由测、N1 idle flash、N9 length budget 仍 out of slice；真机召唤器 dogfood 仍开放。
- Recorded: yes — squash≠WIP r2；take→drop 测钉窗口；drain 先闸再 take；redact 调用点≠正则

### S79 START (2026-08-25) [post-#220 多路独立复验]
- **Pull**: `c5b4242` → `1d16b0e` (PR #220 squash: fold post-#219 kimi nits)
- **方法**: 四路独立 worktree 对抗（不信任合前 r2 APPROVE）；frozen patch `docs/audit/reviews/post220-merged-diff-20260825-085108.patch` SHA256 `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021`
- **范围**: `c5b4242..1d16b0e` 生产+测试 22 files (+2514/-109)
- **裁决**: A/B/C/D 全 **APPROVE_WITH_NITS**；r1 六条 BLOCK/High 均独立重放关闭（含变异杀死）
- **产物**: `docs/audit/reviews/post220-merged-adversary-synthesis-20260825.md` + 四路报告 + verdict JSON
- **未做**: Pi 复审（合前 r2 已 AWN；本轮无 BLOCK）；未 commit 评审文档
- **状态**: 合成完成；残留折完后 **PR #221 squash MERGED** `ac0a3be`

### S79 nits slice (2026-08-25) [post-#220 残留]
- **Branch**: `fix/post220-residual-nits`
- **Folded**: S-A1 nextRun 保留 clientMessageId；S-A2 persist skip 限定 assistant block；S-A3 leftover 不 wipe steer 队列；S-B1 pause 先于 takeNextRun；S-B2 regen overlay + conductor 测；S-B3 upload 恒返回 file.uploaded；S-C1 删除 setSummonerThreadId；S-C2 submit-ok live-gate + reclaim 走 claimOverlayIfLive；S-D1 passwd；S-D2 非 string 敏感 key；S-D3 history.db 正则对齐
- **未做**: 裸 `value` 全局 redact（误杀字段）；M3 pack.apply / N1 idle / N9 length；独立对抗 + Pi
- **机核**: companion tsc 0 + tsconfig.test 0；定向 235 pass
- **Ship**：PR #221 squash MERGED `ac0a3be`。CI build + 3 smoke 绿。本地 `main` == `origin/main`。
- Recorded: yes — leftover cmid；heal skip 限定块；drain pause/trash/cap 先于 take；upload/regen 不替换 ack；overlay token bind；passwd/object 袋 redact

### S79 dual (2026-08-25) [post-#220 nits 对抗 + Claude/Pi]
- **对象**: `1d16b0e..9deff00` frozen `post220-nits-diff-20260825-092457.patch`
- **SHA256**: `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51`
- **对抗**: A/B/C/D 全 **AWN**，无 BLOCK。合成 `post220-nits-adversary-synthesis-20260825.md`
- **双路**: `dual-external-review.sh post220-nits` Claude **AWN** + Pi **AWN**，`both_ok=true`（自跑 tsc 0 + 167/167）
- **闸门**: MACHINE PASS + 对抗 AWN + Claude/Pi AWN → **YES_ON_BRANCH**
- **PR**: https://github.com/nehcuh/cmspark/pull/221 squash MERGED `ac0a3be`
- **残留**: S-A3 测钉窗口、trash 无 in-tree 测、history cookie/generic 调用点、grep 型 C 测 — 非阻断

### S78 END (2026-08-24 ~17:23) [#219 MERGED · steer/nextRun + overlay hub + C-thin]
- **Ship**：**PR #219 squash MERGED** `daf8bc9`。CI build + 3 smoke 绿。本地 `main` == `origin/main`。
- **产品**：忙时纠偏/排队（occupied `chat.create`/`file.upload` → `run_active`）；overlay-eligible pack 不写 Trust；跨平台召唤壳 = loopback HTML + SSE + Chromium `--app`（非 Electron，冻 Swift 增长）。
- **闸门**：T2 独立对抗 → Pi；SSE r1 REJECT（OVERLAY_STANDBY 文案死）折完 r2+Pi AWN；打开闸门 hex token / 禁 cmd shell AWN。用户「CI 绿再合」后 squash。
- **下次（可选）**：真机打开托盘「召唤器（实验）」验 Win/Linux `--app` 窗；原生 WKWebView/WebView2/GTK 仍非目标；勿给 `isAllowedWsOrigin` 加 loopback。
- Recorded: yes — HTML 不直连 WS；accepted≠已发送；error_code SoT；C-thin 开窗闸门

### S77 END (2026-08-23) [OS summoner overlay polish · 独立分支 · #213 on main]
- **Ship（overlay）**：`feat/os-agent-shell` `c48aded` 跟踪 `origin/feat/os-agent-shell` = 当前 `origin/main` + **21** summoner commits（`rebase --onto origin/main e63bf87`）。live UX：长回复 markdown（流完再 parse）、新对话、麦 hold/click、hotkey 可关、idle 超时新开、Chrome 默认静默、`mcp.list` 状态行 + 确认改道 Panel。
- **Ship（plugin / main）**：`feat/site-op-memory` 已合 **#213** `fc18725`（浏览器负知识：locator 跨「继续」ban）。与 overlay **无关**。
- **分支锁**：`main` = 最新 Chrome 插件形态；`feat/os-agent-shell` = 插件 + 独立召唤窗，**未合 main、勿合**。workspace 现停在 overlay 分支。
- **未 commit**：journeys spec/tests + agentStore / composer-lease / Tray.swift 等脏文件 — **session-end 不得 scoop**。
- **未做**：8+5 用户证伪；GOAL.md/ADR-020 一句话仍冻；worktree daemon 已退，本机 23401 多半是官方 CMspark.app tray。
- Recorded: yes — STT last-error 掩盖、流式 flicker、stash 须先 reset、`pkill -f` 自杀、overlay≠第二 Side Panel、MCP 确认 N5 改道、rebase --onto 隔离大功能

### 折 nits HEAD be52585 对抗 (2026-08-21)
- S1 ASCII 门改 POSIX `[\200-\377]`（去掉 grep -P fail-open）
- S2–S6 `scripts/win-vendor-bins.sh`：`-f`、MSYS 才用 `C:/`、解压/压缩共用 7-Zip 探针；Bin 路径有 gate
- S7–S8 run-tests 引用 #64061 + Node <22 不加 isolation flag
- S9 L0 kimi/opencode 测试 + 笔记库路径文案；opencode `--prompt` 注释写明需 Enter
- S10 kimi 仍裸 TUI（`-p` 是 print）— 只加注释
- 机核：package-gates 110/0；ACP Mode C 64/64

### 四路独立对抗 HEAD be52585 (2026-08-21)
- **Pull**: `2576b53` → `be52585`（#207 Mode C 修复、#208 Windows 打包、#209 settings-web 隔离）
- **范围**: `e8900bc..HEAD`（#206/#207 已有在库对抗，不重复）+ Lane D 复验 Mode C P1
- **四路**: A packaging security · B packaging correctness · C test isolation · D ACP residual — 全 **APPROVE_WITH_NITS**，无 P0/P1
- **跨路**: ASCII 门 `grep -qP` Darwin fail-open（A+B）；Mode C P1 未回退（D 86/86）
- **产物**: `docs/audit/reviews/head-be52585-post207-independent-adversary-synthesis-20260821.md`
- **未做**: Pi 复审；未 commit 评审文档



### export copy: Markdown not Obsidian (2026-08-20)
- **Task**: 导出对话用户文案去掉 Obsidian 品牌，实际就是 Markdown 下载
- **落地**: 消息/线程/摘要按钮、设置开关与笔记库路径、文件夹选择器、companion 错误提示
- **未改**: WS `thread.export_obsidian`、关联图「类 Obsidian」、知识库导入文案

### coding-agent discover grok/kimi/opencode (2026-08-20)
- **Task**: 编程接力扫描补 grok / kimi / opencode（原先只 claude/gemini/codex/pi）
- **落地**: `companion/src/acp/discover.ts` 探针 + 厂商目录（`~/.grok/bin`、`~/.kimi-code/bin`、`~/.opencode/bin`）；CLI presets + kimi/opencode `acp` 协议 argv；kimi Mode C 不传位置参数
- **验证**: `[executed]` 本机 discover 已扫到 grok+kimi；ACP 单测 71 pass
- **下次**: 用户装 opencode 后再点「重新检测」；未 commit / 未 PR

### S76 END (2026-08-20 ~13:59) [#203 MERGED · fzbcro osascript 假拒窗 · DMG 换装]
- **Ship**：**PR #203 MERGED** `a468925` — LLM DNS/IMDS nits + osascript 批准后 regex 二次硬拦 + 确认文案；CI build+3 smoke 绿。`make package-macos` → `CMspark-v0.5.1-macOS.dmg`；替换 `/Applications`（备份 `~/CMspark.app.bak-20260820-132406`）；daemon 23401 已起
- **fzbcro**：日志已 `confirmation.approved`，dispatch 仍 `contains high-risk APIs (fetch)`；聊天套「若你已拒绝弹窗」。修：token 后 regex 只审计；copy 仅真 deny
- **闸门**：3 路独立对抗 AWN → Claude+Pi AWN → 折 nits（testVision DNS、probeNativeVision 门、C-N1 跨平台 token 测、delayMs 锁、deny 负例、osascript expression\|\|code）→ PR → 合
- **下次**：侧栏重载扩展；fzbcro 带 fetch 注入应能批准后真跑；P2-A3 lookup→fetch 钉 IP 未做；`host-integrity.ts` 打包脏 SHA **勿误 commit**
- Recorded: yes — L2 后再 regex 硬拦 + 拒窗文案套用；dispatch 单测勿绑 `_rt`/HOME

### S75 END (2026-08-20 ~07:49) [post-merge 对抗评审 · #202 MERGED · CI 绿]
- **Ship**：`fix/post-merge-198-201-adversarial-fixes` `a14f32b` → **PR #202 MERGED** `17ba84e`；CI build + 3 smoke 全绿；本地 main 已同步
- **流程**：拉取 `98bb586..2faaefa`（9 commits，PR #198–#201）→ 4 路独立对抗评审（1 critical / 2 high / 4 medium / 8 low）→ 报告落盘 → 4 路并行修复（文件范围互斥）→ 4 路独立复验（重放原始攻击 + HEAD 对照组）→ 残留修复（N1 双端 probe 归一化失锁等 4 项）→ grok+pi 双路复审 AWN → grok medium（NAT64/6to4/v4-compatible 内嵌 IMDS）当场折叠 → PR → CI → 合并
- **关键修复**：voice classic 重试锁死（retry-sid 置换 + `reset()` 递增 `loopGen` + peer 级 abort 释放 max-1 槽）；SSRF 守卫 IPv6 全形态（方括号/mapped/v4-compatible/NAT64/6to4/fe80::/10/fd00:ec2::254）+ settings-web DNS 恢复 fail-closed；file 笼 drive-relative 硬拒 + 最深存在前缀 realpath（junction TOCTOU）+ 目录/symlink fail-closed + 敏感名单扩 `.git-credentials/.npmrc/.netrc/.docker`；面板 probe 缓存 `{base_url, model_name}` 键化与 companion lock-step；vision 描述缓存键含模型+端点
- **验证**：chrome-extension 769/769（基线 755）；companion 目标套件全绿；voice 重试测试经 HEAD 交换实验证明能抓原 bug；Windows 全量 63 失败均存量（chmod/symlink/daemon/POSIX 路径）
- **下次**：跟进项——`voice-local-continuous.test.ts` 弱 fake / in-home symlink 拒绝文案 / dangling-junction TOCTOU / 上传中 abort 双发 onError/onEnd / L9 mergeHydratedMessages echo 去重
- Recorded: yes — `docs/audit/reviews/post-merge-198-201-adversary-synthesis-20260819.md`（评审+修复+复验全记录）、`-fix-dual-prompt-` / `-fix-grok-` / `-fix-pi-` / `-fix-diff-*.patch`

### S74 END (2026-08-18 ~18:02) [companion-canon Side Panel · #196 OPEN · CI 绿]
- **Ship**：`feat/companion-canon-sidepanel` `54f0610` → **PR #196**；CI build + 3 smoke 全绿、MERGEABLE。未合 main
- **产品**：精密仪器台 → 消费级助手 canon（看山质量杠 · Comp A）；C″ 一条栏 + D″ 诚实空态
- **真机后收**：图钉左上 / 设置只留 ⋯ / 历史 portal 铺满 / 去掉胶囊铅笔（装配只留芯片）
- **闸门**：内部三路 AWN；外部两轮 REJECT（生产 tsc / hover cascade）→ 修完 Claude+Pi AWN；PR dual 再 AWN/`both_ok`
- **本机**：`/Applications` 0.5.1（16:53 DMG，**不含**后三刀 UI）；验 UI 靠重载 `chrome-extension/build/chrome-mv3-prod/`
- **下次**：(1) 用户点头再合 #196 (2) 重载扩展验现网 (3) 可选重打 DMG；(P2) legal 对比 / 空闲发送箭头 / 巡航档位都缩成「巡航」
- Recorded: yes — test-tsconfig 掩生产 tsc；inline color 杀 hover；320 历史须 portal

### r3 eval gate (2026-08-18) [clipboard image paste]
- **对抗**: 三路独立 explore 均为 APPROVE_WITH_NITS；M1–M6 仍关；r2 leftovers 已验
- **Pi**: APPROVE_WITH_NITS（自跑 111+76）
- **Claude**: UNKNOWN（529×2）
- **MERGE 序**: 对抗→Pi 已 APPROVE*；未合 main / 未 PR

### r2 nits fold (2026-08-18) [clipboard image paste]
- **Ship**：`fix(attach): fold r2 nits (dims, untrusted wrap, WS headroom, heic ext)`
- **落地**：budget 传 width/height（2800 可达）；companion WS_SOFT_MAX=10MiB-256KiB；hydrate `<untrusted-image>` 包裹；basename 拒 .heic/.svg；ChatView `previewDataUrl` + onError 空砖；chips 只走 `file.uploaded` bump；destAck merge-on-hydrate；sidecar 失败清理 hoist
- **验证**：companion 指定 41+28 pass；extension image-compose/vision/ws 45 pass；tsc --noEmit 绿
- **范围**：worktree `feat/clipboard-image-paste`；未 merge / 未 PR

### P2 spec gap (2026-08-17) [clipboard image paste · 已压缩 chip]
- **Ship**：`fix(sidepanel): show 已压缩 on recompressed image chips`
- **落地**：`App.tsx` image chip 在 `file.compressed` 时于 name/size 旁显示 ` · 已压缩`
- **范围**：单行 UI；`FileAttachment.compressed` 已由 Task 9 写入

### Task 12 (2026-08-17) [clipboard image paste · DoD sweep + fork sidecar copy]
- **Ship**：`feat(threads): copy image sidecars on fork`

[Showing lines 1-391 of 1489. (stopped before byte limit; no partial line returned) Use offset=392 to continue.]