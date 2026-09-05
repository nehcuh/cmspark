# Changelog

格式大致遵循 [Keep a Changelog](https://keepachangelog.com/)。版本号与 `companion/package.json` / `chrome-extension/package.json` 对齐。

## [Unreleased]

### Fixed

- **CDP 死磕升级建议（#357）**：同一 `(thread, origin)` 上 CDP 交互失败累计 ≥4 次（跨 locator / 工具名）后，后续 CDP 调用被 site-op-memory peek 拒执，`suggested_action=escalate_to_host_computer`，错误文本建议 `host_computer`（Chrome token，**仍走 L2 确认**）或 macOS `osascript_eval`。evaluate `success:true` 且 `result:null` 视为假成功（不重置失败计数、不消耗 DOM-script budget）。不改 `classifyError`，不自动跳过 CU 确认。Round-2：`origin:unknown`/非 http(s) 不计不拦；`justBanned` 只表示 locator 2 败；共享读面 `getOriginFailCount`（#358 rebase 对齐 `originFails`）；escalate 文案含 `list_tabs` 逃生门。[#357](https://github.com/nehcuh/cmspark/issues/357)

### Added

- **Qwen3-VL 发版钉死 sha256（#359 / CU-A）**：`companion/assets/qwen-vl.manifest.json` 随 release 钉入 2b/4b/8b 每文件 name/size/sha256（权重取 HuggingFace tree `lfs.oid`；sidecar 取 huggingface.co/resolve/main 实测）。`probeQwenModelDir` 改为 config.json 存在 **且** 清单全量 size+流式 sha256（含全部 safetensors，无 stat-only 捷径）。缺文件 `model-file-missing`、哈希错 `sha256-mismatch` 拒 admission / worker load（load 前再验 TOCTOU）；失败时 `modelEnabled` 强制 false。HF / hf-mirror / ModelScope 只换 origin。2B ~4.26GB 哈希在设置/准入/load，不按点击重算。[#359](https://github.com/nehcuh/cmspark/issues/359)
- **Pack `kind: mission|expert` 字段（#367，I1）**：`pack.yaml` 新增可选 `kind`（缺省 mission，旧包兼容；validator 收录——未知 kind 值校验失败不静默丢）。**expert 为可调度的角色视图，仍非 runtime**：kind 只影响列表过滤/匹配/文案，apply/spawn 引擎对两种 kind 走同一装配路径。`pack.list` / `pack.get` 返回 kind；四个 builtin 包显式标 `kind: mission`（安装保持 force refresh）；ADR-014 加修订段、ADR-020 组合面表加 Expert view 行。禁项：pack.yaml 无 model 字段、无新顶层数据目录、Trust B 边界与 skill `sub_agent` 均未动。[#367](https://github.com/nehcuh/cmspark/issues/367)
- **浮窗会议台（#244）**：隐私「我已了解」后盖住 Capture 卡，实时转写滚动进会议台（不进草稿框）；结束 / 生成纪要 / 返回对话。`generate_minutes` 失败不写「已生成」。打开侧栏跳过 `--app` 浮窗，落普通 Chrome 窗口。**ACL 增量：零**——`append_transcript` / `generate_minutes` / list / get 等上涨发生在 [#246](https://github.com/nehcuh/cmspark/issues/246)，本票复用。本票收紧：overlay 剥 `auto_diarize`（#244 NEVER：仍扩展-only；浮窗撤「自动标说话人」）。`import_text` 仍扩展-only；overlay never Allow/Deny。[#244](https://github.com/nehcuh/cmspark/issues/244)

### Changed

- **host_read max_chars 真透传（#69 Phase 2，审计 M8 完整修复）**：read-mail / list-mail 预编译 .scpt 转 handler 形态，cmspark-host 经 'ascr'/'psbr' 子程序 Apple Event（kASSubroutineEvent）把 `--max-chars`（1-5000，匹配 zod）/ `--limit`（1-500）传入 readMail/listMail handler——脚本侧硬编码 500/100 移除（max_chars>500 不再被 500 硬截）。非法 argv typed exit 7（不静默 clamp）；TS 层 slice 保留为纵深；list-notes/list-files 不变（仍固定 top-100）。[#69](https://github.com/nehcuh/cmspark/issues/69)
- **MeetingPanel 双「收起」去重（#342）**：面板内按钮改名「结束并收起」（title/aria 同步）——它与 Host header 的「收起」语义不同（前者结束录制+收起，后者纯收起面板），不再同屏同文案。[#342](https://github.com/nehcuh/cmspark/issues/342)
- **消息行降噪（#321 PR-6）**：消息动作条（复制/编辑/分支/导出/</>接力）改 hover/focus-within 门控——隐藏态用 opacity+pointer-events（非 display:none），按钮留在 Tab 序、键盘聚焦即显整条；最后一条消息常驻。触屏/coarse pointer 每条消息保留一颗 ⋯（aria-expanded，展开同一动作组——硬验收）。四种紧凑横幅（shrink/unknown/prompt/compacted）与 ToolCallCard 内嵌指路/userHint 统一 `NoticeCard` primitive（warning token 家族；无折叠态）。ToolCallCard 纯视觉收口（radius/mono 栈进 token），cascade 逻辑零改动。红线：失败/安全披露（错误工具卡、warning userHint、SEC-C 桩提示）永不默认折叠；RunProgress 折叠语义不动。[#321](https://github.com/nehcuh/cmspark/issues/321)
- **空态与作曲同一张脸（#321 PR-4）**：CompanionMark 空态 92→48（仍是 #323 红色小牛）；招呼 22px；三条建议回到首屏折叠线以上；作曲胶囊 minHeight 72→52；用户气泡去满铺 indigo（canon 修订：浅底+细边为交付方案，左细 indigo 条为备选截图）；未武装发送 `sendDisabledBg`，武装才 indigo；L0 装配芯片降为弱样式（不删）。[#321](https://github.com/nehcuh/cmspark/issues/321)
- **Cockpit 抢焦点收敛**：非 nonce 轻量确认不再自动抢桌面焦点（侧栏 MinimalConfirm + macOS 托盘承担）；nonce/重预览级确认与 CU paused 仍自动开并聚焦；巡航/值守武装下 CU started 不再抢焦点。确认条数不变（forceConfirm 代数零 diff）。[#326](https://github.com/nehcuh/cmspark/issues/326)

### Fixed

- **list-files CJK TargetId 有损（#69 F3）**：producer 不再用 `cid mod 256` percent-encode（U+4E00「一」与 U+4F00「伀」曾撞成 `%00`）；改为输出原始 UTF-8 文件名，由既有 M2 `encodeRawTargetId` base64url 在 list 边界编码。选这条而不是在 AppleScript 里重写 UTF-8 percent-encoding：少一层易错逻辑，notes/mail producer 已是 raw。M2 codec 行为不回退。Finder `readOne` 仍是 M1 NotImplemented（Mail-only）——回读是 decode 文件名后读 `~/Documents`。[#69](https://github.com/nehcuh/cmspark/issues/69)

### Added

- **值守 grant arm/disarm 入 capability-audit（#347）**：`security.unattended.armed` / `.disarmed` / `.expired` 三事件补全审计面板可见性——config.set 双向已记（#334），grant 路径（ADR-021 进程内存值守）此前只有 logger。armed/disarmed 带来源 surface（panel/tray/summoner 归一，stampedSurface 派生），expired 记 `cruise_restored`；字段按构造 redact（无短语/token/命令文本）。bare disarm（无活跃 grant）不伪造审计行；审计写失败永不 gate 生命周期。不改 grant 语义 / TTL / 确认代数。[#347](https://github.com/nehcuh/cmspark/issues/347)

- **本线程 plan_readonly 计划模式**：`execution_policy: default | plan_readonly` 线程级执行帽，只收紧不放宽。pregate 硬拒绝白名单外一切工具（deny-by-default；MCP 全拒**无例外**——`mcp_list_resources` 曾以「只读本地缓存」放行，冷缓存实际 fall through 到 server RPC，例外已撤；`analyze_image` 因 IMAGE_FETCH 出网 phase 被拒——读像素走 `screenshot`）。与 run_progress_propose 正交，propose 不是豁免。写入只认新 WS 消息 `thread.execution_policy.set`（`user_gesture:true`；工人线程拒绝；spawn 仅在父 plan 时盖章，无章工人 gate 侧实时跟随父当前策略——中途 arm 罩住已 spawn 工人；召唤器 ACL 拒），落 `capability-audit.jsonl`。UI 另票。[#327](https://github.com/nehcuh/cmspark/issues/327)
- **Composer 巡航档位选择器**：发送键旁芯片，四槽每次确认/网页巡航/全自动巡航/全自动+协议（无值守）。显示值现场 `deriveAutopilotTier`，升档复用设置武装 sheet（短语+后果矩阵），降档一键 `disarmAllFlags`；arm/disarm 写入 `capability-audit.jsonl`。无新 config enum / TTL。[#325](https://github.com/nehcuh/cmspark/issues/325)
- **一条 Now（状态带合并）**：SceneStatusBar / RunBusyChip / WorkerScopeBar 并入 FocusBand 槽位体系（worker_scope > run_busy > L1 > scene，场景可作次行搭车）；对话上方只剩 rail + FocusBand，≤80px 不变；`buildScopedRunBusyInput` 五处推导收敛为单 hook（`use-scoped-run-busy`）；弹出对话框按钮并入 rail。旧 data-testid 挂新节点。[#321](https://github.com/nehcuh/cmspark/issues/321)
- **召唤器巡航档位只读镜像**：hydrate 下推派生 chip 文案（Swift/HTML 不解三 bool）；点击走既有「打开侧栏/确认台」深链。ACL / 确认方言 / #230 不动。[#324](https://github.com/nehcuh/cmspark/issues/324)

## [0.5.9] — 2026-09-04

0.5.8 工厂切点（512k / listen-first / zip node-first）之后的知识库波次：AI 草稿、检索/分布/开闸、多级文件夹、sha256 去重、PDF 导入修复；Windows launcher 后续。`[0.5.8]` 仍是 9-02 切点，不改历史。

### Added

- **知识 AI 草稿预填**：单篇导入两阶段 preview——先启发式草稿（含源文件 frontmatter tags），再 LLM 建议 description/tags（只填用户没改过的字段）。目录导入 / 库扫描零 LLM。[#272](https://github.com/nehcuh/cmspark/issues/272)
- **知识检索打分（Wave A）**：query-aware TF-IDF + top-k + 8000 字跨文档预算；智能匹配默认开，关掉走站点∪勾选。无 embedding / 图谱。[#273](https://github.com/nehcuh/cmspark/issues/273)
- **分布视图 + 可选簇路由（Wave B）**：自动分组 chips（「自动分组，不准就移到文件夹。」）；「按堆选文」默认关。[#273](https://github.com/nehcuh/cmspark/issues/273)
- **认证簇路由分支开闸**：eval 双列通过后工厂常量打开；用户开关仍默认关——开闸 ≠ 替用户打开。[#280](https://github.com/nehcuh/cmspark/issues/280)
- **多级文件夹**：最多 3 层，磁盘目录为 SoT（Obsidian 可读）；`knowledge.move` 保 pin。[#274](https://github.com/nehcuh/cmspark/issues/274)
- **完全重复导入**：正文 sha256（不是 MD5）；预览标 `duplicate_of`，目录导入跳过重复。[#281](https://github.com/nehcuh/cmspark/issues/281)
- **内置技能 `cmspark-macos-app-replace`**：DMG 换装 playbook（禁 `xattr -cr` / `pgrep -f` 坑）。

### Fixed

- **darwin host jsonEscape 覆盖全部 C0（#69 F1）**：`host.swift` runReadMessage 与 `read-mail.applescript` 的 jsonEscape handler 除补 `\b`（char id 8）/ `\f`（char id 12）分支外，新增逐字符白名单 pass——其余 C0（0x00-0x07 如 BEL、0x0B、0x0E-0x1F）统一 `\u00XX` 编码。此前含此类 C0 控制字符的邮件产生非法 JSON（TS `parseJsonSafe` fail-closed 致该邮件不可读）；现全 C0（0x00-0x1F）+ `"` `\\` 均可 JSON.parse 往返。两处 handler 保持逐字节等价（源码级 lockstep 测试钉死）。另修 host.swift 嵌入层 M3 潜伏转义 bug：换 `\"` 步骤 Swift 源层缺引号转义（会导致含引号邮件的 jsonEscape AppleScript 编译失败）——Swift 剥层后与 read-mail 逐行等价 + osascript 实跑对拍 IDENTICAL。
- **darwin host-bin resolver 路径数学（#69 F2）**：候选列表删除永不命中的 `dist/dist` 死路径（`../../dist`），dev-mode fallback 由 `__dirname/../../dist` 改为 `../../../dist`——host-bin.ts 恒在 companion root 下 3 层，该路径在编译与 dev-src 两态都正确解析到 `companion/dist/cmspark-host`。真实目录结构测试断言无死路径、dist 可达。
- **PDF 导入**：整文件 `readAsDataURL` 编码（与对话框附件同路），修 chunked `btoa` 导致 >32KiB PDF 损坏。[#282](https://github.com/nehcuh/cmspark/issues/282)
- **Windows launcher**：VBS 递归建 `logs` 目录（干净配置不再卡错误对话框）；`launch.bat` SEA echo 括号转义；无 bundled node 时探测系统 node 并给出诚实报错；CI `windows-latest` launcher smoke（S1–S9）。[#279](https://github.com/nehcuh/cmspark/issues/279)
- **知识预览失败可见**：解析失败不再永远「正在解析…」；可「跳过解析，手动填写」。（#270 / #271）
- **shrink 横幅三态**：旧 companion 省略 `shrunk` 时走 unknown 分支，不再谎称「仅提示/未压缩」。
- **LLM `complete()` recap**：对齐 `streamChat` 预算；overflow 半窗重试一次，避免原样重发。
- **依赖**：`npm audit fix` 清掉 fast-uri high advisory（CI 门禁恢复绿）。

### Known residuals

- T1 已记分；[#228](https://github.com/nehcuh/cmspark/issues/228) 已关。**仍禁止**扩默认 outbound profile。

## [0.5.8] — 2026-09-02

工厂默认 `context_window` 512000；过小磁盘运行时按 128000 且不写盘；官方 zip node-first；Companion listen 不再等 MCP start。[#268](https://github.com/nehcuh/cmspark/issues/268)

### Changed

- **`context_window` 工厂默认 512000**：新装 Agent 工作预算，不是供应商窗口承诺。磁盘过小（`< 16000` / 非正）本轮按 **128000** 做预算，**不写** `config.json`。shrink 不再切出半截 JSON（`{"succes…`）。设置页 Save 在 companion `config.updated` 水合前禁用。shrink-only 横幅不再谎称「仅提示未压缩」。512k 默认**不是**对已有 4000 磁盘文件的修复。
- **F1 文案诚实**：活切点不再保证聊天列总有「本轮步骤」清单——页面工具前必须 propose；成功后才挂卡；模型放弃 / 纯问答则无卡。
- **F2 官方 zip 启动器**：`launch.bat` / `launch-hidden.vbs` 优先 `node.exe`+`cmspark-agent.js`，leftover SEA `cmspark-agent.exe` 垫底。
- **F3 listen-first**：23401 不再等 MCP start；本轮未提供的 `mcp__*` 拒执行（`tool_not_offered`）。

### Known residuals

- `createToolExecutor` 未串 offered-catalog（LLM 路径已由 adapter 包一层）；tray settings-web 无三档过小窗口文案；Windows `0o600` 测试在 NTFS 上失败（预置）。

## [0.5.7] — 2026-09-01

当轮活计划：侧栏本则消息里页面工具前必须 `run_progress_propose`；shell allowlist W1e fail-closed；`run_progress` sticky-clear。文档活切点与包装 lockstep。

### Added

- **当轮活计划**：页面工具前必须 `run_progress_propose`；成功后才挂「本轮步骤」卡（不必等 H1）。模型放弃 / 纯问答则无卡。[#265](https://github.com/nehcuh/cmspark/issues/265) / [#266](https://github.com/nehcuh/cmspark/pull/266)

### Security

- **shell allowlist W1e（quote/join fail-closed）**：0.5.4 闭合的是执行旗标 *变体*（pwsh 前缀、`/c`、`=`、`.exe`、node `-p` 等），不是「判定 tokenizer ≠ `spawn({shell:true})` 引号语法」。本次：POSIX 相邻引号拼接（`"-"c` → `-c`）；旗标比对前去掉空引号并认 unquoted `\`；`tokenizeSimpleArgv` 失败改为 deny（删除空白 fallback 放行）。`policy=allowlist` + 裸解释器条目下，`bash '-c' … '*'`、`bash -""c`、`bash "-"c … X=1` 不再匹配。默认 `confirm_per_command` + L2 不变（非社区默认 RCE）。含 `*`/`?` 的 allowlist 命令（即便在引号内）改为 matcher deny；词中未闭合撇号（`echo don't`）同样 tokenize-null deny——需要 glob/query/撇号字面量的操作者用 `confirm_per_command`。

### Fixed

- **`run_progress` adapter 三态**：显式 `null`（sticky clear）不再被 tool_result 成功路径 `!th.run_progress` 当成未播种而重新 seed。抽出 `nextRunProgressAfterToolSuccess`；toggle 对 `null` 不再 `?? { items: [] }` 写成空对象。无生产写入方（潜伏契约）。
- **语音回退横幅 CTA**：本机模型未就绪改用浏览器听写时，横幅带「去设置」（`local_fallback`，不复用 fail-closed 的 `model_missing`）；听写结束后仍保留直到关掉或下次开始。
- **Whisper 下载失败**：`get_state` 带回 `lastDownloadError`；打开设置不再先清空错误位；文案指向模型下载源（hf-mirror）。
- **会议自动 K**：`meeting.diarized` 回显 `K=N`，下拉同步 2–4。

### Known residuals

- 位置参数 `bash evil.sh` / GTFOBins；`$VAR` + 残留 `shell:true`；win32 `cmd.exe` 引号语法；cwd 依赖的 `bash -[c]` pathname glob；macOS bashism `-{c,}`。

## [0.5.6] — 2026-08-31

召唤器 HTML 流式出字、本机 Whisper 自动激活 / 可见回退 / HF 镜像、会议说话人「自动」档。文档活切点与包装 lockstep。

### Added

- **召唤器 HTML 卡流式出字**：Windows HTML shell 跟 `chat.token` 累积快照逐 token 渲染（此前只在 assistant 轮末整表 refetch）。Swift overlay 本已流式，未改。
- **本机 Whisper 下载完成自动激活** `localModelId`（不改 `sttEngine`）；`get_state` 自动修正失效的 active 模型。
- **本机模型不可用时当次会话回退浏览器听写**：`voice.autoFallbackToBrowser`（默认 true）显示可见横幅（含云残留），非静默、不改配置。ADR-023 L13 2026-08-31 修订为禁止**静默**回落。
- **模型下载源镜像**：`voice.modelDownloadEndpoint` / `CMSPARK_HF_ENDPOINT`（仅重写 huggingface.co 主机，https fail-closed；sha256/size pin 不变）。
- **会议说话人人数「自动」档**：silhouette 选 K（`meanSilhouette` / `selectBestK`）；UI 默认「自动」。仍是 3 维特征近似，experimental。

### Documented

- **补记**：`cmspark-agent outbound-grant` 对未知 flag 失败且不签发（[#235](https://github.com/nehcuh/cmspark/issues/235)）。0.5.3 Honesty 段仍描述当时切点，不改历史。

### Known residuals

- 语音 UX Hex 式 [#258](https://github.com/nehcuh/cmspark/issues/258) · Windows SAPI 兜底 [#259](https://github.com/nehcuh/cmspark/issues/259) · speaker embedding diarize [#260](https://github.com/nehcuh/cmspark/issues/260)。
- [#230](https://github.com/nehcuh/cmspark/issues/230) 仍冻 F-S-10 / overlay-acl；grant-cli 未知 flag 与 H1 `{text,tool}` 精确勾已不在该冻清单。
- T1 已记分（CMspark 臂 Y / Playwright `ERR_EMPTY_RESPONSE`）；[#228](https://github.com/nehcuh/cmspark/issues/228) 已关。**仍禁止**扩默认 outbound profile。

## [0.5.5] — 2026-08-29

侧栏对落盘脱敏桩的友好渲染（SEC-C 脱敏的 UX 补缺；两路对抗评审 + grok 复核 SHIPPABLE）。

### Fixed

- **重载对话后工具结果不再显示原始桩 JSON**：敏感工具（evaluate/shell/host_*/workspace_*/部分 MCP）落盘脱敏桩（`{redacted:true,len,sha256}`）改渲染友好提示——「出于安全未持久化：原始长度 · sha256。实时轮次中内容对模型与界面可见（超长会截断），重新加载后不再保留」；失败桩追加「该调用当时已失败」。
- 同步门控三个会露出占位符的分支：shell 命令条（`<redacted:hash=…>`）、host_computer 空任务卡（「?/? 步」）、tool 消息气泡正文（桩 JSON markdown）。
- 判定下沉为纯函数（`redacted-stub-utils.ts`：`extractRedactedStub` / `isRedactedStubContent`），13 用例钉住 A/B 形状、失败桩、len 边界、误伤面。
- 版本字面量补齐 lockstep：index.ts 横幅 / ACP clientInfo / outbound serverInfo 三处硬编码版本（0.5.3 bump 时的历史遗漏）纳入 `version-lockstep` 测试。

### Known residuals（下轮，grok 复核记录）

- 复制 / `</>` 编程接力仍输出桩 JSON；generic/MCP 深键嵌套叶桩仍在 JSON 预览中原样显示；plainError（INTERRUPTED）shell 行的命令条占位符未门控；脱敏范围讨论见 [#255](https://github.com/nehcuh/cmspark/issues/255)。

## [0.5.4] — 2026-08-29

四路独立对抗评审 + grok 多路验证驱动的修复批次（spec/plan：`docs/superpowers/specs|plans/2026-08-29-post-review-adversarial-fixes.md`）。全部为已有行为 bugfix，无新需求。

### Security

- **shell allowlist 回归闭环**：裸 shell 家族条目（`sh/bash/zsh/pwsh/powershell/deno/bun/cmd`）的执行旗标恢复拒绝——`-c`/`-Command`/`-EncodedCommand`/`eval`/`-p`/`--print`/`-r` 等，含 PowerShell 唯一前缀（`-com`/`-enc`）、斜杠形式（`/c`）、`=` 粘连、`.exe` 基名归一、大小写变体；tokenized 与 fallback 统一复用同一判定函数。`grep -c`、`bash -e/-eu`（errexit）、`ruby -r` 等合法形态不误伤。位置参数与 GTFOBins 类在代码注释声明为设计边界（旗标 deny 是纵深，L2 确认才是门）。
- **外泄授权 per-key**：HTTP 轨按认证 grant 自身 `allow_page_export` 判定，同 caller 的 sibling 带旗钥匙不再放行无旗 token（`grantAllowsPageExportById`）；stdio 轨保持 caller 级并注释文档化双轨。与 grant-cli「这把钥匙」承诺及 TROUBLESHOOTING 对齐。
- **打开侧栏结果帧**：仅 panel/extension 来源可裁决（origin 绑定），settle 单漏斗先到先赢。
- **外发 HITL 断连**：操作员批准时调用方已断连则不再执行工具，审计记 `CALLER_DISCONNECTED`（与已执行明确区分）。

### Fixed

- **「打开侧栏」假成功**：`sidePanel.open()` 在无手势上下文必失败却回报成功。改为真结果回传（关联 id broadcast + 结果帧 validator + 6s 超时），失败/超时 overlay 如实显示「请点工具栏」。
- overlay 附件发送成功后清空 file input，旧附件不再随后续消息重复发送。
- **SSE 瞬断不再即杀会议/听写**：最后 SSE 断开改 8s 重连宽限（重连取消）；热键关窗不再同步释放 composer 租约（关窗后 1s 短宽限 + 8s 硬兜底）；Windows 关窗保存 spawn PID 直接 `process.kill`（原 `ps` 路径 win32 恒 no-op，窗口假活撞 `OVERLAY_STANDBY`）。
- `run_progress` 显式清除（null）持久生效：仅 `undefined` 才从 handoff 初始播种，`get()` 读路径同修；无关 update 不再重播种。
- `thread.updated` 双发去除（broadcast 已覆盖扩展端）；`llmLoopOwnerPanel` 在 chat.create/file.upload/regenerate 三路所有出口对称清理。
- Swift overlay `confirmPending` 六处复位（hydrate-attach / token 恢复 / done / 新线程 / 换线程 / 终态错误），HUD CTA 不再永远粘在「需要确认」。

### Tests

- #252 握手 terminate、#250 WS fanout 改行为级集成测试（替代源码 grep 假防线）；`ui.open_sidepanel` 双端 lockstep 测试。

### Known residuals（下轮）

- `stopSummonerWebServer` 丢 PID 不杀进程；overlay SSE 收不到 slash-pin 的 `thread.updated`；hydrate-detached 换线程 CTA；win32 不扫进程树；`chat.aborted` 不在 summoner 映射；`thread.digest_updated` 同款双发（`message-router.ts:678`）。
- 协议版本未 bump（MIN=MAX=1 期间语义变更靠同步发版，#252 起）；`mcp.toggle_server` WS ACL 残留属 #230。

## [0.5.3] — 2026-08-27

0.5.2（Windows 官方 NSIS）之上的产品切点：**知识 CRUD 诚实** + **形态切片 1–3 / 5 / 6**。这不是召唤器或租手「做完」的里程碑——T1 真人 bake-off 仍待（[#228](https://github.com/nehcuh/cmspark/issues/228)）。

### Added

- **知识诚实（#222 / #223 / #226）**：Side Panel 可点开正文、确认后保存、下载 `.md`、related≤3 芯片。图谱 / 双链 / Project / 默认 embedding 本季不做。
- **租手钥匙 + L8（切片 1–2，#226）**：`cmspark-agent outbound-grant` 签发 `cmg_`（不打开侧栏设置）；空 grant 默认 `GRANT_REQUIRED`；首次外泄走确认台 / Mac 托盘。`require_grant` 仍默认 true。overlay **永不** Allow/Deny。
- **召唤器诚实文案（切片 3，#226）**：默认收起条；「展开对话 / 打开浏览器 / 打开确认台」；MCP 轨藏而不删。禁止「展开工作台」「去侧栏批准」。
- **侧栏空态看山（切片 5）**：CompanionMark + 22px 招呼 + 句子邀请 + 作曲区。
- **匹配诚实 + 本轮步骤（切片 6，#227）**：技能匹配补 IDF（仅 skills；knowledge related 与 Obsidian 仍 TF）；聊天列 L0「本轮步骤」种子来自 H1 handoff todos。**v1 勾选基本只能点**（seed 行常无 `tool`，见 [#230](https://github.com/nehcuh/cmspark/issues/230)）。

### Changed

- 产品句锁定：家 = **已登录 Chrome + 硬闸**（[PRODUCT.md](PRODUCT.md) / [GOAL.md](docs/GOAL.md)）。侧栏是 Operate 面之一，不是家。
- **需求设计 Issue-first**：新需求必须先建 GitHub Issue，再写 spec/plan。模板：[`.github/ISSUE_TEMPLATE/design.md`](.github/ISSUE_TEMPLATE/design.md)。本季余项：[#228](https://github.com/nehcuh/cmspark/issues/228) T1 · [#229](https://github.com/nehcuh/cmspark/issues/229) 召唤器 P2 · [#230](https://github.com/nehcuh/cmspark/issues/230) 残留。

### Fixed

- Windows：`launch-hidden.vbs` 设 `NODE_PATH`，打包后 systray2 能解析（#224）。
- Overlay：合并冲掉的 paper HUD / I1/I2 恢复（#225）。

### Honesty / not in this cut

- T1 真人 bake-off **未跑**；不得扩默认 outbound profile，不得对外声称护城河。
- F-S-10（trusted/cruise 下 `mcp__*` 可能不弹确认）本季不修完；禁止用 overlay 管 MCP 掩盖。
- `outbound-grant` 对未知 flag 仍静默忽略。

## [0.5.2] — 2026-08-20

### Packaging

- **Windows 官方安装器**：GitHub Release 在 `cmspark-v*-windows-x64.zip` 之外增加 `CMspark-Setup-v*.exe`（NSIS）。安装器包装与 zip **同一份** `package.sh` staging（`node.exe` + `cmspark-agent.js` + 扩展），每用户装到 `%LOCALAPPDATA%\CMspark`，HKCU 开机自启 + ARP 卸载。CI 钉 Chocolatey `nsis` **3.12.0**，`CMSPARK_REQUIRE_NSIS=1`：缺 makensis **失败**，不静默只发 zip。SEA（`build-windows-exe.ps1`）不再产出官方同名 Setup.exe。产物未 Authenticode 签名（REL-1），SmartScreen 会警告。见 [#204](https://github.com/nehcuh/cmspark/pull/204)。

## [0.5.1] — 2026-08-18

### Added

- **对话框用户附图**：Side Panel 可粘贴 / 点选 / 拖入 PNG·JPEG·GIF·WebP。线程生效主模型 `likelyMultimodal` 时原生看图，否则走视觉轨；工具截图 / PDF 内嵌图仍走视觉轨。
- 附件芯片、48px 对话缩略图、首次发送目的地主机提示；sidecar 落盘（0o600/0o700 + realpath）；WS 帧 10MiB−256KiB 拒发。

### Security / Trust (already on main since 0.5.0; recorded at 0.5.1 cut)

- **C1** 无人值守 dual-write：武装前快照三旗；解除/TTL 过期**始终**恢复快照（不再仅 `clear_cruise`）
- **C2/C3** 急停 ≠ 解除：值守仍开 banner；确认台空桌面常驻「值守中：桌面确认已静默」
- **C4** 后果矩阵拆分 evaluate vs 导航；默认值守不 waive evaluate forceConfirm
- **C5** Pack Trust `skip_l2`/三旗需 Settings 同款短语 step-up（服务端拒绝 + PacksPanel）
- **C6** Worker `WORKER_HARD_DENY` 运行时 `isToolAllowed` 再强制；`thread.update` 不可开全表面
- **C7/C8** shell cwd / netsec ports L2 bind 与 execute 预规范化一致
- **C12** security-gates 去掉 `force_confirm` 假绿断言
- **C9** CI lockstep：`ws-router-validator-lockstep` 测试
- **C11** UI `SURFACE_BY_TOOL` 表（含 shell_exec / netsec / scroll_to / upload_file）
- **C13–C16** SoT/文档诚实：SUPERSEDED Aug-02 设计；mcp.md `require_grant` 默认 true；CU Apps 坐标开关 0.5.0；ADR-021 residual windowLevel hard

### Also on tip since 0.5.0 (recorded at 0.5.1 cut)

- **#160** 无人值守 re-L2 静默（ADR-021 2026-08-09 修订）
- **#161** Windows voice/shell closeout（shell/netsec token binding 对齐）
- 会议用户指南：STT `resource_conflict` 恢复说明 + 纪要模板用法（§3.5–3.6）
- 会议 **P1 近实时**（默认渐进假设 + ~8s 定稿）与 **P2 长会**（直播/上传硬上限 3h、软提示 2h；纪要输入 20 万字）

### Fixed

- Windows：外部编程 Agent（ACP）启动不再命中 npm 的 Unix shebang 垫片（`spawn ENOENT`），也不再对 `.cmd` 直接 CreateProcess（`EINVAL`）。发现优先 `.exe`/`.cmd`，并把 Claude/Pi 等 shim 解包为 PE / `node script.js`。
- Windows Mode C / wrapViaCmd 共识 R1–R5：禁止 WindowsApps `wt.exe` 假 L1；`auto` 先 `start` 失败可 L0；`cmd /c` 剥离 `-p`/prompt；cmd-host 只走 L0；粘贴行带 `Get-Content` 任务文件。
- Windows ACP P2（R6–R14）：临时文件 `wx`+延迟删除；`start` 全 token 引号；`System32\taskkill.exe`；拒绝用 companion PE 当 node；unwrap `%~dp0`；`joinDp0` 反斜杠；spawn 接线锁；设置补 WT/cmd；空列表说明 shebang 垫片。
- Windows Mode C post-#191：`start` 走 `cmd /d /s /c` extra-quote + `windowsVerbatimArguments`（不再被 CRT 改写成 `\"`）；真 PE `wt.exe` 的 exit 0 视为 CLI 交班成功；`cmd`/`powershell` 钉 System32；成功时间线用实际打开的 app，不用 config pref。

### Packaging

- `run-esbuild-bundle.mjs` 直接 spawn esbuild 原生二进制（避免 node 解析 Mach-O）

## [0.5.0] — 2026-08-08

### 稳定切点

听写 / 会议 / 本机 STT 产品线合入并文档化；Computer Use 实验定位仅保留 **Qwen3-VL**；macOS DMG 可打包安装。

### Added

- **听写+ D2**：按住热键；设置中 **按键盘录制** 组合键；文字/语音改设置命令条  
- **实时出字**：浏览器 Web Speech interim；本机 Whisper **M2 渐进假设流**（PCM 流式 + `voice.stt.partial_request`，约 8s 窗定稿）  
- **会议**：装配 › 场景 › 会议 工作台入口；Mtg0–3（粘贴/本机录/上传/实验发言人N）  
- ADR-023 / ADR-024 与用户指南 [meeting-and-dictation-user-guide](docs/meeting-and-dictation-user-guide.md)

### Removed

- **TinyClick / Florence-2 ONNX** 全栈与 `onnxruntime-node`、CI vendor 校验（PR #151）  
- 实验桌面定位统一为 **Qwen3-VL**

### Changed

- 产品版本 **0.4.0 → 0.5.0**
- 文档导航、GOAL G22、architecture §9 与 README 能力表同步  

### Security / Trust

- 本机 STT 仍走 chrome-extension origin fence；partial 失败 soft-skip 不杀 live 会话  
- Pack 仍不得写 voice / hotkey / ack  

## [0.4.0] — 2026-08

### Added / shipped under 0.4.x

- Multi-agent · Mission Board · Pack / 企业模块  
- Computer Use / Host / Apps · Confirm Center · Outbound MCP 骨架  
- Qwen3-VL 实验定位层  
- 听写 M1 + Path B 本机 STT 初版 · Dictation+ D1 · 会议 Mtg 初版（后续并入 0.5.0 文档）  

## [0.3.0] — 2026-07

- MCP · Mission Pack · Computer Use / Host 主路径 · Multi-agent P0  

---

链接：

- [docs/README.md](docs/README.md)  
- [GOAL.md](docs/GOAL.md)  
