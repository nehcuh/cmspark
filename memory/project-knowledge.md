# Project Knowledge

## Process Patterns

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
- **打包**：`make package-macos` 会改 `host-integrity.ts` SHA；替换 `/Applications/CMspark.app` 用 `ditto` + `xattr -cr`，先 `daemon stop` 再备份旧 app
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
