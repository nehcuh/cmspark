# CMspark「App 页签」功能设计草案（design-only）

> **Branch**: `computer-use-w8-windows` · **性质**: 只读规划，无代码变更 · **日期**: 2026-07-18
> **输入**: owner 意图（独立 App tab：preset + 用户白名单 apps，三档 per-app policy；CLI-for-AI 独立 track）
> **状态**: 待对抗审查 → owner 决策（§10 开放问题）

## 1. UX 与面板模型

- Tab 挂载：`BottomBar.tsx` tabs 数组新增 `{ id: "apps", label: "App" }`；点开时发 `apps.list` WS 消息（镜像 `mcp.list` 先例）。新增 `AppsPanel.tsx`，布局 1:1 镜像 `McpPanel.tsx`：全局 kill-switch → segment 选择器 → app 卡片列表 → `+ 添加应用`。
- **双 segment**：A「应用」(GUI：preset 区在上可禁用不可删，用户白名单区在下；卡片带 policy 三色徽标 `全自动(红)/AI 判断(黄)/每次确认(绿)`) ；B「CLI 工具」（⌨️ 徽标 + subcommand 计数，P2 前占位）。
- **Add-app 流程**：Chrome file picker 拿不到完整路径，排除。改为 companion 端 PS 枚举脚本（复用 argv-only 基建）汇总：① 运行中的 GUI 进程（MainWindowTitle + Path）；② `Get-StartApps`（PS 5.1 内置，同时覆盖 win32 Start Menu 与 UWP AUMID）；③ 注册表 Uninstall 键补充。面板可搜索列表 → 用户点选 → 服务端解析持久化绝对路径或 AUMID。兜底：手动粘贴路径（服务端校验）。
- **UWP**：启动经 `explorer.exe shell:AppsFolder\<AUMID>`，调用方无需签名/package identity；代价：无 pid，结果诚实标注「已请求启动」。
- **Edit/remove**：policy 降级自由，升级（→auto）需重新确认；删除立即生效并清 thread-trust。
- **Recommendation:** 单面板双 segment；add 走 PS 枚举 + 点选；preset 区 P1 只做 2-3 个「检测到已安装才显示」的硬编码条目，不做远程 gallery。

## 2. Policy 模型（三档映射现有安全栈）

现有 tier：silent / L2 ask（`security-confirmation.ts:136`）/ thread-trust（read-only 锁定）/ biometric（Hello + manual-nonce）/ never-auto floor（CRITICAL_API_GATE、vault blacklist、writes 必 biometric）。

- **(a) 允许所有操作 → `policy:"auto"`**：跳过 L2（等价 per-app 版 `auto_approved_apps`，W7 Q5 已预留先例），审计 `security.auto_approved {reason:"app_whitelist"}`；**不绕过 never-auto floor**：manifest 声明 `dangerous` 的 op 仍走 biometric（god-mode vs CRITICAL_API_GATE 同构）。UI 标签诚实：「全自动（危险操作仍需 Hello 验证）」。
- **(b) AI 判断 → `policy:"ai"`**：风险分级 100% 来自 manifest 的 op 声明，**LLM 永不自分级**（MCP §6.3 declared-capability 优先哲学）：read-only → silent+审计；state-changing → L2；dangerous → biometric。
- **(c) 手工确认 → `policy:"manual"`**：一切 op（含 launch）→ L2；dangerous → L2 + biometric 串联。
- **Tier 缺口**：无新 tier 需建；唯一新机制是 `getAppPolicy(token)` 查询 + skip-L2 分支（插入点 `server.ts` skipConfirmation 计算处）。可选 stretch：ThreadApprovals kind 泛化到 `"app-launch"`。
- **Recommendation:** 三档 = auto（skip L2 保 floor）/ ai（manifest 声明分级）/ manual（全 L2 + dangerous 加 biometric）；禁止 LLM 自分级。

## 3. 操作分层（Operation taxonomy）

| Tier | 名称 | 语义 | Phase |
|---|---|---|---|
| L0 | `launch` | 拉起 exe/AUMID，无参数或固定参数 | P1 |
| L1 | `run_template` | add 时声明参数模板 `{name, argv, slots:[{name,kind,validate_regex,required}]}`，LLM 只填 slot 且过正则；每模板带 `risk` 声明 | P1 |
| L2 | free-args | LLM 自由拼 argv | **不做（P3 再议）** |
| L3 | structured CLI contract | manifest 声明 subcommand/flag 白名单 + typed params + output capture | P2 |
| L4 | app-specific data API | SMTC、COM 等 typed adapter | P3 |

`dangerous` 模板即使在 auto policy 下也走 biometric（floor）。模板目标禁止 `.bat/.cmd`（解释器二次解析面）。

## 4. CLI-for-AI track（structured-CLI contract）

- **Manifest**：`schema_version`、`exe{resolution:"absolute", path, sha256?}`、`subcommands:[{name, description, risk, flags:[{name,takes_value,value_regex}], positional, timeout_ms, max_output_bytes}]`、`defaults{timeout_ms:15000, max_output_bytes:65536, cwd:"%USERPROFILE%"}`。
- **执行规则**：exe 绝对路径落盘（PATH-hijack 免疫，resolvePowerShellExe 先例）+ 执行前 realpath 复检；argv-only execFile（无 shell、无插值）；cwd pinning（LLM 不可指定）；**env 白名单**（PATH/SystemRoot/USERPROFILE/TEMP 等约 10 项，排除 `*_API_KEY`/`*_TOKEN`/`CMSPARK_*`——companion env 含 DEEPSEEK_API_KEY）；超时默认 15s 硬上限 120s（dangerous 不可调）。
- **输出注入防御（CRITICAL）**：CLI stdout 是 attacker-influenceable 文本（=网页 DOM 同级威胁）。防线：① strip ANSI/control sequences；② `PAGE_CONTENT_TOOLS` 加入 `host_cli`（或扩 source 词汇 `"cli"`）使 `wrapUntrusted()` page 级标注生效（`llm/text-sanitize.ts`、`llm/adapter.ts:803`，Rule 11 模型级软约束）；③ 保持「先截断后包裹」顺序：spawn maxBuffer 256KB kill → 截 8000 chars → wrap。
- **exit/crash**：非零 exit → typed error（recoverable-loop guard 防重试循环）。

## 5. 命名与语法

- GUI：`win.app.<slug>`；CLI：`win.cli.<slug>`（policy/审计按前缀分流）；slug 正则 `^[a-z0-9][a-z0-9_\-]{1,31}$`。
- LLM 语法：**两个 generic tool**（绝不做 per-app tools——gate 枚举成本 + context 成本 + policy 落点）：
  - `host_app { app, action: "launch"|"run_template", template?, params? }`（P1）
  - `host_cli { app, subcommand, flags?, args? }`（P2）
- Token binding：`SecurityPolicy.bindingPayloadFor` 单点扩展（host_app → app|action|template|canonical(params)；host_cli → app|subcommand|canonical(flags,args)）。
- App 发现：不开 list 工具，用 **system prompt 索引注入**（镜像 MCP "auto" 模式）：Rule 12 后追加 app 段（token + display_name + templates + risk 标注，上限 20 条），保留「首次每线程先问用户」「NEVER speculative」verbatim。

## 6. 存储与同步

- companion `config.json`（0o600 + atomicWriteJSON）新增顶层 `apps` 块，逐行镜像 `mcp` 块；extension 只是 view（WS 拉取）。
- AppEntry：`{token, kind:"gui"|"cli", display_name, source:"preset"|"user", policy, enabled, added_at, exe?:{path, sha256?, signer?, user_writable_dir}, aumid?, templates?, cli_manifest?}`。
- 校验：`validateAppEntry()` 镜像 `validateMcpServerConfig` + prototype-pollution key 检查 + wholesale-swap 写路径。
- 篡改语义：config 直改 = ADR-010 opt-in 先例；未知 policy 值 → 降 `manual` + loud log；schema 失败 → entry disabled 不拖垮整体。
- **Binary drift**：sha256 pin 或 signer 变化 → 临时降 `manual` + 审计 `apps.binary_drift`，面板 re-approve 后恢复。
- **Import/export**：导入 entry 一律以 `manual` 落盘（policy 信任必须在面板内重新做出，skill.import 先例）。

## 7. 威胁模型（核心）

1. **Tier-collapse via add（#1 威胁）**：把 powershell/cmd/wscript/mshta/rundll32/regsvr32/wmic/wsl/bash 等 lolbin 加为 auto app = silent 任意命令执行。防线：**add 时 lolbin blocklist（按 exe basename，与路径无关）+ 禁止 companion 自身 exe**；blocklist 与 policy 无关、不可覆盖（vault blacklist 哲学）。
2. **路径校验**：绝对路径 → resolve → realpath 双校验（A2 边界公式）；必须 `.exe` 或 AUMID；`.lnk` 经 WScript.Shell 解出目标后只存目标；user-writable 目录允许但黄色徽标「同用户进程可替换此文件」；add 时 `Get-AuthenticodeSignature` 记录 signer，unsigned 警告不拦截（strict mode 留 §10）。
3. **模板注入**：固定模板 + `{slot}` 占位 + per-slot 正则 + argv-only + 无 shell。
4. **Free-args**：P1/P2 不存在，威胁面为零。
5. **LLM-driven add-app（必须永不可能）三道防线**：① LLM 无任何 app 管理 tool；② `apps.add` 是 WS 消息非 tool，tool call 触达不到；③ `apps.add`/`apps.remove`/policy 升 auto 的 WS handler 内部**强制 L2 confirmation（originWs 绑定）**，持久化在 approval 之后。policy 降级/禁用不需 confirm。
6. **CLI 输出注入**：见 §4（结构防线 + 软约束，明示残余）。
7. **输出炸弹**：maxBuffer 256KB kill → 8000 chars → wrap，双层。
8. **Exit/crash**：GUI launch 3s 内即退 → 诚实标注「已启动但随即退出」。
9. **UWP/win32 分歧**：UWP 无 pid（explorer 代拉）；policy 强制在 token 层两路径一致。
10. **Per-app 审计**：`apps.launch`/`apps.template_run`/`cli.exec {token, action, params_hash, policy, tier_used, confirmation_id?, biometric_method?, exit_code?, duration_ms}`；history redaction 沿用 SENSITIVE_CODE_TOOLS 家族。

## 8. MCP 边界规则

**一句话：存在维护中的、覆盖目标能力的 MCP server → 一律走 MCP；App CLI 只承接「无 MCP 覆盖 且 子命令/flag 契约可声明式表达」的工具。**
三判定轴：契约丰富度（MCP typed tools vs 静态 manifest）、生命周期（长驻进程 vs 一次性 spawn）、信任面（不重叠审批，同一 capability 禁止双轨暴露，面板做重复检测提示）。
实例：gh → GitHub MCP 优先，App CLI 只补长尾；ffmpeg/yt-dlp/es → App CLI；docker → Docker MCP 优先；code → App GUI/L1 模板。

## 9. Phasing

- **P1（spine，不可再裁）**：App tab(Segment A) + 用户白名单 + preset 2-3 检测式条目 + L0 launch + L1 templates + 三档 policy + **§7 安全三件套（lolbin blocklist / 路径校验 / add-confirm，上提为 P1 必须项）** + per-app 审计 + system prompt 索引注入。owner 动机（启动网易云）P1 即满足。
- **P2**：CLI track 完整（manifest、output capture、ANSI strip + untrusted 标注、env 白名单、cwd pinning）+ import/export + sha256 drift re-confirm + Segment B。
- **P3**：SMTC 媒体控制（未签名 WinRT 可达，强开源实证；需交互式会话，companion 满足；P3 前真机跑 PS WinRT probe）+ UWP 枚举/launch + preset gallery 扩充。
- **Stretch（建议提前到 P1）**：thread-trust 泛化到 launch/可逆 op——没有它「AI 判断」模式体验是每 op 一弹窗。

## 10. 待 owner 决策的开放问题

1. `auto` 档是否允许绕过 biometric floor？（本设计：不允许。备选：真·零确认 + god-mode 式确认短语）
2. Free-args 是否永久禁止？（本设计：P1/P2 不做。备选：biometric per call + manifest `allow_free_args:true` 双开关）
3. `AI 判断` 的风险分级是否 100% 来自 manifest 声明？（本设计：是。备选：LLM 提议 + companion 取 fail-safe union）
4. Preset gallery 维护方式？（本设计：硬编码随版本发布，拒绝远程清单的供应链面）
5. user-writable 目录的 exe 是否一律允许添加？（本设计：允许 + 黄标 + 可选 sha256 pin。备选 strict mode：仅 Program Files 可设 auto）
6. CLI 输出/超时默认值？（建议 64KB/15s，上限 256KB/120s）
7. 子进程 env 白名单清单是否批准？（明确排除 `*_API_KEY`/`*_TOKEN`/`CMSPARK_*`）
8. 未签名 exe 的处置？（add 时警告放行 vs strict mode 禁止）

## Suggested adversary questions

1. **Lolbin blocklist 完备性**：msbuild/forfiles/explorer(`shell:` 协议)/control.exe/任意 python.exe/node.exe 呢？是否应改结构性规则——**auto 仅对 L0 无参 launch 生效，凡带参数的 op 在 auto 下也强制 L2**？
2. **模板 slot 解析怪癖**：目标程序自身解析（`"` 闭合引号、`--opt=val` 合并、`@file` 响应文件）能否被 slot 正则完备约束？是否应强制字符集白名单而非黑名单？
3. **Renderer 被攻陷时 add-confirm 效力**：compromised renderer 本来就能替用户点确认；「新增 auto app」不可逆度更高，是否应要求 **biometric** 而非 L2？
4. **sha256 drift 的 TOCTOU 与性能**：每次 exec 前 hash 100MB+ exe 不可行；mtime+size 快路径 + 周期全量 hash 的窗口能否被利用？或只对 auto app 每次 hash？
5. **CLI 输出二阶注入无确定性防线**：wrapUntrusted + Rule 11 是软约束。是否需要确定性兜底——「本轮处理过 CLI 输出后，下一轮所有 state-changing/dangerous op 无条件 L2」？还是接受残余靠审计回溯？

### 关键不确定项声明
- SMTC 未签名可达性有强开源实证但未本机实测（P3 前需 PS WinRT probe）。
- `Get-StartApps` 覆盖 win32+UWP 属标准知识未实测。
- 未通读 App.tsx dialog 全文与 agentStore config 同步细节；`apps.list` 推送建议复制 `mcp.servers.updated` 广播模式。

---

## 对抗修订（2026-07-18，见 app-tab-design-adversary.md）— OVERRIDE 上文冲突处

1. **D1 (BLOCKER)**：add validator 必须做 basename→vault 映射检查 + 显式 deny 清单；CLI track 全量适用 vault blacklist；GUI vault app 禁止挂模板（vault blacklist 不会自动遗传到新命名空间）。
2. **D2**：add-auto / 升级→auto / drift re-approve 一律 **biometric**（Hello + manual-nonce fallback），不用 L2。
3. **D3**：结构规则为强制项——**auto 仅对 L0 无参 launch 生效；凡带参数的 op（含模板）在 auto 下也强制 L2**。lolbin blocklist 补 pwsh/cscript/msbuild/installutil/wt.exe/WindowsTerminal.exe 后降为纵深。UI 文案「auto = 仅启动免确认」。
4. **D4**：thread-trust 泛化 Stretch 砍掉，除非 owner 正式推翻 W7 Blocker 1 的 read-only 锁。
5. **D5**：preset 默认 policy=manual；升 auto 走 biometric；user-writable 路径禁 auto + 黄标。
6. **D6**：slot = 字符集白名单 + 拒 `-`/`/`/`@` 前缀 + 禁 `"` `%` `!` + exec 时复验。
7. **D7**：GUI launch 结果用语义化存在性复查（查 MainWindow/镜像名），不用 quick-exit 启发式（防误伤单实例应用）。
8. **D8**：add dialog 渲染 signer/blocklist/user-writable/来源（手动输入 vs 枚举）警告；paste-path 显式命名为 social bridge。
9. **D9–D11 (NIT)**：Rule 11 文本随 source 词汇同步；assert x64 companion；AUMID 正则校验 + explorer 内部机制豁免写明。
10. **D12 (scope)**：**L1 templates 移 P2**；注册表 Uninstall 枚举移 P2；preset 收敛到 1 个。**P1 = App tab + 枚举添加 + L0 launch + 三档 policy + 安全三件套 + 审计 + system prompt 索引注入**。
11. **Q5 确定性兜底（采纳靶向版）**：thread 内见过 CLI 输出后，state-changing op 强制 L2、auto 按 ai 降级，至下一个真实 user message 清除。
12. **接线警示**：host_app/host_cli 进 gate = 三处接线（tool 名单 + bindingPayloadFor switch + executor validate 分支），需测试断言 binding payload 非空。

---

## Owner 决策（2026-07-18 10:56，P1 需求基线）

1. **auto 档语义**：接受「仅启动免确认、带参必确认（L2）、危险操作必 Hello」。（对应对抗修订 D3 结构规则，正式采纳）
2. **W7 read-only 锁：为"启动应用"正式破例**。thread-trust 扩展一个 kind：`"app-launch"`，**仅限 L0 无参启动**；读操作语义不变；写/危险操作永远不适用 thread-trust。此为 owner 对 W7 Blocker 1 的显式裁决（锁是决策不是机制），需在 `w7-trusted-apps-final.md` 补 amendment 注记。
3. **user-writable 目录 / 未签名应用**：允许添加 + 黄色警告徽标，**但此类应用禁止设为 auto**（最高 policy = `ai`）。（对 §10 问题 5/8 的合并裁决——若理解有偏差 owner 将纠正）
