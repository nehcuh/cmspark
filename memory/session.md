# Session Log

## Current Session

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
- **落地**：`copyAttachmentsToThread(fromId, toId, idMap)` 拷 `${oldMsgId}-n.ext` → `${newMsgId}-n.ext`（lstat/realpath 同 write）；`thread.fork` 传 attachments（stamp rel/msg_id）后拷字节
- **测试**：companion 指定套 105 pass；extension 指定套 42 pass；`clipboardRead` 无；honesty grep 无
- **下次**：独立对抗 + Claude/Pi dual（不要 self-APPROVE）

### Task 11 (2026-08-17) [clipboard image paste · honesty copy]
- **Ship**：`docs(settings): distinguish user-attach native vs screenshot vision rail`
- **落地**：VISION_COPY.sectionHelp / fallbackPassthrough；settings-web 英译区分截图轨 vs 粘贴/选/拖原生；file_upload_vision / max_size 诚实提示；chat/browser placeholder + empty `可直接粘贴截图`
- **验证**：`rg` 无 `主对话不会直接收图|main loop does not receive image bytes`；vision-reuse-logic + composer-slash-parity 20 pass

### Task 10 (2026-08-17) [clipboard image paste · transcript thumbs + caption-only edit]
- **Ship**：`feat(sidepanel): 48px image thumbs and adopt persisted message id`
- **落地**：`MessageAttachment` + user MessageRow 48px thumbs；edit 剥 📎 / `<!-- 用户附图分析 -->`；`chat.user` 解析 attachments；`ADD_MESSAGE` same-id merge + temp-id adopt persisted `message_id`（DoD #13）
- **测试**：sidepanel-state adopt/merge + image-compose captionOnlyForEdit；`npm --prefix chrome-extension test` 698 pass；`tsc --noEmit` 绿

### Task 9 (2026-08-17) [clipboard image paste · composer paste/drop/picker]
- **Ship**：`feat(sidepanel): paste/drop/pick images with preflight and compress`
- **落地**：`image-compose.ts` 纯函数 + InputArea 粘贴/拖放/选择器；preflight `likelyMultimodal` / `visionRailOpen`；client caps 4 / 4MiB / 6MiB；chips 到 `file.uploaded`/SW ok 才清；首次 native dest ack
- **测试**：image-compose + vision-reuse-logic + ws-frame-budget 41 pass；`tsc --noEmit` 绿
- **跳过**：node 测环境无 canvas，压缩测只覆盖 GIF 拒绝 / 无 canvas 回退；Chrome 侧仍走 canvas 缩放

### Task 7 (2026-08-17) [clipboard image paste · file.upload MIME split + §5.1a]
- **Ship**：`feat(upload): split images from docs; persist vision descriptions`
- **落地**：`partitionUploadFiles` 先按 MIME 拆图/文档 → docs 仍走 parseFile/内嵌 analyzeImage → 闸门后 `writeImageSidecar` + `chatCreate({ imageAttachments, reservedUserMessageId })`；`useNative` 跳过 standalone `analyzeImage`，否则 vision rail §5.1a `<!-- 用户附图分析 -->`
- **测试**：split-upload-files 12 + file-parser / adapter / sidecar / logger — 93 pass
- **下次**：端到端粘贴 PNG（主模型看图 / 文本模型 vision rail / 文档上传不回归）

### Task 6 (2026-08-17) [clipboard image paste · chatCreate hydrate]
- **Ship**：`418899c` `feat(llm): persist image metadata and hydrate on every chatCreate`
- **范围**：`companion/src/llm/adapter.ts` + `companion/tests/adapter.test.ts` only
- **落地**：`ChatCreateParams.imageAttachments` 元数据落盘（sidecar 字节由 Task 7 先写）；`chat.user` echo；rebuild 后 `hydrateUserImageParts`（`likelyMultimodal` + max 4）；`skipUserMessage` 同路径
- **测试**：`npx tsc -p tsconfig.test.json && node --test .test-dist/tests/adapter.test.js` — 16 pass
- **下次**：Task 7 file.upload MIME split 调 `imageAttachments`

### S73 END (2026-08-17 ~14:53) [thread hygiene · 五路对抗 · **#193 MERGED**]
- **Ship**：**PR #193 MERGED** rebase `7a88b8c` ← `feat/thread-hygiene` — 未命名/ACP husk 卫生（规格 C′+D + H1/H2）
- **诊断**：清理空白只删 0 消息；整理默认 30 天前；无 user 的编程接力不起名、不进规则；用户把 `#id` 当名字
- **设计**：五路独立对抗 → 用户拍 C′（终态写 `接力·{agent}·{token}`）+ D（薄 husk 预勾）
- **落地**：呈现阶梯 + `acp_husk`/`no_user` + 整理默认全部；`commitThreadAlias`；三路对抗 REJECT 后修草稿/正文失败词/Trust exceptId/终态幂等
- **CI**：build + 3 smoke 绿后 rebase 合 main
- **下次**：(1) 重启 Companion + 重载扩展 (2) `⋯ → 整理助手` 验 `rny77t`/`4j6l6f` 预勾、`vpfb7g` 不动 (3) 新开失败接力应起名
- Recorded: yes — 无意义=无 user；失败词禁扫 body；SW 必须转发 except_thread_id


### S72 END (2026-08-16~17) [Windows ACP spawn · 多路对抗 · **#191 MERGED**]
- **Ship**：**PR #191 MERGED** `33022bd` ← `fix/windows-acp-spawn` — Windows 外部编程 Agent 启动（shebang/.cmd + Mode C 诚实 + P2）
- **根因**：`where` 先打 npm Unix shebang → `spawn ENOENT`；`.cmd` 无 shell → `EINVAL`
- **工程**：`win-spawn.ts` unwrap PE/`node cli.js`；R1–R5 Mode C 不假 L1 / wrapViaCmd 禁 prompt；R6–R14 wx 临时文件、taskkill、拒 companion PE、`%~dp0`、设置 WT/cmd
- **门禁**：三路对抗 A REJECT / B REJECT / C APPROVE_WITH_NITS → 修 R1–R14 → CI build+3 smoke 绿 → merge
- **机核**：ACP win-spawn/open-local-terminal/discover **77 pass**（含本机 `claude --version`）
- **下次**：(1) 重启 Companion + 重载扩展 (2) 真机侧栏启动 Claude/Pi (3) Mode C 不谎报已开终端
- Recorded: yes — Windows npm shim spawn；wt 别名假 L1；wrapViaCmd 禁 page_context

### S71 END (2026-08-14 ~15:12) [编程接力 Panel · Mode C · multi-adv · **#190 MERGED**]
- **Ship**：**PR #190 MERGED** `8708f89` ← `feat/coding-agent-panel` — Coding Agent Panel + Mode C dual-open residual
- **产品**：侧栏监视桥 + 可选本机终端（双进程）；Stop 仅杀桥；可选终端应用（Ghostty `open -na --args`）
- **工程**：`buildAcpAgentEnv` 登录 shell 对等；Mode C 任务注入；工作区 pick 后 auto-start；B-lite git；applyable 不冲 Apply CTA；cancel→partial
- **门禁**：多路对抗 + Pi dual → must-fix → CI build+smoke 绿 → merge main
- **Worktree**：`.worktrees/feat-coding-handoff`（分支可保留清理）
- **下次**：(1) `git pull` main + 重装/重载 Companion+扩展 (2) 真机 Ghostty Mode C + Stop 诚实 (3) residual：prompt 文件 unlink、login-shell 失败重试、WS throttle
- Recorded: yes — Ghostty macOS open-na；pending_diffs applyable 合同；config.local_terminal_app 必须落盘

### S70 END (2026-08-13 ~09:50) [编程接力 / ACP design+impl · session-end]
- **产品讨论**：本机编程 TUI 不靠 Apps 装配；方向 = **编程接力**（任务包）+ 可选 ACP Client；与 Outbound MCP 对称双门面
- **设计**：5 路对抗 + Pi/Claude 设计双审 APPROVE_WITH_NITS → SoT `docs/decisions/acp-coding-handoff-product-design-2026-08-13.md` · §5.7 UX Consistency Contract
- **实现**：独立 worktree **`feat/coding-handoff`** @ `.worktrees/feat-coding-handoff`
  - Phase A：`/code` · 任务包 Modal · 复制 · Pack `coding-handoff` · settings
  - Phase B：`companion/src/acp/*` · `acp_*` tools · 默认 `acp.enabled=false` · ADR-025
  - Phase C/D 写盘：未做（NO-GO）
- **双审实现**：Claude APPROVE_WITH_NITS；Pi R1 **REJECT**（B1 HITL 可被 god-mode 跳过）→ 已修 forceConfirm 永不 waive ACP → Pi R2 APPROVE_WITH_NITS
- **产品缺口（对用户说清）**：**不能**在 Chrome 插件内实时看/操作编程 Agent；仅任务包外派 + 后端一次性 handback
- **未 push / 未 merge main**；main tip 仍为 #184 栈
- Recorded: yes — L2_GATE vs capabilityForceConfirm；编程接力坐标



### S69 END (2026-08-12~13) [thread ID UI · large skill zip · download recovery · #184 MERGED]
- **Ship**：**PR #184 MERGED** `5713089` ← `f0d8207` — 会话 `#id` 列表/顶栏 + 大 skill ZIP + `browser_download` 超时恢复
- **UI**：ThreadList/StatusRail 常驻 `#id`、点复制 bare id；搜索 alias/id/preview/tags/tldr/bullets；搜索展开历史日分组
- **skill_install**：预算 100/120MiB·2000 files；monorepo 只装 `skills/<name>/`；`pickSkillMdEntryResult` 与 L2 预览锁步；multi-SKILL fail-closed；atomic bak/rename；FromPath；size=0 大 compressed 拒
- **download**：TIMEOUT 恢复须 hint + 时间窗 50ms skew；`force_redownload` 禁止 cache 恢复
- **门禁**：四路对抗 REJECT → 修 B1–B4 + nits → dual R2 Claude+Pi **APPROVE_WITH_NITS** `both_ok`；CI build+smoke 绿后 merge
- **main tip**：`origin/main` @ **`5713089`**；**open PR 0**
- **本地**：`dist-package` 已 sync；`dist/` / 巨型 audit `.patch` / `_install-local-app.sh` 未进 PR
- **下次**：重载扩展+重启 Companion；真机装 dashiai zip；三旗/meeting/workspace 真机 backlog 仍在
- Recorded: yes — L2 picker≠install · force_redownload vs shelf recovery · dist-package 路径

### S68 END (2026-08-12 ~22:12) [三旗路径风险自担 · #181/#183 MERGED · CI 对齐断言]
- **Ship 已在 main**：`#179` MERGED → `#181` 工具面/MCP/DSML/acquireLock UX → `#183`（含 #182 cherry-pick）path risk-accept @ **`7e6f638`**
- **产品法**：三旗 = 工具全开 + 路径几乎无 cage；只拦 SSRF/云元数据/volume·OS 硬危险等语义面；`file://` 无三旗 → `image_fetch_file_requires_cruise`（非 Security Block 文案）
- **本会话收尾**：盯 #183 build 红（3 测旧断言）→ 改 gates/hints → CI 绿 → squash 合 main
- **main tip**：`origin/main` @ **`7e6f638`**；**open PR 0**
- **本地**：可有 `dist/`、audit patch、`scripts/_install-local-app.sh` 未跟踪；热修 app 后重启托盘以吃 main 二进制
- **下次**：真机三旗：file 图 / MCP allow 自动扩 / 路径写盘；可选全量 DMG；meeting/workspace 真机 backlog
- Recorded: yes — path residual floors · CI 文案锁步 · acquireLock 同 PID 幂等

### S67 END (2026-08-12) [会议 STT hotfix + AI 纠错 · dual · #179 后已 MERGED]

- **范围**：#177/#178 后真机踩坑热修 + 对抗 F-merge-1..6 吸收 + 会议 live AI correct_only（priorContext）+ 智能分段
- **Ship 状态**：**PR #179** OPEN `fix/meeting-stt-hotfix-refine-absorb` @ `ff00681`（未合 main）
- **Dual**：Claude+Pi 均 **APPROVE_WITH_NITS** `both_ok=true`（`meeting-stt-hotfix-refine-verdict-20260812-113816`）；高优先 nits 已二次吸收再 push
- **产品**：双 ack 门控；soft 不 loop conflict/oom；`binary_broken` 首击硬停；停录 drain refine≤22s 再 end/纪要；段定稿 opt-in 纠错（`asrRefinerEnabled`）
- **macOS**：brew/local install + `install.manifest.json`；package 0/残缺 dylib + otool 硬失败；文案「安装」非假一键下载
- **机核**：ext meeting-live-refine 8 + suite 645；companion voice 32
- **本地**：扩展已 sync `dist-package/.../chrome-extension`；agent 已 esbuild 进 `/Applications`（需用户重开托盘）
- **下次**：(1) CI 绿合 #179 (2) 真机双 ack + AI 纠错 + 坏二进制硬停 (3) residual：manifest 同目录可写 / DYLD_FALLBACK brew
- Recorded: yes — soft max-1 · priorContext refine · drain 竞态 · SIGKILL≠oom

### S66 cont END (2026-08-11) [P2b+3 #171 MERGED · adversarial fanout]
- **#171 MERGED** `a6eb5a3` — Phase 2b SectionHeader/popupMenu/PanelBanner + Phase 3 motion
- **Precision stack complete**: #168+#169+#170+#171 all on main
- **Adversarial fanout** (4 independent explore agents): overall **C+**
  - UI C+ (graph stale re-open / same-thread wipe / textMuted contrast)
  - Security B+ (no new P0 from UI; residual eTLD/SSRF/cruise)
  - Correctness C+ (thread.messages ungated; sticky busy on disconnect)
  - Tests B− (Phase 2b/3 chrome untested)
- Report: `docs/audit/precision-merge-adversarial-fanout-2026-08-11.md`
- **Next fix slices**: isolation+busy · graph freshness · chrome contract tests
- Recorded: yes

### S66 cont (2026-08-11) [Phase 2a token purge → PR #170]
- **After #168/#169 MERGED** (`dd77915`): continue Precision Instrument Phase 2
- **Phase 2a**: Settings/MCP/Apps/Packs hex→tokens; Graph residual edges; r1 Claude REJECT (dark code block) → nits → r2 both APPROVE_WITH_NITS
- **PR #170** https://github.com/nehcuh/cmspark/pull/170 · branch `feat/sidepanel-precision-p2a-token-purge`
- **tests** 622 pass; dual r2 both_ok
- **下次**: CI 绿合 #170；Phase 2b SectionHeader + ThreadList density；Phase 3 motion
- Recorded: yes

### S65 END (2026-08-11 ~15:50–16:05) [default workspace sandbox Scheme 1 · #165/#166 MERGED]
- **产品**：未绑 `workspace_root` 时 `workspace_*` 默认 `~/CMspark-projects`（不写 thread）；显式 pick 优先；shell cwd 不跟
- **Ship**：**#165** `ec6d0f5` Scheme 1 + dual APPROVE_WITH_NITS → **#166** `06fcd96` nits（catalog/ChatView/symlink/chmod/`resolveEffectiveWorkspaceRoot`/docs）
- **门禁**：adversary + Claude+Pi `both_ok`；CI build 绿后 merge；workflow `.grok/workflows/default-workspace-sandbox.rhai`
- **main tip**：`origin/main` @ **`06fcd96`**；open PR 0（本会话）
- **下次**：真机未绑定工作区 list/read 沙箱；可选再验 symlink 拒绝；backlog 仍 Windows/Mac 真机 + message-router 续拆
- Recorded: yes — 默认沙箱≠auto-bind · symlink 拒绝 · dual nits 同日 follow-up

### S64 (2026-08-11) [Thread History IA Wave A — UI only · 已随 #164 在 main]

- **Task**: Wave A A-1..A-7 (design dual-review APPROVED; impl dual-review later both_ok r2) — untagged batch extract, tldr row, portal menu, tag cloud fold, N/M progress
- **Pins**: S1 force empty-tags; S2 exclude worker; S3 skip busy / disable 0; S4 portal z>51; S5 digest_updated progress no 60s clear
- **Files**: `thread-timeline.ts` helpers · `ThreadList.tsx` · `thread-timeline.test.ts` · `useWebSocket.ts` custom events
- **Out of scope**: Wave B/C, related, Graph, companion protocol, Knowledge dual-write
- **Next**: run `npm --prefix chrome-extension test` for timeline helpers; manual smoke ☰→标签→CTA / ⋯ menu

### S63 END (2026-08-11 ~10:40) [multi-adv #162 · C10 #163 · stale remote 清仓]
- **Ship 已在 main**：`#162` multi-adv Wave0–2 `50c9685` → `#163` C10 god-file A–H + nits `a32659e`（含 eager-bind `d028f2e`）
- **本会话**：用户要「未合 remote 依次开 PR→CI→合」→ 盘点 11 支均为 **squash 假阳性**（PR 已 MERGED，merge-tree 会回灌旧 `server.ts`）→ **拒绝硬合** → 授权后 `git push origin --delete` 11 支；再清 12 支已是 main 祖先的 leftover remote
- **远端卫生**：`origin/main` tip `a32659e`；**open PR 0**；remote 仅 `origin/main`（工作区另有 local worktree 分支未推）
- **本地**：`main` = `origin/main`；`stash@{0}` local-wip-before-pr-pipeline（esbuild/host-integrity）；worktree 可能仍挂 `fix/c10-godfile-split-a` / multi-adv
- **下次**：真机验收 backlog（Windows shell/听写、Mac 值守）；可选清 local worktree/stash；god-file 后续若有 message-router 再分期
- Recorded: yes — squash `--no-merged` 假阳性 · merge-tree 防回退 · remote 删支卫生

### S62 END (2026-08-09 ~22:50–23:35) [Windows voice-pack closeout · shell_exec token · #161 MERGED]
- **Ship**：**#161 MERGED** `57bad96` → `origin/main`（Windows closeout + shell/netsec `validateTokenFor` + lockfile engines）
- **根因**：`shell_exec` L2 issue 绑 `command|cwd`，旧 validate 只验 command → enterprise_auto 下恒「Invalid or expired security token」
- **打包**：`build-windows-exe.ps1 -SkipInstall -SkipNsis` 成功；产物 `dist-package\cmspark-windows-x64\` + zip v0.5.0；含 whisper sidecar；已停旧进程并 stage 新 SEA
- **门禁**：closeout dual APPROVE_WITH_NITS；CI build green 后 merge commit
- **经验+总结**：`docs/audit/voice-pack-windows-closeout-s62-2026-08-09.md`（E1–E4 + 状态表）；project-knowledge Reusable Patterns 两条
- **本地**：`main` 跟远程；勿 commit `.tmp-ci-*` / diagnosis-report
- **下次**：真机再验 shell_exec（enterprise/全自动）；听写 hold/continuous；可选 Mac 值守 smoke；multi-arch whisper pins
- Recorded: yes — issue/validateTokenFor 同形 · SEA 文件锁 · S62 正式总结文档

### S61 END (2026-08-09) [deep-diagnosis P0–P2 + 值守全程静默 · #160 MERGED]
- **Ship**：**#160 MERGED** `56da82f` → `origin/main`（deep-diagnosis fanout P0–P2 hardening + unattended true silence）
- **产品纠正**：无人值守武装 = 风险自担 → `host_computer` **initial L2 + mid-task re-L2 全静默**（含 PROMPT_ALWAYS）；硬拒绝仍 throw；modelEnabled 等不再退回弹窗
- **门禁**：三路独立对抗 + 双路复审 **全部 APPROVE_WITH_NITS / Merge YES**；CI green（build+tests+audits）后 REST merge
- **诚实 nits 合入**：confirm-center / ADR-017/020/021 / 矩阵 + 双勾选
- **本地**：`main` = `origin/main` @ `56da82f`；勿 commit `.tmp-ci-*` / diagnosis-report
- **下次**：Mac 真机武装值守验收 L2/re-L2 静默；可选 executor unattended reL2 回归测；急停≠解除 UI toast；Whisper multi-arch / god-file 拆分
- Recorded: yes — 值守全程静默 JTBD · 文档与 ADR 同步纪律

### S60 END (2026-08-09) [session-end · Health Fanout P0–P2 已合 main]
- **Ship**：**#159 MERGED** `e4316bb`（P0 `d1f69ef` + P1/P2 `5ba41f0` + run-tests fix `22688b2` + dual r2 `3a84803`）
- **Dual**：r1 Pi **REJECT**（`run-tests.mjs` JSDoc `*/`）→ 修 → r2 Claude **APPROVE** / Pi **APPROVE_WITH_NITS** both_ok；CI green 后 merge
- **main tip**：`e4316bb` = `origin/main`；工作区干净
- **下次（backlog）**：Whisper 多架构 pin 哈希 / win-x64 sidecar；god-file 拆分；codesign；真机听写会议；Pi nits（multi-agent cap 泄漏等）
- Recorded: yes — npm test 入口 JSDoc 陷阱 · dual 全量 patch 超 context · handleMessage 第 3 参 session

### S59 (2026-08-09) [Health Fanout P1/P2 落地 · CI 回归 · dual · **#159 MERGED**]
- **P0+P1+P2** 全栈进 main（见 S60 / `e4316bb`）
- **P1**：origin / privacy_ack_v2 / pin fail-closed / meeting GC / CU UI / release preflight+SHA256SUMS / docs
- **P2**：CI Node 22 · run-tests.mjs · version lock · WS strict · protocol_version
- **验证**：132 targeted pass；r2 dual both_ok
- **Closeout**：`docs/audit/health-fanout-p0-optimization-closeout-2026-08-09.md` · `…-p1-p2-closeout-…`
- Recorded: yes

### S58 (2026-08-09) [Health Fanout P0 · dual closeout · 后并入 #159]
- **审计** 9 High → P0 dual-approved；与 S59 同栈合 main
- Recorded: yes

### S56 (2026-08-08 ~17:30–18:10) [Windows 本机听写：下载静默 · binary_missing · 打包 sidecar]
- **诊断**：点 large-v3-turbo/下载无反应 ≠ 缺 whisper-cpp；`voiceModel===null` 时 UI 默认「未下载」；`sendMessage` 不读 ok；Companion 侧 download 实测可用
- **binary_missing**：当前 `dist-package\cmspark-windows-x64` **无** `bin\cmspark-whisper-*.exe`；SEA **不能**嵌 whisper；须旁路或 PATH `whisper-cli`
- **实现**：设置页下载反馈/错误/超时；`allWhisperSearchRoots` 含 exeDir/bin；`build-windows-exe.ps1` stage whisper；README/build-package.bat 说明
- **下次**：用户放 `companion\dist\bin\cmspark-whisper-win-x64.exe` 后重跑 `build-package.bat` 或装 PATH whisper-cli 并重启 Companion；重载扩展验下载 UI
- Recorded: yes — 三层（权重/binary/麦）· SEA sidecar · 下载 fire-and-forget

### S55 (2026-08-08 ~16:00–16:40) [听写 UX 缺口 · Whisper M2 · 0.5.0 · DMG · React #310]
- **产品缺口诊断**：会议入口只靠 `/meeting`；本机无字级流；热键手输；设置不能语音改 → 实现装配›场景›会议 + 按键录制 + 设置 NL/语音 + 实时出字偏好
- **本机 Whisper M2**：`partial_request` 累计重解码 + PCM 流；**非** decoder-token；Pi **REJECT**（F1–F4：窗长/取消重启/定稿重复/partial 杀会话）→ 吸收；r3 nits（gUM soft-stop、AudioWorklet、自适应 poll、destroy）
- **Ship**：**#152** 听写/会议/M2 · **#151** TinyClick 清 · **#153** 0.5.0 文档/版本 · **#154** React #310 设置 hooks · 两次 `make package-macos` 装 `/Applications` 0.5.0；扩展 build 重载
- **#310**：`useCallback` 在 `if (!settingsOpen) return null` **之后** → 开设置 hooks 变多；挪到 early-return 前
- **下次**：真机听写/会议 §4（continuous 临时字、hold、场景›会议）；可选再打含 #154 的 DMG；host-integrity 打包脏改勿误 commit
- Recorded: yes — React hooks early-return · Whisper partial_busy 勿 cancel-restart · dual REJECT 必吸收

### S53 (2026-08-08 ~12:00–13:00) [Trust 占用 UX · 思考保留 · digest 多进程 · #148/#149 · DMG]
- **Trust**：历史线程 held cookie 挡新对话；产品补 **holders 弹窗 + force_takeover 一键解锁** → **#148 MERGED** `2460565`；Pi APPROVE_WITH_NITS nits 合入
- **思考 UI**：#h1yi2w 流式有思考、tool 后只剩 shell → `chat.assistant` + tool.start commit → **#149** 前半
- **Digest/标签**：设计持久化 index；本机 0 digest + 多 tray 冲写 → saveIndex merge peer digests + broadcast/list → **#149 MERGED** `1f1776b`
- **门禁**：#149 首轮 settings-web flaky deserialize → 重跑绿；Pi 仅 Trust takeover 批
- **打包**：`make package-macos` → `CMspark-v0.4.0-macOS.dmg`；替换 `/Applications`（备份 `~/CMspark.app.bak-20260808-125047`）；单 daemon+tray
- **下次**：真机：Trust 弹窗接管；tool 轮后思考折叠；重抽 digest 验证 index 有 tags；可选清残留 tray
- Recorded: yes — force_takeover / chat.assistant mid-tool / multi-process digest wipe

### S52 (2026-08-08) [听写+/会议 Mtg0–3 · D2 hold · 语音草稿闪烁 · DMG · dual 闸门]
- **产品**：会议线 **Mtg0→Mtg3 全合 main**（#142–#145）：粘贴纪要 / live 本机录 / 手动 speaker+上传 / 实验匿名「发言人N」k-means；听写 **D1 已在 main** + **D2 按住热键**（#146）；用户指南 + GOAL G22
- **门禁**：各波 Pi+Claude dual；D2 首轮 **双 REJECT**（`voice` 对象 effect 依赖每 250ms teardown + `queueMicrotask` 竞态 async mic）→ 修后 r2 **APPROVE_WITH_NITS** → merge
- **语音 bug**：连续本机 STT 段间隙 `processing` 时 `liveOverlay` 掉成 null → 回退陈旧 `text` 闪消失 → **#147 MERGED** `e6ffeea`（processing 进 overlay + 每 final 刷 draft；热键改手输+datalist）
- **打包**：`make package-macos` → `CMspark-v0.4.0-macOS.dmg`；替换 `/Applications/CMspark.app`（备份 `…bak-20260808-114738`）；daemon 已起 23401
- **下次**：真机验收（指南 §4：continuous 多段不闪、hold 侧栏焦点、会议录/传/发言人N）；可选 OS 全局热键 / 系统混音仍 parking
- Recorded: yes — continuous processing overlay + React effect 依赖陷阱 + DMG 替换纪律

### S51 (2026-08-07 ~10:00–12:06) [压缩分层 A/B/C · dual 闸门 · #134 MERGED · Wave C 待 PR]
- **问题**：长对话压缩失忆；场景不可配知识；思考/外部「用 CoT 当压缩」需取舍
- **交付**：
  - 对抗分析 SoT + dual；Wave A 场景知识 + `active_knowledge_ids` 全链路；Wave B H1 handoff；Wave C `thread_recall`
  - **#134 MERGED** `06c05dc`（A+B+nits，CI 绿）
  - Wave C：plan 双 REJECT→修 F-S5 配对/合成 assistant→impl dual both APPROVE_WITH_NITS；nits 测补齐；**未 commit**
- **决策**：H1≠M3 命名；知识独立字段；recall 同 thread + redact fail-closed；hint 仅 allowlist 允许时
- **下次**：Wave C commit/PR 合 main；可选 Wave D 思考 UI/导出；真机长对话 smoke
- Recorded: yes — F-S5 配对 redact + 多波 dual 闸门

### S50 (2026-08-06 ~21:00–22:00) [analyze_image data: false Security Block · dual-review · PR #130]
- **问题**：#i0iqwl 验证码 / 内联图 → `Security Block: cannot read data: URL`；用户已开 L2+全自动+god-mode+白名单仍拦
- **根因**：IMAGE_FETCH path B 仅 http(s)；canvas catch 把 `data:` 当 fetch_required；设计假设「data: 永不进 path B」破
- **实现**：扩展 `promoteFetchSrc` 本地 decode；companion residual 本地 decode 无 phase2/L2；mime+6MiB；错误截断
- **门禁**：对抗 GO_WITH_AMENDMENTS → workflow 实现 → R1 Pi REJECT（strict:false 收窄）→ 修 → R2 both APPROVE_WITH_NITS → nits → R3 Pi APPROVE / Claude APPROVE_WITH_NITS
- **Ship**：branch `fix/analyze-image-data-url-p0` · **PR #130**；`build/dmg-latest` 亦含同栈（未 push）
- **下次**：合 #130；重载扩展+重启 Companion 真机 captcha/`data:`；可选 Claude residual DRY sanitizeImageDim
- Recorded: yes — data: 非 SSRF 门 + strict:false 判别联合 + dual-review 生产 tsc

### S48 (2026-08-06 ~09:20–14:15) [Thread History IA P0–P1.5 · dual-review · PR #127]
- **产品设计**：今日/历史月日时间树 · digest/tags · `@` 引用 · 批量删 · AI 冗余分阶 → 多路验证 → 规格 `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md`
- **实现**：Timeline+多选 batch_delete · 昨天/规则起名 · digest+Tags · 回收站 · `@` summary_card · 规则整理助手
- **门禁**：设计 Claude+Pi APPROVE_WITH_NITS；实现 R1 REJECT（B1 单删 soft 默认 / B2 回收站 list 污染 / B3 @ Enter）→ 修 + 性能（单遍 list / digest 队列 / purge 批写）→ **R2 both APPROVE_WITH_NITS**
- **Ship**：branch `feat/thread-history-ia-p0-p15` · commit `ebb7fd7` · **PR #127**
- **下次**：合 #127；真机 ☰ 时间树/回收站/`@`/整理；可选 residual nits（B2/B3 回归测、trashed 门 chat）
- Recorded: yes — list_scope · delete 默认 hard · digest 并发队列

### S47 (2026-08-06 ~09:00–09:20) [S46 multi-lane → Trust B lifecycle #126 MERGED · DMG 重装]
- **拉取 main** 后四路对抗 `474df7e..6d2cdcf` → **REQUEST_CHANGES**（Trust 粘滞 / install spoof / spawn 抬权 / 文档漂移）
- **实现**：restore 全路径 · allowTrust · install strip · 单 holder · journal reconcile · Downloads 收紧 · UI Trust 披露；Pi nit：thread.delete 释放 Trust
- **门禁**：Claude+Pi **APPROVE_WITH_NITS** · packs+skill_install **33 pass** · CI build 绿
- **Ship**：PR **#126 MERGED** `b338498`；`make package-macos` → `CMspark-v0.4.0-macOS.dmg`；ditto 替换 `/Applications/CMspark.app` 并重启
- **下次**：真机验收 Trust 场景 / skill_install home；可选提交 packaging 脏掉的 host-integrity；S43 合盖掉电 A/B 仍挂
- Recorded: yes — Trust B 全离开路径 + journal + holder

### S46 (2026-08-06 ~00:00–07:45) [skill_install 主目录 · MCP 巡航 · ChatView 贴底 · 用户场景工具/Trust B]
- **#tj6y24 技能装载**：`skill_install` 源路径扩到 **user_home**（L2 授权）；系统路径仍拒；`a054121`
- **#pl5bud shell 弹窗**：日志证实 shell 已 enterprise_auto_approved；真正弹的是 **MCP write_file force_confirm** → 三旗下 MCP critical 免确认 `1b294fe`
- **ChatView 长对话跳顶**：stickKey + ResizeObserver + ignoreScrollRef + overflow-anchor none
- **场景产品**：多路对抗设计 → Pi/Claude APPROVE_WITH_NITS → 用户场景 tools.mode allowlist + AI generate/optimize + 另存保留工具 `9e7c02b`
- **Trust 选项 B（用户定）**：仅 origin=user 可写 `trust`（skip_l2 三旗 / enable_modules / auto_approve）；apply 写全局、unapply restore → `b247fcf` on main
- **下次**：重载扩展 + 重启 Companion 验收；红队场景勾 Trust 后真机跑 #pl5bud 类；可选内置「红队」模板；合盖掉电 A/B 仍挂 S43
- Recorded: yes — skill_install 白名单心智 · MCP≠shell 确认门 · Pack Trust B 全局可回滚

### S45 (2026-08-05 ~22:00–22:40) [pull main · 四路对抗 · P0 快修 · PR #125 合 main]
- **拉取**：`4a2d02f..474df7e`（#122–#124 · PATH · 上传 · 0.4.0）
- **多路对抗**：Security/Correctness/Architecture/Compat → **REQUEST_CHANGES**（上传跨线程污染 + fleet 显示 scope vs 停止全进程）
- **实现**：`shouldApplyStreamEvent` 门控 panel chrome；`buildFleetStopAllMessage` run/parent stamp；companion parent 过滤；上传错误持久化；`safeUploadBasename`；plasmo 0.4.0
- **门禁**：内部对抗 pass · Claude APPROVE · Pi APPROVE_WITH_NITS · ext 436 pass
- **Ship**：PR **#125 MERGED** `7c8ec53` → `origin/main`
- **下次**：无阻塞；可选 parent stop 集成测 / 打包 bake；合盖掉电 A/B 仍挂 S43
- Recorded: yes — mapBusy-always/chrome-gated + Windows dual-review

### S44 (2026-08-05 ~17:40–18:16) [附件上传卡死 · 诊断日志 · main 推送]
- **问题**：`#um335z` / `#ne13jb` 上传 docx 后一直「思考中」；用户怀疑解析坏
- **根因**：乐观 busy 不清（`file.upload_error`/`error` 未处理）；旧 App 扩展/companion 与源码不同步时请求未进后台；`parseFile` 本身正常
- **实现**：busy 清理 · reasoning/解析状态 UI · panel→SW→WS→companion 诊断日志 · DeepSeek `chat.reasoning` 推流
- **验证**：源码 companion + `chrome-mv3-dev`；`#ne13jb` 聚焦版 docx 全链路成功（parsed 2725 字 + LLM）
- **Ship**：commit `c6b1e8b` → `origin/main`
- Recorded: yes — project-knowledge 附件上传思考中

### S43 (2026-08-05 ~10:50–13:32) [合盖通宵掉电诊断 · #91 差分]
- **问题**：合盖过夜掉电 >50% 体感；怀疑 companion↔扩展通信复发
- **结论**：非 #91（日志无 `sidepanel_forward_failed`、合盖窗 companion 空窗）；主因 **Wi‑Fi DarkWake 风暴**（~450/h，`E_RX_IP_PACKET`/`centauri-*`）；**oMLX ~13GB 常驻** 为帮凶（无通宵推理仍有防睡断言）
- **实测**：8/4 18:15 Clamshell 85% → 8/5 08:33 58%；关 oMLX 后 DarkWake 仍在；下午合盖测因 **接 AC 100%** 无法读掉电
- **下次**：拔电 + 关 oMLX 合盖 1–2h A/B；可选关「网络访问时唤醒」第二晚
- Recorded: yes — project-knowledge 合盖掉电差分诊断

### S42 COMPLETE (2026-08-04) [multi-adv → #117–#120 ship · grant M1–M4]
- **Main tip**: `3fd7f1a` — 与 origin/main 同步
- **已合 PR**:
  - #118 S42 Trust P0/P1（`__outbound_mcp` / SPA / L8…）
  - #117 run-state + full-autonomy cruise
  - #119 P0d preflight + L4+ grant design dual-lock
  - **#120** grant M1–M4 + Settings UI + dual APPROVE_WITH_NITS + N1/N3 修后 squash
- **Grant**: `require_grant` 默认 false；Settings 签发/撤销；`cmg_` 哈希存储
- **下次**: 真人 P0d T1–T3；require_grant GA；nits N2/N5/N6 可选
- Recorded: yes — session flush · remote main green

### S41 (2026-08-04 ~17:00–18:14) [运行态假空闲 + 子任务下钻 · 对抗→双审→实现 · PR #117]
- **产品问题**：复杂任务像会话结束，可打字，随后 agent 又响应；多 worker 需下钻看进展
- **门禁**：四路对抗（Product MAJOR_REVISE + 三路 PASS_WITH）→ SoT 锁定 → Pi+Claude dual **APPROVE_WITH_NITS**
- **实现**：`thread-busy` 纯函数 · Composer ThreadBusy 门控 · RunBusyChip/ScopeBar/portal FleetWorkerList · tool `thread_id` · fleet `llm_active` · F-S1 stop · 假结束条
- **同批**：full-autonomy cruise（三旗：cookie/critical/re-L2 放行 + matrix/gates 测）
- **Docs**：Outbound P0d bake-off checklist + 交叉链接
- **Ship**：branch `feat/run-state-worker-drilldown` · **PR #117**
- **验证**：extension 421 pass；tsc 绿；security-gates 56 pass
- **下次**：rebase main 后合 #117；真机长 tool + spawn 下钻；P0d 真人 bake-off
- Recorded: yes — 假空闲/RunBusy/portal + 脏树拆分

### S39 (2026-08-03) [PR 收口 + Anthropic P1 UI/probe/skill 旁路]
- **PR 收口**: #112 closed（代码已在 main）；#111 MERGED；#110 MERGED
- **P1 实现**:
  - `companion/src/llm/connection-test.ts` + 单测
  - message-router `config.test` / flat config.set protocol 字段；extra_headers 脱敏
  - settings-web 协议 UI + 真实 anthropic probe（去掉 soft-skip）
  - Side Panel Settings：协议 / 兼容头 / 快速配置；bg 转发 llmOverride 始终带 protocol
  - skill-craft → llmExtract；skill-engine match → createProvider
- **验证**: companion 相关 69 pass；extension normalizeConfig 15 pass
- **下次**: push/PR 合 main；可选真机中继 smoke
- Recorded: yes — P1 UI + protocol-aware probe

### S38 (2026-08-03) [LLM Anthropic 协议 P0 · 多路设计 + workflow 门禁 · PR #112]
- **需求**: 支持 Anthropic Messages；可选 Coding Plan 网关兼容头（非 Max 伪装）
- **设计**: 三路对抗 → brief → Pi+Claude dual **APPROVE_WITH_NITS** → DIRECTION LOCKED
- **SoT**: `docs/decisions/llm-anthropic-protocol-design-2026-08-03.md` · synthesis + ship note
- **实现**: workflow `llm-anthropic-protocol-p0-with-gates`（节点 Pi / 里程碑 dual）；N1 Pi 先 REJECT（FQDN 尾点绕过）→ 修后 APPROVE*
- **代码**: `LlmProvider` + OpenAI/Anthropic wire；L7 first-party 硬拒；默认 openai；52 单测绿
- **Ship**: commit `5d9986b` · branch `feat/llm-anthropic-protocol-p0` · **PR #112** OPEN
- **下次**: 合 #112；P1 UI（协议选择 + Coding Plan 兼容头 checkbox）；skill-craft 旁路迁 createProvider
- Recorded: yes — wire-only Anthropic + L7 + 节点/里程碑分级复审

### S37 (2026-08-03) [Outbound MCP Server 战略 · 对抗 + 双审 · brief 落盘]
- **问题**: 是否将插件作为服务暴露给 Claude Code / Grok / Kimi 等（Skill vs MCP）
- **对抗**: Advocate / Skeptic / Implementer + 市面四类（Playwright / DevTools MCP / real-Chrome MCP / cloud stealth）
- **双审**: `scripts/dual-external-review.sh cmspark-mcp-server-strategy` → Claude+Pi 均 **APPROVE_WITH_NITS**
- **SoT**: `docs/decisions/cmspark-as-mcp-server-brief-2026-08-03.md`（L1–L9 + L3+/L4+；Option A；Phase 0 协议）
- **挂 backlog**: `docs/optimization-plan-post-adr-020.md` §C Composition · 未开工 · 不插队 B 轨
- **下次**: 需要时写 Phase 0 spike plan；ADR-022 待代码授权后再开
- Recorded: yes — outbound MCP = Composition 导出 L1，非 Browser MCP 克隆

### S36 (2026-08-03 ~09:00–11:12) [pull main + 四路对抗评审 #105–#107]
- **拉取**: `git pull --rebase origin main`；收 #107 Windows uv；本地 2 个 chore handoff 重放；`memory/session.md` 冲突已解
- **评审范围**: 生产 diff `6f3a210^..dd3b1dd`（#105 host_cli+Qwen / #106 Trust IA+ADR-021 / #107 uv）
- **四路对抗**: Security · Correctness · Architecture · Compat 并行 → 合成 **REQUEST_CHANGES**
- **P0**: (1) unattended arm UI「不写长期配置」vs dual-write 持久 cruise/enterprise；(2) `ensure_python_env` 失败前写 `pythonMode:isolated`；(3) windowsHide / PowerShell 安装命令 / 急停文案跨平台
- **产物**: `docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md` + `/tmp/cmspark-review/lane-*.md`
- **下次**: 按 P0 批修（Trust honesty → pythonMode 事务 → 平台补丁）；可选真机微信清单
- Recorded: yes — dual-write 诚实性 + multi-lane post-ship review

### S35 COMPLETE (2026-08-02) [Windows uv/Python chain · 对抗→Pi→实现]
- **对抗**: workflow `windows-uv-python-chain-adversarial` 四路 Platform/Security/Product/Compat → Scheme **D** 锁定
- **SoT/plan**: `docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md` · `.../plans/2026-08-02-windows-uv-python-chain-impl.md`
- **Pi**: **APPROVE_WITH_NITS** → `docs/audit/reviews/windows-uv-python-chain-verdict-20260802.json`
- **实现**: findUv 绝对探测+钉死；平台 winget 文案；uvPath/uvInstallHint 透传 UI；21 tests 绿
- **本机冒烟**: findUv → WinGet `...\astral-sh.uv_...\uv.exe`
- **下次**: 重启 Companion 侧栏确认「已检测到 uv」；可选 PR；P1 config override
- Recorded: yes — PATH 假阴性 / absolute pin

### S35 (2026-08-02 ~14:54–16:43) [Trust IA + 无人值守 → PR #106 合 main]
- **Trust IA**：运行自主度 + 协议解锁；双审后实现；打包装 `/Applications/CMspark.app`
- **产品转向**：用户锁定无人值守硬需求；微信 CU 必须可免 initial L2（Option B）
- **ADR-021**：四路对抗（Security REJECT 目标，产品+Compat+Impl 推进）→ M0–M3 门控双审 → companion grant + 扩展 UI
- **Ship**：**PR #106** squash → main `ed92a81`；CI build 绿
- **仓库卫生**：本地仅 `main`；14 个旧分支已删；与 origin 对齐
- **下次**：真机微信清单；可选 Developer ID / CU smoke；未跟踪 patch/images 可清
- Recorded: yes — ADR-021 + dual-gate workflow + M2 CI tripwire


### S35 (2026-08-02) [Windows uv/Python chain · 对抗设计]
- **触发**: 插件未检测到 uv；诊断为 PATH 假阴性 + brew 文案
- **流程**: 四路对抗 workflow → SoT/plan → Pi 复审 → 开发 workflow
- **状态**: 对抗 workflow 启动中
- Recorded: yes — design gate before code

### S34 (2026-08-02 ~14:00鈥?4:54) [Trust IA / 杩愯鑷富搴?路 瀵规姉+鍙屽+瀹炵幇]
- **瑙﹀彂**锛氭潈闄愬叆鍙ｈ繃澶氾紱God-mode 蹇冩櫤搴斾负闀跨▼鑷不
- **瀵规姉**锛歅roduct/Security/Compat/Autonomy 鍥涜矾 鈫?鍚﹀喅 Scheme C锛圙od 鍚炲叏閮?L2锛夛紱閿佸畾 Hybrid D
- **SoT/plan**锛歚docs/superpowers/specs/2026-08-02-trust-ia-autopilot-design.md` 路 `鈥?plans/2026-08-02-trust-ia-autopilot-impl.md`
- **鍙屽**锛歅i+Claude **APPROVE_WITH_NITS**锛坄trust-ia-autopilot-verdict-20260802-144203.json`锛?
- **瀹炵幇锛圥0+P1锛?*锛歋ettingsSlideout 杩愯鑷富搴?鍗忚瑙ｉ攣+楂樼骇闂搁棬锛沗autopilot-tier.ts`+8 tests锛汼tatusRail 宸¤埅寰界珷锛涙枃妗ｉ攣姝ワ紱**鏈敼** `server.ts` forceConfirm
- **涓嬫**锛氱湡鏈虹偣楠屾瑁?瑙ｉ櫎锛涘彲閫夊疄鐜?dual-review PR锛汸2 浼氳瘽浣滅敤鍩?TTL/spawn 棰勭畻鍙﹀紑
- Recorded: yes 鈥?Trust packaging vs God 鎵╄涔?

### S33 (2026-08-02 ~14:22) [ship DMG + PR #105 merge + vision 405 璇婃柇 + Qwen 娴嬭瘯璇存槑]
- **鎵撳寘瀹夎**锛歸orktree tip 鎵?`CMspark-v0.3.0-macOS.dmg`锛沗ditto` 鈫?`/Applications/CMspark.app`锛沜odesign verify OK锛沗open -a CMspark`
- **鍚?main**锛?*PR #105** squash merge `6f3a210` 鈥?CLI Phase-2 `host_cli` + Qwen3-VL P0/env UX锛圕I build 缁匡級
- **鐢ㄦ埛鎶?405**锛歚analyze_image`/鎴浘 鈫?`vision.analysis_failed` model=`glm-4.6v` nginx 405 鈥?**闈?*鏈湴 Qwen
- **淇厤缃?*锛歚vision.base_url` `鈥?paas/v4` 鈫?`鈥?api/paas/v4`锛涙帰閽堝彉 429 **浣欓涓嶈冻 1113**
- **Qwen 娴嬫硶**锛氬疄楠屽眰 = CU 瀹氫綅寤鸿锛圲IA/OCR 鍚庯級锛涚‘璁ゅ彴 experimental锛涙棩蹇?qwen/locate锛涘嬁鐢?vision 鎻忚堪娴?
- **鏈満 Qwen 灏辩华**锛歚qwen3-vl-2b` 鍦ㄧ洏銆乣modelEnabled=true`銆乮solated python torch/transformers/PIL ok
- Recorded: yes 鈥?vision鈮燪wen锛涙櫤璋?`/api` 璺緞

### S32 COMPLETE (2026-08-02) [AFK: CLI Phase2 + Qwen P0] 鈫?**MERGED #105**
- **Worktree**: `/Users/huchen/Projects/cmspark-wt-cli-qwen-20260802` branch `feat/cli-qwen-diag-20260802` @ `db59a46`
- **Stop gate**: Pi + Claude **APPROVE_WITH_NITS** (cli-qwen-p0-r4 + qwen-env-ux)
- **Merged**: PR #105 鈫?main `6f3a210` (2026-08-02)
- **Master plan**: docs/superpowers/plans/2026-08-02-cli-phase2-qwen-vl-master-plan.md
- **Completion**: docs/superpowers/plans/2026-08-02-cli-qwen-COMPLETION.md
- Recorded: yes


### S32 (2026-08-02) [AFK: CLI Phase2 + Qwen-VL P0 + diagnosis]
- **鐢ㄦ埛鎸囦护**: 娣卞害浣撴 鈫?瀵规姉楠岃瘉 鈫?Pi 澶嶅 鈫?worktree 寮€鍙戜袱鍔熻兘+缂洪櫡锛?*瀹屾暣瀹屾垚鎵嶅仠**锛涘喅绛栧厛瀵规姉鍐?Pi锛涗笉纭畾鍋滃惁鍒?Pi+Claude 鍙岃矾
- **涓ゅ姛鑳?*:
  1. Apps CLI Phase-2 (`host_cli` + Segment B + cli_manifest)
  2. Qwen3-VL 涓嬭浇閰嶇疆 + 澧炲己鐐瑰嚮锛坕mpl P0-1鈥0-8锛?
- **Master plan**: `docs/superpowers/plans/2026-08-02-cli-phase2-qwen-vl-master-plan.md`
- **楠屾敹閿?*: plan 搂2 F1-A鈥 / F2-A鈥 / D-A鈥 + dual APPROVE
- **绂佹**: free-args锛汸TY锛涙敼 main 宸ヤ綔鏍戯紱TCC 鍥為€€锛涙湭瀹屾垚鍋囩豢
- **鐘舵€?*: 鍚姩 deep-diagnosis + plan 瀵规姉/Pi 鈫?worktree 瀹炵幇涓?
- Recorded: yes 鈥?AFK 鍏ㄦ祦绋?


### S31 (2026-08-01~02) [tray-estop 鈫?soft-fail 鈫?OCR describe 鈫?DMG 鍒嗗彂]
- **浠?S30 闃诲缁?*锛歵ray/Aqua 鎷ユ湁 estop锛汸i+Claude **APPROVE_WITH_NITS**锛涚湡鏈轰粛 CGEventTap fail under LS
- **鏍瑰洜鎺㈤拡**锛欳LI/Python Process estop **SOCKET_LIVE**锛沗open -a` 璺緞 tapCreate nil锛圱CC 褰掑洜宸紓锛?
- **soft-fail锛坄0bf4da4`锛?*锛歵ap 澶辫触涓嶉€€杩涚▼ 鈫?socket 淇濇椿锛沗ensureEstopHelper` ok锛涚儹閿?DEGRADED
- **#k47c0u**锛欳U 閫氬悗 describe 绯婅 鈫?agent shell Vision锛?*spatial describe锛坄41d4354`锛?* + Pi APPROVE_WITH_NITS
- **鍒嗗彂**锛歚make package-macos` 鈫?`CMspark-v0.3.0-macOS.dmg`锛堝惈 soft-fail+OCR锛夛紱ship note `e156e78`锛涘凡 ditto `/Applications`
- **鏃?21:51 DMG 涓嶅惈涓婅堪淇?*锛涘埆浜虹敤鏃у寘浠嶄細 code 4 / 绯?OCR
- **鍒嗘敮**锛歚fix/macos-tcc-product-identity` tip `e156e78`锛?*灏氭湭**鍐嶅悎 main锛?
- **涓嬫**锛氣憼 Side Panel 鐪熸満纭鍙颁竴杞紱鈶?PR 鍚?main锛涒憿 鍙€?Developer ID / UI 鏆撮湶 hotkey DEGRADED
- Recorded: yes 鈥?LS vs CLI TCC锛泂oft-fail锛沝escribe 鐗堝紡

### S30 (2026-08-01 鍌嶆櫄) [host_computer 鐪熸満闃诲 路 鐢ㄦ埛鍏堟挙]
- **鐢ㄦ埛閿欒**锛歚estop helper exited at startup (code 4)`锛涙棩蹇椾害鏈?SCK `-3801`
- **宸插悎 main**锛歅R #103 TCC 浜у搧韬唤 + Qwen WIP
- **鏈悎 main**锛歚2c1437f` host Contents 瑙ｆ瀽 + estop stderr/閲嶈瘯锛堝凡瑁呰繘 /Applications锛?
- **鐭涚浘**锛欳LI 瀵?`MacOS/CMspark` estop/鎴浘/鐐瑰嚮 **鎴愬姛**锛汼ide Panel `host_computer` **浠嶅け璐?*
- **HANDOFF**锛歚docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md`
- **鐘舵€?*锛歋31 宸?soft-fail 缂撹В preflight锛涘畬鏁?CU DoD 浠嶅紑鏀?
- Recorded: yes 鈥?鐢ㄦ埛鍏堥€€鍑猴紝闃诲宸茶惤鐩?
### S29 (2026-08-01) [macOS TCC 浜у搧韬唤 路 瀵规姉楠岃瘉璁″垝]
- **瑙﹀彂**锛氬 App 鎴浘 -3801锛涚敤鎴峰惁鍐炽€屽嬀閫?node銆嶁€斺€斿彧搴旇 CMspark.app
- **鏍瑰洜**锛歜ash 涓诲叆鍙?+ SCK 鍦?`cmspark-host`锛坄com.cmspark.host`锛変笌 App 韬唤鍒嗚
- **SoT / plan / 鍙屽 / PR #103** 宸叉帹杩涳紱鐪熸満 Task 7 **鏈繃** 鈫?瑙?S30
- Recorded: yes

### S28 (2026-08-01) [Qwen3-VL 瀹為獙灞?路 浜у搧璁捐涓庢枃妗ｆ敹鏉焆
- **鑼冨洿**锛歍inyClick 鈫?Qwen3-VL 浜у搧鍖栵紱鐢ㄦ埛鏃呯▼ + 澶ч檰涓嬭浇 + 棰勬锛涘璺鎶?+ Pi/Claude/Kimi
- **SoT**锛歚docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md`锛圥ASS_WITH_CHANGES锛?
- **寮€宸?*锛歚docs/superpowers/plans/2026-08-01-qwen3-vl-experimental-layer-impl.md` + `...-HANDOFF.md`
- **鐢ㄦ埛**锛歚docs/qwen-vl-experimental-layer.md`锛涘鑸凡鎸?`docs/README.md`
- **瀹℃煡褰掓。**锛歚docs/audit/reviews/qwen3-vl-product-design-*` + `qwen3-vl-replace-*`
- **涓嬫寮€宸?*锛氭寜 HANDOFF 鈫?plan P0-1鈥0-8锛圓1鈥揂8锛夛紱鍕垮绉板彲鍐呮祴鐩村埌 P0 缁?
- Recorded: yes 鈥?鏂囨。鏀舵潫锛涘疄鐜版湭瀹?

### S27 (2026-08-01) [#au4dch 涓夌棝鐐?鈫?UX 浼樺寲鏂瑰悜鏂囨。]
- **瑙﹀彂**锛氫細璇?#au4dch锛堣 Black-cat + 娓楅€忥級澶嶇洏涓夌偣锛氶噸澶嶄笅杞?/ 渚ф爮鍍忕粨鏉?/ 榛戠獥鏃犺緭鍑?
- **璇佹嵁**锛殈190脳 shell_exec銆?脳 spawn_worker銆佹渶闀?~135s 瓒呮椂锛沺rocessingLabel 鐪嬮敊 tool 娑堟伅缁撴瀯锛泂hell 鏃?windowsHide / 鏃?progress锛涚綉椤?PTY 浠呮湁瑙勬牸
- **浜や粯**锛歚docs/optimization-plan-au4dch-ux-shell-download.md`锛圖L/ST/SH 涓よ建 + Wave 0鈥?锛?
- **鎸傛帴**锛氫富 plan post-adr-020 搂C/D/E + 鎵ц搴忥紱`docs/README` 鍚庣画宸ヤ綔琛?
- **榛樿涓嬩竴鏋?*锛歐ave 1锛坵indowsHide + processingLabel + tool.progress锛夆啋 Wave 2 涓嬭浇鍘婚噸 鈫?Wave 3 鑸伴槦鎬?鈫?Wave 4 PTY epic
- **涓嬫**锛氱敤鎴风‘璁ゅ悗瀹炵幇 Wave 1锛涘嬁鎶?PTY 涓庢琛€娣?PR
- Recorded: yes 鈥?au4dch UX 瀛愯建

### S26 (2026-07-31 ~17:30) [鍦烘櫙鍙厤 + 渚ф爮 UX + 鎶€鑳芥壂鎻?+ DMG]
- **鍚?main**锛?93 鍦烘櫙 P0 UX锛?94 鐢ㄦ埛鍦烘櫙锛坰ystem prompt / skill_refs / MCP + AI suggest锛夛紱#95 鐭ヨ瘑鎵归噺鍒犻櫎 + 鎶€鑳芥ā寮忓嬀閫夎涔?+ StatusRail 椤舵爮 polish
- **鐢ㄦ埛鍦烘櫙 Composition**锛歚origin:user` pack锛沘pply 榛樿 `tools.unchanged` + manual skills/MCP锛涒湪 AI 鎺ㄨ崘 allowlist-only锛涘彟瀛樹负鎴戠殑锛涗繚瀛樺苟鐢ㄤ簬鏈璇?
- **渚ф爮**锛氱煡璇嗙瓫閫?鎵归噺鍒犻櫎锛沘uto/all 绂佸嬀閫?+ 璇存槑锛涢《鏍忕幓鐠?brand + 杩炴帴 pill
- **鎶€鑳芥壂鎻忎紭鍖?* PR #96锛圤PEN锛孋I 缁匡級锛歞isk fingerprint `ensureFresh` + Skills/Knowledge **鈫?鍒锋柊** + 寮€闈㈡澘 `skill.refresh`
- **鎵撳寘**锛氭竻 `/Applications/CMspark.app`锛沗make package-macos` 鈫?`dist-package/CMspark-v0.3.0-macOS.dmg`锛圤RT 瓒呴绠楁湭鎵撳叆 TinyClick锛?
- **鑰楃數 FAQ**锛?91 log.event 鍥炲０鐜凡鏂紱姝ｅ父 MV3 鍋跺彂閲嶈繛 鈮?鏃?bug
- **涓嬫**锛氣憼 **Merge #96**锛涒憽 鐢ㄦ埛閲嶈 DMG + 閲嶈浇鎵╁睍楠屾敹鍦烘櫙缂栬緫/鎶€鑳藉埛鏂帮紱鈶?鍙€?fs.watch debounce
- Recorded: yes 鈥?skill fingerprint锛沴og.event 鑰楃數璺緞

### S25 (2026-07-31) [UIUX Gemini breath 鍚?main + 鍦烘櫙 UX PR #93]
- **UIUX v2 + Gemini breath G1鈥揋4**锛?*#92 宸?squash 鍚?main** `6a6ed73`锛涙湰鍦伴噸缂?`CMspark-v0.3.0-macOS.dmg`锛屾竻鐞?`/Applications/CMspark.app`
- **鐢ㄦ埛鐥涚偣**锛氳鎶€鑳斤紙#r21pj2锛夎 apply AppSec 鈫?`tool_not_allowed` 涓嶅彲鎭㈠锛涖€屼换鍔″寘銆嶉〉 NetSec/AppSec 璁ょ煡娣蜂贡锛涙棤閫€鍑猴紱god-mode 鏃犳晥璇В
- **浜у搧**锛氬鎶楄璁?+ Claude/Pi **鍙屽 APPROVE_WITH_NITS** 鈫?SoT `2026-07-31-mission-pack-ux-redesign.md`锛涚敤鎴锋枃妗?**浠诲姟鍖呪啋鍦烘櫙**
- **PR #93** `feat/scene-ux-p0`锛圤PEN锛孋I 璺戜腑锛夛細
  - P0锛歶napply銆乧onfirm-on-apply銆佺姸鎬佹潯銆乺ecoverable 鐧藉悕鍗曘€乽ser_gesture銆丼kills 鍒嗘祦
  - P1锛氭竻闄ゅ伐浣滃尯銆丯etSec 鎶樺彔鈫?*杩佽缃?*銆丼kills 瀹夎鎸囧紩
  - P1.5锛氳缃€屼笁閬撻棬銆嶈鏄?+ pack.yaml `ui.*` 鏂囨
- **涓嬫**锛氣憼 CI 缁?**merge #93**锛涒憽 鐢ㄦ埛閲嶅惎 Companion/閲嶈浇鎵╁睍楠屾敹 #r21pj2 閫€鍑哄満鏅紱鈶?鍙€夛細瀵硅瘽鍐?unapply 涓€閿寜閽?
- Recorded: yes 鈥?鍦烘櫙 whitelist 鈮?god-mode锛汵etSec 杩佽缃紱pack apply 鐢ㄦ埛鎵嬪娍

### S23 (2026-07-30) [Trust P1 鍥涙潯 + browser_download + CI 璇婃柇 鍏ㄥ悎 main]
- **璧风偣**锛氫粬鏈?Windows P0 宸插湪 `fd2d4a1`锛坥sascript 杩囨护 + MCP home锛夛紱璇勫鍚?P0 杩囥€乣browser_download` 鏈仛
- **Trust 搂B锛坵orkflow + Claude/Pi锛?* 鍏ㄩ儴 **MERGED**锛?
  - #90 CI 淇紙cwd 鍋?restart 鎸傛 + osascript 骞冲彴娴嬶級
  - #85 P1-1 god-mode companion phrase
  - #86 P1-2 originWs
  - #87 P1-3 evaluate 鎵瑰噯鍚庡師鐮侊紙tsc `allowed === false`锛?
  - #88 P1-4 shell allowlist metachar P1a
- **#89 browser_download P1.0 MERGED**锛歝hrome.downloads + text/selector + Downloads 娌欑 + BUSY + 鍙屽
- **CI 璇婃柇**锛?h cancel 鈮?娴嬭瘯 fail锛沗mcp-manager` soft trust 娴嬫毚闇?sanitize 鍓綔鐢紱Linux 娴嬮』璁?early-reject
- **main tip**锛歚2315ec2` Merge #88锛堢‘璁ゆ椂锛?
- **涓嬫**锛氣憼 main 涓婂埛鏂?`optimization-plan-post-adr-020` 搂B 鍏?FIXED锛涒憽 P1b argv / MCP home 鏀剁獎 / Windows G3 鐪熸満锛涒憿 HUD/CU/Pack 鎸夌棝鐐?
- Recorded: yes 鈥?cwd hang銆乨ual-review 绂佸叏閲?test銆乀S 鑱斿悎鏀剁獎銆佹壒 PR cherry-pick CI 淇?

### S22 (2026-07-29) [ADR-020 鍚庣画宸ヤ綔 + P1 鐩樼偣/闂ㄧ + P1-1 瀹炵幇 PR #85]
- **瑙﹀彂**锛氭礊瀵熸枃妗ｏ紙ADR-020锛夋槸鍚﹂┍鍔ㄥ悗缁伐浣?鈫?鐢ㄦ埛銆岄兘鍋氬惂銆嶁啋 commit/push 鈫?session-end
- **浜や粯宸插悎 origin/main `8d0cc2e`**锛?
  1. `docs/optimization-plan-post-adr-020.md` 鈥?**鎺掑簭鏉冨▉** A鈥揈锛坰upersede post-v0.3.0锛?
  2. `docs/audit/p1-security-open-items-2026-07-29.md` 鈥?P1 鍥涙潯閿氱偣鐩樼偣
  3. `.github/pull_request_template.md` + dual-review capability checklist + `scripts/dual-external-review.sh` 娉ㄥ叆
  4. 瀵艰埅锛歞ocs/README 路 CONTRIBUTING 路 ADR-020 钀界偣 路 鏃?plan 椤电湁 路 diagnosis P1 鎸囬拡
- **P1-1 瀹炵幇锛堝垎鏀?`fix/diagnosis-P1-1` / PR #85锛屾湭鍚?main锛?*锛?
  - companion `config.set` false鈫抰rue 鍗遍櫓 flag 闇€ `confirmation_phrase` = `鎴戜簡瑙ｉ闄ー锛坄security-arm.ts`锛?
  - 瑕嗙洊锛歚allow_all_schemes` / `auto_approve_dangerous` / `auto_approve_enterprise_tools`
  - UI Settings + background 閫忎紶 phrase锛?1 tests锛沚atch report + dual-review artifacts
  - 鐩樼偣琛細**P1-1 FIXED**锛?*P1-2/3/4 浠?OPEN**
- **HEAD锛圫22 鏈級**锛歚origin/main` = `8d0cc2e`锛涘伐浣滃垎鏀?tip `9f09c5c`锛圥1-1锛夆€?**S23 宸?rebase 鍒板惈 Windows 鐨?main**
- **涓嬫锛圫22 鍐欙級**锛氣憼 鍚?PR #85锛涒憽 P1-2 originWs 鈫?P1-3 evaluate 鈫?P1-4 shell锛涒憿 HUD 鍙€?checklist / P3a-full
- Recorded: yes 鈥?UI 鐭鈮燾ompanion 闂紱ADR-020 backlog 鍧愭爣绯?

### S21 (2026-07-28 ~17:39) [cmspark site-knowledge PR#81 + HUD Task7 PR#82 鍚?main]
- **PR #81** `fix/site-knowledge-hostname`锛氭墿灞曞彂 active-tab **hostname only**锛沜ompanion case-insensitive matchSite锛沰nowledge/skills 鍒嗙锛泃ab lease **浠?multi-agent**锛堝崟 agent 澶?tab 涓嶅啀 TAB_LEASE_CAP锛夛紱Claude+Pi 璁″垝闂ㄥ悗瀹炵幇 鈫?**宸插悎 main** `c7baea3`
- **PR #82** HUD P3a **Task 7**锛歚build-tray.sh` 閽?`SWIFT_TRAY_SHA256=5929b53c鈥锛泂hip note `companion-native-hud-p3a-spike-ship-note-2026-07-28.md`锛泂tdin smoke open/close锛沬mpl dual-review Claude APPROVE_WITH_NITS + Pi APPROVE 鈫?**宸插悎 main** `d3a977f`
- **鍙岃建鎴浘浠?NO-GO**锛沶its锛坥nTerminal 鍐椾綑 fan-out銆乻pike abort 浠?log锛夋帹杩?
- **HEAD**锛歚d3a977f` origin/main锛涘伐浣滃尯骞插噣
- **涓嬫**锛氣憼 鍙€?`CMSPARK_HUD_SPIKE=1` 鍙岃繘绋嬪畬鏁?checklist锛涒憽 P3a-full锛圕onfirmElevated 瀵圭瓑锛屽嬁鍏堜笂鍙岃建鎴浘锛夛紱鈶?P0-D 娈嬩綑 spot-check
- Recorded: yes 鈥?tab-lease multi-only + site hostname wire锛汬UD Task7 ship 璺緞

### S20 (2026-07-28 17:06~) [cmspark 鏂囨。閲嶆⒊ Phase1鈥? 鈫?PR #80 鍚?main]
- **浜や粯**锛歞ocs reorg 鍏ㄩ摼璺?鈥?fanout 浣撴 鈫?璁″垝 鈫?Phase1鈥? 绾犻敊+README 鍏ュ彛 鈫?Phase3 鍥涚敤鎴锋寚鍗?ADR-017/018 鈫?Phase4 archive 鈫?dual-review 鏀跺彛 鈫?**PR #80 宸插悎 `origin/main`**锛坄074f483`锛?
- **鍏抽敭鏂囨。**锛歚docs/README.md` 瀵艰埅锛沗computer-use` / `host-and-apps` / `notebooklm` / `multi-agent` 鐢ㄦ埛鎸囧崡锛沗docs/archive/2026-07/`
- **闂ㄦ帶**锛歱1/p2/p4 Claude+Pi both approve锛沺3 Pi APPROVE + Claude 429 infra + adversarial 淇?CU 鍏ㄥ眬寮€鍏宠瘹瀹炶矾寰勶紙config.json锛岄潪渚ф爮涓€閿級
- **Workflow 鍧?*锛歊hai `fn` 涓嶆崟鑾峰灞傚彉閲忥紱Grok 浠ｇ悊鏂祦闇€鎵嬪伐 dual-review
- **鍚庣画 S21 宸叉竻**锛歴ite-knowledge / HUD Task7 鍧囧凡鍚?main
- Recorded: yes 鈥?project-knowledge Rhai/dual-review/CU 鏂囨。璺緞 + docs reorg pattern

### S19 (2026-07-27鈫?8) [cmspark HUD spike 缁?+ UI 淇?+ enterprise A+B + Win package + estop]
- **Native HUD P3a**锛歍ask 1鈥? 婧愮爜宸插悎 main锛坧rotocol/router/onTerminal/Node bridge/Swift HudController/`CMSPARK_HUD_SPIKE=1`锛夛紱**鏈?* macOS rebuild SHA256锛?*鏈?* Task 7 ship note + 瀹炵幇鍙岃瘎
- **UI 淇?*锛堢敤鎴峰姞杞?`dist-package` 鎵╁睍锛岄潪 `chrome-extension/build`锛夛細
  - BottomBar銆屾洿澶氥€嶏細overflow 瑁佸垏 + 缁樺埗搴?鈫?`position:fixed` + 鍚屾灏辩华鏋勫缓锛坄2536320`/`725197f`锛?
  - `t.skills is not iterable`锛歚SET_SKILLS` 闈炴暟缁?鈫?`Array.isArray` 瀹堝崼鍏ㄨ矾寰勶紙`0108fd4`锛?
- **Enterprise netsec UX A+B**锛堝 agent 瀵规姉 + Pi 闂ㄥ悗杩囧瀹炵幇 Phase 1鈥?锛夛細
  - **A** thread-scoped enterprise session trust锛坒amily: netsec|shell锛夛紱idle 30m + hard 8h锛涗氦浜?grant 鎵嶇画鏈?
  - **B** `security.auto_approve_enterprise_tools`锛坉efault false锛沺hrase gate锛沺ack-forbidden锛?
  - Gate G1锛歚mustInteract = (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip`
  - UI锛歁inimalConfirm/ConfirmElevated A 鍕鹃€夛紱SettingsSlideout B锛汼afetyStrip revoke chip
  - 鏂囨。锛歚docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md` + audit reviews
- **Windows 鎵撳寘**锛氭柊鎵╁睍鎵撳叆 `dist-package`锛坉ebug.log 閿?鈫?鏇?stage 鍒?`dist-package-new`锛涚敤鎴锋竻鐞嗗悗鍏ㄩ噺閲嶆墦锛?
- **estop**锛?
  1. 姝?PID tombstone / 闄堟棫蹇冭烦锛坄96548e1`锛?
  2. **`spawn({detached:true})` 鑷?powershell -File 绔嬪埢 exit 1銆佹棤 ready.json**锛坄7c7611b`锛夆啋 闈?detached 闅愯棌瀛愯繘绋?
  3. **鐢ㄦ埛楠屾敹鎴愬姛**锛坔ost_computer 鍙€氳繃 estop preflight锛?
- **閮ㄧ讲**锛歋EA 鐑鐩?`dist-package-new` + `dist-package` 鐨?`cmspark-agent.exe` + `host-scripts-win/`锛堝叏閲?build 浠嶅彲鑳借 debug.log 閿佹墦鏂級
- **HEAD**锛歚821acf4` on `origin/main`锛堝惈鐢ㄦ埛楠屾敹 memory flush锛?
- **涓嬫**锛?
  1. macOS锛歚build-tray.sh` 鈫?鏇存柊 `SWIFT_TRAY_SHA256` 鈫?HUD Task 7 ship note + 瀹炵幇鍙岃瘎
  2. 鍙€夛細P0-D package hard-gates锛沇indows 鍏ㄩ噺 package 鍦ㄦ棤 debug.log 閿佹椂閲嶆墦
- Recorded: yes 鈥?estop tombstone + detached spawn / skills guard / more-menu+dist-package / enterprise A+B

### S18 (2026-07-27) [cmspark Native HUD P3a spike Task 1鈥? source]
- **Task 1鈥?,5 DONE**锛歱rotocol / router / onTerminal / Node bridge
- **Task 4 SOURCE DONE**锛歚Tray.swift` HudController + handleCommand锛?*鏈?* rebuild SHA256 鈥?闇€ macOS锛?
- **Task 6 WIRED**锛歚CMSPARK_HUD_SPIKE=1`
  - dual-process: menu-bar open/hydrate + WS `hud.spike.*`锛泂erver 绠?manager
  - in-process fallback if tray co-located
  - helpers + tests in `hud/spike.ts`
- **HEAD**锛歮ain ahead ~5锛堟湭 push锛?
- **涓嬫 macOS**锛歚bash companion/src/tray/build-tray.sh` 鈫?鏇存柊 `SWIFT_TRAY_SHA256` 鈫?鍙岃繘绋?env 鐪熸満 checklist 鈫?Task 7 ship note
- Recorded: yes

### S17 (2026-07-27) [cmspark Side Panel UI 涓夋ā鏀跺熬 + Companion Native HUD P3 璁捐/grill/spike plan]
- **UI 涓昏矾寰?*锛歅0鈥揚2 + R1鈥揜4 + S1 宸茶惤鍦帮紙content-split銆丆ontextStrip銆乼okens銆乵eta slash銆乤cceptance锛夛紱澶氭壒 commit + dual-review 闂?
- **P3 Native HUD**锛氳璁?brief Option A锛坧hased锛夆啋 dual-review APPROVE_WITH_NITS 鈫?**N1鈥揘10 grill lock**锛圕laude+Pi锛夆啋 **P3a spike plan** 鍐欏嚭 鈫?**Task 0 plan dual-review** both APPROVE_WITH_NITS锛宯its 宸叉姌鍏?
- **鏉冨▉鏂囨。**锛?
  - Lock: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
  - Plan: `docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`锛?*Task 1 DONE** 鈫?浠?**Task 2** 璧凤級
  - Plan 鍙岃瘎: `docs/audit/reviews/native-hud-p3a-spike-plan-verdict-20260727-181620.json`
- **HEAD**锛歚5a4d654` on `main`锛坅head 1锛夆€?protocol module
- **涓嬫**锛氬疄鐜?spike Task 2鈫?锛?*绂佹**鍦?Task 7 瀹炵幇鍙岃瘎鍓嶅仛 dual-track 鎴浘娲按锛泈ire 褰掑睘 **server.ts** 绠?manager/`onTerminal`
- Recorded: yes 鈥?project-knowledge N1鈥揘10 鏋舵瀯 + dual-review plan nits 鍧?

### S16 (2026-07-26) [cmspark macOS computer-use live 淇锛氱偣鍑诲亣鎴愬姛 鈫?鐪熺敓鏁圿
- **鐢ㄦ埛楠屾敹**锛?i4x6pm 鍚庢ā鎷熺偣鍑绘垚鍔燂紙缃戞槗浜戠瓑锛夛紱Mail Exchange 鏈€鏂颁俊鍙
- **鏍瑰洜閾?*锛堢湡鏈烘棩蹇?+ host 瀵圭収瀹為獙锛夛細
  1. `read-mail` 鐢?`message 1 of inbox` = **鏈€鏃?*淇★紙iCloud 2023 welcome锛夛紝闈炴渶鏂?鈫?鎸?30d/365d `date received` 鍙?max
  2. session trust 鍕鹃€夐粯璁ゅ叧 + `maxActionsSeen=actions.length` 鈫?LLM 鎷嗕换鍔″弽澶嶇‘璁?鈫?榛樿鍕鹃€?+ `max(actions, budget)` 璁板叆
  3. inject `cuClientOriginScreen` 鏃?`bestDist<24` 闂?鈫?寰俊 AX 閿欑獥 鈫?鐐瑰嚮鍋忕害 (-68,-46)锛涙埅鍥炬湁闂搞€乮nject 鏃犻椄
  4. **SkyLight  alone 瀵瑰井淇?缃戞槗浜戦潤榛樻棤鏁?*浠?`ok:true`/`verified:true`锛堝儚绱犲櫔澹帮級鈫?**activate + SkyLight + HID(`cghidEventTap`) 鍙屾姇閫?*
- **宸叉敼婧愮爜锛堝緟鏈?session-end commit锛?*锛歚host.swift` / `host-skylight.swift` / `host-integrity.ts`锛圫HA 閽変綇锛? `read-mail.applescript` / `darwin-adapters` forceForeground 鍚?bundle / `server.ts` actions 鍦版澘 / extension session-trust 榛樿鍕?/ 娴嬭瘯 G1
- **鐑儴缃?*锛歚/Applications/CMspark.app` 鐨?`cmspark-host` + `cmspark-agent.js` 鍝堝笇 + `read-mail.scpt`锛沝aemon 宸查噸鍚?
- **鍕挎贩鍏?commit**锛歚docs/decisions/v1.3/*`銆乣.omx/`銆乤udit patch/err銆乣tmp-wx-live.png`
- **涓嬫**锛氭寮?`make package-macos` 閲嶆墦 DMG锛堥伩鍏嶅彧鐑崲 binary 婕傜Щ锛夛紱pixel `verified` 鍋囬槼鎬у彲鍐嶆敹绱?
- Recorded: yes 鈥?project-knowledge 涓夋潯 computer-use 鍧?

### S15 (2026-07-25) [cmspark deep diagnosis fanout + P0-A/B/C fix stack; P0-D mid Design]
- **璇婃柇 fanout**锛?3 agents 鈫?5.8/C+锛堚啈1.4锛夛紱Critical 0锛涙姤鍛?`docs/audit/diagnosis-fanout-2026-07-25.md`
- **娴佺▼**锛歚p0-batch-fix.rhai` = Design鈫扞mplement鈫掑鎶椻啋**鐙珛** Claude+Pi 鍙屽鈫抌uild銆侾i 鍙┖鎸傦紱鐢ㄦ埛鍙?waive
- **宸?commit锛堟湰鍦版湭 push锛?*锛歚360de94` P0-A 路 `29db352` P0-B 路 `c2784ed` P0-C锛汬EAD 鍒嗘敮 `fix/diagnosis-P0-D`
- **P0-C 琛ヨ**锛氫簨鍚?Pi 浜?APPROVE_WITH_NITS锛坄P0-C-verdict-20260725-140515.json`锛夛紱鏇剧敤 waive 鎺ㄨ繘
- **涓嬫**锛氫粠 P0-D 缁х画锛坧ackage/release hard-gate锛夛紱瑙?`docs/audit/handoff-p0-diagnosis-2026-07-25.md`
- Recorded: yes 鈥?project-knowledge 鍙屽娴佺▼锛汸ROJECT_CONTEXT handoff S15

### S14 (2026-07-23) [cmspark macOS computer-use: forceForeground 铻嶅悎 + bundle 绾?TCC codesign 鏍瑰洜瀹氫綅]
- 鎷夎繙绋嬶紙`26e29c6` session-trust + `51c959f` forceForeground 铻嶅悎锛夆€?涓婁釜浼氳瘽鐨勩€屾柟妗?A銆嶅凡鍚堬細姣忓姩浣?`activateTarget` 鎶樺彔杩?`forceForeground(hwnd)` 鍗曚竴鍏ュ彛锛宔xecutor FOREGROUND-YIELD 鑷 UI 闈欓粯閲嶆姠鐢ㄥ悓涓€鍑芥暟銆?
- **TCC 鍙嶅寮圭獥 regression 鏍瑰洜瀹氫綅**锛氱敤鎴锋姤"chrome 鎻掍欢鎵ц杩囩▼涓弽澶嶅脊绐楁彁绀?CMspark.app 闇€瑕佹埅灞忔潈闄愶紝瀹為檯鎵撳紑閮藉凡缁忔湁鏉冮檺"銆傝瘖鏂細`codesign -dv` 鏄剧ず `/Applications/CMspark.app` bundle 绾ф湭绛惧悕 鈫?macOS 26 Tahoe TCC **鎸?bundle 绾ц瘎浼?*锛堜笉鏄?per-binary锛夛紝鏈鍚?= 姣忔鍚姩閲嶆柊璇勪及 = 鍙嶅寮广€傜敤鎴蜂粠 DMG 鎷?`.app` 瑕嗙洊浜嗕箣鍓嶆墜宸ラ噸绛剧増锛岄棶棰樺張鍥炴潵銆?
- **闀挎湡淇**锛坈ommit `198bfe9`锛屽凡鎺?origin锛夛細`scripts/create-dmg.sh` 鍦?Step 3锛坈p staging锛夊拰 Step 4锛坔diutil create锛変箣闂村姞 Step 3.5锛歚codesign --force --deep --sign - --options runtime --entitlements <host.entitlements>` + `codesign --verify` 纭棬 + CDHash 鎵撳嵃銆傛墍鏈?step 鏍囩 `[X/5]` 鈫?`[X/6]`銆備笅娆?DMG 閲嶆墦鑷姩甯︾鍚嶃€?
- **鐭湡缂撹В**锛氭墜宸?`codesign --force --deep --sign - --options runtime --entitlements ...` 宸茬鐨?`/Applications/CMspark.app`锛圕DHash `0e05a4bd...`锛夛紝`tccutil reset ScreenCapture` 鍚庤鐢ㄦ埛閲嶆巿銆俤aemon 宸查噸鍚紙pid 22448锛夎窇鏂颁唬鐮侊紙forceForeground 鐪熷疄鐜?+ session-trust锛夈€?
- **Memory 鏇存柊**锛氳嚜鍔ㄨ蹇?`tcc_cdhash_vs_activate.md` 鍔?bundle 绾х鍚嶅潙锛沺roject-knowledge 鍔犲悓鍚?Technical Pitfall 鏉＄洰銆?
- **鏈畬鎴?*锛氣憼 鐢ㄦ埛鐪熸満璺戠綉鏄撲簯 e2e锛堥獙璇?forceForeground + session-trust + bundle 绛惧悕涓変欢濂楄仈鍔級锛涒憽 Phase 2 闀挎湡鏂规锛坉aemon 鍖?cmspark-host 鎴?Apple Developer ID锛夆€?TaskList #3 浠?pending銆?
- Recorded: yes 鈥?project-knowledge Technical Pitfalls 鍔?macOS bundle 绾?TCC 鏉＄洰锛沎[tcc-cdhash-vs-activate]] 鍔?bundle 娈佃惤

### S13 (2026-07-21) [cmspark WP3 macOS 鍧愭爣閾捐矾 live 鎺掗殰 脳8 鈥?浠庢湭绔埌绔窇閫氳繃]
- 瑙﹀彂锛氱敤鎴风粰浜嗗潗鏍囨巿鏉冧絾涓€鐩磋繃涓嶅幓銆傞€愮幆鎺掗殰锛屾瘡涓€鐜兘鏄樆鏂€?bug锛?*WP3 macOS 閾捐矾姝ゅ墠浠庢湭鐪熸満璺戦€氳繃**锛圫12 鐨?寰呭畬鎴?E2E"瀹為敜锛夈€?
- 淇閾撅紙鎸夌敤鎴疯俯鍒伴『搴忥紝鍏ㄩ儴鏈?commit锛屽湪宸ヤ綔鏍戦噷锛夛細
  1. `coordinateAllowed` 鍙屽紑鍏冲彧寮€浜嗗叏灞€ 鈫?鐩存帴甯敤鎴峰啓 `~/.cmspark-agent/config.json`锛圓DR-010 opt-in锛?
  2. `host-bin.ts` 鍊欓€夎矾寰勬紡銆屽悓鐩綍銆嶁啋 鎵撳寘鐗堟壘涓嶅埌 `cmspark-host`锛孴ouch ID 闄嶇骇鎴?6 浣嶉獙璇佺爜寮圭獥锛堢敤鎴峰洓娆¤秴鏃讹級锛涙棩蹇楅搧璇?`spawn .../dist/cmspark-host ENOENT`
  3. `server.ts` Windows estop 棰勬鍦ㄥ钩鍙板垎鏀?*涔嬪墠**鏃犳潯浠惰窇 鈫?macOS spawn `powershell.exe` ENOENT 鈫?寮傛 error 鏃犵洃鍚?鈫?uncaughtException **鏉€ daemon**锛坈rash.log 瀹為敜锛孡2 纭鍚?5ms 宕╋級
  4. `estop.ts spawnEstopHelper` 琛?`child.on("error")` 鍏滃簳锛堝悓绫诲穿婧冩牴娌伙級
  5. `host.swift` **estop 瀛愬懡浠ゆ暣涓病瀹炵幇**锛圵P3 鐑傚熬锛孴S 渚?darwin-estop.ts 鏈熸湜瀹冿級鈫?琛ヤ笂锛欳GEventTap 鐑敭 Ctrl+Shift+Alt+Cmd+E + UNIX socket 淇濇椿 + `AXIsProcessTrustedWithOptions` 涓诲姩寮规巿鏉?
  6. `darwin-estop.ts` 涓変慨锛歴pawn 鏃?error 鐩戝惉 / 鍚姩鍗虫缁欏叿浣撳師鍥?/ `estopHeartbeatLost` 鍚屾 try 鎺ュ紓姝ラ敊璇?*姘歌繙璇姤瀛樻椿**锛堟敼鎸佹湁淇濇椿杩炴帴锛屾柇浜?fail-closed锛?
  7. `cuWindowList` 鎷?bundle ID 姣?`kCGWindowOwnerName` 鏄剧ず鍚嶏紙銆岀綉鏄撲簯闊充箰銆嶁墵 `com.netease.163music`锛夆啋 鎵€鏈?mac 搴旂敤 `APP_WINDOW_NOT_FOUND`銆傛敼 `NSRunningApplication` 瑙ｆ瀽 PID 闆嗗悎杩囨护 + 杈撳嚭鐪?bundleId 瀛楁锛沗darwin-adapters.ts` exePath 鏀规槧灏?bundleId锛堝惁鍒?`HWND_NOT_OWNED` 璇潃锛夛紱`executor.ts:1266` `entry.exe!.path` 鍦?mac 鏉＄洰蹇呮姏 TypeError 鈫?骞冲彴鎰熺煡 `entryAnchor`
  8. `cuScreenshot` 鎶?screencapture stderr 鎵?nullDevice 鈫?`cannot read captured image` 钘忎綇鐪熷疄閿欒锛坄could not create image from rect`锛屼富鍥犳槸閲嶇鍚?cmspark-host 灞忓箷褰曞埗鎺堟潈澶辨晥锛夈€傚姞 `CGPreflightScreenCaptureAccess` 棰勬 + `CGRequestScreenCaptureAccess` 寮圭獥 + PERMISSION_DENIED 鏄庣‘鎶ラ敊 + stderr/閫€鍑虹爜閫忓嚭
- 鍙︼細EPIPE tray 宕╂簝锛坈rash.log 07-16锛夋煡涓?repo 宸蹭慨锛?be63e3锛夛紝鐢ㄦ埛鍖呰鐨勬槸鏃у寘
- **閮ㄧ讲**锛歚make package-macos` 鎵撲簡 3 娆★紝鏈€缁?DMG = `dist-package/CMspark-v0.3.0-macOS.dmg`锛堝惈鍏ㄩ儴 8 淇級銆俿taging 浜岃繘鍒堕€愰」楠岃瘉锛坵indow-list 8 绐楀彛甯?bundleId / estop 鍒版潈闄愰棬 / screenshot 鎴愬姛锛?
- **娴嬭瘯**锛歵sc 骞插噣锛沜omputer/host 鐩稿叧 577 娴嬭瘯 0 鎸傦紙win32-only 闆嗘垚娴嬭瘯 mac 璺宠繃灞為鏈燂級
- **寰呭畬鎴愶紙鐢ㄦ埛鍥炴潵鍚庯級**锛氳鏂?DMG 鈫?閲嶆巿 TCC锛堣緟鍔╁姛鑳?+ 灞忓箷褰曞埗锛屼簩杩涘埗閲嶇鏃ф巿鏉冨叏澶辨晥锛沞stop/screenshot 宸插仛涓诲姩寮圭獥寮曞锛夆啋 璺戠綉鏄撲簯鍧愭爣浠诲姟 e2e銆傝嫢鍐嶅け璐ワ紝鏂伴敊璇俊鎭凡甯﹀叿浣撳師鍥?
- **娉ㄦ剰**锛氭墍鏈夋敼鍔ㄦ湭 commit锛涗笅娆′細璇濆彲鑰冭檻鎷?commit锛坔ost-bin/estop-crash/swift-estop/window-list/screenshot 浜旂粍锛?
- Recorded: yes 鈥?鏈潯鐩紱AGENTS.md 寮曠敤鐨?docs/session-lifecycle.md 鍜?session-end skill 瀹為檯涓嶅瓨鍦紙涓嬫鍙竻鐞嗗紩鐢級

### S12 (2026-07-21) [vibesop-py] Observability 闂幆 鈥?span 杩借釜 + 鑱氬悎鍣?+ 鎸囨爣椹卞姩 Loop + Dashboard 缁熶竴

- 鍦?VibeSOP 鍐呭疄鐜颁簡瀹屾暣鐨?**瑙傛祴鈫掑涔犫啋浼樺寲** 闂幆锛歚core/observability/` 鏂版ā鍧楋紙Span/Tracer/Writer/Aggregator锛夛紝`AgentRuntime` 鍩嬬偣锛孌ashboard 缁熶竴 traces銆?
- **瀵规姉楠岃瘉娴佺▼**锛? 鎺㈢储 sub-agent 鈫?grill-me 5 棰橈紙Kimi Code 鍥炵瓟锛夆啋 Claude Code 澶嶅銆傚彂鐜?2 涓樆濉為棶棰橈紙Span 妯″瀷閲嶅瀹氫箟銆両nstinct 鍙嶉璇箟閿欒锛夛紝淇鍚庨€氳繃銆?
- **瀹炴柦**锛坓it worktree 闅旂寮€鍙戯級锛? 涓?Tasks銆?2 files銆?1362/-198銆侲2E + 鍥炲綊娴嬭瘯鍏ㄩ儴閫氳繃銆?
- **Dashboard 瀵规姉瀹℃煡**锛? 涓棶棰橈紙1 CRITICAL metadata 绫诲瀷涓嶅尮閰嶃€? HIGH XSS锛夛紝淇鍚庨儴缃插埌 cmspark 楠岃瘉銆?
- **鍏抽敭璁捐鍐崇瓥**锛?
  - SpanWriter 灏?metadata 搴忓垪鍖栦负 JSON string锛堣劚鏁忥級锛屾秷璐硅€呴渶鍙嶅簭鍒楀寲锛圓ggregator 宸插鐞嗭紝Dashboard 淇鍚庡鐞嗭級
  - Instinct 鍙嶉妗ワ細鐑矾寰勭敤涓珛淇″彿 `times_matched`锛宻uccess/failure 浠呮潵鑷?CLI 鏄惧紡鍙嶉
  - MetricCondition 鐢?Wilson Score Interval 鏇夸唬绠€鍗曟瘮鐜囷紙min_samples=5 澶╃劧瀹夊叏锛?
  - Dashboard 鍓嶇 data 灞炴€?+ 濮旀墭浜嬩欢鏇夸唬 inline onclick锛堥槻 XSS锛?
- **閮ㄧ讲**: vibesop-py v8.0.0 鈫?v8.1.0锛屽叏灞€ uv tool 鏇存柊锛宑mspark 涓祴璇曢€氳繃
- **Git**: feature/observability-loop 鈫?main (fast-forward), 鎺?origin/main銆倃orktree 宸叉竻鐞嗐€?
- **鏈畬鎴?*: LLM span 缁嗙矑搴﹀煁鐐癸紙褰撳墠浠?task 绾э級銆丩angfuse/Panel OTLP 闆嗘垚銆乤uto_evolve_candidates 瀹炵幇
- Recorded: yes 鈥?project-knowledge 鍔?observability 鏋舵瀯銆丟rill-me 娴佺▼銆乵etadata 绫诲瀷闄烽槺

### S11 (2026-07-14) [cmspark knowledge.import_directory 鏀跺熬 + 2 涓?MCP 瀹夊叏 fix + 鎷?8 commit 鎺ㄨ繙绋媇
- 涓柇鎭㈠锛?3 鏂囦欢 +576 -93 鏈彁浜ゆ敼鍔紙S10 涔嬪悗鐨勬柊宸ヤ綔锛夈€備唬鐮佸畬鏁?tsc 骞插噣锛屼絾 dist 鏃с€佹湭 e2e銆? 涓皟璇?`.cjs` 鏈竻銆?
- 涓诲姛鑳?`knowledge.import_directory`锛歝ompanion 璧?`pickFolderNative()` 鍘熺敓 picker锛岄伩鍏嶆墿灞曠 `<input webkitdirectory>` 瑙﹀彂 Chromium 149 SIGSEGV銆傛牳蹇?bug = name collision锛堜袱浠?md 鍏变韩鍚岄 `# 鏍囬` 鈫?sanitize 鍚屾枃浠跺悕 鈫?闈欓粯鐩镐簰瑕嗙洊锛涚鐗涙 79 绡囧缂╂垚 5锛夈€備慨锛歚skill-engine.importKnowledge(content, fallbackName, nameOverride)` 鍔?nameOverride 鍙傛暟锛宮essage-router 璧?walk 鏃朵紶 vault 鐩稿璺緞銆?
- 璇婃柇 + 淇簡**涓や釜鐙珛 MCP bug**锛堢敤鎴峰湪 cmspark 閲岃窇 `directory_tree /Users/huchen` 鎾炲埌锛夛細
  1. **C4 capability gate**锛歚directory_tree` 鎺ㄦ柇涓嶅嚭鑳藉姏 鈫?`["unknown"]` 鈫?CRITICAL_MCP_CAPABILITIES 鎶?unknown 绠?critical 鈫?god_mode 涔熺粫涓嶈繃銆備慨锛歚MCP_NAME_READ` regex 鍔?`directory|tree|walk|traverse|enumerate`锛坰ecurity.ts:350锛夈€傚悓鏃剁敤鎴?config 鍔?`security_capabilities: ["file-read","read-only"]` 鏁扮粍锛堜箣鍓嶇粰鎴愬瓧绗︿覆琚?sanitizeMcpConfig 闈欓粯涓級銆?
  2. **C5 EPERM classifier**锛歚.Trash` 琚?TCC 鎷?鈫?MCP server 鏁存 walk bail 鈫?閿欒瀛楃涓?`"eperm: operation not permitted"` 涓嶅尮閰?`classifyError` 浠讳綍 recoverable 妯″紡 鈫?榛樿 non_recoverable 鈫?鏉€瀵硅瘽銆備慨锛歳ecoverable 鍒楄〃鍔?`"eperm"` + `"operation not permitted"`锛坰ecurity.ts:574锛夈€?
- 椤烘墜鍙戠幇 3 涓嫭绔?UX fix锛堜笉鍦ㄥ師璁″垝锛夛細C6 send shortcut 涓ユ牸 modifier 妫€鏌ワ紙App.tsx + ChatView.tsx锛? C7 ThreadList 琛屽厑璁告嫋閫?copy锛圱hreadList.tsx锛? C8 绌虹櫧 thread 鑷姩鍒涘缓鏀规垚涔愯 UI + 閲嶅懡鍚?`blankThreadCreatedRef 鈫?creatingBlankThreadRef`锛坲seWebSocket.ts锛?
- **partial-stage 鎷?8 commit**锛歚git add -p file << 'EOF' y\nn\ny...` 閫氳繃 heredoc 闈炰氦浜?partial-stage锛沘gentStore.tsx 涓€涓?hunk 鍚?C1+C3 鐢?`s` split 鎷嗗紑銆傝瑙?project-knowledge 鐨?reusable pattern 鏉＄洰銆?
- 912 tests 鍏ㄨ繃锛? commit 鍏ㄥ悎 origin/main锛坆d0b52c锛夈€俻ush 鏃惰 Claude Code auto mode classifier 纭嫤锛堥槻璇帹锛夛紝鐢ㄦ埛鐢?`! cd ... && git push` 鎵嬪姩璺戦€氥€?
- 宸ュ叿鍧戯細Claude sandbox 鍚殑 companion 娌℃湁 GUI session 鈫?`osascript` 绉掑洖 -128 涓嶅脊绐椼€俥2e 楠岃瘉 `knowledge.import_directory` 蹇呴』浠?Terminal.app 璧?companion锛坱ray 鍚殑 daemon 鍚?UID 鍦?GUI session锛屼篃鍙互锛夈€傝瑙?project-knowledge 瀵瑰簲鏉＄洰銆?
- **鏈畬鎴?*锛歬nowledge.import_directory 鐨?e2e 鐪熻窇锛堢偣鎸夐挳閫?绗ㄧ墰妫?鈫?鐪?imported/docsCount/failed锛夈€傞噸鍚?companion 鍚庡洖 side panel 楠屻€傚姛鑳戒唬鐮佸凡 ship锛岄獙璇佺暀缁欎笅涓€浼氳瘽銆?
- Recorded: yes 鈥?project-knowledge 鍔?4 鏉″潙锛圡CP unknown-critical / directory_tree TCC EPERM / Claude sandbox 鏃?GUI / git add -p heredoc 妯″紡锛?

### S10 (2026-07-13) [cmspark daemon 涓荤嚎绋?spin 鏍瑰洜 + live 閮ㄧ讲]
- 璇婃柇 daemon 涓荤嚎绋?spin(PID 23854锛岀棁鐘?鍚姩澶辫触"锛岄渶 kill 鎵嶈兘鎭㈠)锛歏8 `sample` 纭瘉 LLM 娴佸紡寰幆姣?token 瀵?*瀹屾暣绱Н鍐呭**璺?12 鏉℃鍒?`detectJailbreakInOutput(assistantContent)` 鈫?**O(N虏)**(12 regex 脳 澧為暱鍒?N 脳 姣?token)锛岄暱鍥炲閽夋涓荤嚎绋?鈫?WS 蹇冭烦鍋?鈫?瀹㈡埛绔互涓?companion 姝讳簡 鈫?daemon 鍗℃銆傚悓 PR #4(tray鈫攄aemon skill.list 鍥炲０鐜?銆屼富绾跨▼鐑惊鐜€嶇被
- 淇 **PR #64**(宸插悎 main b0ad317)锛氭瘡 token 鍙壂 incoming delta + 200 瀛楃 trailing overlap(`jailbreakScanWindow` + `JAILBREAK_SCAN_OVERLAP`锛?*INVARIANT > 鏈€闀垮彲鑳藉尮閰?~40 瀛楃**)鈫?鏁存祦 O(N)銆傚洖褰掓祴 6 渚?纭畾鎬у鐜?O(N虏) ratio鈮? + 璇?fix O(N) ratio鈮?锛屾棤鏃跺簭 flaky)
- **live 閮ㄧ讲**(鐢ㄦ埛鏈?锛氱敤 `scripts/package.sh` 鐨?*鏉冨▉ esbuild**(**MCP 蹇呴』 inlined锛屼笉鍙?--external**锛沝ev 鐨?`npm run bundle:exe` 璇?`--external @modelcontextprotocol/sdk` 鑷?.app 鍚姩鎶?`Cannot find module`)閲嶅缓 bundle 鈫?鐑浛鎹?`/Applications/CMspark.app/Contents/Resources/cmspark-agent.js`(鏃у浠?`.bak-pre-spinfix`)鈫?`daemon stop` + `daemon start --daemonize`銆傞獙璇?idle锛歚top -l 2`=0.0%銆乣sample`=100% `uv__io_poll`(libuv idle block)
- **鍏抽敭鍧?*锛歚ps -o pcpu`(鍙?`top -pid` 鍗曟)鏄?*杩囧幓涓€鍒嗛挓琛板噺骞冲潎**锛屽垰鍚姩 daemon 鍗充娇鐬椂 idle 涔熸樉 ~30%(鍚姩灏栧嘲 + extension 閲嶈繛 burst 鐨勮“鍑忓熬宸?銆?*鍒?spin 蹇呴』鐢?`top -l 2 -pid <PID>` 鍙栫浜屾鐬椂鍊?*銆傛湰娆¤ 30% 璇垽涓?fix 娌＄敓鏁堛€佷粛鍦?spin"锛屽疄涓?idle锛宻ample 鎵嶆槸鐪熺浉
- defer锛歚chat.token`(adapter.ts:349) 姣?token 閲嶅彂瀹屾暣绱Н鍐呭鏄瑕?O(N虏)锛屼絾涓烘枃妗ｅ寲 REPLACE 鍗忚(`ChatView.tsx:432`)锛屾敼闇€ companion+extension delta 鍗忓悓锛屾瘮 regex 渚垮疁涓嶅崟鐙拤 CPU锛屾湭淇?
- Recorded: yes 鈥?鑷姩璁板繂 spin-rc-on-squared-jailbreak-scan.md 宸叉洿 fix-live + CPU 琛板噺骞冲潎鍧戯紱project-knowledge 鍔?macOS CPU 琛板噺骞冲潎鍧?

### S8 (2026-07-10 缁? [cmspark 瀹¤淇鏀跺熬 鈫?10 PR 鍏ㄥ悎]
- S7 鐨?4 PR(#11-#14)鍏ㄩ儴鍚堝叆 main + **CI 棣栨鐪熺豢**(P0 鍘?`|| true` + P1-1 淇?hang 鍚岀敓鏁?
- 缁х画寮€浜?**6 涓?PR**(鍏ㄥ悎)锛?15 threads-history 5 纭畾鎬уけ璐?鍗曡皟鏃堕棿鎴?绮剧‘cap+闅旂) / #16 CI 鍏ㄩ潰瑕嗙洊(**glob 淇 106鈫?03 娴嬭瘯** + matchSite 鍚庣紑纰版挒 bug) / #17 linux CI stdio skip / **#18 officeparser 4鈫? 鍗囩骇(C4 critical 鏍归櫎锛宒ecompress 渚濊禆绉婚櫎)** / **#19 H10 瀹夊叏寮圭獥 a11y**(focus trap+Escape+aria-modal)
- **閲嶅ぇ鍙戠幇**锛欳I 鐨?`tests/**/*.test.js` glob 鍥?dash 鏃?globstar锛屽彧璺戝瓙鐩綍(8 鏂囦欢/~106 娴嬭瘯)锛?*鐩茶窇 596 涓《灞傛祴璇?*銆備慨 glob 鐢?`find` 鈫?703 娴嬭瘯鍏ㄨ窇锛屾毚闇?10 涓‘瀹氭€уけ璐?+ 1 IPC 宕╂簝(settings-web)銆?0 涓?skip+TODO(鍙杩借釜) + settings-web 闅旂杩愯銆傝繕鍙戠幇 matchSite 鍚庣紑纰版挒 bug(`*.github.com` 璇尮閰?`evilgithub.com`)銆?
- **瀹¤ 4 Critical 鍏ㄩ棴鐜?*锛欳1(WS 閴存潈)/C2(history 钀界洏)/C3(CI 鐪熺豢 703)/C4(officeparser 7 鍗囩骇鏍归櫎 decompress)銆?*10 涓?High 鍏ㄤ慨**锛欻1-H10銆俷pm audit 0 critical銆?
- P1 鍓╀綑锛歅1-5 绛惧悕/SBOM(璇佷功闀挎潌)/M18 鍏朵粬 modal a11y/10 涓?TODO-skip(鐪熷疄 bug 寰呴€愪釜璇婃柇)
- Recorded: yes 鈥?[[remediation-pr-status]] 鏇存柊涓哄叏鍚堬紱project-knowledge 鍔?CI glob globstar 鍧戯紱ci-test-hang 鏍囧凡淇?

### S7 (2026-07-10) [cmspark 瀹¤淇 鈫?4 涓?PR]
- 鍩轰簬鏄ㄦ棩 S6 瀹¤ + 鏂板缓 `docs/remediation-plan-2026-07-09.md`(5 闃舵 P0-P4)锛屽紑 **4 涓嫭绔?worktree PR**(闆舵枃浠堕噸鍙狅紝姣忎釜杩?kimi 鏀瑰姩鍓?缁堝闂?+ tsc/build/瀹氬悜娴嬭瘯楠岃瘉):
  - **PR #11 P0 姝㈣**(`fix/p0-critical-stopgap`)锛欳1 WS Origin 閴存潈(`isAllowedWsOrigin`)/ C2 history 钀界洏(record flush 鍘熷瓙鍐?+ shutdown close)/ C3 绉婚櫎 CI `\|\| true`/ C4 zip-slip 棰勬(鍘熷瀛楄妭鎵腑澶洰褰?symlink)/ H1 config+logger 0o600/ H2 evaluate validateToken銆?3 e2e(ws 鎻℃墜/evaluate-token/zip-slip)+C2 鍥炲綊
  - **PR #12 P1-1 CI 瑙ｅ皝**(`fix/p1-1-ci-hang`)锛氳瘖鏂?6 绾?娴嬭瘯闅旂 bug(闈欐€?import 璇荤湡瀹?config锛岄潪鐢熶骇)銆亀s teardown 寮傛閿欒銆乮ssueToken 瀹氭椂鍣ㄤ笉 unref銆乨aemon-cli lock 娉勬紡 鈫?`npm test` 103/103 缁?~0.4s
  - **PR #13 P1-3 鎸佷箙鍖?*(`fix/p1-3-persistence`)锛欻3 atomicWriteJSON(config+threads 6 澶?+ H4 鎹熷潖淇濈暀(getConfig 澶囦唤.corrupt+鏃ュ織锛宻tructuredClone 娣辨嫹璐?+ H5 鏌ヨ瘉闈?bug(saveConfig 鍏ㄥ悓姝ユ棤绔炴€侊紝鏈姞閿?
  - **PR #14 P1-4 鎵╁睍 tsc**(`fix/p1-4-extension-tsc`)锛? 涓?tsc 閿?sendCdp 璺敱+ScriptingResult+typeof 瀹堝崼)+ build 鑴氭湰鏀?`tsc --noEmit && plasmo build`(鏈湴/release 涔熷叧闂?+ CI 璺?build
- kimi 闂ㄥ娆℃嫤涓嬬湡闂锛歅0-5 adm-zip 璇诲啓閮借鑼冨寲`..`(澶辨晥棰勬鈫掓敼鍘熷瀛楄妭鎵?銆丳1-3 `{...defaultConfig}`娴呮嫹璐濇薄鏌撻粯璁ゃ€丳1-4 build 鑴氭湰鏈叧闂ㄣ€傚弽椹充簡 kimi 鍑犲(P0-2 缃戦〉鍚戦噺绮惧害/H5 close 鍚屾/P1-3 fsync 闄愬埗/P1-4 sendCdp any 鏃㈡湁)
- 4 PR 闆堕噸鍙狅紝浠绘剰椤哄簭鍚堬紱鍏ㄥ悎鍏モ啋CI 棣栨鐪熻浆缁?+ 鏁版嵁瀹屾暣鎬?+ 绫诲瀷瀹夊叏鎵╁睍銆侾1 鍓╀綑 P1-2(渚涘簲閾?/P1-6(eval AST)/P1-7(a11y)/P1-5(绛惧悕)寰呭紑宸?
- Recorded: yes 鈥?瑙?project-knowledge.md銆屾祴璇曢殧绂?node:test ws teardown/楠岃瘉绔炴€佸啀鍔犻攣銆? 涓?pitfall + 鑷姩璁板繂 remediation-pr-status.md;ci-test-hang-companion.md 鏍囪宸蹭慨(PR #12);audit-2026-07-09-full.md 鏇存柊涓?4 PR 鍦ㄩ€?

### S6 (2026-07-09) [cmspark 鍏ㄩ噺浠ｇ爜瀹¤]
- 鐢?Fuck My Shit Mountain skill(full 妯″紡)瀵?cmspark 鍋?25 缁村害鍏ㄩ噺瀹¤;5 涓苟琛屽瓙浠ｇ悊鎸夌淮搴︾皣閲囬泦璇佹嵁,涓讳細璇濆 2 涓?Critical 璁烘柇(history 涓嶈惤鐩?/ WS 鏃犻壌鏉?鐩存帴璇绘簮鐮佸鎶楀鏍?
- 浜や粯:`audit-report-cmspark-2026-07-09.md`(96k/1459 琛?55 findings)+ `.claude/audits/audit-cmspark-2026-07-09-metadata.json`;`report_lint.py --modes full` 鈫?OK
- 鎬诲垎 4.4/C銆?*4 Critical**:C1 WS 鎺у埗闈㈤浂閴存潈(鏍瑰洜,server.ts:1287 鏃?verifyClient/Origin/鎻℃墜)路C2 history.db 姘镐笉钀界洏(record 涓?flush + shutdown 浠庝笉璋?close)路C3 CI 姘镐箙缁?on-red(`|| true` 鍚炲け璐?hang,5 涓畨鍏ㄩ椄闂ㄦ祴璇曢潤榛樼孩)路C4 2 critical npm 婕忔礊(decompress zip-slip 缁?officeparser)銆傚彟 10 High(config 0644 / evaluate token 鏈牎 / 闈炲師瀛愬啓 / config 鎹熷潖闈欓粯榛樿 / saveConfig 绔炴€?/ 鎵╁睍 67 high 婕忔礊 / 鎵╁睍 9 tsc 閿欏彂甯?/ 鏃犵鍚?SBOM / evaluate 鎵╁睍闆堕棬 / 瀹夊叏寮圭獥鏃?a11y)
- 杈圭晫:鍙璁″嚭鎶ュ憡,**鏈敼浠讳綍婧愮爜**(鎶€鑳借鍒?銆備慨澶嶅缓璁湪鎶ュ憡 搂31/搂32(12 椤?Quick Wins)
- 鍧?lint 瑕佹眰 finding 澶?`### Finding:` + 瀛楁 `- Field:` 鏃?bold + 缁熻=鍏ㄥ眬 Severity 琛屾暟 + 25 缁村害灏忚妭榻?鍒濈 emoji 澶?bold 瀛楁 鈫?鏁翠唤閲嶅啓涓€娆?
- Recorded: yes 鈥?瑙?project-knowledge.md銆屽叏閲忎唬鐮佸璁?via Fuck My Shit Mountain skill銆? 鑷姩璁板繂 audit-2026-07-09-full.md;CI 璁板繂 ci-test-hang-companion.md 宸叉嵁瀹¤鍗囩骇涓?Critical

### S5 (2026-07-03) [cmspark config API key sync]
- 瀹℃牳骞朵慨澶嶏細鐜鍙橀噺 `DEEPSEEK_API_KEY` 寮哄埗瑕嗙洊鐢ㄦ埛閫氳繃 UI/Tray 璁剧疆鐨?API Key锛屽鑷撮厤缃棤娉曞湪 Tray 鍜?Extension 闂村悓姝?
- 鏍瑰洜锛歚getConfig()`/`saveConfig()` 鏃犳潯浠朵紭鍏堜娇鐢?env var锛涗繚瀛樺埌纾佺洏鏃舵妸 key 璁句负绌哄瓧绗︿覆闃叉娉勯湶 env var
- 淇锛氭柊澧?`isUserProvidedApiKey()` + `resolveApiKey()`锛屼紭鍏堢骇 = 鏂版彁渚涚殑闈?masked key > 褰撳墠鐢ㄦ埛 key > env var锛涗粎褰?key 绛変簬 env var 鏃舵墠钀界洏涓虹┖
- 缁熶竴锛歚isMaskedApiKey()` 瀵煎嚭骞跺湪 `settings-web.ts` 澶嶇敤锛沗chrome-extension` 涓ょ瀹炵幇鍚屾锛屾敮鎸?`sk-****xyz` 绛夌煭鏍煎紡 masked key
- `message-router.ts`锛氭墍鏈夌‖缂栫爜 `"***"` 妫€鏌ユ浛鎹负 `isMaskedApiKey()`锛沗config.test` 鍚屾椂璇嗗埆 `sk-placeholder` 鍜?masked key锛屼慨澶?2 涓棦鏈夊け璐ユ祴璇?
- `saveConfig` 鎵╁睍锛氬 `vision.api_key` 搴旂敤鍚屾牱鐨?masked key 杩囨护閫昏緫
- 鏂板 `companion/tests/config.test.ts`锛?7 涓敤渚嬭鐩?masked key 鍒ゅ畾銆乲ey 浼樺厛绾с€乪nv var 涓嶈惤鐩樸€乿ision key 淇濇姢
- 楠岃瘉锛歝ompanion + chrome-extension 鏋勫缓閫氳繃锛涚浉鍏虫祴璇?105/105 閫氳繃
- 宸叉帹閫佸埌杩滅▼锛歝ommit `944dbea`
- Recorded: yes 鈥?env var 瑕嗙洊 user key 鐨勪紭鍏堢骇妯″紡銆佽法妯″潡 masked key 妫€娴嬩竴鑷存€с€佹ā鍧楃骇 config cache 鐨勬祴璇曢殧绂?

### S2 (chrome-extension & windows fixes) [cmspark]
- Fixed 4 Chrome extension issues:
  1. Missing button hover tooltips 鈫?added `title` attrs to SecurityConfirmationDialog buttons, settings gear, and "+ 鏂板缓"
  2. "Create branch" (馃攢) had no effect 鈫?background/index.ts was missing `thread.fork` handler entirely
  3. Thread deletion confirmed but not executed 鈫?root cause: field name mismatch (`thread_id` sent, `threadId` read in background); fixed + added optimistic UI update
  4. History chat UX 鈫?auto-scroll to bottom on message load + `CollapsibleMarkdown` for content >3000 chars (solves get_page_text overflow in history)
- Fixed 2 Windows companion issues:
  1. Clicking "Settings" in tray created new thread instead 鈫?root cause: systray2 `update-menu` does not refresh `internalIdMap`; rebuilt menu structure caused click IDs to map to wrong actions. Fixed by kill+recreate tray on rebuild
  2. Windows lacked quick-action entry feel 鈫?localized all tray labels to Chinese, added section headers ("蹇€熸搷浣?, "鏈€杩戝璇?) for visual grouping
- Windows settings open: replaced unreliable `start` command with `explorer` (with fallback)
- 7 files modified across chrome-extension/ and companion/
- Both chrome-extension and companion type-check clean
- Recorded: yes 鈥?systray2 internalIdMap pitfall, extension snake/camelCase trap

### S3 (2026-06-28) [cmspark tray鈫攄aemon CPU 姝诲惊鐜痌
- 璇婃柇: tray鈫攄aemon 鐨?WebSocket skill.list 璇锋眰/鍝嶅簲姝诲惊鐜?daemon 鍝嶅簲涓嶅甫璇锋眰 id,tray 鎶婂搷搴旇褰?push 鍐嶅彂璇锋眰)鈫?涓よ繘绋嬬┖闂?~60%/45% CPU,鏈湴 socket 29MB/s,绱 ~108GB
- 淇(宸插悎骞?main, PR #4 squash 3e60cc5): server.ts 鍝嶅簲閫忎紶璇锋眰 id + companion-client.ts 绉婚櫎 skill.list push 璇Е鍙?+ 瀹堝崼娉ㄩ噴銆俴imi 鏀瑰姩鍓嶅瀹?APPROVE脳2,tsc 缁?ws-roundtrip 5/5
- 閮ㄧ讲: 鍗曟崲 bundle 鍥?node_modules 渚濊禆婕傜Щ澶辫触 鈫?make package-macos 鏁存満閲嶆墦鍖?鈫?瑁呮柊 .app 鈫?瀹炴祴 CPU 60%鈫?銆佸悶鍚?29MB/s鈫?
- 骞冲彴: bug 鍦ㄥ叡浜?TS,Windows/Linux 鍚屾牱涓嫑,涓€浠戒慨澶嶈鐩栧叏骞冲彴
- 娌夋穩: 涓汉鎶€鑳?kimi-gated-fix(~/.config/skills/kimi-gated-fix/)
- Recorded: yes 鈥?.app 閮ㄧ讲渚濊禆婕傜Щ鍧戙€乲imi-gated-fix 鎶€鑳?璇﹁ project-knowledge.md)

### S4 (2026-07-01) [cmspark Side Panel Mermaid 娓叉煋]
- 浜や粯锛歚 ```mermaid ` 鍧楀湪 Side Panel 娓叉煋鎴?SVG 鍥撅紙鍏ㄧ被鍨嬶紝鍚勮嚜鎳掑姞杞?chunk锛夈€傛祦绋嬶細grilling锛? 棰樿璁℃爲锛夆啋 CSP runtime spike锛堥獙璇?strict CSP 鍙鎴风鐩磋窇锛夆啋 5 闃舵瀹炵幇锛坢ermaid.ts util + ChatView 闆嗘垚 + CSS + build + kimi 闂級
- 宸插悎骞?main锛歅R #9 浠ｇ爜锛坰quash 999a307锛? PR #10 鏂囨。锛坰quash 94ca77e锛孉DR-009 + CLAUDE.md A7 + GOAL + arch 搂6锛夈€備袱 PR 鍒嗘敮宸叉竻鐞嗭紝鏈湴 main 鍚屾 94ca77e
- 鍐崇瓥锛氬鎴风鐩磋窇 strict CSP锛堟棤 sandbox/offscreen锛夛紱绾垫繁闃插尽鍑€鍖栵紙securityLevel:'strict' + htmlLabels:false 绾?SVG 鈫?DOMPurify SVG profile 浜屾杩囷級锛涗粎钀藉畾娑堟伅娓叉煋锛坮enderMermaid prop 鍒嗘祦锛屾祦寮忓綋浠ｇ爜鍧楋級锛涘搷搴斿紡缂╂斁 + 鐐瑰嚮鏂版爣绛鹃〉寮€鍏ㄥ昂瀵革紙Blob URL锛夛紱鎳掑姞杞?+ idle/娴佸紡鍙岄鍙栵紱鍧忚娉曞洖閫€浠ｇ爜鍧?
- bug 淇锛欴OMPurify SVG profile 鍓?foreignObject + mermaid 榛樿 htmlLabels:true 鈫?鑺傜偣鏂囧瓧娑堝け锛沗htmlLabels:false` 淇锛堢敤鎴?live 楠岃瘉閫氳繃锛?
- 鎵撳寘鍧戯細`@mermaid-js/parser` exports 缂?`default` 闇€ Parcel `alias`锛坆uild 澶辫触鏍瑰洜锛?
- Recorded: yes 鈥?瑙?project-knowledge.md銆孧ermaid 鍥捐〃娓叉煋鐨勪笁涓潙銆? docs/adr/009

## In-Flight Tasks (Cross-Session)

### Overlay Capture 卡狗食（S87–S94 · #241–#246 on main）
- status: **done**（产品随 #242+#246 在 main；本地 overlay 枝已删）
- context: 默认展开、托盘/热键 HTML 卡、会议台录制/历史/近实时。体检 A–F 另票已合。本机 `/Applications/CMspark.app` 已是 **0.5.7** DMG（S103）。
- next_action: #230 勿整票。
- resume_doc: `docs/superpowers/specs/2026-08-28-overlay-capture-card-design.md` · tip `5c4fcab0`
- updated: 2026-09-01

### ChatShell 同一张脸（S86 · #239 · PR #240）
- status: **done**（squash 合 main `6a3bfe23`）
- context: 侧栏 ChatShell + 弹出 HTML。后续 overlay 卡片在 #241/#242 + 本枝狗食。
- next_action: 无；形态续作见上条 Capture 卡。
- resume_doc: PR #240 · `docs/superpowers/specs/2026-08-27-chat-shell-same-face-design.md`
- updated: 2026-08-28

### 形态深化 0.5.3 切点（S84–S104 · main 含知识 Wave A/B + 开闸 + 查重）
- status: **active**（用户可见主线 on main；不宣称 Capture/CU 闭合）
- context: 切片 1–6、ChatShell、Capture、体检、#265 当轮活计划、#272–#274 知识、#280 开闸、#282 PDF 编码、#281/#283 查重。origin/main tip **`7ab36063`**。本机 DMG **0.5.8 开闸枝**（无 #282/#283）。#228 禁扩 profile；#230 冻。
- next_action: 重载 unpacked 扩展狗食 PDF 导入 + 「按堆选文」。再 `make package-macos` 才有查重。#230 禁止整票。
- resume_doc: spec 2026-09-02 retrieval-scoring · 2026-09-03 exact-duplicate · CHANGELOG 0.5.8 · #230
- updated: 2026-09-03

### steer/nextRun 耐久 + overlay nits（S79 · #220/#221 MERGED）
- status: **done**
- context: #220 kimi nits 合 main 后独立复验 → #221 折残留（cmid / drain 先闸 / redact 调用点）。tip `ac0a3be`。
- next_action: 无阻塞；可选真机召唤器 dogfood。勿全局 redact `value`。
- resume_doc: PR #221 · #220 · `docs/audit/reviews/post220-nits-adversary-synthesis-20260825.md`
- updated: 2026-08-25

### OS summoner overlay（S77–S94 · HTML 卡 on main）
- status: **done**（托盘/热键 HTML 卡 + 会议台在 main；Swift HUD 条备用）
- context: cookie 首屏、Origin 类 handshake、L0 裁切随 A–E 合入。本机 0.5.7 DMG 已换装（S103）。
- next_action: 勿改 SUMMONER_ALLOW。overlay 写 `run_progress` fail-closed（handshakeSurface 来自 WS）。
- resume_doc: #242/#246/#250/#252
- updated: 2026-09-01

### Companion-canon Side Panel（S74 · #196 MERGED）
- status: **done**
- context: 消费级助手空态 + 320 栏；2026-08-18 合 main
- next_action: 无；canon 已在当前 origin/main
- resume_doc: PR #196
- updated: 2026-08-23

### 会话卫生 #193 真机 dogfood（S73 · #193 MERGED）
- status: **active**
- context: 规格 C′+D 与 H1/H2 已在 main `7a88b8c`
- next_action: (1) 重启 Companion + 重载扩展 (2) 整理助手默认「全部」验 husk 预勾 (3) 新失败接力应写 `接力·…·失败`；长 p1-wl 研究帖不得进建议
- resume_doc: PR #193 · `docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md`
- updated: 2026-08-17

### 编程接力 / Mode C 真机 dogfood（S71–S72 · #190 + #191）
- status: **active**
- context: #190 Panel+Mode C 已在 main；#191 Windows spawn/Mode C 诚实已合 `33022bd`
- next_action: (1) 重启 Companion + 重载扩展 (2) Windows 侧栏启动 Claude/Pi (3) Mode C 不谎报 L1；(mac) Ghostty 路径 + Stop 文案
- resume_doc: PR #191 · #190 · `docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md`
- updated: 2026-08-17

### 编程接力 feat/coding-handoff（S70）
- status: **done**（演进为 #190 `feat/coding-agent-panel` MERGED）
- context: 设计 SoT → panel residual → multi-adv → merge
- next_action: 真机 dogfood 见上条
- resume_doc: PR #190
- updated: 2026-08-14

### Default workspace sandbox 真机 smoke（S65 后 · #165/#166）
- status: **active**
- context: Scheme 1 + nits 已在 main `06fcd96`；未绑 workspace_root 应 list/read `~/CMspark-projects`
- next_action: (1) 重载扩展/Companion (2) 场景不选工作区时 workspace_list_dir (3) 可选：把 CMspark-projects 改 symlink 应失败
- resume_doc: PR #165 · #166 · `docs/mission-pack-usage.md` §3
- updated: 2026-08-11

### God-file / multi-adv 落地（S63）
- status: **done** (#162 + #163 on main；tip 后经 #164–#166 → `06fcd96`)
- context: C10 extract + multi-adv residuals + stale remote 清仓
- next_action: 可选 message-router 续拆；清 local worktrees/stash
- resume_doc: PR #162 · #163 · project-knowledge S63 坑
- updated: 2026-08-11

### Windows 包真机验收（S62 后 · #161）
- status: **active**
- context: #161 已合 main；本地已重编 SEA + whisper bin；main 含 #162–#166
- next_action: (1) 确认跑的是 `dist-package\...\cmspark-agent.exe` 新时间戳 (2) enterprise/全自动下 shell_exec (3) 听写 continuous/hold
- resume_doc: PR #161 · `memory/project-knowledge.md` shell token 坑
- updated: 2026-08-11

### Trust / 思考 / digest 真机验收（S53 后）
- status: **active**
- context: #148 force_takeover + #149 chat.assistant + digest merge；DMG 已装 `1f1776b` 栈 `/Applications` · bak `~/CMspark.app.bak-20260808-125047`
- next_action: (1) Trust 占用弹窗一键解锁 (2) shell 轮后仍见思考折叠 (3) 抽 digest 后查 index 有 tags 再重启
- resume_doc: PR #148 · #149 · `memory/project-knowledge.md` S53 坑
- updated: 2026-08-08

### 听写+/会议真机验收（S52 后 · S67 热修）
- status: **active**
- context: Mtg0–3 + D1/D2 + **#179 MERGED** soft-continue/pin/双ack/会议 AI 纠错+分段
- next_action: (1) 重载扩展+重启 Companion (2) 双隐私 ack 开录 (3) 勾选「录制 AI 纠错」验同音字 (4) 坏组件应硬停 binary_broken
- resume_doc: PR #179 · `docs/meeting-and-dictation-user-guide.md` · dual verdict 20260812-113816
- updated: 2026-08-13

### 大 skill ZIP / 会话编号真机验收（S69 · #184）
- status: **active**
- context: #184 on main；dist-package 已 sync agent+extension
- next_action: (1) 重载 `dist-package/.../chrome-extension` + 重启 Companion (2) 列表/顶栏见 `#id` (3) `skill_install` dashiai zip + L2 (4) multi-skill zip 应预览失败
- resume_doc: PR #184 · dual r2 verdict 20260812-231716
- updated: 2026-08-13

### Meeting STT hotfix PR #179（S67）
- status: **done** (#179 MERGED on main)
- context: soft-continue / pin / 双 ack / AI refine / drain / binary_broken
- next_action: 见「听写+/会议真机验收」
- resume_doc: https://github.com/nehcuh/cmspark/pull/179
- updated: 2026-08-13

### Wave C thread_recall → **#135 MERGED**
- status: **done** (PR #135 → main `90db018`; CI build pass ~3m)
- context: same-thread keyword+CJK bigram; F-S5 + synthetic assistant for orphan tools; compact notice hint if allowlisted
- next_action: 可选真机 compact 后 `thread_recall` smoke
- resume_doc: PR #135 · `docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md`
- updated: 2026-08-07

### Wave D 思考 UI/导出 polish
- status: **mostly done** (modes+export 在 main；S53 修 mid-tool 直播思考丢失 #149)
- context: show_reasoning setting; export default omit; mid-loop 现 chat.assistant
- next_action: 真机确认折叠条；可选 always_open 默认产品再议
- resume_doc: PR #149 · plan `2026-08-07-wave-d-reasoning-ui-export.md`
- updated: 2026-08-08

### analyze_image data: Security Block → PR #130
- status: **likely done** (S50 ship; 以 main 为准)
- next_action: 无需 unless 回归 captcha/`data:`
- resume_doc: PR #130
- updated: 2026-08-08

### Outbound MCP P0d bake-off (human)
- status: **active** (checklist ready)
- next_action: 真人 SSO T1–T3
- resume_doc: `docs/superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md`
- updated: 2026-08-04

### Run-state + full-autonomy (S41) → #117 MERGED · S45 P0 isolation closed
- status: **mostly done** (#117 on main; S45 #125 closed post-ship upload/fleet HIGH)
- context: RunBusy + M3' floors + #124 active-thread scope; S45 fixed cross-thread upload_error + run/parent stop
- next_action: 可选真机长 tool + spawn 下钻 smoke；P0d bake-off 手测仍独立
- resume_doc: `docs/superpowers/specs/2026-08-04-run-state-and-worker-drilldown.md` · PR #125
- updated: 2026-08-05

### Outbound MCP P0d bake-off (human)
- status: **active** (checklist ready)
- context: P0c on main; checklist `2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md` pushed on #117 branch
- next_action: 真人 SSO T1–T3 vs Playwright；T1 失败 pivot B/C
- resume_doc: `docs/superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md`
- updated: 2026-08-04

### Multi-adversarial P0 follow-up (#105–#107 post-ship) (S36)
- status: **active**
- context: 四路对抗 REQUEST_CHANGES；报告 `docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md`；S41 加深「三旗全开放行」需与 dual-write 诚实文案同真
- next_action: P0 批修 — arm acks/dual-write 诚实性 · ensure_python_env 事务 · windowsHide/PS/estop 文案
- resume_doc: `docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md`
- updated: 2026-08-04

### Unattended desktop / Trust IA (S34–S35) → DONE #106
- status: **done** (PR #106 → main `ed92a81`；#107 已合；S36 发现 packaging honesty 残余)
- residual: operator WeChat true-device checklist; re-package DMG if distributing; P0 dual-write honesty (S36)
- resume_doc: `docs/superpowers/plans/2026-08-02-unattended-desktop-manual-checklist.md`
- updated: 2026-08-03

### macOS TCC product identity + host_computer unblock (S29鈥揝31)
- status: **mostly done on main** (#103 identity; #104 estop soft-fail / describe / fleet UI)
- context: LS hotkey may still DEGRADED under ad-hoc; Developer ID still open; CU true Side Panel smoke residual
- next_action: Optional Side Panel host_computer 纭鍙扮湡鏈轰竴杞紱Developer ID / DEGRADED UI
- resume_doc: `docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md` 路 `docs/superpowers/plans/2026-08-02-macos-dmg-ship-note.md`
- updated: 2026-08-02

### ADR-020 Trust P1 residual security (from 2026-07-28 diagnosis / S22鈥揝23)
- status: **mostly done** (P1a 鍥涙潯 + browser_download 宸插悎 main 2026-07-30)
- context: #85鈥?90 MERGED. 娈嬩綑锛?*P1-4 P1b** argv锛汳CP home 鏀剁獎锛沇indows G3 鐪熸満
- next_action: 鍙€?P1b / MCP allowlist 鏀剁獎 / G3 鐪熸満锛涙垨 HUD/CU/Pack
- resume_doc: `docs/optimization-plan-post-adr-020.md` 路 `docs/audit/p1-security-open-items-2026-07-29.md`
- updated: 2026-07-30
### P3a Companion Native HUD 鈥?post-spike (from 2026-07-27 / closed Task7 2026-07-28)
- status: active (optional operator + P3a-full)
- context: Task 1鈥? on main. SHA `5929b53c鈥 pinned. Dual-track screenshots **NO-GO**.
- next_action: Optional `CMSPARK_HUD_SPIKE=1` dual-process checklist; then P3a-full (ConfirmElevated parity) 鈥?**no** screenshot flood
- resume_doc: `docs/decisions/v1.3/companion-native-hud-p3a-spike-ship-note-2026-07-28.md`
- product_lock: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
- updated: 2026-07-30

### P0-D package/release hard-gates (from 2026-07-25 diagnosis)
- status: active
- context: Packaging hard-gates largely in CI; residual spot-check only
- next_action: Spot-check package.sh fail-closed + release.yml notes if packaging changes
- resume_doc: docs/audit/handoff-p0-diagnosis-2026-07-25.md
- updated: 2026-07-29

### Quick Actions Runtime Verification
- status: needs-testing
- context: New quick action flow needs end-to-end runtime test
- next_action: Start companion, load extension, click each quick action from tray, verify thread creation and chat execution in side panel
- updated: 2026-06-09

### S12 (2026-07-21) [cmspark macOS 鍧愭爣绾х數鑴戞搷鎺?WP3 鍏ㄦ爤瀹炵幇]
- **鏍稿績浜や粯**: Plan鈫扐dversarial鈫扙xecute鈫扲eview鈫扵est 浜旈樁娈垫祦绋嬶紝瀹炵幇 macOS 鍧愭爣绾х數鑴戞搷鎺?
- **TypeScript 渚?*(14 files, ~1000琛?: token 妯″紡鎵╁睍(`mac.app.*`)銆?0 涓?darwin 閫傞厤鍣ㄣ€丒-Stop(UNIX socket)銆佽瘉鎹摼(Swift Keychain)銆乻erver.ts darwin 鍒嗘敮銆乸olicy.ts vault 瀹堝崼
- **Swift 渚?*(~400琛?: `host.swift` 鏂板 13 涓瓙鍛戒护(window-list/ax-probe/ax-locate/screenshot/ocr/inject/preview/evidence-seal/estop...)
- **Extension 渚?*(5 files): App Tab macOS 鏀寔(鎵弿 /Applications銆乥undleId 娣诲姞銆佺郴缁熸彁绀鸿瘝骞冲彴鍒囨崲)
- **瀵规姉瀹℃煡**: 2 Agent 骞惰鍙戠幇 25 鏉?5 CRITICAL + 8 HIGH)锛屽叏閮ㄧ撼鍏ヤ慨璁㈢増璁″垝 v1.1.0
- **璐ㄩ噺**: tsc 闆堕敊璇€?696 娴嬭瘯 0 鍥炲綊銆丼wift 缂栬瘧 227KB arm64 signed
- **娴嬭瘯涓彂鐜扮殑 bug 淇寰幆**:
  - App Tab 鍔犱笉涓?macOS 搴旂敤 鈫?add-flow.ts bundleId 鍒嗘敮 + enumerate.ts PlistBuddy 鎵弿 + Extension AppsPanel 5 澶?platform guard
  - Tray 鍋滄澶辫触 鈫?handleDaemonStop SIGKILL 鍏滃簳 + MCP shutdown 瓒呮椂
  - 绛栫暐 cap "ai" 鈫?maxPolicyForEntry macOS /Applications 璺緞 鈫?"auto"
  - 绯荤粺鎻愮ず璇嶆棤 mac.app.* token 鈫?buildAppIndexSection darwin 鍒嗘敮 + tool-definitions 鎻忚堪鏇存柊
  - Tray 鐘舵€?false "宸插仠姝? 鈫?pollCompanionStatus WS 绔彛鍏滃簳
  - 鐢熺墿璇嗗埆瓒呮椂 鈫?biometric-gate macOS Touch ID 浼樺厛
  - 閲嶅鐐瑰潗鏍囨搷浣滆秴鏃?鈫?handleCoordinateAllowed 骞傜瓑妫€鏌?
- **鍏抽敭鍐崇瓥**: AX(NSAccessibility) L0 + OCR(Apple Vision) L1 瀹氫綅閾?/ CGEventPost 娉ㄥ叆 / screencapture 鎴浘(閬垮厤 CGWindowListCreateImage 15.0 搴熷純) / UNIX socket E-Stop(鏇夸唬蹇冭烦鏂囦欢) / Keychain SecItemAdd 璇佹嵁瀵嗛挜
- **寰呭畬鎴?*: E2E 鐪熸満娴嬭瘯(闇€瑕?Screen Recording + Accessibility TCC 鏉冮檺)
- **Recorded**: yes 鈥?瑙?project-knowledge macOS computer-use 鏋舵瀯鍐崇瓥

## Session 2026-07-25 鈥?deep diagnosis fanout

- Ran workflow `.grok/workflows/deep-diagnosis-fanout.rhai` (33 agents: 10 subsystem + 6 cross-cut + 16 adversarial verify + 1 synth).
- Report: `docs/audit/diagnosis-fanout-2026-07-25.md` + `audit-report-cmspark-2026-07-25.md`
- Score: **5.8 / C+** (was 4.4/C on 2026-07-09, +1.4). Critical: 0. Confirmed High: 16.
- Prior C1鈥揅4 FIXED_VERIFY (WS HMAC auth, history flush, CI no ||true, critical npm).
- P0 clusters: selector inject (browser-bridge), config.updated unauth fanout, computer session-trust + mac coords, Stop鈮燾omputer abort, tool orphans, package host soft-miss.

## Session 2026-07-25 鈥?P0 batch-fix workflow

- Authored `.grok/workflows/p0-batch-fix.rhai` + `scripts/dual-external-review.sh`
- Gate chain per batch: Design 鈫?Implement 鈫?Internal adversarial (2 skeptics) 鈫?**only if pass** 鈫?SEPARATE `claude -p` + `pi -p` dual review 鈫?fix loop (max 3) 鈫?build verify
- Launched real run for **P0-A** (SEC-1 selector inject, SRV-1 config fanout, confirmation field forward)
- Reviews land in `docs/audit/reviews/`

## Process lock (2026-07-25)

**All subsequent development** uses: Implement 鈫?Internal adversarial 鈫?SEPARATE Claude Code + Pi dual review (`scripts/dual-external-review.sh` / workflow `p0-batch-fix`). No skip external dual review after adversarial.
- P0-A committed: `360de94` on fix/diagnosis-P0-A (also base of fix/diagnosis-P0-B)
- Next: P0-B Stop/stream/thread lifecycle

## P0-B committed + P0-C started
- P0-B commit: `29db352` on fix/diagnosis-P0-B
- Stacked branch fix/diagnosis-P0-C @ 29db352
- Launching p0-batch-fix batch=P0-C (computer reL2 session-trust + Darwin client鈫抯creen)



### S57 (2026-08-09 09:31) [Windows Python discovery cascade · 对抗设计]
- **触发**: Windows 下 Python 发现链不完整（仅 PATH 裸名 + findUv S35）；需 uv→managers→global→well-known→install UX
- **流程**: workflow windows-python-discovery-adversarial 四路 Platform/Security/Product/Compat → 合成 SoT → Pi 复审 → impl workflow
- **状态**: 对抗 workflow 启动中
- Recorded: yes — design gate before code

### S57 COMPLETE-design (2026-08-09 10:08) [Windows Python discovery · 对抗→Pi→impl workflow]
- **对抗**: workflow `windows-python-discovery-adversarial` 四路 Platform/Security/Product/Compat → Scheme **D** Full hybrid cascade
- **SoT/plan**: `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md` · `.../plans/2026-08-09-windows-python-discovery-impl.md`
- **合成**: `docs/audit/reviews/windows-python-discovery-adversary-synthesis-20260809.md`
- **Pi**: **APPROVE_WITH_NITS** → `docs/audit/reviews/windows-python-discovery-verdict-20260809.json`（host pi CLI 偏题两次；协议只读 agent 门控）
- **级联锁**: config → isolated → well-known → managers(seed) → PATH/py → Store+3.10 → absolute pin → ensure → install UX
- **实现**: workflow `windows-python-discovery-impl` 已启动（T1–T13 + nits）
- Recorded: yes — design gate passed; impl in flight

### S57 COMPLETE (2026-08-09 10:21) [Windows Python discovery cascade · 对抗→Pi→实现]
- **对抗**: Scheme **D** Full hybrid cascade 锁定
- **SoT/plan**: `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md` · plans 同日
- **Pi**: APPROVE_WITH_NITS → `windows-python-discovery-verdict-20260809.json`
- **实现**: workflow `windows-python-discovery-impl` complete；G1–G12 all pass
- **测试**: computer-python-runtime **45/45** 绿（findUv + PY-T1..T21）
- **核心**: `findPythonBase` config→isolated→well-known→managers→PATH/py；Store+3.10；absolute pin；`pythonInstallHint`；`basePythonAvailable`
- **下次**: 重启 Companion 侧栏冒烟；可选 PR
- Recorded: yes

### S57 END (2026-08-09 ~11:00) [冒烟 · 重打包 · PR · 合 main · 同步]
- **本机冒烟**: 无全局 Python / Store stub 拒绝 / isolated 3.12 + uv WinGet 绝对；preflight 就绪非「请先安装 Python」
- **重打包**: `build-windows-exe.ps1 -SkipInstall` → SEA；WS `computer.model.state` 侧栏字段 PASS（Origin 须 chrome-extension）
- **PR**: **#157** Python discovery → MERGED `41bf2d3`；**#156** MCP filesystem@home → MERGED `2c84a5e`
- **远程同步**: session-end `c11a7e9` 已 push；`memory/overview.md` 项目现状快照上远程；`main` = `origin/main`
- **本地 stash**: `stash@{0}` Whisper 打包等 WIP（**故意不推**，非已交付）
- **开放 PR**: 无
- **下次**: 可选 pop stash → Whisper DLL stage PR
- Recorded: yes — pitfalls → project-knowledge → remote



### S61 START (2026-08-09 17:22) [Deep Diagnosis Fanout]
- **Intent**: 使用 fanout 对 CMspark 做彻底深入诊断（Phase 1 only: Map+Diagnose → Cross-cut → Synthesize）
- **Workflow**: .grok/workflows/deep-diagnosis-fanout.rhai — 10 subsystem + 6 cross-cut + 1 synthesizer
- **Baseline**: main @ post-#159 Health Fanout (e4316bb); 工作区干净
- **Status**: validating → launching

### S61 DONE (2026-08-09) [Deep Diagnosis Fanout complete]
- **Workflow:** deep-diagnosis-fanout (~25m) · 10 subsystem + 6 cross-cut + synthesizer
- **Grade:** C · Critical 5 · High 28 · Medium 42 (deduped synthesizer counts)
- **Report:** docs/audit/deep-diagnosis-fanout-2026-08-09.md + summary.json
- **Lead spot-check CONFIRMED:** config.get MCP leak dual-SoT; trusted_domains URL skip; host_cli COMPANION_TOOLS gap; board.get SW ok-only
- **Next:** P0 batch (10) if user wants optimize phase
- Recorded: yes

### S62 START (2026-08-09 18:24) [Phase 2 P0 batch optimization]
- Branch: fix/deep-diagnosis-p0
- Source: docs/audit/deep-diagnosis-fanout-2026-08-09.md P0 x10
- Status: implementing


### S62 DONE (2026-08-09 18:35) [Phase 2 P0 batch implemented]
- **Branch:** fix/deep-diagnosis-p0
- **P0 10/10 done:** redact SoT · Cookie-only URL/image · evaluate always L2 · host_cli route · MCP selection dispatch · spawn HARD_DENY+no nest · LLM gate upload/regen+paused · BoardPanel onMessage · WS maxPayload+unauth cap · Windows SoT docs
- **Tests:** security-gates 63 pass · redact/spawn/files/apps-cli green · tsc companion+extension clean
- **Closeout:** docs/audit/deep-diagnosis-p0-optimization-closeout-2026-08-09.md
- **Not done:** commit/PR/dual review (await user)

### S63 START (2026-08-09 18:35) [Phase 2 P1 batch]
- Branch: fix/deep-diagnosis-p0
- Source: deep-diagnosis-fanout P1 x8
- Status: implementing


### S63 DONE (2026-08-09 18:42) [Phase 2 P1 batch]
- **Branch:** fix/deep-diagnosis-p0 (same as P0)
- **P1 8/8:** skill map sync · cookie contract · screenshot/selector · truncate+AbortSignal · Cockpit stop + blank SW single-flight · stream fail-closed · SSRF SoT · vault+shell/netsec bind
- **Tests:** security-gates 63 · packs 27 · extension npm test 597 pass · tsc clean
- **Closeout:** docs/audit/deep-diagnosis-p1-optimization-closeout-2026-08-09.md
- **Not done:** commit/PR

### S64 START (2026-08-09 18:45) [Phase 2 P2 batch]
- Branch: fix/deep-diagnosis-p0
- Source: deep-diagnosis-fanout P2
- Status: implementing


### S64 DONE (2026-08-09 18:49) [Phase 2 P2 batch]
- **protocol.ts** 协商 + extension/tray handshake protocol_version:1
- **WS strict** 生产默认 fail-closed；dev/test/STRICT=0 放行
- **esbuild SoT** esbuild-bundle-args.json + run-esbuild-bundle.mjs
- **engines** node>=20（root/companion/extension）
- **meeting.delete** + MAX_MEETINGS=100 cap
- **Whisper** 不伪造 pin；文档 fail-closed
- **tab-resolver** 文档化故意不接线
- **Deferred:** server.ts 神文件拆分
- **Tests:** 27 targeted pass · tsc clean
- **Closeout:** docs/audit/deep-diagnosis-p2-optimization-closeout-2026-08-09.md

### S67 (2026-08-12) [P2 deep-diagnosis batch in progress]
- Branch: `fix/p2-deep-diagnosis-batch` off main `e4de749` (#173 P0)
- P2: COMPANION_TOOLS SoT + lockstep; NotebookLM → llm.oneshot; spawn pack/intent rollback; host CU/evidence → spawnHostBin; oneshot-handler extract
- Tests: 10 P2 pass; tsc clean
- Closeout: `docs/audit/deep-diagnosis-p2-closeout-2026-08-12.md`
- Next: PR + CI + merge
- Recorded: yes

### S67 END (2026-08-12) [P2 #174 MERGED]
- **#174 MERGED** `6c93a19` — P2 deep-diagnosis: SoT tools, llm.oneshot, spawn rollback, host spawnHostBin
- CI r1 fail (empty oneshot when no key) → fix order validate-before-config → r2 green
- main tip: `6c93a19` = origin/main; deep-diagnosis P0+P1+P2 stack complete
- Residual: full god-file split; extensionConfig key dual-home cleanup; multi-OS CI smoke
- Recorded: yes

### S68 END (2026-08-12) [session-end · residual #175 MERGED · deep-diagnosis 闭环]
- **#175 MERGED** `6d7e7e8` — P2 residual: secrets dual-home gone; resolveIntegrityHostBin; mcp/user_env extract; normalize-config; smoke-os matrix
- **Full arc on main**: Precision #168–#171 · diagnosis P1#172 · P0#173 · P2#174 · residual#175
- **Open PR: 0**；main tip `6d7e7e8`
- **Experience**: oneshot validate-before-key；spawnHostBin→string；zsh `status` readonly；diagnosis 分批 PR pattern
- **下次**: 真机验收 / SEC-M* / thread·chat 续拆（非挂起 WIP）
- Recorded: yes
